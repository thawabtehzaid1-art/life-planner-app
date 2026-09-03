import { useTranslation } from "react-i18next";

// A short, friendly setup checklist for brand-new accounts — five steps,
// each one auto-checks itself the moment real data shows up (see
// onboardingSteps() in pages.js), so there's nothing to separately
// "submit." Dismissible at any point, on purpose: this is a nudge, not a
// gate, since forcing every field before letting someone explore the app
// tends to just make people bounce.
export default function OnboardingGuide({ steps, onNavigate, onFinish }) {
  const { t } = useTranslation();
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;
  const pct = Math.round(100 * doneCount / steps.length);

  return (
    <div className="welcome-card onboarding-card">
      <div className="onboarding-header">
        {/* This card only ever renders for a brand-new account
            (onboarded === false) -- every time it's visible, it genuinely
            is the moment right after signing up, so the copy can just say
            so rather than opening straight into task mode. */}
        <div className="welcome-title">{t("onboarding.welcomeTitle")}</div>
        <div className="onboarding-progress-label">{t("onboarding.progressLabel", { done: doneCount, total: steps.length })}</div>
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
            {/* "Add your name"'s target tab is "overview" -- the page
                this card already lives on, so onNavigate(s.tab) was a
                no-op with no visible difference from the four Go buttons
                that actually take you somewhere. Scrolling to and
                focusing the real field gives it an action that matches
                what the button promises instead of silently doing
                nothing. */}
            {!s.done && (
              <button
                type="button"
                className="btn-outline onboarding-go"
                onClick={() => {
                  if (s.tab === "overview") {
                    document.getElementById("setup-name-field")?.focus({ preventScroll: false });
                  } else {
                    onNavigate(s.tab);
                  }
                }}
              >
                {t("onboarding.go")}
              </button>
            )}
          </li>
        ))}
      </ul>
      <button type="button" className="btn-outline welcome-dismiss" onClick={onFinish}>
        {allDone ? t("onboarding.allSet") : t("onboarding.skipForNow")}
      </button>
    </div>
  );
}
