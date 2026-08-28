# Dog Chase Bones

Grid puzzle prototype. Slide multi-cell block groups around a grid to open a
safe path from a queue of dogs to the bones that ride those same blocks.

**Mechanics:** [maze-grid](https://github.com/rebootinteractive) path extraction,
inverted (the dog walks *in* rather than the block sliding *out*), chained with a
multi-queue system on the grid edges.

## Rules

- **A group is a connected run of same-coloured blocks.** Two lumps painted the
  same colour but not touching are two separate groups and slide independently;
  make them touch and they become one. Two *different* colours that touch stay
  separate — that is what the colour is for.
- **Block groups** are one or more unit blocks that move as a piece. Free drag:
  the group follows your finger cell by cell and stops the moment any unit hits
  a wall, another group, a bee, a dog or the grid edge.
- **Bones** ride block units, so they move with their group — or sit on a grid
  cell of their own, where they block like a wall until eaten. Either way a cell
  can carry a stack: each dog takes one, and the cell only clears when its last
  bone goes.
- **Bone tiers.** Every bone belongs to a numbered tier, and a tier cannot be
  eaten until every lower tier is gone. Locked bones are drawn greyed — visible,
  still blocking, not yet claimable. A tier unlocks when the last lower-tier
  bone is *eaten*, not when it is claimed.
- **Dogs** wait in queues on the grid boundary, or stand on the board itself.
  Only a queue's leader is live. On drag release, any dog with a safe route sets
  off on its own, walks in, eats a bone, and destroys its host unit if it had
  one. The queue then advances. A dog standing on the board blocks like a wall
  until it eats, and then it is gone.
- **A committed bone is pinned.** Once a dog sets off for a bone, that block
  group cannot be moved until it has eaten — the bone can't be pulled out from
  under it.
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
| `src/levels/published/` | Level files written by the Repo tab, under version control. |
| `plugins/repoLevels.ts` | Dev-only middleware that lets the editor read/write those files. |
| `docs/level-data.md` | The level format, and the rules for sharing it with Unity. |
| `docs/soft-locks.md` | Which levels can be made unwinnable, and why bees are the only cause. |
| `docs/supabase-schema.sql` | Run once in the shared studio project. |

## Tuning

Everything in `gameSettings.json` is safe to edit without touching code.

- `camera.margin` — distance from the 393×852 stage edge to the rect the grid is
  fitted into. Widen a side to make room for the queues that live there.
- `debug.showBeeReach` — paints every cell a bee can currently reach. On by
  default; it is the only way to see *why* a dog is refusing to move.
- `debug.showRoutes` — highlights the cells a walking dog has locked.
- `colors.tierBadge` / `tierBadgeLocked` — the bone-tier square. It is a filled
  square on purpose: the bone *count* is a round dark pip on the opposite
  corner, and two dark circles were indistinguishable at cell size. Keep these
  light enough for `colors.tierBadgeText` to read on.

## Authoring levels

The menu has three tabs, one per source, never merged:

- **Local** — this browser only. Where a new level starts.
- **Repo** — files in `src/levels/published/`, under version control. Only
  present when running `npm run dev`, because writing files needs the dev
  server. Commit and revert these with git as normal.
- **Server** — Supabase, shared with everyone. Levels here are not edited in
  place; copy one down to change it. **Delete** removes it for everyone.

A level in more than one tab is flagged with **also in …**, so you can see your
local copy has a server twin before you overwrite anyone.

**Save** writes back to whichever tab the level came from; it never moves a
level between tabs. **→ Local** / **→ Repo** copy one across, keeping the id so
a later publish replaces rather than duplicates. **Publish** sends a level to
the Server tab for everyone.

To change a published level: copy it down, edit, publish again.

**Push all to Server** on the Local or Repo tab publishes that whole tab at
once. It tells you how many are new and names the ones it would overwrite
before it starts.

### Editing tools

- **Block**: pick a group chip, then tap cells to paint with that colour. Tap
  **+ group** for a new one. Two *different* colours can sit flush and stay
  independent; two lumps of the *same* colour are separate groups until you
  paint them together.
- **Move**: drag a whole block group somewhere else. Green means it fits, red
  means it does not, and an invalid drop puts it back.
- **Bone**: tap a block for a bone that rides it, or bare ground for one that
  sits on the grid and blocks like a wall. Shift-tap takes one off. Up to 9 per
  cell, shown as a count. The tier chips set which tier new bones join, and a
  tier badge only appears once a level uses more than one.
- **Dog**: tap a cell to stand a dog on the board. It blocks until it eats.
  A warning appears if a bee can reach it, since it could never set off.
- **Wall / Bee / Off**: tap cells. *Off* is how you cut a level into islands.
- **Queue**: tap a boundary cell to add one. Tap it again to select it, then tap
  for one more dog and shift-tap for one fewer — the same gesture the Bone tool
  uses for a stack. Turn and Remove stay buttons, so a stray tap cannot destroy
  a queue you were only editing.
- Warnings appear live and never block a save.

**Keyboard (desktop):**

| key | does |
| --- | --- |
| `1`–`9` | pick a tool: Block, Move, Bone, Wall, Bee, Off, Queue, Dog, Erase |
| `⇧1`–`⇧9` | pick a paint colour (Block tool) or a bone tier (Bone tool) |

**Download all** saves every level in the current tab as its own `.json`.

## Dev

```bash
npm install
npm run dev
npm test          # pure rules, including a walkthrough of every shipped level
npm run build     # gate before pushing
```
