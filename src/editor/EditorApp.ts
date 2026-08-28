import { Application, Container, Graphics, Rectangle } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import type { GameElement, LevelData } from '../shared/types';
import type { LevelLibrary } from '../levels/library';
import type { SourceId } from '../levels/sources/types';
import { blockElement, formatLevelJson } from '../levels/serialize';
import { ServerSource } from '../levels/sources/server';
import { SETTINGS } from '../game/settings';
import { DIRS, DIR_VEC, colOf, connectedComponents, idx, rowOf } from '../game/cells';
import { detachCell, dropShape, indexShapes, paintCell } from './shapes';
import type { Grid, Shape, ShapeList } from './shapes';
import type { Dir } from '../game/cells';
import { MAX_BONE_ORDER, MAX_DIM, MIN_DIM, SCHEMA_VERSION, parseLevel } from '../game/level';
import type { BoneStack } from '../game/level';
import { boundaryDirs } from '../game/board';
import { validateLevel } from '../game/validate';
import { cellAt, cellCenter, colRowCenter, computeEditorCamera, toCellDelta } from '../game/camera';
import type { Camera } from '../game/camera';
import { evaluatePlacement } from '../game/place';
import type { Placement, PlacementBoard } from '../game/place';
import { groupFill, groupTint } from '../render/color';
import type { GroupFill } from '../render/color';
import { LabelPool } from '../render/labels';
import {
  drawBee, drawBlockGroup, drawBone, drawBonePip, drawCell, drawDog,
  drawPlacementCell, drawSelectedCell, drawTierBadge, drawVacatedCell, drawWall,
} from '../render/draw';

export interface EditorOptions {
  library: LevelLibrary;
  /** Which source this level came from -- Save writes back to the same one. */
  source: SourceId;
  prototype: string;
  initial?: LevelData;
  onExit: () => void;
  onTest: (level: LevelData) => void;
}

type Tool = 'block' | 'move' | 'bone' | 'wall' | 'bee' | 'dead' | 'queue' | 'dog' | 'erase';

interface EditorQueue { cell: number; dir: Dir; count: number }

/** A block group picked up with the Move tool and not yet dropped. */
interface MoveDrag {
  shape: Shape;
  /** The shape's cells before the drag started. */
  cells: number[];
  /** Bone counts on those cells, so stacks travel with their units. */
  bones: Map<number, BoneStack>;
  originX: number;
  originY: number;
  dc: number;
  dr: number;
  placement: Placement;
}

const C = SETTINGS.colors;
const L = SETTINGS.layout;

/** Shape slots reachable from the keyboard. Beyond this, use the chips. */
const KEY_SHAPE_SLOTS = 9;

/** Most bones one unit may carry. Deep enough to be useful, shallow enough to read. */
const MAX_BONES_PER_UNIT = 9;

/** Dogs one queue may hold. Below the minimum a queue has no reason to exist. */
const MIN_QUEUE_DOGS = 1;
/** A new queue starts at one dog -- tap it again to add more. */
const NEW_QUEUE_DOGS = 1;
const MAX_QUEUE_DOGS = 20;

const TOOLS: Array<{ id: Tool; label: string; hint: string }> = [
  { id: 'block', label: 'Block', hint: 'Tap cells to grow the selected shape. A shape must stay one connected piece; breaking it splits it in two.' },
  { id: 'move', label: 'Move', hint: 'Drag a whole block group somewhere else. Red means it will not fit.' },
  { id: 'bone', label: 'Bone', hint: 'Tap a block for a bone that rides it, or bare ground for one on the grid. Tapping a bone of another tier moves it to the selected tier; tapping one already on it adds to the stack. Shift-tap takes one off.' },
  { id: 'wall', label: 'Wall', hint: 'Static, unmovable, blocks everything.' },
  { id: 'bee', label: 'Bee', hint: 'Fixed. Poisons every cell it can reach.' },
  { id: 'dead', label: 'Off', hint: 'Switch a cell off — it stops being part of the board. Walls and bees fence a region too.' },
  { id: 'queue', label: 'Queue', hint: 'Tap a boundary cell to add a queue. Tap it again for one more dog, shift-tap for one fewer. Turn and Remove are buttons.' },
  { id: 'dog', label: 'Dog', hint: 'Tap a cell to stand a dog on the board. It blocks like a wall until it eats.' },
  { id: 'erase', label: 'Erase', hint: 'Clear whatever is in the cell.' },
];

