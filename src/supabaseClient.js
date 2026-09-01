import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Add them to web-companion/.env.local.",
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    // Explicit rather than relying on the (equivalent) defaults, since a
    // session-persistence bug is exactly the kind of thing worth being
    // able to see and change in one obvious place later.
    persistSession: true,
    storage: window.localStorage,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
