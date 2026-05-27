import { createClient } from "@supabase/supabase-js";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GENERATED_DB_FILE =
  process.env.GENERATED_FOOD_DB_FILE ||
  path.join(__dirname, "data", "generatedFoodDatabase.json");

const TABLE = "ai_food_cache";

let generatedFoodDatabase = {};
let generatedDatabaseWriteQueue = Promise.resolve();
let supabase = null;
let cacheBackend = "file";
let supabaseEntryCount = null;

/** Align with frontend foodDatabase matching: lowercase, no spaces. */
export function normalizeSearchTerm(term) {
  return String(term || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function normalizeSupabaseUrl(url) {
  if (!url || typeof url !== "string") return "";
  let u = url.trim();
  u = u.replace(/\/rest\/v1\/?$/i, "");
  return u.replace(/\/+$/, "");
}

function createSupabaseAdmin() {
  const url = normalizeSupabaseUrl(process.env.SUPABASE_URL || "");
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  try {
    return createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch (e) {
    console.warn("Supabase client init failed:", e.message);
    return null;
  }
}

function rowToCacheEntry(row) {
  if (!row) return null;
  return {
    term: row.term,
    source: row.source || "ai",
    provider: row.provider,
    generatedAt: row.generated_at,
    suggestions: Array.isArray(row.suggestions) ? row.suggestions : [],
  };
}

function rekeyGeneratedFoodDatabase() {
  const next = {};
  for (const [key, entry] of Object.entries(generatedFoodDatabase)) {
    const normalizedKey =
      normalizeSearchTerm(entry?.term) || normalizeSearchTerm(key);
    if (!normalizedKey) continue;
    if (!next[normalizedKey]) {
      next[normalizedKey] = entry;
    }
  }
  const changed =
    Object.keys(next).length !== Object.keys(generatedFoodDatabase).length ||
    Object.keys(next).some((k) => generatedFoodDatabase[k] !== next[k]);
  generatedFoodDatabase = next;
  return changed;
}

async function writeGeneratedFoodDatabase() {
  await fs.mkdir(path.dirname(GENERATED_DB_FILE), { recursive: true });
  const tmpFile = `${GENERATED_DB_FILE}.tmp`;
  await fs.writeFile(
    tmpFile,
    `${JSON.stringify(generatedFoodDatabase, null, 2)}\n`,
    "utf8"
  );
  await fs.rename(tmpFile, GENERATED_DB_FILE);
}

async function loadGeneratedFoodDatabaseFromFile() {
  try {
    const raw = await fs.readFile(GENERATED_DB_FILE, "utf8");
    const parsed = JSON.parse(raw);
    generatedFoodDatabase =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};
    if (rekeyGeneratedFoodDatabase()) {
      generatedDatabaseWriteQueue = generatedDatabaseWriteQueue
        .catch(() => {})
        .then(writeGeneratedFoodDatabase);
    }
  } catch (e) {
    if (e.code !== "ENOENT") {
      console.warn("Could not load generated food database file:", e.message);
    }
    generatedFoodDatabase = {};
  }
}

async function migrateFileCacheToSupabase() {
  const entries = Object.entries(generatedFoodDatabase);
  if (!supabase || entries.length === 0) return;

  const rows = entries.map(([searchKey, entry]) => ({
    search_key: normalizeSearchTerm(entry?.term) || searchKey,
    term: String(entry.term || searchKey).trim(),
    source: entry.source || "ai",
    provider: entry.provider || "unknown",
    suggestions: entry.suggestions ?? [],
    generated_at: entry.generatedAt || new Date().toISOString(),
  }));

  const { error } = await supabase.from(TABLE).upsert(rows, {
    onConflict: "search_key",
  });
  if (error) {
    console.warn("Could not migrate file cache to Supabase:", error.message);
    return;
  }
  console.log(`Migrated ${rows.length} file cache entries to Supabase`);
}

async function refreshSupabaseEntryCount() {
  if (!supabase) {
    supabaseEntryCount = null;
    return;
  }
  const { count, error } = await supabase
    .from(TABLE)
    .select("*", { count: "exact", head: true });
  if (error) {
    console.warn("Could not count Supabase cache entries:", error.message);
    supabaseEntryCount = null;
    return;
  }
  supabaseEntryCount = count ?? 0;
}

const generatedDatabaseReady = (async () => {
  supabase = createSupabaseAdmin();
  if (supabase) {
    cacheBackend = "supabase";
    console.log("AI cache backend: Supabase (ai_food_cache)");
    await loadGeneratedFoodDatabaseFromFile();
    await migrateFileCacheToSupabase();
    await refreshSupabaseEntryCount();
    return;
  }
  cacheBackend = "file";
  console.log(
    "AI cache backend: local file (set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for Supabase)"
  );
  await loadGeneratedFoodDatabaseFromFile();
})();

async function getGeneratedSuggestionFromSupabase(searchKey) {
  const { data, error } = await supabase
    .from(TABLE)
    .select("term, source, provider, suggestions, generated_at")
    .eq("search_key", searchKey)
    .maybeSingle();

  if (error) {
    console.warn("Supabase cache read failed:", error.message);
    return null;
  }
  return rowToCacheEntry(data);
}

async function saveGeneratedSuggestionToSupabase(
  searchKey,
  term,
  provider,
  payload
) {
  const row = {
    search_key: searchKey,
    term: String(term).trim(),
    source: "ai",
    provider,
    suggestions: payload.suggestions,
    generated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from(TABLE).upsert(row, {
    onConflict: "search_key",
  });
  if (error) {
    console.warn("Supabase cache write failed:", error.message);
    return false;
  }
  await refreshSupabaseEntryCount();
  return true;
}

export async function getGeneratedSuggestion(term) {
  await generatedDatabaseReady;
  const searchKey = normalizeSearchTerm(term);
  if (!searchKey) return null;

  if (supabase) {
    const fromDb = await getGeneratedSuggestionFromSupabase(searchKey);
    if (fromDb) return fromDb;
  }

  return generatedFoodDatabase[searchKey] || null;
}

export async function saveGeneratedSuggestion(term, provider, payload) {
  await generatedDatabaseReady;
  const searchKey = normalizeSearchTerm(term);
  if (!searchKey) return;

  const entry = {
    term: String(term).trim(),
    source: "ai",
    provider,
    generatedAt: new Date().toISOString(),
    suggestions: payload.suggestions,
  };

  if (supabase) {
    const saved = await saveGeneratedSuggestionToSupabase(
      searchKey,
      term,
      provider,
      payload
    );
    if (saved) return;
  }

  generatedFoodDatabase[searchKey] = entry;
  generatedDatabaseWriteQueue = generatedDatabaseWriteQueue
    .catch(() => {})
    .then(writeGeneratedFoodDatabase);

  try {
    await generatedDatabaseWriteQueue;
  } catch (e) {
    console.warn("Could not save generated food database file:", e.message);
  }
}

export async function getGeneratedCacheHealth() {
  await generatedDatabaseReady;

  if (cacheBackend === "supabase") {
    if (supabaseEntryCount === null) {
      await refreshSupabaseEntryCount();
    }
    return {
      backend: "supabase",
      table: TABLE,
      entries: supabaseEntryCount ?? 0,
      fileFallback: GENERATED_DB_FILE,
    };
  }

  return {
    backend: "file",
    entries: Object.keys(generatedFoodDatabase).length,
    file: GENERATED_DB_FILE,
  };
}
