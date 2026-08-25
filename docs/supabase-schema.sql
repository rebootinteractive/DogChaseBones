-- Run once in the shared studio Supabase project (SQL editor).
create table if not exists public.levels (
  id text primary key,
  prototype text not null,
  name text not null,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists levels_prototype_idx on public.levels (prototype);

alter table public.levels enable row level security;

-- Open policy: prototyping has no auth. Tighten later if needed.
create policy "anon read"   on public.levels for select using (true);
create policy "anon insert" on public.levels for insert with check (true);
create policy "anon update" on public.levels for update using (true) with check (true);
-- No delete policy: anon cannot delete rows. Intentional.
