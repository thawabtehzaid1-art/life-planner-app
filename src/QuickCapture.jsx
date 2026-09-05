import { useState, useRef, useEffect } from "react";
import {
  parseCommand, applyWeight, applyHabit, applyExpense, applyIncome, applyTask, applyBill, applyCycle, applyNetWorthUpdate, applyMeal,
  applyAddHabit, applyAddBill, applyWorkout, applyAddDebt, applyAddSaving, applyAddInvestment, applyAddGoal, applyFocusSession, applyAddGrocery,
  applyTaskDone, applyTaskDelete, answerQuery, forceParseByType, matchCommandType, resolveDatePhrase, logVoiceCommand,
} from "./quickCapture.js";
import { fmtDate, parseISO, iso } from "./data.js";
import { supabase } from "./supabaseClient.js";
import { useSpeechToText } from "./useSpeechToText.js";

// A floating voice-session button: tap once to start listening, speak one
// or more commands (weight, habit, expense, task, bill, cycle, net worth,
// meal, or a question -- see quickCapture.js's parseCommand), tap again to
// stop. There's no typed path any more -- this component used to also
// parse typed text locally, but the interaction model is voice-first now.
// quickCapture.js's parseCommand()/applyWeight()/etc. never cared where
// the text came from (just a string in, a result out), so nothing in that
// file changed for the interaction redesign -- see its own comments for
// how each command shape works.
//
// Every transcript still makes exactly one round trip to the
// voice-command Edge Function, to normalize casual/bilingual phrasing into
// the same command shapes parseCommand() already parses -- see
// runVoiceTranscript() below. What makes multiple utterances per session
// reliable: handleVoiceTranscript queues any transcript that arrives while
// a previous one is still being processed (network call + apply) rather
// than letting them race -- without that, two utterances spoken close
// together could fire overlapping requests and clobber each other's
// on-screen result.
//
// "Ask and learn": every one of the five confirm/choice prompts below
// (weight, expense, task, net-worth, and the habit/bill/account "which one
// did you mean?" quick-pick) is itself now answerable by voice, not just
// by tapping -- see pendingQuestion, setPendingStatus, and
// handlePendingAnswer. And when a phrase matches NONE of the eight domains
// at all, instead of a dead-end hint it asks by voice which type it was,
// re-parses the exact same phrase as that type (see quickCapture.js's
// forceParseByType, which extracts fields without needing the domain's
// usual trigger word -- the person just said the type directly), and
// remembers the answer (command_type_aliases -- see
// supabase/migrations/0009_command_type_aliases.sql) so the identical
// phrase skips both the question AND the round trip to Ollama next time.
// That skip is a real latency win, not just a recognition one: the most
// common source of felt slowness in a voice command is the network round
// trip to Ollama, and a remembered phrase never makes it.
//
// Confirm steps: a weight, expense, or net-worth-update command the Edge
// Function flags needsConfirm (Arabic input, or a reply that didn't match
// any expected shape -- see voice-command/index.ts) shows the parsed
// number back for a one-tap-or-one-word confirm/correct instead of
// applying immediately. Real testing found this model transposes or
// mangles Arabic compound numbers ("ثمانية وسبعين", 78, ones-before-tens)
// often enough to be worth a beat of friction specifically for the
// numeric field of these commands -- expense and net-worth amounts carry
// the exact same spoken-number risk as weight, so they get the same
// treatment. Habit/bill-matching don't need it: both already have their
// own "which one did you mean?" quick-pick for real ambiguity, and there's
// no number to mishear. Net worth's confirm additionally only fires once
// a definite account match is already known -- see the check in
// runVoiceTranscript -- since confirming an amount is meaningless without
// knowing which account it's for. Force-parsed commands (from a fresh
// "what kind was that?" answer, or a remembered command_type_aliases
// match) never go through this same needsConfirm treatment for
// weight/expense/net-worth -- that risk is specifically about Ollama's
// normalization step (the Arabic-numeral transposition above), and these
// paths never call Ollama at all, extracting straight from the raw phrase
// text instead. Task's OWN confirm (date-phrase ambiguity, a different
// risk entirely -- see below) still applies regardless of how the phrase
// was parsed.
//
// Task due-dates get a confirm step too, but on different grounds: a
// relative date phrase ("next Friday", "in 3 days") is genuinely ambiguous
// regardless of whether it was typed or spoken -- unlike the Arabic-numeral
// risk above, there's no transcription/normalization artifact to blame, so
// parseTaskCommand (quickCapture.js) computes this itself from the parsed
// phrase.
//
// Phase 3: voice answer-back. Off by default (settings.speakResults,
// toggle-able right here in the panel too, not just Settings) -- someone's
// phone talking back is a real, immediate surprise the first time it
// happens in a quiet room, so this opts in rather than opting out.
// Confirm/choice prompts and the "what kind was that?" question ARE now
// spoken regardless of this toggle (see setPendingStatus/runCommand's
// no-match branch) -- unlike a plain result, these are genuinely
// unanswerable without hearing them if you're not looking at the screen,
// so muting them would break the voice-first flow, not just skip a nicety.
// Final applied results still respect the toggle. The mic stays armed for
// the whole session, straight through TTS playback -- speakResult() has to
// explicitly stop() listening before playback and start() again after, or
// the mic would hear the app's own voice and could misfire on it.
export default function QuickCapture({ data, patch }) {
  // status is one of: null | {kind:"ok", text} | {kind:"hint", text} |
  // {kind:"choices", type:"habit"|"bill"|"networth", candidate, options,
  //   amount (networth only, so pickAlternative can apply it)} |
  // {kind:"confirmWeight", value, unit, transcript, normalized} |
  // {kind:"confirmExpense", amount, description, transcript, normalized} |
  // {kind:"confirmTask", name, dateISO, phrase, transcript, normalized} |
  // {kind:"confirmNetWorth", table, index, amount, transcript, normalized}
  const [status, setStatus] = useState(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [confirmValue, setConfirmValue] = useState("");
  // Dedicated to confirmWorkout only -- the shared confirmValue above holds
  // exactly one field at a time for every other confirm flow, but a
  // workout carries three numbers (sets/reps/weight) confirmed together
  // in one screen, not one after another.
  const [confirmSets, setConfirmSets] = useState("");
  const [confirmReps, setConfirmReps] = useState("");
  const [confirmWeightVal, setConfirmWeightVal] = useState("");
  // Whatever the NEXT thing said should answer, instead of going through
  // the normal classifier -- null the rest of the time. Either
  // {kind:"confirmAnswer"} (some confirm/choices status is already on
  // screen, see setPendingStatus) or {kind:"commandType", originalPhrase}
  // (a phrase matched nothing at all, see runCommand's final branch).
  // Checked first thing in handleVoiceTranscript, ahead of even the
  // busy-queue check -- answering an open question takes priority over
  // queuing a fresh command.
  const [pendingQuestion, setPendingQuestion] = useState(null);
  // True only between an explicit tap-to-start and tap-to-stop -- the
  // thing the floating button's own on/off state reflects. Separate from
  // `listening` (the speech engine's own state, which the effect below
  // drives from this) and separate from whether the panel is showing
  // (driven by `listening || status`, further down) -- a status can still
  // be on screen for a moment after the session itself has ended.
  const [sessionOn, setSessionOn] = useState(false);
  // 3500ms silence-buffering (was 2000ms -- still tunable if this reads as
  // too slow in practice): a multi-command session can hear "log my
  // weight as 78 kg" as two final chunks half a second apart, and without
  // waiting for a real pause those would dispatch as two garbled partial
  // commands instead of one whole one. This is opt-in on the hook itself
  // (defaults to 0 -- immediate dispatch) specifically so the other two
  // callers of useSpeechToText (journal dictation, Block.jsx's "add by
  // voice") are unaffected -- immediate per-pause dispatch is still what
  // those want.
  const { listening, error, interimText, pendingText, start, stop } = useSpeechToText(handleVoiceTranscript, 3500);
  // Rendered as two differently-styled spans (see the caption markup below)
  // rather than one flat string -- pendingText is already locked in and
  // about to be acted on, interimText is still being guessed at, and
  // showing both identically made it impossible to tell which was which.

  useEffect(() => {
    if (sessionOn) start(); else stop();
  }, [sessionOn, start, stop]);

  // A terminal "ok"/"hint" result is read-only feedback, not something
  // that needs a tap to dismiss -- auto-clears after a few seconds so the
  // panel doesn't just sit there. Every confirm/choices status and the
  // ask-and-learn "what kind was that?" question are excluded via the
  // pendingQuestion check: those genuinely need an answer, so they stay
  // until acted on.
  //
  // resultFading drives a 0.4s opacity fade (the same timing this codebase
  // already uses for .mobile-tabs) in the render below before setStatus(null)
  // actually fires -- an instant cut read as something breaking rather than
  // a deliberate dismissal.
  const [resultFading, setResultFading] = useState(false);
  useEffect(() => {
    if ((status?.kind === "ok" || status?.kind === "hint") && !pendingQuestion) {
      setResultFading(false);
      const fadeTimer = setTimeout(() => setResultFading(true), 5000);
      const clearTimer = setTimeout(() => setStatus(null), 5400);
      return () => { clearTimeout(fadeTimer); clearTimeout(clearTimer); };
    }
    setResultFading(false);
  }, [status, pendingQuestion]);

  // speakResult() (below) fires from an async audio "ended" callback that
  // can run well after the render that scheduled it -- reading `sessionOn`
  // state directly there risks a stale closure (tapping stop mid-playback
  // wouldn't be seen). This ref is always current.
  const sessionOnRef = useRef(sessionOn);
  useEffect(() => { sessionOnRef.current = sessionOn; }, [sessionOn]);

  // Best-effort only, exactly like logVoiceCommand -- a dead VPS, a slow
  // network, or a browser blocking autoplay must never surface as an error
  // or change what's already on screen (which is always the real result,
  // set by setStatus() before this is ever called). Does NOT check the
  // speakResults toggle itself any more (see speakFinalResult below for
  // that) -- confirm/choice/commandType prompts always speak, since
  // they're genuinely unanswerable by voice if you never heard them.
  async function speakResult(text) {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const { data: rawBlob, error: speakError } = await supabase.functions.invoke("voice-speak", {
        body: { text },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (speakError || !(rawBlob instanceof Blob)) return;
      // Re-tag as audio/wav -- voice-speak deliberately returns
      // application/octet-stream (see its own comment on why: the
      // supabase-js client would otherwise mis-parse the binary body as
      // text), so the Blob it hands back here isn't yet correctly typed
      // for an <audio> element to play.
      const audioBlob = new Blob([rawBlob], { type: "audio/wav" });
      const url = URL.createObjectURL(audioBlob);
      const audio = new Audio(url);
      // See the top-of-file comment on why this session has to pause
      // itself around its own voice -- otherwise the mic hears the app
      // talking and can misfire on it.
      stop();
      audio.addEventListener("ended", () => {
        URL.revokeObjectURL(url);
        if (sessionOnRef.current) start();
      }, { once: true });
      await audio.play();
    } catch {
      /* best-effort only -- see the comment above */
    }
  }

  // The speakResults-gated wrapper for a genuinely final, already-applied
  // result -- everything runCommand ends with. Separate from speakResult
  // itself (which confirm/choice/commandType prompts call unconditionally,
  // since those are only meaningful if heard) so the one settings toggle
  // still governs exactly what it always governed: the result, not the
  // question.
  function speakFinalResult(text) {
    if (data.settings.speakResults === "Yes") speakResult(text);
  }

  // Sets a confirm/choices status AND arms pendingQuestion + speaks the
  // question in one place, so every one of the five call sites below stays
  // a single line instead of repeating the same three steps each time.
  function setPendingStatus(newStatus, speakText) {
    setStatus(newStatus);
    setPendingQuestion({ kind: "confirmAnswer" });
    speakResult(speakText);
  }

  // Returns {result, applied} (not just setting status) so runVoiceTranscript
  // below can log the outcome without re-deriving it. Accepts an optional
  // pre-parsed `result` so the caller (which needs to inspect the parse
  // before deciding whether to apply it, for the needsConfirm check)
  // doesn't parse the same text twice -- this is also how a force-parsed
  // result (from forceParseByType, never from quickCapture.js's own
  // parseCommand) flows through the exact same per-kind handling below.
  // Task's own needsConfirm is expected to already have been handled by
  // maybeConfirmTask() below before this is called -- this only ever sees
  // a task result that's safe to apply directly. `rawTranscript` is only
  // used by the final "no match at all" branch, to remember which exact
  // phrase the "what kind was that?" question is about.
  function runCommand(text, preParsed, rawTranscript) {
    const result = preParsed || parseCommand(text, data.habits, data.bills, data);
    let applied = false;
    let okText = null;
    if (result.kind === "weight") {
      const ok = applyWeight(data, patch, result.value, result.unit);
      setStatus(ok);
      applied = true;
      okText = ok.text;
    } else if (result.kind === "expense") {
      const ok = applyExpense(data, patch, result.amount, result.description);
      setStatus(ok);
      applied = true;
      okText = ok.text;
    } else if (result.kind === "income") {
      const ok = applyIncome(data, patch, result.amount, result.source);
      setStatus(ok);
      applied = true;
      okText = ok.text;
    } else if (result.kind === "task") {
      const ok = applyTask(data, patch, result.name, result.dateISO);
      setStatus(ok);
      applied = true;
      okText = ok.text;
    } else if (result.kind === "meal") {
      const ok = applyMeal(data, patch, result.gridDay, result.slot, result.mealText);
      setStatus(ok);
      applied = true;
      okText = ok.text;
    } else if (result.kind === "addHabit") {
      const ok = applyAddHabit(data, patch, result.name);
      setStatus(ok);
      applied = true;
      okText = ok.text;
    } else if (result.kind === "addBill") {
      // Only ever reaches here once maybeConfirmAddBill (below) has
      // already let it through -- same "confirm handled upstream" split
      // as task's own branch.
      const ok = applyAddBill(data, patch, result.name, result.amount, result.dateISO);
      setStatus(ok);
      applied = true;
      okText = ok.text;
    } else if (result.kind === "workout") {
      const ok = applyWorkout(data, patch, result.ex, result.sets, result.reps, result.weight);
      setStatus(ok);
      applied = true;
      okText = ok.text;
    } else if (result.kind === "query") {
      // No patch() call, so `applied` correctly stays false here -- unlike
      // every other branch, nothing was written; this only reads and
      // speaks an answer (still through speakFinalResult below, respecting
      // the existing speakResults toggle same as everything else, no
      // special-casing).
      const ok = answerQuery(data, result.type, result.category);
      setStatus(ok);
      okText = ok.text;
    } else if (result.kind === "cycle") {
      // Gated here, not in parseCommand -- quickCapture.js stays
      // settings-agnostic (parseCommand doesn't take `data` at all), and
      // this is the one place that already has both the parsed intent and
      // full `data` in hand. Someone whose account isn't set to Female
      // never sees this mentioned in the hint text either (below), so
      // reaching this branch without eligibility only happens by
      // coincidentally saying "period" in an unrelated sentence -- falls
      // through to the generic hint, same as any other unrecognized text.
      if (data.settings.gender === "Female") {
        const ok = applyCycle(data, patch);
        setStatus(ok);
        applied = true;
        okText = ok.text;
      } else {
        setStatus({ kind: "hint", text: 'Try "log my weight as 78kg", "mark Meditation done", "spent 12 on lunch", "remind me to call the dentist tomorrow", "mark Rent paid", or "set dinner to pasta".' });
      }
    } else if (result.kind === "bill") {
      if (result.match) {
        const ok = applyBill(data, patch, result.index, result.match.name);
        setStatus(ok);
        applied = true;
        okText = ok.text;
      } else if (result.alternatives.length > 0) {
        setPendingStatus(
          { kind: "choices", type: "bill", candidate: result.candidate, options: result.alternatives },
          `Which bill did you mean — ${result.alternatives.map((a) => a.h.name).join(", ")}?`,
        );
      } else {
        setStatus({ kind: "hint", text: `No bill found matching "${result.candidate}" — check Bills for the exact name.` });
        // True dead-end (no match, no alternatives) -- offer the obvious
        // next step by voice instead of just leaving it at "not found".
        setPendingQuestion({ kind: "offerAddBill", candidate: result.candidate });
        speakResult(`Did you mean to add "${result.candidate}" as a new bill?`);
      }
    } else if (result.kind === "networth") {
      // No needsConfirm check here -- that's handled earlier, in
      // runVoiceTranscript, same as weight/expense, and only when a match
      // already exists (confirming an amount is meaningless without
      // knowing which account it's for). This only ever sees a result
      // that's either safe to apply directly or genuinely has no/ambiguous
      // match, same three-way split as bill/habit above.
      if (result.match) {
        const ok = applyNetWorthUpdate(data, patch, result.match.table, result.match.index, result.amount);
        setStatus(ok);
        applied = true;
        okText = ok.text;
      } else if (result.alternatives.length > 0) {
        setPendingStatus(
          { kind: "choices", type: "networth", candidate: result.candidate, amount: result.amount, options: result.alternatives.map((a) => ({ h: a.item, index: a.index, table: a.table })) },
          `Which account did you mean — ${result.alternatives.map((a) => a.item.name).join(", ")}?`,
        );
      } else {
        setStatus({ kind: "hint", text: `No debt, savings, or investment found matching "${result.candidate}" — check Net Worth for the exact name.` });
      }
    } else if (result.kind === "habit") {
      if (result.match) {
        const ok = applyHabit(data, patch, result.index, result.match.name);
        setStatus(ok);
        applied = true;
        okText = ok.text;
      } else if (result.alternatives.length > 0) {
        setPendingStatus(
          { kind: "choices", type: "habit", candidate: result.candidate, options: result.alternatives },
          `Which habit did you mean — ${result.alternatives.map((a) => a.h.name).join(", ")}?`,
        );
      } else {
        setStatus({ kind: "hint", text: `No habit found matching "${result.candidate}" — check the Habit Tracker for the exact name.` });
        setPendingQuestion({ kind: "offerAddHabit", candidate: result.candidate });
        speakResult(`Did you mean to add "${result.candidate}" as a new habit?`);
      }
    } else if (result.kind === "taskDone") {
      if (result.match) {
        const ok = applyTaskDone(data, patch, result.index, result.match.name);
        setStatus(ok);
        applied = true;
        okText = ok.text;
      } else if (result.alternatives.length > 0) {
        setPendingStatus(
          { kind: "choices", type: "taskDone", candidate: result.candidate, options: result.alternatives },
          `Which task did you mean — ${result.alternatives.map((a) => a.h.name).join(", ")}?`,
        );
      } else {
        setStatus({ kind: "hint", text: `No task found matching "${result.candidate}" — check Task Tracker for the exact name.` });
      }
    } else if (result.kind === "taskDelete") {
      // Never applies directly, even on a single definite match -- this is
      // genuinely destructive and irreversible, so it always routes through
      // an explicit spoken "yes" first (see confirmDeleteTaskAction below),
      // the same non-negotiable rule the design audit's own Habitica
      // citation flagged for habit deletion.
      if (result.match) {
        setPendingStatus(
          { kind: "confirmDeleteTask", name: result.match.name, index: result.index },
          `Delete "${result.match.name}"? This can't be undone — say yes to confirm.`,
        );
      } else if (result.alternatives.length > 0) {
        setPendingStatus(
          { kind: "choicesTaskDelete", candidate: result.candidate, options: result.alternatives },
          `Which task did you mean to delete — ${result.alternatives.map((a) => a.h.name).join(", ")}?`,
        );
      } else {
        setStatus({ kind: "hint", text: `No task found matching "${result.candidate}" — check Task Tracker for the exact name.` });
      }
    } else if (result.kind === "addDebt") {
      // Only ever reaches here once the amount confirm (below) has already
      // let it through -- same "confirm handled upstream" split as
      // add-bill's own branch.
      const ok = applyAddDebt(data, patch, result.name, result.amount);
      setStatus(ok);
      applied = true;
      okText = ok.text;
    } else if (result.kind === "addSaving") {
      const ok = applyAddSaving(data, patch, result.name, result.target);
      setStatus(ok);
      applied = true;
      okText = ok.text;
    } else if (result.kind === "addInvestment") {
      const ok = applyAddInvestment(data, patch, result.name);
      setStatus(ok);
      applied = true;
      okText = ok.text;
    } else if (result.kind === "addGoal") {
      const ok = applyAddGoal(data, patch, result.name, result.target);
      setStatus(ok);
      applied = true;
      okText = ok.text;
    } else if (result.kind === "focusSession") {
      const ok = applyFocusSession(data, patch);
      setStatus(ok);
      applied = true;
      okText = ok.text;
    } else if (result.kind === "addGrocery") {
      const ok = applyAddGrocery(data, patch, result.name);
      setStatus(ok);
      applied = true;
      okText = ok.text;
    } else {
      const phrase = (rawTranscript || text || "").trim();
      if (phrase) setPendingQuestion({ kind: "commandType", originalPhrase: phrase });
      const female = data.settings.gender === "Female";
      setStatus({ kind: "hint", text: `Try "log my weight as 78kg", "mark Meditation done", "spent 12 on lunch", "remind me to call the dentist tomorrow", "mark Rent paid", "update Overdraft to 300", "set dinner to pasta", "what's due today"${female ? ', or "log my period"' : ""}.` });
      speakResult("I didn't catch that — was that a weight, habit, expense, income, task, bill, account, meal, workout, or question?");
      return { result, applied };
    }
    if (okText) speakFinalResult(okText);
    return { result, applied };
  }

  // Runs before runCommand -- returns true if it handled the parse
  // (confirm shown, caller should not also call runCommand), false
  // otherwise. voiceMeta carries the transcript/normalized text that
  // confirmTask logs once someone actually confirms.
  function maybeConfirmTask(parsed, voiceMeta) {
    if (parsed.kind !== "task" || !parsed.needsConfirm) return false;
    setConfirmValue(parsed.dateISO);
    setPendingStatus(
      { kind: "confirmTask", name: parsed.name, dateISO: parsed.dateISO, phrase: parsed.phrase, ...(voiceMeta || {}) },
      `Is the due date for "${parsed.name}" ${fmtDate(parseISO(parsed.dateISO))}?`,
    );
    return true;
  }

  // Same shape as maybeConfirmTask above, for the exact same reason: a
  // spoken due-date phrase for a new bill is just as genuinely ambiguous
  // as one for a task, reusing the identical resolveDatePhrase/
  // SAFE_DATE_PHRASE_RE logic (see quickCapture.js's parseAddBillCommand).
  function maybeConfirmAddBill(parsed, voiceMeta) {
    if (parsed.kind !== "addBill" || !parsed.needsConfirm) return false;
    setConfirmValue(parsed.dateISO);
    setPendingStatus(
      { kind: "confirmAddBill", name: parsed.name, amount: parsed.amount, dateISO: parsed.dateISO, phrase: parsed.phrase, ...(voiceMeta || {}) },
      `Is the due date for "${parsed.name}" ${fmtDate(parseISO(parsed.dateISO))}?`,
    );
    return true;
  }

  // Fire-and-forget, same "best-effort, never block what already applied"
  // policy as logVoiceCommand -- picking an alternative from the quick-pick
  // is itself the real correction signal (matchByName's own comment covers
  // why only this path records one, not every successful match). Updates
  // the in-memory data.voiceAliases immediately (via patch(), so the very
  // next command in this session already benefits without waiting on the
  // network) and the separate voice_aliases table's row second -- see
  // supabase/migrations/0008_voice_aliases.sql for why that's a dedicated
  // table rather than something derived purely from planner_data.
  async function recordAlias(domain, phraseRaw, targetName) {
    const phrase = (phraseRaw || "").trim().toLowerCase();
    if (!phrase) return;
    patch((n) => {
      if (!n.voiceAliases) n.voiceAliases = [];
      const idx = n.voiceAliases.findIndex((a) => a.domain === domain && a.phrase === phrase);
      if (idx >= 0) n.voiceAliases[idx].target_name = targetName;
      else n.voiceAliases.push({ domain, phrase, target_name: targetName });
    });
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from("voice_aliases").upsert(
        { user_id: user.id, domain, phrase, target_name: targetName },
        { onConflict: "user_id,domain,phrase" },
      );
    } catch {
      /* best-effort only -- the in-memory update above already applied */
    }
  }

  // The "learn" half of "ask and learn": records which of the eight types
  // a phrase that matched nothing turned out to be, so the exact same
  // phrase skips this whole question -- and the round trip to Ollama --
  // next time (see runVoiceTranscript's remembered-alias check). Same
  // fire-and-forget, in-memory-then-network shape as recordAlias above,
  // one table over (command_type_aliases -- see
  // supabase/migrations/0009_command_type_aliases.sql).
  async function recordCommandType(phraseRaw, type) {
    const phrase = (phraseRaw || "").trim().toLowerCase();
    if (!phrase) return;
    patch((n) => {
      if (!n.commandTypeAliases) n.commandTypeAliases = [];
      const idx = n.commandTypeAliases.findIndex((a) => a.phrase === phrase);
      if (idx >= 0) n.commandTypeAliases[idx].command_type = type;
      else n.commandTypeAliases.push({ phrase, command_type: type });
    });
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from("command_type_aliases").upsert(
        { user_id: user.id, phrase, command_type: type },
        { onConflict: "user_id,phrase" },
      );
    } catch {
      /* best-effort only -- the in-memory update above already applied */
    }
  }

  // Shared tail for any already-parsed result that didn't come from the
  // normal Ollama-mediated classifier -- a fresh "what kind was that?"
  // answer, or a remembered command_type_aliases match (see
  // runVoiceTranscript). Task's OWN confirm still applies (date-phrase
  // ambiguity is unrelated to how the phrase was parsed); weight/expense/
  // net-worth's Ollama-normalization-risk confirm does not (see the
  // top-of-file comment).
  function routeParsedResult(result, rawTranscript) {
    if (maybeConfirmTask(result, { transcript: rawTranscript, normalized: null })) return;
    const { result: r, applied } = runCommand(rawTranscript, result, rawTranscript);
    logVoiceCommand(rawTranscript, null, r, applied);
  }

  // For "networth", opt.table+opt.index (tagged on each alternative by
  // matchAccountByName) are what applyNetWorthUpdate needs; the amount
  // isn't part of `opt` itself (it's the same for every alternative, from
  // the original parse), so this reads it off the current `choices` status
  // instead of threading it through every option. `status.candidate` (set
  // alongside `options` wherever a "choices" status is created) is the
  // original ambiguous phrase -- what recordAlias needs to remember this
  // pick against.
  function pickAlternative(opt, type) {
    const targetName = opt.h.name;
    const ok = type === "bill" ? applyBill(data, patch, opt.index, targetName)
      : type === "networth" ? applyNetWorthUpdate(data, patch, opt.table, opt.index, status.amount)
      : type === "taskDone" ? applyTaskDone(data, patch, opt.index, targetName)
      : applyHabit(data, patch, opt.index, targetName);
    setStatus(ok);
    speakFinalResult(ok.text);
    // taskDone records under the same "task" alias domain matchByName
    // reads for both taskDone and taskDelete (see quickCapture.js) -- not
    // a literal "taskDone" domain, which nothing would ever look up.
    if (status.candidate) recordAlias(type === "taskDone" ? "task" : (type || "habit"), status.candidate, targetName);
  }

  // Picking an alternative for a task-delete never applies it directly,
  // unlike pickAlternative above -- deleting is destructive and irreversible,
  // so even a resolved name still has to pass through the same explicit
  // "yes" gate as a definite single match (see confirmDeleteTaskAction and
  // runCommand's taskDelete branch).
  function pickTaskToDelete(opt) {
    const candidate = status.candidate;
    setPendingStatus(
      { kind: "confirmDeleteTask", name: opt.h.name, index: opt.index },
      `Delete "${opt.h.name}"? This can't be undone — say yes to confirm.`,
    );
    if (candidate) recordAlias("task", candidate, opt.h.name);
  }

  // Each accepts an optional explicit value, used by handlePendingAnswer
  // below when the person speaks a corrected number/date as their answer
  // instead of "yes" -- calling setConfirmValue() then immediately reading
  // confirmValue in the same synchronous call would still see the OLD
  // value, since React state updates aren't applied until the next render.
  // The button click paths (which pass nothing) are unaffected -- they
  // still read the already-current confirmValue from the controlled input.
  function confirmWeight(overrideValue) {
    const value = parseFloat(overrideValue ?? confirmValue);
    if (!isFinite(value) || value <= 0) return;
    const applied = applyWeight(data, patch, value, status.unit);
    logVoiceCommand(status.transcript, status.normalized, { kind: "weight", value, unit: status.unit }, true);
    speakFinalResult(applied.text);
    setStatus(applied);
  }

  // confirmValue is reused across all four confirm flows -- only one is
  // ever open at a time, and each reads it as its own type (weight value,
  // expense amount, net-worth amount, or here, an ISO date string from the
  // <input type="date">).
  function confirmExpense(overrideValue) {
    const value = parseFloat(overrideValue ?? confirmValue);
    if (!isFinite(value) || value <= 0) return;
    const applied = applyExpense(data, patch, value, status.description);
    logVoiceCommand(status.transcript, status.normalized, { kind: "expense", amount: value, description: status.description }, true);
    speakFinalResult(applied.text);
    setStatus(applied);
  }

  // Same shape as confirmExpense above, one-to-one.
  function confirmIncome(overrideValue) {
    const value = parseFloat(overrideValue ?? confirmValue);
    if (!isFinite(value) || value <= 0) return;
    const applied = applyIncome(data, patch, value, status.source);
    logVoiceCommand(status.transcript, status.normalized, { kind: "income", amount: value, source: status.source }, true);
    speakFinalResult(applied.text);
    setStatus(applied);
  }

  // Always reachable from the voice path now (there's no typed path left
  // to skip logging for), so this always logs.
  function confirmTask(overrideValue) {
    const v = overrideValue ?? confirmValue;
    if (!v) return;
    const applied = applyTask(data, patch, status.name, v);
    logVoiceCommand(status.transcript, status.normalized, { kind: "task", name: status.name, dateISO: v }, true);
    speakFinalResult(applied.text);
    setStatus(applied);
  }

  // Same shape as confirmTask above, one-to-one -- amount/name carried on
  // `status` from maybeConfirmAddBill, only the due date is what's being
  // confirmed/corrected here.
  // Add-bill can need both an amount confirm (Arabic-numeral transcription
  // risk, same as expense/income) and a date confirm (ambiguous
  // date-phrase, same as confirmAddBill below) for the SAME command --
  // these are two independent risks, resolved sequentially rather than
  // combined into one screen: amount first (this function), chaining into
  // the existing confirmAddBill date flow next if that's also needed,
  // exactly the one-field-per-confirm shape every other flow in this file
  // already uses.
  function confirmAddBillAmount(overrideValue) {
    const value = parseFloat(overrideValue ?? confirmValue);
    if (!isFinite(value) || value < 0) return;
    if (status.dateNeedsConfirm) {
      setConfirmValue(status.dateISO);
      setPendingStatus(
        { kind: "confirmAddBill", name: status.name, amount: value, dateISO: status.dateISO, transcript: status.transcript, normalized: status.normalized },
        `Is the due date for "${status.name}" ${fmtDate(parseISO(status.dateISO))}?`,
      );
      return;
    }
    const applied = applyAddBill(data, patch, status.name, value, status.dateISO);
    logVoiceCommand(status.transcript, status.normalized, { kind: "addBill", name: status.name, amount: value, dateISO: status.dateISO }, true);
    speakFinalResult(applied.text);
    setStatus(applied);
  }

  function confirmAddBill(overrideValue) {
    const v = overrideValue ?? confirmValue;
    if (!v) return;
    const applied = applyAddBill(data, patch, status.name, status.amount, v);
    logVoiceCommand(status.transcript, status.normalized, { kind: "addBill", name: status.name, amount: status.amount, dateISO: v }, true);
    speakFinalResult(applied.text);
    setStatus(applied);
  }

  // Confirms all three fields together (sets/reps/weight), not one at a
  // time -- they're all part of describing the same single logged set, so
  // reviewing them together makes more sense than three separate voice
  // round-trips. Unlike every single-value confirm above, a spoken
  // correction here can't be reliably applied automatically (one lone
  // number is ambiguous as to which of the three fields it corrects), so
  // handlePendingAnswer only accepts "yes" for this one -- any other
  // answer re-opens it, and a real correction happens by editing the
  // three fields directly in the panel.
  function confirmWorkout(overrideSets, overrideReps, overrideWeight) {
    const sets = parseInt(overrideSets ?? confirmSets, 10);
    const reps = parseInt(overrideReps ?? confirmReps, 10);
    const weightNum = parseInt(overrideWeight ?? confirmWeightVal, 10);
    if (!isFinite(sets) || sets <= 0 || !isFinite(reps) || reps <= 0) return;
    const weight = isFinite(weightNum) ? weightNum : 0;
    const applied = applyWorkout(data, patch, status.ex, sets, reps, weight);
    logVoiceCommand(status.transcript, status.normalized, { kind: "workout", ex: status.ex, sets, reps, weight }, true);
    speakFinalResult(applied.text);
    setStatus(applied);
  }

  // Reachable only when runVoiceTranscript already found a definite match
  // (see the needsConfirm check there) -- table/index are carried on
  // `status` from that point, same as weight/expense carry unit/description.
  function confirmNetWorth(overrideValue) {
    const value = parseFloat(overrideValue ?? confirmValue);
    if (!isFinite(value) || value < 0) return;
    const applied = applyNetWorthUpdate(data, patch, status.table, status.index, value);
    logVoiceCommand(status.transcript, status.normalized, { kind: "networth", table: status.table, index: status.index, amount: value }, true);
    speakFinalResult(applied.text);
    setStatus(applied);
  }

  // Same one-value-confirm shape as confirmExpense/confirmIncome above,
  // one-to-one -- add-debt/saving/goal all carry the same Arabic-numeral
  // transcription risk as any other spoken amount (see the universal
  // needsConfirm policy in voice-command/index.ts).
  function confirmAddDebt(overrideValue) {
    const value = parseFloat(overrideValue ?? confirmValue);
    if (!isFinite(value) || value <= 0) return;
    const applied = applyAddDebt(data, patch, status.name, value);
    logVoiceCommand(status.transcript, status.normalized, { kind: "addDebt", name: status.name, amount: value }, true);
    speakFinalResult(applied.text);
    setStatus(applied);
  }

  function confirmAddSaving(overrideValue) {
    const value = parseFloat(overrideValue ?? confirmValue);
    if (!isFinite(value) || value <= 0) return;
    const applied = applyAddSaving(data, patch, status.name, value);
    logVoiceCommand(status.transcript, status.normalized, { kind: "addSaving", name: status.name, target: value }, true);
    speakFinalResult(applied.text);
    setStatus(applied);
  }

  function confirmAddGoal(overrideValue) {
    const value = parseFloat(overrideValue ?? confirmValue);
    if (!isFinite(value) || value <= 0) return;
    const applied = applyAddGoal(data, patch, status.name, value);
    logVoiceCommand(status.transcript, status.normalized, { kind: "addGoal", name: status.name, target: value }, true);
    speakFinalResult(applied.text);
    setStatus(applied);
  }

  // The one and only way applyTaskDelete is ever called -- reachable only
  // after an explicit spoken or tapped "yes" on a confirmDeleteTask status
  // (see runCommand's taskDelete branch and pickTaskToDelete above). No
  // separate logVoiceCommand call here: unlike confirmWeight/confirmExpense
  // (which return early from runVoiceTranscript before it ever logs),
  // taskDelete flows through runCommand normally, so runVoiceTranscript's
  // own tail call already logged the ask -- same "no second log on pick"
  // shape as pickAlternative above.
  function confirmDeleteTaskAction() {
    const applied = applyTaskDelete(data, patch, status.index, status.name);
    speakFinalResult(applied.text);
    setStatus(applied);
  }

  async function runVoiceTranscript(transcript) {
    setVoiceBusy(true);
    setStatus(null);
    // The "skip Ollama entirely" fast path: this exact phrase already got
    // answered once before (see recordCommandType), so there's no need to
    // ask again OR make the round trip to the model -- straight to that
    // type's own extraction against the raw phrase. Falls through to the
    // normal flow below if the remembered type doesn't yield anything
    // usable any more (e.g. the phrasing genuinely doesn't carry a number
    // this time) rather than getting stuck failing the same way forever.
    const normalizedPhrase = transcript.trim().toLowerCase();
    const remembered = (data.commandTypeAliases || []).find((a) => a.phrase === normalizedPhrase);
    if (remembered) {
      if (remembered.command_type === "billPay") {
        const result = forceParseByType("bill", transcript, data.habits, data.bills, data);
        if (result) { routeParsedResult(result, transcript); setVoiceBusy(false); return; }
      } else if (remembered.command_type === "billAdd") {
        // Skips straight past the "add or pay?" disambiguation (we know which one
        // you meant for this phrase) but still asks for date/amount fresh each
        // time, since those are per-instance, not part of what's remembered.
        setPendingQuestion({ kind: "billSlotDue", name: transcript });
        speakResult(`When is "${transcript}" due?`);
        setVoiceBusy(false);
        return;
      } else {
        const result = forceParseByType(remembered.command_type, transcript, data.habits, data.bills, data);
        if (result) { routeParsedResult(result, transcript); setVoiceBusy(false); return; }
      }
    }
    let normalized = null;
    let needsConfirm = false;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const { data: res, error: invokeError } = await supabase.functions.invoke("voice-command", {
        body: { transcript },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (invokeError) throw invokeError;
      normalized = res?.normalized || null;
      needsConfirm = !!res?.needsConfirm;
    } catch {
      setStatus({ kind: "hint", text: "Voice command failed — try again." });
      setVoiceBusy(false);
      return;
    }
    const textToRun = normalized || transcript;
    const parsed = parseCommand(textToRun, data.habits, data.bills, data);
    if (parsed.kind === "weight" && needsConfirm) {
      setConfirmValue(String(parsed.value));
      setPendingStatus(
        { kind: "confirmWeight", value: parsed.value, unit: parsed.unit, transcript, normalized },
        `Did you say ${parsed.value} ${parsed.unit || ""}?`,
      );
      setVoiceBusy(false);
      return;
    }
    if (parsed.kind === "expense" && needsConfirm) {
      setConfirmValue(String(parsed.amount));
      setPendingStatus(
        { kind: "confirmExpense", amount: parsed.amount, description: parsed.description, transcript, normalized },
        `Did you say ${data.settings.currency}${parsed.amount} for ${parsed.description}?`,
      );
      setVoiceBusy(false);
      return;
    }
    if (parsed.kind === "income" && needsConfirm) {
      setConfirmValue(String(parsed.amount));
      setPendingStatus(
        { kind: "confirmIncome", amount: parsed.amount, source: parsed.source, transcript, normalized },
        `Did you say ${data.settings.currency}${parsed.amount} from ${parsed.source}?`,
      );
      setVoiceBusy(false);
      return;
    }
    // Only intercepts when a match was already found -- if it's ambiguous
    // or not found at all, that takes priority regardless of needsConfirm
    // (runCommand below shows the choices/hint instead; confirming an
    // amount is meaningless without knowing which account it's for).
    if (parsed.kind === "networth" && needsConfirm && parsed.match) {
      setConfirmValue(String(parsed.amount));
      setPendingStatus(
        { kind: "confirmNetWorth", table: parsed.match.table, index: parsed.match.index, amount: parsed.amount, transcript, normalized },
        `Did you say ${data.settings.currency}${parsed.amount}?`,
      );
      setVoiceBusy(false);
      return;
    }
    if (parsed.kind === "workout" && needsConfirm) {
      setConfirmSets(String(parsed.sets));
      setConfirmReps(String(parsed.reps));
      setConfirmWeightVal(String(parsed.weight));
      setPendingStatus(
        { kind: "confirmWorkout", ex: parsed.ex, transcript, normalized },
        `Did you say ${parsed.sets} sets of ${parsed.reps} reps${parsed.weight > 0 ? ` at ${parsed.weight} kg` : ""} for ${parsed.ex}?`,
      );
      setVoiceBusy(false);
      return;
    }
    if (parsed.kind === "addDebt" && needsConfirm) {
      setConfirmValue(String(parsed.amount));
      setPendingStatus(
        { kind: "confirmAddDebt", name: parsed.name, transcript, normalized },
        `Did you say ${data.settings.currency}${parsed.amount} for "${parsed.name}"?`,
      );
      setVoiceBusy(false);
      return;
    }
    if (parsed.kind === "addSaving" && needsConfirm) {
      setConfirmValue(String(parsed.target));
      setPendingStatus(
        { kind: "confirmAddSaving", name: parsed.name, transcript, normalized },
        `Did you say a target of ${data.settings.currency}${parsed.target} for "${parsed.name}"?`,
      );
      setVoiceBusy(false);
      return;
    }
    if (parsed.kind === "addGoal" && needsConfirm) {
      setConfirmValue(String(parsed.target));
      setPendingStatus(
        { kind: "confirmAddGoal", name: parsed.name, transcript, normalized },
        `Did you say a target of ${data.settings.currency}${parsed.target} for "${parsed.name}"?`,
      );
      setVoiceBusy(false);
      return;
    }
    if (maybeConfirmTask(parsed, { transcript, normalized })) {
      setVoiceBusy(false);
      return;
    }
    // Checked before maybeConfirmAddBill below -- amount-transcription
    // risk is resolved first, carrying the still-pending date-ambiguity
    // flag forward on the status object so confirmAddBillAmount can chain
    // into the date confirm next if that's also needed.
    if (parsed.kind === "addBill" && needsConfirm) {
      setConfirmValue(String(parsed.amount));
      setPendingStatus(
        { kind: "confirmAddBillAmount", name: parsed.name, dateISO: parsed.dateISO, dateNeedsConfirm: parsed.needsConfirm, transcript, normalized },
        `Did you say ${data.settings.currency}${parsed.amount} for "${parsed.name}"?`,
      );
      setVoiceBusy(false);
      return;
    }
    if (maybeConfirmAddBill(parsed, { transcript, normalized })) {
      setVoiceBusy(false);
      return;
    }
    const { result, applied } = runCommand(textToRun, parsed, transcript);
    logVoiceCommand(transcript, normalized, result, applied);
    setVoiceBusy(false);
  }

  // The other half of "ask and learn": once a confirm/choices prompt or a
  // "what kind was that?" question is on screen, the NEXT thing said
  // answers it instead of going through the normal classifier -- see the
  // check in handleVoiceTranscript. Always consumes pendingQuestion up
  // front; if the answer itself couldn't be understood, it's set right
  // back so the same question stays open rather than silently dropped.
  async function handlePendingAnswer(transcript) {
    const question = pendingQuestion;
    setPendingQuestion(null);
    const lower = transcript.trim().toLowerCase();

    if (question.kind === "confirmAnswer") {
      const isChoices = status?.kind === "choices" || status?.kind === "choicesTaskDelete";
      if (!isChoices && /\b(yes|yeah|yep|correct|right)\b/.test(lower)) {
        if (status?.kind === "confirmWeight") confirmWeight();
        else if (status?.kind === "confirmExpense") confirmExpense();
        else if (status?.kind === "confirmTask") confirmTask();
        else if (status?.kind === "confirmNetWorth") confirmNetWorth();
        else if (status?.kind === "confirmAddBill") confirmAddBill();
        else if (status?.kind === "confirmIncome") confirmIncome();
        else if (status?.kind === "confirmAddBillAmount") confirmAddBillAmount();
        else if (status?.kind === "confirmWorkout") confirmWorkout();
        else if (status?.kind === "confirmAddDebt") confirmAddDebt();
        else if (status?.kind === "confirmAddSaving") confirmAddSaving();
        else if (status?.kind === "confirmAddGoal") confirmAddGoal();
        // No exceptions on task deletion -- an unrecognized answer falls
        // through to the "I didn't catch that" re-prompt below rather than
        // ever defaulting to applying it.
        else if (status?.kind === "confirmDeleteTask") confirmDeleteTaskAction();
        return;
      }
      if (/\b(no|nope|cancel|wrong)\b/.test(lower)) {
        setStatus(null);
        return;
      }
      if (isChoices) {
        const picked = status.options.find((opt) => lower.includes(opt.h.name.toLowerCase()));
        if (picked) {
          if (status.kind === "choicesTaskDelete") pickTaskToDelete(picked);
          else pickAlternative(picked, status.type);
          return;
        }
      } else if (status?.kind === "confirmTask") {
        const resolved = resolveDatePhrase(transcript);
        if (resolved) { confirmTask(resolved); return; }
      } else if (status?.kind === "confirmAddBill") {
        const resolved = resolveDatePhrase(transcript);
        if (resolved) { confirmAddBill(resolved); return; }
      } else {
        const numMatch = transcript.match(/(\d+(?:\.\d+)?)/);
        if (numMatch) {
          if (status?.kind === "confirmWeight") { confirmWeight(numMatch[1]); return; }
          if (status?.kind === "confirmExpense") { confirmExpense(numMatch[1]); return; }
          if (status?.kind === "confirmNetWorth") { confirmNetWorth(numMatch[1]); return; }
          if (status?.kind === "confirmIncome") { confirmIncome(numMatch[1]); return; }
          if (status?.kind === "confirmAddBillAmount") { confirmAddBillAmount(numMatch[1]); return; }
          if (status?.kind === "confirmAddDebt") { confirmAddDebt(numMatch[1]); return; }
          if (status?.kind === "confirmAddSaving") { confirmAddSaving(numMatch[1]); return; }
          if (status?.kind === "confirmAddGoal") { confirmAddGoal(numMatch[1]); return; }
          // confirmWorkout deliberately excluded here -- see its own
          // comment: one lone spoken number is ambiguous across three
          // fields (sets/reps/weight), so only "yes" is accepted above;
          // anything else falls through to "I didn't catch that" below.
          // confirmDeleteTask is excluded too, for the opposite reason --
          // it has no numeric field at all, only yes/no.
        }
      }
      // Same "I didn't catch that" fallback as any other true recognition
      // failure -- the question stays open rather than being a dead end.
      speakResult("I didn't catch that.");
      setPendingQuestion(question);
      return;
    }

    // "Did you mean to add this as new?" -- the true-dead-end fallback from
    // runCommand's habit/bill branches. A simple yes/anything-else binary,
    // not a re-prompt loop: saying yes creates it with the same plain
    // defaults a fresh "add habit"/"add bill" command would (a bill gets
    // amount 0, due today -- asking follow-up questions for those here
    // would be the multi-turn capability this is deliberately deferring,
    // not folding in); anything else just falls back to the original
    // not-found hint, exactly as if this question had never been asked.
    if (question.kind === "offerAddHabit") {
      if (/\b(yes|yeah|yep|sure|correct|right)\b/.test(lower)) {
        const ok = applyAddHabit(data, patch, question.candidate);
        setStatus(ok);
        speakFinalResult(ok.text);
      } else {
        setStatus({ kind: "hint", text: `No habit found matching "${question.candidate}" — check the Habit Tracker for the exact name.` });
      }
      return;
    }
    if (question.kind === "offerAddBill") {
      if (/\b(yes|yeah|yep|sure|correct|right)\b/.test(lower)) {
        const ok = applyAddBill(data, patch, question.candidate, 0, null);
        setStatus(ok);
        speakFinalResult(ok.text);
      } else {
        setStatus({ kind: "hint", text: `No bill found matching "${question.candidate}" — check Bills for the exact name.` });
      }
      return;
    }

    // "Bill" chain: add-or-pay -> (if add) due date -> amount -> confirm.
    // Each step just re-arms pendingQuestion with the next kind and carries
    // forward what's already been collected -- same one-question-at-a-time
    // shape as every other pendingQuestion flow, just longer.
    if (question.kind === "billAddOrPay") {
      if (/\bpay\b/i.test(lower)) {
        const result = forceParseByType("bill", question.name, data.habits, data.bills, data);
        if (!result) {
          setStatus({ kind: "hint", text: `Couldn't find "${question.name}" — try rephrasing.` });
          speakResult(`Couldn't find "${question.name}".`);
          return;
        }
        // Recorded as "billPay"/"billAdd" (not the generic "bill" every
        // other type uses) the moment the add-or-pay answer is known, so
        // the remembered-alias fast path in runVoiceTranscript can skip
        // this disambiguation next time instead of asking it again.
        recordCommandType(question.name, "billPay");
        routeParsedResult(result, question.name);
        return;
      }
      if (/\badd\b/i.test(lower)) {
        recordCommandType(question.name, "billAdd");
        setPendingQuestion({ kind: "billSlotDue", name: question.name });
        speakResult(`When is "${question.name}" due?`);
        return;
      }
      speakResult("Please say add or pay.");
      setPendingQuestion(question);
      return;
    }
    if (question.kind === "billSlotDue") {
      const dateISO = resolveDatePhrase(transcript) || iso(Date.now());
      setPendingQuestion({ kind: "billSlotAmount", name: question.name, dateISO });
      speakResult("How much?");
      return;
    }
    if (question.kind === "billSlotAmount") {
      const numMatch = transcript.match(/(\d+(?:\.\d+)?)/);
      const amount = numMatch ? parseFloat(numMatch[1]) : 0;
      setPendingQuestion({ kind: "confirmBillAmount", name: question.name, dateISO: question.dateISO, amount });
      speakResult(`Did you say ${amount}?`);
      return;
    }
    if (question.kind === "confirmBillAmount") {
      if (/\b(yes|yeah|correct|right)\b/i.test(lower)) {
        const ok = applyAddBill(data, patch, question.name, question.amount, question.dateISO);
        setStatus(ok);
        speakFinalResult(ok.text);
        return;
      }
      // Not a "yes" -- treated as a spoken correction if it carries a
      // number, same "reuse what was said" pattern as every other
      // confirm-with-correction flow in this file, and applied either way
      // rather than re-opening yet another round of the same question.
      const numMatch = transcript.match(/(\d+(?:\.\d+)?)/);
      const amount = numMatch ? parseFloat(numMatch[1]) : question.amount;
      const ok = applyAddBill(data, patch, question.name, amount, question.dateISO);
      setStatus(ok);
      speakFinalResult(ok.text);
      return;
    }

    // commandType
    const type = matchCommandType(lower);
    if (!type) {
      // Not a category word -- most likely they just repeated/rephrased the
      // original command instead of answering with an abstract label. Since
      // the original failure was often Ollama's own non-determinism, not a
      // real phrasing problem, give it a fresh full round trip rather than
      // dead-ending -- if it fails again, runCommand's own no-match branch
      // naturally re-asks this same question, so nothing gets stuck.
      await runVoiceTranscript(transcript);
      return;
    }
    // "bill" specifically forks into a short multi-step disambiguation
    // instead of the single-shot force-parse every other type uses below --
    // a bare bill name alone is genuinely ambiguous between "mark this
    // existing bill paid" and "this is a new bill I need to add", unlike
    // every other type here (a habit/expense/task name only ever means one
    // thing once the type is known).
    if (type === "bill") {
      setPendingQuestion({ kind: "billAddOrPay", name: question.originalPhrase });
      speakResult(`Add "${question.originalPhrase}", or pay it?`);
      return;
    }
    const result = forceParseByType(type, question.originalPhrase, data.habits, data.bills, data);
    if (!result) {
      setStatus({ kind: "hint", text: `Couldn't work that out as a ${type} either — try rephrasing.` });
      speakResult(`I still couldn't work that out as a ${type}.`);
      return;
    }
    recordCommandType(question.originalPhrase, type);
    routeParsedResult(result, question.originalPhrase);
  }

  // What actually makes multiple utterances per session reliable: without
  // this, two transcripts arriving close together would both start
  // runVoiceTranscript concurrently -- overlapping voice-command network
  // calls whose responses could land in either order and clobber each
  // other's status. Anything that arrives while busy queues instead;
  // once the in-flight one finishes, the queue drains in order. An open
  // pendingQuestion takes priority over all of that -- answering it is
  // routed separately and immediately, never queued behind other work.
  //
  // A real, observed 31s voice-command round trip exposed a race here: the
  // no-match question only gets asked (pendingQuestion set) once that slow
  // call actually resolves, so something said and queued WHILE it was
  // still in flight would previously get drained straight into
  // runVoiceTranscript as if it were a brand-new command -- silently
  // eating what was really an answer to a question that didn't exist yet
  // at the moment it was spoken. Draining through handleVoiceTranscriptRef
  // (declared below, right after this function) instead of calling
  // runVoiceTranscript directly re-runs the SAME pendingQuestion/voiceBusy
  // check, fresh, for every queued item at the moment it's actually
  // dispatched -- not against whatever this function's own closure
  // happened to see when it first started running, possibly 31 seconds
  // (and several state updates) earlier.
  const handleVoiceTranscriptRef = useRef();
  const pendingRef = useRef([]);
  async function handleVoiceTranscript(transcript) {
    if (pendingQuestion) { await handlePendingAnswer(transcript); return; }
    if (voiceBusy) { pendingRef.current.push(transcript); return; }
    await runVoiceTranscript(transcript);
    while (pendingRef.current.length > 0) {
      await handleVoiceTranscriptRef.current(pendingRef.current.shift());
    }
  }
  useEffect(() => { handleVoiceTranscriptRef.current = handleVoiceTranscript; });

  return (
    <>
      <button
        type="button"
        className="quick-capture-btn"
        data-on={listening ? "1" : ""}
        onClick={() => setSessionOn((s) => !s)}
        aria-label={sessionOn ? "Stop voice session" : "Start voice session"}
        aria-pressed={sessionOn}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 10a7 7 0 0 0 14 0" />
          <line x1="12" y1="19" x2="12" y2="22" />
        </svg>
      </button>
      {(listening || status) && (
        <div className="quick-capture-panel">
          <div className="quick-capture-header">
            Quick capture
            <button
              type="button"
              className="quick-capture-speak-toggle"
              aria-pressed={data.settings.speakResults === "Yes"}
              title={data.settings.speakResults === "Yes" ? "Voice answer-back is on — tap to mute" : "Voice answer-back is off — tap to enable"}
              onClick={() => patch((n) => { n.settings.speakResults = n.settings.speakResults === "Yes" ? "No" : "Yes"; })}
            >
              {data.settings.speakResults === "Yes" ? "🔊" : "🔇"}
            </button>
          </div>
          <div className="quick-capture-body">
            {error && <div className="mic-btn-error" role="alert">{error}</div>}
            {voiceBusy && <div className="quick-capture-hint">Working on it…</div>}
            {listening && (pendingText || interimText) && (
              <div className="quick-capture-hint">
                {pendingText && <span className="quick-capture-caption-settled">{pendingText}</span>}
                {pendingText && interimText && " "}
                {interimText && <span className="quick-capture-caption-forming">{interimText}</span>}
              </div>
            )}
            {listening && !voiceBusy && !pendingText && !interimText && !status && (
              <div className="quick-capture-hint">
                Listening — try "log my weight as 78kg", "mark Meditation done", "spent 12 on lunch", "remind me to call the dentist tomorrow", "mark Rent paid", "update Overdraft to 300", "set dinner to pasta", "what's due today"{data.settings.gender === "Female" ? ', or "log my period"' : ""}.
              </div>
            )}
            {status?.kind === "ok" && (
              <div className="quick-capture-status quick-capture-status-ok" style={{ opacity: resultFading ? 0 : 1, transition: "opacity 0.4s ease" }}>
                {status.text}
              </div>
            )}
            {status?.kind === "hint" && pendingQuestion?.kind === "commandType" && (
              // The one hint state that's genuinely blocking -- rendered with
              // the app's existing [data-today="1"] accent-rule convention
              // plus a small label, so it visually reads as "waiting on an
              // answer" instead of a passive, safe-to-ignore placeholder.
              // Never fades (see the effect above -- excluded via the
              // pendingQuestion check), so no opacity style here.
              <div className="quick-capture-question">
                <span className="quick-capture-question-tag">Waiting on you</span>
                {status.text}
              </div>
            )}
            {status?.kind === "hint" && pendingQuestion?.kind !== "commandType" && (
              <div className="quick-capture-status quick-capture-status-hint" style={{ opacity: resultFading ? 0 : 1, transition: "opacity 0.4s ease" }}>
                {status.text}
              </div>
            )}
            {status?.kind === "choices" && (
              <div className="quick-capture-choices">
                <div className="quick-capture-status quick-capture-status-hint">Which {status.type === "bill" ? "bill" : status.type === "networth" ? "account" : status.type === "taskDone" ? "task" : "habit"} did you mean? Say the name, or tap one.</div>
                <div className="quick-capture-choice-row">
                  {status.options.map((opt) => (
                    <button key={opt.index} type="button" className="btn-outline" onClick={() => pickAlternative(opt, status.type)}>
                      {opt.h.name}
                    </button>
                  ))}
                  <button type="button" className="header-link-btn" onClick={() => setStatus(null)}>None of these</button>
                </div>
              </div>
            )}
            {status?.kind === "choicesTaskDelete" && (
              <div className="quick-capture-choices">
                <div className="quick-capture-status quick-capture-status-hint">Which task did you mean to delete? Say the name, or tap one.</div>
                <div className="quick-capture-choice-row">
                  {status.options.map((opt) => (
                    <button key={opt.index} type="button" className="btn-outline" onClick={() => pickTaskToDelete(opt)}>
                      {opt.h.name}
                    </button>
                  ))}
                  <button type="button" className="header-link-btn" onClick={() => setStatus(null)}>None of these</button>
                </div>
              </div>
            )}
            {status?.kind === "confirmWeight" && (
              <div className="quick-capture-choices">
                <div className="quick-capture-status quick-capture-status-hint">Confirm the weight before logging it — say "yes" or the correct number:</div>
                <div className="quick-capture-choice-row">
                  <input
                    type="number" step="0.1" value={confirmValue}
                    onChange={(e) => setConfirmValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") confirmWeight(); }}
                    style={{ width: "80px" }}
                    autoFocus
                  />
                  <span>{status.unit || ""}</span>
                  <button type="button" className="btn-outline" onClick={() => confirmWeight()}>Confirm</button>
                  <button type="button" className="header-link-btn" onClick={() => setStatus(null)}>Cancel</button>
                </div>
              </div>
            )}
            {status?.kind === "confirmExpense" && (
              <div className="quick-capture-choices">
                <div className="quick-capture-status quick-capture-status-hint">Confirm the amount before logging it — say "yes" or the correct number:</div>
                <div className="quick-capture-choice-row">
                  <span>{data.settings.currency}</span>
                  <input
                    type="number" step="0.01" value={confirmValue}
                    onChange={(e) => setConfirmValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") confirmExpense(); }}
                    style={{ width: "80px" }}
                    autoFocus
                  />
                  <span>for "{status.description}"</span>
                  <button type="button" className="btn-outline" onClick={() => confirmExpense()}>Confirm</button>
                  <button type="button" className="header-link-btn" onClick={() => setStatus(null)}>Cancel</button>
                </div>
              </div>
            )}
            {status?.kind === "confirmIncome" && (
              <div className="quick-capture-choices">
                <div className="quick-capture-status quick-capture-status-hint">Confirm the amount before logging it — say "yes" or the correct number:</div>
                <div className="quick-capture-choice-row">
                  <span>{data.settings.currency}</span>
                  <input
                    type="number" step="0.01" value={confirmValue}
                    onChange={(e) => setConfirmValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") confirmIncome(); }}
                    style={{ width: "80px" }}
                    autoFocus
                  />
                  <span>from "{status.source}"</span>
                  <button type="button" className="btn-outline" onClick={() => confirmIncome()}>Confirm</button>
                  <button type="button" className="header-link-btn" onClick={() => setStatus(null)}>Cancel</button>
                </div>
              </div>
            )}
            {status?.kind === "confirmTask" && (
              <div className="quick-capture-choices">
                <div className="quick-capture-status quick-capture-status-hint">Confirm the due date for "{status.name}" — say "yes" or the correct date:</div>
                <div className="quick-capture-choice-row">
                  <input
                    type="date" value={confirmValue}
                    onChange={(e) => setConfirmValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") confirmTask(); }}
                    autoFocus
                  />
                  <button type="button" className="btn-outline" onClick={() => confirmTask()}>Confirm</button>
                  <button type="button" className="header-link-btn" onClick={() => setStatus(null)}>Cancel</button>
                </div>
              </div>
            )}
            {status?.kind === "confirmAddBill" && (
              <div className="quick-capture-choices">
                <div className="quick-capture-status quick-capture-status-hint">Confirm the due date for "{status.name}" — say "yes" or the correct date:</div>
                <div className="quick-capture-choice-row">
                  <input
                    type="date" value={confirmValue}
                    onChange={(e) => setConfirmValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") confirmAddBill(); }}
                    autoFocus
                  />
                  <button type="button" className="btn-outline" onClick={() => confirmAddBill()}>Confirm</button>
                  <button type="button" className="header-link-btn" onClick={() => setStatus(null)}>Cancel</button>
                </div>
              </div>
            )}
            {status?.kind === "confirmAddBillAmount" && (
              <div className="quick-capture-choices">
                <div className="quick-capture-status quick-capture-status-hint">Confirm the amount for "{status.name}" — say "yes" or the correct number:</div>
                <div className="quick-capture-choice-row">
                  <span>{data.settings.currency}</span>
                  <input
                    type="number" step="0.01" value={confirmValue}
                    onChange={(e) => setConfirmValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") confirmAddBillAmount(); }}
                    style={{ width: "80px" }}
                    autoFocus
                  />
                  <button type="button" className="btn-outline" onClick={() => confirmAddBillAmount()}>Confirm</button>
                  <button type="button" className="header-link-btn" onClick={() => setStatus(null)}>Cancel</button>
                </div>
              </div>
            )}
            {status?.kind === "confirmWorkout" && (
              <div className="quick-capture-choices">
                <div className="quick-capture-status quick-capture-status-hint">Confirm "{status.ex}" — say "yes" or edit the fields:</div>
                <div className="quick-capture-choice-row">
                  <input
                    type="number" value={confirmSets}
                    onChange={(e) => setConfirmSets(e.target.value)}
                    style={{ width: "50px" }}
                    aria-label="Sets"
                    autoFocus
                  />
                  <span>sets of</span>
                  <input
                    type="number" value={confirmReps}
                    onChange={(e) => setConfirmReps(e.target.value)}
                    style={{ width: "50px" }}
                    aria-label="Reps"
                  />
                  <span>reps at</span>
                  <input
                    type="number" value={confirmWeightVal}
                    onChange={(e) => setConfirmWeightVal(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") confirmWorkout(); }}
                    style={{ width: "60px" }}
                    aria-label="Weight in kg"
                  />
                  <span>kg</span>
                  <button type="button" className="btn-outline" onClick={() => confirmWorkout()}>Confirm</button>
                  <button type="button" className="header-link-btn" onClick={() => setStatus(null)}>Cancel</button>
                </div>
              </div>
            )}
            {status?.kind === "confirmNetWorth" && (
              <div className="quick-capture-choices">
                <div className="quick-capture-status quick-capture-status-hint">Confirm the updated amount — say "yes" or the correct number:</div>
                <div className="quick-capture-choice-row">
                  <span>{data.settings.currency}</span>
                  <input
                    type="number" step="0.01" value={confirmValue}
                    onChange={(e) => setConfirmValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") confirmNetWorth(); }}
                    style={{ width: "80px" }}
                    autoFocus
                  />
                  <button type="button" className="btn-outline" onClick={() => confirmNetWorth()}>Confirm</button>
                  <button type="button" className="header-link-btn" onClick={() => setStatus(null)}>Cancel</button>
                </div>
              </div>
            )}
            {status?.kind === "confirmAddDebt" && (
              <div className="quick-capture-choices">
                <div className="quick-capture-status quick-capture-status-hint">Confirm the amount for "{status.name}" — say "yes" or the correct number:</div>
                <div className="quick-capture-choice-row">
                  <span>{data.settings.currency}</span>
                  <input
                    type="number" step="0.01" value={confirmValue}
                    onChange={(e) => setConfirmValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") confirmAddDebt(); }}
                    style={{ width: "80px" }}
                    autoFocus
                  />
                  <button type="button" className="btn-outline" onClick={() => confirmAddDebt()}>Confirm</button>
                  <button type="button" className="header-link-btn" onClick={() => setStatus(null)}>Cancel</button>
                </div>
              </div>
            )}
            {status?.kind === "confirmAddSaving" && (
              <div className="quick-capture-choices">
                <div className="quick-capture-status quick-capture-status-hint">Confirm the target for "{status.name}" — say "yes" or the correct number:</div>
                <div className="quick-capture-choice-row">
                  <span>{data.settings.currency}</span>
                  <input
                    type="number" step="0.01" value={confirmValue}
                    onChange={(e) => setConfirmValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") confirmAddSaving(); }}
                    style={{ width: "80px" }}
                    autoFocus
                  />
                  <button type="button" className="btn-outline" onClick={() => confirmAddSaving()}>Confirm</button>
                  <button type="button" className="header-link-btn" onClick={() => setStatus(null)}>Cancel</button>
                </div>
              </div>
            )}
            {status?.kind === "confirmAddGoal" && (
              <div className="quick-capture-choices">
                <div className="quick-capture-status quick-capture-status-hint">Confirm the target for "{status.name}" — say "yes" or the correct number:</div>
                <div className="quick-capture-choice-row">
                  <span>{data.settings.currency}</span>
                  <input
                    type="number" step="0.01" value={confirmValue}
                    onChange={(e) => setConfirmValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") confirmAddGoal(); }}
                    style={{ width: "80px" }}
                    autoFocus
                  />
                  <button type="button" className="btn-outline" onClick={() => confirmAddGoal()}>Confirm</button>
                  <button type="button" className="header-link-btn" onClick={() => setStatus(null)}>Cancel</button>
                </div>
              </div>
            )}
            {status?.kind === "confirmDeleteTask" && (
              <div className="quick-capture-choices">
                <div className="quick-capture-status quick-capture-status-hint">Delete "{status.name}"? This can't be undone.</div>
                <div className="quick-capture-choice-row">
                  <button type="button" className="btn-outline" onClick={() => confirmDeleteTaskAction()}>Delete</button>
                  <button type="button" className="header-link-btn" onClick={() => setStatus(null)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
