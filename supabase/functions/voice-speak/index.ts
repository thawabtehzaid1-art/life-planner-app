// Supabase Edge Function: Phase 3 voice answer-back. Deliberately the
// mirror image of voice-command -- takes finished, already-correct status
// text (the exact return value of quickCapture.js's
// applyWeight/applyExpense/applyHabit/applyTask, see their own comments)
// and returns synthesized speech audio for it. Split into its own function
// rather than folded into voice-command because the text to speak doesn't
// exist until AFTER the client has already parsed and applied a command
// locally -- this is necessarily a second round trip, same reasoning that
// already keeps calendar-sync/calendar-status/calendar-disconnect as three
// separate narrow functions instead of one do-everything endpoint.
//
// Uses the same self-hosted VPS as voice-command (see
// docs/voice-tts-setup.sh) -- Piper TTS, CPU-only, no pay-per-use
// provider, reachable through the same Cloudflare Tunnel + nginx +
// shared-secret path already proven in Phase 1/2. Same two secrets
// (VOICE_VPS_URL, VOICE_VPS_SECRET) -- no new ones needed.
//
// This function is entirely best-effort from the client's perspective --
// see QuickCapture.jsx's speakResult(), which swallows any failure here
// silently. The on-screen status text is always the real result; audio is
// a bonus layered on top, never load-bearing -- a dead VPS, a slow
// network, or a browser that refuses autoplay should never block or alter
// what the user sees.
//
// Deploy: supabase functions deploy voice-speak

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  // Browser calls this via supabase.functions.invoke() (see
  // QuickCapture.jsx's speakResult()), so it needs the same CORS preflight
  // handling every other browser-called function in this project has (see
  // _shared/cors.ts) -- every Response below carries corsHeaders for the
  // same reason.
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response("Missing Authorization header", { status: 401, headers: corsHeaders });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

    const { text } = await req.json();
    if (!text || typeof text !== "string") {
      return new Response(JSON.stringify({ error: "Missing 'text'" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const vpsUrl = Deno.env.get("VOICE_VPS_URL");
    const vpsSecret = Deno.env.get("VOICE_VPS_SECRET");
    if (!vpsUrl) {
      // Same "deployed but not pointed at a real VPS yet" fail-soft as
      // voice-command -- a 503 here, not a 500, so the client's silent-fail
      // path treats it the same as "feature not set up" rather than "the
      // feature broke".
      return new Response(JSON.stringify({ error: "Voice output isn't configured yet." }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ttsRes = await fetch(`${vpsUrl}/tts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(vpsSecret ? { Authorization: `Bearer ${vpsSecret}` } : {}),
      },
      body: JSON.stringify({ text }),
    });

    if (!ttsRes.ok || !ttsRes.body) {
      return new Response(JSON.stringify({ error: `Voice output unreachable (${ttsRes.status})` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pass the WAV bytes straight through -- no JSON/base64 wrapping, so a
    // several-second clip doesn't pay a ~33% size tax for no reason.
    //
    // Content-Type is deliberately application/octet-stream, not audio/wav:
    // the supabase-js FunctionsClient the browser client uses only
    // auto-parses a response as a Blob when Content-Type is
    // application/octet-stream or application/pdf (see
    // node_modules/@supabase/functions-js/dist/main/FunctionsClient.js) --
    // anything else, audio/wav included, falls through to response.text(),
    // which would decode these binary WAV bytes as UTF-8 and corrupt them.
    // QuickCapture.jsx's speakResult() re-tags the Blob as audio/wav
    // client-side before handing it to an <audio> element.
    return new Response(ttsRes.body, { headers: { ...corsHeaders, "Content-Type": "application/octet-stream" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
