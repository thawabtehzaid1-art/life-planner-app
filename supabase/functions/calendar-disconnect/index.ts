// Supabase Edge Function: disconnects Google Calendar for the calling
// user — best-effort revokes the token with Google (so it also
// disappears from the user's own Google Account access list), then
// deletes our copy of it and the event mapping either way.
//
// Deploy: supabase functions deploy calendar-disconnect

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getBackendKey } from "../_shared/serviceRoleKey.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response("Missing Authorization header", { status: 401, headers: corsHeaders });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error } = await supabase.auth.getUser();
    if (error || !userData?.user) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, getBackendKey());
    const { data: row } = await admin
      .from("google_calendar_tokens")
      .select("access_token")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (row?.access_token) {
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${row.access_token}`, { method: "POST" });
      } catch {
        /* best effort — the rows still get deleted below regardless */
      }
    }

    await admin.from("google_calendar_tokens").delete().eq("user_id", userData.user.id);
    await admin.from("calendar_synced_events").delete().eq("user_id", userData.user.id);

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
