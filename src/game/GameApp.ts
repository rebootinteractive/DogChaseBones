import { Application, Container, Graphics, Rectangle, Text, TextStyle } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import type { LevelData } from '../shared/types';
import { STAGE_H, STAGE_W } from '../shared/stage';
import { SETTINGS } from './settings';
import { parseLevel } from './level';
import type { LevelSpec } from './level';
import { createBoard, dogsRemaining, queueSlot, queuesOf } from './board';
import type { BoardState, RuntimeQueue, Walker } from './board';
import { cellAt, cellCenter, colRowCenter, computeCamera, toCellDelta } from './camera';
import type { Camera } from './camera';
import { slideGroupBy } from './slide';
import { beeReach } from './pathing';
import { finishWalker, isWon, resolveMoves } from './resolve';
import { LabelPool } from '../render/labels';
import {
  drawBadge, drawBee, drawBeeReachCell, drawBlockGroup, drawBone, drawBonePip,
  drawCell, drawDog, drawRouteCell, drawWall,
} from '../render/draw';

export interface GameOptions {
  level: LevelData;
  onMenu: () => void;
  onWin?: () => void;
}

type Status = 'playing' | 'won' | 'lost';

/** A dog animating along its locked route. `progress` is in cells; -1 is off-board. */
interface WalkerAnim {
  walker: Walker;
  progress: number;
  enterDelay: number;
  eating: number;
  arrived: boolean;
}

interface Drag {
  group: string;
  originX: number;
  originY: number;
  appliedDc: number;
  appliedDr: number;
}

const C = SETTINGS.colors;
const L = SETTINGS.layout;
const T = SETTINGS.timing;

export class GameApp {
  private app = new Application();
  private root = new Container();
  private gridG = new Graphics();
  private overlayG = new Graphics();
  private boardG = new Graphics();
  private dogG = new Graphics();
  private boneCounts = new LabelPool({ fill: 0xffffff, fontSize: 13, fontFamily: 'system-ui, sans-serif', fontWeight: '700' });
  private hud = new Container();

  private spec!: LevelSpec;
  private state!: BoardState;
  private cam!: Camera;

  private timerText!: Text;
  private nameText!: Text;
  private dogsText!: Text;

  private status: Status = 'playing';
  private timeLeft = 0;
  private drag: Drag | null = null;
  private anims: WalkerAnim[] = [];

  private resizeObserver?: ResizeObserver;
  private backBtn?: HTMLButtonElement;
  private banner?: HTMLDivElement;
  private tick = (ticker: { deltaMS: number }) => this.update(ticker.deltaMS);

  private constructor(private parent: HTMLElement, private opts: GameOptions) {}

  static async create(parent: HTMLElement, opts: GameOptions): Promise<GameApp> {
    const g = new GameApp(parent, opts);
    await g.init();
    return g;
  }

  private async init() {
    await this.app.init({ width: STAGE_W, height: STAGE_H, background: C.background, antialias: true });
    this.parent.appendChild(this.app.canvas);
    this.app.canvas.style.touchAction = 'none';

    this.root.addChild(this.gridG, this.overlayG, this.boardG, this.boneCounts.view, this.dogG);
    this.app.stage.addChild(this.root, this.hud);

    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = new Rectangle(0, 0, STAGE_W, STAGE_H);
    this.app.stage.on('pointerdown', this.onDown);
    this.app.stage.on('globalpointermove', this.onMove);
    this.app.stage.on('pointerup', this.onUp);
    this.app.stage.on('pointerupoutside', this.onUp);

    this.load();
    this.buildHud();
    this.addBackButton();

    this.app.ticker.add(this.tick);
    this.resizeObserver = new ResizeObserver(() => this.fit());
    this.resizeObserver.observe(this.parent);
    this.fit();
  }

  private load() {
    const { spec, issues } = parseLevel(this.opts.level);
    if (issues.length) console.warn('[DogChaseBones] level issues:', issues);
    this.spec = spec;
    this.state = createBoard(spec);
    this.cam = computeCamera(spec.cols, spec.rows);
    this.timeLeft = spec.timeLimit;
    this.status = 'playing';
    this.drag = null;
    this.anims = [];
    this.drawGrid();
    // A level can start already solvable -- those dogs set off straight away.
    this.sendDogs();
    this.redraw();
  }

  restart() {
    this.banner?.remove();
    this.banner = undefined;
    this.danger = false;
    this.load();
    this.rebuildBadges();
    this.updateHud();
    this.redraw();
  }

