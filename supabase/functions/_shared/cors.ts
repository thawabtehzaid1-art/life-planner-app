// Shared CORS headers for the Edge Functions the browser calls directly
// via fetch()/supabase.functions.invoke() (calendar-status,
// calendar-disconnect, calendar-sync, voice-command, voice-speak) — not
// needed by google-oauth-start/callback, which are reached by a plain
// browser navigation rather than a fetch, so CORS doesn't apply to them.
//
// Allow-Headers was previously "authorization, content-type" only, which
// let the OPTIONS preflight itself succeed but still failed the browser's
// own header check right after: the Supabase client auto-attaches several
// more headers to every call (apikey always; x-client-info, x-retry-count,
// traceparent/tracestate/baggage depending on config) that were never in
// this allow-list, so the browser blocked the real request client-side
// before sending it, silently and fast (see the session that found this --
// consistently under 500ms, a preflight-header rejection, not a network
// round trip). This list is copied from @supabase/supabase-js's own
// canonical reference (node_modules/@supabase/supabase-js/src/cors.ts,
// SUPABASE_HEADERS) -- keep it in sync with that if the SDK adds more.
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage",
};
