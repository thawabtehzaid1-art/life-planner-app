import { useTranslation } from "react-i18next";
import Cell, { SyncedInput } from "./Cell.jsx";
import EditableSpan from "./EditableSpan.jsx";
import MicButton from "./MicButton.jsx";

// engine.js's cell/head builders speak "left"/"right" throughout (28+ call
// sites in pages.js alone) -- rather than touch every one of them, the
// physical-to-logical translation happens once, right here, at the only
// two places those values actually become a CSS textAlign. "left"/"right"
// are literal, physical values that would NOT flip under dir="rtl"; their
// logical equivalents "start"/"end" do. (justifyContent, used alongside
// this for body cells, doesn't need the same treatment -- flexbox's
// flex-start/flex-end are already resolved relative to the container's
// direction, not the physical viewport.)
function logicalAlign(align) {
  if (align === "left") return "start";
  if (align === "right") return "end";
  return align;
}

// Same geometry as src/icons/delete.svg, inlined (this project has no SVGR
// plugin to import .svg files as components — every other icon here, e.g.
// MicButton's mic glyph, is inline JSX for the same reason) and sized to
// match that same 14px small-icon scale. currentColor picks up .del-cell's
// own color token automatically, including its red :hover state.
function DeleteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <polyline points="3 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

// "All tasks" -> "all-tasks", matching the ids buildPages() bakes into a
// KPI's jump.blockId / a datelink cell's target so scrollIntoView can find
// the right block by its title without a separate id passed around too.
function slug(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function TableBlock({ b, highlightIds }) {
  const { t } = useTranslation();
  // One shared CSS grid for the whole table, not one independent grid per
  // row: each `.grid-row` is `display:contents` (see index.css) so its
  // cells become direct children of this single grid instead of starting
  // a fresh column-width computation of their own. Rows used to each
  // resolve `fr` columns against just their own content, so e.g. a task
  // name row and the header row could size the same "Task" column to
  // completely different widths — harmless-looking on a wide desktop
  // screen where everything had room anyway, but visibly broken column
  // alignment as soon as a row was narrower than its content wanted.
  return (
    <div className="grid-table" style={{ gridTemplateColumns: b.grid }}>
      <div className="grid-row grid-head">
        {b.head.map((h, i) => (
          <div key={i} className="head-cell" style={{ textAlign: logicalAlign(h.align) }}>{h.t}</div>
        ))}
        {b.canDelete && <div className="head-cell" />}
      </div>
      {b.rows.length === 0 && b.emptyLabel && (
        <div className="table-empty">
          <p className="table-empty-label">{b.emptyLabel}</p>
          {b.emptyNote && <p className="table-empty-note">{b.emptyNote}</p>}
        </div>
      )}
      {b.rows.map((r, ri) => {
        // A select cell's own options ("Groceries", "Debit card"...) say
        // nothing about which row/column they're in once a screen reader
        // is past the (visual-only) table header, so it needs a name of
        // its own — built from this row's first plain/free-typed cell
        // (usually the row's title, e.g. a task or bill name) since that's
        // the closest thing this generic grid has to a row label.
        const rowLabelCell = r.cells.find((cell) => cell.kind === "edit" || cell.kind === "plain");
        const rowLabel = (rowLabelCell && rowLabelCell.v) || t("block.table.rowFallback", { n: ri + 1 });
        return (
          <div key={ri} className="grid-row body-row" data-highlight={highlightIds?.has(r.id) ? "1" : ""}>
            {r.cells.map((c, ci) => (
              <div
                key={ci}
                className="body-cell"
                data-c={c.tint}
                data-tint={c.tinted ? "1" : ""}
                data-kind={c.kind}
                style={{ textAlign: logicalAlign(c.align), justifyContent: c.justify }}
              >
                <Cell c={c} ariaLabel={c.kind === "select" ? t("block.table.cellFor", { field: b.head[ci]?.t, row: rowLabel }) : undefined} />
              </div>
            ))}
            {b.canDelete && (
              // Error Prevention: a bare one-tap delete sitting right next to
              // editable cells is an easy accidental data-loss moment with no
              // recovery — this is app-wide (every table shares this del-cell),
              // not just the screen that surfaced it, per Consistency &
              // Standards (the same destructive action should behave the same
              // way everywhere, not just where someone happened to notice it).
              <button
                type="button"
                className="del-cell"
                aria-label={t("block.table.removeRow", { row: rowLabel })}
                onClick={() => { if (window.confirm(t("block.table.removeRowConfirm"))) r.remove(); }}
              ><DeleteIcon /></button>
            )}
          </div>
        );
      })}
      {b.canAdd && (
        <div className="add-row">
          <button className="btn-outline" onClick={b.add}>{b.addLabel}</button>
          {b.voiceAdd && <MicButton onText={b.voiceAdd} label={t("block.table.addByVoice")} />}
        </div>
      )}
    </div>
  );
}

function CalendarBlock({ b }) {
  return (
    <div className="cal-wrap">
      <div className="cal-daynames">
        {b.dayNames.map((n) => <div key={n} className="cal-dayname">{n}</div>)}
      </div>
      <div className="cal-grid">
        {b.days.map((d, i) => (
          <div
            key={i}
            className="cal-cell"
            data-today={d.today ? "1" : ""}
            data-dim={d.dim ? "1" : ""}
            role="button"
            tabIndex={0}
            onClick={d.onClick}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); d.onClick(); } }}
          >
            <div className="cal-cell-top">
              <span style={{ color: d.numColor }}>{d.n}</span>
              <span className="cal-more">{d.more}</span>
            </div>
            {/* Wrapped so mobile can lay these out as a row of small dots
                (see .cal-events in index.css) instead of the desktop's
                stacked full-text chips — title gives desktop users a
                hover tooltip once there's no visible label to read. */}
            <div className="cal-events">
              {d.events.map((e, ei) => (
                <div key={ei} className="chip cal-event" data-c={e.tint} title={e.t}>{e.t}</div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WeekBlock({ b, revealed, toggleReveal }) {
  return (
    <div className="week-grid">
      {b.cells.map((c, i) => {
        const key = "week-" + i;
        const clickable = !!(c.names && c.names.length);
        return (
          <div
            key={i}
            className="week-cell"
            data-c={c.tint}
            data-tint={c.tinted ? "1" : ""}
            data-today={c.today ? "1" : ""}
            data-tappable={clickable ? "1" : ""}
            onClick={clickable ? () => toggleReveal(key) : undefined}
          >
            {c.kind === "edit" ? (
              <EditableSpan className="cell-edit" value={c.v} onInput={c.set} />
            ) : (
              <span className={c.muted ? "text-muted" : ""}>{c.v}</span>
            )}
            {clickable && revealed === key && (
              <div className="week-due-list">
                {c.names.map((n, ni) => <div key={ni}>{n}</div>)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function HabitGridBlock({ b }) {
  const { t } = useTranslation();
  // b.title is the month/year label ("Sep 2026") already shown above the
  // grid — reused here so each square's own name doesn't depend on a
  // sighted user having tied a bare checkbox back to its column position.
  const monthAbbrev = b.title.split(" ")[0];
  return (
    <div>
      <div className="habit-grid-head">
        <div />
        <div className="habit-col-label">{t("block.habitGrid.remindAt")}</div>
        <div className="habit-ticks">
          {b.dayTicks.map((n, i) => <span key={i}>{n}</span>)}
        </div>
        <div className="habit-col-label">{t("block.habitGrid.streak")}</div>
        <div className="habit-col-label">%</div>
        <div />
      </div>
      {b.habits.map((h, hi) => (
        <div key={hi} className="habit-row">
          <EditableSpan tag="div" className="cell-edit" value={h.name} onInput={h.setName} />
          <SyncedInput type="time" value={h.reminderTime} onChange={h.setReminder} />
          <div className="habit-days">
            {h.days.map((d, di) => (
              <span
                key={di}
                className="cell-box habit-box"
                data-c={d.tint}
                data-tint={d.on ? "1" : ""}
                tabIndex={0}
                role="checkbox"
                aria-checked={d.on}
                aria-label={t("block.habitGrid.dayLabel", { month: monthAbbrev, day: di + 1, name: h.name })}
                onClick={d.toggle}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); d.toggle(); } }}
              />
            ))}
          </div>
          <div className="habit-metric">{h.streak}</div>
          <div className="habit-metric">{h.pct}</div>
          <button type="button" className="del-cell" aria-label={t("block.habitGrid.removeHabit", { name: h.name })} onClick={h.remove}><DeleteIcon /></button>
        </div>
      ))}
      <div className="add-row">
        <button className="btn-outline" onClick={b.add}>{t("block.habitGrid.addLabel")}</button>
      </div>
    </div>
  );
}

function ColumnsBlock({ b }) {
  const { t } = useTranslation();
  if (b.empty) {
    return <div className="chart-empty"><p className="table-empty-label">{t("block.chart.nothingLogged")}</p></div>;
  }
  return (
    <div>
      <div className="columns-plot">
        {b.series.map((s, i) => (
          <div key={i} className="columns-bar-col">
            <div className="columns-value">{s.value}</div>
            <div className="columns-bar" data-c={s.tint} style={{ height: s.h + "px" }} />
          </div>
        ))}
      </div>
      <div className="columns-labels">
        {b.series.map((s, i) => <div key={i} className="columns-label">{s.label}</div>)}
      </div>
    </div>
  );
}

function LineBlock({ b }) {
  const { t } = useTranslation();
  if (b.empty) {
    return <div className="chart-empty"><p className="table-empty-label">{t("block.chart.nothingLogged")}</p></div>;
  }
  return (
    <div>
      <div className="line-wrap">
        <div className="line-yaxis">
          <div>{b.yTop}</div>
          <div>{b.yMid}</div>
          <div>{b.yBottom}</div>
        </div>
        <div className="line-plot">
          <div className="line-gridlines">
            <div /><div /><div />
          </div>
          <svg viewBox="0 0 600 210" preserveAspectRatio="none" className="line-svg">
            <polygon points={b.area} fill="var(--color-accent-900)" />
            <polyline points={b.line} fill="none" stroke="var(--color-accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
      </div>
      <div className="line-xlabels">
        {b.xLabels.map((x, i) => <div key={i} className="line-xlabel">{x}</div>)}
      </div>
    </div>
  );
}

function DonutBlock({ b }) {
  const { t } = useTranslation();
  if (b.empty) {
    return <div className="chart-empty"><p className="table-empty-label">{t("block.chart.nothingLogged")}</p></div>;
  }
  return (
    <div className="donut-wrap">
      <div className="donut-svg-wrap">
        <svg viewBox="0 0 180 180" className="donut-svg">
          <circle cx="90" cy="90" r="70" fill="none" stroke="var(--color-neutral-900)" strokeWidth="22" />
          {b.segments.map((s, i) => (
            <circle key={i} cx="90" cy="90" r="70" fill="none" stroke={s.stroke} strokeWidth="22"
              strokeDasharray={s.dash} strokeDashoffset={s.offset} />
          ))}
        </svg>
        <div className="donut-centre">
          <div className="donut-centre-value">{b.centre}</div>
          <div className="donut-centre-note">{b.centreNote}</div>
        </div>
      </div>
      <div className="donut-legend">
        {b.segments.map((s, i) => (
          <div key={i} className="donut-legend-row">
            <span className="donut-swatch" data-c={s.tint} />
            <span>{s.label}</span>
            <span className="donut-legend-value">{s.value}</span>
            <span className="donut-legend-share">{s.share}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingsField({ f }) {
  return (
    <div className="settings-field">
      <div className="settings-label">
        {f.label}
        {/* Recognition over Recall: a one-line reason for the field
            right where it's asked, not left for the user to wonder
            about or discover only after the fact. */}
        {f.hint && <div className="settings-hint">{f.hint}</div>}
      </div>
      <div>
        {f.isSelect && (
          <select id={f.id} defaultValue={f.v} onChange={f.set}>
            {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        )}
        {f.isMonth && <input id={f.id} type="month" defaultValue={f.v} onChange={f.set} />}
        {f.isDate && <input id={f.id} type="date" defaultValue={f.v} onChange={f.set} />}
        {f.isTime && <input id={f.id} type="time" defaultValue={f.v} onChange={f.set} />}
        {f.isNum && <input id={f.id} type="number" defaultValue={f.v} onChange={f.set} />}
        {f.isText && <input id={f.id} defaultValue={f.v} onChange={f.set} maxLength={f.maxLength} />}
      </div>
    </div>
  );
}

function SettingsBlock({ b }) {
  // Fields optionally carry a `group` label (currently just Overview's
  // Setup, e.g. "About you" / "Preferences") — real <fieldset>/<legend>
  // grouping when present, not just a visual rule between rows, so
  // screen-reader users get the same "these fields relate" signal sighted
  // users get from the sub-heading. Every other settingsBlock() call site
  // (Cycle Tracker, debt strategy, meal habits, weight goal) has no
  // `group` on any field and renders exactly as before.
  const hasGroups = b.fields.some((f) => f.group);
  if (!hasGroups) {
    return (
      <div className="settings-grid">
        {b.fields.map((f, i) => <SettingsField key={i} f={f} />)}
      </div>
    );
  }
  const groups = [];
  for (const f of b.fields) {
    if (!groups.includes(f.group)) groups.push(f.group);
  }
  return (
    <div className="settings-groups">
      {groups.map((g) => (
        <fieldset key={g} className="settings-fieldset">
          <legend className="settings-group-label">{g}</legend>
          <div className="settings-grid">
            {b.fields.filter((f) => f.group === g).map((f, i) => <SettingsField key={i} f={f} />)}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function NotesBlock({ b }) {
  return (
    <div className="notes-grid" style={{ gridTemplateColumns: `repeat(${b.notes.length},1fr)` }}>
      {b.notes.map((n, i) => (
        <div key={i}>
          <div className="notes-term">{n.t}</div>
          <div className="notes-body">{n.s}</div>
        </div>
      ))}
    </div>
  );
}

// Vertical stack, not a grid like NotesBlock — each phase needs real room
// for two full sentences (what's happening + a self-care note), which a
// side-by-side N-column layout doesn't leave space for. The current phase
// gets the same accent-ring treatment [data-today="1"] already uses
// elsewhere, plus an explicit "You are here" label rather than relying on
// the ring alone to communicate it.
function PhasesBlock({ b }) {
  const { t } = useTranslation();
  return (
    <div className="phase-list">
      {b.phases.map((p) => (
        <div key={p.id} className="phase-item" data-current={p.current ? "1" : ""}>
          <div className="phase-header">
            <span className="phase-name">{p.label}</span>
            {p.current ? (
              <span className="phase-current-tag">{t("block.phases.youAreHere", { from: p.from, to: p.to })}</span>
            ) : (
              <span className="phase-range">{t("block.phases.daysRange", { from: p.from, to: p.to })}</span>
            )}
          </div>
          <div className="phase-what">{p.whatHappens}</div>
          <div className="phase-care"><b>{t("block.phases.mayHelp")}</b> {p.selfCare}</div>
        </div>
      ))}
    </div>
  );
}

function BadgesBlock({ b }) {
  const { t } = useTranslation();
  return (
    <div className="badges-grid">
      {b.badges.map((x, i) => (
        <div key={i} className="badge-card">
          <span className="badge-medal" data-c={x.tint} data-earned={x.achieved ? "1" : ""}>
            {x.achieved ? "✓" : "–"}
          </span>
          <div className="badge-label">{x.label}</div>
          <div className="badge-status">{x.achieved ? t("block.badges.earned") : t("block.badges.locked")}</div>
        </div>
      ))}
    </div>
  );
}

const RENDERERS = {
  table: TableBlock,
  calendar: CalendarBlock,
  week: WeekBlock,
  grid: HabitGridBlock,
  columns: ColumnsBlock,
  line: LineBlock,
  donut: DonutBlock,
  settings: SettingsBlock,
  notes: NotesBlock,
  phases: PhasesBlock,
  badges: BadgesBlock,
};

export default function Block({ b, highlightIds, revealed, toggleReveal }) {
  const Renderer = RENDERERS[b.type];
  if (!Renderer) return null;
  return (
    <div className="block-card" id={slug(b.title)}>
      <div className="block-header">
        <h2 className="block-title">{b.title}</h2>
        <div className="block-note">{b.note}</div>
      </div>
      <div className="block-body">
        <Renderer b={b} highlightIds={highlightIds} revealed={revealed} toggleReveal={toggleReveal} />
      </div>
    </div>
  );
}
