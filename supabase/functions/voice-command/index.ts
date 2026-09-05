// Supabase Edge Function: voice assistant's auth/orchestration layer.
// Deliberately stateless and narrow -- verifies the caller, forwards the
// transcript to a self-hosted Ollama instance (see docs/voice-vps-setup.sh
// for what that VPS runs), and hands back one normalized command line
// (plus a needsConfirm flag, see below) for the client to run through
// quickCapture.js's parseCommand() and its many apply*() counterparts (one
// per canonical shape below -- see that file for the full list).
// This function never touches the database itself -- see
// supabase/migrations/0007_voice_command_log.sql for why logging is a
// plain client-side insert instead.
//
// No dependency on any pay-per-use AI provider: the only outbound call
// this function makes is to VOICE_VPS_URL, a flat-fee VPS you run
// yourself.
//
// Secrets this function needs (set via `supabase secrets set`):
//   VOICE_VPS_URL     - e.g. https://voice.yourdomain.com (the reverse
//                        proxy in front of Ollama, not Ollama's raw port)
//   VOICE_VPS_SECRET  - shared secret the VPS's proxy checks, so its
//                        endpoint isn't wide open to the whole internet
//
// Deploy: supabase functions deploy voice-command

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const OLLAMA_MODEL = "qwen2.5:3b";

// Real transcripts tested against this exact model+prompt (see the commit
// that added this) showed Arabic compound numbers ("ثمانية وسبعين", 78,
// ones-before-tens) coming back transposed or badly wrong -- English
// commands and Arabic habit-name translation were reliable across
// repeated tries, but Arabic *numerals* specifically weren't. Rather than
// trust the model to self-report confidence (small models are poorly
// calibrated at that -- it would happily claim certainty on the same
// wrong "87"), this flags low confidence two ways: transcript language
// (deterministic, doesn't depend on the model at all) and output-format
// compliance (if the model didn't return one of the twenty-four exact
// shapes the prompt asked for, something already went sideways, regardless of
// language). The client only acts on this for weight, expense, net worth,
// income, workout, add-bill's amount, and add-debt/add-saving/add-goal's
// amounts -- every shape that carries a spoken/transcribed number gets
// this same treatment (see QuickCapture.jsx's confirm-before-apply step).
// Habit-name, bill-name, and task-name matching don't need it: they already have
// their own "which one did you mean?" quick-pick for real ambiguity, and
// there's no number to mishear. The four query shapes (9-12) don't need
// it either, on different grounds: they're read-only -- nothing gets
// written, so there's no wrong-value-silently-saved risk to guard
// against, only a possibly-wrong spoken answer, which is self-evidently
// checkable by the person who just heard it. Shape 13 (creating a new
// habit) is the same story as habit-marking above: just a name, no number
// to mishear, and the new row is immediately visible on its own tab if
// the name came out wrong. Shape 14 (creating a new bill) DOES now carry
// a number (the amount, added once bills grew a due date/amount) and gets
// the same needsConfirm treatment below; the name portion still doesn't
// need it, same reasoning as habit. Shape 15 (logging a workout) carries
// three spoken numbers (sets/reps/weight) and also gets needsConfirm --
// QuickCapture.jsx confirms all three together in one screen, since
// they're all part of describing the same single logged set.
//
// Task due-dates deliberately do NOT use this same needsConfirm flag,
// even though they also get a confirm-before-create step -- see
// quickCapture.js's parseTaskCommand. Weight/expense's risk is transcription
// artifacts (Arabic numeral transposition), which only exists on the voice
// path this function sits on. A relative date phrase like "next Friday" is
// just as genuinely ambiguous when typed as when spoken -- it's not a
// normalization-quality problem this function could flag even if it tried
// -- so that confirm decision is computed client-side, identically for
// typed and voice input, not threaded through this function at all.
const ARABIC_RE = /[؀-ۿ]/;
const WEIGHT_SHAPE_RE = /^log my weight as (\d+(?:\.\d+)?) (kg|lb)$/i;
const HABIT_SHAPE_RE = /^mark .+ done$/i;
const EXPENSE_SHAPE_RE = /^log expense (\d+(?:\.\d+)?) for .+$/i;
const TASK_SHAPE_RE = /^add task .+ due .+$/i;
const BILL_SHAPE_RE = /^mark .+ paid$/i;
const CYCLE_SHAPE_RE = /^log my period$/i;
const NETWORTH_SHAPE_RE = /^update .+ to \d+(?:\.\d+)?$/i;
const MEAL_SHAPE_RE = /^set (today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday) (breakfast|lunch|dinner|snacks) to .+$/i;
const QUERY_SPENDING_SHAPE_RE = /^query spending this month(?: for .+)?$/i;
const QUERY_WEIGHT_SHAPE_RE = /^query current weight$/i;
const QUERY_TASKS_SHAPE_RE = /^query tasks due today$/i;
const QUERY_BILLS_SHAPE_RE = /^query bills due this week$/i;
const ADD_HABIT_SHAPE_RE = /^add habit .+$/i;
const ADD_BILL_SHAPE_RE = /^add bill .+ for \d+(?:\.\d+)?\s+due .+$/i;
const WORKOUT_SHAPE_RE = /^log workout .+ \d+ sets of \d+ reps at \d+ kg$/i;
const INCOME_SHAPE_RE = /^log income (\d+(?:\.\d+)?) from .+$/i;
const ADD_DEBT_SHAPE_RE = /^add debt .+ for \d+(?:\.\d+)?$/i;
const ADD_SAVING_SHAPE_RE = /^add saving .+ target \d+(?:\.\d+)?$/i;
const ADD_INVESTMENT_SHAPE_RE = /^add investment .+$/i;
const ADD_GOAL_SHAPE_RE = /^add goal .+ target \d+(?:\.\d+)?$/i;
const FOCUS_SESSION_SHAPE_RE = /^log a focus session$/i;
const ADD_GROCERY_SHAPE_RE = /^add .+ to groceries$/i;
// Requires the literal word "task" right after "mark"/"delete" -- without
// it, a bare "mark <name> done" is indistinguishable from Shape 2 (marking
// a HABIT done), and quickCapture.js's own extractHabitCandidate would
// otherwise claim it first (its trigger is just the word "done" anywhere
// in the phrase, not specifically "mark ... done").
const TASK_DONE_SHAPE_RE = /^mark task .+ done$/i;
const TASK_DELETE_SHAPE_RE = /^delete task .+$/i;

