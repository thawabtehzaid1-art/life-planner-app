import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient.js";

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL + "/functions/v1";

const STATUS_COPY = {
  trialing: { label: "Trial", tint: "work" },
  active: { label: "Active", tint: "health" },
  past_due: { label: "Payment failed", tint: "home" },
  canceled: { label: "Canceled", tint: "home" },
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

export default function AccountSettings({ userEmail, subscription, theme, setTheme, THEMES, push, gcal, health, onSignOut, onNavigate, onboarded, patch }) {
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
      setResetError(err.message || "Couldn't send the reset email. Try again.");
      setResetState("error");
    }
  }

  async function confirmDelete() {
    if (deleteBusy || deleteText.trim().toLowerCase() !== (userEmail || "").toLowerCase()) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Your session expired — sign in again to delete your account.");
      const res = await fetch(`${FUNCTIONS_URL}/delete-account`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Couldn't delete your account — try again.");
      await supabase.auth.signOut();
      window.location.reload();
    } catch (err) {
      setDeleteError(err.message || String(err));
      setDeleteBusy(false);
    }
  }

  const status = subscription?.status ? STATUS_COPY[subscription.status] || { label: subscription.status, tint: "" } : null;
  const trialing = subscription?.status === "trialing";
  const left = trialing ? daysLeft(subscription.trial_ends_at) : 0;
  const deleteMatches = deleteText.trim().toLowerCase() === (userEmail || "").toLowerCase();

  return (
    <>
      <SettingsSection title="Profile" note="Your sign-in identity">
        <div className="account-fields">
          <div className="settings-field">
            <div className="settings-label">Email</div>
            <div>{userEmail || "—"}</div>
          </div>
          <div className="settings-field">
            <div className="settings-label">
              Password
              <div className="settings-hint">We'll email you a link to set a new one</div>
            </div>
            <div className="push-optin">
              <button type="button" className="btn-outline" onClick={sendPasswordReset} disabled={resetState === "busy"}>
                {resetState === "busy" ? "Sending…" : "Send reset link"}
              </button>
              {resetState === "sent" && <span className="push-optin-on" role="status">Check your email for the link</span>}
              {resetState === "error" && <span className="push-optin-error" role="alert">{resetError}</span>}
            </div>
          </div>
        </div>
        <button type="button" className="welcome-link account-jump-link" onClick={() => onNavigate("overview")}>
          Your name, timezone, and other planner setup live on Overview →
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
            Restart the setup guide →
          </button>
        )}
      </SettingsSection>

      <SettingsSection title="Plan" note="Billed and managed through Stripe">
        {status ? (
          <div className="push-optin">
            <span className="chip status-chip" data-c={status.tint}>{status.label}</span>
            {trialing && (
              <span className="text-muted">
                {left > 0 ? `${left} day${left === 1 ? "" : "s"} left in your trial` : "Trial ends today"}
              </span>
            )}
            {subscription?.status === "active" && <span className="text-muted">Renews automatically each billing period</span>}
            {subscription?.status === "past_due" && <span className="text-muted">Your last payment failed — update it with Stripe to keep access</span>}
          </div>
        ) : (
          <div className="text-muted">Loading your plan…</div>
        )}
      </SettingsSection>

      <SettingsSection title="Appearance" note="Applies on this device">
        <div className="settings-field">
          <div className="settings-label">Theme</div>
          <div
            className="theme-switch-full"
            role="radiogroup"
            aria-label="Color theme"
            onKeyDown={(e) => {
              // role="radio" promises the standard radio-group keyboard
              // pattern (arrow keys move the single roving tab-stop) — Tab
              // alone previously left all three independently focusable
              // with no arrow support, which doesn't match what the role
              // tells assistive tech to expect.
              if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)) return;
              e.preventDefault();
              const idx = THEMES.findIndex((t) => t.id === theme);
              const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
              const next = THEMES[(idx + dir + THEMES.length) % THEMES.length];
              setTheme(next.id);
              themeBtnRefs.current[next.id]?.focus();
            }}
          >
            {THEMES.map((t) => (
              <button
                key={t.id}
                ref={(el) => { themeBtnRefs.current[t.id] = el; }}
                type="button"
                role="radio"
                aria-checked={theme === t.id}
                tabIndex={theme === t.id ? 0 : -1}
                data-on={theme === t.id ? "1" : ""}
                className="theme-option-btn"
                onClick={() => setTheme(t.id)}
              >
                <span className={"theme-swatch theme-swatch-" + t.id} />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Notifications" note="Reminders for bills and due tasks">
        {!push.supported ? (
          <div className="text-muted">Not supported on this browser or device.</div>
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
              {push.busy ? (push.subscribed ? "Turning off…" : "Turning on…") : (push.subscribed ? "Turn off" : "Turn on reminders")}
            </button>
            {push.subscribed && (
              <span className="push-optin-on" role="status">
                <span aria-hidden="true">🔔</span> Reminders are on for this device
              </span>
            )}
            {push.error && <span className="push-optin-error" role="alert">{push.error}</span>}
          </div>
        )}
      </SettingsSection>

      <SettingsSection title="Connected apps" note="Sync your planner with other services">
        <div className="account-row">
          <div className="account-row-label">
            <div><span aria-hidden="true">📅</span> Google Calendar</div>
            <div className="settings-hint">Tasks and bills appear as events</div>
          </div>
          <div className="push-optin">
            <button
              type="button"
              className={gcal.connected ? "header-link-btn" : "btn-outline"}
              onClick={gcal.connected ? gcal.disconnect : gcal.connect}
              disabled={gcal.busy}
            >
              {gcal.busy ? "Disconnecting…" : (gcal.connected ? "Disconnect" : "Connect")}
            </button>
            {gcal.error && <span className="push-optin-error" role="alert">{gcal.error}</span>}
          </div>
        </div>

        <div className="account-row">
          <div className="account-row-label">
            <div><span aria-hidden="true">🩺</span> Apple Health (via Shortcuts)</div>
            <div className="settings-hint">Bridges steps and sleep in through a personal token</div>
          </div>
          <div className="push-optin">
            <button type="button" className="btn-outline" onClick={health.generate} disabled={health.busy}>
              {health.busy ? "Generating…" : health.token ? "Regenerate token" : "Set up"}
            </button>
          </div>
        </div>
        {health.token && (
          <>
            <div className="health-sync-row">
              <span className="health-sync-label">Your token</span>
              <code className="health-sync-token">{health.token}</code>
              <button
                type="button"
                className="header-link-btn"
                onClick={() => {
                  navigator.clipboard?.writeText(health.token).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
                }}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <details className="account-details" open={healthOpen} onToggle={(e) => setHealthOpen(e.target.open)}>
              <summary>How to connect it in Shortcuts</summary>
              <ol className="welcome-list health-sync-steps">
                <li>Open the Shortcuts app → New Shortcut → add "Find Health Samples", set Sample Type to Steps (or Sleep Analysis) and Start Date to Today.</li>
                <li>Add "Calculate Statistics" → Operation: Sum → input: the result of "Find Health Samples".</li>
                <li>Add "Format Date" → Date field: Current Date → Date Format: Custom → <code>yyyy-MM-dd</code>.</li>
                <li>Add "Get Contents of URL" using <code>{FUNCTIONS_URL}/health-ingest?token={health.token}&type=steps&date=[Formatted Date]&value=[Health Value]</code>, replacing the two bracketed placeholders with the matching chips.</li>
                <li>Run it once and allow Health access, then add a Personal Automation (e.g. every morning) so it runs on its own.</li>
              </ol>
            </details>
          </>
        )}
      </SettingsSection>

      <SettingsSection title="Danger zone" note="These affect your whole account" danger>
        <div className="account-row">
          <div className="account-row-label">
            <div>Sign out</div>
            <div className="settings-hint">End your session on this device</div>
          </div>
          <button type="button" className="btn-outline" onClick={onSignOut}>Sign out</button>
        </div>

        <div className="account-row">
          <div className="account-row-label">
            <div>Delete account</div>
            <div className="settings-hint">Permanently erases your tasks, budget, habits, and everything else — this can't be undone</div>
          </div>
          {!deleteOpen && (
            <button type="button" ref={deleteTriggerRef} className="btn-danger" aria-expanded={deleteOpen} onClick={() => setDeleteOpen(true)}>
              Delete account
            </button>
          )}
        </div>

        {deleteOpen && (
          <div className="account-delete-confirm">
            <p id="delete-confirm-instructions">
              Type your email (<strong>{userEmail}</strong>) to confirm. Everything you've entered will be gone for good.
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
                {deleteBusy ? "Deleting…" : "Permanently delete"}
              </button>
              <button
                type="button"
                className="header-link-btn"
                onClick={() => { setDeleteOpen(false); setDeleteText(""); setDeleteError(""); }}
                disabled={deleteBusy}
              >
                Cancel
              </button>
            </div>
            {deleteError && <div className="auth-notice" data-c="home" role="alert">{deleteError}</div>}
          </div>
        )}
      </SettingsSection>
    </>
  );
}
