# Grid Bones, Grid Dogs and Bone Order — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bones that sit on grid cells, dogs that stand on the board, and numbered bone tiers that unlock in sequence — as one schema revision that leaves every existing level playing exactly as it does today.

**Architecture:** Bones move out of `Unit` into a single board-wide `Map<number, BoneStack>`, because tier activation is a minimum over *every* bone and two collections would be two places to forget. `RuntimeQueue` generalizes into a `DogSource` union so a grid dog and a queue leader walk the same code path. `isBlocked` gains two terms, which is what makes grid bones and grid dogs stop block groups, dog routes and bee flood consistently.

**Tech Stack:** TypeScript (strict), Vite, PixiJS v8, Vitest. Rules live in `src/game/*.ts` as pure TypeScript with no Pixi import — keep it that way.

**Spec:** `docs/superpowers/specs/2026-08-27-grid-bones-dogs-and-bone-order-design.md`

## Global Constraints

- `src/game/*.ts` (except `GameApp.ts`) must stay free of Pixi imports. Rules are pure and headless-testable.
- `SCHEMA_VERSION` in `src/game/level.ts` ends this plan at **2**. It is bumped once, in Task 3.
- A schema-1 level must parse to a spec that plays identically to today. This is pinned by a test in Task 3, not by argument.
- `order` defaults to **1** everywhere it is absent. `count` defaults to **1**. Neither ever parses below 1.
- Maximum 9 bones per cell (`MAX_BONES_PER_UNIT`, already in `EditorApp.ts`) and maximum tier 9 (`MAX_BONE_ORDER`, new in `level.ts`).
- Element type names are exactly `gridBone` and `gridDog`. Field name is exactly `order`.
- Warnings from `validateLevel` never block a save.
- Run `npx tsc --noEmit` after any change that moves a type. The compiler is how you find the call sites this plan does not list.
- Commit after every task. `npm test` green before each commit.

---

### Task 1: One bone map

Bones stop being a field on `Unit` and become a board-wide map. Pure refactor —
no behaviour changes, no format changes. Every existing test must still pass,
some with mechanical edits.

