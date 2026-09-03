import { DAY, TINTS, RECUR_DAYS, RECUR_MONTHS, AISLES, parseISO, edate, iso, num } from "./data.js";
import i18n from "./i18n.js";

// ---------- cell builders ----------
// Each builder returns a plain object describing one table/grid cell; the
// Table/Week components below render them by "kind" instead of the sc-if
// template the design canvas used.
export function plain(v, o = {}) {
  return { kind: "plain", v, align: o.align || "left", justify: o.align === "right" ? "flex-end" : "flex-start", muted: !!o.muted, tint: o.tint || "", tinted: !!o.tinted, strike: !!o.strike };
}
export function chip(v, tint) {
  return { kind: "chip", v, align: "left", justify: "flex-start", tint: tint || "", tinted: false };
}
export function edit(v, set) {
  return { kind: "edit", v, set, align: "left", justify: "flex-start", tint: "", tinted: false };
}
export function numc(v, set, o = {}) {
  return { kind: "num", v: String(v), set, step: o.step || "1", align: "right", justify: "flex-end", tint: o.tint || "", tinted: !!o.tinted };
}
export function datec(v, set) {
  return { kind: "date", v, set, align: "left", justify: "flex-start", tint: "", tinted: false };
}
export function timec(v, set) {
  return { kind: "time", v, set, align: "left", justify: "flex-start", tint: "", tinted: false };
}
export function sel(v, set, options, tint) {
  return { kind: "select", v, set, options, align: "left", justify: "flex-start", tint: tint || "", tinted: false };
}
export function tog(on, set, tint) {
  return { kind: "toggle", on: !!on, set, align: "center", justify: "center", tint: tint || "health", tinted: false };
}
export function barc(pct, label, tint) {
  return { kind: "bar", v: label, pct: Math.max(0, Math.min(100, Math.round(pct))), align: "left", justify: "flex-start", tint: tint || "", tinted: false };
}
// A plain date cell with an optional trailing "→ N upcoming" button — links
// a recurring task's "Next due" cell to its matching rows in the Generated
// schedule table below, without making the whole row (which already has
// editable cells) clickable.
export function datelink(v, o, count, onClick) {
  return { kind: "datelink", v, align: o.align || "left", justify: o.align === "right" ? "flex-end" : "flex-start", tint: o.tint || "", tinted: !!o.tinted, count: count || 0, onClick };
}

