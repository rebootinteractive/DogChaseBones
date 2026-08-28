# Level data — the contract between programs

A level is a JSON document. More than one program reads it: the web prototype
today, a Unity build later, months apart and in different languages. Everything
here exists to stop those two quietly disagreeing.

## Shape

```jsonc
{
  "id": "custom-7c2f55c0-…",     // unique within this prototype, not globally
  "name": "MultipleBones",
  "prototype": "dog-chase-bones", // which game this level belongs to
  "elements": [ /* see below */ ],
  "meta": {
    "schema": 2,                  // edition of this format — read this first
    "cols": 6,
    "rows": 7,
    "timeLimit": 120
  }
}
```

`x` and `y` on every element are **integer cell coordinates**, not pixels and
not normalized — the camera fits the grid at runtime, so a fraction of the
screen would mean nothing.

| element | fields | meaning |
| --- | --- | --- |
| `dead` | `x, y` | cell switched off; how a level gets more than one island |
| `wall` | `x, y` | static, unmovable, blocks everything |
| `bee` | `x, y` | fixed; poisons every cell it can reach |
| `block` | `x, y, group` | one unit block painted with colour `group` |
| `bone` | `x, y, count?, order?` | rides the block in the same cell; `count` defaults to 1 |
| `gridBone` | `x, y, count?, order?` | sits on the grid itself; blocks everything until eaten |
| `gridDog` | `x, y` | a dog standing on the board; blocks everything until it eats |
| `queue` | `x, y, dir, count` | entry cell; dogs line up towards `dir` |

`dir` is one of `up`, `right`, `down`, `left`.

A **group** is a *connected run of same-coloured blocks*, not the colour itself.
Two lumps painted the same colour but not touching are two separate groups. Any
reader must compute connected components rather than grouping by colour.

A `gridBone` owns its cell outright: it is dropped if anything else already
holds that cell, where an ordinary `bone` is dropped if a block does *not*.
A `gridDog` carries no count — one element is one dog, because a stack of dogs
on one cell would have nowhere to stand.

## `order` — bone tiers

Every bone carries an activation tier. `order` defaults to **1**, and a bone
with no `order` is tier 1 — which is why every level written before edition 2
plays unchanged.

A tier is edible once every **lower** tier is gone. The active tier is the
lowest one still on the board, so tiers are relative to what remains rather
than to the number 1: with only tiers 2 and 5 left, tier 2 is active. Gaps are
legal and mean nothing — 1 and 3 with no 2 is simply two tiers.

A **claimed** bone still counts as remaining. A tier unlocks when the last
lower-tier bone is *eaten*, not when the last one is spoken for. Within a
single drag release, a dog cannot set off for tier 2 while another is still
walking to the last tier-1 bone.

**One tier per cell.** A cell's whole stack shares one `order`. Repeated bone
elements on a cell add up their `count`; the first `order` seen wins, so the
result does not depend on element order in the file.

A locked bone still blocks everything — block groups, dog routes and bee flood
alike. It is an obstacle you can see but cannot yet claim.

## `schema` — read this before anything else

`meta.schema` is the edition of the format. A reader must refuse an edition it
does not know, rather than doing its best with it.

This matters because format changes are usually *survivable-looking*. Bones
changed from a yes/no into a count; old levels kept working only because the
new reader was written to treat a missing `count` as 1. The next change might
not be so forgiving, and a level that loads and plays **wrong** costs far more
than one that refuses to load.

Bump `SCHEMA_VERSION` in `src/game/level.ts` on any change an older reader would
misinterpret. Levels with no `schema` field predate it and are edition 1, and
so does a level whose `schema` is unreadable — the fallback is deliberately the
*oldest* edition, not the current one, so a garbled field cannot suppress the
"newer editor" warning for the one file most likely to need it.

**Edition 2** added bone tiers (`order`) and the `gridBone` and `gridDog`
elements. An edition-1 level is a valid edition-2 level with every bone on
tier 1, which is why the reader needs no migration step. Committed level files
are *not* expected to be the current edition — `tests/published.test.ts` checks
each one declares an edition this build understands, not that it matches
`SCHEMA_VERSION`.

## Where levels live — three separate places

The menu has a tab per source, and they are **never merged**. Merging was a bug:
a local copy replaced a same-id level from the server, so a colleague's
published edit vanished behind an older local one with nothing on screen to say
so. A level that exists in more than one source is now flagged, not hidden.

