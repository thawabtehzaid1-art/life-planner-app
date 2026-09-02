// Supabase Edge Function: permanently deletes the calling user's account.
// Every user-owned table references auth.users(id) on delete cascade
// (planner_data, subscriptions, push_subscriptions, google_calendar_tokens,
// calendar_synced_events, health_tokens, nudge_log — see supabase/migrations),
// so deleting the auth user is enough to remove all of it in one step.
//
// Deploy: supabase functions deploy delete-account

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
    const { error: delError } = await admin.auth.admin.deleteUser(userData.user.id);
    if (delError) throw delError;

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