export function table(o) {
  // The delete "×" column isn't part of the caller's head/cells arrays —
  // it has to be reserved in the grid template explicitly here, or it's
  // an unaccounted-for extra cell every row emits (see TableBlock/index.css
  // for why that's now a real bug, not just a cosmetic one).
  return {
    type: "table",
    title: o.title, note: o.note || "",
    grid: o.grid + (o.add ? " 34px" : ""),
    head: o.head.map((h) => (typeof h === "string" ? { t: h, align: "left" } : h)),
    rows: o.rows,
    canAdd: !!o.add, canDelete: !!o.add, add: o.add, addLabel: o.addLabel || "+ New row",
    // Optional: called with the dictated phrase instead of the empty
    // placeholder `add()` uses, so speaking "buy milk" adds a row already
    // named that rather than a generic "New task" you'd still have to edit.
    voiceAdd: o.voiceAdd || null,
    emptyLabel: o.emptyLabel || "", emptyNote: o.emptyNote || "",
  };
}
export function notes(title, note, list) {
  return { type: "notes", title, note: note || "", notes: list };
}
export function phasesBlock(title, note, phases) {
  return { type: "phases", title, note: note || "", phases };
}
export function badges(title, note, list) {
  return { type: "badges", title, note: note || "", badges: list };
}
// Shared by every chart builder below: whether there's enough real signal
// to draw a shape that means something. A lone logged point isn't a trend,
// and a set of categories that all sum to zero isn't a distribution — both
// used to fall through the same divide-by-zero-avoidance fallback (`|| 1`,
// `|| 0.0001`) that quietly turned "nothing here yet" into a shape that
// looked like data instead of an honest empty state.
function hasChartData(nums) {
  const real = nums.filter((n) => Number.isFinite(n));
  return real.length >= 2 && real.some((n) => n !== 0);
}
export function columns(title, note, series) {
  const nums = series.map((s) => Math.abs(Number(s.n) || 0));
  if (!hasChartData(nums)) {
    return { type: "columns", title, note, empty: true, series: [] };
  }
  const max = Math.max(...nums, 0.0001);
  return {
    type: "columns", title, note,
    series: series.map((s, i) => ({ label: s.label, value: s.value, tint: s.tint || "", h: Math.max(3, Math.round(170 * nums[i] / max)) })),
  };
}
export function line(title, note, values, xLabels, fmt) {
  const f = fmt || ((v) => String(Math.round(v)));
  const real = values.map(Number).filter(Number.isFinite);
  if (!hasChartData(real)) {
    if (real.length === 0) return { type: "line", title, note, xLabels, empty: true };
    // Exactly one real point: show it as a flat reference spanning the
    // chart, by feeding the same point in twice below, instead of the old
    // path — which put that single point's x-position at 0 (nothing else
    // to space it against) and then had to draw the area fill's closing
    // edge as a diagonal down to the far corner, a fake decline rather
    // than an actual second data point.
    values = [real[0], real[0]];
  }
  const vals = values.map(Number);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = (max - min) || Math.abs(max) || 1;
  const lo = min - span * 0.25, hi = max + span * 0.25;
  const pts = vals.map((v, i) => [Math.round(600 * i / ((vals.length - 1) || 1)), Math.round(205 - 200 * (v - lo) / ((hi - lo) || 1))]);
  return {
    type: "line", title, note, xLabels,
    line: pts.map((p) => p.join(",")).join(" "),
    area: "0,210 " + pts.map((p) => p.join(",")).join(" ") + " 600,210",
    yTop: f(hi), yMid: f((hi + lo) / 2), yBottom: f(lo),
  };
}
export function donut(title, note, centre, centreNote, segments) {
  const nums = segments.map((s) => Math.max(0, Number(s.n) || 0));
  if (!hasChartData(nums)) {
    return { type: "donut", title, note, centre, centreNote, empty: true, segments: [] };
  }
  const C = 2 * Math.PI * 70;
  const total = nums.reduce((s, n) => s + n, 0);
  let acc = 0;
  return {
    type: "donut", title, note, centre, centreNote,
    segments: segments.map((s, i) => {
      const len = C * nums[i] / total;
      const out = { label: s.label, value: s.value, tint: s.tint || "", share: Math.round(100 * nums[i] / total) + "%", stroke: TINTS[s.tint || ""], dash: len.toFixed(1) + " " + (C - len).toFixed(1), offset: (-acc).toFixed(1) };
      acc += len;
      return out;
    }),
  };
}
export function settingsBlock(title, note, fields) {
  return { type: "settings", title, note: note || "", fields };
}
export function calendarBlock(title, note, dayNames, days) {
  return { type: "calendar", title, note, dayNames, days };
}
export function weekBlock(title, note, cells) {
  return { type: "week", title, note, cells };
}
export function habitGridBlock(title, note, dayTicks, habits, add) {
  return { type: "grid", title, note, dayTicks, habits, add };
}

