// Pure parsing/matching/execution logic for QuickCapture.jsx -- kept
// separate from the component so it's cheap to reason about (and test)
// without React. No network calls, no LLM in this file itself: Ollama's
// only role is normalizing casual/bilingual speech into the exact
// canonical shapes this file parses, never doing any date/number
// arithmetic or query-answering itself.
//
// QuickCapture.jsx used to also have a typed-input path that called these
// same functions directly on raw text (hence some of the looser,
// heuristic-fallback parsing below, from before every string reaching
// parseCommand was already Ollama's canonical output) -- that path is
// gone now (see QuickCapture.jsx's own comment on the voice-session
// redesign), so any command added from here on only needs to parse the
// one exact canonical shape, no loose fallback required. answerQuery
// below is the first one written that way.

import { iso, parseISO, fmtDate, DAY } from "./data.js";
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

// Bare trigger, no extraction needed -- cycle-logging has no name or
// number to pull out, just "did the word period appear". Checked near the
// top, right after weight, since there's no realistic overlap with any
// other shape's own trigger words. Only ever reachable in the UI when
// settings.gender === "Female" (see QuickCapture.jsx and pages.js's own
// buildNavGroups, which gates the Cycle tab itself the same way) -- a
// person who'd never see this mentioned shouldn't be able to trigger a
// dead-feeling command by accident.
const PERIOD_TRIGGER_RE = /\bperiod\b/i;

export function applyCycle(data, patch) {
  patch((n) => { n.cycle.periods.push(iso(Date.now())); });
  return { kind: "ok", text: "Logged period start for today." };
}

// Strips the command's own verbs/markers so what's left is (hopefully)
// just the habit name -- "mark Meditation as done today" -> "Meditation".
// Deliberately narrow: only recognized once a done-ish word shows up
// somewhere, so casual text that isn't trying to be a command (e.g. a
// habit named "Weight training") doesn't get misread as one.
const DONE_RE = /\b(done|complete|completed|finish|finished|check(ed)?\s+off)\b/i;

