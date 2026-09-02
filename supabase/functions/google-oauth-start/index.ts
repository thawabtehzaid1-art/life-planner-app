// Supabase Edge Function: begins the Google Calendar OAuth flow.
//
// A plain browser navigation (not a fetch()) can't carry a custom
// Authorization header, so the caller's Supabase access token travels as
// a query param instead and is verified right here. The resulting user id
// (plus which app origin to return to — Vercel or the GitHub Pages
// mirror, whichever the user is actually on) is signed and packed into
// Google's `state` param, since nothing else carries through the round
// trip to Google and back.
//
// Secrets this function needs (set via `supabase secrets set`):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SECRET_KEYS (already present
//   in every Supabase project's Edge Function environment; the "backend_key"
//   entry within it is what actually signs state — see _shared/serviceRoleKey.ts)
//
// Deploy: supabase functions deploy google-oauth-start --no-verify-jwt

import { createClient } from "jsr:@supabase/supabase-js@2";
import { getBackendKey } from "../_shared/serviceRoleKey.ts";

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getBackendKey()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const origin = url.searchParams.get("origin");
  if (!token || !origin) return new Response("Missing token or origin", { status: 400 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return new Response("Unauthorized", { status: 401 });

  const payload = JSON.stringify({ uid: data.user.id, origin, ts: Date.now() });
  const state = btoa(payload) + "." + await sign(payload);

  const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/google-oauth-callback`;
  const params = new URLSearchParams({
    client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/calendar.events",
    access_type: "offline",
    // Forces Google to re-show consent and reissue a refresh_token every
    // time — without it, a second connect attempt from the same Google
    // account can silently omit the refresh_token, leaving us with an
    // access token that expires in an hour and no way to renew it.
    prompt: "consent",
    state,
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
});
