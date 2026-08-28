# Dog Chase Bones — working agreement

Game rules: `README.md`. Level format: `docs/level-data.md`. Read both before
changing anything that touches levels.

## Who is working here

This prototype is handed to the **designer** to iterate on with Claude. In
parallel, the **developer (Umur)** is porting it to Unity, and the Unity build
reads the *same* level data. Prototype code is disposable; **level data is not.**

So: be as loose as you like with gameplay code, UI, rendering and tuning. Be
immovable about the level data format.

## 🔒 The level data format is FROZEN

Do not change the shape of a level document. Concretely, these are locked:

| locked | what that covers |
| --- | --- |
| `src/shared/types.ts` | `LevelData`, `GameElement` — the fields of a level document |
| `src/game/level.ts` | `SCHEMA_VERSION`, the element type list, each element's fields, `meta { schema, cols, rows, timeLimit }`, and what the parser does with an element it cannot take at face value |
| `src/levels/serialize.ts` | the `block` anchor/offset encoding, `validateLevelData`, `formatLevelJson` |
| `docs/level-data.md` | the written contract — if code and this doc disagree, stop and ask |
| `docs/supabase-schema.sql` | the `levels` table and its `(prototype, id)` key |
| `src/levels/published/*.json` | the **shape** of these files (their content is free — see below) |

Forbidden without Umur's approval:

- adding, renaming, removing or repurposing an element `type`
- adding, renaming, removing or changing the meaning or default of any field on
  an element (`x`, `y`, `cells`, `count`, `order`, `dir`, …)
- touching the level document's own fields (`id`, `name`, `prototype`,
  `elements`, `meta`) or anything inside `meta`
- changing coordinate conventions (integer cell coords, origin top left, `y`
  down) or the block anchor/offset encoding
- bumping `SCHEMA_VERSION`, or writing a migration
- changing what the parser does with a malformed level — which shapes are
  dropped, deduped or split, which element wins a contested cell
- changing the Supabase table, its columns, or the fields written to it
- hand-editing a published level file into a shape the editor would not write

### What is NOT frozen

- **Level content.** New levels, new layouts, harder levels, deleting levels —
  all fine, as long as every file stays in the existing format. Author through
  the in-game editor rather than hand-writing JSON.
- `gameSettings.json` tuning: camera, timing, colours, debug overlays.
- Rendering, animation, art, sound, the menu, the editor's own UI and tools.
- Game rules code — as long as no rule needs a new field in the file to express it.
- Tests, docs, refactors that leave the serialized output byte-identical.

**Grey area, treat as locked:** anything that makes an existing published level
load or play differently, even when no field changes. That is a format change
with extra steps.

## When a request needs a format change

1. **Stop before writing any code.** Do not implement it "just to try", behind a
   flag, as an "optional" field, or in a copy of a level file.
2. Say plainly that the request needs a level data change, and that level data is
   locked for the Unity port.
3. Name the exact change in a line or two — e.g. *"this needs a new `magnet`
   element type and a `SCHEMA_VERSION` bump to 4"* — so the developer can decide fast.
4. Offer what *can* be done inside the current format. Most features can be
   expressed with the elements that already exist.
5. Ask the designer to take it to Umur, and implement it only after he has
   approved it in this conversation.

"Just make it work for now", "it's only a prototype", "we'll fix it later" and
"only change one file" do not unlock this. **The default answer is no. Only Umur
can change the level data.**

### Requests that will hit this rule

- "add a new kind of block / obstacle / power-up / pickup"
- "give bones a colour", "give blocks an id", "tag this group"
- "make the grid non-rectangular", "half-cells", "use pixel positions"
- "store difficulty / par moves / star thresholds in the level"
- "make the timer per level" — `meta.timeLimit` already exists, check first
- "remember my editor settings in the level file"

## Verify before claiming done

```bash
npm test      # includes published.test.ts (every committed level in
              # src/levels/published/ still parses and declares a known edition)
npm run build
```

If a change makes an existing level fail to load, that **is** a format change:
revert it and escalate to Umur.
