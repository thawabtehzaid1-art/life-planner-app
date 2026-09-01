import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabaseClient.js";

// health_tokens has a normal client-facing RLS policy (unlike the Google
// Calendar tokens, which are far more sensitive) — a personal Health
// bridge token is roughly as sensitive as the user's own session, so the
// app can read/write it directly with supabase-js, no Edge Function
// needed for the token's own lifecycle.
export function useHealthToken(userId) {
  const [token, setToken] = useState(null); // null = not checked yet, "" = none created
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase.from("health_tokens").select("token").eq("user_id", userId).maybeSingle();
    setToken(data?.token || "");
  }, [userId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Also used to "regenerate" — overwriting the row invalidates whatever
  // was pasted into an old Shortcut.
  const generate = useCallback(async () => {
    if (!userId || busy) return;
    setBusy(true);
    try {
      const fresh = crypto.randomUUID().replace(/-/g, "");
      const { error } = await supabase.from("health_tokens").upsert({ user_id: userId, token: fresh }, { onConflict: "user_id" });
      if (!error) setToken(fresh);
    } finally {
      setBusy(false);
    }
  }, [userId, busy]);

  return { token, busy, generate };
}