export class EditorApp {
  private app = new Application();
  private root = new Container();
  private gridG = new Graphics();
  private boardG = new Graphics();
  private overlayG = new Graphics();
  private boneLabels = new LabelPool({ fill: 0xffffff, fontSize: 13, fontFamily: 'system-ui, sans-serif', fontWeight: '700' });
  /** Tier digits sit on a filled square, so they are dark where counts are white. */
  private tierLabels = new LabelPool({ fill: C.tierBadgeText, fontSize: 13, fontFamily: 'system-ui, sans-serif', fontWeight: '700' });
  private queueLabels = new LabelPool({ fill: C.badgeText, fontSize: 11, fontFamily: 'system-ui, sans-serif' });

  private cols: number;
  private rows: number;
  private timeLimit: number;
  private name: string;
  private id: string;

  private dead = new Set<number>();
  private walls = new Set<number>();
  private bees = new Set<number>();
  /**
   * Every block group, plus the cell index over them. Identity is the object,
   * exactly as on the board -- see src/editor/shapes.ts for the editing rules.
   */
  private list: ShapeList = indexShapes([]);
  /** cell -> the bone stack on that cell. */
  private bones = new Map<number, BoneStack>();
  /** Cells holding a dog standing on the board. */
  private dogs = new Set<number>();
  private queues: EditorQueue[] = [];

