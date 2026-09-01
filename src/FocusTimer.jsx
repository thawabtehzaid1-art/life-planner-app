import { useState, useEffect, useRef } from "react";

const SESSION_SECONDS = 30 * 60;

function fmt(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
}

export default function FocusTimer({ sessionsToday, onSessionComplete }) {
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
        <div className="focus-timer-label">Deep focus</div>
        <div className="focus-timer-clock">{fmt(remaining)}</div>
        <div className="focus-timer-track">
          <div className="focus-timer-fill" style={{ width: pct + "%" }} />
        </div>
        {justFinished && <div className="focus-timer-done">Session complete — nice work.</div>}
      </div>
      <div className="focus-timer-right">
        <div className="focus-timer-buttons">
          {!running
            ? <button className="btn-outline" onClick={start}>{remaining === SESSION_SECONDS || remaining === 0 ? "Start 30 min" : "Resume"}</button>
            : <button className="btn-outline" onClick={pause}>Pause</button>}
          <button className="btn-outline" onClick={reset}>Reset</button>
        </div>
        <div className="focus-timer-sessions">{sessionsToday} session{sessionsToday === 1 ? "" : "s"} today</div>
      </div>
    </div>
  );
}
