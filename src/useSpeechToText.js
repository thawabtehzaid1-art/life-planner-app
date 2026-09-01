import { useState, useRef, useCallback, useEffect } from "react";

// Wraps the browser's built-in speech recognition (Chrome/Edge/Safari;
// no support in Firefox as of writing — callers should hide their mic
// button entirely when `supported` is false rather than show a dead one).
// `onFinalResult(text)` fires once per finished phrase, not per keystroke,
// so callers append rather than replace.
export function useSpeechToText(onFinalResult) {
  const [listening, setListening] = useState(false);
  const [supported] = useState(
    () => typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition),
  );
  const recRef = useRef(null);
  const onResultRef = useRef(onFinalResult);
  useEffect(() => { onResultRef.current = onFinalResult; }, [onFinalResult]);

  useEffect(() => {
    if (!supported) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = navigator.language || "en-US";
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) onResultRef.current(e.results[i][0].transcript.trim());
      }
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    return () => { try { rec.stop(); } catch { /* already stopped */ } };
  }, [supported]);

  const start = useCallback(() => {
    if (!recRef.current || listening) return;
    try { recRef.current.start(); setListening(true); } catch { /* already listening */ }
  }, [listening]);

  const stop = useCallback(() => {
    if (!recRef.current) return;
    recRef.current.stop();
    setListening(false);
  }, []);

  const toggle = useCallback(() => { if (listening) stop(); else start(); }, [listening, start, stop]);

  return { supported, listening, toggle };
}
