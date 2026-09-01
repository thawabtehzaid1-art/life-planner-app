// Supabase Edge Function: finishes the Google Calendar OAuth flow.
//
// Google redirects the browser here with `code` (and the `state` minted
// by google-oauth-start). Verifies state's signature, exchanges the code
// for tokens, stores them, then bounces the browser back to whichever
// app origin it started from — Vercel and the GitHub Pages mirror are
// two different origins, so that has to travel through `state` rather
// than being a fixed constant.
//
// Secrets: same as google-oauth-start.
// Deploy: supabase functions deploy google-oauth-callback --no-verify-jwt

import { createClient } from "jsr:@supabase/supabase-js@2";

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

const FALLBACK_ORIGIN = "https://web-companion-xi.vercel.app";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  let origin = FALLBACK_ORIGIN;
  try {
    const state = url.searchParams.get("state");
    if (!state) throw new Error("missing state");
    const [payloadB64, sig] = state.split(".");
    const payload = atob(payloadB64);
    if (sig !== await sign(payload)) throw new Error("bad state signature");
    const { uid, origin: stateOrigin, ts } = JSON.parse(payload);
    if (Date.now() - ts > 10 * 60 * 1000) throw new Error("state expired");
    origin = stateOrigin;

    const googleError = url.searchParams.get("error");
    if (googleError) throw new Error("Google denied access: " + googleError);
    const code = url.searchParams.get("code");
    if (!code) throw new Error("missing code");

    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/google-oauth-callback`;
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
        client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokenData.error_description || tokenData.error || "token exchange failed");
    if (!tokenData.refresh_token) throw new Error("Google didn't return a refresh token — try disconnecting any prior Align access in your Google Account's third-party access settings, then reconnect");

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { error: dbError } = await admin.from("google_calendar_tokens").upsert({
      user_id: uid,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (dbError) throw new Error(dbError.message);

    // `origin` here is the app's full base URL including any subpath
    // (e.g. https://…github.io/life-planner-app/ for the GitHub Pages
    // mirror, not just the domain root) — new URL()'s relative resolution
    // handles the trailing slash correctly either way.
    return Response.redirect(new URL("?calendar=connected", origin).toString(), 302);
  } catch (err) {
    return Response.redirect(new URL("?calendar=error&msg=" + encodeURIComponent(String(err?.message || err)), origin).toString(), 302);
  }
});
