-- Experimental AI sauce cache (separate from standard ai_food_cache).
-- Run in Supabase SQL Editor or via CLI after 001_ai_food_cache.sql.

create table if not exists public.ai_experimental_cache (
  search_key text primary key,
  term text not null,
  source text not null default 'ai',
  provider text not null,
  suggestions jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now()
);

create index if not exists ai_experimental_cache_generated_at_idx
  on public.ai_experimental_cache (generated_at desc);

alter table public.ai_experimental_cache enable row level security;

-- No policies: anon/authenticated clients cannot read/write.
-- The API uses SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS.

-- Move any legacy experimental rows from ai_food_cache (search_key ended with :experimental).
insert into public.ai_experimental_cache (
  search_key,
  term,
  source,
  provider,
  suggestions,
  generated_at
)
select
  regexp_replace(search_key, ':experimental$', ''),
  term,
  source,
  provider,
  suggestions,
  generated_at
from public.ai_food_cache
where search_key like '%:experimental'
on conflict (search_key) do update set
  term = excluded.term,
  source = excluded.source,
  provider = excluded.provider,
  suggestions = excluded.suggestions,
  generated_at = excluded.generated_at;

delete from public.ai_food_cache
where search_key like '%:experimental';
