import { createClient } from "@supabase/supabase-js";
import { WebSocket as NodeWebSocket } from "ws";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

if (!globalThis.WebSocket) {
  globalThis.WebSocket = NodeWebSocket;
}

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
let supabaseConfiguredFromEnv = false;
let supabaseUrlHost = null;
let supabaseKeyRole = null;
let lastSupabaseError = null;

/** Align with frontend foodDatabase matching: lowercase, no spaces. */
export function normalizeSearchTerm(term) {
  return String(term || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function cacheSearchKey(term, experimental = false) {
  const base = normalizeSearchTerm(term);
  if (!base) return "";
  return experimental ? `${base}:experimental` : base;
}

function normalizeSupabaseUrl(url) {
  if (!url || typeof url !== "string") return "";
  let u = url.trim();
  u = u.replace(/\/rest\/v1\/?$/i, "");
  return u.replace(/\/+$/, "");
}

function decodeJwtPayload(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function createSupabaseAdmin() {
  const url = normalizeSupabaseUrl(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ""
  );
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  supabaseConfiguredFromEnv = Boolean(url || key);
  supabaseUrlHost = url ? new URL(url).host : null;
  const payload = decodeJwtPayload(key);
  supabaseKeyRole = payload?.role || null;

  if (!url || !key) {
    if (supabaseConfiguredFromEnv) {
      lastSupabaseError =
        "Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.";
    }
    return null;
  }
  if (supabaseKeyRole && supabaseKeyRole !== "service_role") {
    lastSupabaseError = `Invalid Supabase key role "${supabaseKeyRole}". Use SUPABASE_SERVICE_ROLE_KEY (service_role), not anon key.`;
    return null;
  }
  try {
    return createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch (e) {
    lastSupabaseError = `Supabase client init failed: ${e.message}`;
    console.warn(lastSupabaseError);
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
    lastSupabaseError = `Could not migrate file cache to Supabase: ${error.message}`;
    console.warn(lastSupabaseError);
    return;
  }
  lastSupabaseError = null;
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
    lastSupabaseError = `Could not count Supabase cache entries: ${error.message}`;
    console.warn(lastSupabaseError);
    supabaseEntryCount = null;
    return;
  }
  lastSupabaseError = null;
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
  if (supabaseConfiguredFromEnv) {
    cacheBackend = "supabase_misconfigured";
    console.warn(
      `AI cache backend misconfigured${
        lastSupabaseError ? `: ${lastSupabaseError}` : "."
      }`
    );
    await loadGeneratedFoodDatabaseFromFile();
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
    lastSupabaseError = `Supabase cache read failed: ${error.message}`;
    console.warn(lastSupabaseError);
    return null;
  }
  lastSupabaseError = null;
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
    lastSupabaseError = `Supabase cache write failed: ${error.message}`;
    console.warn(lastSupabaseError);
    return false;
  }
  lastSupabaseError = null;
  await refreshSupabaseEntryCount();
  return true;
}

export async function getGeneratedSuggestion(term, experimental = false) {
  await generatedDatabaseReady;
  const searchKey = cacheSearchKey(term, experimental);
  if (!searchKey) return null;

  if (supabase) {
    const fromDb = await getGeneratedSuggestionFromSupabase(searchKey);
    if (fromDb) return fromDb;
  }

  return generatedFoodDatabase[searchKey] || null;
}

export async function saveGeneratedSuggestion(term, provider, payload, experimental = false) {
  await generatedDatabaseReady;
  const searchKey = cacheSearchKey(term, experimental);
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
    throw new Error(
      lastSupabaseError ||
        "Supabase cache write failed. Check API env vars and table setup."
    );
  }

  if (supabaseConfiguredFromEnv) {
    throw new Error(
      lastSupabaseError ||
        "Supabase is configured but unavailable. Fix Supabase config on API service."
    );
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
      supabaseConfigured: supabaseConfiguredFromEnv,
      supabaseUrlHost,
      supabaseKeyRole,
      lastError: lastSupabaseError,
    };
  }

  if (cacheBackend === "supabase_misconfigured") {
    return {
      backend: "supabase_misconfigured",
      table: TABLE,
      entries: Object.keys(generatedFoodDatabase).length,
      fileFallback: GENERATED_DB_FILE,
      supabaseConfigured: supabaseConfiguredFromEnv,
      supabaseUrlHost,
      supabaseKeyRole,
      lastError: lastSupabaseError,
    };
  }

  return {
    backend: "file",
    entries: Object.keys(generatedFoodDatabase).length,
    file: GENERATED_DB_FILE,
    supabaseConfigured: supabaseConfiguredFromEnv,
    supabaseUrlHost,
    supabaseKeyRole,
    lastError: lastSupabaseError,
  };
}
