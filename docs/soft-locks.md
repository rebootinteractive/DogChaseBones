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

## Two ways to lose a level for good

Both turn on a bite. A bite is the only thing on this board that cannot be
undone: sliding is reversible -- a group that moved can always move straight
back, because nothing else moved into the cells it left -- so up to the moment a
dog eats, the player can always restore any earlier arrangement.

**1. A bee whose plug carries a bone.** Eating it destroys the block that was
sealing the flood, and there is no putting it back. See `sl-one-bee`.

**2. A frozen group.** A block group boxed in on all four sides cannot move: it
is a wall the level never declared. Unlike a wall, a bite can *unfreeze* it,
because a group that loses a unit is smaller and may suddenly fit where it did
not. That makes it a one-way door whose key is the bone riding it -- and if only
one dog can reach that bone, spending that dog anywhere else shuts the door for
good. No bee involved. See `SoftLock`.

The second one is the dangerous one, because nothing about it looks like a
hazard. There is no flood painted on the board, no warning in the editor, and
the group that does the damage is drawn exactly like every other block.

### A claim this document used to make

An earlier version of this page argued that a soft lock *required* a bee, on the
grounds that bee reach is the only obstacle that stops a dog and not a block,
and that a bite only ever frees space and so can never strand a dog.

Both of those statements are true. The conclusion drawn from them was not, for
two reasons:

- **Blocks do partition the board.** The argument assumed any block can be
  dragged aside. A frozen group cannot, so two dogs can be in genuinely
  different regions with no bee anywhere.
- **Freeing space later is no use to a dog already spent.** A bite really does
  only open the board up -- but if the bite that opens it is the same bite a
  particular dog needed, and it goes to another dog, the region opens with
  nobody left to use it.

A sweep of ~1,500 random bee-free levels found no locks, which was taken as
support. It was not: random placement essentially never produces a wall-boxed
multi-cell bar carrying a bone at its far end with the two queues on opposite
sides of it. That was evidence about the generator, not about the game.

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

It still cannot be locked -- not because it has no bee, but because nothing in
it is frozen. Once `B` is gone its cell opens, and any block in the way can be
dragged aside, so q1's dog walks the same corridor to `A`. The board is 9824
states, none of them dead, and the worst possible opening drag costs **one**
extra drag out of four. It is in the repo as the control case: the same theft
that is merely annoying here is permanent in `SoftLock`.

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

## `SoftLock` -- a frozen bar, and no bee

```
. . . . # # .        g1  a three-wide bar, bone on its right end
. . . . # . .        g2  one block, one bone
# . # # # . .        g3  one block, parked on the bottom-right queue's entry
a a A # B . .
# . . . . . c        q0 at (0,0) up, 1 dog   ·   q1 at (6,4) right, 1 dog
```

`g1` is boxed in by walls above at `(0,2)` and `(2,2)`, below at `(0,4)`, right
at `(3,3)`, and the grid edge on the left. **It cannot step in any direction.**
It is also the only route between the top-left room and the bottom corridor: the
top-left dog's region is that room plus `(1,2)`, and the way down from `(1,2)` is
`(1,3)` -- inside the bar.

So the top-left dog is sealed in, and only the bottom-right dog can reach the
bone the bar carries, from `(2,4)`. Eating it shrinks the bar to two cells, which
*can* move, which is what finally lets the other dog out. **That one bite is the
key to the door.**

**The lock.** `g3` sits on the bottom-right queue's entry cell. The moment it is
dragged off, that dog is live and takes the nearest bone -- `g2`'s, two steps
away, the wrong one. The bar keeps its bone, stays frozen, and the top-left dog
never gets out. **156 of the 306 legal opening drags lose the level outright.**

**The win** is three drags: send `g2`'s bone up to the top-right corner, park
`g3` in the right column so it walls that corner off, and the bottom-right dog is
forced left along the corridor onto the bar's bone instead. Then the two-cell
remnant can be dragged clear -- out of the corridor, not into it, or it just
becomes the next wall -- and the top-left dog walks the long way round.

> The design rule: **a group that cannot move is a wall, and a bite can turn it
> into a door.** Check which dogs can reach the key, and whether anything else
> can spend them first.

## Authoring checklist

- **Look for frozen groups first.** `frozenGroups` in the analyzer lists every
  group that cannot move at all. Each one is a wall you did not draw. For each,
  ask which dogs can reach the bones on it, and whether any other dog can be
  spent on those bones first.
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

The three bee levels are JSON in `tests/softlock/levels/`, in the
published-level format. Drop one into `src/levels/published/` and commit it, or
paste it into Supabase, to play it. `SoftLock` is already published, at
`src/levels/published/softlock.json`. All four are wired into
`tests/softlock.test.ts` from where they sit, so moving them breaks that test.