// ---------- date / settings helpers ----------
export function todayTs() {
  const n = new Date(); n.setHours(0, 0, 0, 0); return n.getTime();
}
// Where "now" sits relative to the fasting window someone set on the Meal
// Plan tab. Windows can cross midnight (a 20:00 -> 12:00 fast is the normal
// case), so everything below works in "minutes since fastStart, wrapped to
// a 24h clock" rather than comparing HH:MM strings directly.
// `today` is the optional data.fastingToday record ({ endedEarlyAt }) --
// set when "Stop fast" was tapped. Matched by whether that timestamp falls
// inside the CURRENT continuous fasting window (not by calendar date, which
// would misfire right around midnight for a window that crosses it) so it
// naturally stops applying once a new cycle starts, no cleanup required.
export function fastingStatus(settings, now, today) {
  if (!settings || settings.fasts !== "Yes") return null;
  const start = settings.fastStart || "20:00";
  const end = settings.fastEnd || "12:00";
  const toMin = (hhmm) => {
    const p = String(hhmm).split(":");
    return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
  };
  const startMin = toMin(start), endMin = toMin(end);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const fastLen = ((endMin - startMin + 1440) % 1440) || 1440;
  const sinceStart = (nowMin - startMin + 1440) % 1440;
  let fasting = sinceStart < fastLen;
  let endedEarly = false;
  if (fasting && today?.endedEarlyAt) {
    const endedAt = new Date(today.endedEarlyAt);
    const windowStart = new Date(now.getTime() - sinceStart * 60000);
    if (endedAt >= windowStart && endedAt <= now) { fasting = false; endedEarly = true; }
  }
  const remainingMin = fasting ? fastLen - sinceStart : (startMin - nowMin + 1440) % 1440;
  const windowLen = fasting ? fastLen : 1440 - fastLen;
  return { fasting, remainingMin, windowLen, startLabel: start, endLabel: end, endedEarly };
}
export function wkStart(data) { return data.settings.weekStart === "Sunday" ? 0 : 1; }
// Same shape as weekBounds below: a plain offset from the real current
// month, not persisted anywhere — Monthly Calendar and Habit Tracker both
// browse via this (see buildPages' shared `anchor`), and it resets to the
// current month on reload, same as Weekly Planner's `week` offset already
// does. Replaces the old settings.month field, which required a trip to
// Overview to change and silently went stale once nothing wrote to it.
export function monthAnchorAt(month) {
  const n = new Date(todayTs());
  return new Date(n.getFullYear(), n.getMonth() + (month || 0), 1).getTime();
}
// Deliberately independent of settings — Spending totals ("This month",
// "Left to spend", etc.) need to track the real current month regardless
// of whatever month Monthly Calendar/Habit Tracker happen to be browsing.
export function monthRange() {
  const n = new Date(); n.setHours(0, 0, 0, 0);
  const from = new Date(n.getFullYear(), n.getMonth(), 1).getTime();
  return { from, to: new Date(n.getFullYear(), n.getMonth() + 1, 0).getTime() };
}
export function inRange(list, key, from, to) {
  return list.filter((x) => { const t = parseISO(x[key]); return t !== null && t >= from && t <= to; });
}
export function weekBounds(data, week) {
  const today = todayTs();
  const dow = new Date(today).getDay();
  const shift = (dow - wkStart(data) + 7) % 7;
  return today - shift * DAY + week * 7 * DAY;
}

// ---------- recurring-task engine ----------
export function occurrences(data, from, to) {
  const out = [];
  data.recurring.forEach((r, ri) => {
    const first = parseISO(r.first);
    if (!first || !r.name) return;
    const days = RECUR_DAYS[r.freq] || 0;
    const months = RECUR_MONTHS[r.freq] || 0;
    for (let i = 0; i < 60; i++) {
      const at = months ? edate(first, months * i) : first + days * i * DAY;
      if (!days && !months) break;
      if (at > to) break;
      if (at >= from) out.push({ at, task: r, ri, oi: i, done: !!data.done[ri + ":" + i] });
    }
  });
  return out.sort((a, b) => a.at - b.at);
}
export function nextDue(data, ri) {
  const today = todayTs();
  const r = data.recurring[ri];
  const first = parseISO(r.first);
  if (!first) return null;
  const days = RECUR_DAYS[r.freq] || 0, months = RECUR_MONTHS[r.freq] || 0;
  for (let i = 0; i < 200; i++) {
    const at = months ? edate(first, months * i) : first + days * i * DAY;
    if (!days && !months) return first >= today ? first : null;
    if (at >= today && !data.done[ri + ":" + i]) return at;
  }
  return null;
}
// A recurring task is one thing that is late, not one thing per missed cycle:
// take only the most recent unticked occurrence before today.
export function lateOccurrences(data) {
  const today = todayTs();
  const out = [];
  data.recurring.forEach((r, ri) => {
    const past = occurrences(data, today - 400 * DAY, today - DAY).filter((o) => o.ri === ri && !o.done);
    if (past.length) out.push(past[past.length - 1]);
  });
  return out;
}

