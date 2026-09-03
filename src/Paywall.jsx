import { useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "./supabaseClient.js";

function daysLeft(trialEndsAt) {
  if (!trialEndsAt) return 0;
  const ms = new Date(trialEndsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
}

export default function Paywall({ subscription, onSignOut }) {
  const { t } = useTranslation();
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
      setError(err.message || t("paywall.checkoutError"));
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
              {left > 0 ? t("paywall.trialDaysLeft", { count: left }) : t("paywall.trialEnded")}
            </h1>
            <p className="auth-body">
              {t("paywall.subscribeBody")}
            </p>
          </>
        ) : (
          <>
            <h1 className="auth-title">{t("paywall.subscriptionNeeded")}</h1>
            <p className="auth-body">
              {t("paywall.subscriptionStatus", { status: t("account.plan.status." + (subscription?.status || "inactive"), { defaultValue: subscription?.status || t("paywall.inactive") }) })}
            </p>
          </>
        )}

        {error && <div className="auth-notice" data-c="home">{error}</div>}

        <button className="btn-solid auth-submit" onClick={handleSubscribe} disabled={busy}>
          {busy ? t("paywall.redirecting") : t("paywall.subscribe")}
        </button>

        <div className="auth-links">
          <button type="button" onClick={onSignOut}>{t("account.danger.signOut")}</button>
        </div>
      </div>
    </div>
  );
}
