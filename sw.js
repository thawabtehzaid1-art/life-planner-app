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

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { title: "Life Planner", body: event.data ? event.data.text() : "" }; }
  const title = payload.title || "Life Planner";
  const options = {
    body: payload.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: payload.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    }),
  );
});