| tab | where | editable | deletable | who sees it |
| --- | --- | --- | --- | --- |
| **Local** | this browser's `localStorage` | yes | yes | only you |
| **Repo** | `src/levels/published/*.json` | yes | yes | whoever pulls the repo |
| **Server** | Supabase | no | yes | everyone |

**Repo is available only under `npm run dev`.** A browser cannot write to disk,
so the Repo tab talks to a middleware the Vite dev server installs
(`plugins/repoLevels.ts`, `apply: 'serve'`). The deployed build has no server, so
the tab is simply absent there — enforcement by architecture, not by a flag.
Everything it writes is an ordinary file: git sees it, and the designer commits,
diffs and reverts it as usual.

Filenames follow the level's *name*, so a diff is readable. A level keeps its
file across saves, a rename moves the file rather than orphaning it, and a name
another level already uses gets a numeric suffix. The middleware refuses any
filename that is not a bare kebab-case `.json`, so nothing can be written
outside the levels directory.

**A server level is not edited in place.** To revise one, copy it down to Local
or Repo with the `→` button, edit it, and publish again. The copy keeps the same
id, so publishing replaces rather than duplicates.

**Deleting a server level is possible, and removes it for everyone** with no
undo. It needs the delete grant and policy in `docs/supabase-schema.sql`; on a
project set up before 2026-08-28 those must be added by hand, and until they are
`remove()` fails loudly rather than appearing to succeed — PostgREST reports a
delete that matched no rows exactly as it reports one that did.

**Push all** on the Local or Repo tab publishes that whole tab to the server in
one go, upserting by `(prototype, id)`. It names the levels it is about to
overwrite before it does anything, since those are a colleague's published
copies.

**Ids are the identity.** The same id in two tabs is the same level in two
places — that is what the "also in" flag means. Saving in one tab never touches
the others.

## Supabase: one project for the whole studio

One project, one `levels` table, and the `prototype` column namespaces every
game. Run `docs/supabase-schema.sql` once. See that file for why the key is
`(prototype, id)` and not `id`.

### The API key — studio policy

The key is treated as **public**. It lives in the repo and in development
builds, and it is removed by hand for a production build. This is a deliberate
decision, taken knowing what it means:

- The key is embedded in the client — the JS bundle on GitHub Pages, or a Unity
  build — and extractable from either.
- It **grants write access**, because the row policies are open. Anyone holding
  it can add, change or overwrite levels in any prototype sharing the project.
- The web prototypes are internal design tools. Their key is in a public page.

What that requires in practice:

- **Unity:** the URL and key are a public serialized field, visible in the
  Inspector alongside the prototype id and the `UseSupabaseLevels` toggle.
  Cleared before a production build.
- **Bake levels for production.** Fetch every level for the prototype at build
  time, write them into the project, and turn the live fetch off. A shipping
  game then carries levels and no key.
- **Rotation is the remedy, not deletion.** A key committed to a public repo is
  in that repo's history permanently; deleting the file later does not remove
  it. If a key ever needs to stop working, roll it in the Supabase dashboard —
  do not rely on scrubbing it from the tree.

## Reading levels from Unity

No SDK needed; the REST endpoint is plain HTTP.

```
GET  {SUPABASE_URL}/rest/v1/levels?prototype=eq.dog-chase-bones&select=data
     apikey: <anon key>
     Authorization: Bearer <anon key>
```

Each row's `data` is one level document. Check `meta.schema` before parsing.

## Two implementations — studio policy

The rules of the game live in `src/game/` as pure TypeScript, with tests
covering sliding, bee flood, route locking, group splitting and bone stacks.
A Unity port re-implements all of it, and small divergences — which route a dog
picks between two equal ones, whether a group splits at a corner, what happens
when two dogs want the same bone — produce levels that are solvable in the web
editor and unsolvable in Unity.

The accepted approach:

- **This prototype is the reference implementation.** The Unity workspace keeps
  it to hand, and it stays deployed and playable — a reference you can run
  beats a reference you read. The tests in `tests/` are the precise part of the
  specification; where prose and tests disagree, the tests win.
- **Feature lock during Unity production.** The mechanic stops moving once the
  port begins.
- **A change during production is made on both sides, or the prototype
  retires** and development moves wholly to Unity.

This is a known and accepted production risk rather than an oversight. If it
starts costing real time, the fallback is to export the test fixtures as a
shared file and run them on both sides, turning "does Unity match?" into a test
result instead of an argument.
