# Grid bones, grid dogs and bone order — design

Three changes to Dog Chase Bones, landed together because they share one
format revision:

1. **Bones on the grid.** A bone can sit on a cell of its own instead of
   riding a block unit. It blocks everything until it is eaten.
2. **Dogs on the grid.** A dog can stand on the board instead of waiting in a
   boundary queue. It blocks everything until it eats, then it is gone.
3. **Bone order.** Every bone belongs to a numbered tier. A tier cannot be
   eaten until every lower tier is gone.

They arrive as one schema bump rather than three, so a Unity port re-reads the
format once.

## Decisions taken during design

Recorded because each one closes a question that would otherwise be reopened
during implementation.

- **A bee reaching a grid dog is an authoring warning, never a runtime event.**
  Bee reach continues to do exactly one thing: stop a dog from *walking* a
  route. A grid dog standing in bee reach is legal and simply cannot set off
  until the corridor is sealed. No dog is ever removed or poisoned mid-play.
- **Grid bones stack exactly like riding bones.** Count 1–9, several dogs may
  commit to the same cell, the cell clears when the last bone goes.
- **One bone tier per cell.** A cell's whole stack shares one `order`. A stack
  split across tiers was considered and rejected: it turns the stack into a
  list and complicates the format, the editor gesture, the badge and the claim
  bookkeeping, for expressiveness nobody asked for.
- **Order is a number on the bone, not a named group plus a list in `meta`.**
  Gaps are legal and harmless. Nothing has to be kept in sync in two places.
- **The Bone tool becomes context-sensitive** rather than splitting into two
  tools. Tap a block, the bone rides it; tap an empty cell, it sits on the
  grid.

## 1. Level format

`meta.schema` goes to **2**. Every addition is a new element type or a new
optional key, so a schema-1 document parses exactly as it does today.

| element | fields | meaning |
| --- | --- | --- |
| `dead` | `x, y` | unchanged |
| `wall` | `x, y` | unchanged |
| `bee` | `x, y` | unchanged |
| `block` | `x, y, group` | unchanged |
| `bone` | `x, y, count?, order?` | rides the block in the same cell |
| `gridBone` | `x, y, count?, order?` | sits on the grid — blocks everything until eaten |
| `gridDog` | `x, y` | a dog standing on the board — blocks everything until it eats |
| `queue` | `x, y, dir, count` | unchanged |

- `count` defaults to 1 and stacks, on `gridBone` exactly as on `bone`.
- `order` defaults to **1**. Absent everywhere means every bone is tier 1,
  every bone is active from the start, and play is identical to today.
- `gridDog` carries no count. One element, one dog — a stack of dogs on one
  cell has nowhere to stand.
- The editor's existing cap of 9 bones per cell applies to `gridBone`
  unchanged.

### Why new element types rather than reusing `bone`

The tempting version needs no new type at all: *a `bone` with no `block` under
it **is** a grid bone.* It is rejected deliberately.

Today an orphan `bone` is dropped with a parser issue. Under that rule it would
instead become a live, board-blocking obstacle — an old authoring mistake
silently turned into content, in a level that still loads clean. That is
exactly the survivable-looking reinterpretation `docs/level-data.md` warns
about. Separate element types mean an old level can only ever gain content it
explicitly asked for.

### Backward compatibility

`parseLevel` already accepts any edition at or below `SCHEMA_VERSION` and only
raises an issue for a newer one. So:

- **Schema-1 levels load unchanged.** No grid content, every bone at tier 1.
  This is pinned by a test, not by argument — see §5.
- **A schema-2 level in an older build** surfaces the existing "made with a
  newer editor" issue. Unchanged mechanism.

## 2. Runtime model

### One bone map

Ordering makes "which tier is active?" a minimum over *every* bone, riding and
free alike. Two collections would mean two places to scan and two places to
forget, so bones move out of `Unit` and into one map:

```ts
interface BoneStack { count: number; order: number }

BoardState.bones: Map<number, BoneStack>   // every bone, riding or free
```

A bone **rides a block** when `units.has(cell)`, and **sits on the grid** when
it does not. `Unit.bones` is removed.

The cost is named rather than hidden: `stepGroup` must now relocate bone
entries in lockstep with the units it moves, where before they travelled for
free as a field on `Unit`. It is a few lines in the one function the whole game
leans on, so it is covered directly by tests — a group carrying a stack, and a
group sliding past a grid bone without disturbing it.

### Dog sources

`RuntimeQueue` generalizes:

```ts
type DogSource =
  | { kind: 'queue'; id: string; cell: number; dir: Dir; remaining: number }
  | { kind: 'grid';  id: string; cell: number }
```

