// Supabase Edge Function: scheduled nudge scan.
//
// Runs on a cron schedule (see supabase/migrations/0003_nudge_cron.sql for
// the pg_cron wiring), reads every user's planner_data, decides who gets a
// nudge today, and pushes it directly via web-push. Intentionally a small,
// self-contained re-implementation of a few due-date checks rather than an
// import of src/engine.js — that file assumes a browser environment
// (relies on the caller's local "now") and isn't set up to be pulled into
// a Deno Edge Function; duplicating the handful of date comparisons here
// is simpler and more robust than trying to share it across runtimes.
//
// Secrets this function needs (set via `supabase secrets set`):
//   SUPABASE_URL, SUPABASE_SECRET_KEYS (both already present in every
//   Supabase project's Edge Function environment automatically — the
//   "backend_key" entry within the latter is what's actually read, see
//   _shared/serviceRoleKey.ts)
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (same as send-push)
//
// Deploy: supabase functions deploy nudge-scan --no-verify-jwt

import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";
import { getBackendKey } from "../_shared/serviceRoleKey.ts";

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") || "mailto:support@example.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

function isoDate(d) { return d.toISOString().slice(0, 10); }

const DAY = 86400000;
// Only day-based frequencies (Weekly / Every N Weeks) — month-based ones
// need the same last-day-of-month clamping as edate() in engine.js, which
// isn't worth porting here; those are commonly tracked as Bills instead,
// which already get full reminder-time support below.
const RECUR_DAYS = { "Weekly": 7, "Every 2 Weeks": 14, "Every 3 Weeks": 21, "Every 4 Weeks": 28 };

// Both "what calendar day is it" and "what hour is it" have to be computed
// per user, in THEIR timezone (settings.timezone, auto-detected client-side
// from the device) — not once for everyone in server (UTC) time. Someone
// at 11pm local could already be "tomorrow" server-side, and "3pm" only
// means their actual 3pm if it's evaluated in their own zone. Falls back to
// UTC if the account predates the timezone field or has an invalid value.
function localDateAndHour(now, timezone) {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "UTC",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false,
    });
    const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
    return { dateISO: `${parts.year}-${parts.month}-${parts.day}`, hour: parseInt(parts.hour, 10) % 24 };
  } catch {
    return timezone === "UTC" ? { dateISO: isoDate(now), hour: now.getUTCHours() } : localDateAndHour(now, "UTC");
  }
}

// `reminderTime` (an "HH:MM" the user picked on that row) is matched
// against their own local hour, computed above.
function matchesHour(reminderTime, currentHour) {
  if (!reminderTime) return true;
  const h = parseInt(reminderTime.split(":")[0], 10);
  return h === currentHour;
}

// One user's `data` -> a list of nudges, one per matching item (not bundled
// into a single "3 tasks due" message) — each needs its own stable `key` so
// nudge_log can dedupe per-item rather than per-scan.
function nudgesFor(data, todayISO, tomorrowISO, todayTsValue, currentHour) {
  const out = [];
  for (const b of (data.bills || [])) {
    if (!b.paid && b.due === tomorrowISO && matchesHour(b.reminderTime, currentHour)) {
      out.push({ title: "Bill due tomorrow", body: `${b.name} is due tomorrow.`, key: `bill:${b.name}:${b.due}`, dueDate: b.due });
    }
  }
  for (const t of (data.tasks || [])) {
    if (t.due === todayISO && t.status !== "Completed" && t.status !== "Cancelled" && matchesHour(t.reminderTime, currentHour)) {
      out.push({ title: "Due today", body: `"${t.name}" is due today.`, key: `task:${t.name}:${t.due}`, dueDate: t.due });
    }
  }
  (data.recurring || []).forEach((r, ri) => {
    const freqDays = RECUR_DAYS[r.freq];
    if (!freqDays || !r.first) return;
    const firstTs = Date.parse(r.first + "T00:00:00Z");
    if (isNaN(firstTs)) return;
    const daysSince = Math.round((todayTsValue - firstTs) / DAY);
    if (daysSince < 0 || daysSince % freqDays !== 0) return;
    const occIndex = daysSince / freqDays;
    if (data.done?.[`${ri}:${occIndex}`]) return;
    if (!matchesHour(r.reminderTime, currentHour)) return;
    out.push({ title: "Due today", body: `"${r.name}" is due today.`, key: `recurring:${r.name}:${todayISO}`, dueDate: todayISO });
  });
  // Habit days are keyed by day-of-month only (no month/year in the key —
  // matches how the client itself reads them), so "done today" is just
  // today's day-of-month number in the user's own local date.
  const dom = parseInt(todayISO.split("-")[2], 10);
  for (const h of (data.habits || [])) {
    if (!h.days?.[dom] && matchesHour(h.reminderTime, currentHour)) {
      out.push({ title: "Habit reminder", body: `Time for "${h.name}".`, key: `habit:${h.name}:${todayISO}`, dueDate: todayISO });
    }
  }
  return out;
}

