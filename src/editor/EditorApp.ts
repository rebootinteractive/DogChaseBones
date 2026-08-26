import { Application, Container, Graphics, Rectangle, Text, TextStyle } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import type { GameElement, LevelData } from '../shared/types';
import type { LevelStore } from '../levels/store';
import { SETTINGS } from '../game/settings';
import { DIRS, DIR_VEC, colOf, idx, rowOf } from '../game/cells';
import type { Dir } from '../game/cells';
import { MAX_DIM, MIN_DIM, parseLevel } from '../game/level';
import { boundaryDirs } from '../game/board';
import { validateLevel } from '../game/validate';
import { cellAt, cellCenter, colRowCenter, computeEditorCamera, toCellDelta } from '../game/camera';
import type { Camera } from '../game/camera';
import { cellsOfGroup, evaluatePlacement } from '../game/place';
import type { Placement } from '../game/place';
import { groupTint } from '../render/color';
import {
  drawBee, drawBlockGroup, drawBone, drawCell, drawDog,
  drawPlacementCell, drawVacatedCell, drawWall,
} from '../render/draw';

export interface EditorOptions {
  store: LevelStore;
  prototype: string;
  initial?: LevelData;
  onExit: () => void;
  onTest: (level: LevelData) => void;
}

type Tool = 'block' | 'move' | 'bone' | 'wall' | 'bee' | 'dead' | 'queue' | 'erase';

interface EditorQueue { cell: number; dir: Dir; count: number }

/** A block group picked up with the Move tool and not yet dropped. */
interface MoveDrag {
  group: string;
  /** The group's cells before the drag started. */
  cells: number[];
  /** Which of those carry a bone, so the bones travel with their units. */
  bones: number[];
  originX: number;
  originY: number;
  dc: number;
  dr: number;
  placement: Placement;
}

const C = SETTINGS.colors;
const L = SETTINGS.layout;

const TOOLS: Array<{ id: Tool; label: string; hint: string }> = [
  { id: 'block', label: 'Block', hint: 'Tap cells to add them to the active group.' },
  { id: 'move', label: 'Move', hint: 'Drag a whole block group somewhere else. Red means it will not fit.' },
  { id: 'bone', label: 'Bone', hint: 'Bones ride block units — tap a block.' },
  { id: 'wall', label: 'Wall', hint: 'Static, unmovable, blocks everything.' },
  { id: 'bee', label: 'Bee', hint: 'Fixed. Poisons every cell it can reach.' },
  { id: 'dead', label: 'Off', hint: 'Switch a cell off. Use these to split islands.' },
  { id: 'queue', label: 'Queue', hint: 'Tap a boundary cell to add a queue, or tap one to select it.' },
  { id: 'erase', label: 'Erase', hint: 'Clear whatever is in the cell.' },
];

export class EditorApp {
  private app = new Application();
  private root = new Container();
  private gridG = new Graphics();
  private boardG = new Graphics();
  private overlayG = new Graphics();
  private labels = new Container();

  private cols: number;
  private rows: number;
  private timeLimit: number;
  private name: string;
  private id: string;

  private dead = new Set<number>();
  private walls = new Set<number>();
  private bees = new Set<number>();
  private units = new Map<number, string>();   // cell -> group id
  private bones = new Set<number>();
  private queues: EditorQueue[] = [];

  private groups: string[] = ['g1'];
  private activeGroup = 'g1';
  private groupSeq = 1;

  private tool: Tool = 'block';
  private cam!: Camera;
  private painting = false;
  private lastPainted: number | null = null;
  private moveDrag: MoveDrag | null = null;
  private selectedQueue = -1;

  private host?: HTMLDivElement;
  private sceneEl?: HTMLDivElement;
  private chrome?: HTMLDivElement;
  private modal?: HTMLDivElement;
  private resizeObserver?: ResizeObserver;
  private saveResetTimer?: ReturnType<typeof setTimeout>;

