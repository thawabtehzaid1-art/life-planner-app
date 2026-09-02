import { useState, useEffect } from "react";
import { supabase } from "./supabaseClient.js";

// Supabase's raw auth errors are written for developers, not the person
// typing into this form ("Invalid login credentials" doesn't say whether
// the email or the password is wrong, or if the account doesn't exist at
// all). Matched by substring, not error code -- if nothing matches, the
// original message still shows, so this only ever adds clarity, never
// hides a real error.
function friendlyAuthError(message, mode) {
  const m = (message || "").toLowerCase();
  if (m.includes("invalid login credentials")) {
    return "That email and password don't match — double-check them, or use \"Forgot password?\" below.";
  }
  if (m.includes("already registered") || m.includes("already exists")) {
    return "An account with that email already exists — try signing in instead.";
  }
  if (m.includes("email not confirmed")) {
    return "Confirm your email first — check your inbox for the link we sent when you signed up.";
  }
  if (m.includes("password should be at least") || m.includes("password is too short")) {
    return "That password is too short — use at least 6 characters.";
  }
  if (m.includes("rate limit") || m.includes("only request this after")) {
    return "Too many attempts in a row — wait a minute and try again.";
  }
  if (m.includes("failed to fetch") || m.includes("network")) {
    return "Couldn't reach the server — check your connection and try again.";
  }
  return message || (mode === MODES.SIGN_UP ? "Couldn't create your account. Try again." : "Something went wrong. Try again.");
}

const MODES = { SIGN_IN: "sign_in", SIGN_UP: "sign_up", RESET: "reset" };
const PATH_BY_MODE = { [MODES.SIGN_IN]: "/", [MODES.SIGN_UP]: "/signup", [MODES.RESET]: "/forgot-password" };
const MODE_BY_PATH = { "/": MODES.SIGN_IN, "/signup": MODES.SIGN_UP, "/forgot-password": MODES.RESET };
const TITLE_BY_MODE = { [MODES.SIGN_IN]: "Sign in", [MODES.SIGN_UP]: "Create account", [MODES.RESET]: "Reset password" };

// Confirming a fresh sign-up happens by clicking a link in an email client,
// not a same-tab transition -- that link click reloads the whole app,
// which wipes every bit of in-memory React state including whatever was
// just typed into this form. goTo() alone can't fix this (it only swaps
// `mode`, same component instance, state already survives that); the
// email needs to outlive an actual page reload, so localStorage instead.
const PENDING_EMAIL_KEY = "align_pending_signup_email";

export default function Auth() {
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
    document.title = `${TITLE_BY_MODE[mode]} · Align`;
  }, [mode]);

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
        setNotice("Check your email to confirm your account, then sign in.");
        goTo(MODES.SIGN_IN, true);
      } else if (mode === MODES.RESET) {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email);
        if (err) throw err;
        setNotice("Check your email for a password reset link.");
        goTo(MODES.SIGN_IN, true);
      }
    } catch (err) {
      setError(friendlyAuthError(err.message, mode));
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
          {mode === MODES.SIGN_IN && "Sign in"}
          {mode === MODES.SIGN_UP && "Create your account"}
          {mode === MODES.RESET && "Reset your password"}
        </h1>

        {notice && <div className="auth-notice" data-c="health">{notice}</div>}
        {error && <div className="auth-notice" data-c="home">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-form">
          <label className="auth-field">
            <span>Email</span>
            <input
              type="email" required autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          {mode !== MODES.RESET && (
            <label className="auth-field">
              <span>Password</span>
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
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  title={showPassword ? "Hide password" : "Show password"}
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
            {busy ? "Please wait…" : (
              mode === MODES.SIGN_IN ? "Sign in" : mode === MODES.SIGN_UP ? "Create account" : "Send reset link"
            )}
          </button>
          {/* Sets expectations before committing (Fogg Behavior Model —
              ability): a new signup has no idea a guided setup follows, or
              how long it takes, until they're already past the point of
              having handed over a password. Sign-up only, not sign-in — a
              returning user isn't about to see the checklist. */}
          {mode === MODES.SIGN_UP && (
            <p className="auth-hint">Takes about 2 minutes once you're in — a short guided setup, skip anytime.</p>
          )}
        </form>

        <div className="auth-links">
          {mode === MODES.SIGN_IN && (
            <>
              <button type="button" onClick={() => { goTo(MODES.SIGN_UP); setError(""); setNotice(""); }}>
                Need an account? Sign up
              </button>
              <button type="button" onClick={() => { goTo(MODES.RESET); setError(""); setNotice(""); }}>
                Forgot password?
              </button>
            </>
          )}
          {mode !== MODES.SIGN_IN && (
            <button type="button" onClick={() => { goTo(MODES.SIGN_IN); setError(""); setNotice(""); }}>
              Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