  private rebuildBadges() {
    for (const label of this.badgeLabels) { this.hud.removeChild(label); label.destroy(); }
    this.badgeLabels = [];
    for (const _q of queuesOf(this.state)) {
      const label = new Text({
        text: '',
        style: new TextStyle({ fill: C.badgeText, fontSize: 11, fontFamily: 'system-ui, sans-serif' }),
      });
      label.anchor.set(0.5);
      this.badgeLabels.push(label);
      this.hud.addChild(label);
    }
  }

  // ---------------------------------------------------------------- input ---

  private onDown = (e: FederatedPointerEvent) => {
    if (this.status !== 'playing') return;
    const p = this.app.stage.toLocal(e.global);
    const cell = cellAt(this.cam, p.x, p.y);
    if (cell === null) return;
    const unit = this.state.units.get(cell);
    if (!unit) return;
    this.drag = { group: unit.group, originX: p.x, originY: p.y, appliedDc: 0, appliedDr: 0 };
    this.redraw();
  };

  private onMove = (e: FederatedPointerEvent) => {
    if (!this.drag || this.status !== 'playing') return;
    const p = this.app.stage.toLocal(e.global);
    const want = toCellDelta(this.cam, p.x - this.drag.originX, p.y - this.drag.originY);
    const dc = want.dc - this.drag.appliedDc;
    const dr = want.dr - this.drag.appliedDr;
    if (dc === 0 && dr === 0) return;

    const moved = slideGroupBy(this.state, this.drag.group, dc, dr);
    if (moved.dc === 0 && moved.dr === 0) return;
    this.drag.appliedDc += moved.dc;
    this.drag.appliedDr += moved.dr;
    this.redraw();
  };

  private onUp = () => {
    if (!this.drag) return;
    this.drag = null;
    this.sendDogs();
    this.redraw();
  };

  // ----------------------------------------------------------------- loop ---

  /** Every queue leader with a safe route sets off. Called on release and after each bone. */
  private sendDogs() {
    for (const c of resolveMoves(this.state)) {
      const walker = this.state.walkers.find((w) => w.sourceId === c.sourceId && w.boneCell === c.boneCell);
      if (walker) this.anims.push({ walker, progress: -1, enterDelay: T.dogEnterDelay, eating: 0, arrived: false });
    }
  }

  private update(dtMs: number) {
    if (this.status === 'playing') {
      this.timeLeft = Math.max(0, this.timeLeft - dtMs / 1000);
      if (this.timeLeft === 0 && this.anims.length === 0) this.lose();
    }

    let changed = false;
    for (const anim of [...this.anims]) {
      if (anim.enterDelay > 0) { anim.enterDelay = Math.max(0, anim.enterDelay - dtMs); continue; }

      if (!anim.arrived) {
        anim.progress += dtMs / T.dogStepMs;
        const end = anim.walker.path.length - 1;
        if (anim.progress >= end) {
          anim.progress = end;
          anim.arrived = true;
          anim.eating = T.boneEatMs;
        }
        changed = true;
        continue;
      }

      anim.eating -= dtMs;
      if (anim.eating > 0) continue;

      finishWalker(this.state, anim.walker);
      this.anims = this.anims.filter((a) => a !== anim);
      changed = true;

      if (isWon(this.state)) { this.win(); }
      else { this.sendDogs(); }
    }

    if (changed) this.redraw();
    this.updateHud();
  }

  private win() {
    if (this.status !== 'playing') return;
    this.status = 'won';
    this.opts.onWin?.();
    // The clock stops the moment status leaves 'playing', so these are the
    // numbers at the winning bite.
    // Round the remainder, then derive what was spent from it, so the two
    // figures on screen always add up to the limit exactly.
    const left = Math.max(0, Math.round(this.timeLeft * 10) / 10);
    const spent = Math.max(0, this.spec.timeLimit - left);
    this.showBanner(
      'Every dog fed',
      'won',
      `${secs(spent)} of ${secs(this.spec.timeLimit)} used  ·  ${secs(left)} left`,
    );
  }

  private lose() {
    if (this.status !== 'playing') return;
    this.status = 'lost';
    const left = dogsRemaining(this.state);
    this.showBanner(`Time up — ${left} dog${left === 1 ? '' : 's'} still hungry`, 'lost');
  }

  // ---------------------------------------------------------------- render ---

  /** Static per level: the cells themselves. */
  private drawGrid() {
    this.gridG.clear();
    for (let i = 0; i < this.spec.cols * this.spec.rows; i++) {
      drawCell(this.gridG, this.cam, i, this.state.dead.has(i));
    }
  }

  private redraw() {
    this.drawOverlay();
    this.drawBoard();
    this.drawDogs();
  }