`Walker.queueId` becomes `sourceId`. `resolveMoves` iterates sources.
`findRoute` seeds its BFS at `source.cell` for both kinds, so for a grid dog
`path[0]` is its own cell and "a bone is already beside me" falls out as a
zero-step walk with no special case.

The queue-only quirk stays queue-only: a bone parked *on* a queue's entry cell
is eaten with an empty path and nothing reserved.

**Grid dogs live in `sources` and nowhere else.** `isBlocked` needs a cell
lookup and runs hot, so `BoardState.gridDogs: Set<number>` exists as an index —
but it is **derived** from `sources`, rebuilt the way `syncReserved` already
rebuilds `reserved` from `walkers`, and never patched independently. Two
hand-maintained copies of the same fact is the mistake this design rejects for
bones; it is not reintroduced for dogs.

A committed grid dog is removed from `sources` and becomes a walker, so it is
counted once by `dogsRemaining` — via `walkers`, never twice.

### Blocking

`isBlocked` gains two terms:

```ts
state.bones.has(cell) || state.gridDogs.has(cell)
```

That single change makes grid bones and grid dogs stop block groups, stop other
dogs' routes, and stop bee flood — all three consistently, which is what makes
them readable as obstacles. A cell holding a riding bone is already blocked via
`units`, so the term is harmless there.

A grid dog leaves `gridDogs` the moment it commits. Its cell stays blocked
because its whole path is reserved, and frees when it eats.

`place.ts`'s `PlacementBoard` gains the same two terms so the editor's Move
tool refuses a drop onto either.

### Activation

`activeOrder(state)` is the minimum `order` over all remaining bones. Bones at
that tier are targetable; every higher tier is locked.

- Locked bones still block everything. They are obstacles you can see but not
  yet claim.
- Gaps are harmless: tiers 1 and 3 with no 2 means 3 unlocks when 1 empties.
- **A committed bone still counts as remaining.** A tier unlocks when the last
  lower-tier bone is *eaten*, not when the last one is claimed. This matters
  inside `resolveMoves`, which repeats until nothing new commits: within a
  single release, a dog cannot set off for tier 2 because another dog is on its
  way to the last tier-1 bone.
- **No bones left** means no active tier. `activeOrder` returns `null` and
  `findRoute` finds nothing — the state where every bone is gone and the last
  walkers are still finishing.
- `findRoute` adds one condition to its adjacency test. Nothing else in pathing
  changes.

### Eating

`takeBone(state, cell)` decrements the stack; at zero it deletes the entry and,
when a unit is underneath, calls the existing `removeUnit` — so group splitting
keeps working untouched and a grid bone simply vanishes.

This is the **single place a bone can disappear**, which is what keeps
`activeOrder` honest.

### Win and lose

`isWon` — no walkers, every queue empty, no grid dogs left. `dogsRemaining`
adds grid dogs. The timer is untouched.

### Bees and grid dogs

Authoring-time only. `validateLevel` warns when a grid dog's cell touches a bee
cell or any cell in the initial bee reach. Nothing at runtime removes or
poisons a dog.

Note the asymmetry that makes this check necessary: a bee's reach never
*contains* a dog's cell, because that cell is not passable. Exposure is
adjacency — to a bee cell, or to a bee-reachable cell.

`validateLevel` also warns when a grid dog stands on a **queue's entry cell**.
That queue's dogs could never walk in, which the existing entry-cell checks
already flag for walls and bees; a grid dog is the third way to make the same
mistake.

## 3. Editor

### Tools

The row goes from 8 to 9. Dog slots in after Queue, so Erase moves from `8` to
`9`:

`1` Block · `2` Move · `3` Bone · `4` Wall · `5` Bee · `6` Off · `7` Queue ·
`8` Dog · `9` Erase

### The Bone tool becomes context-sensitive

Tap a block, the bone rides it. Tap an empty cell, it sits on the grid.
Shift-tap removes one either way. The "Bones ride block units" flash goes away,
because an empty cell is now a legal target.

Two consequences, made explicit so they are not rediscovered as bugs:

- Painting a **block onto a cell holding a grid bone** converts it into a
  riding bone. This reads naturally and is allowed.
- Erasing or repainting a block that carries bones still takes the bones with
  it. It does **not** leave a grid bone behind — the designer tapped to remove
  something, so removing it whole is the honest result.

### Bone-tier chips

While the Bone tool is up, a numbered chip row shows the tiers in use plus a
`+ tier` button, and `⇧1`–`⇧9` picks a tier — the same gesture that already
picks a paint colour while Block is up. New bones take the active tier. The
chips are the only place order is authored; there is no second panel to keep in
sync.

### Drawing

- A bone shows its tier badge **only when the level has more than one tier**,
  so single-tier levels look exactly as they do now.
