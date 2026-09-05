import { useState, useRef, useCallback, useEffect } from "react";

// Wraps the browser's built-in speech recognition (Chrome/Edge/Safari;
// no support in Firefox as of writing — callers should hide their mic
// button entirely when `supported` is false rather than show a dead one).
// `onFinalResult(text)` fires once per finished phrase, not per keystroke,
// so callers append rather than replace.
// Web Speech API error codes -> a short, actionable message. Anything not
// listed here (rare/browser-specific codes) falls back to a generic one
// rather than showing a raw code like "audio-capture" to someone who
// didn't write this code.
const ERROR_MESSAGES = {
  "not-allowed": "Microphone access denied — check your browser/site permissions.",
  "audio-capture": "No microphone found.",
  "no-speech": "Didn't catch that — try again.",
  network: "Voice recognition needs a network connection.",
  "service-not-allowed": "Voice recognition isn't available right now.",
};

// `silenceDelayMs` is opt-in and defaults to 0 (today's exact behavior:
// dispatch each final chunk immediately) so the other two callers of this
// hook (journal dictation, Block.jsx's "add by voice"), which don't pass
// it, are completely unaffected -- only QuickCapture.jsx's multi-command
// voice sessions want to wait for a real pause before treating a phrase as
// finished, since someone might say "log my weight as 78 kg" as two
// separate final chunks with a half-second gap and shouldn't have that
// split into two garbled commands.
export function useSpeechToText(onFinalResult, silenceDelayMs = 0) {
  const [listening, setListening] = useState(false);
  // Cleared on every successful start -- a stale error from three attempts
  // ago shouldn't still be showing next to a mic button that's working now.
  const [error, setError] = useState(null);
  // The current not-yet-final chunk, so callers can show live-as-you-talk
  // feedback (see MicButton.jsx's onInterimText) instead of the input
  // staying blank until a whole phrase finishes. Cleared whenever a phrase
  // finalizes (onFinalResult already has it), and on start/stop/end/error
  // so stale text from a previous attempt never lingers into the next one.
  const [interimText, setInterimText] = useState("");
  // Final chunks already spoken but still waiting out the silence delay
  // before being dispatched as one combined command (silenceDelayMs === 0
  // callers never see this leave ""). Exists as its own piece of state,
  // separate from interimText, so a caller showing pendingText + interimText
  // together doesn't have the screen go blank for the whole delay window
  // right after a phrase finishes and before the next one starts.
  const [pendingText, setPendingText] = useState("");
  const [supported] = useState(
    () => typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition),
  );
  const recRef = useRef(null);
  const onResultRef = useRef(onFinalResult);
  useEffect(() => { onResultRef.current = onFinalResult; }, [onFinalResult]);
  // Read inside the recognition-setup effect below, which only runs once
  // (deps: [supported]) -- a ref, not the raw prop, so a caller changing
  // silenceDelayMs on the fly is still honored without needing to tear
  // down and recreate the whole SpeechRecognition instance.
  const silenceDelayRef = useRef(silenceDelayMs);
  useEffect(() => { silenceDelayRef.current = silenceDelayMs; }, [silenceDelayMs]);
  const bufferRef = useRef("");
  const timerRef = useRef(null);

  // Only ever touches refs and a stable setState setter, so this stays the
  // same function across every render -- safe to call from the
  // recognition-setup effect's own (created-once) onend/onerror handlers,
  // and from start()/stop() below, without any of them going stale.
  const clearBuffer = useCallback(() => {
    bufferRef.current = "";
    setPendingText("");
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  useEffect(() => {
    if (!supported) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    rec.onresult = (e) => {
      // A batch can contain more than one result (e.g. a final chunk
      // immediately followed by the start of the next interim one) --
      // finals fire the callback (or buffer, see below) and reset interim,
      // non-finals accumulate into what's shown live.
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const transcript = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          setInterimText("");
          const chunk = transcript.trim();
          if (!chunk) continue;
          if (silenceDelayRef.current > 0) {
            // Accumulate rather than dispatch -- (re)starting the timer on
            // every new final chunk means it only actually fires once
            // nothing new has come in for the full delay, i.e. a real
            // pause, not just the gap between two chunks of one sentence.
            bufferRef.current = bufferRef.current ? `${bufferRef.current} ${chunk}` : chunk;
            setPendingText(bufferRef.current);
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => {
              timerRef.current = null;
              const combined = bufferRef.current;
              bufferRef.current = "";
              setPendingText("");
              if (combined) onResultRef.current(combined);
            }, silenceDelayRef.current);
          } else {
            onResultRef.current(chunk);
          }
        } else {
          interim += transcript;
        }
      }
      if (interim) setInterimText(interim);
    };
    rec.onend = () => { setListening(false); setInterimText(""); clearBuffer(); };
    // Previously silent -- stopped listening with zero indication anything
    // went wrong, which reads as "the mic button just didn't work" (see
    // the session that added this). "aborted" fires on every deliberate
    // stop() too, so it's excluded -- that's not a real error to surface.
    rec.onerror = (e) => {
      setListening(false);
      setInterimText("");
      clearBuffer();
      if (e.error !== "aborted") setError(ERROR_MESSAGES[e.error] || "Voice input failed — try typing instead.");
    };
    recRef.current = rec;
    return () => { try { rec.stop(); } catch { /* already stopped */ } };
  }, [supported, clearBuffer]);

  const start = useCallback(() => {
    if (!recRef.current || listening) return;
    setError(null);
    setInterimText("");
    clearBuffer();
    try { recRef.current.start(); setListening(true); } catch { /* already listening */ }
  }, [listening, clearBuffer]);

  const stop = useCallback(() => {
    if (!recRef.current) return;
    recRef.current.stop();
    setListening(false);
    setInterimText("");
    clearBuffer();
  }, [clearBuffer]);

  const toggle = useCallback(() => { if (listening) stop(); else start(); }, [listening, start, stop]);

  // start/stop were already useCallbacks used internally by toggle --
  // exposed directly for callers (QuickCapture.jsx) that need to drive
  // sessions/side effects around them explicitly, not just flip a switch.
  return { supported, listening, error, interimText, pendingText, start, stop, toggle };
}
