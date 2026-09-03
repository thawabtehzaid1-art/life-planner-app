import { useState, useEffect } from "react";
import { fastingStatus } from "./engine.js";
import { iso } from "./data.js";

function fmtRemaining(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? h + "h " + m + "m" : m + "m";
}

// A minute of drift either way doesn't matter for a fast measured in hours,
// so this ticks every 30s rather than every second like the focus timer --
// no reason to wake the tab up that often for something this coarse.
export default function FastingTimer({ data, patch }) {
  const [now, setNow] = useState(() => new Date());
  const [adjusting, setAdjusting] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  const settings = data.settings;
  const status = fastingStatus(settings, now, data.fastingToday);
  if (!status) return null;

  const pct = Math.round(100 * (1 - status.remainingMin / status.windowLen));

  function stopFast() {
    const endedAt = new Date().toISOString();
    patch((n) => {
      n.fastingToday = { endedEarlyAt: endedAt };
      // Also logged as history immediately (rather than waiting on the
      // server's hourly scan to notice) since this is a deliberate, known
      // moment -- the scan only needs to catch fasts nobody manually ended.
      if (!n.fastingLog) n.fastingLog = [];
      n.fastingLog.push({
        date: iso(Date.now()),
        scheduledStart: settings.fastStart || "20:00",
        scheduledEnd: settings.fastEnd || "12:00",
        endedAt,
        endedEarly: true,
      });
    });
  }

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
          {status.fasting
            ? "Eating window opens at " + status.endLabel
            : status.endedEarly
              ? "Ended early — next fast starts at " + status.startLabel
              : "Fast starts at " + status.startLabel}
        </div>
        {status.fasting && (
          <button type="button" className="header-link-btn fasting-timer-action" onClick={stopFast}>
            Stop fast
          </button>
        )}
        {!adjusting ? (
          <button type="button" className="header-link-btn fasting-timer-action" onClick={() => setAdjusting(true)}>
            Adjust start time
          </button>
        ) : (
          <label className="fasting-timer-adjust">
            <input
              type="time"
              defaultValue={settings.fastStart || "20:00"}
              onChange={(e) => patch((n) => { n.settings.fastStart = e.target.value; })}
              onBlur={() => setAdjusting(false)}
              autoFocus
            />
            {/* Changes the daily schedule going forward, not just today --
                same field Settings edits, just reachable without leaving
                this page. A true "just for today, one time" override would
                need its own per-day start-time record on top of the
                endedEarlyAt one above; skipped for now since the schedule
                edit already covers the common "I typed the wrong time"
                case in one tap. */}
            <span className="fasting-timer-adjust-hint">changes your daily schedule</span>
          </label>
        )}
      </div>
    </div>
  );
}
