// Supabase Edge Function: reports whether the calling user has a Google
// Calendar connection, without ever exposing the actual tokens to the
// client — google_calendar_tokens has no client-facing RLS policy at all,
// so this plain true/false is the only way the frontend learns anything
// about it.
//
// Deploy: supabase functions deploy calendar-status

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

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

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data } = await admin
      .from("google_calendar_tokens")
      .select("user_id")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    return new Response(JSON.stringify({ connected: !!data }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
