// Pure parsing/matching/execution logic for QuickCapture.jsx (typed input)
// and VoiceCapture's normalized-transcript path (see quickCapture.js's
// applyWeight/applyHabit below) -- kept separate from either component so
// it's cheap to reason about (and test) without React, and so both callers
// share one implementation instead of two copies that could drift. No
// network calls, no LLM in this file itself -- these two command shapes
// are simple enough to resolve locally once the text is in hand, which
// also keeps typed capture instant (no round-trip) and free of any
// dependency on the still-dark AI_ENABLED flag.

import { iso } from "./data.js";
import { supabase } from "./supabaseClient.js";

const KG_PER_LB = 0.45359237;

// Classic DP edit distance, O(a.length * b.length), fine at habit-name
// lengths (never more than a couple dozen chars).
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

function similarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// value is stored in whatever unit the app's own settings.units currently
// means (see pages.js's weight table -- the `kg` field name is legacy, it
// really means "the number, in settings.units"). Only converts when the
// person typed a unit that disagrees with that setting; a bare number or a
// matching unit passes through unchanged.
export function toSettingsUnit(value, typedUnit, settingsUnit) {
  if (!typedUnit || typedUnit === settingsUnit) return value;
  if (typedUnit === "kg" && settingsUnit === "lb") return value / KG_PER_LB;
  if (typedUnit === "lb" && settingsUnit === "kg") return value * KG_PER_LB;
  return value;
}

export function parseWeightCommand(text) {
  const lower = text.toLowerCase();
  if (!/\bweight\b/.test(lower)) return null;
  const numMatch = lower.match(/(\d+(?:\.\d+)?)/);
  if (!numMatch) return null;
  const value = parseFloat(numMatch[1]);
  if (!isFinite(value) || value <= 0) return null;
  // No \b between "78" and "kg" in "78kg" -- digit and letter are both
  // word characters, so there's no boundary for \bkg\b to match at. A unit
  // glued straight onto the number (exactly the "78kg" shape from the
  // brief) needs its own check separate from the word-boundary scan below.
  let unit = null;
  const glued = lower.match(/\d(kgs?|kilograms?|kilos?|lbs?|pounds?)\b/);
  if (glued) unit = /^(kgs?|kilograms?|kilos?)/.test(glued[1]) ? "kg" : "lb";
  else if (/\b(kgs?|kilograms?|kilos?)\b/.test(lower)) unit = "kg";
  else if (/\b(lbs?|pounds?)\b/.test(lower)) unit = "lb";
  return { value, unit };
}

// Strips the command's own verbs/markers so what's left is (hopefully)
// just the habit name -- "mark Meditation as done today" -> "Meditation".
// Deliberately narrow: only recognized once a done-ish word shows up
// somewhere, so casual text that isn't trying to be a command (e.g. a
// habit named "Weight training") doesn't get misread as one.
const DONE_RE = /\b(done|complete|completed|finish|finished|check(ed)?\s+off)\b/i;

