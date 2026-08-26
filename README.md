# Dog Chase Bones

Grid puzzle prototype. Slide multi-cell block groups around a grid to open a
safe path from a queue of dogs to the bones that ride those same blocks.

**Mechanics:** [maze-grid](https://github.com/rebootinteractive) path extraction,
inverted (the dog walks *in* rather than the block sliding *out*), chained with a
multi-queue system on the grid edges.

## Rules

- **Block groups** are one or more unit blocks that move as a piece. Free drag:
  the group follows your finger cell by cell and stops the moment any unit hits
  a wall, another group, a bee, a dog or the grid edge.
- **Bones** ride block units, so they move with their group.
- **Dogs** wait in queues on the grid boundary. Only the leader is live. On drag
  release, any leader with a safe route sets off on its own, walks in, eats a
  bone, and destroys its host unit. The queue then advances.
- **Eating off the queue.** If a bone is parked on the leader's own entry cell,
  it is already under the dog's nose: the dog eats it from where it stands
  without walking a route at all. Nothing is reserved, so other groups stay free
  to slide, and a bee has no route to poison.
- **Group splitting.** If the eaten unit was the only thing holding a group
  together, it falls apart into independent groups.
- **Bees** sit fixed on the board and flood outward through open cells. A dog
  will not walk a route that touches anywhere a bee can reach — you have to seal
  the corridor off first.
- **Walls** are static and never move. **Dead cells** switch a cell off, which
  is how a level gets more than one island.
- **Win** when every dog has eaten. **Lose** when the timer hits zero.

## Layout

| file | what it is |
| --- | --- |
| `composition.html` | The locked stage. Open it in a browser. The editor never changes it. |
| `gameSettings.json` | Designer-owned tuning: camera margins, timing, layout, colours. Never rules. |
| `src/game/*.ts` | Pure TypeScript rules — board, slide, pathing, resolve, validate. No Pixi. |
| `src/game/GameApp.ts` | The Pixi renderer and input. |
| `src/editor/EditorApp.ts` | The in-game level editor. |
| `src/levels/builtin.ts` | The three baseline levels, authored as ASCII. |
| `src/levels/published/` | Levels published from the editor and committed here. |

## Tuning

Everything in `gameSettings.json` is safe to edit without touching code.

- `camera.margin` — distance from the 393×852 stage edge to the rect the grid is
  fitted into. Widen a side to make room for the queues that live there.
- `debug.showBeeReach` — paints every cell a bee can currently reach. On by
  default; it is the only way to see *why* a dog is refusing to move.
- `debug.showRoutes` — highlights the cells a walking dog has locked.

## Authoring levels

Menu → **Edit** on a level, or **+ Create New Level**.

- **Block**: pick a group chip, then tap cells to add them to that group. Tap
  **+ group** for a new one — two groups can sit flush and still slide apart.
- **Bone**: tap a block unit. Bones cannot exist without a block under them.
- **Wall / Bee / Off**: tap cells. *Off* is how you cut a level into islands.
- **Queue**: tap a cell whose outward side is off-grid or switched off. Tap it
  again to turn it; set the dog count in the settings row.
- Warnings appear live and never block a save.
- **Save draft** keeps it in your browser. **Publish** hands you a JSON file to
  drop in `src/levels/published/` and commit — that is what goes live for
  everyone until this prototype gets a Supabase project.

## Dev

```bash
npm install
npm run dev
npm test          # pure rules, including a walkthrough of every shipped level
npm run build     # gate before pushing
```