  /** The shape the Block tool paints into. */
  private active: Shape | null = null;
  /** Tier new bones join. Named activeTier so it cannot be confused with
   *  board.ts's activeOrder(), which is the lowest tier still on a board. */
  private activeTier = 1;

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
    if (level) this.loadLevel(level);
  }

  static async create(parent: HTMLElement, opts: EditorOptions): Promise<EditorApp> {
    const e = new EditorApp(parent, opts);
    await e.init();
    return e;
  }

  /**
   * Loading goes through the game's own parser rather than a second reader of
   * the same format. Older editions arrive already split into connected
   * pieces, and whatever the editor shows is exactly what the game will play.
   */
  private loadLevel(level: LevelData) {
    const { spec } = parseLevel(level);
    this.cols = spec.cols;
    this.rows = spec.rows;
    this.timeLimit = spec.timeLimit;
    this.dead = new Set(spec.dead);
    this.walls = new Set(spec.walls);
    this.bees = new Set(spec.bees);
    this.dogs = new Set(spec.gridDogs);
    this.bones = new Map(
      [...spec.bones].map(([cell, stack]) => [
        cell,
        { count: Math.min(MAX_BONES_PER_UNIT, stack.count), order: stack.order },
      ]),
    );
    this.queues = spec.queues.map((q) => ({ cell: q.cell, dir: q.dir, count: q.count }));
    this.setShapes(spec.shapes.map((cells) => ({ cells: new Set(cells) })));
  }

  /** Install a new set of shapes and rebuild the cell index from them. */
  private setShapes(shapes: Shape[]) {
    this.list = indexShapes(shapes);
    this.active = shapes[0] ?? null;
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
    this.root.addChild(this.gridG, this.boardG, this.overlayG, this.boneLabels.view, this.tierLabels.view, this.queueLabels.view);
    this.app.stage.addChild(this.root);

    this.app.stage.eventMode = 'static';
    this.app.stage.on('pointerdown', this.onDown);
    this.app.stage.on('globalpointermove', this.onMove);
    this.app.stage.on('pointerup', this.onUp);
    this.app.stage.on('pointerupoutside', this.onUp);

    this.buildChrome();
    window.addEventListener('keydown', this.onKeyDown);
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
    this.apply(cell, e.shiftKey);
  };

  private onMove = (e: FederatedPointerEvent) => {
    if (this.moveDrag) { this.updateMove(e); return; }
    if (!this.painting) return;
    // The dog count would run away under a drag; keep the Queue tool to taps.
    if (this.tool === 'queue') return;
    const cell = this.cellUnder(e);
    if (cell === null || cell === this.lastPainted) return;
    this.apply(cell, e.shiftKey);
  };

  private onUp = () => {
    if (this.moveDrag) { this.endMove(); return; }
    this.painting = false;
    this.lastPainted = null;
  };

  /**
   * Desktop authoring: 1-8 pick a tool, Shift+1-9 pick a paint colour while the
   * Block tool is up. `code` rather than `key`, because Shift+1 reports "!" on
   * most layouts but always reports Digit1.
   */
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (this.modal) return;

    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (!digit) return;
    const n = Number(digit[1]);

    if (e.shiftKey) {
      if (this.tool === 'block') this.selectShapeSlot(n);
      else if (this.tool === 'bone') this.activeTier = Math.min(n, MAX_BONE_ORDER);
      else return;
    } else {
      const tool = TOOLS[n - 1];
      if (!tool) return;
      this.tool = tool.id;
    }

    e.preventDefault();
    this.redraw();
    this.refreshChrome();
  };

  /** Slot n of the shape list, adding empty shapes up to it on the way. */
  private selectShapeSlot(n: number) {
    const want = Math.min(n, KEY_SHAPE_SLOTS);
    while (this.shapes.length < want) this.shapes.push({ cells: new Set() });
    this.active = this.shapes[want - 1];
  }

  private cellUnder(e: FederatedPointerEvent): number | null {
    const p = this.app.stage.toLocal(e.global);
    return cellAt(this.cam, p.x, p.y);
  }

  private apply(cell: number, shift = false) {
    this.lastPainted = cell;
    switch (this.tool) {
      case 'block': this.applyBlock(cell); break;
      case 'bone': this.applyBone(cell, shift); break;
      case 'wall': this.toggleTerrain(this.walls, cell); break;
      case 'bee': this.toggleTerrain(this.bees, cell); break;
      case 'dead': this.toggleDead(cell); break;
      case 'queue': this.applyQueue(cell, shift); break;
      case 'dog': this.toggleDog(cell); break;
      case 'erase': this.eraseCell(cell); break;
    }
    this.redraw();
    this.refreshChrome();
  }

  // ------------------------------------------------------------------ move ---

  private beginMove(cell: number, e: FederatedPointerEvent) {
    const shape = this.owner.get(cell);
    if (!shape) { this.flash('Nothing to move here — grab a block.'); return; }

    const p = this.app.stage.toLocal(e.global);
    // The shape under the finger, whole. No hunting for a connected run: the
    // shape already knows which cells are its own.
    const cells = [...shape.cells].sort((a, b) => a - b);
    this.moveDrag = {
      shape, cells,
      bones: new Map(cells.filter((c) => this.bones.has(c)).map((c) => [c, { ...this.bones.get(c)! }])),
      originX: p.x, originY: p.y,
      dc: 0, dr: 0,
      placement: this.placementFor(cells, 0, 0),
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
    drag.placement = this.placementFor(drag.cells, dc, dr);
    this.redraw();
  }

  /** Commit the move if it fits; otherwise the group snaps back untouched. */
  private endMove() {
    const drag = this.moveDrag;
    this.moveDrag = null;
    if (!drag) return;

    if (drag.placement.ok && (drag.dc !== 0 || drag.dr !== 0)) {
      for (const cell of drag.cells) { this.owner.delete(cell); this.bones.delete(cell); }
      const next = new Set<number>();
      drag.cells.forEach((cell, i) => {
        const target = drag.placement.targets[i];
        next.add(target);
        this.owner.set(target, drag.shape);
        const carried = drag.bones.get(cell);
        if (carried !== undefined) this.bones.set(target, carried);
      });
      drag.shape.cells = next;
    } else if (!drag.placement.ok) {
      this.flash('That does not fit — the group went back.');
    }

    this.redraw();
    this.refreshChrome();
  }

  private placementBoard(): PlacementBoard {
    return {
      cols: this.cols,
      rows: this.rows,
      dead: this.dead,
      walls: this.walls,
      bees: this.bees,
      // Only bones with no block under them obstruct: a riding bone's cell is
      // already held by its unit, and travels with the group being dragged.
      bones: new Set([...this.bones.keys()].filter((c) => !this.owner.has(c))),
      dogs: this.dogs,
      units: this.owner,
    };
  }

  private placementFor(cells: number[], dc: number, dr: number): Placement {
    return evaluatePlacement(this.placementBoard(), cells, dc, dr);
  }

  private applyBlock(cell: number) {
    if (this.dead.has(cell)) { this.flash('That cell is switched off.'); return; }

    const shape = this.active ?? this.addShape();
    const result = paintCell(this.list, this.grid(), shape, cell);

    if (result.kind === 'refused') { this.flash(result.reason); return; }

    if (result.kind === 'removed') {
      // The block is gone, so the bone riding it has nothing left to sit on.
      this.bones.delete(cell);
      if (result.split === 0 && this.active === shape) this.active = this.shapes[0] ?? null;
    } else {
      // Stolen from another shape or painted onto bare ground -- either way the
      // cell still ends up carrying a block, so a bone on it survives.
      this.walls.delete(cell);
      this.bees.delete(cell);
      this.dogs.delete(cell);
    }
    if (result.split > 1) this.flash(`That split a shape into ${result.split}.`);
  }

  private get shapes(): Shape[] { return this.list.shapes; }
  private get owner() { return this.list.owner; }
  private grid(): Grid { return { cols: this.cols, rows: this.rows }; }

  private addShape(): Shape {
    const shape: Shape = { cells: new Set() };
    this.list.shapes.push(shape);
    this.active = shape;
    return shape;
  }

  /** Remove a shape and everything riding it. */
  private removeShape(shape: Shape) {
    for (const cell of dropShape(this.list, shape)) this.bones.delete(cell);
    if (this.active === shape) this.active = this.shapes[0] ?? null;
  }

  private toggleDog(cell: number) {
    if (this.dead.has(cell)) return;
    if (this.dogs.has(cell)) { this.dogs.delete(cell); return; }
    this.clearCell(cell);
    this.dogs.add(cell);
  }

  private applyBone(cell: number, remove: boolean) {
    const have = this.bones.get(cell);

    if (remove) {
      if (!have || have.count <= 1) this.bones.delete(cell);
      else have.count -= 1;
      return;
    }

    if (have) {
      // A tap on a bone of another tier moves it to the selected tier. It does
      // not also add a bone: retiering and stacking are different intents, and
      // the tier chips are for the first one.
      if (have.order !== this.activeTier) {
        have.order = this.activeTier;
        return;
      }
      if (have.count >= MAX_BONES_PER_UNIT) { this.flash(`One cell carries at most ${MAX_BONES_PER_UNIT} bones.`); return; }
      have.count += 1;
      return;
    }

    // A bone rides a block when there is one under it, and sits on the grid
    // when there is not. Anything else in the cell has to go first.
    if (this.dead.has(cell)) { this.flash('That cell is switched off.'); return; }
    if (this.walls.has(cell) || this.bees.has(cell) || this.dogs.has(cell)) {
      this.flash('Clear the cell first — a bone needs a block or bare ground.');
      return;
    }
    this.bones.set(cell, { count: 1, order: this.activeTier });
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

  private applyQueue(cell: number, shift = false) {
    const at = this.queues.findIndex((q) => q.cell === cell);
    const valid = boundaryDirs({ cols: this.cols, rows: this.rows, dead: this.dead }, cell);

    if (at >= 0) {
      // First tap selects it -- that is what exposes the dog stepper. After
      // that, tap adds a dog and shift-tap takes one away, the same gesture the
      // Bone tool uses for a stack. Turning is the Turn button, and removing is
      // the Remove button, so a stray tap can never destroy a queue you were
      // only trying to edit.
      if (this.selectedQueue !== at) { this.selectedQueue = at; return; }

      const q = this.queues[at];
      if (shift) {
        if (q.count <= MIN_QUEUE_DOGS) { this.flash('A queue holds at least one dog — use Remove to delete it.'); return; }
        q.count -= 1;
        return;
      }
      if (q.count >= MAX_QUEUE_DOGS) { this.flash(`One queue holds at most ${MAX_QUEUE_DOGS} dogs.`); return; }
      q.count += 1;
      return;
    }

    if (!valid.length) { this.flash('A queue needs a side that is off-grid or switched off.'); return; }
    if (this.dead.has(cell)) { this.flash('That cell is switched off.'); return; }
    this.queues.push({ cell, dir: valid[0], count: NEW_QUEUE_DOGS });
    this.selectedQueue = this.queues.length - 1;
  }

  private eraseCell(cell: number) {
    this.clearCell(cell);
    this.dead.delete(cell);
    this.queues = this.queues.filter((q) => q.cell !== cell);
    this.selectedQueue = -1;
  }

  private clearCell(cell: number) {
    const shape = this.owner.get(cell);
    if (shape) {
      const split = detachCell(this.list, this.grid(), shape, cell);
      if (split === 0 && this.active === shape) this.active = this.shapes[0] ?? null;
      if (split > 1) this.flash(`That split a shape into ${split}.`);
    }
    this.bones.delete(cell);
    this.dogs.delete(cell);
    this.walls.delete(cell);
    this.bees.delete(cell);
  }

  // --------------------------------------------------------------- render ---

  private redraw() {
    this.boneLabels.begin();
    this.tierLabels.begin();
    this.queueLabels.begin();
    this.gridG.clear();
    for (let i = 0; i < this.cols * this.rows; i++) drawCell(this.gridG, this.cam, i, this.dead.has(i));

    this.boardG.clear();
    for (const cell of this.walls) drawWall(this.boardG, this.cam, cell);

    const dragging = this.moveDrag;
    this.shapes.forEach((shape, i) => {
      if (dragging && shape === dragging.shape) return;   // drawn as a ghost below
      if (!shape.cells.size) return;
      drawBlockGroup(this.boardG, this.cam, shape.cells, this.tintFor(i), this.fillFor(i));
    });
    // Which shape the Block tool would paint into. Nothing else in the editor
    // needs to say it, and it is the one thing a tap depends on.
    if (this.tool === 'block' && this.active && !dragging) {
      for (const cell of this.active.cells) drawSelectedCell(this.boardG, this.cam, cell);
    }
    // While the Bone tool is up, every bone shows its tier even on a
    // single-tier level -- otherwise there is no way to see what you are about
    // to retier. The game still hides badges until a level uses more than one.
    const tiered = this.tiered() || this.tool === 'bone';
    for (const [cell, stack] of this.bones) {
      if (dragging && dragging.cells.includes(cell)) continue;
      const p = cellCenter(this.cam, cell);
      this.paintBone(p.x, p.y, stack.count, tiered ? stack.order : 0);
    }
    for (const cell of this.bees) {
      const p = cellCenter(this.cam, cell);
      drawBee(this.boardG, p.x, p.y, this.cam.cell);
    }
    for (const cell of this.dogs) {
      const p = cellCenter(this.cam, cell);
      drawDog(this.boardG, p.x, p.y, this.cam.cell * L.queueDogScale);
    }

    if (dragging) this.drawMoveGhost(dragging);
    this.drawQueues();
    this.boneLabels.end();
    this.tierLabels.end();
    this.queueLabels.end();
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
      drawBlockGroup(this.boardG, this.cam, landing, this.tintFor(this.indexOf(drag.shape)), this.fillFor(this.indexOf(drag.shape)));
      for (let i = 0; i < drag.cells.length; i++) {
        const target = placement.targets[i];
        const carried = drag.bones.get(drag.cells[i]);
        if (target < 0 || carried === undefined) continue;
        const p = cellCenter(this.cam, target);
        this.paintBone(p.x, p.y, carried.count, this.tiered() ? carried.order : 0);
      }
    }
  }

  /** A bone, plus its count when the unit carries a stack. */
  /** True when the level uses more than one tier -- badges stay off until then. */
  private tiered(): boolean {
    return new Set([...this.bones.values()].map((s) => s.order)).size > 1;
  }

  private paintBone(x: number, y: number, count: number, order = 0) {
    drawBone(this.boardG, x, y, this.cam.cell);
    const r = this.cam.cell * 0.21;
    if (count > 1) {
      const px = x + this.cam.cell * 0.29;
      const py = y + this.cam.cell * 0.29;
      drawBonePip(this.boardG, px, py, r);
      this.boneLabels.add(px, py, String(count), r / 9);
    }
    if (order > 0) {
      const px = x - this.cam.cell * 0.29;
      const py = y - this.cam.cell * 0.29;
      drawTierBadge(this.boardG, px, py, r, false);
      this.tierLabels.add(px, py, String(order), r / 9);
    }
  }

  private drawQueues() {
    this.overlayG.clear();
    const labelScale = Math.max(0.55, Math.min(1.3, this.cam.cell / 46));

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

      const off = this.cam.cell * 0.62;
      this.queueLabels.add(
        at.x + (dr !== 0 ? off : 0),
        at.y + (dc !== 0 ? -off : 0),
        `x${q.count}`,
        labelScale,
      );
    });
  }

  /**
   * Shapes are tinted while authoring so two flush-but-separate shapes are
   * obviously separate -- the game paints them all one colour, so this is the
   * only place the distinction is visible. Hue comes first; once the palette
   * wraps, `fillFor` hatches the tiles so a thirtieth shape is still its own.
   */
  private tintFor(index: number): number {
    return groupTint(Math.max(0, index), SETTINGS.editor.groupTints);
  }

  private fillFor(index: number): GroupFill {
    return groupFill(Math.max(0, index), SETTINGS.editor.groupTints);
  }

  private indexOf(shape: Shape): number {
    return this.shapes.indexOf(shape);
  }

  // ------------------------------------------------------------ level i/o ---

  private snapshot(): LevelData {
    const elements: GameElement[] = [];
    const push = (type: string, cell: number, extra: Record<string, unknown> = {}) =>
      elements.push({ type, x: colOf(this.cols, cell), y: rowOf(this.cols, cell), ...extra });

    for (const cell of this.dead) push('dead', cell);
    for (const cell of this.walls) push('wall', cell);
    for (const cell of this.bees) push('bee', cell);
    // One element per shape. An empty slot in the list is a place to paint
    // into, not a level element, so it is not written.
    for (const shape of this.shapes) {
      if (!shape.cells.size) continue;
      elements.push(blockElement(this.cols, shape.cells));
    }
    for (const [cell, stack] of this.bones) {
      // A bone rides a block when one is under it, and sits on the grid when not.
      push(this.owner.has(cell) ? 'bone' : 'gridBone', cell, { count: stack.count, order: stack.order });
    }
    for (const cell of this.dogs) push('gridDog', cell);
    for (const q of this.queues) push('queue', q.cell, { dir: q.dir, count: q.count });

    return {
      id: this.id,
      name: this.name,
      prototype: this.opts.prototype,
      elements,
      meta: { schema: SCHEMA_VERSION, cols: this.cols, rows: this.rows, timeLimit: this.timeLimit },
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

    const nextBones = new Map(remap(this.bones));
    // A shape can lose cells to a shrinking grid, and what is left may be in
    // pieces -- the same split the Block tool does, applied to every shape.
    const nextShapes: Shape[] = [];
    for (const shape of this.shapes) {
      const kept = new Set(remap([...shape.cells].map((c) => [c, true] as [number, boolean])).map(([c]) => c));
      if (!kept.size) continue;
      for (const part of connectedComponents(cols, rows, kept)) nextShapes.push({ cells: part });
    }
    this.walls = keys(this.walls);
    this.bees = keys(this.bees);
    this.dead = keys(this.dead);
    this.dogs = keys(this.dogs);
    this.queues = this.queues
      .filter((q) => colOf(this.cols, q.cell) < cols && rowOf(this.cols, q.cell) < rows)
      .map((q) => ({ ...q, cell: idx(cols, colOf(this.cols, q.cell), rowOf(this.cols, q.cell)) }));
    this.bones = nextBones;

    this.cols = cols;
    this.rows = rows;
    this.setShapes(nextShapes);
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
        <p class="key-hint">1\u20139 pick a tool \u00b7 \u21e7 1\u20139 pick a shape or bone tier</p>
        <div class="group-row"></div>
        <div class="tier-row group-row"></div>
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
            <span class="stepper"><button data-act="dog-">−</button><b class="dog-n">1</b><button data-act="dog+">+</button></span>
          </label>
          <button class="btn ghost small" data-act="queue-turn">Turn</button>
          <button class="btn ghost small" data-act="queue-del">Remove</button>
        </div>
        <ul class="warn-list"></ul>
      </div>
      <div class="editor-actions">
        <button class="btn ghost small" data-act="clear">Clear</button>
        <button class="btn small" data-act="test">▶ Test</button>
        <button class="btn small" data-act="save">Save</button>
        <button class="btn small" data-act="publish">Publish</button>
        <button class="btn ghost small" data-act="exit">← Menu</button>
      </div>`;

    const tools = bar.querySelector('.tool-row')!;
    TOOLS.forEach((t, i) => {
      const b = document.createElement('button');
      b.className = 'tool-btn';
      b.dataset.tool = t.id;
      b.textContent = t.label;
      if (i < 9) {
        const key = document.createElement('i');
        key.className = 'key';
        key.textContent = String(i + 1);
        b.appendChild(key);
      }
      b.onclick = () => { this.tool = t.id; this.refreshChrome(); this.redraw(); };
      tools.appendChild(b);
    });

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
    bar.querySelector('[data-act="save"]')!.addEventListener('click', (ev) => void this.saveHere(ev.target as HTMLButtonElement));

    this.host?.appendChild(bar);
    this.chrome = bar;
    this.refreshChrome();
  }

  private bumpQueue(d: number) {
    const q = this.queues[this.selectedQueue];
    if (!q) return;
    q.count = clamp(q.count + d, MIN_QUEUE_DOGS, MAX_QUEUE_DOGS);
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
    this.dead.clear(); this.walls.clear(); this.bees.clear(); this.dogs.clear();
    this.bones.clear();
    this.queues = [];
    this.setShapes([]);
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

    // The shape list. One row per block group, in the order they serialise,
    // each carrying the swatch it is drawn with so the list and the board can
    // never disagree about which shape is which.
    const shapeRow = bar.querySelector<HTMLElement>('.group-row')!;
    shapeRow.style.display = this.tool === 'block' ? 'flex' : 'none';
    shapeRow.innerHTML = '';
    this.shapes.forEach((shape, i) => {
      const b = document.createElement('button');
      const fill = this.fillFor(i);
      b.className = `group-chip fill-${fill}` + (shape === this.active ? ' active' : '');
      // backgroundColor, not background: the hatch patterns are background
      // images in the stylesheet and the shorthand would wipe them out.
      b.style.backgroundColor = '#' + this.tintFor(i).toString(16).padStart(6, '0');
      b.textContent = `${i + 1}`;

      const n = document.createElement('i');
      n.className = 'chip-count';
      n.textContent = shape.cells.size ? `\u00d7${shape.cells.size}` : 'empty';
      b.appendChild(n);

      if (i < KEY_SHAPE_SLOTS) {
        const key = document.createElement('i');
        key.className = 'key';
        key.textContent = `\u21e7${i + 1}`;
        b.appendChild(key);
      }

      const del = document.createElement('i');
      del.className = 'chip-del';
      del.textContent = '\u00d7';
      del.title = 'Delete this shape';
      del.onclick = (ev) => {
        ev.stopPropagation();
        this.removeShape(shape);
        this.redraw();
        this.refreshChrome();
      };
      b.appendChild(del);

      b.onclick = () => { this.active = shape; this.redraw(); this.refreshChrome(); };
      shapeRow.appendChild(b);
    });
    const add = document.createElement('button');
    add.className = 'group-chip new';
    add.textContent = '+ shape';
    add.onclick = () => { this.addShape(); this.redraw(); this.refreshChrome(); };
    shapeRow.appendChild(add);

    // Tier chips mirror the colour chips: same class, same Shift+N gesture.
    const tierRow = bar.querySelector<HTMLElement>('.tier-row')!;
    tierRow.style.display = this.tool === 'bone' ? 'flex' : 'none';
    tierRow.innerHTML = '';
    const used = Math.max(1, ...[...this.bones.values()].map((s) => s.order), this.activeTier);
    for (let n = 1; n <= Math.min(MAX_BONE_ORDER, used + 1); n++) {
      const b = document.createElement('button');
      b.className = 'group-chip tier-chip' + (n === this.activeTier ? ' active' : '');
      b.textContent = `tier ${n}`;
      const key = document.createElement('i');
      key.className = 'key';
      key.textContent = `\u21e7${n}`;
      b.appendChild(key);
      b.onclick = () => { this.activeTier = n; this.refreshChrome(); };
      tierRow.appendChild(b);
    }

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

  /** Writes back to the source this level was opened from -- never moves it. */
  private async saveHere(btn: HTMLButtonElement) {
    const source = this.opts.library.get(this.opts.source);
    const label = source?.label ?? 'level';
    if (!source?.save) {
      btn.textContent = `${label} is read-only`;
      this.saveResetTimer = setTimeout(() => { btn.textContent = `Save to ${label}`; }, 1800);
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try { await source.save(this.snapshot()); btn.textContent = 'Saved ✓'; }
    catch (err) { btn.textContent = 'Save failed'; console.error(err); }
    finally { this.saveResetTimer = setTimeout(() => { btn.disabled = false; btn.textContent = `Save to ${label}`; }, 1400); }
  }

  /**
   * Publishing shares a level with everyone. With a shared backend configured
   * that is an upload; without one it means committing the JSON to the repo,
   * and the modal hands over the exact file to drop in. Either way it is a
   * deliberate second step -- Save keeps a level private.
   */
  private showPublish() {
    this.modal?.remove();
    const level = this.snapshot();
    const json = formatLevelJson(level);
    const file = `${slug(this.name)}.json`;
    const server = this.opts.library.get('server');
    const live = server instanceof ServerSource && server.available;

    const el = document.createElement('div');
    el.className = 'modal overlay';
    el.innerHTML = `
      <div class="modal-card">
        <h2>Publish level</h2>
        <p class="publish-note"></p>
        ${live ? '<div class="modal-actions"><button class="btn" data-act="upload">Publish to everyone</button></div>' : ''}
        <details ${live ? '' : 'open'}>
          <summary>Level JSON</summary>
          <textarea readonly></textarea>
        </details>
        <div class="modal-actions">
          <button class="btn small" data-act="copy">Copy JSON</button>
          <button class="btn small" data-act="download">Download</button>
          <button class="btn ghost small" data-act="close">Close</button>
        </div>
      </div>`;
    el.querySelector('.publish-note')!.textContent = live
      ? 'This goes live for everyone on their next load, in the Server tab. You can also keep a copy in the repo.'
      : `Save this as src/levels/published/${file} and commit it. It ships to everyone on the next deploy.`;
    el.querySelector('textarea')!.value = json;

    el.querySelector('[data-act="upload"]')?.addEventListener('click', (ev) => {
      const btn = ev.target as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = 'Publishing…';
      void (server as ServerSource).publish(level).then(
        () => { btn.textContent = 'Published ✓'; },
        (err: unknown) => { btn.disabled = false; btn.textContent = 'Publish failed'; console.error(err); },
      );
    });

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
    window.removeEventListener('keydown', this.onKeyDown);
    this.resizeObserver?.disconnect();
    document.body.classList.remove('editor-mode');
    this.chrome?.remove();
    this.modal?.remove();
    this.host?.remove();
    if (this.saveResetTimer) clearTimeout(this.saveResetTimer);
    this.list = indexShapes([]);
    this.queues = [];
    this.boneLabels.destroy();
    this.tierLabels.destroy();
    this.queueLabels.destroy();
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
