import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import EditableSpan from "./EditableSpan.jsx";

// Table rows are keyed by their position in the list (there's no stable id
// on most row types), so adding, removing, or re-sorting a row reuses the
// same DOM input for what is now a logically different row. A plain
// uncontrolled input (defaultValue) only sets its value once on mount, so
// that reused node keeps showing whatever the previous occupant of that
// position held — e.g. a freshly-added expense could flash the amount of
// the row that used to be there. This syncs the DOM value back in on every
// render, but only while the field isn't focused, matching the same
// race-avoidance EditableSpan already uses for text cells (a mid-typing
// resync would fight the caret and scramble what's being typed).
export function SyncedInput({ type, value, onChange, onFocus, step, style }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement !== el && el.value !== String(value ?? "")) {
      el.value = value ?? "";
    }
  }, [value]);
  return <input ref={ref} type={type} step={step} defaultValue={value} onChange={onChange} onFocus={onFocus} style={style} />;
}

// Dropdown cells (category, priority, aisle, etc.) offer a fixed list plus
// a trailing "Custom…" choice — picking it swaps to a plain text input so
// a value outside the preset list can be typed, with a small button to
// flip back to the list. Local `customMode` state starts "on" whenever the
// cell's current value isn't one of the preset options, so a previously
// saved custom value still shows as text (not blank) on reload.
function SelectCell({ c, ariaLabel }) {
  const { t } = useTranslation();
  const [customMode, setCustomMode] = useState(!c.options.includes(c.v));

  if (customMode) {
    return (
      <span className="cell-select-custom">
        <input type="text" aria-label={ariaLabel} defaultValue={c.v} onChange={c.set} placeholder={t("cell.typeValue")} />
        <button
          type="button"
          className="cell-select-back"
          title={t("cell.chooseFromList")}
          aria-label={t("cell.chooseFromList")}
          onClick={() => setCustomMode(false)}
        >
          ▾
        </button>
      </span>
    );
  }

  return (
    <select
      aria-label={ariaLabel}
      defaultValue={c.options.includes(c.v) ? c.v : "__custom__"}
      onChange={(e) => {
        if (e.target.value === "__custom__") { setCustomMode(true); return; }
        c.set(e);
      }}
    >
      {/* Option VALUES stay the canonical English strings stored in the
          data model (task.cat, expense.cat, etc.) -- only the visible
          label is translated, via t()'s built-in "return the key itself
          if missing" fallback, since the full data.js constant-array
          translation (CATS/PRIOS/STATUSES/...) is a separate, not-yet-done
          pass (see the option-values gap noted when this shipped). */}
      {c.options.map((o) => <option key={o} value={o}>{t("options." + o, { defaultValue: o })}</option>)}
      <option value="__custom__">{t("cell.custom")}</option>
    </select>
  );
}

// Renders one table/week cell object built by the `plain/chip/edit/numc/
// datec/sel/tog/barc` helpers in engine.js.
export default function Cell({ c, ariaLabel }) {
  const { t } = useTranslation();
  switch (c.kind) {
    case "plain":
      return (
        <span
          className="cell-plain"
          style={{ color: c.muted ? "var(--color-neutral-500)" : "var(--color-text)", textDecoration: c.strike ? "line-through" : "none" }}
        >
          {c.v}
        </span>
      );
    case "edit":
      return <EditableSpan className="cell-edit" value={c.v} onInput={c.set} />;
    case "datelink":
      return (
        <span className="cell-datelink">
          <span>{c.v}</span>
          {c.count > 0 && (
            <button type="button" className="link-badge" onClick={c.onClick}>
              {t("cell.upcomingCount", { count: c.count })}
            </button>
          )}
        </span>
      );
    case "num":
      return (
        <SyncedInput
          type="number"
          step={c.step}
          value={c.v}
          onChange={c.set}
          onFocus={(e) => e.target.select()}
          style={{ textAlign: "end" }}
        />
      );
    case "date":
      return <SyncedInput type="date" value={c.v} onChange={c.set} />;
    case "time":
      return <SyncedInput type="time" value={c.v} onChange={c.set} />;
    case "select":
      return <SelectCell c={c} ariaLabel={ariaLabel} />;
    case "toggle":
      return (
        <span
          className="cell-box"
          data-c={c.tint}
          data-tint={c.on ? "1" : ""}
          tabIndex={0}
          role="checkbox"
          aria-checked={c.on}
          onClick={c.set}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); c.set(e); } }}
        />
      );
    case "chip":
      return <span className="chip" data-c={c.tint}>{c.v}</span>;
    case "bar":
      return (
        <span className="cell-bar-wrap">
          <span className="cell-bar-track">
            <span className="cell-bar-fill" data-c={c.tint} style={{ width: c.pct + "%" }} />
          </span>
          <span className="cell-bar-label">{c.v}</span>
        </span>
      );
    default:
      return null;
  }
}
