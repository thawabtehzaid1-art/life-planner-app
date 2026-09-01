// Supabase Edge Function: reconciles the caller's tasks + bills against
// their Google Calendar. One-way push only (Align -> Calendar) — editing
// or deleting the event directly in Google Calendar doesn't flow back;
// the next sync just re-asserts Align's version.
//
// Called from the client on the same debounce that already saves
// planner_data (see App.jsx's flush()), so this runs at most once per
// save, not per keystroke. Silently no-ops if the user hasn't connected
// a calendar — the client is expected to check calendar-status first,
// but this endpoint doesn't rely on that being true.
//
// Deploy: supabase functions deploy calendar-sync

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

async function refreshedAccessToken(admin, userId: string, row) {
  if (new Date(row.expires_at).getTime() > Date.now() + 60_000) return row.access_token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: row.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok) return null; // refresh token revoked/expired — caller treats as disconnected
  await admin.from("google_calendar_tokens").update({
    access_token: data.access_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId);
  return data.access_token;
}

// A task/bill has no stable id on accounts saved before ids were added
// (see pages.js) — name+due is a good-enough fallback key for those; it
// just means renaming one of those older items creates a fresh event
// instead of renaming the existing one, which self-heals the moment the
// item picks up a real id from any future edit.
function itemKey(item) {
  return item.id || (item.name + "|" + item.due);
}

function eventBody(item, type: string, timezone: string) {
  const summary = (type === "bill" ? "💰 " : "") + item.name;
  if (item.reminderTime) {
    const start = `${item.due}T${item.reminderTime}:00`;
    const [h, m] = item.reminderTime.split(":").map(Number);
    const endH = String((h + 1) % 24).padStart(2, "0");
    const end = `${item.due}T${endH}:${String(m).padStart(2, "0")}:00`;
    return {
      summary,
      description: item.desc || "",
      start: { dateTime: start, timeZone: timezone },
      end: { dateTime: end, timeZone: timezone },
    };
  }
  return {
    summary,
    description: item.desc || "",
    start: { date: item.due },
    end: { date: item.due },
  };
}

async function gcal(path: string, accessToken: string, init: RequestInit = {}) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/${path}`, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  });
  if (res.status === 204 || res.status === 410) return null; // 410: event already gone on Google's side, fine
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message || `Google Calendar error ${res.status}`);
  return body;
}

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
    const userId = userData.user.id;

    const { tasks = [], bills = [], timezone = "UTC" } = await req.json();

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: tokenRow } = await admin.from("google_calendar_tokens").select("*").eq("user_id", userId).maybeSingle();
    if (!tokenRow) return new Response(JSON.stringify({ synced: 0, skipped: "not connected" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const accessToken = await refreshedAccessToken(admin, userId, tokenRow);
    if (!accessToken) return new Response(JSON.stringify({ synced: 0, skipped: "token revoked" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Only active items belong on the calendar — a completed task or a
    // paid bill should disappear from it, the same way it disappears
    // from Today's checklist once it's done.
    const desired = []
      .concat(tasks.filter((t) => t.due && t.status !== "Completed" && t.status !== "Cancelled").map((t) => ({ type: "task", key: itemKey(t), item: t })))
      .concat(bills.filter((b) => b.due && !b.paid).map((b) => ({ type: "bill", key: itemKey(b), item: b })));
    const desiredKeys = new Set(desired.map((d) => d.type + ":" + d.key));

    const { data: existing = [] } = await admin.from("calendar_synced_events").select("*").eq("user_id", userId);

    let synced = 0, removed = 0, failed = 0;

    for (const row of existing) {
      if (!desiredKeys.has(row.item_type + ":" + row.item_key)) {
        try { await gcal(`events/${row.google_event_id}`, accessToken, { method: "DELETE" }); } catch { /* already gone is fine */ }
        await admin.from("calendar_synced_events").delete().eq("id", row.id);
        removed++;
      }
    }

    const existingByKey = new Map(existing.map((r) => [r.item_type + ":" + r.item_key, r]));
    for (const d of desired) {
      const found = existingByKey.get(d.type + ":" + d.key);
      try {
        if (found) {
          await gcal(`events/${found.google_event_id}`, accessToken, { method: "PATCH", body: JSON.stringify(eventBody(d.item, d.type, timezone)) });
        } else {
          const created = await gcal("events", accessToken, { method: "POST", body: JSON.stringify(eventBody(d.item, d.type, timezone)) });
          await admin.from("calendar_synced_events").insert({ user_id: userId, item_type: d.type, item_key: d.key, google_event_id: created.id });
        }
        synced++;
      } catch (e) {
        failed++;
      }
    }

    return new Response(JSON.stringify({ synced, removed, failed }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