export function extractHabitCandidate(text) {
  if (!DONE_RE.test(text)) return null;
  let s = text.trim();
  s = s.replace(/^(mark|log|check(ed)?\s+off|check|complete|completed|finish|finished)\s+/i, "");
  s = s.replace(/\s*(as\s+)?(done|complete|completed|finish|finished|check(ed)?\s+off)\b\.?\s*(today)?\.?$/i, "");
  s = s.replace(/\s+today\.?$/i, "");
  s = s.replace(/^(my|the)\s+/i, "");
  s = s.replace(/^["'\s]+|["'.\s]+$/g, "");
  return s;
}

// Confidence policy: an exact or uniquely-identifying substring match
// applies with no prompt. Anything else -- multiple candidates close
// enough to be plausible, or nothing close enough -- comes back as
// `alternatives` for the caller to show as a quick pick instead of
// guessing wrong on a health-adjacent field.
export function matchHabit(candidateRaw, habits) {
  const candidate = (candidateRaw || "").trim().toLowerCase();
  if (!candidate) return { match: null, index: -1, alternatives: [] };

  const exact = [];
  habits.forEach((h, i) => { if (h.name.trim().toLowerCase() === candidate) exact.push(i); });
  if (exact.length === 1) return { match: habits[exact[0]], index: exact[0], alternatives: [] };

  const substr = [];
  habits.forEach((h, i) => {
    const hn = h.name.trim().toLowerCase();
    if (hn && (hn.includes(candidate) || candidate.includes(hn))) substr.push(i);
  });
  if (substr.length === 1) return { match: habits[substr[0]], index: substr[0], alternatives: [] };
  if (substr.length > 1) return { match: null, index: -1, alternatives: substr.map((i) => ({ h: habits[i], index: i })) };

  const scored = habits.map((h, i) => ({ h, index: i, score: similarity(candidate, h.name.trim().toLowerCase()) }));
  scored.sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { match: null, index: -1, alternatives: [] };
  const best = scored[0];
  const second = scored[1];
  if (best.score >= 0.6 && (!second || best.score - second.score >= 0.15)) {
    return { match: best.h, index: best.index, alternatives: [] };
  }
  const close = scored.filter((s) => s.score >= 0.4).slice(0, 3).map((s) => ({ h: s.h, index: s.index }));
  return { match: null, index: -1, alternatives: close };
}

// Mutation + status-message pair for a parsed weight command. Returns the
// status object rather than setting it directly (no React here) -- both
// QuickCapture.jsx and VoiceCapture.jsx just do `setStatus(applyWeight(...))`.
export function applyWeight(data, patch, value, unit) {
  const settingsUnit = data.settings.units === "Metric" ? "kg" : "lb";
  const converted = toSettingsUnit(value, unit, settingsUnit);
  const today = iso(Date.now());
  patch((n) => {
    const idx = n.weights.findIndex((w) => w.date === today && w.who === "Me");
    if (idx >= 0) n.weights[idx].kg = converted;
    else n.weights.push({ date: today, who: "Me", kg: converted, note: "" });
  });
  const noteConversion = unit && unit !== settingsUnit;
  return {
    kind: "ok",
    text: `Logged ${converted.toFixed(1)} ${settingsUnit}${noteConversion ? ` (converted from ${value} ${unit})` : ""}.`,
  };
}

export function applyHabit(data, patch, index, name) {
  const dayNum = new Date().getDate();
  const alreadyDone = !!data.habits[index]?.days?.[dayNum];
  if (!alreadyDone) {
    patch((n) => { n.habits[index].days[dayNum] = true; });
  }
  return { kind: "ok", text: alreadyDone ? `"${name}" was already marked done today.` : `"${name}" marked done today.` };
}

// Fire-and-forget: the voice_command_log table (see
// supabase/migrations/0007_voice_command_log.sql) exists purely as future
// personalization training signal right now -- nothing reads it back yet
// -- so a logging failure must never surface to the user or block the
// command that already applied.
export async function logVoiceCommand(transcript, normalizedText, parsedIntent, applied) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("voice_command_log").insert({
      user_id: user.id,
      transcript,
      normalized_text: normalizedText,
      parsed_intent: parsedIntent,
      applied,
    });
  } catch {
    /* best-effort logging only */
  }
}

// The one entry point QuickCapture.jsx calls. Weight is checked first
// since it has a harder, more specific signal (an explicit number) --
// checking "done" first could otherwise misfire on a sentence that
// happens to contain both words.
export function parseCommand(text, habits) {
  const weight = parseWeightCommand(text);
  if (weight) return { kind: "weight", ...weight };

  const candidate = extractHabitCandidate(text);
  if (candidate !== null) {
    const result = matchHabit(candidate, habits);
    return { kind: "habit", candidate, ...result };
  }

  return { kind: "none" };
}