// ---------- debt payoff simulation ----------
export function simulateDebt(data) {
  const debts = data.debts.map((x, i) => ({ i, bal: num(x.balance), apr: num(x.apr), min: num(x.min), order: num(x.order) || i + 1 }));
  const order = debts.slice().sort((a, b) => data.strategy === "Avalanche" ? b.apr - a.apr : (data.strategy === "Custom" ? a.order - b.order : a.bal - b.bal)).map((x) => x.i);
  const bal = debts.map((x) => x.bal);
  const cleared = debts.map(() => 0);
  const trace = [bal.reduce((s, x) => s + x, 0)];
  let interest = 0;
  for (let m = 1; m <= 120; m++) {
    if (bal.every((b) => b <= 0.005)) break;
    let pool = num(data.extra);
    order.forEach((i) => {
      if (bal[i] <= 0.005) { pool += debts[i].min; return; }
      const int = bal[i] * (debts[i].apr / 100 / 12);
      interest += int;
      bal[i] = bal[i] + int - debts[i].min;
      if (bal[i] < 0) { pool += -bal[i]; bal[i] = 0; }
    });
    order.forEach((i) => {
      if (bal[i] > 0 && pool > 0) { const pay = Math.min(pool, bal[i]); bal[i] -= pay; pool -= pay; }
    });
    order.forEach((i) => { if (bal[i] <= 0.005 && !cleared[i]) { bal[i] = 0; cleared[i] = m; } });
    trace.push(bal.reduce((s, x) => s + x, 0));
  }
  return { order, cleared, months: Math.max(...cleared, 0), interest, trace };
}

// ---------- grocery roll-up ----------
export function groceryRoll(data) {
  const bag = {};
  data.ingredients.forEach((g) => {
    if (!g.name) return;
    const k = g.name + "|" + (g.unit || "");
    if (!bag[k]) bag[k] = { name: g.name, aisle: g.aisle, unit: g.unit, qty: 0 };
    bag[k].qty += num(g.qty);
  });
  const list = Object.keys(bag).map((k) => bag[k]);
  list.sort((a, b) => AISLES.indexOf(a.aisle) - AISLES.indexOf(b.aisle) || a.name.localeCompare(b.name));
  return list;
}

// ---------- habit stats ----------
// `anchor` is the same shared browsing-month timestamp buildPages computes
// once via monthAnchorAt(state.month) — Habit Tracker's grid and Dashboard's
// habit rollup both report stats for whatever month that currently is.
export function habitStats(data, anchor) {
  const dom = new Date().getDate();
  const anchorDate = new Date(anchor);
  const now = new Date();
  const isNow = anchorDate.getMonth() === now.getMonth() && anchorDate.getFullYear() === now.getFullYear();
  const len = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0).getDate();
  const counted = isNow ? dom : len;
  return data.habits.map((h) => {
    let hits = 0, streak = 0, best = 0, run = 0;
    for (let i = 1; i <= len; i++) {
      const on = !!h.days[i];
      if (on) { run++; if (run > best) best = run; } else run = 0;
      if (i <= counted && on) hits++;
    }
    for (let i = counted; i >= 1; i--) { if (h.days[i]) streak++; else break; }
    return { hits, streak, best, pct: counted ? Math.round(100 * hits / counted) : 0, len, counted };
  });
}

// ---------- cycle tracking ----------
// A lightweight estimate, not a medical prediction: average cycle length is
// derived from the gaps between logged period start dates (falling back to
// the user's own `avgLength` setting until there are at least two logged
// starts to measure a real gap from).
export function cycleStats(data, today) {
  const starts = (data.cycle.periods || []).map(parseISO).filter((t) => t !== null).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < starts.length; i++) gaps.push(Math.round((starts[i] - starts[i - 1]) / DAY));
  const avgLength = gaps.length ? Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length) : num(data.cycle.avgLength) || 28;
  const duration = num(data.cycle.avgDuration) || 5;
  const last = starts.length ? starts[starts.length - 1] : null;
  const cycleDay = last ? Math.round((today - last) / DAY) + 1 : null;
  const nextStart = last ? last + avgLength * DAY : null;
  const daysUntilNext = nextStart ? Math.round((nextStart - today) / DAY) : null;
  const onPeriod = last ? cycleDay >= 1 && cycleDay <= duration : false;
  return {
    avgLength, duration, last, cycleDay, nextStart, nextStartISO: nextStart ? iso(nextStart) : null,
    daysUntilNext, onPeriod, hasData: starts.length > 0,
  };
}

