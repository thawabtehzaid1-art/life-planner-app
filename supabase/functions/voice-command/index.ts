// Supabase Edge Function: voice assistant Phase 1's auth/orchestration
// layer. Deliberately stateless and narrow -- verifies the caller, forwards
// the transcript to a self-hosted Ollama instance (see
// docs/voice-vps-setup.sh for what that VPS runs), and hands back one
// normalized command line for the client to run through quickCapture.js's
// EXISTING, unmodified parseCommand()/applyWeight()/applyHabit(). This
// function never touches the database itself -- see
// supabase/migrations/0007_voice_command_log.sql for why logging is a
// plain client-side insert instead.
//
// No dependency on any pay-per-use AI provider: the only outbound call
// this function makes is to VOICE_VPS_URL, a flat-fee VPS you run
// yourself.
//
// Secrets this function needs (set via `supabase secrets set`):
//   VOICE_VPS_URL     - e.g. https://voice.yourdomain.com (the reverse
//                        proxy in front of Ollama, not Ollama's raw port)
//   VOICE_VPS_SECRET  - shared secret the VPS's proxy checks, so its
//                        endpoint isn't wide open to the whole internet
//
// Deploy: supabase functions deploy voice-command

import { createClient } from "jsr:@supabase/supabase-js@2";

const OLLAMA_MODEL = "qwen2.5:3b";

// Few-shot examples matter a lot for a 3B-class model's output-format
// reliability -- without them, a small model drifts into explaining
// itself or adding punctuation instead of returning exactly one line.
const SYSTEM_PROMPT = `You convert a spoken voice command -- possibly in English or Arabic, possibly with spoken-out numbers or casual phrasing -- into ONE canonical English command line, or the exact word NONE.

Shape 1 (logging body weight): output exactly "log my weight as <number> <kg|lb>". Infer kg unless pounds/lbs was said. Convert spoken-out numbers to digits.

Shape 2 (marking a habit done): output exactly "mark <habit name> done". Keep the habit name as spoken; translate it to English only if it was said in Arabic. Never guess or correct the name.

If the transcript doesn't clearly match either shape, output exactly: NONE

Output ONLY the command line or NONE -- no explanation, no extra punctuation.

Examples:
"log my weight as seventy eight kilos" -> log my weight as 78 kg
"i weighed myself today it's eighty two point five" -> log my weight as 82.5 kg
"سجل وزني خمسة وسبعين كيلو" -> log my weight as 75 kg
"mark meditation done" -> mark meditation done
"علّم التأمل تم" -> mark meditation done
"what's the weather like" -> NONE`;

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response("Missing Authorization header", { status: 401 });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) return new Response("Unauthorized", { status: 401 });

    const { transcript } = await req.json();
    if (!transcript || typeof transcript !== "string") {
      return new Response(JSON.stringify({ error: "Missing 'transcript'" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const vpsUrl = Deno.env.get("VOICE_VPS_URL");
    const vpsSecret = Deno.env.get("VOICE_VPS_SECRET");
    if (!vpsUrl) {
      // Deployed but not pointed at a real VPS yet -- fail soft instead
      // of a 500.
      return new Response(JSON.stringify({ normalized: null, error: "Voice assistant isn't configured yet." }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const ollamaRes = await fetch(`${vpsUrl}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(vpsSecret ? { Authorization: `Bearer ${vpsSecret}` } : {}),
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        system: SYSTEM_PROMPT,
        prompt: transcript,
        stream: false,
        options: { temperature: 0 },
      }),
    });

    if (!ollamaRes.ok) {
      return new Response(JSON.stringify({ error: `Voice model unreachable (${ollamaRes.status})` }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { response } = await ollamaRes.json();
    const normalized = (response || "").trim();

    return new Response(JSON.stringify({
      normalized: normalized && normalized.toUpperCase() !== "NONE" ? normalized : null,
    }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
