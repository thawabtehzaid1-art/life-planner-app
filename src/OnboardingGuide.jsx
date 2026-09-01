// A short, friendly setup checklist for brand-new accounts — five steps,
// each one auto-checks itself the moment real data shows up (see
// onboardingSteps() in pages.js), so there's nothing to separately
// "submit." Dismissible at any point, on purpose: this is a nudge, not a
// gate, since forcing every field before letting someone explore the app
// tends to just make people bounce.
export default function OnboardingGuide({ steps, onNavigate, onFinish }) {
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;
  const pct = Math.round(100 * doneCount / steps.length);

  return (
    <div className="welcome-card onboarding-card">
      <div className="onboarding-header">
        <div className="welcome-title">Let's get you set up</div>
        <div className="onboarding-progress-label">{doneCount} of {steps.length} done</div>
      </div>
      <div className="onboarding-track">
        <div className="onboarding-fill" style={{ width: pct + "%" }} />
      </div>
      <ul className="onboarding-list">
        {steps.map((s) => (
          <li key={s.id} className="onboarding-step">
            <span
              className="cell-box onboarding-box"
              data-c="health"
              data-tint={s.done ? "1" : ""}
              role="checkbox"
              aria-checked={s.done}
              tabIndex={0}
              onClick={s.toggle}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); s.toggle(); } }}
            />
            <div className="onboarding-step-text">
              <div className="onboarding-step-label" style={{ textDecoration: s.done ? "line-through" : "none" }}>{s.label}</div>
              <div className="onboarding-step-note">{s.note}</div>
            </div>
            {!s.done && (
              <button type="button" className="btn-outline onboarding-go" onClick={() => onNavigate(s.tab)}>Go</button>
            )}
          </li>
        ))}
      </ul>
      <button type="button" className="btn-outline welcome-dismiss" onClick={onFinish}>
        {allDone ? "All set — take me to my Dashboard" : "Skip for now"}
      </button>
    </div>
  );
}