// A simplified, non-overlapping 4-phase model (menstrual, then follicular,
// then a short ovulatory window, then luteal) rather than real physiology's
// overlapping follicular/menstrual phases — accurate enough for general
// self-care guidance, not framed as a cycle-charting/fertility tool.
// Ovulation is pinned 14 days before the next predicted start (the luteal
// phase stays fairly fixed at ~14 days regardless of overall cycle length),
// clamped to land after the period ends even on a short or irregular cycle.
export function cyclePhases(cycleDay, avgLength, duration) {
  const ov = Math.max(duration + 2, avgLength - 14);
  return [
    { id: "menstrual", label: "Menstrual", from: 1, to: duration },
    { id: "follicular", label: "Follicular", from: duration + 1, to: ov - 1 },
    { id: "ovulatory", label: "Ovulatory", from: ov, to: ov + 1 },
    { id: "luteal", label: "Luteal", from: ov + 2, to: avgLength },
  ]
    .filter((p) => p.to >= p.from)
    .map((p) => ({ ...p, current: cycleDay != null && cycleDay >= p.from && cycleDay <= p.to }));
}

// ---------- engagement (login streak) ----------
// The one gamification stat that can't be derived from data that already
// exists — nothing else records "did you open the app today". Returns the
// same `data` reference unchanged if today is already recorded, so the
// caller can skip a write when nothing actually changed.
export function updateEngagement(data, todayISO) {
  const prev = data.engagement || { lastActiveDate: null, currentStreak: 0, longestStreak: 0 };
  if (prev.lastActiveDate === todayISO) return data;
  const prevTs = prev.lastActiveDate ? parseISO(prev.lastActiveDate) : null;
  const todayTs = parseISO(todayISO);
  const isConsecutive = prevTs !== null && todayTs - prevTs === DAY;
  const currentStreak = isConsecutive ? prev.currentStreak + 1 : 1;
  const longestStreak = Math.max(prev.longestStreak || 0, currentStreak);
  return { ...data, engagement: { lastActiveDate: todayISO, currentStreak, longestStreak } };
}

// ---------- gamification ----------
// Points/badges derived from data the app already tracks (habit hits/
// streaks, completed tasks, focus sessions) plus the login streak above —
// no parallel tracking system, matching how every other stat in this file
// is a pure function of `data`.
export function gamificationStats(data) {
  const hs = habitStats(data);
  const bestEverStreak = hs.reduce((m, h) => Math.max(m, h.best), 0);
  const currentHabitStreak = hs.reduce((m, h) => Math.max(m, h.streak), 0);
  const tasksCompleted = data.tasks.filter((t) => t.status === "Completed").length + Object.keys(data.done || {}).length;
  const focusSessionsTotal = Object.values(data.focusSessions || {}).reduce((s, n) => s + num(n), 0);
  const habitHitsTotal = hs.reduce((s, h) => s + h.hits, 0);
  const engagement = data.engagement || { currentStreak: 0, longestStreak: 0 };
  const points = tasksCompleted * 10 + focusSessionsTotal * 15 + habitHitsTotal * 5;
  const badges = [
    { id: "streak7", label: i18n.t("badges.streak7"), achieved: bestEverStreak >= 7, tint: "health" },
    { id: "streak30", label: i18n.t("badges.streak30"), achieved: bestEverStreak >= 30, tint: "health" },
    { id: "tasks10", label: i18n.t("badges.tasks10"), achieved: tasksCompleted >= 10, tint: "work" },
    { id: "tasks50", label: i18n.t("badges.tasks50"), achieved: tasksCompleted >= 50, tint: "work" },
    { id: "focus1", label: i18n.t("badges.focus1"), achieved: focusSessionsTotal >= 1, tint: "money" },
    { id: "focus10", label: i18n.t("badges.focus10"), achieved: focusSessionsTotal >= 10, tint: "money" },
    { id: "login7", label: i18n.t("badges.login7"), achieved: (engagement.longestStreak || 0) >= 7, tint: "people" },
  ];
  return {
    points, tasksCompleted, focusSessionsTotal, bestHabitStreak: bestEverStreak, currentHabitStreak,
    loginStreak: engagement.currentStreak || 0, longestLoginStreak: engagement.longestStreak || 0,
    badges, badgesEarned: badges.filter((b) => b.achieved).length,
  };
}

export function money(data, n) {
  const c = data.settings.currency || "$";
  return (n < 0 ? "−" : "") + c + Math.abs(Math.round(n)).toLocaleString();
}
