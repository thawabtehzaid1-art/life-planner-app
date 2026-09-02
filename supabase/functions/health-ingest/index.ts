// Supabase Edge Function: receives one Health data point from an Apple
// Shortcut (there's no direct way for a website to reach HealthKit —
// this is the actual bridge: a Shortcut reads Health data natively on
// the phone and calls this URL).
//
// GET so an entire Shortcut can be a single "Get Contents of URL" action
// with Health values interpolated straight into the URL text, rather than
// needing a JSON dictionary built with extra steps:
//   https://…supabase.co/functions/v1/health-ingest
//     ?token=<the token shown on Overview>
//     &type=steps|sleepHours
//     &date=YYYY-MM-DD
//     &value=<number>
//
// Auth is the token itself, not a Supabase session — an unattended
// automation (e.g. "every morning") can't do a live login the way the
// app itself does. The token has no expiry; regenerating it on Overview
// invalidates the old one.
//
// Deploy: supabase functions deploy health-ingest --no-verify-jwt

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getBackendKey } from "../_shared/serviceRoleKey.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const params = new URL(req.url).searchParams;
    const token = params.get("token");
    const type = params.get("type");
    const date = params.get("date");
    const value = params.get("value");
    if (!token || !type || !date || value === null) {
      return new Response(JSON.stringify({ error: "Missing token, type, date, or value" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (type !== "steps" && type !== "sleepHours") {
      return new Response(JSON.stringify({ error: "type must be 'steps' or 'sleepHours'" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const num = Number(value);
    if (!isFinite(num)) return new Response(JSON.stringify({ error: "value must be a number" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, getBackendKey());
    const { data: tokenRow } = await admin.from("health_tokens").select("user_id").eq("token", token).maybeSingle();
    if (!tokenRow) return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: row } = await admin.from("planner_data").select("data").eq("user_id", tokenRow.user_id).maybeSingle();
    if (!row) return new Response(JSON.stringify({ error: "No planner data found for this account" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // A direct read-modify-write against the same row the app itself
    // saves to — if the app happens to save at the exact same moment,
    // last write wins, the same accepted tradeoff every other writer to
    // planner_data already lives with (see nudge-scan, the app's own
    // debounced save). Automations like this tend to run when the app
    // isn't open anyway, so a real collision here is rare in practice.
    const next = row.data || {};
    if (!next.health) next.health = { steps: {}, sleepHours: {} };
    if (!next.health.steps) next.health.steps = {};
    if (!next.health.sleepHours) next.health.sleepHours = {};
    next.health[type][date] = num;

    const { error: updateError } = await admin
      .from("planner_data")
      .update({ data: next, updated_at: new Date().toISOString() })
      .eq("user_id", tokenRow.user_id);
    if (updateError) throw new Error(updateError.message);

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