  private constructor(private parent: HTMLElement, private opts: EditorOptions) {
    const level = opts.initial;
    const meta = (level?.meta ?? {}) as Record<string, unknown>;
    this.cols = clamp(typeof meta.cols === 'number' ? meta.cols : 6, MIN_DIM, MAX_DIM);
    this.rows = clamp(typeof meta.rows === 'number' ? meta.rows : 10, MIN_DIM, MAX_DIM);
    this.timeLimit = typeof meta.timeLimit === 'number' && meta.timeLimit > 0 ? Math.round(meta.timeLimit) : 120;
    this.name = level?.name ?? 'New Level';
    this.id = level?.id ?? `custom-${crypto.randomUUID()}`;
    if (level) this.loadElements(level.elements);
  }

  static async create(parent: HTMLElement, opts: EditorOptions): Promise<EditorApp> {
    const e = new EditorApp(parent, opts);
    await e.init();
    return e;
  }

  private loadElements(elements: GameElement[]) {
    const seen = new Set<string>();
    for (const el of elements) {
      const c = Math.round(Number(el.x));
      const r = Math.round(Number(el.y));
      if (!Number.isFinite(c) || !Number.isFinite(r)) continue;
      if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) continue;
      const cell = idx(this.cols, c, r);
      switch (el.type) {
        case 'dead': this.dead.add(cell); break;
        case 'wall': this.walls.add(cell); break;
        case 'bee': this.bees.add(cell); break;
        case 'bone': this.bones.add(cell); break;
        case 'block': {
          const group = typeof el.group === 'string' && el.group ? el.group : 'g1';
          this.units.set(cell, group);
          seen.add(group);
          break;
        }
        case 'queue': {
          const dir = DIRS.includes(el.dir as Dir) ? (el.dir as Dir) : 'up';
          const count = Math.max(1, Math.round(Number(el.count) || 1));
          this.queues.push({ cell, dir, count });
          break;
        }
        default: break;
      }
    }
    if (seen.size) {
      this.groups = [...seen].sort();
      this.activeGroup = this.groups[0];
      this.groupSeq = this.groups.reduce((n, g) => Math.max(n, Number(g.replace(/\D/g, '')) || 0), 0);
    }
    // A bone with no block underneath is not representable at runtime; drop it.
    for (const cell of [...this.bones]) if (!this.units.has(cell)) this.bones.delete(cell);
  }

  private async init() {
    // The editor is its own screen, not the phone frame: the scene and the tool
    // panel are siblings, so the panel never covers cells you need to reach.
    const host = document.createElement('div');
    host.className = 'editor-root';
    host.style.setProperty('--editor-panel-width', `${SETTINGS.editor.panelWidth}px`);
    const scene = document.createElement('div');
    scene.className = 'editor-scene';
    host.appendChild(scene);
    this.parent.appendChild(host);
    document.body.classList.add('editor-mode');
    this.host = host;
    this.sceneEl = scene;

    await this.app.init({ width: 1, height: 1, background: C.background, antialias: true });
    scene.appendChild(this.app.canvas);
    this.app.canvas.style.touchAction = 'none';
    this.root.addChild(this.gridG, this.boardG, this.overlayG, this.labels);
    this.app.stage.addChild(this.root);

    this.app.stage.eventMode = 'static';
    this.app.stage.on('pointerdown', this.onDown);
    this.app.stage.on('globalpointermove', this.onMove);
    this.app.stage.on('pointerup', this.onUp);
    this.app.stage.on('pointerupoutside', this.onUp);

    this.buildChrome();
    this.resizeObserver = new ResizeObserver(() => this.fit());
    this.resizeObserver.observe(scene);
    this.fit();
  }

  /** Size the renderer to the scene pane and refit the grid inside it. */
  private fit() {
    const el = this.sceneEl;
    if (!el) return;
    const w = Math.max(1, el.clientWidth);
    const h = Math.max(1, el.clientHeight);
    this.app.renderer.resize(w, h);
    this.app.stage.hitArea = new Rectangle(0, 0, w, h);
    this.cam = computeEditorCamera(this.cols, this.rows, { width: w, height: h });
    this.redraw();
  }

  // ---------------------------------------------------------------- input ---

  private onDown = (e: FederatedPointerEvent) => {
    const cell = this.cellUnder(e);
    if (cell === null) return;
    if (this.tool === 'move') { this.beginMove(cell, e); return; }
    this.painting = true;
    this.lastPainted = null;
    this.apply(cell);
  };

  private onMove = (e: FederatedPointerEvent) => {
    if (this.moveDrag) { this.updateMove(e); return; }
    if (!this.painting) return;
    // Queue direction cycling would fire repeatedly under a drag; keep it to taps.
    if (this.tool === 'queue') return;
    const cell = this.cellUnder(e);
    if (cell === null || cell === this.lastPainted) return;
    this.apply(cell);
  };

  private onUp = () => {
    if (this.moveDrag) { this.endMove(); return; }
    this.painting = false;
    this.lastPainted = null;
  };

  private cellUnder(e: FederatedPointerEvent): number | null {
    const p = this.app.stage.toLocal(e.global);
    return cellAt(this.cam, p.x, p.y);
  }

  private apply(cell: number) {
    this.lastPainted = cell;
    switch (this.tool) {
      case 'block': this.applyBlock(cell); break;
      case 'bone': this.applyBone(cell); break;
      case 'wall': this.toggleTerrain(this.walls, cell); break;
      case 'bee': this.toggleTerrain(this.bees, cell); break;
      case 'dead': this.toggleDead(cell); break;
      case 'queue': this.applyQueue(cell); break;
      case 'erase': this.eraseCell(cell); break;
    }
    this.redraw();
    this.refreshChrome();
  }

  // ------------------------------------------------------------------ move ---

  private beginMove(cell: number, e: FederatedPointerEvent) {
    const group = this.units.get(cell);
    if (!group) { this.flash('Nothing to move here — grab a block.'); return; }

    const p = this.app.stage.toLocal(e.global);
    const cells = cellsOfGroup(this.units, group);
    this.moveDrag = {
      group, cells,
      bones: cells.filter((c) => this.bones.has(c)),
      originX: p.x, originY: p.y,
      dc: 0, dr: 0,
      placement: this.placementFor(cells, group, 0, 0),
    };
    this.redraw();
  }

  private updateMove(e: FederatedPointerEvent) {
    const drag = this.moveDrag;
    if (!drag) return;
    const p = this.app.stage.toLocal(e.global);
    const { dc, dr } = toCellDelta(this.cam, p.x - drag.originX, p.y - drag.originY);
    if (dc === drag.dc && dr === drag.dr) return;
    drag.dc = dc;
    drag.dr = dr;
    drag.placement = this.placementFor(drag.cells, drag.group, dc, dr);
    this.redraw();
  }

  /** Commit the move if it fits; otherwise the group snaps back untouched. */
  private endMove() {
    const drag = this.moveDrag;
    this.moveDrag = null;
    if (!drag) return;

    if (drag.placement.ok && (drag.dc !== 0 || drag.dr !== 0)) {
      for (const cell of drag.cells) { this.units.delete(cell); this.bones.delete(cell); }
      drag.cells.forEach((cell, i) => {
        const target = drag.placement.targets[i];
        this.units.set(target, drag.group);
        if (drag.bones.includes(cell)) this.bones.add(target);
      });
    } else if (!drag.placement.ok) {
      this.flash('That does not fit — the group went back.');
    }

    this.redraw();
    this.refreshChrome();
  }

  private placementFor(cells: number[], group: string, dc: number, dr: number): Placement {
    const board = { cols: this.cols, rows: this.rows, dead: this.dead, walls: this.walls, bees: this.bees, units: this.units };
    return evaluatePlacement(board, cells, group, dc, dr);
  }

  private applyBlock(cell: number) {
    if (this.dead.has(cell)) return;
    const existing = this.units.get(cell);
    if (existing === this.activeGroup) { this.units.delete(cell); this.bones.delete(cell); return; }
    this.walls.delete(cell);
    this.bees.delete(cell);
    this.units.set(cell, this.activeGroup);   // reassigns a unit from another group
  }

  private applyBone(cell: number) {
    if (!this.units.has(cell)) { this.flash('Bones ride block units — put a block here first.'); return; }
    if (this.bones.has(cell)) this.bones.delete(cell); else this.bones.add(cell);
  }

  private toggleTerrain(set: Set<number>, cell: number) {
    if (this.dead.has(cell)) return;
    if (set.has(cell)) { set.delete(cell); return; }
    this.clearCell(cell);
    set.add(cell);
  }

  private toggleDead(cell: number) {
    if (this.dead.has(cell)) { this.dead.delete(cell); return; }
    this.clearCell(cell);
    this.queues = this.queues.filter((q) => q.cell !== cell);
    this.dead.add(cell);
  }

  private applyQueue(cell: number) {
    const at = this.queues.findIndex((q) => q.cell === cell);
    const valid = boundaryDirs({ cols: this.cols, rows: this.rows, dead: this.dead }, cell);

    if (at >= 0) {
      // First tap selects it -- that is what exposes the dog count. Tapping the
      // one already selected turns it. Removing is an explicit button, so a
      // stray tap can never delete a queue you were only trying to edit.
      if (this.selectedQueue !== at) { this.selectedQueue = at; return; }
      const q = this.queues[at];
      const order = valid.length ? valid : [...DIRS];
      const i = order.indexOf(q.dir);
      q.dir = order[(i + 1) % order.length];
      return;
    }

    if (!valid.length) { this.flash('A queue needs a side that is off-grid or switched off.'); return; }
    if (this.dead.has(cell)) { this.flash('That cell is switched off.'); return; }
    this.queues.push({ cell, dir: valid[0], count: 3 });
    this.selectedQueue = this.queues.length - 1;
  }

  private eraseCell(cell: number) {
    this.clearCell(cell);
    this.dead.delete(cell);
    this.queues = this.queues.filter((q) => q.cell !== cell);
    this.selectedQueue = -1;
  }

  private clearCell(cell: number) {
    this.units.delete(cell);
    this.bones.delete(cell);
    this.walls.delete(cell);
    this.bees.delete(cell);
  }

  // --------------------------------------------------------------- render ---

  private redraw() {
    this.gridG.clear();
    for (let i = 0; i < this.cols * this.rows; i++) drawCell(this.gridG, this.cam, i, this.dead.has(i));

    this.boardG.clear();
    for (const cell of this.walls) drawWall(this.boardG, this.cam, cell);

    const dragging = this.moveDrag;
    const byGroup = new Map<string, Set<number>>();
    for (const [cell, group] of this.units) {
      if (dragging && group === dragging.group) continue;   // drawn as a ghost below
      let set = byGroup.get(group);
      if (!set) { set = new Set(); byGroup.set(group, set); }
      set.add(cell);
    }
    for (const [group, cells] of byGroup) {
      drawBlockGroup(this.boardG, this.cam, cells, this.tintFor(group));
    }
    for (const cell of this.bones) {
      if (dragging && dragging.cells.includes(cell)) continue;
      const p = cellCenter(this.cam, cell);
      drawBone(this.boardG, p.x, p.y, this.cam.cell);
    }
    for (const cell of this.bees) {
      const p = cellCenter(this.cam, cell);
      drawBee(this.boardG, p.x, p.y, this.cam.cell);
    }

    if (dragging) this.drawMoveGhost(dragging);
    this.drawQueues();
  }

  /**
   * The group under the finger: its old footprint outlined, every target cell
   * painted green or red, and the group itself drawn where it would land.
   */
  private drawMoveGhost(drag: MoveDrag) {
    const { placement } = drag;
    const blocked = new Set(placement.blocked);

    for (const cell of drag.cells) drawVacatedCell(this.boardG, this.cam, cell);

    for (const target of placement.targets) {
      if (target < 0) continue;   // off the grid; nothing to paint
      drawPlacementCell(this.boardG, this.cam, target, !blocked.has(target) && !placement.offGrid);
    }

    const landing = new Set(placement.targets.filter((t) => t >= 0));
    if (landing.size) {
      drawBlockGroup(this.boardG, this.cam, landing, this.tintFor(drag.group));
      for (let i = 0; i < drag.cells.length; i++) {
        const target = placement.targets[i];
        if (target < 0 || !drag.bones.includes(drag.cells[i])) continue;
        const p = cellCenter(this.cam, target);
        drawBone(this.boardG, p.x, p.y, this.cam.cell);
      }
    }
  }

  private drawQueues() {
    this.overlayG.clear();
    for (const label of this.labels.removeChildren()) label.destroy();

    this.queues.forEach((q, i) => {
      const { dc, dr } = DIR_VEC[q.dir];
      const c = colOf(this.cols, q.cell);
      const r = rowOf(this.cols, q.cell);
      const at = colRowCenter(this.cam, c + dc, r + dr);
      const entry = cellCenter(this.cam, q.cell);

      drawDog(this.overlayG, at.x, at.y, this.cam.cell * L.queueDogScale);

      // Arrow from the waiting dog into its entry cell.
      this.overlayG
        .moveTo(at.x - dc * this.cam.cell * 0.42, at.y - dr * this.cam.cell * 0.42)
        .lineTo(entry.x + dc * this.cam.cell * 0.34, entry.y + dr * this.cam.cell * 0.34)
        .stroke({ width: 2, color: C.editorGuide });

      if (i === this.selectedQueue) {
        this.overlayG
          .roundRect(entry.x - this.cam.cell / 2 + 1, entry.y - this.cam.cell / 2 + 1, this.cam.cell - 2, this.cam.cell - 2, L.cellRadius)
          .stroke({ width: 2, color: C.editorGuide });
      }

      const label = new Text({
        text: `x${q.count}`,
        style: new TextStyle({ fill: C.badgeText, fontSize: 11, fontFamily: 'system-ui, sans-serif' }),
      });
      label.anchor.set(0.5);
      const off = this.cam.cell * 0.62;
      label.position.set(at.x + (dr !== 0 ? off : 0), at.y + (dc !== 0 ? -off : 0));
      this.labels.addChild(label);
    });
  }

  /**
   * Groups are tinted while authoring so two flush-but-separate groups are
   * obviously separate. A group not in the list gets the next free slot rather
   * than silently sharing colour one.
   */
  private tintFor(group: string): number {
    const known = this.groups.indexOf(group);
    return groupTint(known < 0 ? this.groups.length : known, SETTINGS.editor.groupTints);
  }

  // ------------------------------------------------------------ level i/o ---

  private snapshot(): LevelData {
    const elements: GameElement[] = [];
    const push = (type: string, cell: number, extra: Record<string, unknown> = {}) =>
      elements.push({ type, x: colOf(this.cols, cell), y: rowOf(this.cols, cell), ...extra });

    for (const cell of this.dead) push('dead', cell);
    for (const cell of this.walls) push('wall', cell);
    for (const cell of this.bees) push('bee', cell);
    for (const [cell, group] of this.units) push('block', cell, { group });
    for (const cell of this.bones) push('bone', cell);
    for (const q of this.queues) push('queue', q.cell, { dir: q.dir, count: q.count });

    return {
      id: this.id,
      name: this.name,
      prototype: this.opts.prototype,
      elements,
      meta: { cols: this.cols, rows: this.rows, timeLimit: this.timeLimit },
    };
  }

  private warnings(): string[] {
    const { spec, issues } = parseLevel(this.snapshot());
    return [...issues, ...validateLevel(spec)];
  }

  private resize(dCols: number, dRows: number) {
    const cols = clamp(this.cols + dCols, MIN_DIM, MAX_DIM);
    const rows = clamp(this.rows + dRows, MIN_DIM, MAX_DIM);
    if (cols === this.cols && rows === this.rows) return;

    // Re-key everything by (col,row) so content keeps its position when the grid grows.
    const remap = <T,>(src: Iterable<[number, T]>): Array<[number, T]> =>
      [...src]
        .map(([cell, v]) => [colOf(this.cols, cell), rowOf(this.cols, cell), v] as const)
        .filter(([c, r]) => c < cols && r < rows)
        .map(([c, r, v]) => [idx(cols, c, r), v] as [number, T]);

    const keys = (src: Set<number>) => new Set(remap([...src].map((c) => [c, true] as [number, boolean])).map(([c]) => c));

    const nextUnits = new Map(remap(this.units));
    const nextBones = keys(this.bones);
    this.walls = keys(this.walls);
    this.bees = keys(this.bees);
    this.dead = keys(this.dead);
    this.queues = this.queues
      .filter((q) => colOf(this.cols, q.cell) < cols && rowOf(this.cols, q.cell) < rows)
      .map((q) => ({ ...q, cell: idx(cols, colOf(this.cols, q.cell), rowOf(this.cols, q.cell)) }));
    this.units = nextUnits;
    this.bones = nextBones;

    this.cols = cols;
    this.rows = rows;
    this.selectedQueue = -1;
    this.fit();
    this.refreshChrome();
  }

  // --------------------------------------------------------------- chrome ---

  private buildChrome() {
    const bar = document.createElement('div');
    bar.className = 'editor-panel';
    bar.innerHTML = `
      <button class="chrome-handle" data-act="collapse">Level setup ▾</button>
      <div class="chrome-body">
        <div class="tool-row"></div>
        <p class="tool-hint"></p>
        <div class="group-row"></div>
        <div class="settings-row">
          <label>Name <input class="editor-name" /></label>
          <label>Grid
            <span class="stepper"><button data-act="col-">−</button><b class="dim-cols">6</b><button data-act="col+">+</button></span>
            <span class="stepper"><button data-act="row-">−</button><b class="dim-rows">10</b><button data-act="row+">+</button></span>
          </label>
          <label>Time <input class="editor-time" type="number" min="5" step="5" /> s</label>
        </div>
        <div class="queue-panel">
          <span class="queue-where"></span>
          <label>Dogs
            <span class="stepper"><button data-act="dog-">−</button><b class="dog-n">3</b><button data-act="dog+">+</button></span>
          </label>
          <button class="btn ghost small" data-act="queue-turn">Turn</button>
          <button class="btn ghost small" data-act="queue-del">Remove</button>
        </div>
        <ul class="warn-list"></ul>
      </div>
      <div class="editor-actions">
        <button class="btn ghost small" data-act="clear">Clear</button>
        <button class="btn small" data-act="test">▶ Test</button>
        <button class="btn small" data-act="save">Save draft</button>
        <button class="btn small" data-act="publish">Publish</button>
        <button class="btn ghost small" data-act="exit">← Menu</button>
      </div>`;

    const tools = bar.querySelector('.tool-row')!;
    for (const t of TOOLS) {
      const b = document.createElement('button');
      b.className = 'tool-btn';
      b.dataset.tool = t.id;
      b.textContent = t.label;
      b.onclick = () => { this.tool = t.id; this.refreshChrome(); this.redraw(); };
      tools.appendChild(b);
    }

    const nameInput = bar.querySelector<HTMLInputElement>('.editor-name')!;
    nameInput.value = this.name;
    nameInput.oninput = (e) => { this.name = (e.target as HTMLInputElement).value; };

    const timeInput = bar.querySelector<HTMLInputElement>('.editor-time')!;
    timeInput.value = String(this.timeLimit);
    timeInput.oninput = (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      this.timeLimit = Number.isFinite(v) && v > 0 ? Math.round(v) : this.timeLimit;
    };

    const on = (sel: string, fn: () => void) => bar.querySelector(`[data-act="${sel}"]`)!.addEventListener('click', fn);
    on('collapse', () => { bar.classList.toggle('collapsed'); });
    on('col-', () => this.resize(-1, 0));
    on('col+', () => this.resize(1, 0));
    on('row-', () => this.resize(0, -1));
    on('row+', () => this.resize(0, 1));
    on('dog-', () => this.bumpQueue(-1));
    on('dog+', () => this.bumpQueue(1));
    on('queue-turn', () => this.turnSelectedQueue());
    on('queue-del', () => this.removeSelectedQueue());
    on('clear', () => this.clearAll());
    on('test', () => this.opts.onTest(this.snapshot()));
    on('exit', () => this.opts.onExit());
    on('publish', () => this.showPublish());
    bar.querySelector('[data-act="save"]')!.addEventListener('click', (ev) => void this.saveDraft(ev.target as HTMLButtonElement));

    this.host?.appendChild(bar);
    this.chrome = bar;
    this.refreshChrome();
  }

  private bumpQueue(d: number) {
    const q = this.queues[this.selectedQueue];
    if (!q) return;
    q.count = clamp(q.count + d, 1, 20);
    this.redraw();
    this.refreshChrome();
  }

  private turnSelectedQueue() {
    const q = this.queues[this.selectedQueue];
    if (!q) return;
    const valid = boundaryDirs({ cols: this.cols, rows: this.rows, dead: this.dead }, q.cell);
    const order = valid.length ? valid : [...DIRS];
    q.dir = order[(order.indexOf(q.dir) + 1) % order.length];
    this.redraw();
    this.refreshChrome();
  }

  private removeSelectedQueue() {
    if (this.selectedQueue < 0) return;
    this.queues.splice(this.selectedQueue, 1);
    this.selectedQueue = -1;
    this.redraw();
    this.refreshChrome();
  }

  private clearAll() {
    this.dead.clear(); this.walls.clear(); this.bees.clear();
    this.units.clear(); this.bones.clear();
    this.queues = [];
    this.groups = ['g1'];
    this.activeGroup = 'g1';
    this.groupSeq = 1;
    this.selectedQueue = -1;
    this.redraw();
    this.refreshChrome();
  }

  private refreshChrome() {
    const bar = this.chrome;
    if (!bar) return;

    bar.querySelectorAll<HTMLButtonElement>('.tool-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.tool === this.tool);
    });
    bar.querySelector('.tool-hint')!.textContent = TOOLS.find((t) => t.id === this.tool)?.hint ?? '';

    const groupRow = bar.querySelector<HTMLElement>('.group-row')!;
    groupRow.style.display = this.tool === 'block' ? 'flex' : 'none';
    groupRow.innerHTML = '';
    this.groups.forEach((g) => {
      const b = document.createElement('button');
      b.className = 'group-chip' + (g === this.activeGroup ? ' active' : '');
      b.style.background = '#' + this.tintFor(g).toString(16).padStart(6, '0');
      b.textContent = g;
      b.onclick = () => { this.activeGroup = g; this.refreshChrome(); };
      groupRow.appendChild(b);
    });
    const add = document.createElement('button');
    add.className = 'group-chip new';
    add.textContent = '+ group';
    add.onclick = () => {
      this.groupSeq++;
      const g = `g${this.groupSeq}`;
      this.groups.push(g);
      this.activeGroup = g;
      this.refreshChrome();
    };
    groupRow.appendChild(add);

    bar.querySelector('.dim-cols')!.textContent = String(this.cols);
    bar.querySelector('.dim-rows')!.textContent = String(this.rows);

    const qc = bar.querySelector<HTMLElement>('.queue-panel')!;
    const q = this.queues[this.selectedQueue];
    qc.style.display = q ? 'flex' : 'none';
    if (q) {
      bar.querySelector('.dog-n')!.textContent = String(q.count);
      bar.querySelector('.queue-where')!.textContent =
        `Queue (${colOf(this.cols, q.cell)}, ${rowOf(this.cols, q.cell)}) facing ${q.dir}`;
    }

    const list = bar.querySelector<HTMLUListElement>('.warn-list')!;
    list.innerHTML = '';
    for (const w of this.warnings()) {
      const li = document.createElement('li');
      li.textContent = w;
      list.appendChild(li);
    }
  }

  private flash(message: string) {
    const bar = this.chrome;
    if (!bar) return;
    const hint = bar.querySelector<HTMLElement>('.tool-hint')!;
    hint.textContent = message;
    hint.classList.add('flash');
    setTimeout(() => hint.classList.remove('flash'), 900);
  }

  private async saveDraft(btn: HTMLButtonElement) {
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try { await this.opts.store.save(this.snapshot()); btn.textContent = 'Saved ✓'; }
    catch (err) { btn.textContent = 'Save failed'; console.error(err); }
    finally { this.saveResetTimer = setTimeout(() => { btn.disabled = false; btn.textContent = 'Save draft'; }, 1200); }
  }

  /**
   * Until this prototype has a Supabase project, publishing means committing the
   * level JSON to the repo. The modal hands over the exact file to drop in.
   */
  private showPublish() {
    this.modal?.remove();
    const level = this.snapshot();
    const json = JSON.stringify(level, null, 2);
    const file = `${slug(this.name)}.json`;

    const el = document.createElement('div');
    el.className = 'modal overlay';
    el.innerHTML = `
      <div class="modal-card">
        <h2>Publish level</h2>
        <p>Save this as <code>src/levels/published/${file}</code> and commit it. It ships to everyone on the next deploy.</p>
        <textarea readonly></textarea>
        <div class="modal-actions">
          <button class="btn small" data-act="copy">Copy JSON</button>
          <button class="btn small" data-act="download">Download</button>
          <button class="btn ghost small" data-act="close">Close</button>
        </div>
      </div>`;
    el.querySelector('textarea')!.value = json;

    el.querySelector('[data-act="copy"]')!.addEventListener('click', (ev) => {
      const btn = ev.target as HTMLButtonElement;
      void navigator.clipboard.writeText(json).then(
        () => { btn.textContent = 'Copied ✓'; },
        () => { btn.textContent = 'Copy failed'; },
      );
    });
    el.querySelector('[data-act="download"]')!.addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = file;
      a.click();
      URL.revokeObjectURL(url);
    });
    el.querySelector('[data-act="close"]')!.addEventListener('click', () => { el.remove(); this.modal = undefined; });

    this.parent.appendChild(el);
    this.modal = el;
  }

  dispose() {
    this.app.stage.off('pointerdown', this.onDown);
    this.app.stage.off('globalpointermove', this.onMove);
    this.app.stage.off('pointerup', this.onUp);
    this.app.stage.off('pointerupoutside', this.onUp);
    this.resizeObserver?.disconnect();
    document.body.classList.remove('editor-mode');
    this.chrome?.remove();
    this.modal?.remove();
    this.host?.remove();
    if (this.saveResetTimer) clearTimeout(this.saveResetTimer);
    this.units.clear();
    this.queues = [];
    // destroys renderer, view canvas, and all stage children/graphics
    this.app.destroy({ removeView: true }, { children: true, texture: true });
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'level';
}
