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

function createSupabaseClient() {
  if (!supabaseUrl || !supabaseAnonKey) return null;
  try {
    return createClient(supabaseUrl, supabaseAnonKey);
  } catch (e) {
    console.error("Supabase createClient failed:", e);
    return null;
  }
}

export const supabase = createSupabaseClient();
