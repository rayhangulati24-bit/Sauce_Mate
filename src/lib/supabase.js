import { createClient } from "@supabase/supabase-js";

/** Base URL only — strips `/rest/v1/` if pasted from the API docs. */
function normalizeSupabaseUrl(url) {
  if (!url || typeof url !== "string") return "";
  let u = url.trim();
  u = u.replace(/\/rest\/v1\/?$/i, "");
  u = u.replace(/\/+$/, "");
  return u;
}

const supabaseUrl = normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL || "");
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;
