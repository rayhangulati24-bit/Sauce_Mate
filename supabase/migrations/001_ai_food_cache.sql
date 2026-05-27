-- Global AI sauce cache (shared by all users). Run in Supabase SQL Editor or via CLI.
create table if not exists public.ai_food_cache (
  search_key text primary key,
  term text not null,
  source text not null default 'ai',
  provider text not null,
  suggestions jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now()
);

create index if not exists ai_food_cache_generated_at_idx
  on public.ai_food_cache (generated_at desc);

alter table public.ai_food_cache enable row level security;

-- No policies: anon/authenticated clients cannot read/write.
-- The API uses SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS.
