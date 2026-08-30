// Minimal, hand-written service worker — deliberately does NOT precache or
// intercept normal page/asset requests. Its only job is push notifications
// (and, as a side effect of merely existing + being registered, it helps
// this app qualify for Android/desktop Chrome's "Install app" prompt).
//
// Kept intentionally cache-free: useVersionCheck.js + vercel.json's
// no-cache header on index.html are what already solved iOS's aggressive
// PWA caching earlier this session. A service worker that also cached the
// app shell would reintroduce that exact bug, so this one doesn't.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// No fetch handler that serves cached responses — every request just goes
// to the network as if there were no service worker at all. (Some browsers
// want *a* fetch listener present for installability; this one exists but
// intentionally does nothing but pass the request through.)
self.addEventListener("fetch", () => {});

// This file is a static asset (not processed by Vite), so it can't read
// import.meta.env.BASE_URL like the rest of the app — but its own script
// location already reflects wherever it was registered from (domain root
// on Vercel, "/life-planner-app/" on GitHub Pages), so deriving "here" from
// self.location works the same way BASE_URL does elsewhere.
const BASE = self.location.pathname.replace(/sw\.js$/, "");

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { title: "Align", body: event.data ? event.data.text() : "" }; }
  const title = payload.title || "Align";
  const options = {
    body: payload.body || "",
    icon: BASE + "icon-192.png",
    badge: BASE + "icon-192.png",
    data: { url: payload.url || BASE },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || BASE;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    }),
  );
});
