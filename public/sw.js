// Minimal, hand-written service worker. Push notifications are its main
// job (and, as a side effect of merely existing + being registered, it
// helps this app qualify for Android/desktop Chrome's "Install app"
// prompt) — plus one narrow, safe cache: Vite's content-hashed JS/CSS
// bundle (dist/assets/index-<hash>.js etc).
//
// index.html and version.json stay completely untouched by this file —
// they're still served no-cache straight from the network every time (see
// vercel.json + useVersionCheck.js), which is what actually solved iOS's
// aggressive PWA caching earlier this session. The risk that fix was
// guarding against was ever serving a STALE index.html pointing at an old
// script tag. Caching the hashed bundle files themselves can't reintroduce
// that: a new deploy emits new filenames (the hash changes whenever the
// content does), so an old cached bundle just becomes an orphaned, unused
// entry rather than something that could ever be served instead of the
// new one — index.html's own fresh, always-revalidated fetch is what picks
// the filename, this cache only ever saves re-downloading a file whose
// content, by construction, cannot have changed under that exact name.
const ASSET_CACHE = "align-assets-v1";
// Cheap unbounded-growth guard across many deploys, since nothing else
// ever evicts an old hashed filename's entry — most-recently-used trimming
// via delete+re-set (Cache Storage preserves insertion order for keys()),
// not a real LRU, just enough to keep this from growing forever.
const ASSET_CACHE_LIMIT = 20;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== ASSET_CACHE).map((n) => caches.delete(n))),
    ).then(() => self.clients.claim()),
  );
});

function isHashedAsset(url) {
  return url.origin === self.location.origin && /\/assets\/.+/.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || !isHashedAsset(url)) return; // everything else: untouched passthrough, as before

  event.respondWith(
    caches.open(ASSET_CACHE).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const res = await fetch(event.request);
      if (res.ok) {
        const keys = await cache.keys();
        if (keys.length >= ASSET_CACHE_LIMIT) await cache.delete(keys[0]);
        cache.put(event.request, res.clone());
      }
      return res;
    }),
  );
});

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
