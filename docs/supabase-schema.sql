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

alter table public.levels enable row level security;

-- Open policy: prototyping has no auth. Tighten later if needed.
create policy "anon read"   on public.levels for select using (true);
create policy "anon insert" on public.levels for insert with check (true);
create policy "anon update" on public.levels for update using (true) with check (true);
-- No delete policy: anon cannot delete rows. Intentional.
