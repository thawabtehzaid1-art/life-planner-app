import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

const SESSION_SECONDS = 30 * 60;

function fmt(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
}

export default function FocusTimer({ sessionsToday, onSessionComplete }) {
  const { t } = useTranslation();
  const [remaining, setRemaining] = useState(SESSION_SECONDS);
  const [running, setRunning] = useState(false);
  const [justFinished, setJustFinished] = useState(false);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(intervalRef.current);
          setRunning(false);
          setJustFinished(true);
          onSessionComplete();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [running, onSessionComplete]);

  const start = () => {
    setJustFinished(false);
    if (remaining === 0) setRemaining(SESSION_SECONDS);
    setRunning(true);
  };
  const pause = () => setRunning(false);
  const reset = () => { setRunning(false); setJustFinished(false); setRemaining(SESSION_SECONDS); };

  const pct = Math.round(100 * (1 - remaining / SESSION_SECONDS));

  return (
    <div className="focus-timer">
      <div className="focus-timer-left">
        <div className="focus-timer-label">{t("focusTimer.label")}</div>
        <div className="focus-timer-clock">{fmt(remaining)}</div>
        <div className="focus-timer-track">
          <div className="focus-timer-fill" style={{ width: pct + "%" }} />
        </div>
        {justFinished && <div className="focus-timer-done">{t("focusTimer.done")}</div>}
      </div>
      <div className="focus-timer-right">
        <div className="focus-timer-buttons">
          {!running
            ? <button className="btn-outline" onClick={start}>{remaining === SESSION_SECONDS || remaining === 0 ? t("focusTimer.start") : t("focusTimer.resume")}</button>
            : <button className="btn-outline" onClick={pause}>{t("focusTimer.pause")}</button>}
          <button className="btn-outline" onClick={reset}>{t("focusTimer.reset")}</button>
        </div>
        {/* Phrased around the count rather than declined with it, same
            reasoning as the Dashboard hero headline: Arabic plural
            agreement has six forms, not English's two, and getting every
            dynamic count string right is its own dedicated pass. */}
        <div className="focus-timer-sessions">{t("focusTimer.sessionsToday", { count: sessionsToday })}</div>
      </div>
    </div>
  );
}
