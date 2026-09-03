import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "./supabaseClient.js";

// Supabase's raw auth errors are written for developers, not the person
// typing into this form ("Invalid login credentials" doesn't say whether
// the email or the password is wrong, or if the account doesn't exist at
// all). Matched by substring, not error code -- if nothing matches, the
// original message still shows, so this only ever adds clarity, never
// hides a real error.
function friendlyAuthError(message, mode, t) {
  const m = (message || "").toLowerCase();
  if (m.includes("invalid login credentials")) return t("auth.error.invalidCredentials");
  if (m.includes("already registered") || m.includes("already exists")) return t("auth.error.alreadyRegistered");
  if (m.includes("email not confirmed")) return t("auth.error.emailNotConfirmed");
  if (m.includes("password should be at least") || m.includes("password is too short")) return t("auth.error.passwordTooShort");
  if (m.includes("rate limit") || m.includes("only request this after")) return t("auth.error.rateLimit");
  if (m.includes("failed to fetch") || m.includes("network")) return t("auth.error.network");
  return message || (mode === MODES.SIGN_UP ? t("auth.error.genericSignUp") : t("auth.error.genericSignIn"));
}

const MODES = { SIGN_IN: "sign_in", SIGN_UP: "sign_up", RESET: "reset" };
const PATH_BY_MODE = { [MODES.SIGN_IN]: "/", [MODES.SIGN_UP]: "/signup", [MODES.RESET]: "/forgot-password" };
const MODE_BY_PATH = { "/": MODES.SIGN_IN, "/signup": MODES.SIGN_UP, "/forgot-password": MODES.RESET };
const TITLE_KEY_BY_MODE = { [MODES.SIGN_IN]: "auth.title.signIn", [MODES.SIGN_UP]: "auth.title.signUpShort", [MODES.RESET]: "auth.title.reset" };

// Confirming a fresh sign-up happens by clicking a link in an email client,
// not a same-tab transition -- that link click reloads the whole app,
// which wipes every bit of in-memory React state including whatever was
// just typed into this form. goTo() alone can't fix this (it only swaps
// `mode`, same component instance, state already survives that); the
// email needs to outlive an actual page reload, so localStorage instead.
const PENDING_EMAIL_KEY = "align_pending_signup_email";

export default function Auth() {
  const { t } = useTranslation();
  const [mode, setMode] = useState(() => MODE_BY_PATH[window.location.pathname] ?? MODES.SIGN_IN);
  const [email, setEmail] = useState(() => {
    try { return localStorage.getItem(PENDING_EMAIL_KEY) || ""; } catch { return ""; }
  });
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Keep the URL in sync with which auth screen is showing, so back/forward
  // and bookmarking a link to e.g. /signup land on the right screen instead
  // of always reloading into sign-in.
  function goTo(nextMode, replace = false) {
    const path = PATH_BY_MODE[nextMode] || "/";
    if (replace) window.history.replaceState(null, "", path);
    else window.history.pushState(null, "", path);
    setMode(nextMode);
  }

  useEffect(() => {
    function onPopState() {
      setMode(MODE_BY_PATH[window.location.pathname] ?? MODES.SIGN_IN);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    document.title = `${t(TITLE_KEY_BY_MODE[mode])} · Align`;
  }, [mode, t]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      if (mode === MODES.SIGN_IN) {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        try { localStorage.removeItem(PENDING_EMAIL_KEY); } catch { /* private mode */ }
      } else if (mode === MODES.SIGN_UP) {
        const { error: err } = await supabase.auth.signUp({ email, password });
        if (err) throw err;
        try { localStorage.setItem(PENDING_EMAIL_KEY, email); } catch { /* private mode */ }
        setNotice(t("auth.notice.signUpCheckEmail"));
        goTo(MODES.SIGN_IN, true);
      } else if (mode === MODES.RESET) {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email);
        if (err) throw err;
        setNotice(t("auth.notice.resetCheckEmail"));
        goTo(MODES.SIGN_IN, true);
      }
    } catch (err) {
      setError(friendlyAuthError(err.message, mode, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="brand-row" style={{ justifyContent: "center", marginBottom: "var(--space-6)" }}>
          <div className="brand-dot" />
          <div className="brand-name">Align</div>
        </div>

        <h1 className="auth-title">
          {mode === MODES.SIGN_IN && t("auth.title.signIn")}
          {mode === MODES.SIGN_UP && t("auth.title.signUp")}
          {mode === MODES.RESET && t("auth.title.reset")}
        </h1>

        {notice && <div className="auth-notice" data-c="health">{notice}</div>}
        {error && <div className="auth-notice" data-c="home">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-form">
          <label className="auth-field">
            <span>{t("auth.email")}</span>
            <input
              type="email" required autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          {mode !== MODES.RESET && (
            <label className="auth-field">
              <span>{t("auth.password")}</span>
              <div className="password-field">
                <input
                  type={showPassword ? "text" : "password"} required minLength={6}
                  autoComplete={mode === MODES.SIGN_UP ? "new-password" : "current-password"}
                  value={password} onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-pressed={showPassword}
                  aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                  title={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                >
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.8 21.8 0 0 1 5.06-6.06M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a21.77 21.77 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </label>
          )}

          <button type="submit" className="btn-solid auth-submit" disabled={busy}>
            {busy ? t("auth.pleaseWait") : (
              mode === MODES.SIGN_IN ? t("auth.submitSignIn") : mode === MODES.SIGN_UP ? t("auth.submitSignUp") : t("auth.submitReset")
            )}
          </button>
          {/* Sets expectations before committing (Fogg Behavior Model —
              ability): a new signup has no idea a guided setup follows, or
              how long it takes, until they're already past the point of
              having handed over a password. Sign-up only, not sign-in — a
              returning user isn't about to see the checklist. */}
          {mode === MODES.SIGN_UP && (
            <p className="auth-hint">{t("auth.setupHint")}</p>
          )}
        </form>

        <div className="auth-links">
          {mode === MODES.SIGN_IN && (
            <>
              <button type="button" onClick={() => { goTo(MODES.SIGN_UP); setError(""); setNotice(""); }}>
                {t("auth.needAccount")}
              </button>
              <button type="button" onClick={() => { goTo(MODES.RESET); setError(""); setNotice(""); }}>
                {t("auth.forgotPassword")}
              </button>
            </>
          )}
          {mode !== MODES.SIGN_IN && (
            <button type="button" onClick={() => { goTo(MODES.SIGN_IN); setError(""); setNotice(""); }}>
              {t("auth.backToSignIn")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
