import { useTranslation } from "react-i18next";
import { useSpeechToText } from "./useSpeechToText.js";

// A self-contained mic toggle: pass `onText`, get dictated phrases back one
// at a time. Renders nothing if the browser has no speech recognition
// support (Firefox) — no point showing a button that can't work.
export default function MicButton({ onText, label }) {
  const { t } = useTranslation();
  const shownLabel = label || t("mic.dictate");
  const { supported, listening, toggle } = useSpeechToText(onText);
  if (!supported) return null;
  return (
    <button
      type="button"
      className="mic-btn"
      data-on={listening ? "1" : ""}
      onClick={toggle}
      title={listening ? t("mic.stopDictating") : shownLabel}
      aria-pressed={listening}
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 10a7 7 0 0 0 14 0" />
        <line x1="12" y1="19" x2="12" y2="22" />
      </svg>
      {listening ? t("mic.listening") : shownLabel}
    </button>
  );
}
