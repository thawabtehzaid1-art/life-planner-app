// Supabase Edge Function: sends one Web Push message to one subscription.
//
// Not a user-facing endpoint — called by nudge-scan (and, later, anything
// else that wants to notify a user), with the service role key, so it's
// not gated behind a caller's Authorization header the way the other
// functions are.
//
// Secrets this function needs (set via `supabase secrets set`):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  - from `npx web-push generate-vapid-keys`
//   VAPID_SUBJECT                        - a mailto: or https: contact URL, required by the spec
//
// Deploy: supabase functions deploy send-push --no-verify-jwt

import webpush from "npm:web-push@3";

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") || "mailto:support@example.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

Deno.serve(async (req) => {
  try {
    const { subscription, title, body, url } = await req.json();
    if (!subscription) return new Response(JSON.stringify({ error: "Missing 'subscription'" }), { status: 400, headers: { "Content-Type": "application/json" } });

    await webpush.sendNotification(subscription, JSON.stringify({ title, body, url }));
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    // A 410/404 here means the subscription is dead (uninstalled, expired) —
    // the caller (nudge-scan) is expected to delete it from the DB on error.
    return new Response(JSON.stringify({ error: String(err?.message || err), statusCode: err?.statusCode }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
