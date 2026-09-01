import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabaseClient.js";

// Public by design — VAPID public keys are meant to ship in frontend code
// (see supabase/functions/send-push for the private half, which never is).
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// Real push notifications need three things all present: HTTPS (already
// true in production), a registered service worker (public/sw.js), and a
// VAPID public key configured at build time. `supported` reflects all
// three so the opt-in control can just hide itself otherwise instead of
// failing confusingly.
export function usePushSubscription(userId) {
  const [permission, setPermission] = useState(typeof Notification !== "undefined" ? Notification.permission : "unsupported");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && !!VAPID_PUBLIC_KEY;

  useEffect(() => {
    if (!supported) return;
    // BASE_URL (not a hardcoded "/") so this resolves correctly whether the
    // app is served from the domain root (Vercel) or a subpath (GitHub
    // Pages project sites) — an absolute "/sw.js" 404s on the latter, which
    // leaves serviceWorker.ready hanging forever with no error surfaced.
    navigator.serviceWorker.register(import.meta.env.BASE_URL + "sw.js").catch(() => {});
  }, [supported]);

  useEffect(() => {
    if (!supported) return;
    navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription()).then((sub) => setSubscribed(!!sub)).catch(() => {});
  }, [supported]);

  const subscribe = useCallback(async () => {
    if (!supported || busy) return;
    setBusy(true);
    setError("");
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") { setBusy(false); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      const { error: dbError } = await supabase
        .from("push_subscriptions")
        .upsert(
          { user_id: userId, subscription: sub.toJSON(), updated_at: new Date().toISOString() },
          { onConflict: "endpoint" },
        );
      if (dbError) throw dbError;
      setSubscribed(true);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }, [supported, busy, userId]);

  // Mirror of subscribe(): drops this device's browser subscription and its
  // row in push_subscriptions, so the reminder actually stops arriving
  // instead of the toggle just looking off.
  const unsubscribe = useCallback(async () => {
    if (!supported || busy) return;
    setBusy(true);
    setError("");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await supabase.from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", endpoint);
      }
      setSubscribed(false);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }, [supported, busy, userId]);

  return { supported, permission, subscribed, busy, error, subscribe, unsubscribe };
}
