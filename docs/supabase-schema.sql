-- Run once in the shared studio Supabase project (SQL editor).
-- One table for every prototype in the studio. The `prototype` column is the
-- namespace: each game reads and writes only its own rows.
--
-- The key is (prototype, id), NOT id alone. A level id only has to be unique
-- within a game. Editor-made levels get a random id, but a level made by
-- editing a builtin keeps the builtin's id -- and the starter ships ids like
-- 'b1-tutorial'. With a global key, two games editing their own first tutorial
-- would write the same row: the second silently overwrites the first, and
-- because the row carries the other game's prototype, the level does not just
-- change, it vanishes from the first game's list.
create table if not exists public.levels (
  id text not null,
  prototype text not null,
  name text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (prototype, id)
);

create index if not exists levels_prototype_idx on public.levels (prototype);

-- Two separate locks guard this table, and both must be opened.
--
-- 1. GRANTs decide whether the API can see the table at all. Newer projects do
--    not expose new tables automatically (and from 30 May 2026 that is the
--    default), so these are stated explicitly rather than relying on the
--    "Automatically expose new tables" setting. Harmless if it is already on.
grant usage on schema public to anon;
grant select, insert, update, delete on public.levels to anon;

-- 2. Row Level Security decides which rows it may touch once it can see them.
alter table public.levels enable row level security;

-- Open policy: prototyping has no auth. Tighten later if needed.
create policy "anon read"   on public.levels for select using (true);
create policy "anon insert" on public.levels for insert with check (true);
create policy "anon update" on public.levels for update using (true) with check (true);
create policy "anon delete" on public.levels for delete using (true);

-- Delete was withheld until 2026-08-28, then granted deliberately. The reasoning:
-- the anon key is public by studio policy and already carries `update`, so
-- anyone holding it can already overwrite any level with garbage. Delete does
-- not create the destructive capability; it removes the row as well as the
-- content. Recovery for either is the same -- restore from the repo copy or
-- from a Supabase backup -- so withholding delete bought a smaller safety
-- margin than it appeared to, at the cost of levels nobody could clear out.
--
-- Rerun note: `create policy` has no `if not exists`. On an existing project
-- run just the grant and this one policy, not the whole file.
