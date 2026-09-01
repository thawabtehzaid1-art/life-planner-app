import Cell, { SyncedInput } from "./Cell.jsx";
import EditableSpan from "./EditableSpan.jsx";
import MicButton from "./MicButton.jsx";

function TableBlock({ b }) {
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
          <div key={i} className="head-cell" style={{ textAlign: h.align }}>{h.t}</div>
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
        const rowLabel = (rowLabelCell && rowLabelCell.v) || `row ${ri + 1}`;
        return (
          <div key={ri} className="grid-row body-row">
            {r.cells.map((c, ci) => (
              <div
                key={ci}
                className="body-cell"
                data-c={c.tint}
                data-tint={c.tinted ? "1" : ""}
                data-kind={c.kind}
                style={{ textAlign: c.align, justifyContent: c.justify }}
              >
                <Cell c={c} ariaLabel={c.kind === "select" ? `${b.head[ci]?.t} for ${rowLabel}` : undefined} />
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
                aria-label={`Remove ${rowLabel}`}
                onClick={() => { if (window.confirm("Remove this row? This can't be undone.")) r.remove(); }}
              >×</button>
            )}
          </div>
        );
      })}
      {b.canAdd && (
        <div className="add-row">
          <button className="btn-outline" onClick={b.add}>{b.addLabel}</button>
          {b.voiceAdd && <MicButton onText={b.voiceAdd} label="Add by voice" />}
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
            {d.events.map((e, ei) => (
              <div key={ei} className="chip cal-event" data-c={e.tint}>{e.t}</div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function WeekBlock({ b }) {
  return (
    <div className="week-grid">
      {b.cells.map((c, i) => (
        <div
          key={i}
          className="week-cell"
          data-c={c.tint}
          data-tint={c.tinted ? "1" : ""}
          data-today={c.today ? "1" : ""}
        >
          {c.kind === "edit" ? (
            <EditableSpan className="cell-edit" value={c.v} onInput={c.set} />
          ) : (
            <span className={c.muted ? "text-muted" : ""}>{c.v}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function HabitGridBlock({ b }) {
  // b.title is the month/year label ("Sep 2026") already shown above the
  // grid — reused here so each square's own name doesn't depend on a
  // sighted user having tied a bare checkbox back to its column position.
  const monthAbbrev = b.title.split(" ")[0];
  return (
    <div>
      <div className="habit-grid-head">
        <div />
        <div className="habit-col-label">Remind at</div>
        <div className="habit-ticks">
          {b.dayTicks.map((n, i) => <span key={i}>{n}</span>)}
        </div>
        <div className="habit-col-label">Streak</div>
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
                aria-label={`${monthAbbrev} ${di + 1}, ${h.name}`}
                onClick={d.toggle}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); d.toggle(); } }}
              />
            ))}
          </div>
          <div className="habit-metric">{h.streak}</div>
          <div className="habit-metric">{h.pct}</div>
          <button type="button" className="del-cell" aria-label={`Remove ${h.name} habit`} onClick={h.remove}>×</button>
        </div>
      ))}
      <div className="add-row">
        <button className="btn-outline" onClick={b.add}>+ New habit</button>
      </div>
    </div>
  );
}

function ColumnsBlock({ b }) {
  if (b.empty) {
    return <div className="chart-empty"><p className="table-empty-label">Nothing logged yet</p></div>;
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
  if (b.empty) {
    return <div className="chart-empty"><p className="table-empty-label">Nothing logged yet</p></div>;
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
  if (b.empty) {
    return <div className="chart-empty"><p className="table-empty-label">Nothing logged yet</p></div>;
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

function SettingsBlock({ b }) {
  return (
    <div className="settings-grid">
      {b.fields.map((f, i) => (
        <div key={i} className="settings-field">
          <div className="settings-label">
            {f.label}
            {/* Recognition over Recall: a one-line reason for the field
                right where it's asked, not left for the user to wonder
                about or discover only after the fact. */}
            {f.hint && <div className="settings-hint">{f.hint}</div>}
          </div>
          <div>
            {f.isSelect && (
              <select defaultValue={f.v} onChange={f.set}>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
            {f.isMonth && <input type="month" defaultValue={f.v} onChange={f.set} />}
            {f.isDate && <input type="date" defaultValue={f.v} onChange={f.set} />}
            {f.isTime && <input type="time" defaultValue={f.v} onChange={f.set} />}
            {f.isNum && <input type="number" defaultValue={f.v} onChange={f.set} />}
            {f.isText && <input defaultValue={f.v} onChange={f.set} maxLength={f.maxLength} />}
          </div>
        </div>
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

function BadgesBlock({ b }) {
  return (
    <div className="badges-grid">
      {b.badges.map((x, i) => (
        <div key={i} className="badge-card">
          <span className="badge-medal" data-c={x.tint} data-earned={x.achieved ? "1" : ""}>
            {x.achieved ? "✓" : "–"}
          </span>
          <div className="badge-label">{x.label}</div>
          <div className="badge-status">{x.achieved ? "Earned" : "Locked"}</div>
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
  badges: BadgesBlock,
};

export default function Block({ b }) {
  const Renderer = RENDERERS[b.type];
  if (!Renderer) return null;
  return (
    <div className="block-card">
      <div className="block-header">
        <h2 className="block-title">{b.title}</h2>
        <div className="block-note">{b.note}</div>
      </div>
      <div className="block-body">
        <Renderer b={b} />
      </div>
    </div>
  );
}
