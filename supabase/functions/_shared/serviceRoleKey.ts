// Reads the "backend_key" secret key (Project Settings -> API Keys ->
// Secret keys) by name, rather than the legacy SUPABASE_SERVICE_ROLE_KEY
// env var — which still resolves to whichever key happens to be named
// "default" in that same list. Pinning every function to a name we chose
// ourselves means none of them silently repoint if "default" is ever
// replaced or deactivated; it's also how the leaked key that used to live
// in 0003_nudge_cron.sql (the "default" key) gets fully retired without
// this file changing again.
export function getBackendKey(): string {
  const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")!);
  return keys["backend_key"];
}
