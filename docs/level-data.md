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

`mergeLevels` layers them: builtin order first, with a same-id level from a
later source replacing one from an earlier source in place, then the rest by
name. That is how an edited baseline supersedes the original.

## Supabase: one project for the whole studio

One project, one `levels` table, and the `prototype` column namespaces every
game. Run `docs/supabase-schema.sql` once. See that file for why the key is
`(prototype, id)` and not `id`.

### The API key never ships in a player build

Reading levels needs an API key, and that key is **embedded in the client** —
in the JS bundle on GitHub Pages, or in a Unity build. It can be extracted from
either. It is not a secret; treat it as public.

It also **grants write access**, because the row policies are open. So an
extracted key lets anyone add, change or overwrite levels in *any* prototype
sharing the project.

The rules that follow:

- **Editor and dev builds only.** Keep the key in config that is excluded from
  release builds.
- **Bake levels for production.** Fetch every level for the prototype at build
  time, write them into the project, and turn the live fetch off. A shipping
  game then contains levels and no key at all.
- **The web prototypes are internal tools.** Once Supabase is wired, their key
  is in a public page. Anyone who finds the URL can write levels. Acceptable for
  a design tool — but a decision, not a surprise.

## Reading levels from Unity

No SDK needed; the REST endpoint is plain HTTP.

```
GET  {SUPABASE_URL}/rest/v1/levels?prototype=eq.dog-chase-bones&select=data
     apikey: <anon key>
     Authorization: Bearer <anon key>
```

Each row's `data` is one level document. Check `meta.schema` before parsing.

## Keeping two implementations honest

The rules of the game live in `src/game/` as pure TypeScript with tests
covering sliding, bee flood, route locking, group splitting and bone stacks.
A Unity port re-implements all of it, and small divergences — which route a dog
picks between two equal ones, whether a group splits at a corner, what happens
when two dogs want the same bone — produce levels that are solvable in the web
editor and unsolvable in Unity.

Before Unity work starts, export those test cases as a shared fixture file and
run them on both sides, so "does Unity match the prototype?" is a test result
rather than an argument.
