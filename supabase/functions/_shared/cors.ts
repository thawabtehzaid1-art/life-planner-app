// Shared CORS headers for the Edge Functions the browser calls directly
// via fetch() (calendar-status, calendar-disconnect, calendar-sync) — not
// needed by google-oauth-start/callback, which are reached by a plain
// browser navigation rather than a fetch, so CORS doesn't apply to them.
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};