- Locked tiers draw dimmed.
- A grid bone is a bone on a bare cell. The absence of a block under it is the
  tell; it needs no extra chrome.
- A grid dog uses the existing `drawDog` at cell scale.

### State plumbing

The editor already keeps `bones` as a `Map<number, …>` independent of `units`,
so grid bones cost it almost nothing: the map's value becomes
`{ count, order }`, and the load-time line that drops host-less bones is
removed. New: a `dogs: Set<number>`.

`clearCell`, `eraseCell`, `toggleDead` and the `resize` remap each grow one
line for dogs. `snapshot` emits `gridBone` for a bone whose cell has no unit,
`bone` where it does, and `gridDog` per dog.

Live warnings are unchanged in mechanism. `validateLevel` gains the
bee-exposed-dog check and counts grid bones and grid dogs in its totals and
island checks. Warnings still never block a save.

## 4. Files touched

| file | change |
| --- | --- |
| `src/game/level.ts` | `SCHEMA_VERSION` → 2; parse `gridBone`, `gridDog`, `order`; `LevelSpec` carries the bone map and grid dogs |
| `src/game/board.ts` | `bones` map, `gridDogs`, `DogSource`, `isBlocked`, `dogsRemaining`, `takeBone`, `activeOrder` |
| `src/game/slide.ts` | `stepGroup` relocates bone entries with their units |
| `src/game/pathing.ts` | route to any active bone, riding or free; tier condition |
| `src/game/resolve.ts` | iterate dog sources; `sourceId`; `isWon` accounts for grid dogs |
| `src/game/validate.ts` | bee-exposed grid dog; counts and island checks include grid content |
| `src/game/place.ts` | `PlacementBoard` blocks on grid bones and grid dogs |
| `src/game/GameApp.ts` | draw grid bones, grid dogs, tier badges, dimmed locked tiers |
| `src/render/draw.ts` | tier badge; dimmed bone variant |
| `src/editor/EditorApp.ts` | Dog tool, context-sensitive Bone tool, tier chips, snapshot, resize |
| `tests/helpers.ts` | ASCII characters for grid bones, grid dogs and tiers |
| `tests/softlock/analyze.ts` | `cloneState` and `key` carry bones, grid dogs and tiers |
| `docs/level-data.md` | three element rows, `order` semantics, schema 2 |
| `docs/soft-locks.md` | rewritten against re-run evidence |
| `README.md` | rules bullets, 9-tool keyboard table, tier gesture |

## 5. Tests

ASCII helpers land first, because they are what makes the rules tests readable:
`o` for a grid bone, `D` for a grid dog, and a tier suffix for bones. **No
existing character changes meaning**, so every current fixture keeps its
current behaviour.

- **`slide`** — a group carrying a stack still carries it after a step; a group
  stops dead against a grid bone and against a grid dog; a grid bone is
  untouched by a group sliding past it.
- **`pathing`** — a dog routes to a grid bone; a locked tier is not a target
  even when adjacent; the tier unlocks the moment the last lower-tier bone
  goes; bee reach still refuses a route.
- **`resolve`** — a grid dog commits and eats; a grid dog with a bone already
  beside it eats in place; two dogs claim two bones off one stack; a grid dog's
  cell frees only after it eats.
- **`validate`** — a bee-exposed grid dog warns; grid bones and grid dogs count
  toward the dogs-vs-bones and island checks.
- **`level`** — the backward-compatibility test that matters: a schema-1
  fixture parses to a spec identical to today's, every bone at tier 1, no grid
  content. Plus round-trips of the three new element shapes and their defaults.
- **`place`** — the Move tool refuses a drop onto a grid bone or a grid dog.

### Soft locks

`docs/soft-locks.md` currently states, backed by an exhaustive analyzer, that
bee-free levels **cannot** be soft-locked. All three changes touch what that
result rests on.

The expectation is that it still holds — eating only ever frees space, and
tiers unlock monotonically — but that is not asserted. The work is: extend
`analyze.ts` to carry the bone map, grid dogs and tiers in its state key,
re-run it, and rewrite the doc to say what the evidence shows afterwards,
including the possibility that ordering can lock a bee-free level.

### Gate

`npm test` and `npm run build`, both clean.

## 6. Out of scope

- Colour-matched dogs and bones. `BlockUnit.colorKey` stays dormant.
- Any HUD display of which tier is currently active.
- Moving or re-ordering tiers after authoring, beyond repainting bones.

## 7. Production risk

`docs/level-data.md` records a studio policy: the mechanic stops moving once a
Unity port begins, and a change during production is made on both sides or the
prototype retires.

Three new element types, a schema bump and a new activation rule is a
substantial re-port. This is flagged as a timing decision for the studio, not
as a blocker on the work.