  private drawOverlay() {
    this.overlayG.clear();
    if (SETTINGS.debug.showBeeReach && this.state.bees.size > 0) {
      for (const cell of beeReach(this.state)) drawBeeReachCell(this.overlayG, this.cam, cell);
    }
    if (SETTINGS.debug.showRoutes) {
      for (const cell of this.state.reserved) drawRouteCell(this.overlayG, this.cam, cell);
    }
  }

  private drawBoard() {
    this.boardG.clear();
    this.boneCounts.begin();
    for (const cell of this.state.walls) drawWall(this.boardG, this.cam, cell);
    for (const [group, cells] of this.state.groups) {
      drawBlockGroup(this.boardG, this.cam, cells, this.drag?.group === group ? C.blockHeld : C.block);
    }
    for (const [cell, stack] of this.state.bones) {
      const p = cellCenter(this.cam, cell);
      drawBone(this.boardG, p.x, p.y, this.cam.cell);
      // A cell can carry a stack; it survives until the last bone is eaten.
      if (stack.count > 1) {
        const r = this.cam.cell * 0.21;
        const px = p.x + this.cam.cell * 0.29;
        const py = p.y + this.cam.cell * 0.29;
        drawBonePip(this.boardG, px, py, r);
        this.boneCounts.add(px, py, String(stack.count), r / 9);
      }
    }
    for (const cell of this.state.bees) {
      const p = cellCenter(this.cam, cell);
      drawBee(this.boardG, p.x, p.y, this.cam.cell);
    }
    this.boneCounts.end();
  }

  private drawDogs() {
    this.dogG.clear();
    const size = this.cam.cell * L.queueDogScale;

    // Dogs standing on the board, waiting for a safe route out of their cell.
    for (const cell of this.state.gridDogs) {
      const p = cellCenter(this.cam, cell);
      drawDog(this.dogG, p.x, p.y, size);
    }

    queuesOf(this.state).forEach((q, i) => {
      // While this queue's leader is still stepping in from outside, the dogs
      // behind it hold back one slot so they do not draw on top of it.
      const entering = this.anims.some((a) => a.walker.sourceId === q.id && a.progress < 0);
      const first = entering ? 1 : 0;
      const drawn = Math.min(q.remaining, L.queueMaxDrawn);
      for (let n = 0; n < drawn; n++) {
        const slot = queueSlot(this.state, q, first + n);
        const p = colRowCenter(this.cam, slot.c, slot.r);
        drawDog(this.dogG, p.x, p.y, size);
      }
      this.positionQueueBadge(q, i, first);
    });

    for (const anim of this.anims) {
      const p = this.walkerPoint(anim);
      drawDog(this.dogG, p.x, p.y, size);
    }
  }

  /** Badge Texts are made once per queue in buildHud and only repositioned here. */
  private positionQueueBadge(q: RuntimeQueue, i: number, first: number) {
    const label = this.badgeLabels[i];
    if (!label) return;
    if (q.remaining <= 0) { label.visible = false; return; }

    const slot = queueSlot(this.state, q, first);
    const p = colRowCenter(this.cam, slot.c, slot.r);
    const w = 28;
    const h = 16;
    const gap = this.cam.cell * 0.5 + L.queueBadgeGap;
    const horizontal = q.dir === 'left' || q.dir === 'right';
    const bx = horizontal ? p.x : p.x + gap + w / 2;
    const by = horizontal ? p.y - gap - h / 2 : p.y;

    drawBadge(this.dogG, bx, by, w, h);
    label.visible = true;
    label.text = `x${q.remaining}`;
    label.position.set(bx, by);
  }

  private badgeLabels: Text[] = [];

  /** Interpolated position of a walking dog, including the step in from outside. */
  private walkerPoint(anim: WalkerAnim): { x: number; y: number } {
    const path = anim.walker.path;
    const p = Math.max(-1, Math.min(path.length - 1, anim.progress));
    const lo = Math.floor(p);
    const hi = Math.min(path.length - 1, lo + 1);
    const frac = p - lo;
    const a = this.pathPoint(anim.walker, lo);
    const b = this.pathPoint(anim.walker, hi);
    return { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac };
  }

  private pathPoint(walker: Walker, i: number): { x: number; y: number } {
    if (i >= 0) return cellCenter(this.cam, walker.path[i]);
    // A grid dog has no off-board slot: it starts on the board, at path[0].
    const q = queuesOf(this.state).find((x) => x.id === walker.sourceId);
    if (!q) return cellCenter(this.cam, walker.path[0]);
    const slot = queueSlot(this.state, q, 0);
    return colRowCenter(this.cam, slot.c, slot.r);
  }

  // ------------------------------------------------------------------ hud ---

