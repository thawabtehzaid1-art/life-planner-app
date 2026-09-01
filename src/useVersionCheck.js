import { useState, useEffect, useCallback } from "react";

// A plain location.reload() isn't reliable here: GitHub Pages has no
// equivalent of vercel.json's no-cache header on index.html, so a normal
// reload can still be served a cached index.html pointing at an old,
// already-superseded JS bundle — the app looks "stuck" even though the
// server has the fix. Unregistering any service worker + clearing Cache
// Storage (belt-and-braces against a leftover worker from before this
// project's service worker was made intentionally cache-free) and then
// navigating to a URL with a fresh query string forces a real network
// fetch of index.html, which is the only thing that actually picks up a
// new build's script tag.
async function hardReload() {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* best effort — the cache-busted navigation below still helps even if this fails */
  }
  window.location.href = window.location.pathname + "?_v=" + Date.now();
}

// True once the server is serving a build newer than the one currently
// running. Deliberately never auto-reloads — an earlier version of this
// hook tried to auto-apply on launch/resume, but that meant guessing
// exactly which browser event means "a fresh, safe-to-reload moment",
// and that guess kept being wrong in ways that cost a real, felt "why did
// this get slower to open" regression (GitHub Pages' CDN lagging a
// deploy by a few minutes while version.json — always fetched no-store —
// already reflects it; a spurious visibilitychange firing right after
// initial load on iOS; etc). A dismissible banner with a real fix behind
// its button (hardReload, not a plain reload) is slower to notice but
// never silently doubles a launch's load time.
export function useVersionCheck() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  const check = useCallback(async () => {
    try {
      const res = await fetch(import.meta.env.BASE_URL + "version.json?t=" + Date.now(), { cache: "no-store" });
      if (!res.ok) return;
      const { version } = await res.json();
      if (version && String(version) !== String(__APP_VERSION__)) setUpdateAvailable(true);
    } catch {
      /* offline, dev server with no version.json yet, etc. — not an error worth surfacing */
    }
  }, []);

  useEffect(() => {
    check();
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    const interval = setInterval(check, 5 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
    };
  }, [check]);

  return { updateAvailable, refresh: hardReload };
}