// Fasting doesn't have its own reminderTime field like the other nudge
// types -- it fires off the same fastStart/fastEnd the live timer on Today
// already uses (see fastingStatus() in src/engine.js), matched to the hour
// the same coarse way matchesHour() above does for everything else. A
// "stop fast" override recorded client-side (data.fastingToday) isn't
// checked here: if someone already ended their fast early, the complete
// nudge would just be redundant, not wrong, and re-deriving that would
// mean duplicating fastingStatus()'s window-crossing-midnight math too --
// not worth it for a nudge that's at worst a few extra minutes late to a
// fast the person already knows they ended.
function fastingNudgesFor(data, todayISO, currentHour) {
  const s = data.settings || {};
  if (s.fasts !== "Yes") return [];
  const startHour = parseInt((s.fastStart || "20:00").split(":")[0], 10);
  const endHour = parseInt((s.fastEnd || "12:00").split(":")[0], 10);
  const out = [];
  if (currentHour === endHour) {
    out.push({
      title: "Fast complete", body: "Your eating window is open.",
      key: `fasting-complete:${todayISO}`, dueDate: todayISO, kind: "fasting-complete",
    });
  }
  if (currentHour === startHour) {
    out.push({
      title: "Time to fast", body: "Your eating window just closed.",
      key: `fasting-start:${todayISO}`, dueDate: todayISO, kind: "fasting-start",
    });
  }
  return out;
}

// Appends one fastingLog entry for a completed fast, re-reading the row
// fresh right before writing rather than reusing the copy fetched at the
// top of the scan loop -- that copy could be minutes stale by the time a
// large user list reaches this row, and this write isn't merge-safe (it's
// a full-object update, same as every other planner_data write in this
// app). Re-fetching immediately before writing shrinks the window where a
// concurrent edit from the person's own open tab could get clobbered down
// to one round trip instead of the whole scan's duration -- doesn't
// eliminate the race, just narrows it as far as a plain read-modify-write
// reasonably can without a jsonb-merge RPC.
async function logCompletedFast(admin, userId, settings, todayISO) {
  const { data: fresh } = await admin.from("planner_data").select("data").eq("user_id", userId).single();
  if (!fresh?.data) return;
  // If fastingToday.endedEarlyAt is set at all right at the scheduled end
  // hour, the person almost certainly already stopped THIS fast manually
  // (see FastingTimer.jsx's "Stop fast" button, which logs its own history
  // entry client-side the moment it's tapped) -- don't also log a
  // contradictory "completed on schedule" entry for the same fast. Not a
  // precise date match (fastingToday doesn't carry one, by design -- see
  // the comment on fastingStatus() in engine.js), but skipping the
  // auto-log here is the safe direction to be wrong in: a missed auto-log
  // is a minor gap, a duplicate/contradictory entry is a real data-quality
  // bug in someone's history.
  if (fresh.data.fastingToday?.endedEarlyAt) return;
  const entry = {
    date: todayISO,
    scheduledStart: settings.fastStart || "20:00",
    scheduledEnd: settings.fastEnd || "12:00",
    endedAt: new Date().toISOString(),
    endedEarly: false,
  };
  const nextData = { ...fresh.data, fastingLog: [...(fresh.data.fastingLog || []), entry] };
  await admin.from("planner_data").update({ data: nextData, updated_at: new Date().toISOString() }).eq("user_id", userId);
}

