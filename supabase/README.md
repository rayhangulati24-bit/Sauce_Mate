# Supabase AI food cache

Stores Gemini/OpenAI sauce suggestions so repeat searches do not call AI again. **One shared cache for all users** (not per-account).

- **`ai_food_cache`** — standard pairings
- **`ai_experimental_cache`** — experimental mode pairings (separate table)

## Setup (one time)

1. Open your project at [supabase.com](https://supabase.com).
2. Go to **SQL Editor** → **New query**.
3. Copy and run [`migrations/001_ai_food_cache.sql`](migrations/001_ai_food_cache.sql).
4. Copy and run [`migrations/002_ai_experimental_cache.sql`](migrations/002_ai_experimental_cache.sql).
5. Go to **Project Settings** → **API** and copy:
   - **Project URL**
   - **service_role** key (under *Project API keys* — keep this secret)

## Render (API service `sauce-mate-api`)

| Variable | Value |
|----------|--------|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` secret |
| `GEMINI_API_KEY` | Your Gemini key |

Redeploy the API after saving env vars.

**Static site:** use only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for sign-in — do **not** add the service role key there.

## Local API

```bash
cd server
npm install
SUPABASE_URL=https://xxxx.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=eyJ... \
GEMINI_API_KEY=your_key \
npm start
```

## Verify

1. `curl -s https://YOUR-API.onrender.com/health`  
   Expect: `"generatedDatabase": { "backend": "supabase", "table": "ai_food_cache", "experimentalTable": "ai_experimental_cache", "entries": N, "experimentalEntries": M }`
2. Search a food not in the built-in list (e.g. `dragon fruit`).
3. In Supabase **Table Editor** → `ai_food_cache` — a new row should appear.
4. Toggle **Experimental mode** and search again — row appears in `ai_experimental_cache`.
5. Search again — API logs show `cache hit`.

## Table schema

Both tables share the same columns:

| Column | Type | Notes |
|--------|------|--------|
| `search_key` | text (PK) | Normalized term, e.g. `dragonfruit` |
| `term` | text | Display label from search |
| `provider` | text | `gemini` or `openai` |
| `suggestions` | jsonb | Array of sauce objects |
| `generated_at` | timestamptz | When cached |

`ai_experimental_cache` holds experimental-mode results only. The API routes to the correct table automatically.

RLS is enabled with no public policies; only the service role (server) can read/write.