// Few-shot examples matter a lot for a 3B-class model's output-format
// reliability -- without them, a small model drifts into explaining
// itself or adding punctuation instead of returning exactly one line.
const SYSTEM_PROMPT = `You convert a spoken voice command -- possibly in English or Arabic, possibly with spoken-out numbers or casual phrasing -- into ONE canonical English command line, or the exact word NONE.

Shape 1 (logging body weight): output exactly "log my weight as <number> <kg|lb>". Infer kg unless pounds/lbs was said. Convert spoken-out numbers to digits.

Shape 2 (marking a habit done): output exactly "mark <habit name> done". Keep the habit name as spoken; translate it to English only if it was said in Arabic. Never guess or correct the name.

Shape 3 (logging an expense): output exactly "log expense <number> for <description>". Convert spoken-out numbers to digits. Keep the description short (what it was spent on), translate it to English only if it was said in Arabic.

Shape 4 (adding a task): output exactly "add task <name> due <date-phrase>". <date-phrase> must be exactly one of: today, tomorrow, a bare weekday name (monday, tuesday, ... sunday -- never prefixed with "next"/"this"/"on"), "in <N> days", an explicit date written as "<month name> <day>" or "<month name> <day> <year>", or none if no date was mentioned at all. Never compute, resolve, or guess an actual calendar date yourself -- only output the phrase as stated or clearly implied. Translate the task name to English only if it was said in Arabic; never guess or correct it.

Common task concepts, for recognizing a task even in terse or casual phrasing (this is grounding context, not an exhaustive or exclusive list -- a task can be anything): call someone, buy groceries, clean the house, do laundry, schedule an appointment, submit a report, renew a passport/license, book a flight, water the plants, walk the dog, pick up dry cleaning, return a package.

Shape 5 (marking a bill paid): output exactly "mark <bill name> paid". Keep the bill name as spoken; translate it to English only if it was said in Arabic. Never guess or correct the name.

Shape 6 (logging a menstrual period starting today): output exactly the fixed line "log my period" -- nothing else varies, there's no name or number to fill in.

Shape 7 (updating a debt, savings, or investment balance): output exactly "update <account name> to <number>". Convert spoken-out numbers to digits. Keep the account name as spoken; translate it to English only if it was said in Arabic. Never guess or correct the name.

Shape 8 (setting a planned meal): output exactly "set <day> <meal> to <food>". <day> must be exactly one of: today, tomorrow, or a bare weekday name (monday, tuesday, ... sunday). Infer today if no day was mentioned. <meal> must be exactly one of: breakfast, lunch, dinner, snacks. Translate the food description to English only if it was said in Arabic; keep it short.

Shape 9 (asking about spending): output exactly "query spending this month", or "query spending this month for <category>" if a specific category was mentioned. Translate the category to English only if it was said in Arabic.

Shape 10 (asking current weight): output exactly the fixed line "query current weight" -- nothing else varies.

Shape 11 (asking what's due today): output exactly the fixed line "query tasks due today" -- nothing else varies.

Shape 12 (asking what bills are due this week): output exactly the fixed line "query bills due this week" -- nothing else varies.

Shape 13 (creating a brand-new habit to track, not marking an existing one done): output exactly "add habit <name>". Keep the name as spoken; translate it to English only if it was said in Arabic. Do NOT confuse this with Shape 2 (marking a habit done) -- "start tracking cold showers" or "add a habit for X" means create a new one (Shape 13); "mark X done" or "meditation's done for today" means an existing habit was just completed (Shape 2).

Common habit concepts, for recognizing a habit even in terse or casual phrasing (this is grounding context, not an exhaustive or exclusive list -- a habit can be anything): meditation, exercise, reading, journaling, drinking water, sleep, stretching, walking, cold showers, gratitude, flossing, taking medication, waking up early, no phone before bed.

Shape 14 (creating a brand-new bill, not marking an existing one paid): output exactly "add bill <name> for <amount> due <date-phrase>". Convert spoken-out numbers to digits; use 0 for <amount> if no amount was mentioned. <date-phrase> follows the exact same rules as Shape 4's due-date phrase -- one of: today, tomorrow, a bare weekday name (never prefixed with "next"/"this"/"on"), "in <N> days", an explicit date as "<month name> <day>" or "<month name> <day> <year>", or none if no date was mentioned. Keep the bill name as spoken; translate it to English only if it was said in Arabic. Do NOT confuse this with Shape 5 (marking a bill paid) -- "add a bill for X" or "I have a new bill for X" means create a new one (Shape 14); "mark X paid" or "i paid the X bill" means an existing bill was just paid (Shape 5).

Common bill concepts, for recognizing a bill even in terse or casual phrasing (this is grounding context, not an exhaustive or exclusive list -- a bill can be anything): rent, mortgage, electricity, water, gas, internet, phone, insurance, subscriptions (Netflix/Spotify/gym), car payment, loan payment, credit card.

Shape 15 (logging a workout/exercise set): output exactly "log workout <exercise> <number> sets of <number> reps at <number> kg". Convert spoken-out numbers to digits. If no weight was mentioned (a bodyweight exercise like push-ups or pull-ups), use 0 for the weight. Keep the exercise name as spoken; translate it to English only if it was said in Arabic.

Common gym/exercise terminology, for recognizing an exercise even in terse or casual phrasing (this is grounding context, not an exhaustive or exclusive list): bench press, squats, deadlift, pull-ups, push-ups, overhead press, bicep curls, rows, lunges, planks, running, cycling, treadmill, leg press, lat pulldown, dumbbell curls, burpees, HIIT.

Shape 16 (logging income received): output exactly "log income <number> from <source>". Convert spoken-out numbers to digits. Keep the source as spoken (an employer, client, or description of where it came from); translate it to English only if it was said in Arabic.

Shape 17 (adding a new debt to track): output exactly "add debt <name> for <amount>". Convert spoken-out numbers to digits. Keep the name as spoken; translate it to English only if it was said in Arabic.

Shape 18 (adding a new savings goal/pot): output exactly "add saving <name> target <amount>". Convert spoken-out numbers to digits. Keep the name as spoken; translate it to English only if it was said in Arabic.

Shape 19 (adding a new investment holding): output exactly "add investment <name>". Keep the name as spoken; translate it to English only if it was said in Arabic. There is no amount in this shape -- a brand-new holding always starts at 0 invested/current.

Shape 20 (adding a new personal goal, distinct from a debt/saving/investment): output exactly "add goal <name> target <amount>". Convert spoken-out numbers to digits. Keep the name as spoken; translate it to English only if it was said in Arabic.

Shape 21 (logging a completed deep-focus session): output exactly the fixed line "log a focus session" -- nothing else varies, there's no name or number to fill in.

Shape 22 (adding an item to the grocery list): output exactly "add <item> to groceries". Keep the item as spoken; translate it to English only if it was said in Arabic. Do NOT confuse this with Shape 4 (adding a task) -- groceries always ends with the word "groceries" itself.

Shape 23 (marking a TASK done, not a habit): output exactly "mark task <name> done". Keep the name as spoken; translate it to English only if it was said in Arabic. This is a completely separate shape from Shape 2 (marking a habit done) -- the literal word "task" right after "mark" is what tells them apart. "mark meditation done" is Shape 2 (a habit); "mark task call the dentist done" or "the dentist call is done" (when it's clearly a task, not a habit, from context) is Shape 23. If genuinely unsure whether something is a task or a habit, prefer Shape 2 -- habits are far more commonly voice-marked done than one-off tasks are.

Shape 24 (deleting a task -- a genuinely destructive, irreversible action): output exactly "delete task <name>". Keep the name as spoken; translate it to English only if it was said in Arabic. Only use this shape when deletion/removal is unambiguously what was asked ("delete", "remove", "get rid of" the task) -- never infer a delete from a phrase that could just as easily mean marking it done.

If the transcript doesn't clearly match any of the twenty-four shapes, output exactly: NONE

Output ONLY the command line or NONE -- no explanation, no extra punctuation.

Examples:
"log my weight as seventy eight kilos" -> log my weight as 78 kg
"i weighed myself today it's eighty two point five" -> log my weight as 82.5 kg
"سجل وزني خمسة وسبعين كيلو" -> log my weight as 75 kg
"mark meditation done" -> mark meditation done
"علّم التأمل تم" -> mark meditation done
"log meditation in habits" -> mark meditation done
"check off meditation" -> mark meditation done
"meditation's done for today" -> mark meditation done
"add a habit called reading before bed" -> add habit reading before bed
"start tracking cold showers" -> add habit cold showers
"add pray" -> add habit pray
"add reading" -> add habit reading
"i spent $12 on lunch" -> log expense 12 for lunch
"i paid forty dollars for groceries" -> log expense 40 for groceries
"دفعت خمسين على البقالة" -> log expense 50 for groceries
"dropped $40 on groceries" -> log expense 40 for groceries
"twenty bucks for coffee" -> log expense 20 for coffee
"bought lunch for 15" -> log expense 15 for lunch
"remind me to call the dentist tomorrow" -> add task call the dentist due tomorrow
"i need to water the plants" -> add task water the plants due none
"add a task to submit the report next monday" -> add task submit the report due monday
"don't forget to renew my passport in 3 days" -> add task renew my passport due in 3 days
"i need to book the flight by march 5th" -> add task book the flight due march 5
"remind me to pay the rent on march 5th 2027" -> add task pay the rent due march 5 2027
"ذكرني بالاتصال بالطبيب غدا" -> add task call the doctor due tomorrow
"put call the dentist on my list for tomorrow" -> add task call the dentist due tomorrow
"i've got to submit the report by friday" -> add task submit the report due friday
"add renew my passport to my tasks" -> add task renew my passport due none
"mark task call the dentist done" -> mark task call the dentist done
"the report task is done" -> mark task the report done
"delete the call the dentist task" -> delete task call the dentist
"remove submit the report from my tasks" -> delete task submit the report
"mark the rent paid" -> mark rent paid
"i paid the internet bill" -> mark internet bill paid
"دفعت فاتورة الكهرباء" -> mark electricity bill paid
"add a bill for rent, 1200, due the 1st" -> add bill rent for 1200 due 1
"add netflix bill for 15 dollars" -> add bill netflix for 15 due none
"my period started today" -> log my period
"log my period" -> log my period
"بدأت الدورة الشهرية اليوم" -> log my period
"update my overdraft to 300" -> update overdraft to 300
"set the emergency fund to two thousand" -> update emergency fund to 2000
"add a debt for my car loan, 15000" -> add debt car loan for 15000
"i have a new loan from my student debt for 8000" -> add debt student debt for 8000
"start a savings pot for a vacation, target 3000" -> add saving vacation target 3000
"add a savings goal called new laptop, target 1500" -> add saving new laptop target 1500
"add an investment in index funds" -> add investment index funds
"track a new investment called bitcoin" -> add investment bitcoin
"add a goal to read more books, target 12" -> add goal read more books target 12
"i want to add a new goal called learn spanish, target 100" -> add goal learn spanish target 100
"حدّث رصيد السحب على المكشوف إلى ثلاثمائة" -> update overdraft to 300
"set monday dinner to pasta" -> set monday dinner to pasta
"lunch today is leftovers" -> set today lunch to leftovers
"set tomorrow's breakfast to oats" -> set tomorrow breakfast to oats
"عشاء الغد بيتزا" -> set tomorrow dinner to pizza
"how much have i spent this month" -> query spending this month
"what have i spent on groceries this month" -> query spending this month for groceries
"كم صرفت على البقالة هذا الشهر" -> query spending this month for groceries
"what's my current weight" -> query current weight
"what do i have due today" -> query tasks due today
"what bills do i have due this week" -> query bills due this week
"any bills coming up this week" -> query bills due this week
"log a focus session" -> log a focus session
"i just finished a focus session" -> log a focus session
"add milk to groceries" -> add milk to groceries
"add eggs and bread to the shopping list" -> add eggs and bread to groceries
"i did bench press 4 sets of 8 at 60 kilos" -> log workout bench press 4 sets of 8 reps at 60 kg
"three sets of twelve pull ups" -> log workout pull ups 3 sets of 12 reps at 0 kg
"i got paid 3000 from my job" -> log income 3000 from my job
"received 500 from freelance work" -> log income 500 from freelance work
"what's the weather like" -> NONE`;

