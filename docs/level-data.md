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
    "schema": 1,                  // edition of this format — read this first
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
| `bone` | `x, y, count?` | rides the block in the same cell; `count` defaults to 1 |
| `queue` | `x, y, dir, count` | entry cell; dogs line up towards `dir` |

`dir` is one of `up`, `right`, `down`, `left`.

A **group** is a *connected run of same-coloured blocks*, not the colour itself.
Two lumps painted the same colour but not touching are two separate groups. Any
reader must compute connected components rather than grouping by colour.

## `schema` — read this before anything else

`meta.schema` is the edition of the format. A reader must refuse an edition it
does not know, rather than doing its best with it.

This matters because format changes are usually *survivable-looking*. Bones
changed from a yes/no into a count; old levels kept working only because the
new reader was written to treat a missing `count` as 1. The next change might
not be so forgiving, and a level that loads and plays **wrong** costs far more
than one that refuses to load.

Bump `SCHEMA_VERSION` in `src/game/level.ts` on any change an older reader would
misinterpret. Levels with no `schema` field predate it and are edition 1.

## Where levels live

1. **Builtin** — `src/levels/builtin.ts`, ship in the bundle, never need network.
2. **Published** — `src/levels/published/*.json`, committed to the repo.
3. **Drafts** — the editor's Save, kept in that one browser's localStorage.
4. **Supabase** — once configured, shared live with everyone.

`mergeLevels` layers them in that order: a same-id level from a later layer
replaces one from an earlier layer in place, then the rest follow by name. That
is how an edited baseline supersedes the original, and how a local draft shadows
the published copy of the level you are editing.

**Drafts are always local, whether or not Supabase is configured.** `LevelStore`
holds two backends: drafts (localStorage) and published (Supabase, or none).
Save writes to the first, Publish to the second. They are kept apart so that
connecting Supabase cannot silently turn a private Save into a live publish —
Publish stays a deliberate second step, which is the authoring model the studio
chose.

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