**Files:**
- Modify: `src/game/level.ts` (`BlockUnit`, `LevelSpec`, `parseLevel`, `countBones`)
- Modify: `src/game/board.ts` (`Unit`, `BoardState`, `createBoard`, `bonesRemaining`, new `takeBone`)
- Modify: `src/game/slide.ts` (`stepGroup` moves bone entries)
- Modify: `src/game/pathing.ts` (`free`, `adjacentBone`, `findRoute`)
- Modify: `src/game/resolve.ts` (`finishWalker`)
- Modify: `src/game/validate.ts` (island bone count)
- Modify: `src/game/GameApp.ts` (`drawBoard`)
- Modify: `src/editor/EditorApp.ts` (`bones` map value type)
- Modify: `tests/helpers.ts` (`toAscii`)
- Modify: `tests/softlock/analyze.ts` (`cloneState`, `key`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface BoneStack { count: number; order: number }` exported from `src/game/level.ts`
  - `LevelSpec.bones: Map<number, BoneStack>`; `BlockUnit` no longer has `bones`
  - `BoardState.bones: Map<number, BoneStack>`; `Unit` no longer has `bones`
  - `takeBone(state: BoardState, cell: number): { bonesLeft: number; destroyed: boolean; groups: string[] }` in `src/game/board.ts`

- [ ] **Step 1: Write the failing test for the bone map**

Add to `tests/board.test.ts`:

```ts
import { bonesRemaining, createBoard, takeBone } from '../src/game/board';
import { specFromAscii } from './helpers';

describe('the bone map', () => {
  it('holds every bone by cell, off the unit', () => {
    const b = boardFromAscii(['aA..', '....']);
    expect(b.units.get(1)!.group).toBe('a');
    expect(b.bones.get(1)).toEqual({ count: 1, order: 1 });
    expect(b.bones.has(0)).toBe(false);
    expect(bonesRemaining(b)).toBe(1);
  });

  it('takeBone decrements a stack and leaves the unit standing', () => {
    const b = boardFromAscii(['aA..', '....']);
    b.bones.set(1, { count: 3, order: 1 });
    expect(takeBone(b, 1)).toEqual({ bonesLeft: 2, destroyed: false, groups: ['a'] });
    expect(b.units.has(1)).toBe(true);
  });

  it('takeBone removes the host unit with the last bone', () => {
    const b = boardFromAscii(['aA..', '....']);
    expect(takeBone(b, 1)).toEqual({ bonesLeft: 0, destroyed: true, groups: [] });
    expect(b.units.has(1)).toBe(false);
    expect(b.bones.has(1)).toBe(false);
  });

  it('takeBone reports the groups a split left behind', () => {
    // a bridge unit at cell 1 holding two lumps together
    const b = boardFromAscii(['aAa.', '....']);
    const out = takeBone(b, 1);
    expect(out.destroyed).toBe(true);
    expect(out.groups).toHaveLength(2);
  });

  it('takeBone on a bone with no unit under it just clears the cell', () => {
    const b = boardFromAscii(['....', '....']);
    b.bones.set(1, { count: 1, order: 1 });
    expect(takeBone(b, 1)).toEqual({ bonesLeft: 0, destroyed: false, groups: [] });
    expect(b.bones.has(1)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/board.test.ts -t "the bone map"`
Expected: FAIL — `b.bones` is undefined, `takeBone` is not exported.

- [ ] **Step 3: Move bones off `BlockUnit` in `src/game/level.ts`**

Replace the `BlockUnit` interface and add `BoneStack`:

```ts
/** A stack of bones on one cell. Every bone in the stack shares a tier. */
export interface BoneStack {
  count: number;
  /** Activation tier. Tier N is edible once every lower tier is eaten. */
  order: number;
}

export interface BlockUnit {
  cell: number;
  group: string;
  /** Dormant in v1 -- reserved for colour-matched dogs and bones. */
  colorKey?: string;
}
```

Add `bones` to `LevelSpec` (leave everything else as it is):

```ts
export interface LevelSpec {
  schema: number;
  cols: number;
  rows: number;
  timeLimit: number;
  dead: Set<number>;
  walls: Set<number>;
  bees: Set<number>;
  units: BlockUnit[];
  /** Every bone on the board, riding a block or sitting on the grid. */
  bones: Map<number, BoneStack>;
  queues: QueueSpec[];
}
```

- [ ] **Step 4: Build the map in `parseLevel`**

In `parseLevel`, seed `bones: new Map()` in the `spec` literal and drop `unitAt`.
Replace the bone-collection block and the bone-attachment loop.

The local accumulator stays, because bone elements may repeat on a cell:

```ts
  const bones: Array<{ cell: number; count: number }> = [];
```

The `block` case loses its bone bookkeeping:

```ts
      case 'block': {
        const group = typeof el.group === 'string' && el.group ? el.group : `g-${cell}`;
        const unit: BlockUnit = { cell, group };
        if (typeof el.colorKey === 'string') unit.colorKey = el.colorKey;
        spec.units.push(unit);
        occupant.set(cell, 'block');
        break;
      }
```

And the attachment loop at the end becomes an accumulation into the map. A bone
still needs a block under it — grid bones arrive in Task 4, not here:

```ts
  // Bones ride block units. A bone with no host is not representable yet --
  // free-standing bones arrive as their own element type.
  const blockCells = new Set(spec.units.map((u) => u.cell));
  for (const { cell, count } of bones) {
    if (!blockCells.has(cell)) {
      issues.push(`bone at cell ${cell} dropped -- no block unit to ride`);
      continue;
    }
    const have = spec.bones.get(cell);
    if (have) have.count += count;
    else spec.bones.set(cell, { count, order: 1 });
  }
```

And `countBones`:

```ts
/** Total bones on the board, counting a stacked cell once per bone. */
export function countBones(spec: LevelSpec): number {
  let n = 0;
  for (const stack of spec.bones.values()) n += stack.count;
  return n;
}
```

- [ ] **Step 5: Move bones onto `BoardState` in `src/game/board.ts`**

`Unit` loses `bones`; `BoardState` gains the map. Import `BoneStack`:

```ts
import type { BoneStack, LevelSpec } from './level';

export interface Unit {
  group: string;
  colorKey?: string;
}
```

Add to `BoardState`, directly under `units`:

```ts
  /** Every bone by cell, riding a block or sitting on the grid. */
  bones: Map<number, BoneStack>;
```

In `createBoard`, drop `bones` from the `Unit` literal and copy the map:

```ts
  for (const u of spec.units) {
    const unit: Unit = { group: u.group };
    if (u.colorKey !== undefined) unit.colorKey = u.colorKey;
    units.set(u.cell, unit);
    let set = authored.get(u.group);
    if (!set) { set = new Set(); authored.set(u.group, set); }
    set.add(u.cell);
  }
```

and in the returned object, beside `units`:

```ts
    bones: new Map([...spec.bones].map(([cell, s]) => [cell, { ...s }])),
```

- [ ] **Step 6: Add `takeBone` and rewrite `bonesRemaining` in `src/game/board.ts`**

```ts
/**
 * Take one bone off a cell. The single place a bone can disappear, which is
 * what keeps `activeOrder` honest. When the stack empties, the block unit
 * underneath -- if there is one -- goes with it and its group re-splits.
 */
export function takeBone(
  state: BoardState,
  cell: number,
): { bonesLeft: number; destroyed: boolean; groups: string[] } {
  const stack = state.bones.get(cell);
  if (!stack) return { bonesLeft: 0, destroyed: false, groups: [] };

  const group = state.units.get(cell)?.group;

  stack.count -= 1;
  if (stack.count > 0) {
    return { bonesLeft: stack.count, destroyed: false, groups: group ? [group] : [] };
  }

  state.bones.delete(cell);
  if (group === undefined) return { bonesLeft: 0, destroyed: false, groups: [] };

  // The host goes with its last bone -- and if it was the one thing holding its
  // group together, `removeUnit` reports the groups it fell apart into.
  return { bonesLeft: 0, destroyed: true, groups: removeUnit(state, cell) };
}

export function bonesRemaining(state: BoardState): number {
  let n = 0;
  for (const stack of state.bones.values()) n += stack.count;
  return n;
}
```

`takeBone` must be declared after `removeUnit` or hoisted — both are function
declarations, so order does not matter.

- [ ] **Step 7: Run the new tests**

Run: `npx vitest run tests/board.test.ts -t "the bone map"`
Expected: PASS. Other suites are still red — that is Step 8.

- [ ] **Step 8: Follow the compiler through every remaining `.bones` site**

Run: `npx tsc --noEmit`

Fix each reported site. The substantive ones, in full:

`src/game/pathing.ts` — `free` and `adjacentBone` read the map:

```ts
function free(state: BoardState, cell: number, claimed: BoneClaims): number {
  const stack = state.bones.get(cell);
  if (!stack) return 0;
  return stack.count - (claimed.get(cell) ?? 0);
}

/** First unspoken-for bone orthogonally touching `cell`, scanned in DIRS order. */
function adjacentBone(state: BoardState, cell: number, claimed: BoneClaims): number | null {
  const c = colOf(state.cols, cell);
  const r = rowOf(state.cols, cell);
  for (const d of DIRS) {
    const { dc, dr } = DIR_VEC[d];
    const nc = c + dc;
    const nr = r + dr;
    if (!inBounds(state.cols, state.rows, nc, nr)) continue;
    const n = idx(state.cols, nc, nr);
    if (free(state, n, claimed) > 0) return n;
  }
  return null;
}
```

and in `findRoute`, the entry-cell shortcut:

```ts
  // A bone parked on the entry cell is right under the leader's nose. It eats
  // from where it stands, without stepping onto the board -- an empty route.
  if (free(state, entry, claimedBones) > 0) return { path: [], boneCell: entry };
```

`src/game/resolve.ts` — `finishWalker` delegates to `takeBone`:

```ts
export function finishWalker(state: BoardState, walker: Walker): EatResult {
  state.walkers = state.walkers.filter((w) => w !== walker);
  syncReserved(state);

  const { bonesLeft, destroyed, groups } = takeBone(state, walker.boneCell);
  return { groups, boneCell: walker.boneCell, bonesLeft, destroyed };
}
```

Change the import at the top of the file from `removeUnit` to `takeBone` —
`removeUnit` now has exactly one caller, inside `takeBone`, which is what makes
`takeBone` the single place a bone can disappear.

`src/game/slide.ts` — `stepGroup` relocates bone entries with their units. This
is the one place the refactor costs something, so it is written out in full:

```ts
export function stepGroup(state: BoardState, group: string, dc: number, dr: number): boolean {
  if (!canStepGroup(state, group, dc, dr)) return false;

  const cells = state.groups.get(group)!;
  const moving = [...cells].map((cell) => ({
    cell,
    unit: state.units.get(cell)!,
    bones: state.bones.get(cell),
  }));

  // Clear the whole footprint first: a group may slide over its own cells, so
  // a cell-by-cell move would overwrite an entry it still needs.
  for (const { cell } of moving) {
    state.units.delete(cell);
    state.bones.delete(cell);
  }

  const next = new Set<number>();
  for (const { cell, unit, bones } of moving) {
    const target = idx(state.cols, colOf(state.cols, cell) + dc, rowOf(state.cols, cell) + dr);
    state.units.set(target, unit);
    if (bones) state.bones.set(target, bones);
    next.add(target);
  }
  state.groups.set(group, next);
  return true;
}
```

`src/game/validate.ts` — the island bone count reads the map:

```ts
      const islandBones = [...spec.bones]
        .reduce((n, [cell, stack]) => n + (cells.has(cell) ? stack.count : 0), 0);
```

`src/game/GameApp.ts` — `drawBoard` iterates bones, not units:

```ts
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
```

`src/editor/EditorApp.ts` — the editor's own `bones` map value becomes a stack.
Change the field, the `bone` case in `loadElements`, `applyBone`, the `MoveDrag`
bone type, and `snapshot`:

```ts
  /** cell -> the bone stack on that cell. */
  private bones = new Map<number, BoneStack>();
```

Add `BoneStack` to the existing `../game/level` import at the top of the file:

```ts
import { MAX_DIM, MIN_DIM, SCHEMA_VERSION, parseLevel } from '../game/level';
import type { BoneStack } from '../game/level';
```

```ts
        case 'bone': {
          const add = Math.max(1, Math.round(Number(el.count) || 1));
          const have = this.bones.get(cell);
          if (have) have.count = Math.min(MAX_BONES_PER_UNIT, have.count + add);
          else this.bones.set(cell, { count: Math.min(MAX_BONES_PER_UNIT, add), order: 1 });
          break;
        }
```

```ts
  private applyBone(cell: number, remove: boolean) {
    if (!this.units.has(cell)) { this.flash('Bones ride block units — put a block here first.'); return; }
    const have = this.bones.get(cell);

    if (remove) {
      if (!have || have.count <= 1) this.bones.delete(cell);
      else have.count -= 1;
      return;
    }
    if (!have) { this.bones.set(cell, { count: 1, order: 1 }); return; }
    if (have.count >= MAX_BONES_PER_UNIT) { this.flash(`One unit carries at most ${MAX_BONES_PER_UNIT} bones.`); return; }
    have.count += 1;
  }
```

`MoveDrag.bones` becomes `Map<number, BoneStack>`; `beginMove` clones the stacks
so a cancelled drag cannot mutate the board:

```ts
      bones: new Map(cells.filter((c) => this.bones.has(c)).map((c) => [c, { ...this.bones.get(c)! }])),
```

`snapshot` writes the count from the stack:

```ts
    for (const [cell, stack] of this.bones) push('bone', cell, { count: stack.count });
```

`paintBone` and `drawMoveGhost` take a count — pass `stack.count` at both call
sites in `redraw` and `drawMoveGhost`.

`tests/helpers.ts` — `toAscii` reads the map:

```ts
      const unit = state.units.get(i);
      if (unit) line += state.bones.has(i) ? unit.group.toUpperCase()[0] : unit.group[0];
```

`tests/softlock/analyze.ts` — `cloneState` copies the map and `key` reads it:

```ts
    units: new Map([...s.units].map(([c, u]) => [c, { ...u }])),
    bones: new Map([...s.bones].map(([c, b]) => [c, { ...b }])),
```

```ts
  const bones = [...s.bones]
    .map(([c, b]) => `${c}:${b.count}`)
    .sort()
    .join(',');
```

- [ ] **Step 9: Run the whole suite**

Run: `npm test`
Expected: PASS. Any failure here is a behaviour change, which this task must not
have — fix the code, not the test, unless the test asserted on `unit.bones`
directly, in which case rewrite the assertion against `state.bones`.

- [ ] **Step 10: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both clean.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "Move bones out of Unit into one board-wide map

Tier activation is a minimum over every bone, riding or free, so two
collections would be two places to forget. The cost lands in stepGroup,
which now relocates bone entries in lockstep with the units it moves."
```

---

### Task 2: Bone tiers

Bones gain an activation tier. A tier is edible once every lower tier is gone.
Still no format change — `order` is always 1 until Task 3 parses it.

**Files:**
- Modify: `src/game/board.ts` (new `activeOrder`)
- Modify: `src/game/pathing.ts` (`free` respects the active tier)
- Modify: `tests/helpers.ts` (`tiers` option)
- Test: `tests/pathing.test.ts`, `tests/board.test.ts`

**Interfaces:**
- Consumes: `BoneStack`, `BoardState.bones` (Task 1).
- Produces:
  - `activeOrder(state: BoardState): number | null` in `src/game/board.ts`
  - `boardFromAscii(rows, queues?, opts?)` where `opts` is `{ tiers?: string[] }`

- [ ] **Step 1: Add the `tiers` option to the ASCII helpers**

In `tests/helpers.ts`, add the option and thread it through. `levelFromAscii`
keeps its third parameter as `meta`, so existing callers are untouched; the
tiers grid is a fourth:

```ts
/**
 * A parallel grid of digits giving each bone's activation tier. `.` means the
 * default, tier 1. Written as its own grid so the board itself stays readable.
 */
export type TierRows = string[];

export function levelFromAscii(
  rows: string[],
  queues: QueueInput[] = [],
  meta: Record<string, unknown> = {},
  tiers?: TierRows,
): LevelData {
  const els = [...elementsFromAscii(rows)];
  if (tiers) {
    for (const el of els) {
      if (el.type !== 'bone') continue;
      const ch = tiers[el.y as number]?.[el.x as number];
      if (ch && ch !== '.') el.order = Number(ch);
    }
  }
  return {
    id: 'test',
    name: 'Test',
    prototype: 'dog-chase-bones',
    elements: [
      ...els,
      ...queues.map((q) => ({ type: 'queue', x: q.c, y: q.r, dir: q.dir, count: q.count ?? 1 })),
    ],
    meta: { cols: rows[0].length, rows: rows.length, ...meta },
  };
}

export function boardFromAscii(rows: string[], queues: QueueInput[] = [], tiers?: TierRows): BoardState {
  return createBoard(parseLevel(levelFromAscii(rows, queues, {}, tiers)).spec);
}

export function specFromAscii(rows: string[], queues: QueueInput[] = [], tiers?: TierRows) {
  return parseLevel(levelFromAscii(rows, queues, {}, tiers)).spec;
}
```

Note this writes `order` onto the element; `parseLevel` ignores it until Task 3.
So set tiers directly on `state.bones` in this task's tests, and switch those
tests to the `tiers` grid in Task 3.

- [ ] **Step 2: Write the failing tests**

Add to `tests/board.test.ts`:

```ts
import { activeOrder } from '../src/game/board';

describe('activeOrder', () => {
  it('is the lowest tier still on the board', () => {
    const b = boardFromAscii(['aA.B', '....']);
    b.bones.get(1)!.order = 2;
    b.bones.get(3)!.order = 5;
    expect(activeOrder(b)).toBe(2);
  });

  it('is null when every bone is gone', () => {
    const b = boardFromAscii(['a...', '....']);
    expect(activeOrder(b)).toBe(null);
  });
});
```

Add to `tests/pathing.test.ts`:

```ts
import { findRoute } from '../src/game/pathing';

describe('bone tiers', () => {
  const noClaims = new Map<number, number>();

  it('will not route to a locked tier even when it is adjacent', () => {
    const b = boardFromAscii(['.A..', '####'], [{ c: 0, r: 0, dir: 'up', count: 1 }]);
    b.bones.get(1)!.order = 2;
    b.bones.set(2, { count: 1, order: 1 });   // a tier-1 bone elsewhere keeps 2 locked
    b.units.set(2, { group: 'z' });
    b.groups.set('z', new Set([2]));
    expect(findRoute(b, b.queues[0], new Set(), noClaims)!.boneCell).toBe(2);
  });

  it('unlocks the next tier once the lower one is gone', () => {
    const b = boardFromAscii(['.A..', '####'], [{ c: 0, r: 0, dir: 'up', count: 1 }]);
    b.bones.get(1)!.order = 2;
    expect(findRoute(b, b.queues[0], new Set(), noClaims)!.boneCell).toBe(1);
  });
});
```

The second test is the important one: with only tier-2 bones left, tier 2 *is*
the active tier. A locked tier is locked relative to what remains, not to the
number 1.

- [ ] **Step 3: Run them and watch them fail**

Run: `npx vitest run tests/board.test.ts tests/pathing.test.ts -t "tier"`
Expected: FAIL — `activeOrder` is not exported; the first pathing test routes to
cell 1.

- [ ] **Step 4: Add `activeOrder` to `src/game/board.ts`**

```ts
/**
 * The lowest tier still on the board -- the only tier a dog may eat from.
 * Null when no bones remain, which is the state where the last walkers are
 * still finishing and there is nothing left to claim.
 *
 * A *claimed* bone still counts as remaining, so a tier unlocks when the last
 * lower-tier bone is eaten, not when the last one is spoken for.
 */
export function activeOrder(state: BoardState): number | null {
  let lowest: number | null = null;
  for (const stack of state.bones.values()) {
    if (stack.count <= 0) continue;
    if (lowest === null || stack.order < lowest) lowest = stack.order;
  }
  return lowest;
}
```

- [ ] **Step 5: Gate `free` on the active tier in `src/game/pathing.ts`**

`free` is the one gate every bone lookup already passes through, so the tier
check goes there and nothing else in pathing changes. It needs the active tier
passed in rather than recomputed per cell — `findRoute` is a BFS and would
otherwise recompute it thousands of times:

```ts
function free(state: BoardState, cell: number, claimed: BoneClaims, order: number | null): number {
  const stack = state.bones.get(cell);
  if (!stack) return 0;
  if (order === null || stack.order !== order) return 0;
  return stack.count - (claimed.get(cell) ?? 0);
}
```

Thread it through `adjacentBone`:

```ts
function adjacentBone(state: BoardState, cell: number, claimed: BoneClaims, order: number | null): number | null {
  const c = colOf(state.cols, cell);
  const r = rowOf(state.cols, cell);
  for (const d of DIRS) {
    const { dc, dr } = DIR_VEC[d];
    const nc = c + dc;
    const nr = r + dr;
    if (!inBounds(state.cols, state.rows, nc, nr)) continue;
    const n = idx(state.cols, nc, nr);
    if (free(state, n, claimed, order) > 0) return n;
  }
  return null;
}
```

and compute it once at the top of `findRoute`, importing `activeOrder` from
`./board`:

```ts
export function findRoute(
  state: BoardState,
  queue: RuntimeQueue,
  bees: Set<number>,
  claimedBones: BoneClaims,
): Route | null {
  const entry = queue.cell;
  const order = activeOrder(state);
  if (order === null) return null;

  if (free(state, entry, claimedBones, order) > 0) return { path: [], boneCell: entry };
  ...
```

Update the two remaining `adjacentBone(state, cur, claimedBones)` call sites to
pass `order`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/board.test.ts tests/pathing.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: PASS. Every existing bone is tier 1, so `activeOrder` is always 1 and
nothing changes.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Bone tiers: a tier unlocks when the last lower one is eaten

Gated in pathing's free(), the single point every bone lookup already
passes through. A claimed bone still counts as remaining, so a tier
cannot unlock mid-release while a dog is still walking to it."
```

---

### Task 3: Schema 2 — parse `order`

The tier becomes authorable. `SCHEMA_VERSION` goes to 2 here, and the
backward-compatibility test lands with it.

**Files:**
- Modify: `src/game/level.ts` (`SCHEMA_VERSION`, `MAX_BONE_ORDER`, bone parsing)
- Test: `tests/level.test.ts`

**Interfaces:**
- Consumes: `BoneStack`, `LevelSpec.bones` (Task 1); `activeOrder` (Task 2).
- Produces: `MAX_BONE_ORDER = 9` exported from `src/game/level.ts`; `bone`
  elements accept `order`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/level.test.ts`:

```ts
describe('bone order', () => {
  it('defaults to tier 1 when absent', () => {
    const { spec } = parseLevel(levelFromAscii(['aA..', '....']));
    expect(spec.bones.get(1)).toEqual({ count: 1, order: 1 });
  });

  it('reads an authored tier', () => {
    const { spec } = parseLevel(level(
      [{ type: 'block', x: 0, y: 0, group: 'a' }, { type: 'bone', x: 0, y: 0, order: 3 }],
      { cols: 4, rows: 2, schema: 2 },
    ));
    expect(spec.bones.get(0)).toEqual({ count: 1, order: 3 });
  });

  it('clamps a nonsense tier into range', () => {
    const { spec } = parseLevel(level(
      [{ type: 'block', x: 0, y: 0, group: 'a' }, { type: 'bone', x: 0, y: 0, order: 99 }],
      { cols: 4, rows: 2, schema: 2 },
    ));
    expect(spec.bones.get(0)!.order).toBe(9);
  });

  it('takes the first tier when a cell is given two', () => {
    const { spec } = parseLevel(level(
      [
        { type: 'block', x: 0, y: 0, group: 'a' },
        { type: 'bone', x: 0, y: 0, order: 2 },
        { type: 'bone', x: 0, y: 0, order: 5 },
      ],
      { cols: 4, rows: 2, schema: 2 },
    ));
    expect(spec.bones.get(0)).toEqual({ count: 2, order: 2 });
  });
});

describe('schema 1 levels', () => {
  it('parse clean and put every bone on tier 1', () => {
    const { spec, issues } = parseLevel(level(
      [
        { type: 'block', x: 0, y: 0, group: 'a' },
        { type: 'bone', x: 0, y: 0, count: 3 },
        { type: 'wall', x: 2, y: 0 },
        { type: 'queue', x: 3, y: 0, dir: 'up', count: 1 },
      ],
      { cols: 4, rows: 2, timeLimit: 60, schema: 1 },
    ));
    expect(issues).toEqual([]);
    expect(spec.schema).toBe(1);
    expect(spec.bones.get(0)).toEqual({ count: 3, order: 1 });
    expect(countBones(spec)).toBe(3);
    expect(countDogs(spec)).toBe(1);
  });

  it('parse the same with no schema field at all', () => {
    const { spec, issues } = parseLevel(level(
      [{ type: 'block', x: 0, y: 0, group: 'a' }, { type: 'bone', x: 0, y: 0 }],
      { cols: 4, rows: 2 },
    ));
    expect(issues).toEqual([]);
    expect(spec.bones.get(0)).toEqual({ count: 1, order: 1 });
  });
});
```

The "first tier wins" case is a deliberate rule, not an accident: one tier per
cell is the design, and repeated bone elements stack a count. Picking the first
makes the outcome deterministic regardless of element order in the file.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/level.test.ts -t "order"`
Expected: FAIL — `order` is ignored, so tier 3 comes back as 1.

- [ ] **Step 3: Bump the schema and add the tier cap in `src/game/level.ts`**

```ts
/**
 * Edition of the level format.
 *   1 -- initial: dead/wall/bee/block/bone/queue elements, meta cols/rows/timeLimit.
 *        Bones carry an optional `count`; absent means one.
 *   2 -- bones carry an optional `order` (activation tier, absent means 1);
 *        new `gridBone` and `gridDog` elements.
 */
export const SCHEMA_VERSION = 2;

/** Highest activation tier. Matches the editor's nine tier chips. */
export const MAX_BONE_ORDER = 9;
```

- [ ] **Step 4: Parse `order` in `parseLevel`**

The accumulator carries the tier:

```ts
  const bones: Array<{ cell: number; count: number; order: number }> = [];
```

The `bone` case reads it:

```ts
    if (el.type === 'bone') {
      const raw = num(el.count);
      const rawOrder = num(el.order);
      const order = rawOrder === null
        ? 1
        : Math.min(MAX_BONE_ORDER, Math.max(1, Math.round(rawOrder)));
      bones.push({ cell, count: Math.max(1, Math.round(raw ?? 1)), order });
      continue;
    }
```

And the attachment loop keeps the first tier seen on a cell:

```ts
  for (const { cell, count, order } of bones) {
    if (!blockCells.has(cell)) {
      issues.push(`bone at cell ${cell} dropped -- no block unit to ride`);
      continue;
    }
    const have = spec.bones.get(cell);
    // One tier per cell. Repeated elements stack the count; the first tier wins,
    // so the outcome does not depend on element order in the file.
    if (have) have.count += count;
    else spec.bones.set(cell, { count, order });
  }
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/level.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS. `tests/walkthrough.test.ts` asserts
`spec.schema === SCHEMA_VERSION` on the fixtures, and
`tests/fixtures/levels.ts` writes `schema: SCHEMA_VERSION`, so both move to 2
together. If that assertion fails, the fixture file is not importing the
constant — fix the fixture, not the assertion.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Schema 2: bones carry an authorable activation tier

Absent order means tier 1, so a schema-1 level parses to a spec that
plays identically -- pinned by a test rather than by argument."
```

---

### Task 4: Grid bones

A bone can sit on a cell of its own. It blocks block groups, dog routes and bee
flood alike, and it is eaten exactly like a riding bone.

**Files:**
- Modify: `src/game/level.ts` (`gridBone` element)
- Modify: `src/game/board.ts` (`isBlocked`)
- Modify: `tests/helpers.ts` (`+` character, `toAscii`)
- Test: `tests/level.test.ts`, `tests/slide.test.ts`, `tests/pathing.test.ts`, `tests/resolve.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: ASCII character `+` for a grid bone; `gridBone` elements parse into
  `spec.bones` with no unit under them.

- [ ] **Step 1: Add `+` to the ASCII helpers**

In `tests/helpers.ts`, extend the doc comment and `elementsFromAscii`:

```ts
/**
 * ASCII boards keep the puzzle cases readable.
 *   '.' empty   '#' wall   'X' dead cell   '*' bee
 *   '+' a bone sitting on the grid   '@' a dog standing on the grid
 *   'a'..'z'    a block unit of that group
 *   'A'..'Z'    the same, carrying a bone
 */
```

and, before the letter test:

```ts
      if (ch === '+') { els.push({ type: 'gridBone', x: c, y: r }); return; }
```

The `tiers` grid from Task 2 must now apply to grid bones too — widen its filter:

```ts
      if (el.type !== 'bone' && el.type !== 'gridBone') continue;
```

and `toAscii` renders one:

```ts
      const unit = state.units.get(i);
      if (unit) line += state.bones.has(i) ? unit.group.toUpperCase()[0] : unit.group[0];
      else if (state.bones.has(i)) line += '+';
      else if (state.dead.has(i)) line += 'X';
```

- [ ] **Step 2: Write the failing tests**

`tests/level.test.ts`:

```ts
describe('gridBone', () => {
  it('sits on the grid with no block under it', () => {
    const { spec, issues } = parseLevel(levelFromAscii(['.+..', '....']));
    expect(issues).toEqual([]);
    expect(spec.bones.get(1)).toEqual({ count: 1, order: 1 });
    expect(spec.units).toHaveLength(0);
    expect(countBones(spec)).toBe(1);
  });

  it('stacks and carries a tier like any other bone', () => {
    const { spec } = parseLevel(level(
      [{ type: 'gridBone', x: 1, y: 0, count: 4, order: 2 }],
      { cols: 4, rows: 2, schema: 2 },
    ));
    expect(spec.bones.get(1)).toEqual({ count: 4, order: 2 });
  });

  it('is dropped when a block already holds the cell', () => {
    const { spec, issues } = parseLevel(level(
      [{ type: 'block', x: 1, y: 0, group: 'a' }, { type: 'gridBone', x: 1, y: 0 }],
      { cols: 4, rows: 2, schema: 2 },
    ));
    expect(issues).toHaveLength(1);
    expect(spec.bones.has(1)).toBe(false);
  });
});
```

`tests/slide.test.ts`:

```ts
describe('grid bones block sliding', () => {
  it('stops a group dead', () => {
    const b = boardFromAscii(['a.+.', '....']);
    expect(canStepGroup(b, 'a', 1, 0)).toBe(true);
    expect(slideGroupBy(b, 'a', 3, 0)).toEqual({ dc: 1, dr: 0 });
  });

  it('is not dragged along by a group sliding past it', () => {
    const b = boardFromAscii(['a...', '.+..']);
    slideGroupBy(b, 'a', 3, 0);
    expect(b.bones.get(5)).toEqual({ count: 1, order: 1 });
    expect(b.units.has(5)).toBe(false);
  });
});
```

`tests/resolve.test.ts`:

```ts
it('lets two dogs claim two bones off one grid stack', () => {
  const b = boardFromAscii(['..+.', '####'], [{ c: 0, r: 0, dir: 'up', count: 2 }]);
  b.bones.set(2, { count: 2, order: 1 });
  const out = resolveMoves(b);
  expect(out).toHaveLength(1);           // one queue runs one dog at a time
  finishWalker(b, b.walkers[0]);
  expect(b.bones.get(2)!.count).toBe(1);
  expect(resolveMoves(b)).toHaveLength(1);
  finishWalker(b, b.walkers[0]);
  expect(b.bones.has(2)).toBe(false);
  expect(isWon(b)).toBe(true);
});

it('sends a dog to a bone standing on the grid, and the cell clears', () => {
  const b = boardFromAscii(['..+.', '####'], [{ c: 0, r: 0, dir: 'up', count: 1 }]);
  const out = resolveMoves(b);
  expect(out).toHaveLength(1);
  expect(out[0].boneCell).toBe(2);
  finishWalker(b, b.walkers[0]);
  expect(b.bones.has(2)).toBe(false);
  expect(isWon(b)).toBe(true);
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `npx vitest run tests/level.test.ts tests/slide.test.ts tests/resolve.test.ts -t "grid"`
Expected: FAIL — `gridBone` is an unknown element type.

- [ ] **Step 4: Parse `gridBone` in `src/game/level.ts`**

A grid bone owns its cell, so unlike `bone` it goes through the `occupant`
check. Add its case beside `bone`, keeping the accumulator so ordering with
blocks does not matter:

```ts
  const bones: Array<{ cell: number; count: number; order: number; onGrid: boolean }> = [];
```

```ts
    if (el.type === 'bone' || el.type === 'gridBone') {
      const raw = num(el.count);
      const rawOrder = num(el.order);
      const order = rawOrder === null
        ? 1
        : Math.min(MAX_BONE_ORDER, Math.max(1, Math.round(rawOrder)));
      bones.push({
        cell,
        count: Math.max(1, Math.round(raw ?? 1)),
        order,
        onGrid: el.type === 'gridBone',
      });
      continue;
    }
```

and the attachment loop learns the two kinds:

```ts
  const blockCells = new Set(spec.units.map((u) => u.cell));
  for (const { cell, count, order, onGrid } of bones) {
    if (onGrid) {
      // A grid bone owns its cell outright -- it cannot share with anything.
      const taken = occupant.get(cell);
      if (taken) { issues.push(`gridBone at cell ${cell} dropped -- already occupied by ${taken}`); continue; }
    } else if (!blockCells.has(cell)) {
      issues.push(`bone at cell ${cell} dropped -- no block unit to ride`);
      continue;
    }

    const have = spec.bones.get(cell);
    if (have) have.count += count;
    else { spec.bones.set(cell, { count, order }); if (onGrid) occupant.set(cell, 'gridBone'); }
  }
```

- [ ] **Step 5: Make grid bones block in `src/game/board.ts`**

```ts
/** True when nothing can occupy or pass through this cell right now. */
export function isBlocked(state: BoardState, cell: number): boolean {
  return (
    state.dead.has(cell) ||
    state.walls.has(cell) ||
    state.bees.has(cell) ||
    state.units.has(cell) ||
    state.bones.has(cell) ||
    state.reserved.has(cell)
  );
}
```

`state.bones.has(cell)` is harmless for a riding bone — that cell is already
blocked by `units`.

`canStepGroup` in `src/game/slide.ts` does not go through `isBlocked`, so it
needs the same term added to its target checks, after the `units` line:

```ts
    if (state.units.has(target)) return false;     // another group
    if (state.bones.has(target)) return false;     // a bone standing on the grid
    if (state.reserved.has(target)) return false;  // a dog's locked route
```

A group sliding by one cell overlaps its own footprint, so it would otherwise
see the bones it is carrying as obstacles. It does not: the `if
(cells.has(target)) continue;` already at the top of that loop short-circuits
every cell the group currently holds, before any of these checks run. The
"carries its stack" case in Task 1 is what pins that.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/level.test.ts tests/slide.test.ts tests/resolve.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the whole suite and build**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Grid bones: a bone can sit on a cell of its own

One term in isBlocked makes it stop block groups, dog routes and bee
flood alike, which is what makes it readable as an obstacle."
```

---

### Task 5: Grid dogs

A dog can stand on the board. `RuntimeQueue` generalizes into `DogSource` so a
grid dog and a queue leader walk the same code path.

**Files:**
- Modify: `src/game/level.ts` (`gridDog` element, `LevelSpec.gridDogs`, `countDogs`)
- Modify: `src/game/board.ts` (`DogSource`, `sources`, derived `gridDogs`, `syncGridDogs`, `queuesOf`, `dogsRemaining`, `isBlocked`)
- Modify: `src/game/pathing.ts` (`findRoute` takes a `DogSource`)
- Modify: `src/game/resolve.ts` (iterate sources, `sourceId`, `isWon`)
- Modify: `src/game/GameApp.ts` (`queuesOf` at render sites)
- Modify: `tests/helpers.ts` (`@` character, `toAscii`)
- Modify: `tests/softlock/analyze.ts` (`cloneState`, `key`)
- Test: `tests/level.test.ts`, `tests/board.test.ts`, `tests/resolve.test.ts`, `tests/slide.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces:
  - `type DogSource` in `src/game/board.ts` (union below)
  - `BoardState.sources: DogSource[]`, `BoardState.gridDogs: Set<number>` (derived)
  - `syncGridDogs(state: BoardState): void`
  - `queuesOf(state: BoardState): Array<Extract<DogSource, { kind: 'queue' }>>`
  - `Walker.sourceId` replaces `Walker.queueId`; `Commitment.sourceId` likewise
  - `findRoute(state, source: DogSource, bees, claimedBones)`

- [ ] **Step 1: Add `@` to the ASCII helpers**

In `elementsFromAscii`, before the letter test:

```ts
      if (ch === '@') { els.push({ type: 'gridDog', x: c, y: r }); return; }
```

and in `toAscii`, after the grid-bone line:

```ts
      else if (state.gridDogs.has(i)) line += '@';
```

- [ ] **Step 2: Write the failing tests**

`tests/level.test.ts`:

```ts
describe('gridDog', () => {
  it('parses onto its cell and counts as a dog', () => {
    const { spec, issues } = parseLevel(levelFromAscii(['.@.+', '....']));
    expect(issues).toEqual([]);
    expect(spec.gridDogs).toEqual([1]);
    expect(countDogs(spec)).toBe(1);
  });

  it('is dropped when something already holds the cell', () => {
    const { spec, issues } = parseLevel(level(
      [{ type: 'wall', x: 1, y: 0 }, { type: 'gridDog', x: 1, y: 0 }],
      { cols: 4, rows: 2, schema: 2 },
    ));
    expect(issues).toHaveLength(1);
    expect(spec.gridDogs).toEqual([]);
  });
});
```

`tests/board.test.ts`:

```ts
describe('dog sources', () => {
  it('puts a grid dog in sources and indexes its cell', () => {
    const b = boardFromAscii(['.@.+', '....']);
    expect(b.sources).toEqual([{ kind: 'grid', id: 'd0', cell: 1 }]);
    expect(b.gridDogs.has(1)).toBe(true);
    expect(dogsRemaining(b)).toBe(1);
  });

  it('blocks its cell', () => {
    const b = boardFromAscii(['a@..', '....']);
    expect(isBlocked(b, 1)).toBe(true);
  });
});
```

`tests/slide.test.ts`:

```ts
it('a grid dog stops a group dead', () => {
  const b = boardFromAscii(['a.@.', '....']);
  expect(slideGroupBy(b, 'a', 3, 0)).toEqual({ dc: 1, dr: 0 });
});
```

`tests/resolve.test.ts`:

```ts
describe('grid dogs', () => {
  it('walks to a bone and frees its cell only after eating', () => {
    const b = boardFromAscii(['@..A', '####']);
    const out = resolveMoves(b);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ sourceId: 'd0', boneCell: 3 });
    expect(b.sources).toEqual([]);          // it left the queue of the waiting
    expect(isBlocked(b, 0)).toBe(true);     // its cell is still reserved
    finishWalker(b, b.walkers[0]);
    expect(isBlocked(b, 0)).toBe(false);
    expect(isWon(b)).toBe(true);
  });

  it('eats a bone already beside it without walking', () => {
    const b = boardFromAscii(['@A..', '####']);
    const out = resolveMoves(b);
    expect(out[0].path).toEqual([0]);       // it stands where it is
    finishWalker(b, b.walkers[0]);
    expect(isWon(b)).toBe(true);
  });

  it('is counted until it has eaten', () => {
    const b = boardFromAscii(['@..A', '####']);
    expect(dogsRemaining(b)).toBe(1);
    resolveMoves(b);
    expect(dogsRemaining(b)).toBe(1);       // now a walker, counted once
    finishWalker(b, b.walkers[0]);
    expect(dogsRemaining(b)).toBe(0);
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `npx vitest run tests/level.test.ts tests/board.test.ts tests/resolve.test.ts tests/slide.test.ts -t "grid dog"`
Expected: FAIL — `gridDog` unknown, `b.sources` undefined.

- [ ] **Step 4: Parse `gridDog` in `src/game/level.ts`**

Add `gridDogs: number[]` to `LevelSpec` beside `queues`, seed it with `[]` in
the `spec` literal, and add the case to the `switch` alongside `dead`/`wall`:

```ts
      case 'gridDog': spec.gridDogs.push(cell); occupant.set(cell, 'gridDog'); break;
```

`countDogs` includes them:

```ts
export function countDogs(spec: LevelSpec): number {
  return spec.queues.reduce((n, q) => n + q.count, 0) + spec.gridDogs.length;
}
```

- [ ] **Step 5: Generalize `RuntimeQueue` into `DogSource` in `src/game/board.ts`**

Replace `RuntimeQueue` (keep the name as a type alias so render code reads
well) and rename `Walker.queueId`:

```ts
/**
 * Where a dog comes from. A queue holds several dogs at an off-board slot and
 * only its leader is live; a grid dog is a single dog standing on a cell it
 * occupies. Both walk the same route-finding and eating path.
 */
export type DogSource =
  | { kind: 'queue'; id: string; cell: number; dir: Dir; remaining: number }
  | { kind: 'grid'; id: string; cell: number };

export type RuntimeQueue = Extract<DogSource, { kind: 'queue' }>;

export interface Walker {
  sourceId: string;
  path: number[];
  step: number;
  boneCell: number;
}
```

`BoardState` swaps `queues` for `sources` and gains the derived index:

```ts
  /** Every dog still waiting to walk -- queues and dogs standing on the board. */
  sources: DogSource[];
  /**
   * Cells held by a grid dog. A derived index over `sources`, rebuilt rather
   * than patched so it can never drift -- `isBlocked` runs hot and needs a
   * cell lookup, but `sources` remains the only place a grid dog lives.
   */
  gridDogs: Set<number>;
```

`createBoard` builds both, ids stable and distinct across the two kinds:

```ts
  const sources: DogSource[] = [
    ...spec.queues.map((q): DogSource => ({ kind: 'queue', id: q.id, cell: q.cell, dir: q.dir, remaining: q.count })),
    ...spec.gridDogs.map((cell, n): DogSource => ({ kind: 'grid', id: `d${n}`, cell })),
  ];
```

and in the returned object, replacing the `queues:` line:

```ts
    sources,
    gridDogs: new Set(spec.gridDogs),
```

Add the index rebuild, the render-side filter, and the new counts:

```ts
/**
 * Rebuild the grid-dog cell index from `sources`. Derived rather than patched,
 * so it can never drift -- the same discipline as `syncReserved`.
 */
export function syncGridDogs(state: BoardState) {
  state.gridDogs.clear();
  for (const s of state.sources) if (s.kind === 'grid') state.gridDogs.add(s.cell);
}

/** The queue sources, for render code that draws waiting lines of dogs. */
export function queuesOf(state: BoardState): RuntimeQueue[] {
  return state.sources.filter((s): s is RuntimeQueue => s.kind === 'queue');
}

export function dogsRemaining(state: BoardState): number {
  const waiting = state.sources.reduce((n, s) => n + (s.kind === 'queue' ? s.remaining : 1), 0);
  return waiting + state.walkers.length;
}
```

`isBlocked` gains the grid-dog term:

```ts
    state.bones.has(cell) ||
    state.gridDogs.has(cell) ||
    state.reserved.has(cell)
```

and `canStepGroup` in `src/game/slide.ts` gains the matching target check:

```ts
    if (state.bones.has(target)) return false;     // a bone standing on the grid
    if (state.gridDogs.has(target)) return false;  // a dog standing on the grid
```

- [ ] **Step 6: Route from any source in `src/game/pathing.ts`**

`findRoute` takes a `DogSource`. The eat-from-the-queue shortcut stays
queue-only; a grid dog's route always starts on its own cell:

```ts
export function findRoute(
  state: BoardState,
  source: DogSource,
  bees: Set<number>,
  claimedBones: BoneClaims,
): Route | null {
  const entry = source.cell;
  const order = activeOrder(state);
  if (order === null) return null;

  // A bone parked on a queue's entry cell is right under the leader's nose. It
  // eats from where it stands, without stepping onto the board -- an empty
  // route. No cells are walked, so there is nothing for a bee to poison.
  if (source.kind === 'queue' && free(state, entry, claimedBones, order) > 0) {
    return { path: [], boneCell: entry };
  }

  // A grid dog is already standing on the board, so its own cell is the first
  // step of its route -- occupied by itself, and never `isPassable`.
  if (source.kind === 'queue' && (!isPassable(state, entry) || bees.has(entry))) return null;
  if (source.kind === 'grid' && bees.has(entry)) return null;

  const prev = new Map<number, number>();
  const seen = new Set<number>([entry]);
  let frontier = [entry];
  ...
```

The BFS body is unchanged. Import `DogSource` instead of `RuntimeQueue`.

- [ ] **Step 7: Iterate sources in `src/game/resolve.ts`**

```ts
export interface Commitment {
  sourceId: string;
  path: number[];
  boneCell: number;
}
```

`claimedBones` reads `w.boneCell` as before. `resolveMoves` becomes:

```ts
export function resolveMoves(state: BoardState): Commitment[] {
  const committed: Commitment[] = [];
  const busy = new Set(state.walkers.map((w) => w.sourceId));
  let progressed = true;

  while (progressed) {
    progressed = false;
    const bees = beeReach(state);
    const claimed = claimedBones(state);

    for (const source of [...state.sources]) {
      if (busy.has(source.id)) continue;
      if (source.kind === 'queue' && source.remaining <= 0) continue;

      const route = findRoute(state, source, bees, claimed);
      if (!route) continue;

      if (source.kind === 'queue') {
        source.remaining--;
      } else {
        // A grid dog is one dog. It leaves `sources` and becomes a walker; its
        // cell stays blocked because its whole path is reserved.
        state.sources = state.sources.filter((s) => s !== source);
        syncGridDogs(state);
      }

      busy.add(source.id);
      claimed.set(route.boneCell, (claimed.get(route.boneCell) ?? 0) + 1);
      state.walkers.push({ sourceId: source.id, path: route.path, step: -1, boneCell: route.boneCell });
      syncReserved(state);
      committed.push({ sourceId: source.id, path: route.path, boneCell: route.boneCell });
      progressed = true;
    }
  }

  return committed;
}
```

`isWon` accounts for both kinds:

```ts
export function isWon(state: BoardState): boolean {
  return state.walkers.length === 0 && state.sources.every((s) => s.kind === 'queue' && s.remaining <= 0);
}
```

A grid dog still in `sources` fails the `kind === 'queue'` test, so it keeps the
level open — which is the rule.

Import `syncGridDogs` from `./board`.

- [ ] **Step 8: Follow the compiler through the render and analyzer sites**

Run: `npx tsc --noEmit`

`src/game/GameApp.ts` — replace `this.state.queues` with `queuesOf(this.state)`
in `drawDogs`, `buildHud`, `rebuildBadges` and `pathPoint`, and
`w.queueId`/`c.queueId` with `w.sourceId`/`c.sourceId` in `sendDogs`,
`drawDogs` and `pathPoint`. In `pathPoint`, a walker whose source has already
left `sources` has no slot to fall back on, so guard it:

```ts
  private pathPoint(walker: Walker, i: number): { x: number; y: number } {
    if (i >= 0) return cellCenter(this.cam, walker.path[i]);
    const q = queuesOf(this.state).find((x) => x.id === walker.sourceId);
    if (!q) return cellCenter(this.cam, walker.path[0]);   // a grid dog starts on the board
    const slot = queueSlot(this.state, q, 0);
    return colRowCenter(this.cam, slot.c, slot.r);
  }
```

`tests/softlock/analyze.ts` — `cloneState` and `key`:

```ts
    sources: s.sources.map((x) => ({ ...x })),
    gridDogs: new Set(s.gridDogs),
```

```ts
  const dogs = s.sources
    .map((x) => (x.kind === 'queue' ? `q${x.remaining}` : `d${x.cell}`))
    .sort()
    .join('/');
  const tiers = [...s.bones].map(([c, b]) => `${c}:${b.count}:${b.order}`).sort().join(',');
  return `${groups}#${tiers}#${dogs}`;
```

Existing tests referencing `b.queues[0]` become `queuesOf(b)[0]`, and
`out[0].queueId` becomes `out[0].sourceId`.

- [ ] **Step 9: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 10: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both clean.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "Grid dogs: a dog can stand on the board

RuntimeQueue generalizes into a DogSource union so a grid dog and a
queue leader share one route-finding and eating path. gridDogs is a
derived index over sources, rebuilt like reserved so it cannot drift."
```

---

### Task 6: Validation warnings

**Files:**
- Modify: `src/game/validate.ts`
- Test: `tests/validate.test.ts`

**Interfaces:**
- Consumes: `LevelSpec.gridDogs`, `LevelSpec.bones` (Tasks 1–5).
- Produces: no new exports; `validateLevel` returns more strings.

- [ ] **Step 1: Write the failing tests**

Add to `tests/validate.test.ts`:

```ts
import { specFromAscii } from './helpers';

describe('grid dogs', () => {
  it('warns when a bee floods to a cell beside one', () => {
    // The bee at (2,0) floods cell (1,0), which touches the dog at (0,0).
    const spec = specFromAscii(['@.*.', '...+']);
    expect(validateLevel(spec).some((w) => /exposed to a bee/.test(w))).toBe(true);
  });

  it('warns when a bee sits right beside one', () => {
    // Adjacency to the bee cell itself -- bee reach never contains a bee's own
    // cell, so this case only fires if the check tests both.
    const spec = specFromAscii(['@*..', '...+']);
    expect(validateLevel(spec).some((w) => /exposed to a bee/.test(w))).toBe(true);
  });

  it('says nothing when the dog is sealed off from the bee', () => {
    const spec = specFromAscii(['@#..', '##..', '..*+']);
    expect(validateLevel(spec).some((w) => /exposed to a bee/.test(w))).toBe(false);
  });

  it('warns when one stands on a queue entry cell', () => {
    const spec = specFromAscii(['@..+', '####'], [{ c: 0, r: 0, dir: 'up', count: 1 }]);
    expect(validateLevel(spec).some((w) => /entry cell/.test(w))).toBe(true);
  });

  it('counts toward the dogs-versus-bones check', () => {
    const spec = specFromAscii(['@@..', '...+']);
    expect(validateLevel(spec).some((w) => /2 dogs but only 1 bone/.test(w))).toBe(true);
  });
});
```

The first case is deliberately the open board: the bee floods the row, reaches
the cell beside the dog, and the warning *must* fire. Correct it to
`toBe(true)` if it does not — but read the board first, because an open
`4x2` grid with a bee at (2,0) does reach (1,0), which touches the dog at (0,0).

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/validate.test.ts -t "grid dogs"`
Expected: FAIL — no bee-exposure or entry-cell warnings exist.

- [ ] **Step 3: Add the checks to `src/game/validate.ts`**

`validateLevel` takes a `LevelSpec`, but `beeReach` needs a `BoardState`. Build
one — `createBoard` is pure and cheap, and it is what the game will actually
play:

```ts
import { boundaryDirs, createBoard, islands } from './board';
import { beeReach } from './pathing';
import { DIR_VEC, DIRS, colOf, idx, inBounds, rowOf } from './cells';
```

The dogs/bones counts already come from `countDogs`/`countBones`, which Tasks 3
and 5 taught about grid content — nothing to change there.

After the queue loop, add:

```ts
  // A grid dog standing on a queue's entry cell seals that queue in: its dogs
  // can never step onto the board. The third way to make a mistake the
  // entry-cell checks above already catch for walls and bees.
  const queueCells = new Set(spec.queues.map((q) => q.cell));
  for (const cell of spec.gridDogs) {
    if (queueCells.has(cell)) out.push(`Dog at ${at(cell)} stands on a queue entry cell -- that queue can never enter.`);
  }

  // A bee beside a grid dog poisons it where it stands, and it can never set
  // off. Bee reach never *contains* the dog's cell, because that cell is not
  // passable -- so exposure is adjacency, to a bee cell or a bee-reachable one.
  if (spec.gridDogs.length && spec.bees.size) {
    const reach = beeReach(createBoard(spec));
    for (const cell of spec.gridDogs) {
      const c = colOf(spec.cols, cell);
      const r = rowOf(spec.cols, cell);
      const exposed = DIRS.some((d) => {
        const { dc, dr } = DIR_VEC[d];
        const nc = c + dc;
        const nr = r + dr;
        if (!inBounds(spec.cols, spec.rows, nc, nr)) return false;
        const n = idx(spec.cols, nc, nr);
        return spec.bees.has(n) || reach.has(n);
      });
      if (exposed) out.push(`Dog at ${at(cell)} is exposed to a bee and can never set off.`);
    }
  }
```

Extend the island check to count grid dogs:

```ts
      const islandDogs =
        spec.queues.filter((q) => cells.has(q.cell)).reduce((a, q) => a + q.count, 0) +
        spec.gridDogs.filter((cell) => cells.has(cell)).length;
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Validate grid dogs: bee exposure, queue entry cells, counts

Bee exposure is adjacency, not containment -- a bee's reach never holds
a dog's cell, because that cell is not passable."
```

---

### Task 7: Editor placement blocking

The Move tool must refuse a drop onto a grid bone or a grid dog.

**Files:**
- Modify: `src/game/place.ts` (`PlacementBoard`, `evaluatePlacement`)
- Modify: `src/editor/EditorApp.ts` (`placementBoard`)
- Test: `tests/place.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks — `PlacementBoard` is its own shape.
- Produces: `PlacementBoard` gains `bones: Set<number>` and `dogs: Set<number>`.

`PlacementBoard` takes plain `Set<number>`s rather than the runtime maps,
because the editor's own state is what fills it and the editor keeps bones as a
`Map<number, BoneStack>` — the caller passes `new Set(this.bones.keys())`.

- [ ] **Step 1: Write the failing test**

Add to `tests/place.test.ts`, matching the existing board-builder in that file:

```ts
it('refuses a drop onto a grid bone or a grid dog', () => {
  const board = {
    cols: 4, rows: 2,
    dead: new Set<number>(), walls: new Set<number>(), bees: new Set<number>(),
    bones: new Set<number>([2]),
    dogs: new Set<number>([3]),
    units: new Map<number, string>([[0, 'a']]),
  };
  expect(evaluatePlacement(board, [0], 2, 0).ok).toBe(false);
  expect(evaluatePlacement(board, [0], 3, 0).ok).toBe(false);
  expect(evaluatePlacement(board, [0], 1, 0).ok).toBe(true);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/place.test.ts -t "grid bone or a grid dog"`
Expected: FAIL — the drop is allowed.

- [ ] **Step 3: Add the terms in `src/game/place.ts`**

```ts
export interface PlacementBoard {
  cols: number;
  rows: number;
  dead: Set<number>;
  walls: Set<number>;
  bees: Set<number>;
  /** Cells holding a bone that is not riding a block -- these block a drop. */
  bones: Set<number>;
  /** Cells holding a dog standing on the board. */
  dogs: Set<number>;
  /** cell -> group id */
  units: Map<number, string>;
}
```

In `evaluatePlacement`, extend the `taken` expression:

```ts
    const taken =
      board.dead.has(target) ||
      board.walls.has(target) ||
      board.bees.has(target) ||
      board.bones.has(target) ||
      board.dogs.has(target) ||
      (board.units.has(target) && !own.has(target));
```

A riding bone sits on a cell that `units` already holds, and a group's own cells
are excluded by `own`, so a group never blocks itself on the bones it carries —
**as long as the caller passes only the free-standing bones.** That is what the
editor does in the next step.

- [ ] **Step 4: Fill it from the editor**

In `src/editor/EditorApp.ts`:

```ts
  private placementBoard(): PlacementBoard {
    return {
      cols: this.cols,
      rows: this.rows,
      dead: this.dead,
      walls: this.walls,
      bees: this.bees,
      // Only bones with no block under them obstruct -- a riding bone's cell is
      // already held by its unit, and travels with the group being dragged.
      bones: new Set([...this.bones.keys()].filter((c) => !this.units.has(c))),
      dogs: this.dogs,
      units: this.units,
    };
  }
```

`this.dogs` does not exist yet — add the field now, empty, and Task 8 fills it:

```ts
  /** Cells holding a dog standing on the board. */
  private dogs = new Set<number>();
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run tests/place.test.ts && npx tsc --noEmit`
Expected: PASS and clean. Other `evaluatePlacement` callers in `tests/place.test.ts`
need `bones` and `dogs` added to their board literals — the compiler lists them.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Move tool refuses a drop onto a grid bone or a grid dog"
```

---

### Task 8: Rendering

Grid bones, grid dogs, tier badges, and dimmed locked tiers.

**Files:**
- Modify: `gameSettings.json` (`colors.boneLocked`)
- Modify: `src/render/draw.ts` (`drawBone` alpha, `drawTierBadge`)
- Modify: `src/game/GameApp.ts` (`drawBoard`, `drawDogs`)
- Test: none — this is Pixi drawing. Verified by running the app in Step 6.

**Interfaces:**
- Consumes: `BoardState.bones`, `BoardState.gridDogs`, `activeOrder` (Tasks 1–5).
- Produces: `drawTierBadge(g, cx, cy, r)` in `src/render/draw.ts`; `drawBone`
  gains a fourth parameter `alpha = 1`.

- [ ] **Step 1: Add the locked-bone colour**

In `gameSettings.json`, inside `colors`, beside `"bone"`:

```json
    "boneLocked": "#6b6f80",
```

- [ ] **Step 2: Let `drawBone` dim, and add the tier badge**

In `src/render/draw.ts`:

```ts
export function drawBone(g: Graphics, cx: number, cy: number, size: number, locked = false) {
  const len = size * L.boneScale;
  const th = len * 0.3;
  const knob = th * 0.62;
  const color = locked ? C.boneLocked : C.bone;
  g.roundRect(cx - len / 2, cy - th / 2, len, th, th / 2).fill({ color });
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      g.circle(cx + (sx * len) / 2, cy + sy * knob * 0.72, knob).fill({ color });
    }
  }
}

/** Backing disc for a bone's activation tier, drawn opposite the count pip. */
export function drawTierBadge(g: Graphics, cx: number, cy: number, r: number, locked: boolean) {
  g.circle(cx, cy, r)
    .fill({ color: C.badgeFill })
    .stroke({ width: 1.2, color: locked ? C.boneLocked : C.bone, alpha: 0.9 });
}
```

- [ ] **Step 3: Draw bones, tiers and grid dogs in `src/game/GameApp.ts`**

Import `activeOrder` and `queuesOf` from `./board` and `drawTierBadge` from
`../render/draw`. Add a second label pool beside `boneCounts` for the tier
digits, created in the field initializers and added to `root` in `init`:

```ts
  private tierLabels = new LabelPool({ fill: 0xffffff, fontSize: 13, fontFamily: 'system-ui, sans-serif', fontWeight: '700' });
```

```ts
    this.root.addChild(this.gridG, this.overlayG, this.boardG, this.boneCounts.view, this.tierLabels.view, this.dogG);
```

Replace the bone loop in `drawBoard`:

```ts
    // Tier badges only appear when the level actually uses more than one tier,
    // so a single-tier level looks exactly as it always did.
    const orders = new Set([...this.state.bones.values()].map((s) => s.order));
    const tiered = orders.size > 1;
    const active = activeOrder(this.state);

    this.tierLabels.begin();
    for (const [cell, stack] of this.state.bones) {
      const p = cellCenter(this.cam, cell);
      const locked = active !== null && stack.order !== active;
      drawBone(this.boardG, p.x, p.y, this.cam.cell, locked);

      const r = this.cam.cell * 0.21;
      if (stack.count > 1) {
        const px = p.x + this.cam.cell * 0.29;
        const py = p.y + this.cam.cell * 0.29;
        drawBonePip(this.boardG, px, py, r);
        this.boneCounts.add(px, py, String(stack.count), r / 9);
      }
      if (tiered) {
        const px = p.x - this.cam.cell * 0.29;
        const py = p.y - this.cam.cell * 0.29;
        drawTierBadge(this.boardG, px, py, r, locked);
        this.tierLabels.add(px, py, String(stack.order), r / 9);
      }
    }
```

and close the pool beside `this.boneCounts.end()`:

```ts
    this.tierLabels.end();
```

Add the grid dogs at the top of `drawDogs`, before the queue loop:

```ts
  private drawDogs() {
    this.dogG.clear();
    const size = this.cam.cell * L.queueDogScale;

    for (const cell of this.state.gridDogs) {
      const p = cellCenter(this.cam, cell);
      drawDog(this.dogG, p.x, p.y, size);
    }

    queuesOf(this.state).forEach((q, i) => {
```

and free the new pool in `dispose`:

```ts
    this.tierLabels.destroy();
```

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both clean. `SETTINGS.colors.boneLocked` resolves because
`ColorKey` is derived from the JSON.

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS — nothing here is under test, but the build must not regress it.

- [ ] **Step 6: Look at it**

Run: `npm run dev`, open a level with a grid bone, a grid dog and two tiers
(author one in the editor after Task 9, or hand-edit a level JSON in the Local
tab). Confirm: locked bones read as greyed, tier badges sit top-left and counts
bottom-right without overlapping, and a grid dog is centred in its cell.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Draw grid bones, grid dogs, tier badges and locked tiers

Tier badges appear only when a level uses more than one tier, so a
single-tier level looks exactly as it always did."
```

---

### Task 9: Editor tools

The Dog tool, the context-sensitive Bone tool, and the tier chips.

**Files:**
- Modify: `src/editor/EditorApp.ts`
- Test: none automated — the editor is DOM and Pixi. Verified in Step 8.

**Interfaces:**
- Consumes: `BoneStack`, `MAX_BONE_ORDER` (`src/game/level.ts`); `this.dogs`
  (added in Task 7).
- Produces: level JSON containing `gridBone`, `gridDog` and `order`.

- [ ] **Step 1: Add the Dog tool**

Extend the `Tool` union and the `TOOLS` array. Dog goes after Queue, so Erase
moves to slot 9:

```ts
type Tool = 'block' | 'move' | 'bone' | 'wall' | 'bee' | 'dead' | 'queue' | 'dog' | 'erase';
```

```ts
  { id: 'queue', label: 'Queue', hint: 'Tap a boundary cell to add a queue, or tap one to select it.' },
  { id: 'dog', label: 'Dog', hint: 'Tap a cell to stand a dog on the board. It blocks like a wall until it eats.' },
  { id: 'erase', label: 'Erase', hint: 'Clear whatever is in the cell.' },
```

The keyboard handler already reads `TOOLS[n - 1]` for digits 1–9, so nine tools
need no change there. Update the `.key-hint` copy in `buildChrome`:

```ts
        <p class="key-hint">1–9 pick a tool · ⇧ 1–9 pick a paint colour or bone tier</p>
```

and the tool-button loop's `if (i < 9)` guard already covers all nine.

- [ ] **Step 2: Place and clear dogs**

Add the case to `apply`:

```ts
      case 'dog': this.toggleDog(cell); break;
```

and the handler, beside `toggleTerrain`:

```ts
  private toggleDog(cell: number) {
    if (this.dead.has(cell)) return;
    if (this.dogs.has(cell)) { this.dogs.delete(cell); return; }
    this.clearCell(cell);
    this.dogs.add(cell);
  }
```

`clearCell` must forget dogs, so every tool that clears a cell clears one:

```ts
  private clearCell(cell: number) {
    this.units.delete(cell);
    this.bones.delete(cell);
    this.walls.delete(cell);
    this.bees.delete(cell);
    this.dogs.delete(cell);
  }
```

`toggleDead` already calls `clearCell`. `eraseCell` calls it too. `clearAll`
needs one more line:

```ts
    this.units.clear(); this.bones.clear(); this.dogs.clear();
```

and the `resize` remap keeps dogs in place when the grid grows:

```ts
    const nextDogs = keys(this.dogs);
```

placed beside the other `keys(...)` calls, then assigned with them:

```ts
    this.dogs = nextDogs;
```

- [ ] **Step 3: Make the Bone tool context-sensitive and tier-aware**

Add the active-tier field beside `activeGroup`:

```ts
  private activeOrder = 1;
```

Rewrite `applyBone`. An empty cell is now a legal target; a cell holding a dog,
wall or bee is not:

```ts
  private applyBone(cell: number, remove: boolean) {
    const have = this.bones.get(cell);

    if (remove) {
      if (!have || have.count <= 1) this.bones.delete(cell);
      else have.count -= 1;
      return;
    }

    if (have) {
      if (have.count >= MAX_BONES_PER_UNIT) { this.flash(`One cell carries at most ${MAX_BONES_PER_UNIT} bones.`); return; }
      have.count += 1;
      return;
    }

    // A bone rides a block when there is one under it and sits on the grid when
    // there is not. Anything else in the cell has to go first.
    if (this.dead.has(cell)) { this.flash('That cell is switched off.'); return; }
    if (this.walls.has(cell) || this.bees.has(cell) || this.dogs.has(cell)) {
      this.flash('Clear the cell first — a bone needs a block or bare ground.');
      return;
    }
    this.bones.set(cell, { count: 1, order: this.activeOrder });
  }
```

`applyBlock` no longer deletes a bone when painting *onto* a cell — painting a
block onto a grid bone converts it into a riding bone, which is the intended
gesture. It still takes the bone when a block is *removed*:

```ts
  private applyBlock(cell: number) {
    if (this.dead.has(cell)) return;
    const existing = this.units.get(cell);
    if (existing === this.activeGroup) { this.units.delete(cell); this.bones.delete(cell); return; }
    this.walls.delete(cell);
    this.bees.delete(cell);
    this.dogs.delete(cell);
    this.units.set(cell, this.activeGroup);   // reassigns a unit from another group
  }
```

Drop the load-time line that discarded host-less bones — they are grid bones now:

```ts
    // (removed) for (const cell of [...this.bones.keys()]) if (!this.units.has(cell)) this.bones.delete(cell);
```

Load `gridBone`, `gridDog` and `order` in `loadElements`. Replace the `bone`
case and add the two new ones:

```ts
        case 'bone':
        case 'gridBone': {
          const add = Math.max(1, Math.round(Number(el.count) || 1));
          const rawOrder = Number(el.order);
          const order = Number.isFinite(rawOrder)
            ? Math.min(MAX_BONE_ORDER, Math.max(1, Math.round(rawOrder)))
            : 1;
          const have = this.bones.get(cell);
          if (have) have.count = Math.min(MAX_BONES_PER_UNIT, have.count + add);
          else this.bones.set(cell, { count: Math.min(MAX_BONES_PER_UNIT, add), order });
          break;
        }
        case 'gridDog': this.dogs.add(cell); break;
```

Import `MAX_BONE_ORDER` and `BoneStack` from `../game/level`.

- [ ] **Step 4: Let ⇧1–⇧9 pick a tier while the Bone tool is up**

In `onKeyDown`, replace the shift branch:

```ts
    if (e.shiftKey) {
      if (this.tool === 'block') this.selectGroupSlot(n);
      else if (this.tool === 'bone') this.activeOrder = Math.min(n, MAX_BONE_ORDER);
      else return;
    } else {
```

- [ ] **Step 5: Add the tier chip row**

In `buildChrome`, add a row after the group row:

```html
        <div class="tier-row"></div>
```

and in `refreshChrome`, after the group-row block:

```ts
    const tierRow = bar.querySelector<HTMLElement>('.tier-row')!;
    tierRow.style.display = this.tool === 'bone' ? 'flex' : 'none';
    tierRow.innerHTML = '';
    // Show every tier in use, plus one beyond it to grow into.
    const used = Math.max(1, ...[...this.bones.values()].map((s) => s.order), this.activeOrder);
    const shown = Math.min(MAX_BONE_ORDER, used + 1);
    for (let n = 1; n <= shown; n++) {
      const b = document.createElement('button');
      b.className = 'group-chip' + (n === this.activeOrder ? ' active' : '');
      b.textContent = `tier ${n}`;
      const key = document.createElement('i');
      key.className = 'key';
      key.textContent = `⇧${n}`;
      b.appendChild(key);
      b.onclick = () => { this.activeOrder = n; this.refreshChrome(); };
      tierRow.appendChild(b);
    }
```

Reuse the `.group-chip` class so no CSS is needed. Add `.tier-row` to whatever
selector `.group-row` uses in `src/ui/styles.css` — find it with
`grep -n "group-row" src/ui/styles.css` and extend that rule's selector list.

- [ ] **Step 6: Draw grid bones, grid dogs and tiers in the editor**

In `redraw`, the bone loop draws a tier badge on the same terms as the game, and
the dogs draw after the bees:

```ts
    const orders = new Set([...this.bones.values()].map((s) => s.order));
    const tiered = orders.size > 1;
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
```

`paintBone` takes the tier:

```ts
  /** A bone, its count when the cell carries a stack, and its tier when the level uses more than one. */
  private paintBone(x: number, y: number, count: number, order: number) {
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
      this.boneLabels.add(px, py, String(order), r / 9);
    }
  }
```

Import `drawTierBadge`. Update the `drawMoveGhost` call site to pass the tier:

```ts
        const carried = drag.bones.get(drag.cells[i]);
        if (target < 0 || carried === undefined) continue;
        const p = cellCenter(this.cam, target);
        this.paintBone(p.x, p.y, carried.count, tiered ? carried.order : 0);
```

`tiered` is local to `redraw`, so compute it in `drawMoveGhost` the same way, or
hoist it to a small private method `private tiered(): boolean`. Prefer the
method — it is used in both places.

- [ ] **Step 7: Write the new elements in `snapshot`**

```ts
    for (const [cell, stack] of this.bones) {
      const type = this.units.has(cell) ? 'bone' : 'gridBone';
      push(type, cell, { count: stack.count, order: stack.order });
    }
    for (const cell of this.dogs) push('gridDog', cell);
```

- [ ] **Step 8: Typecheck, build, and drive it**

Run: `npx tsc --noEmit && npm run build && npm test`
Expected: all clean.

Then `npm run dev` and author a level end to end:
1. Place a block, put two bones on it, set them to tier 2.
2. Place a bare grid bone at tier 1.
3. Place a grid dog; confirm the Move tool refuses to drop a group on it.
4. Put a bee beside the dog; confirm the bee warning appears and does not block Save.
5. Save, reopen from the Local tab, confirm every piece came back.
6. **Test** the level: the dog must eat the tier-1 grid bone before the tier-2
   bones stop reading as greyed.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Editor: Dog tool, context-sensitive Bone tool, tier chips

The Bone tool now reads the cell -- a block under it means a riding
bone, bare ground means a grid bone. Tiers are picked with the same
Shift+N gesture that picks a paint colour."
```

---

### Task 10: Soft-lock analysis and docs

The analyzer already carries the new state (Tasks 1 and 5 updated `cloneState`
and `key`). What remains is to re-run it and write down what it says — not what
we expect it to say.

**Files:**
- Modify: `tests/softlock.test.ts` (new ordering case)
- Modify: `docs/soft-locks.md`
- Modify: `docs/level-data.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: `analyze` from `tests/softlock/analyze.ts`, unchanged signature.
- Produces: documentation only.

- [ ] **Step 1: Add a soft-lock case for ordering**

Read `tests/softlock.test.ts` first and copy the shape of an existing case. Add
a level whose tiers force a sequence, e.g. a tier-2 bone reachable only through
a corridor that a tier-1 bone's block currently occupies:

```ts
it('sl-tiers -- a level whose tiers force a sequence', () => {
  const level = levelFromAscii(
    ['..A.', '.#b.', '..+.'],
    [{ c: 0, r: 0, dir: 'up', count: 2 }],
    {},
    ['..2.', '....', '..1.'],
  );
  const result = analyze(level);
  expect(result.winnable).toBe(true);
  // Record what the analyzer actually finds. If it reports a soft lock, keep
  // the assertion and document the lock in docs/soft-locks.md -- do not weaken
  // the level until it passes.
  expect(result.dead.size).toBe(0);
});
```

- [ ] **Step 2: Run it and read the result honestly**

Run: `npx vitest run tests/softlock.test.ts`

If `result.dead.size` is not 0, **do not change the level to make it pass.**
Change the assertion to the real number, and carry that finding into Step 3.
The whole value of this file is that it reports rather than reassures.

- [ ] **Step 3: Rewrite `docs/soft-locks.md` against the evidence**

The doc currently ends its central section with:

> **Rule of thumb: audit bee levels. Bee-free levels cannot be locked.**

That claim rested on an argument — sliding is undoable, and a bite only ever
frees space — plus 1458 generated bee-free levels. Both features and ordering
change what it rests on:

- **Grid bones and grid dogs are new immovable obstacles**, but both *vanish*
  when eaten, so they still only ever add free space. The reversibility
  argument survives.
- **Ordering changes which bones are targetable over time**, which the argument
  never considered. Tiers unlock monotonically and eating only frees space, so
  the conclusion is expected to hold — but "expected" is not "shown".

Rewrite the section to state (a) the argument as it now stands, covering all
three additions explicitly, and (b) what the re-run of Step 2 actually found.
If the generator in the analyzer can be pointed at levels with tiers and grid
content, re-run it and quote the new numbers; if it cannot without new work,
say so plainly rather than implying coverage that does not exist.

- [ ] **Step 4: Update `docs/level-data.md`**

Replace the element table with the seven rows, `meta.schema` in the example
becoming `2`:

```markdown
| element | fields | meaning |
| --- | --- | --- |
| `dead` | `x, y` | cell switched off; how a level gets more than one island |
| `wall` | `x, y` | static, unmovable, blocks everything |
| `bee` | `x, y` | fixed; poisons every cell it can reach |
| `block` | `x, y, group` | one unit block painted with colour `group` |
| `bone` | `x, y, count?, order?` | rides the block in the same cell |
| `gridBone` | `x, y, count?, order?` | sits on the grid itself; blocks everything until eaten |
| `gridDog` | `x, y` | a dog standing on the board; blocks everything until it eats |
| `queue` | `x, y, dir, count` | entry cell; dogs line up towards `dir` |
```

and add a section after the `group` paragraph:

```markdown
## `order` — bone tiers

Every bone carries an activation tier. `order` defaults to **1**, and a bone
with no `order` is tier 1 — which is why every level written before edition 2
plays unchanged.

A tier is edible once every **lower** tier is gone. The active tier is the
lowest one still on the board, so tiers are relative to what remains rather
than to the number 1: with tiers 2 and 5 left, tier 2 is active. Gaps are legal
and mean nothing — 1 and 3 with no 2 is simply two tiers.

A *claimed* bone still counts as remaining. A tier unlocks when the last
lower-tier bone is **eaten**, not when the last one is spoken for.

**One tier per cell.** A cell's whole stack shares one `order`. Repeated bone
elements on a cell add up their `count`; the first `order` seen wins, so the
result does not depend on element order in the file.

A locked bone still blocks everything. It is an obstacle you can see but cannot
yet claim.
```

Bump the `"schema": 1` in the JSON example to `2`, and add to the schema
section's history:

```markdown
Edition 2 added bone tiers (`order`) and the `gridBone` and `gridDog` elements.
An edition-1 level is a valid edition-2 level with every bone on tier 1.
```

- [ ] **Step 5: Update `README.md`**

In **Rules**, revise the bones and dogs bullets and add two:

```markdown
- **Bones** ride block units, so they move with their group — or sit on a grid
  cell of their own, where they block like a wall until eaten. Either way a
  cell can carry a stack: each dog takes one, and the cell only clears when the
  last bone goes.
- **Bone tiers.** Every bone belongs to a numbered tier, and a tier cannot be
  eaten until every lower tier is gone. Locked bones are drawn greyed — you can
  see them, you cannot claim them yet, and they block all the same.
- **Dogs** wait in queues on the grid boundary, or stand on the board itself.
  Only a queue's leader is live. On drag release, any dog with a safe route sets
  off, walks in, eats a bone, and destroys its host unit if it had one. A dog
  standing on the board blocks like a wall until it eats, then it is gone.
```

In **Editing tools**, revise the Bone bullet and add Dog:

```markdown
- **Bone**: tap a block to add a bone that rides it; tap bare ground for a bone
  that sits on the grid and blocks like a wall. Shift-tap takes one off. Up to
  9 per cell, shown as a count. The tier chips set which tier new bones join.
- **Dog**: tap a cell to stand a dog on the board. It blocks until it eats.
```

And the keyboard table:

```markdown
| key | does |
| --- | --- |
| `1`–`9` | pick a tool: Block, Move, Bone, Wall, Bee, Off, Queue, Dog, Erase |
| `⇧1`–`⇧9` | pick a paint colour (Block tool) or a bone tier (Bone tool) |
```

- [ ] **Step 6: Full gate**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Document grid bones, grid dogs and bone tiers

soft-locks.md is rewritten against a re-run rather than against the
argument it used to make -- all three additions change what that
argument rested on."
```

---

## Done when

- `npm test`, `npx tsc --noEmit` and `npm run build` are all clean.
- A schema-1 level loads with no issues and plays identically — pinned by the
  tests in Task 3, Step 1.
- A level authored in the editor with a grid bone, a grid dog and two tiers
  saves, reloads and plays through to a win.
- `docs/soft-locks.md` says what the analyzer found, not what we hoped.
