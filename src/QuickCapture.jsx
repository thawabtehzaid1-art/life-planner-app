import { useState, useRef } from "react";
import { parseCommand, applyWeight, applyHabit, logVoiceCommand } from "./quickCapture.js";
import { supabase } from "./supabaseClient.js";
import MicButton from "./MicButton.jsx";

// A one-line, no-confirmation-screen capture box for exactly two command
// shapes: logging a weight entry and marking a habit done today. Typed
// input is parsed entirely client-side (see quickCapture.js) -- no network
// round trip, no LLM -- because the whole point of typing one line and
// hitting Enter is that it's instant. AIAssistant.jsx's chat-with-
// confirmation pattern is a deliberately different, heavier tool for
// open-ended requests; this is the fast path for the two shapes that don't
// need a model's judgment.
//
// Voice input is the one path that DOES leave the client: a transcript
// (from the browser's own free speech recognition, see useSpeechToText.js
// -- no self-hosted STT needed) goes to the voice-command Edge Function,
// which forwards it to a self-hosted Ollama model just to normalize casual/
// bilingual phrasing into the same command shapes runCommand() already
// parses -- the actual matching/mutation logic below is identical either
// way, never duplicated between the typed and voice paths.
export default function QuickCapture({ data, patch }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  // status is one of: null | {kind:"ok", text} | {kind:"hint", text} |
  // {kind:"choices", candidate, options:[{h,index}]}
  const [status, setStatus] = useState(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const inputRef = useRef(null);

  function toggle() {
    setOpen((o) => {
      const next = !o;
      if (next) setTimeout(() => inputRef.current?.focus(), 0);
      return next;
    });
  }

  // Returns {result, applied} (not just setting status) so the voice path
  // below can log the outcome without re-deriving it -- one source of
  // truth for the branching, shared by both the typed and voice callers.
  function runCommand(text) {
    const result = parseCommand(text, data.habits);
    let applied = false;
    if (result.kind === "weight") {
      setStatus(applyWeight(data, patch, result.value, result.unit));
      applied = true;
    } else if (result.kind === "habit") {
      if (result.match) {
        setStatus(applyHabit(data, patch, result.index, result.match.name));
        applied = true;
      } else if (result.alternatives.length > 0) {
        setStatus({ kind: "choices", options: result.alternatives });
      } else {
        setStatus({ kind: "hint", text: `No habit found matching "${result.candidate}" — check the Habit Tracker for the exact name.` });
      }
    } else {
      setStatus({ kind: "hint", text: 'Try "log my weight as 78kg" or "mark Meditation done".' });
    }
    return { result, applied };
  }

  function send() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    runCommand(text);
    inputRef.current?.focus();
  }

  function pickAlternative(opt) {
    setStatus(applyHabit(data, patch, opt.index, opt.h.name));
  }

  async function handleVoiceTranscript(transcript) {
    setVoiceBusy(true);
    setStatus(null);
    let normalized = null;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const { data: res, error } = await supabase.functions.invoke("voice-command", {
        body: { transcript },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw error;
      normalized = res?.normalized || null;
    } catch {
      setStatus({ kind: "hint", text: "Voice command failed — try typing it instead." });
      setVoiceBusy(false);
      return;
    }
    const { result, applied } = runCommand(normalized || transcript);
    logVoiceCommand(transcript, normalized, result, applied);
    setVoiceBusy(false);
  }

  return (
    <>
      <button
        type="button"
        className="quick-capture-btn"
        onClick={toggle}
        aria-label="Quick capture"
      >
        {open ? "×" : "⚡ Log"}
      </button>
      {open && (
        <div className="quick-capture-panel">
          <div className="quick-capture-header">Quick capture</div>
          <div className="quick-capture-body">
            {voiceBusy && <div className="quick-capture-hint">Working on it…</div>}
            {!voiceBusy && !status && (
              <div className="quick-capture-hint">
                Type a line and hit Enter, or use the mic — e.g. "log my weight as 78kg" or "mark Meditation done".
              </div>
            )}
            {status?.kind === "ok" && <div className="quick-capture-status quick-capture-status-ok">{status.text}</div>}
            {status?.kind === "hint" && <div className="quick-capture-status quick-capture-status-hint">{status.text}</div>}
            {status?.kind === "choices" && (
              <div className="quick-capture-choices">
                <div className="quick-capture-status quick-capture-status-hint">Which habit did you mean?</div>
                <div className="quick-capture-choice-row">
                  {status.options.map((opt) => (
                    <button key={opt.index} type="button" className="btn-outline" onClick={() => pickAlternative(opt)}>
                      {opt.h.name}
                    </button>
                  ))}
                  <button type="button" className="header-link-btn" onClick={() => setStatus(null)}>None of these</button>
                </div>
              </div>
            )}
          </div>
          <div className="quick-capture-input-row">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") send(); if (e.key === "Escape") setOpen(false); }}
              placeholder="log my weight as 78kg…"
              disabled={voiceBusy}
            />
            <MicButton onText={handleVoiceTranscript} label="Dictate a command" />
            <button type="button" className="btn-outline" onClick={send} disabled={voiceBusy}>Go</button>
          </div>
        </div>
      )}
    </>
  );
}