  private buildHud() {
    const bar = new Graphics();
    bar.rect(0, 0, STAGE_W, L.hudHeight).fill({ color: C.hudBar });
    bar.rect(0, L.hudHeight - 1, STAGE_W, 1).fill({ color: C.hudRule });
    this.hud.addChild(bar);

    this.nameText = new Text({
      text: this.opts.level.name.toUpperCase(),
      style: new TextStyle({ fill: C.hudLabel, fontSize: 14, letterSpacing: 1.5, fontFamily: 'system-ui, sans-serif' }),
    });
    this.nameText.anchor.set(0.5, 0);
    this.nameText.position.set(STAGE_W / 2, 28);

    this.timerText = new Text({
      text: '0:00',
      style: new TextStyle({ fill: C.hudValue, fontSize: 25, fontFamily: 'ui-monospace, SFMono-Regular, monospace' }),
    });
    this.timerText.anchor.set(0.5);
    this.timerText.position.set(126, 80);

    this.dogsText = new Text({
      text: 'x0',
      style: new TextStyle({ fill: C.hudValue, fontSize: 25, fontFamily: 'system-ui, sans-serif' }),
    });
    this.dogsText.anchor.set(0, 0.5);
    this.dogsText.position.set(272, 80);

    const icon = new Graphics();
    drawDog(icon, 254, 80, 28);

    this.hud.addChild(this.nameText, this.timerText, this.dogsText, icon);

    for (const _q of queuesOf(this.state)) {
      const label = new Text({
        text: '',
        style: new TextStyle({ fill: C.badgeText, fontSize: 11, fontFamily: 'system-ui, sans-serif' }),
      });
      label.anchor.set(0.5);
      this.badgeLabels.push(label);
      this.hud.addChild(label);
    }

    this.updateHud();
    this.redraw();
  }

  private danger = false;

  private updateHud() {
    const total = Math.ceil(this.timeLeft);
    const mm = Math.floor(total / 60);
    const ss = total % 60;
    this.timerText.text = `${mm}:${String(ss).padStart(2, '0')}`;
    this.dogsText.text = `x${dogsRemaining(this.state)}`;

    // Only touch the style when the state actually flips -- assigning fill
    // re-renders the text every frame otherwise.
    const danger = this.timeLeft <= 10;
    if (danger !== this.danger) {
      this.danger = danger;
      this.timerText.style.fill = danger ? C.hudDanger : C.hudValue;
    }
  }

  // --------------------------------------------------------------- chrome ---

  private addBackButton() {
    const btn = document.createElement('button');
    btn.className = 'btn ghost small overlay-back';
    btn.textContent = '← Menu';
    btn.onclick = () => this.opts.onMenu();
    this.parent.appendChild(btn);
    this.backBtn = btn;
  }

  private showBanner(message: string, kind: Status, detail?: string) {
    this.banner?.remove();
    const el = document.createElement('div');
    el.className = `result-banner ${kind}`;
    el.innerHTML = `<p></p><p class="result-detail"></p><div class="result-actions">
      <button class="btn" data-act="retry">Play again</button>
      <button class="btn ghost" data-act="menu">← Menu</button></div>`;
    el.querySelector('p')!.textContent = message;
    const detailEl = el.querySelector<HTMLElement>('.result-detail')!;
    if (detail) detailEl.textContent = detail; else detailEl.remove();
    el.querySelector('[data-act="retry"]')!.addEventListener('click', () => this.restart());
    el.querySelector('[data-act="menu"]')!.addEventListener('click', () => this.opts.onMenu());
    this.parent.appendChild(el);
    this.banner = el;
  }

  private fit() {
    // letterbox the fixed 393x852 stage into the parent
    const { clientWidth: w, clientHeight: h } = this.parent;
    const scale = Math.min(w / STAGE_W, h / STAGE_H);
    this.app.stage.scale.set(scale);
    this.app.stage.position.set((w - STAGE_W * scale) / 2, (h - STAGE_H * scale) / 2);
    this.app.renderer.resize(w, h);
  }

  dispose() {
    this.app.ticker.remove(this.tick);
    this.app.stage.off('pointerdown', this.onDown);
    this.app.stage.off('globalpointermove', this.onMove);
    this.app.stage.off('pointerup', this.onUp);
    this.app.stage.off('pointerupoutside', this.onUp);
    this.resizeObserver?.disconnect();
    this.backBtn?.remove();
    this.banner?.remove();
    this.anims = [];
    this.badgeLabels = [];
    this.boneCounts.destroy();
    // destroys renderer, view canvas, and all stage children/graphics
    this.app.destroy({ removeView: true }, { children: true, texture: true });
  }
}

/** Seconds to one decimal -- level timers are tuned in small steps. */
function secs(value: number): string {
  return `${value.toFixed(1)}s`;
}