Deno.serve(async (_req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, getBackendKey());

  const now = new Date();

  // Old log entries aren't needed once an item's due date is well in the
  // past — keeps the table from growing forever, and if a since-cleared
  // item's name+date combo is ever reused, it's treated as new again.
  await admin.from("nudge_log").delete().lt("due_date", isoDate(new Date(now.getTime() - 2 * 86400000)));

  const { data: rows, error } = await admin.from("planner_data").select("user_id, data");
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  let sent = 0, failed = 0, skipped = 0;
  for (const row of rows || []) {
    const tz = row.data?.settings?.timezone;
    const { dateISO: todayISO, hour: currentHour } = localDateAndHour(now, tz);
    const { dateISO: tomorrowISO } = localDateAndHour(new Date(now.getTime() + DAY), tz);
    const todayTsValue = Date.parse(todayISO + "T00:00:00Z");
    const nudges = [
      ...nudgesFor(row.data || {}, todayISO, tomorrowISO, todayTsValue, currentHour),
      ...fastingNudgesFor(row.data || {}, todayISO, currentHour),
    ];
    if (!nudges.length) continue;

    const { data: already } = await admin.from("nudge_log").select("item_key").eq("user_id", row.user_id).in("item_key", nudges.map((n) => n.key));
    const seen = new Set((already || []).map((r) => r.item_key));
    const toSend = nudges.filter((n) => !seen.has(n.key));
    skipped += nudges.length - toSend.length;
    if (!toSend.length) continue;

    const { data: subs } = await admin.from("push_subscriptions").select("id, subscription").eq("user_id", row.user_id);
    for (const n of toSend) {
      let anySuccess = false;
      for (const s of subs || []) {
        try {
          // No `url` here on purpose — the server doesn't know whether this
          // subscriber is on the root deploy or a subpath one (e.g. GitHub
          // Pages), so a hardcoded "/" would 404 for the latter. Omitting
          // it lets the service worker's own `payload.url || BASE` fall
          // back to wherever it's actually running.
          await webpush.sendNotification(s.subscription, JSON.stringify({ title: n.title, body: n.body }));
          sent++;
          anySuccess = true;
        } catch (err) {
          failed++;
          // Dead subscription (uninstalled, expired) — stop trying it again.
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            await admin.from("push_subscriptions").delete().eq("id", s.id);
          }
        }
      }
      // A completed fast gets logged to history regardless of whether the
      // push itself was delivered anywhere -- someone who never opted into
      // push notifications (no rows in push_subscriptions at all) should
      // still get their fasting history recorded; that's not the same
      // question as whether a notification went out. Marked "handled" in
      // nudge_log unconditionally too, so a person with no subscriptions
      // doesn't get the same day logged again every hour the scan reruns.
      if (n.kind === "fasting-complete") {
        await logCompletedFast(admin, row.user_id, row.data?.settings || {}, todayISO);
        await admin.from("nudge_log").upsert({ user_id: row.user_id, item_key: n.key, due_date: n.dueDate, sent_at: new Date().toISOString() });
        continue;
      }
      // Every other nudge type: only marked "done" once actually delivered
      // somewhere — a total failure (e.g. every device temporarily
      // unreachable) gets retried next hour instead of silently dropped.
      if (anySuccess) {
        await admin.from("nudge_log").upsert({ user_id: row.user_id, item_key: n.key, due_date: n.dueDate, sent_at: new Date().toISOString() });
      }
    }
  }

  return new Response(JSON.stringify({ sent, failed, skipped }), { headers: { "Content-Type": "application/json" } });
});
