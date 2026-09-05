import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "./supabaseClient.js";

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL + "/functions/v1";

const STATUS_TINT = {
  trialing: "work",
  active: "health",
  past_due: "home",
  canceled: "home",
};

function daysLeft(trialEndsAt) {
  if (!trialEndsAt) return 0;
  const ms = new Date(trialEndsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
}

// Same card chrome as every planner tab's Block.jsx sections (block-card /
// block-header / block-title / block-body) — Account reads as one more page
// in the app, not a bolted-on settings screen with its own visual language.
function SettingsSection({ title, note, children, danger }) {
  return (
    <div className="block-card" data-danger={danger ? "1" : ""}>
      <div className="block-header">
        <h2 className="block-title">{title}</h2>
        <div className="block-note">{note}</div>
      </div>
      <div className="block-body account-section-body">{children}</div>
    </div>
  );
}

export default function AccountSettings({ userEmail, subscription, theme, setTheme, themeAuto, setThemeAuto, THEMES, push, gcal, health, onSignOut, onNavigate, onboarded, patch, reset }) {
  const { t, i18n } = useTranslation();
  const [resetState, setResetState] = useState("idle"); // idle | busy | sent | error
  const [resetError, setResetError] = useState("");

  const [healthOpen, setHealthOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // The "Delete account" button and the confirm panel's input are two
  // different elements that swap in/out of the DOM — without this, a
  // keyboard user's focus silently drops to <body> on either transition.
  // Move it explicitly instead: into the input when the panel opens, back
  // to the trigger when it closes. Skipped on first mount (deleteOpen
  // starts false) so page load doesn't steal focus onto this button.
  const deleteTriggerRef = useRef(null);
  const deleteInputRef = useRef(null);
  const deleteOpenedBefore = useRef(false);
  const themeBtnRefs = useRef({});
  const langBtnRefs = useRef({});
  const LANGUAGES = [{ id: "en", label: "English" }, { id: "ar", label: "العربية" }];
  useEffect(() => {
    if (!deleteOpenedBefore.current) { deleteOpenedBefore.current = true; return; }
    if (deleteOpen) deleteInputRef.current?.focus();
    else deleteTriggerRef.current?.focus();
  }, [deleteOpen]);

  async function sendPasswordReset() {
    if (resetState === "busy" || !userEmail) return;
    setResetState("busy");
    setResetError("");
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(userEmail);
      if (error) throw error;
      setResetState("sent");
    } catch (err) {
      setResetError(err.message || t("account.profile.resetError"));
      setResetState("error");
    }
  }

  async function confirmDelete() {
    if (deleteBusy || deleteText.trim().toLowerCase() !== (userEmail || "").toLowerCase()) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error(t("account.danger.deleteSessionExpired"));
      const res = await fetch(`${FUNCTIONS_URL}/delete-account`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || t("account.danger.deleteFailed"));
      await supabase.auth.signOut();
      window.location.reload();
    } catch (err) {
      setDeleteError(err.message || String(err));
      setDeleteBusy(false);
    }
  }

  const status = subscription?.status ? { label: t("account.plan.status." + subscription.status, { defaultValue: subscription.status }), tint: STATUS_TINT[subscription.status] || "" } : null;
  const trialing = subscription?.status === "trialing";
  const left = trialing ? daysLeft(subscription.trial_ends_at) : 0;
  const deleteMatches = deleteText.trim().toLowerCase() === (userEmail || "").toLowerCase();

  return (
    <>
      <SettingsSection title={t("account.profile.title")} note={t("account.profile.note")}>
        <div className="account-fields">
          <div className="settings-field">
            <div className="settings-label">{t("account.profile.email")}</div>
            <div>{userEmail || "—"}</div>
          </div>
          <div className="settings-field">
            <div className="settings-label">
              {t("account.profile.password")}
              <div className="settings-hint">{t("account.profile.passwordHint")}</div>
            </div>
            <div className="push-optin">
              <button type="button" className="btn-outline" onClick={sendPasswordReset} disabled={resetState === "busy"}>
                {resetState === "busy" ? t("account.profile.sending") : t("account.profile.sendResetLink")}
              </button>
              {resetState === "sent" && <span className="push-optin-on" role="status">{t("account.profile.checkEmail")}</span>}
              {resetState === "error" && <span className="push-optin-error" role="alert">{resetError}</span>}
            </div>
          </div>
        </div>
        <button type="button" className="welcome-link account-jump-link" onClick={() => onNavigate("overview")}>
          {t("account.profile.overviewJump")}
        </button>
        {/* Moved here from a permanent, un-dismissible link on Overview
            (same complaint as the old Health Sync pointer above it used to
            be) — restarting sets the flag, then jumps to Overview since
            that's the only place the guide itself actually renders. */}
        {onboarded !== false && (
          <button
            type="button"
            className="welcome-link account-jump-link"
            onClick={() => { patch((n) => { n.onboarded = false; }); onNavigate("overview"); }}
          >
            {t("account.profile.restartGuide")}
          </button>
        )}
      </SettingsSection>

      <SettingsSection title={t("account.plan.title")} note={t("account.plan.note")}>
        {status ? (
          <div className="push-optin">
            <span className="chip status-chip" data-c={status.tint}>{status.label}</span>
            {trialing && (
              <span className="text-muted">
                {left > 0 ? t("account.plan.trialDaysLeft", { count: left }) : t("account.plan.trialEndsToday")}
              </span>
            )}
            {subscription?.status === "active" && <span className="text-muted">{t("account.plan.renewsAutomatically")}</span>}
            {subscription?.status === "past_due" && <span className="text-muted">{t("account.plan.paymentFailedNote")}</span>}
          </div>
        ) : (
          <div className="text-muted">{t("account.plan.loading")}</div>
        )}
      </SettingsSection>

      <SettingsSection title={t("account.appearance.title")} note={t("account.appearance.note")}>
        <div className="settings-field">
          <div className="settings-label">{t("account.appearance.theme")}</div>
          <div
            className="theme-switch-full"
            role="radiogroup"
            aria-label={t("account.appearance.colorTheme")}
            onKeyDown={(e) => {
              // role="radio" promises the standard radio-group keyboard
              // pattern (arrow keys move the single roving tab-stop) — Tab
              // alone previously left all three independently focusable
              // with no arrow support, which doesn't match what the role
              // tells assistive tech to expect.
              if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)) return;
              e.preventDefault();
              const idx = THEMES.findIndex((th) => th.id === theme);
              const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
              const next = THEMES[(idx + dir + THEMES.length) % THEMES.length];
              setTheme(next.id);
              themeBtnRefs.current[next.id]?.focus();
            }}
          >
            {THEMES.map((th) => (
              <button
                key={th.id}
                ref={(el) => { themeBtnRefs.current[th.id] = el; }}
                type="button"
                role="radio"
                aria-checked={theme === th.id}
                tabIndex={theme === th.id ? 0 : -1}
                data-on={theme === th.id ? "1" : ""}
                className="theme-option-btn"
                onClick={() => setTheme(th.id)}
              >
                <span className={"theme-swatch theme-swatch-" + th.id} />
                <span>{t("account.appearance.themeName." + th.id)}</span>
              </button>
            ))}
          </div>
          <div className="push-optin">
            {/* Same stable-button pattern as the push-notification toggle
                below (label/style flips with state, element never
                unmounts) -- clicking a specific swatch above already
                turns this back off (see setTheme in App.jsx), same
                "manual pick wins" convention a thermostat's schedule
                override uses. */}
            <button
              type="button"
              className={themeAuto ? "header-link-btn" : "btn-outline"}
              onClick={() => setThemeAuto((v) => !v)}
            >
              {themeAuto ? t("account.theme.autoOn") : t("account.theme.autoOff")}
            </button>
            {themeAuto && (
              <span className="push-optin-on" role="status">{t("account.theme.autoNote")}</span>
            )}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title={t("account.language.title")} note={t("account.language.note")}>
        <div className="settings-field">
          <div className="settings-label">{t("account.language.label")}</div>
          <div
            className="theme-switch-full"
            role="radiogroup"
            aria-label={t("account.language.label")}
            onKeyDown={(e) => {
              // Same arrow-key/roving-tabindex pattern as the Theme
              // switcher above -- role="radiogroup" promises this
              // interaction regardless of the list length, and this one
              // used to declare the role without wiring up the behavior
              // it promises.
              if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)) return;
              e.preventDefault();
              const idx = LANGUAGES.findIndex((l) => l.id === i18n.language);
              const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
              const next = LANGUAGES[(idx + dir + LANGUAGES.length) % LANGUAGES.length];
              i18n.changeLanguage(next.id);
              langBtnRefs.current[next.id]?.focus();
            }}
          >
            {LANGUAGES.map((l) => (
              <button
                key={l.id}
                ref={(el) => { langBtnRefs.current[l.id] = el; }}
                type="button"
                role="radio"
                aria-checked={i18n.language === l.id}
                tabIndex={i18n.language === l.id ? 0 : -1}
                data-on={i18n.language === l.id ? "1" : ""}
                className="theme-option-btn"
                onClick={() => i18n.changeLanguage(l.id)}
              >
                <span>{l.label}</span>
              </button>
            ))}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title={t("account.notifications.title")} note={t("account.notifications.note")}>
        {!push.supported ? (
          <div className="text-muted">{t("account.notifications.notSupported")}</div>
        ) : (
          <div className="push-optin">
            {/* One stable button whose label/handler flips with push.subscribed,
                rather than swapping in a different element — so a keyboard
                user's focus survives the toggle instead of dropping to
                <body> when the old button unmounts. */}
            <button
              type="button"
              className={push.subscribed ? "header-link-btn" : "btn-outline"}
              onClick={push.subscribed ? push.unsubscribe : push.subscribe}
              disabled={push.busy}
            >
              {push.busy ? (push.subscribed ? t("account.notifications.turningOff") : t("account.notifications.turningOn")) : (push.subscribed ? t("account.notifications.turnOff") : t("account.notifications.turnOn"))}
            </button>
            {push.subscribed && (
              <span className="push-optin-on" role="status">
                <span aria-hidden="true">🔔</span> {t("account.notifications.onForDevice")}
              </span>
            )}
            {push.error && <span className="push-optin-error" role="alert">{push.error}</span>}
          </div>
        )}
      </SettingsSection>

      <SettingsSection title={t("account.connected.title")} note={t("account.connected.note")}>
        <div className="account-row">
          <div className="account-row-label">
            <div><span aria-hidden="true">📅</span> {t("account.connected.googleCalendar")}</div>
            <div className="settings-hint">{t("account.connected.googleCalendarHint")}</div>
          </div>
          <div className="push-optin">
            <button
              type="button"
              className={gcal.connected ? "header-link-btn" : "btn-outline"}
              onClick={gcal.connected ? gcal.disconnect : gcal.connect}
              disabled={gcal.busy}
            >
              {gcal.busy ? t("account.connected.disconnecting") : (gcal.connected ? t("account.connected.disconnect") : t("account.connected.connect"))}
            </button>
            {gcal.error && <span className="push-optin-error" role="alert">{gcal.error}</span>}
          </div>
        </div>

        <div className="account-row">
          <div className="account-row-label">
            <div><span aria-hidden="true">🩺</span> {t("account.connected.appleHealth")}</div>
            <div className="settings-hint">{t("account.connected.appleHealthHint")}</div>
          </div>
          <div className="push-optin">
            <button type="button" className="btn-outline" onClick={health.generate} disabled={health.busy}>
              {health.busy ? t("account.connected.generating") : health.token ? t("account.connected.regenerateToken") : t("account.connected.setUp")}
            </button>
          </div>
        </div>
        {health.token && (
          <>
            <div className="health-sync-row">
              <span className="health-sync-label">{t("account.connected.yourToken")}</span>
              <code className="health-sync-token">{health.token}</code>
              <button
                type="button"
                className="header-link-btn"
                onClick={() => {
                  navigator.clipboard?.writeText(health.token).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
                }}
              >
                {copied ? t("account.connected.copied") : t("account.connected.copy")}
              </button>
            </div>
            <details className="account-details" open={healthOpen} onToggle={(e) => setHealthOpen(e.target.open)}>
              <summary>{t("account.connected.shortcutsHowTo")}</summary>
              <ol className="welcome-list health-sync-steps">
                <li>{t("account.connected.shortcutsStep1")}</li>
                <li>{t("account.connected.shortcutsStep2")}</li>
                <li>
                  {t("account.connected.shortcutsStep3.pre")} <code>yyyy-MM-dd</code>.
                </li>
                <li>{t("account.connected.shortcutsStep4.pre")} <code>{FUNCTIONS_URL}/health-ingest?token={health.token}&type=steps&date=[Formatted Date]&value=[Health Value]</code>{t("account.connected.shortcutsStep4.post")}</li>
                <li>{t("account.connected.shortcutsStep5")}</li>
              </ol>
            </details>
          </>
        )}
      </SettingsSection>

      <SettingsSection title={t("account.danger.title")} note={t("account.danger.note")} danger>
        <div className="account-row">
          <div className="account-row-label">
            <div>{t("account.danger.signOut")}</div>
            <div className="settings-hint">{t("account.danger.signOutHint")}</div>
          </div>
          <button type="button" className="btn-outline" onClick={onSignOut}>{t("account.danger.signOut")}</button>
        </div>

        {/* Used to be a plain, unguarded link in Today's header (one
            misclick wiped everything, no confirmation at all) — same
            confirm() guard every other destructive row-delete in this app
            already uses, since this wipes just as much as one of those,
            just all at once. */}
        <div className="account-row">
          <div className="account-row-label">
            <div>{t("account.danger.resetToSample")}</div>
            <div className="settings-hint">{t("account.danger.resetToSampleHint")}</div>
          </div>
          <button
            type="button"
            className="btn-danger"
            onClick={() => { if (window.confirm(t("account.danger.resetConfirm"))) reset(); }}
          >
            {t("account.danger.reset")}
          </button>
        </div>

        <div className="account-row">
          <div className="account-row-label">
            <div>{t("account.danger.deleteAccount")}</div>
            <div className="settings-hint">{t("account.danger.deleteAccountHint")}</div>
          </div>
          {!deleteOpen && (
            <button type="button" ref={deleteTriggerRef} className="btn-danger" aria-expanded={deleteOpen} onClick={() => setDeleteOpen(true)}>
              {t("account.danger.deleteAccount")}
            </button>
          )}
        </div>

        {deleteOpen && (
          <div className="account-delete-confirm">
            <p id="delete-confirm-instructions">
              {t("account.danger.typeEmailToConfirm.pre")} <strong>{userEmail}</strong>{t("account.danger.typeEmailToConfirm.post")}
            </p>
            <div className="account-delete-confirm-row">
              <input
                ref={deleteInputRef}
                type="text"
                value={deleteText}
                onChange={(e) => setDeleteText(e.target.value)}
                placeholder={userEmail || ""}
                aria-labelledby="delete-confirm-instructions"
                autoComplete="off"
              />
              <button type="button" className="btn-danger" onClick={confirmDelete} disabled={!deleteMatches || deleteBusy}>
                {deleteBusy ? t("account.danger.deleting") : t("account.danger.permanentlyDelete")}
              </button>
              <button
                type="button"
                className="header-link-btn"
                onClick={() => { setDeleteOpen(false); setDeleteText(""); setDeleteError(""); }}
                disabled={deleteBusy}
              >
                {t("common.cancel")}
              </button>
            </div>
            {deleteError && <div className="auth-notice" data-c="home" role="alert">{deleteError}</div>}
          </div>
        )}
      </SettingsSection>
    </>
  );
}
