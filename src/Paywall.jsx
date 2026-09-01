import { useState } from "react";
import { supabase } from "./supabaseClient.js";

function daysLeft(trialEndsAt) {
  if (!trialEndsAt) return 0;
  const ms = new Date(trialEndsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
}

export default function Paywall({ subscription, onSignOut }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const trialing = subscription?.status === "trialing";
  const left = trialing ? daysLeft(subscription.trial_ends_at) : 0;

  async function handleSubscribe() {
    setBusy(true);
    setError("");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const { data, error: fnError } = await supabase.functions.invoke("create-checkout-session", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (fnError) throw fnError;
      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No checkout URL returned.");
      }
    } catch (err) {
      setError(err.message || "Could not start checkout. Try again.");
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

        {trialing ? (
          <>
            <h1 className="auth-title">
              {left > 0 ? `${left} day${left === 1 ? "" : "s"} left in your trial` : "Your trial has ended"}
            </h1>
            <p className="auth-body">
              Subscribe to keep your tasks, budget, meals, and habits syncing across every device.
            </p>
          </>
        ) : (
          <>
            <h1 className="auth-title">Subscription needed</h1>
            <p className="auth-body">
              Your subscription is {subscription?.status || "inactive"}. Subscribe to get back in.
            </p>
          </>
        )}

        {error && <div className="auth-notice" data-c="home">{error}</div>}

        <button className="btn-outline auth-submit" onClick={handleSubscribe} disabled={busy}>
          {busy ? "Redirecting…" : "Subscribe"}
        </button>

        <div className="auth-links">
          <button type="button" onClick={onSignOut}>Sign out</button>
        </div>
      </div>
    </div>
  );
}