Deno.serve(async (req) => {
  // Browser calls this via supabase.functions.invoke() (see
  // QuickCapture.jsx's handleVoiceTranscript), so it needs the same CORS
  // preflight handling every other browser-called function in this project
  // has (see _shared/cors.ts) -- every Response below carries corsHeaders
  // for the same reason.
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response("Missing Authorization header", { status: 401, headers: corsHeaders });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

    const { transcript } = await req.json();
    if (!transcript || typeof transcript !== "string") {
      return new Response(JSON.stringify({ error: "Missing 'transcript'" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const vpsUrl = Deno.env.get("VOICE_VPS_URL");
    const vpsSecret = Deno.env.get("VOICE_VPS_SECRET");
    if (!vpsUrl) {
      // Deployed but not pointed at a real VPS yet -- fail soft instead
      // of a 500.
      return new Response(JSON.stringify({ normalized: null, error: "Voice assistant isn't configured yet." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ollamaRes = await fetch(`${vpsUrl}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(vpsSecret ? { Authorization: `Bearer ${vpsSecret}` } : {}),
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        system: SYSTEM_PROMPT,
        prompt: transcript,
        stream: false,
        options: { temperature: 0 },
      }),
    });

    if (!ollamaRes.ok) {
      return new Response(JSON.stringify({ error: `Voice model unreachable (${ollamaRes.status})` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { response } = await ollamaRes.json();
    const raw = (response || "").trim();
    const normalized = raw && raw.toUpperCase() !== "NONE" ? raw : null;

    const isWeight = !!normalized && WEIGHT_SHAPE_RE.test(normalized);
    const isExpense = !!normalized && EXPENSE_SHAPE_RE.test(normalized);
    const isTask = !!normalized && TASK_SHAPE_RE.test(normalized);
    const isBill = !!normalized && BILL_SHAPE_RE.test(normalized);
    const isCycle = !!normalized && CYCLE_SHAPE_RE.test(normalized);
    const isNetWorth = !!normalized && NETWORTH_SHAPE_RE.test(normalized);
    const isMeal = !!normalized && MEAL_SHAPE_RE.test(normalized);
    const isQuerySpending = !!normalized && QUERY_SPENDING_SHAPE_RE.test(normalized);
    const isQueryWeight = !!normalized && QUERY_WEIGHT_SHAPE_RE.test(normalized);
    const isQueryTasks = !!normalized && QUERY_TASKS_SHAPE_RE.test(normalized);
    const isQueryBills = !!normalized && QUERY_BILLS_SHAPE_RE.test(normalized);
    const isAddHabit = !!normalized && ADD_HABIT_SHAPE_RE.test(normalized);
    const isAddBill = !!normalized && ADD_BILL_SHAPE_RE.test(normalized);
    const isWorkout = !!normalized && WORKOUT_SHAPE_RE.test(normalized);
    const isIncome = !!normalized && INCOME_SHAPE_RE.test(normalized);
    const isAddDebt = !!normalized && ADD_DEBT_SHAPE_RE.test(normalized);
    const isAddSaving = !!normalized && ADD_SAVING_SHAPE_RE.test(normalized);
    const isAddInvestment = !!normalized && ADD_INVESTMENT_SHAPE_RE.test(normalized);
    const isAddGoal = !!normalized && ADD_GOAL_SHAPE_RE.test(normalized);
    const isFocusSession = !!normalized && FOCUS_SESSION_SHAPE_RE.test(normalized);
    const isAddGrocery = !!normalized && ADD_GROCERY_SHAPE_RE.test(normalized);
    const isTaskDone = !!normalized && TASK_DONE_SHAPE_RE.test(normalized);
    const isTaskDelete = !!normalized && TASK_DELETE_SHAPE_RE.test(normalized);
    const formatOk = !normalized || isWeight || isExpense || isTask || isBill || isCycle || isNetWorth || isMeal
      || isQuerySpending || isQueryWeight || isQueryTasks || isQueryBills || isAddHabit || isAddBill || isWorkout || isIncome
      || isAddDebt || isAddSaving || isAddInvestment || isAddGoal || isFocusSession || isAddGrocery || isTaskDone || isTaskDelete
      || HABIT_SHAPE_RE.test(normalized);
    // See the comment on ARABIC_RE above for why this covers weight,
    // expense, net worth, income, workout, add-bill's amount, and now
    // add-debt/add-saving/add-goal's amounts too (the "every spoken number
    // gets a confirm step" policy) -- but not habit/bill/task-matching (no
    // number at all), add-habit/add-investment/add-grocery (name only, no
    // number), log-a-focus-session (no name or number), or task-delete
    // (name only -- its own, separate confirm-before-destroying step is
    // built client-side, unrelated to numeral-transcription risk). Add-bill
    // can separately ALSO need a client-side date confirm (see
    // parseAddBillCommand) -- the two are independent risks (numeral
    // transcription vs. date-phrase ambiguity) and QuickCapture.jsx
    // resolves them sequentially, amount first, rather than folding them
    // into one flag here.
    const needsConfirm = (isWeight || isExpense || isNetWorth || isIncome || isWorkout || isAddBill || isAddDebt || isAddSaving || isAddGoal)
      && (ARABIC_RE.test(transcript) || !formatOk);

    return new Response(JSON.stringify({ normalized, needsConfirm }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
