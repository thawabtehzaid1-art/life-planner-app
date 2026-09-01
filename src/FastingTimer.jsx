import { useState, useEffect } from "react";
import { fastingStatus } from "./engine.js";

function fmtRemaining(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? h + "h " + m + "m" : m + "m";
}

// A minute of drift either way doesn't matter for a fast measured in hours,
// so this ticks every 30s rather than every second like the focus timer —
// no reason to wake the tab up that often for something this coarse.
export default function FastingTimer({ settings }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  const status = fastingStatus(settings, now);
  if (!status) return null;

  const pct = Math.round(100 * (1 - status.remainingMin / status.windowLen));

  return (
    <div className="fasting-timer">
      <div className="fasting-timer-left">
        <div className="fasting-timer-label">{status.fasting ? "Fasting" : "Eating window"}</div>
        <div className="fasting-timer-clock">{fmtRemaining(status.remainingMin)}</div>
        <div className="fasting-timer-track">
          <div
            className="fasting-timer-fill"
            data-state={status.fasting ? "fasting" : "eating"}
            style={{ width: Math.max(0, Math.min(100, pct)) + "%" }}
          />
        </div>
      </div>
      <div className="fasting-timer-right">
        <div className="fasting-timer-note">
          {status.fasting ? "Eating window opens at " + status.endLabel : "Fast starts at " + status.startLabel}
        </div>
      </div>
    </div>
  );
}
