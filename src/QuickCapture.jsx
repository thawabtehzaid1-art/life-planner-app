import { useState, useRef } from "react";
import { iso } from "./data.js";
import { parseCommand, toSettingsUnit } from "./quickCapture.js";

// A one-line, no-confirmation-screen capture box for exactly two command
// shapes: logging a weight entry and marking a habit done today. Parsing
// happens entirely client-side (see quickCapture.js) -- no network round
// trip, no LLM, no dependency on the still-dark AI_ENABLED flag -- because
// the whole point is that typing one line and hitting Enter should be
// instant. AIAssistant.jsx's chat-with-confirmation pattern is a
// deliberately different, heavier tool for open-ended requests; this is
// the fast path for the two shapes that don't need a model's judgment.
export default function QuickCapture({ data, patch }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  // status is one of: null | {kind:"ok", text} | {kind:"hint", text} |
  // {kind:"choices", candidate, options:[{h,index}]}
  const [status, setStatus] = useState(null);
  const inputRef = useRef(null);

  function toggle() {
    setOpen((o) => {
      const next = !o;
      if (next) setTimeout(() => inputRef.current?.focus(), 0);
      return next;
    });
  }

  function applyWeight(value, unit) {
    const settingsUnit = data.settings.units === "Metric" ? "kg" : "lb";
    const converted = toSettingsUnit(value, unit, settingsUnit);
    const today = iso(Date.now());
    patch((n) => {
      const idx = n.weights.findIndex((w) => w.date === today && w.who === "Me");
      if (idx >= 0) n.weights[idx].kg = converted;
      else n.weights.push({ date: today, who: "Me", kg: converted, note: "" });
    });
    const noteConversion = unit && unit !== settingsUnit;
    setStatus({
      kind: "ok",
      text: `Logged ${converted.toFixed(1)} ${settingsUnit}${noteConversion ? ` (converted from ${value} ${unit})` : ""}.`,
    });
  }

  function applyHabit(index, name) {
    const dayNum = new Date().getDate();
    const alreadyDone = !!data.habits[index]?.days?.[dayNum];
    if (!alreadyDone) {
      patch((n) => { n.habits[index].days[dayNum] = true; });
    }
    setStatus({ kind: "ok", text: alreadyDone ? `"${name}" was already marked done today.` : `"${name}" marked done today.` });
  }

  function runCommand(text) {
    const result = parseCommand(text, data.habits);
    if (result.kind === "weight") {
      applyWeight(result.value, result.unit);
    } else if (result.kind === "habit") {
      if (result.match) {
        applyHabit(result.index, result.match.name);
      } else if (result.alternatives.length > 0) {
        setStatus({ kind: "choices", options: result.alternatives });
      } else {
        setStatus({ kind: "hint", text: `No habit found matching "${result.candidate}" — check the Habit Tracker for the exact name.` });
      }
    } else {
      setStatus({ kind: "hint", text: 'Try "log my weight as 78kg" or "mark Meditation done".' });
    }
  }

  function send() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    runCommand(text);
    inputRef.current?.focus();
  }

  function pickAlternative(opt) {
    applyHabit(opt.index, opt.h.name);
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
            {!status && (
              <div className="quick-capture-hint">
                Type a line and hit Enter — e.g. "log my weight as 78kg" or "mark Meditation done".
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
            />
            <button type="button" className="btn-outline" onClick={send}>Go</button>
          </div>
        </div>
      )}
    </>
  );
}
