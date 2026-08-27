# Soft locks

A soft lock is a board the player can reach from which the level can never be
won again. The game does not detect it. `isWon` is checked after every bite and
the only loss condition is the clock, so a locked player sits in front of a
board that will never resolve until the timer runs out and the retry button
appears. Nothing in the editor warns about it either -- `validateLevel` only
looks at counts, queues and islands, and every level below passes it clean.

`tests/softlock/analyze.ts` decides the question exhaustively rather than by
argument. It walks the whole reachable state graph -- every group, every
direction, every distance a finger could stop at, resolving dogs after each
release exactly as `GameApp` does -- and marks a state solvable when some path
from it reaches a win. Everything else is a grave. `tests/softlock.test.ts`
pins the results below.

## The only ingredient is the bee

Sliding is undoable. A group that moved by (dc, dr) can always move straight
back, because nothing else moved into the cells it left; a drag that causes no
bite is reversible, so the player can always restore any earlier arrangement.
The one thing a bite changes for good is that a unit is gone, and a missing
unit only ever adds free space.

That leaves reachability. Compare `canStepGroup` with `findRoute`: dead cells,
walls, bee *cells*, units and reservations block a block and a dog alike. The
single exception is bee *reach*, which stops a dog and does nothing to a block.
So in a bee-free level every dog sharing a region can reach every bone in that
region, each bite removes one dog and one bone from the same region, and no
bite can strand a later dog. There is nothing to get wrong except the clock.

Empirically: 1458 randomly generated winnable bee-free levels -- walls, dead
cells, islands, bone stacks, multi-unit groups, one and two queues -- produced
**zero** soft locks. The same generator with bees produces them readily.

**Rule of thumb: audit bee levels. Bee-free levels cannot be locked.**

## What edition 2 changed, and what was re-checked

Grid bones, grid dogs and bone tiers each touch something the argument above
rests on, so it was re-run rather than assumed.

- **Grid bones and grid dogs are new immovable obstacles.** Both *vanish* when
  eaten -- a grid bone when its stack empties, a grid dog when it has fed. So
  they still only ever add free space, and the reversibility argument survives
  intact. Neither can appear mid-level, and neither can move.
- **Ordering changes which bones are targetable over time**, which the argument
  never considered at all. A locked tier is an obstacle a dog can see and not
  claim, and the set of claimable bones changes as the board empties.

The argument for ordering is that tiers unlock *monotonically*: a tier opens
when the last lower-tier bone is eaten, eating only ever frees space, and no
bone can move to a higher tier. So the set of reachable bones only grows. That
is a plausible argument, and plausible arguments are what this file exists to
replace.

Re-run with the new content: **1474 randomly generated winnable bee-free
levels** -- one to three tiers, grid bones, grid dogs, queued dogs, walls, bone
stacks and multi-unit groups, on 4x3 and 5x4 boards -- produced **zero** soft
locks. `sl-tiers` in `tests/softlock.test.ts` pins one deterministic tiered
board and asserts the same thing.

**The rule of thumb stands, with its scope widened: audit bee levels. Bee-free
levels still cannot be locked, tiers and grid content included.**

Two caveats worth stating plainly. The sweep is evidence, not proof -- it is a
random search over small boards, and the earlier 1458-level result was the same
kind of evidence. And it says nothing about *difficulty*: a tiered level can
easily be tedious, or unwinnable on the clock, without ever being locked.

## `sl-no-bee` -- the trap that isn't

```
. . g A . .        A, B   bones          q0 at (0,0), 1 dog
m # # # # #        g, m, h  plain        q1 at (5,4), 1 dog
. . B . . .
# # # # # .
. . . . . h
```

Built to look like the classic disaster: the player does not choose which dog
walks or which bone it takes -- `resolveMoves` sends every leader that has a
route, and `findRoute` gives it the nearest unclaimed bone. Open `m`'s shaft
too early and q0's dog crosses the board and eats the bone q1 was waiting for.

It still cannot be locked. Once `B` is gone its cell opens and q1's dog walks
the same corridor to `A`. The board is 9824 states, none of them dead, and the
worst possible opening drag costs **one** extra drag out of four. Bee-free
levels are safe; this one is in the repo as the control case.

## `sl-one-bee` -- one bee, two doors, one plug too few

```
. . . . . .        D  plug carrying a bone      q0 at (0,0), 2 dogs
. D . . p .        p  plain plug
. # . # # .        Cc a two-unit bar, boxed in on all four sides
. # C c # .
. # # # # .
. . * . . .
```

The bee sits in the bottom room, which reaches the hall through two one-wide
doors, column 0 and column 5. Until both are shut the flood owns the hall and
no dog will move. There are exactly two blocks that can shut a door, and one of
them carries a bone.

The bar `Cc` is walled on all four sides -- it cannot move at all. So it can
never plug a door, and it can never be parked on a queue entry cell either.
That is what makes the loss permanent instead of merely awkward.

**The lock.** Plug the near door (column 0) with `D` and the far one with `p`.
The hall clears, and the nearest bone to the queue is now the plug itself. The
dog eats it, the block that was holding that door shut is destroyed with the
last bone on it, the bee floods back out, and one plug is left for two doors.
The second dog can never reach `C`. Nothing on the board can change that.

**The win** is the same three drags in the other order: run `D` all the way
down the left door to the far end, plug the right door with `p`, and the
nearest bone is now `C`. Feed that dog, then let the last dog eat the plug --
the flood that follows the last bite does not matter, the level is already won.

> The design rule this level exists to state: **a block that is holding a bee
> back must not be the nearest bone.** Put the bone plug in the far door, or
> better, do not let a bee's plug carry a bone at all.

### The second way in

`findRoute` checks for a bone sitting on the queue's own entry cell *before* it
looks at anything else -- no route is walked, so bee reach never gets a vote.
Drag `D` onto (0, 0) and the dog eats it through the flood, from where it
stands. The door it was holding is now open forever, and the level is dead in
two drags.

Any bone block that can reach a queue entry cell can be handed to a dog at any
moment, whatever the bees are doing. If that block is load-bearing, the level
goes with it.

## `sl-two-bees` -- the same trap, split

```
. . . . . .
. D . . p .
. # . # # .
* # C c # *
```

Two chambers with a bee each instead of one chamber with two mouths. It locks
the same way, and it is the shape a designer is more likely to draw by
accident: two bees tucked in two corners, two plugs to hand, one of them
carrying a bone.

## Authoring checklist

- Count the openings a bee can flood through, and count the blocks that can
  plug them. If the numbers are equal, no plug may carry a bone -- eating one
  is what takes a plug off the board permanently.
- A group boxed in on all four sides is a wall that looks like a block. Useful
  on purpose, dangerous by accident: it cannot come to the rescue later.
- Any bone block that can reach a queue entry cell will be eaten there sooner
  or later, bees or not. Keep plugs away from entry cells.
- The player does not choose which dog eats what. Whatever bone is nearest when
  the hall clears is the one that goes. Author the distances, not the intention.
- Run `analyze` over a bee level before publishing it. It is exhaustive, it is
  fast on levels this size, and it answers the only question that matters:
  is there a drag that ends the level without ending it.

## Using the levels

The three levels are JSON in `tests/softlock/levels/`, in the published-level
format. Drop one into `src/levels/published/` and commit it, or paste it into
Supabase, to play it. They are wired into `tests/softlock.test.ts` from where
they sit, so moving them will break that test.