// Shared by extractHabitCandidate's normal, done-word-gated path AND
// forceParseByType's "you just told me it's a habit" recovery path -- one
// stripping implementation, not two copies that could quietly drift apart.
function stripHabitMarkers(text) {
  let s = text.trim();
  s = s.replace(/^(mark|log|check(ed)?\s+off|check|complete|completed|finish|finished)\s+/i, "");
  s = s.replace(/\s*(as\s+)?(done|complete|completed|finish|finished|check(ed)?\s+off)\b\.?\s*(today)?\.?$/i, "");
  s = s.replace(/\s+today\.?$/i, "");
  s = s.replace(/^(my|the)\s+/i, "");
  s = s.replace(/^["'\s]+|["'.\s]+$/g, "");
  return s;
}

export function extractHabitCandidate(text) {
  if (!DONE_RE.test(text)) return null;
  return stripHabitMarkers(text);
}

// Same structure as extractHabitCandidate above, gated on "paid"/"pay"
// instead of a done-word, and stripping a trailing "paid" instead of
// "done". Note this shares its trigger word with EXPENSE_TRIGGER_RE below
// ("mark rent paid" and "i paid $12" both contain "paid") -- that's safe
// because parseExpenseCommand only succeeds when it also finds a number,
// and bill-marking commands never have one, so expense (checked first)
// naturally falls through to this instead of misfiring.
const BILL_PAID_RE = /\b(paid|pay)\b/i;

// Same shared-extraction reasoning as stripHabitMarkers above.
function stripBillMarkers(text) {
  let s = text.trim();
  s = s.replace(/^(mark|pay|paid)\s+/i, "");
  s = s.replace(/\s*(as\s+)?paid\b\.?\s*(today)?\.?$/i, "");
  s = s.replace(/\s+today\.?$/i, "");
  s = s.replace(/^(my|the)\s+/i, "");
  s = s.replace(/^["'\s]+|["'.\s]+$/g, "");
  return s;
}

export function extractBillCandidate(text) {
  if (!BILL_PAID_RE.test(text)) return null;
  return stripBillMarkers(text);
}

// Trigger word/symbol for an expense command -- deliberately not just "a
// number", since a bare number is meaningless on its own (unlike weight,
// which is gated on the word "weight"). Requires either a spend-verb or a
// currency symbol glued to digits, mirroring how parseWeightCommand gates
// on the word "weight" before it goes looking for a number.
const EXPENSE_TRIGGER_RE = /\b(spent|spend|paid|pay|cost|costs)\b|[$€£]\s?\d/i;
const EXPENSE_SHAPE_RE = /^log expense (\d+(?:\.\d+)?) for (.+)$/i;

// Same "harder, more specific signal" idea as weight: only fires once a
// spend-verb or currency symbol is present, so casual text that happens to
// contain a number ("call at 5") doesn't get misread as an expense.
export function parseExpenseCommand(text) {
  // The Edge Function's canonical output ("log expense 12 for lunch")
  // parses directly -- no need to run it back through the looser heuristics
  // below, and doing so would risk the strip-the-number-and-verb logic
  // mangling a description that legitimately starts with "for".
  const canonical = text.match(EXPENSE_SHAPE_RE);
  if (canonical) {
    const amount = parseFloat(canonical[1]);
    if (isFinite(amount) && amount > 0) return { amount, description: canonical[2].trim() };
  }

  const lower = text.toLowerCase();
  if (!EXPENSE_TRIGGER_RE.test(lower)) return null;
  const numMatch = text.match(/(\d+(?:\.\d+)?)/);
  if (!numMatch) return null;
  const amount = parseFloat(numMatch[1]);
  if (!isFinite(amount) || amount <= 0) return null;

  // Strip the amount and the command's own verbs/markers so what's left is
  // (hopefully) just the description -- same approach as
  // extractHabitCandidate above, applied to a different set of markers.
  let s = text.replace(numMatch[0], "");
  s = s.replace(/^(i\s+)?(spent|spend|paid|pay|cost|costs)\b/i, "");
  s = s.replace(/[$€£]/g, "");
  s = s.replace(/^\s*(on|for)\s+/i, "");
  s = s.replace(/^["'\s]+|["'.\s]+$/g, "");
  const description = s.trim() || "Expense";
  return { amount, description };
}

// Static keyword -> EXP_CATS lookup, same spirit as matchHabit's fuzzy
// match but against a fixed list instead of the user's own dynamic habits.
// A category guess is a soft, low-stakes field the user routinely edits by
// hand anyway (see pages.js's own add()/voiceAdd(), which already default
// every new expense to "Groceries" no matter what) -- so unlike the
// amount, it's never worth blocking on or asking to confirm.
const EXPENSE_CATEGORY_KEYWORDS = [
  { cat: "Dining", words: ["lunch", "dinner", "breakfast", "coffee", "restaurant", "takeaway", "takeout", "cafe", "café", "brunch"] },
  { cat: "Transport", words: ["uber", "lyft", "taxi", "gas", "petrol", "fuel", "bus", "train", "parking"] },
  { cat: "Utilities", words: ["electricity", "water bill", "gas bill", "internet", "phone bill"] },
  { cat: "Housing", words: ["rent", "mortgage"] },
  { cat: "Health", words: ["pharmacy", "doctor", "medicine", "dentist", "prescription"] },
  { cat: "Subscriptions", words: ["subscription", "netflix", "spotify", "membership"] },
  { cat: "Shopping", words: ["clothes", "clothing", "shoes", "amazon", "shopping"] },
  { cat: "Kids", words: ["kids", "school", "toys", "daycare"] },
  { cat: "Pets", words: ["vet", "pet", "dog food", "cat food"] },
  { cat: "Travel", words: ["flight", "hotel", "travel", "trip"] },
  { cat: "Gifts", words: ["gift", "present"] },
];

export function guessExpenseCategory(description) {
  const lower = (description || "").toLowerCase();
  for (const { cat, words } of EXPENSE_CATEGORY_KEYWORDS) {
    if (words.some((w) => lower.includes(w))) return cat;
  }
  return "Groceries";
}

// Task's own trigger, same "harder, more specific signal" idea as the
// other three shapes -- gated on a task-verb phrase, not just any sentence
// that happens to mention a date.
const TASK_TRIGGER_RE = /\b(remind me to|add (?:a )?tasks?(?: to)?|i need to|don'?t forget to|to-?do)\b/i;
const TASK_SHAPE_RE = /^add task (.+) due (.+)$/i;
// Explicit "due <phrase>" / "by <phrase>" wins if present; otherwise this
// looks for a bare date phrase tacked onto the end of the sentence (how
// people actually talk: "call the dentist tomorrow", not "...due tomorrow").
// The leading on/by/for is consumed but deliberately NOT captured into the
// phrase, so it doesn't leak into either the name or the resolved phrase
// ("pay the rent on march 5th" -> name "pay the rent", phrase "march 5th",
// not phrase "on march 5th"); next/this stay inside the capture for the
// weekday case since they're a temporal modifier, not a preposition.
const TRAILING_DATE_RE = /\s+(?:on\s+|by\s+|for\s+)?(today|tomorrow|(?:next\s+|this\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|in\s+\d+\s+days?|[a-z]+\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?)\s*$/i;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// The one place any date arithmetic happens -- Ollama is explicitly told
// never to compute a date itself (see voice-command/index.ts's Shape 4),
// only to classify the phrase into this same small vocabulary, so this
// function is the single source of truth for what "next Friday" or "in 3
// days" actually resolves to, identical for typed and voice input. Mirrors
// the rest of the app's own date math (todayTs()/iso(Date.now()) in
// engine.js and quickCapture.js above) -- local device time throughout,
// same as everywhere else; see the Phase 2 task-creation audit for why
// settings.timezone plays no part in this (nothing in this app resolves
// dates against it -- it only ever travels to the Google Calendar sync
// Edge Function, which needs an explicit IANA string the browser's own
// Date object doesn't).
export function resolveDatePhrase(phraseRaw, now = Date.now()) {
  const phrase = (phraseRaw || "").trim().toLowerCase().replace(/^next\s+|^this\s+|^on\s+/, "");
  const base = new Date(now);
  base.setHours(0, 0, 0, 0);
  if (!phrase || phrase === "none") return iso(base.getTime());
  if (phrase === "today") return iso(base.getTime());
  if (phrase === "tomorrow") return iso(base.getTime() + DAY);

  const weekdayIdx = WEEKDAYS.indexOf(phrase);
  if (weekdayIdx >= 0) {
    const todayIdx = base.getDay();
    let delta = (weekdayIdx - todayIdx + 7) % 7;
    // "Monday" said on a Monday means next Monday, not today -- someone
    // who meant today would say "today", not name the day.
    if (delta === 0) delta = 7;
    return iso(base.getTime() + delta * DAY);
  }

  const nDays = phrase.match(/^in\s+(\d+)\s+days?$/);
  if (nDays) {
    const n = parseInt(nDays[1], 10);
    if (isFinite(n) && n >= 0) return iso(base.getTime() + n * DAY);
  }

  // Explicit date: "<month> <day>[ <year>]" -- e.g. "march 5", "march 5th",
  // "march 5 2027", "march 5th, 2027". No year stated -> roll to next year
  // if that month/day has already passed this year (a birthday-style
  // "MM-DD recurs every year" rule, same idea as pages.js's own greeting
  // logic for birthdays).
  const explicit = phrase.match(/^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?$/);
  if (explicit) {
    const monthIdx = MONTHS.findIndex((m) => m.startsWith(explicit[1]));
    const day = parseInt(explicit[2], 10);
    if (monthIdx >= 0 && day >= 1 && day <= 31) {
      const yearGiven = explicit[3] ? parseInt(explicit[3], 10) : null;
      let year = yearGiven || base.getFullYear();
      let candidate = new Date(year, monthIdx, day);
      candidate.setHours(0, 0, 0, 0);
      if (!yearGiven && candidate.getTime() < base.getTime()) {
        candidate = new Date(year + 1, monthIdx, day);
        candidate.setHours(0, 0, 0, 0);
      }
      return iso(candidate.getTime());
    }
  }

  return null;
}

// Which phrase kinds are safe to apply without a confirm step -- see the
// Phase 2 task-creation plan's table. "today"/"tomorrow"/no-date-said are
// pure mechanical +0/+1/default arithmetic; an explicit date WITH a year
// is fully unambiguous. Everything else (a bare weekday name, "in N days",
// or an explicit date the resolver has to guess a year for) involves a
// judgment call that could silently miss what the person meant, so it
// gets a one-tap confirm before the task is created -- computed here,
// applied identically to typed and voice input, unlike weight/expense's
// confirm step (see voice-command/index.ts's comment on why those two are
// different: that risk is transcription-specific, this one isn't).
const SAFE_DATE_PHRASE_RE = /^(today|tomorrow|none)$/;
const EXPLICIT_DATE_WITH_YEAR_RE = /^[a-z]+\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{4}$/;

export function parseTaskCommand(text) {
  let name, phrase;
  const canonical = text.match(TASK_SHAPE_RE);
  if (canonical) {
    name = canonical[1].trim();
    phrase = canonical[2].trim();
  } else {
    if (!TASK_TRIGGER_RE.test(text)) return null;
    let s = text.trim().replace(TASK_TRIGGER_RE, "").replace(/^\s*(to\s+)?/i, "");
    const dueClause = s.match(/\s+(due|by)\s+(.+)$/i);
    if (dueClause) {
      name = s.slice(0, dueClause.index).trim();
      phrase = dueClause[2].trim();
    } else {
      const trailing = s.match(TRAILING_DATE_RE);
      if (trailing) {
        name = s.slice(0, trailing.index).trim();
        phrase = trailing[1].trim();
      } else {
        name = s.trim();
        phrase = "none";
      }
    }
  }
  name = name.replace(/^["'\s]+|["'.\s]+$/g, "");
  if (!name) return null;
  // A bare leftover marker word instead of an actual name means the
  // trigger matched with nothing real after it -- confirmed happening in
  // practice: Ollama occasionally (non-deterministically, even at
  // temperature 0 -- verified by repeating the identical request) outputs
  // a malformed "add tasks due today" with no task name at all, which
  // TASK_TRIGGER_RE's "add tasks" alternative still matches, leaving just
  // "due" as the "name" once the date clause is stripped. A real task is
  // never named one of these bare prepositions, so this is treated as a
  // failed parse rather than silently creating a garbage task -- which,
  // left unguarded, would have gone through with no confirm step at all,
  // since the date phrase itself ("today") is on the safe list below.
  if (/^(due|by|to|is|as|for|on)$/i.test(name)) return null;

  const normPhrase = phrase.toLowerCase().replace(/^next\s+|^this\s+|^on\s+/, "");
  const safe = SAFE_DATE_PHRASE_RE.test(normPhrase) || EXPLICIT_DATE_WITH_YEAR_RE.test(normPhrase);
  const dateISO = resolveDatePhrase(phrase) || iso(Date.now());
  return { name, phrase, dateISO, needsConfirm: !safe };
}

// data.meals is a repeating weekly template ("0-0" is always Monday
// breakfast, every week), not tied to any real calendar date the way
// tasks/expenses are -- so unlike resolveDatePhrase above, this never
// needs to compute a future date, only the Monday-based grid day a
// weekday name or today/tomorrow corresponds to. (jsWeekday + 6) % 7 is
// the exact conversion pages.js:535 already uses for the same grid
// ("(viewDateObj.getDay() + 6) % 7") -- applied identically here so this
// file doesn't invent a second, inconsistent day convention.
export function toMealGridDay(jsWeekday) {
  return (jsWeekday + 6) % 7;
}

function resolveMealDay(dayWord) {
  const word = (dayWord || "").toLowerCase();
  if (word === "today") return toMealGridDay(new Date().getDay());
  if (word === "tomorrow") return toMealGridDay(new Date(Date.now() + DAY).getDay());
  const idx = WEEKDAYS.indexOf(word);
  return idx >= 0 ? toMealGridDay(idx) : null;
}

const MEAL_SLOT_RE = /\b(breakfast|lunch|dinner|snacks?)\b/i;
const MEAL_SLOT_INDEX = { breakfast: 0, lunch: 1, dinner: 2, snack: 3, snacks: 3 };
const MEAL_DAY_WORD_RE = /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
const MEAL_SHAPE_RE = /^set (today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday) (breakfast|lunch|dinner|snacks) to (.+)$/i;

export function parseMealCommand(text) {
  const canonical = text.match(MEAL_SHAPE_RE);
  if (canonical) {
    const gridDay = resolveMealDay(canonical[1]);
    const slot = MEAL_SLOT_INDEX[canonical[2].toLowerCase()];
    const mealText = canonical[3].trim();
    if (gridDay !== null && slot !== undefined && mealText) return { gridDay, slot, mealText };
  }

  const slotMatch = text.match(MEAL_SLOT_RE);
  if (!slotMatch) return null;
  const slot = MEAL_SLOT_INDEX[slotMatch[1].toLowerCase()];

  // No day mentioned -> today, same default-to-today policy as task's own
  // "none" phrase.
  const dayWordMatch = text.match(MEAL_DAY_WORD_RE);
  const gridDay = dayWordMatch ? resolveMealDay(dayWordMatch[1]) : toMealGridDay(new Date().getDay());

  // Strip the day word, the slot word, and leading set/for/to/is/as
  // markers so what's left is (hopefully) just the meal text -- same
  // strip-the-markers approach as extractHabitCandidate/extractBillCandidate.
  let s = text;
  if (dayWordMatch) s = s.replace(dayWordMatch[0], "");
  s = s.replace(slotMatch[0], "");
  s = s.replace(/^(set|for)\s+/i, "");
  s = s.replace(/^\s*(to|is|as)\s+/i, "");
  s = s.replace(/^["'\s]+|["'.\s]+$/g, "");
  const mealText = s.trim();
  if (!mealText) return null;
  return { gridDay: gridDay ?? toMealGridDay(new Date().getDay()), slot, mealText };
}

const MEAL_SLOT_LABELS = ["Breakfast", "Lunch", "Dinner", "Snack"];

export function applyMeal(data, patch, gridDay, slot, mealText) {
  const text = (mealText || "").trim() || "Meal";
  patch((n) => { n.meals[`${gridDay}-${slot}`] = text; });
  return { kind: "ok", text: `Set ${MEAL_SLOT_LABELS[slot]} to "${text}".` };
}

const WORKOUT_SHAPE_RE = /^log workout (.+) (\d+) sets of (\d+) reps at (\d+) kg$/i;

export function parseWorkoutCommand(text) {
  const m = text.match(WORKOUT_SHAPE_RE);
  if (!m) return null;
  const ex = m[1].trim();
  const sets = parseInt(m[2], 10);
  const reps = parseInt(m[3], 10);
  const weight = parseInt(m[4], 10);
  if (!ex || !isFinite(sets) || sets <= 0 || !isFinite(reps) || reps <= 0) return null;
  return { ex, sets, reps, weight: isFinite(weight) ? weight : 0 };
}

// "Push" for focus, not an invented "General" category -- verified against
// the real FOCUS list (data.js) before writing this: "General" isn't a
// valid focus value at all, and Fitness' own "+ Log a set" button already
// defaults new rows to "Push" (something to fix by hand afterward, same
// deal a voice-logged row is in, since there's nowhere in this command's
// spoken shape to say focus).
export function applyWorkout(data, patch, ex, sets, reps, weight) {
  const exName = (ex || "").trim() || "Exercise";
  patch((n) => { n.workouts.unshift({ date: iso(Date.now()), who: "Me", ex: exName, focus: "Push", sets, reps, weight }); });
  return { kind: "ok", text: `Logged ${exName}: ${sets} sets of ${reps}${weight > 0 ? ` at ${weight} kg` : ""}.` };
}

// Read-only, so unlike every command above there's nothing to canonicalize
// beyond the exact shape itself -- no name/number extraction, no
// heuristic fallback (see this file's own top comment on why new commands
// don't need one any more). Three fixed questions Ollama's own prompt is
// told to normalize everything into.
export function parseQueryCommand(text) {
  const spending = text.match(/^query spending this month(?: for (.+))?$/i);
  if (spending) return { type: "spending", category: spending[1]?.trim() || null };
  if (/^query current weight$/i.test(text)) return { type: "weight" };
  if (/^query tasks due today$/i.test(text)) return { type: "tasksToday" };
  if (/^query bills due this week$/i.test(text)) return { type: "billsThisWeek" };
  return null;
}

// Nothing here ever calls patch() -- these three just read data and word
// an answer, which is exactly why none of them needed a needsConfirm
// treatment in voice-command/index.ts: there's no wrong value that could
// get silently saved, only a possibly-wrong spoken answer the person who
// just asked can immediately judge for themselves.
export function answerQuery(data, type, category) {
  if (type === "spending") {
    const month = iso(Date.now()).slice(0, 7);
    const matches = data.expenses.filter((e) => e.date.startsWith(month) && (!category || e.cat.toLowerCase() === category.toLowerCase()));
    const total = matches.reduce((sum, e) => sum + e.amount, 0);
    return { kind: "ok", text: `You've spent ${data.settings.currency}${total.toFixed(2)}${category ? ` on ${category}` : ""} this month.` };
  }
  if (type === "weight") {
    const latest = data.weights.slice().sort((a, b) => (parseISO(b.date) || 0) - (parseISO(a.date) || 0))[0];
    if (!latest) return { kind: "ok", text: "No weight logged yet." };
    const unit = data.settings.units === "Metric" ? "kg" : "lb";
    return { kind: "ok", text: `Your last logged weight was ${latest.kg.toFixed(1)} ${unit} on ${fmtDate(parseISO(latest.date))}.` };
  }
  if (type === "tasksToday") {
    const today = iso(Date.now());
    // "Completed"/"Cancelled", not "Done" -- verified against the real
    // STATUSES list (data.js) before writing this, not assumed, since
    // guessing the meal grid's day convention wrong earlier this session
    // is exactly the mistake this was checked against repeating.
    const due = data.tasks.filter((t) => t.due === today && t.status !== "Completed" && t.status !== "Cancelled");
    if (due.length === 0) return { kind: "ok", text: "Nothing due today." };
    return { kind: "ok", text: `You have ${due.length} task${due.length > 1 ? "s" : ""} due today: ${due.map((t) => t.name).join(", ")}.` };
  }
  if (type === "billsThisWeek") {
    // bills' `due` is a plain static date -- verified before writing this
    // that no monthly-recurrence math is applied to it anywhere in the
    // existing code, so a straight ISO-string date-range filter is
    // correct here, same technique the spending query above already uses.
    const today = iso(Date.now());
    const weekEnd = iso(Date.now() + 7 * DAY);
    const due = data.bills.filter((b) => !b.paid && b.due >= today && b.due <= weekEnd);
    if (due.length === 0) return { kind: "ok", text: "No bills due this week." };
    return { kind: "ok", text: `You have ${due.length} bill${due.length > 1 ? "s" : ""} due this week: ${due.map((b) => b.name).join(", ")}.` };
  }
  return { kind: "ok", text: "I couldn't work that out." };
}

// Confidence policy: an exact or uniquely-identifying substring match
// applies with no prompt. Anything else -- multiple candidates close
// enough to be plausible, or nothing close enough -- comes back as
// `alternatives` for the caller to show as a quick pick instead of
// guessing wrong on a health-adjacent field. Generalized from what used to
// be habit-only matching -- Bills and Net Worth need the exact same
// name-matching logic against their own arrays, so this takes any array of
// `.name`-bearing items rather than habits specifically.
//
// `aliases`/`domain` are optional (existing callers that don't pass them
// keep working unchanged): if the exact normalized phrase was corrected
// before via the "which one did you mean?" quick-pick (see
// QuickCapture.jsx's recordAlias), that correction wins outright, ahead of
// exact/substring/fuzzy scoring -- someone who already told the app what
// they meant by this phrase almost certainly means the same thing again,
// and re-running fresh scoring risks landing on the same ambiguity (or a
// different wrong answer) a second time. Falls through to normal matching
// if the aliased target_name doesn't resolve to a real item any more (e.g.
// renamed or deleted since the correction was recorded).
export function matchByName(candidateRaw, items, aliases, domain) {
  const candidate = (candidateRaw || "").trim().toLowerCase();
  if (!candidate) return { match: null, index: -1, alternatives: [] };

  if (aliases && domain) {
    const alias = aliases.find((a) => a.domain === domain && a.phrase === candidate);
    if (alias) {
      const idx = items.findIndex((h) => h.name.trim().toLowerCase() === alias.target_name.trim().toLowerCase());
      if (idx >= 0) return { match: items[idx], index: idx, alternatives: [] };
    }
  }

  const exact = [];
  items.forEach((h, i) => { if (h.name.trim().toLowerCase() === candidate) exact.push(i); });
  if (exact.length === 1) return { match: items[exact[0]], index: exact[0], alternatives: [] };

  const substr = [];
  items.forEach((h, i) => {
    const hn = h.name.trim().toLowerCase();
    if (hn && (hn.includes(candidate) || candidate.includes(hn))) substr.push(i);
  });
  if (substr.length === 1) return { match: items[substr[0]], index: substr[0], alternatives: [] };
  if (substr.length > 1) return { match: null, index: -1, alternatives: substr.map((i) => ({ h: items[i], index: i })) };

  const scored = items.map((h, i) => ({ h, index: i, score: similarity(candidate, h.name.trim().toLowerCase()) }));
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

// Thin wrapper -- kept so nothing existing (parseCommand's habit branch,
// QuickCapture.jsx's pickAlternative) has to change.
export function matchHabit(candidate, habits, aliases) {
  return matchByName(candidate, habits, aliases, "habit");
}

// Net worth is the one command that has to find a name across three
// differently-shaped arrays (debts, savings, investments) rather than one.
// Reuses matchByName's exact/substring/fuzzy logic completely unchanged by
// flattening all three into a single `.name`-bearing list first, each
// entry tagged with which table and index it came from -- so the matching
// behavior (what counts as an exact/ambiguous/close-enough match) is
// identical to bills/habits, just sourced from three places instead of
// one. Re-shapes matchByName's raw {h, index} result into the
// {table, index, item} shape callers actually need (table+index is what
// applyNetWorthUpdate takes; matchByName's own `index` is only meaningful
// within the flattened list, not to any real array, so it's dropped here).
export function matchAccountByName(candidateRaw, data, aliases) {
  const combined = [
    ...(data?.debts || []).map((item, index) => ({ name: item.name, table: "debts", index, item })),
    ...(data?.savings || []).map((item, index) => ({ name: item.name, table: "savings", index, item })),
    ...(data?.investments || []).map((item, index) => ({ name: item.name, table: "investments", index, item })),
  ];
  const result = matchByName(candidateRaw, combined, aliases, "networth");
  return {
    match: result.match ? { table: result.match.table, index: result.match.index, item: result.match.item } : null,
    alternatives: result.alternatives.map((a) => ({ table: a.h.table, index: a.h.index, item: a.h.item })),
  };
}

// Canonical shape first (Ollama's Shape 7 output, "update <name> to
// <number>"), then a looser typed-input fallback gated on an update/set
// verb plus a number -- same "canonical first, heuristic fallback" pattern
// parseExpenseCommand uses. Note this shares "update"/"set" with nothing
// else in this file, but a typed command containing a literal currency
// symbol ("update Overdraft to $300") can still be caught by
// EXPENSE_TRIGGER_RE first, since expense is checked earlier -- a known,
// narrow collision in the same spirit as the other documented ones in this
// file (e.g. bill/expense both triggering on "paid"), not worth
// engineering around for how rarely typed input would phrase it that way.
const NETWORTH_SHAPE_RE = /^update (.+) to (\d+(?:\.\d+)?)$/i;
const NETWORTH_TRIGGER_RE = /\b(update|set)\b/i;

export function parseNetWorthCommand(text) {
  const canonical = text.match(NETWORTH_SHAPE_RE);
  if (canonical) {
    const amount = parseFloat(canonical[2]);
    if (isFinite(amount) && amount >= 0) return { name: canonical[1].trim(), amount };
  }

  if (!NETWORTH_TRIGGER_RE.test(text)) return null;
  const numMatch = text.match(/(\d+(?:\.\d+)?)/);
  if (!numMatch) return null;
  const amount = parseFloat(numMatch[1]);
  if (!isFinite(amount) || amount < 0) return null;

  let s = text.replace(numMatch[0], "");
  s = s.replace(/^(update|set)\s+/i, "");
  s = s.replace(/\s*to\s*$/i, "");
  s = s.replace(/^["'\s]+|["'.\s]+$/g, "");
  const name = s.trim();
  if (!name) return null;
  return { name, amount };
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

// Unlike applyWeight (upsert-by-date) and applyHabit (flip a flag on an
// already-matched record), this is a pure create -- every command is a
// brand-new row, same as pages.js's own voiceAdd() for expenses, just with
// a real parsed amount/description/category instead of blind defaults.
export function applyExpense(data, patch, amount, description) {
  const desc = (description || "").trim() || "Expense";
  const cat = guessExpenseCategory(desc);
  const today = iso(Date.now());
  patch((n) => { n.expenses.unshift({ date: today, desc, cat, how: "Debit card", amount }); });
  return { kind: "ok", text: `Logged ${data.settings.currency}${amount.toFixed(2)} for "${desc}".` };
}

const INCOME_SHAPE_RE = /^log income (\d+(?:\.\d+)?) from (.+)$/i;

export function parseIncomeCommand(text) {
  const m = text.match(INCOME_SHAPE_RE);
  if (!m) return null;
  const amount = parseFloat(m[1]);
  const source = m[2].trim();
  if (!isFinite(amount) || amount <= 0 || !source) return null;
  return { amount, source };
}

// .push(), not .unshift() -- verified against Income's own real "+ New
// entry" button (pages.js) before writing this: unlike Spending/Fitness,
// Income has no "newest first" convention (no such note in its own i18n
// entry either), and its manual add appends to the end.
export function applyIncome(data, patch, amount, source) {
  const src = (source || "").trim() || "Income";
  patch((n) => { n.income.push({ date: iso(Date.now()), source: src, type: "Paycheck", amount, note: "" }); });
  return { kind: "ok", text: `Logged ${data.settings.currency}${amount.toFixed(2)} income from "${src}".` };
}

// Pure create, same as applyExpense -- defaults every field the command
// didn't speak to exactly like pages.js's own tasks add() does (cat:
// "Personal", prio: "Medium", status: "Not Started", who: "Me"), so a
// voice-created task looks identical to one added through the Tasks page.
export function applyTask(data, patch, name, dateISO) {
  const taskName = (name || "").trim() || "Task";
  const due = dateISO || iso(Date.now());
  patch((n) => {
    n.tasks.push({ id: crypto.randomUUID(), name: taskName, desc: "", cat: "Personal", prio: "Medium", status: "Not Started", who: "Me", due, est: "", reminderTime: "" });
  });
  return { kind: "ok", text: `Added task "${taskName}", due ${fmtDate(parseISO(due))}.` };
}

// Requires the literal word "task" right after "mark" -- a bare "mark
// <name> done" is Shape 2 (marking a HABIT done, see extractHabitCandidate
// below), whose own trigger (DONE_RE) is just the word "done" anywhere in
// the phrase. Without this explicit "task" requirement, "mark task X done"
// would ALSO match DONE_RE and extractHabitCandidate would claim it first
// (parseCommand checks task-done before habit specifically to avoid this --
// see its own comment), stripping "task" into the habit-name candidate and
// searching for a habit literally named "task X" instead.
const TASK_DONE_SHAPE_RE = /^mark task (.+) done$/i;
export function extractTaskDoneCandidate(text) {
  const m = text.match(TASK_DONE_SHAPE_RE);
  return m ? m[1].trim() : null;
}
export function applyTaskDone(data, patch, index, name) {
  const alreadyDone = data.tasks[index]?.status === "Completed";
  if (!alreadyDone) {
    patch((n) => { n.tasks[index].status = "Completed"; });
  }
  return { kind: "ok", text: alreadyDone ? `"${name}" was already marked done.` : `"${name}" marked done.` };
}

// Genuinely destructive and irreversible -- unlike every other command in
// this file, this never applies on its own. parseCommand only ever
// resolves WHICH task (candidate/match/alternatives, same three-way split
// as habit/bill matching); QuickCapture.jsx is what actually gates the
// delete itself behind an explicit spoken "yes", same pattern as every
// other confirm flow.
const TASK_DELETE_SHAPE_RE = /^delete task (.+)$/i;
export function extractTaskDeleteCandidate(text) {
  const m = text.match(TASK_DELETE_SHAPE_RE);
  return m ? m[1].trim() : null;
}
export function applyTaskDelete(data, patch, index, name) {
  patch((n) => { n.tasks.splice(index, 1); });
  return { kind: "ok", text: `Deleted "${name}".` };
}

export function applyHabit(data, patch, index, name) {
  const dayNum = new Date().getDate();
  const alreadyDone = !!data.habits[index]?.days?.[dayNum];
  if (!alreadyDone) {
    patch((n) => { n.habits[index].days[dayNum] = true; });
  }
  return { kind: "ok", text: alreadyDone ? `"${name}" was already marked done today.` : `"${name}" marked done today.` };
}

export function parseAddHabitCommand(text) {
  const m = text.match(/^add habit (.+)$/i);
  return m ? { name: m[1].trim() } : null;
}

// Same defaults the Habit Tracker's own "+ New habit" button uses (see
// pages.js) -- "work" tint, not "health": the seed account's one starter
// habit happens to be health-tinted, but that's specific to that one row,
// not the general new-habit default.
export function applyAddHabit(data, patch, name) {
  const habitName = (name || "").trim() || "Habit";
  patch((n) => { n.habits.push({ name: habitName, tint: "work", days: {}, reminderTime: "" }); });
  return { kind: "ok", text: `Added habit "${habitName}".` };
}

// Same flag-flip-on-an-already-matched-record shape as applyHabit. Also
// defaults `actual` to the bill's own `budget` when marking paid with no
// actual amount recorded yet -- a voice command has no way to speak a
// different actual amount, so this is the same "best available default,
// user can correct by hand" policy as expense's category guess.
export function applyBill(data, patch, index, name) {
  const alreadyPaid = !!data.bills[index]?.paid;
  if (!alreadyPaid) {
    patch((n) => {
      n.bills[index].paid = true;
      if (!n.bills[index].actual) n.bills[index].actual = n.bills[index].budget;
    });
  }
  return { kind: "ok", text: alreadyPaid ? `"${name}" was already marked paid.` : `"${name}" marked paid.` };
}

// Reuses the exact same SAFE_DATE_PHRASE_RE/EXPLICIT_DATE_WITH_YEAR_RE/
// resolveDatePhrase Task's own parseTaskCommand uses above -- same
// ambiguous-date confirm logic, not a second, parallel system that could
// quietly drift from Task's.
export function parseAddBillCommand(text) {
  const m = text.match(/^add bill (.+) for (\d+(?:\.\d+)?) due (.+)$/i);
  if (!m) return null;
  const name = m[1].trim();
  if (!name) return null;
  const amount = parseFloat(m[2]);
  const phrase = m[3].trim();
  const normPhrase = phrase.toLowerCase().replace(/^next\s+|^this\s+|^on\s+/, "");
  const safe = SAFE_DATE_PHRASE_RE.test(normPhrase) || EXPLICIT_DATE_WITH_YEAR_RE.test(normPhrase);
  const dateISO = resolveDatePhrase(phrase) || iso(Date.now());
  return { name, amount: isFinite(amount) ? amount : 0, phrase, dateISO, needsConfirm: !safe };
}

// Same defaults Bills' own "+ New bill" button uses (see pages.js) --
// category, frequency, and the crypto.randomUUID() id pattern already used
// for tasks. budget and actual both get the spoken amount (there's no way
// to speak two different budgeted-vs-actual figures in one command), same
// "best available default, correct by hand" policy as expense's category
// guess elsewhere in this file.
export function applyAddBill(data, patch, name, amount, dateISO) {
  const billName = (name || "").trim() || "Bill";
  const billAmount = amount || 0;
  const due = dateISO || iso(Date.now());
  patch((n) => { n.bills.push({ id: crypto.randomUUID(), name: billName, cat: "Utilities", freq: "Monthly", due, budget: billAmount, actual: billAmount, paid: false, reminderTime: "" }); });
  return { kind: "ok", text: `Added bill "${billName}" for ${data.settings.currency}${billAmount.toFixed(2)}, due ${fmtDate(parseISO(due))}.` };
}

// Which field each table actually stores its current-value in --
// debts/savings/investments are differently shaped (see data.js's seed),
// so this is the one place that maps table -> field name. Reads the name
// back from the record itself rather than needing a caller to pass it, so
// callers just need table+index, same as they already have from
// matchAccountByName.
export function applyNetWorthUpdate(data, patch, table, index, amount) {
  const field = table === "debts" ? "balance" : table === "savings" ? "saved" : "current";
  const name = data[table]?.[index]?.name || "Account";
  patch((n) => { n[table][index][field] = amount; });
  return { kind: "ok", text: `"${name}" updated to ${data.settings.currency}${amount.toFixed(2)}.` };
}

const ADD_DEBT_SHAPE_RE = /^add debt (.+) for (\d+(?:\.\d+)?)$/i;
export function parseAddDebtCommand(text) {
  const m = text.match(ADD_DEBT_SHAPE_RE);
  if (!m) return null;
  const name = m[1].trim();
  const amount = parseFloat(m[2]);
  if (!name || !isFinite(amount) || amount <= 0) return null;
  return { name, amount };
}
// Same defaults Net Worth's own "+ New debt" button uses (see pages.js) --
// start and balance both get the spoken amount (a brand-new debt starts
// fully owed), apr/min are the button's own placeholder starting values,
// order is appended same as the button's n.debts.length + 1.
export function applyAddDebt(data, patch, name, amount) {
  const debtName = (name || "").trim() || "Debt";
  patch((n) => { n.debts.push({ name: debtName, start: amount, balance: amount, apr: 20, min: 25, order: n.debts.length + 1, deadline: "" }); });
  return { kind: "ok", text: `Added debt "${debtName}" for ${data.settings.currency}${amount.toFixed(2)}.` };
}

const ADD_SAVING_SHAPE_RE = /^add saving (.+) target (\d+(?:\.\d+)?)$/i;
export function parseAddSavingCommand(text) {
  const m = text.match(ADD_SAVING_SHAPE_RE);
  if (!m) return null;
  const name = m[1].trim();
  const target = parseFloat(m[2]);
  if (!name || !isFinite(target) || target <= 0) return null;
  return { name, target };
}
// Same defaults Net Worth's own "+ New pot" button uses.
export function applyAddSaving(data, patch, name, target) {
  const potName = (name || "").trim() || "Savings";
  patch((n) => { n.savings.push({ name: potName, target, saved: 0, date: iso(Date.now() + 180 * DAY), monthly: 25 }); });
  return { kind: "ok", text: `Added savings pot "${potName}" with a target of ${data.settings.currency}${target.toFixed(2)}.` };
}

const ADD_INVESTMENT_SHAPE_RE = /^add investment (.+)$/i;
export function parseAddInvestmentCommand(text) {
  const m = text.match(ADD_INVESTMENT_SHAPE_RE);
  if (!m) return null;
  const name = m[1].trim();
  return name ? { name } : null;
}
// Same defaults Net Worth's own "+ New holding" button uses, including the
// lazy-init guard on data.investments -- verified before writing this that
// investments (unlike debts/savings) isn't unconditionally seeded, so an
// older account could genuinely reach this with investments still
// undefined.
export function applyAddInvestment(data, patch, name) {
  const holdingName = (name || "").trim() || "Investment";
  patch((n) => {
    if (!n.investments) n.investments = [];
    n.investments.push({ name: holdingName, type: "Stocks", invested: 0, current: 0, date: iso(Date.now()) });
  });
  return { kind: "ok", text: `Added investment "${holdingName}".` };
}

const ADD_GOAL_SHAPE_RE = /^add goal (.+) target (\d+(?:\.\d+)?)$/i;
export function parseAddGoalCommand(text) {
  const m = text.match(ADD_GOAL_SHAPE_RE);
  if (!m) return null;
  const name = m[1].trim();
  const target = parseFloat(m[2]);
  if (!name || !isFinite(target) || target <= 0) return null;
  return { name, target };
}
// Same defaults Overview's own "+ New goal" button uses.
export function applyAddGoal(data, patch, name, target) {
  const goalName = (name || "").trim() || "Goal";
  patch((n) => { n.goals.push({ name: goalName, cat: "Personal", date: iso(Date.now() + 90 * DAY), target, current: 0 }); });
  return { kind: "ok", text: `Added goal "${goalName}" with a target of ${target}.` };
}

// Fixed literal shape (like cycle's "log my period") -- no name or number
// to extract, so there's no parse function, just the shape check itself in
// parseCommand.
const FOCUS_SESSION_SHAPE_RE = /^log a focus session$/i;
// Same lazy-init + increment pattern App.jsx's own onFocusSessionComplete
// uses for a real completed timer session -- a voice-logged session should
// count identically, not through a second, diverging code path.
export function applyFocusSession(data, patch) {
  const today = iso(Date.now());
  patch((n) => {
    if (!n.focusSessions) n.focusSessions = {};
    n.focusSessions[today] = (n.focusSessions[today] || 0) + 1;
  });
  return { kind: "ok", text: "Logged a focus session." };
}

const ADD_GROCERY_SHAPE_RE = /^add (.+) to groceries$/i;
export function parseAddGroceryCommand(text) {
  const m = text.match(ADD_GROCERY_SHAPE_RE);
  if (!m) return null;
  const name = m[1].trim();
  return name ? { name } : null;
}
// Same defaults Meal Plan's own "+ New ingredient" button uses.
export function applyAddGrocery(data, patch, name) {
  const itemName = (name || "").trim() || "Item";
  patch((n) => { n.ingredients.push({ name: itemName, aisle: "Produce", qty: 1, unit: "ea", used: "" }); });
  return { kind: "ok", text: `Added "${itemName}" to groceries.` };
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
// since it has a harder, more specific signal (an explicit number gated
// on the word "weight") -- checking "done" first could otherwise misfire
// on a sentence that happens to contain both words. Expense, task, and
// bill are checked next, before habit, for the same reason: their own
// gates (a spend-verb/currency symbol, a task-verb phrase, or "paid"/"pay")
// are more specific signals than a bare done-word -- e.g. "remind me to
// mark the report done" needs to resolve as a task, not misfire on "done".
// Bill sits after task and before habit: its trigger overlaps expense's
// ("paid"/"pay"), which is safe since expense only succeeds with a number
// present (see extractBillCandidate's comment), and it's checked ahead of
// habit since "paid"/"pay" is a more specific signal than a bare done-word.
// Net worth sits right after bill, same reasoning -- "update"/"set...to" is
// a specific-enough gate to check ahead of a bare done-word, and its own
// overlap risk (with expense, via a literal currency symbol) is already
// covered by parseNetWorthCommand's own comment. `data` is used for net
// worth's cross-table matching (matchAccountByName) and, alongside every
// other name-matching branch, for `data.voiceAliases` -- the learned
// corrections matchByName checks first (see its own comment) -- so a
// caller only needs to keep passing the one `data` object it already has,
// not thread a separate aliases argument through every call site.
// Meal is the one shape that does NOT get a "no overlap" claim: breakfast/
// lunch/dinner/snacks are ordinary English words, not command-like verbs,
// so they turn up constantly in completely unrelated commands -- "i spent
// 12 on lunch" (this file's own expense example), "remind me to buy lunch
// tomorrow", a habit literally named "Eat Breakfast". Concretely verified
// during the session that added this: with the loose meal fallback checked
// this early, all three of those get hijacked into (wrong) meal commands.
// The fix is two-touch-points, not a reorder alone: MEAL_SHAPE_RE (the
// canonical "set <day> <slot> to <text>" Ollama always outputs) is checked
// very early, right after cycle, since it's specific enough to never
// realistically collide with anything -- this alone covers every
// voice-normalized meal command. The full parseMealCommand (which falls
// back to the loose, collision-prone slot-word heuristic for casual typed
// phrasing) only runs dead last, after every other domain's own
// more-specific gate -- including habit's -- has had first claim on the
// text. A narrower gap remains even then: typed, day-omitted meal text
// that both uses "set" and happens to contain a digit ("set breakfast to 2
// eggs") can still be claimed by net worth's own loose "set...to <number>"
// fallback before reaching meal here -- accepted as the same class of
// narrow, typed-input-only collision already documented elsewhere in this
// file (e.g. bill/expense's shared "paid"), not worth further
// disambiguation for how rarely it'd actually come up.
// "Ask and learn": what QuickCapture.jsx falls back to when a phrase
// matches none of the ten domains' own trigger words at all (parseCommand
// returning {kind:"none"}) -- rather than a dead-end hint, it asks by voice
// which of the ten types the phrase was, then re-parses that exact same
// phrase as the named type WITHOUT needing its usual trigger word (the
// person just told us directly what kind it is, so the trigger word's only
// job -- disambiguating between domains -- is already done). Each function
// below is the same extraction logic its normal counterpart uses, just
// entered a step later, after the type is already known instead of being
// inferred from a trigger word. Confirm-step handling stays consistent
// with the normal path where the underlying risk is the same (task's own
// date-phrase ambiguity, still computed the identical way) and is
// deliberately skipped where it isn't: weight/expense/net-worth's
// needsConfirm exists specifically for Ollama-normalization risk (Arabic
// numeral transposition), and none of these functions ever go through
// Ollama at all -- they extract straight from the raw phrase text.

function forceParseWeight(phrase) {
  const numMatch = phrase.match(/(\d+(?:\.\d+)?)/);
  if (!numMatch) return null;
  const value = parseFloat(numMatch[1]);
  if (!isFinite(value) || value <= 0) return null;
  // Same unit-detection as parseWeightCommand, just without requiring the
  // word "weight" itself -- that's the one thing we no longer need since
  // the type is already known.
  const lower = phrase.toLowerCase();
  let unit = null;
  const glued = lower.match(/\d(kgs?|kilograms?|kilos?|lbs?|pounds?)\b/);
  if (glued) unit = /^(kgs?|kilograms?|kilos?)/.test(glued[1]) ? "kg" : "lb";
  else if (/\b(kgs?|kilograms?|kilos?)\b/.test(lower)) unit = "kg";
  else if (/\b(lbs?|pounds?)\b/.test(lower)) unit = "lb";
  return { value, unit };
}

function forceParseExpense(phrase) {
  const numMatch = phrase.match(/(\d+(?:\.\d+)?)/);
  if (!numMatch) return null;
  const amount = parseFloat(numMatch[1]);
  if (!isFinite(amount) || amount <= 0) return null;
  let s = phrase.replace(numMatch[0], "");
  s = s.replace(/[$€£]/g, "");
  s = s.replace(/^\s*(on|for)\s+/i, "");
  s = s.replace(/^["'\s]+|["'.\s]+$/g, "");
  const description = s.trim() || "Expense";
  return { amount, description };
}

// Same shape as forceParseExpense above, "from" instead of "on"/"for" as
// the connector word to strip.
function forceParseIncome(phrase) {
  const numMatch = phrase.match(/(\d+(?:\.\d+)?)/);
  if (!numMatch) return null;
  const amount = parseFloat(numMatch[1]);
  if (!isFinite(amount) || amount <= 0) return null;
  let s = phrase.replace(numMatch[0], "");
  s = s.replace(/[$€£]/g, "");
  s = s.replace(/^\s*(from)\s+/i, "");
  s = s.replace(/^["'\s]+|["'.\s]+$/g, "");
  const source = s.trim() || "Income";
  return { amount, source };
}

function forceParseTask(phrase) {
  let s = phrase.trim();
  let name, datePhrase;
  const dueClause = s.match(/\s+(due|by)\s+(.+)$/i);
  if (dueClause) {
    name = s.slice(0, dueClause.index).trim();
    datePhrase = dueClause[2].trim();
  } else {
    const trailing = s.match(TRAILING_DATE_RE);
    if (trailing) {
      name = s.slice(0, trailing.index).trim();
      datePhrase = trailing[1].trim();
    } else {
      name = s;
      datePhrase = "none";
    }
  }
  name = name.replace(/^["'\s]+|["'.\s]+$/g, "");
  // Same bogus-leftover guard as parseTaskCommand -- see its own comment
  // on the real "add tasks due today" -> name "due" failure this caught.
  if (!name || /^(due|by|to|is|as|for|on)$/i.test(name)) return null;
  const normPhrase = datePhrase.toLowerCase().replace(/^next\s+|^this\s+|^on\s+/, "");
  const safe = SAFE_DATE_PHRASE_RE.test(normPhrase) || EXPLICIT_DATE_WITH_YEAR_RE.test(normPhrase);
  const dateISO = resolveDatePhrase(datePhrase) || iso(Date.now());
  return { name, phrase: datePhrase, dateISO, needsConfirm: !safe };
}

function forceParseAccount(phrase, data, aliases) {
  const numMatch = phrase.match(/(\d+(?:\.\d+)?)/);
  if (!numMatch) return null;
  const amount = parseFloat(numMatch[1]);
  if (!isFinite(amount) || amount < 0) return null;
  let s = phrase.replace(numMatch[0], "");
  s = s.replace(/^\s*(to|is|as)\s+/i, "").replace(/\s*(to|is|as)\s*$/i, "");
  s = s.replace(/^["'\s]+|["'.\s]+$/g, "");
  const name = s.trim();
  if (!name) return null;
  return { candidate: name, amount, ...matchAccountByName(name, data, aliases) };
}

// No looser trigger-word-stripping needed here, unlike habit/bill/task --
// the workout shape has no removable verb; the whole phrase is already
// exercise+sets+reps+weight, so this just reuses the exact same regex the
// normal path uses.
function forceParseWorkout(phrase) {
  return parseWorkoutCommand(phrase);
}

// Loose intent-detection for the query domain -- there's no trigger word
// to lean on here even in the normal path (Shape 9-12 are Ollama's own
// fixed output, never a person's raw phrasing), so this is a best-effort
// keyword read of whatever the person just said the type was already
// confirmed to be a "question".
function forceParseQuery(phrase) {
  const lower = phrase.toLowerCase();
  if (/\bspen(d|t|ding)\b/.test(lower)) {
    const catMatch = lower.match(/\b(?:for|on)\s+(.+)$/);
    return { type: "spending", category: catMatch ? catMatch[1].trim() : null };
  }
  if (/\bweight\b/.test(lower)) return { type: "weight" };
  // Checked before the looser tasksToday fallback below -- "what bills are
  // due this week" also matches \bdue\b and would otherwise be swallowed
  // by that pattern first.
  if (/\bbills?\b/.test(lower) && /\bweek\b/.test(lower)) return { type: "billsThisWeek" };
  if (/\bdue\b|\btoday\b|\btasks?\b/.test(lower)) return { type: "tasksToday" };
  return null;
}

// The short list QuickCapture.jsx's "what kind was that?" question offers,
// and how a spoken answer maps back to one of them -- loose keyword
// matching, not an exact-word requirement, since "it was an expense" and
// "expense" should both work. Every noun also accepts its plain plural
// ("habits", "tasks", "bills", ...) -- a bare `\bhabit\b` rejects "habits"
// outright, since `\b` requires a word boundary immediately after "habit"
// and there isn't one before the trailing "s".
export const COMMAND_TYPES = ["weight", "habit", "expense", "income", "task", "bill", "account", "meal", "workout", "question"];
const COMMAND_TYPE_WORDS = {
  weight: /\bweights?\b/i,
  habit: /\bhabits?\b/i,
  expense: /\bexpenses?\b|\bspending\b/i,
  income: /\bincomes?\b/i,
  task: /\btasks?\b/i,
  bill: /\bbills?\b/i,
  account: /\baccounts?\b|\bnet ?worth\b|\bdebts?\b|\bsaving/i,
  meal: /\bmeals?\b/i,
  workout: /\bworkouts?\b|\bexercise\b/i,
  question: /\bquestions?\b/i,
};

export function matchCommandType(answer) {
  const lower = (answer || "").toLowerCase();
  for (const type of COMMAND_TYPES) {
    if (COMMAND_TYPE_WORDS[type].test(lower)) return type;
  }
  return null;
}

// The one entry point for both the fresh "you just told me the type"
// answer and the learned command_type_aliases fast path (same
// extraction either way, just reached differently -- see
// QuickCapture.jsx's runVoiceTranscript/handlePendingAnswer). Returns a
// parseCommand-shaped {kind, ...fields} result, or null if even knowing
// the type, nothing usable could be pulled from the phrase (e.g. "account"
// but no number was said) -- same "fail closed, never guess" policy as
// every other parser in this file.
export function forceParseByType(type, phrase, habits, bills, data) {
  const aliases = data?.voiceAliases;
  if (type === "weight") {
    const r = forceParseWeight(phrase);
    return r && { kind: "weight", ...r };
  }
  if (type === "habit") {
    const candidate = stripHabitMarkers(phrase);
    if (!candidate) return null;
    return { kind: "habit", candidate, ...matchHabit(candidate, habits, aliases) };
  }
  if (type === "expense") {
    const r = forceParseExpense(phrase);
    return r && { kind: "expense", ...r };
  }
  if (type === "income") {
    const r = forceParseIncome(phrase);
    return r && { kind: "income", ...r };
  }
  if (type === "task") {
    const r = forceParseTask(phrase);
    return r && { kind: "task", ...r };
  }
  if (type === "bill") {
    const candidate = stripBillMarkers(phrase);
    if (!candidate) return null;
    return { kind: "bill", candidate, ...matchByName(candidate, bills || [], aliases, "bill") };
  }
  if (type === "account") {
    const r = forceParseAccount(phrase, data, aliases);
    return r && { kind: "networth", ...r };
  }
  if (type === "meal") {
    // parseMealCommand's own loose fallback already only needs a slot
    // word (breakfast/lunch/dinner/snacks) present, no verb trigger, so
    // it's directly reusable as-is -- it returns null on its own if it
    // can't even find a slot word, which is exactly "couldn't work out
    // which meal" here too.
    const r = parseMealCommand(phrase);
    return r && { kind: "meal", ...r };
  }
  if (type === "workout") {
    const r = forceParseWorkout(phrase);
    return r && { kind: "workout", ...r };
  }
  if (type === "question") {
    const r = forceParseQuery(phrase);
    return r && { kind: "query", ...r };
  }
  return null;
}

export function parseCommand(text, habits, bills, data) {
  const aliases = data?.voiceAliases;

  const weight = parseWeightCommand(text);
  if (weight) return { kind: "weight", ...weight };

  if (PERIOD_TRIGGER_RE.test(text)) return { kind: "cycle" };

  // "query" isn't a word any other shape's trigger uses, so this is safe
  // anywhere in the order -- placed here for the same reason cycle/meal's
  // canonical check sit nearby: a fixed, unambiguous prefix.
  if (/^query\b/i.test(text)) {
    const query = parseQueryCommand(text);
    if (query) return { kind: "query", ...query };
  }

  // Fixed, unambiguous canonical prefixes -- checked early, same reasoning
  // as "query" above -- and distinct enough from "mark <name> done/paid"
  // that there's no collision risk with the habit/bill mark-done checks
  // further down.
  if (/^add habit /i.test(text)) return { kind: "addHabit", ...parseAddHabitCommand(text) };
  // Not just an outer prefix gate like addHabit above -- parseAddBillCommand
  // now requires the full "for <amount> due <date-phrase>" shape and
  // returns null otherwise, so this has to check its actual result (same
  // as every other non-fixed-prefix parser below), or a malformed "add
  // bill X" with no amount/date would produce a broken {kind:"addBill"}
  // with no fields instead of correctly falling through.
  const addBill = parseAddBillCommand(text);
  if (addBill) return { kind: "addBill", ...addBill };
  const addDebt = parseAddDebtCommand(text);
  if (addDebt) return { kind: "addDebt", ...addDebt };
  const addSaving = parseAddSavingCommand(text);
  if (addSaving) return { kind: "addSaving", ...addSaving };
  const addInvestment = parseAddInvestmentCommand(text);
  if (addInvestment) return { kind: "addInvestment", ...addInvestment };
  const addGoal = parseAddGoalCommand(text);
  if (addGoal) return { kind: "addGoal", ...addGoal };
  const addGrocery = parseAddGroceryCommand(text);
  if (addGrocery) return { kind: "addGrocery", ...addGrocery };
  if (FOCUS_SESSION_SHAPE_RE.test(text)) return { kind: "focusSession" };
  // Checked before extractHabitCandidate further down -- see
  // TASK_DONE_SHAPE_RE's own comment on why the literal word "task"
  // matters here: extractHabitCandidate's trigger is just the bare word
  // "done" anywhere in the phrase, so "mark task X done" would otherwise
  // get claimed by habit-matching first, searching for a habit literally
  // named "task X".
  const taskDoneCandidate = extractTaskDoneCandidate(text);
  if (taskDoneCandidate !== null) {
    const result = matchByName(taskDoneCandidate, data.tasks || [], aliases, "task");
    return { kind: "taskDone", candidate: taskDoneCandidate, ...result };
  }
  const taskDeleteCandidate = extractTaskDeleteCandidate(text);
  if (taskDeleteCandidate !== null) {
    const result = matchByName(taskDeleteCandidate, data.tasks || [], aliases, "task");
    return { kind: "taskDelete", candidate: taskDeleteCandidate, ...result };
  }
  if (WORKOUT_SHAPE_RE.test(text)) {
    const w = parseWorkoutCommand(text);
    if (w) return { kind: "workout", ...w };
  }

  if (MEAL_SHAPE_RE.test(text)) {
    const meal = parseMealCommand(text);
    if (meal) return { kind: "meal", ...meal };
  }

  const expense = parseExpenseCommand(text);
  if (expense) return { kind: "expense", ...expense };

  const income = parseIncomeCommand(text);
  if (income) return { kind: "income", ...income };

  const task = parseTaskCommand(text);
  if (task) return { kind: "task", ...task };

  const billCandidate = extractBillCandidate(text);
  if (billCandidate !== null) {
    const result = matchByName(billCandidate, bills || [], aliases, "bill");
    return { kind: "bill", candidate: billCandidate, ...result };
  }

  const netWorth = parseNetWorthCommand(text);
  if (netWorth) {
    const matched = matchAccountByName(netWorth.name, data, aliases);
    return { kind: "networth", candidate: netWorth.name, amount: netWorth.amount, ...matched };
  }

  const candidate = extractHabitCandidate(text);
  if (candidate !== null) {
    const result = matchHabit(candidate, habits, aliases);
    return { kind: "habit", candidate, ...result };
  }

  // Loose meal fallback -- see the big comment above this function for why
  // this specific one has to run last, not just "somewhere reasonable".
  const meal = parseMealCommand(text);
  if (meal) return { kind: "meal", ...meal };

  return { kind: "none" };
}
