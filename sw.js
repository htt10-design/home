// Service Worker: hält die App-Dateien offline vor und umgeht den starken /local/-Cache von HA.
// Die Versionsnummer steht in version.js. Neue Version → neuer Cache → alle Dateien frisch vom Server.
importScripts("version.js");
const CACHE = "zuhause-" + self.ZUHAUSE_VERSION;

const FILES = [
  "index.html", "version.js", "manifest.webmanifest", "css/app.css",
  "js/app.js", "js/ha.js", "js/store.js", "js/model.js", "js/physik.js", "js/chart.js", "js/verlauf.js", "js/waechter.js", "js/ui.js", "js/settings.js",
  "js/views/haus.js", "js/views/raum.js", "js/views/klima.js", "js/views/geraete.js", "js/views/hinweise.js", "js/views/einstellungen.js", "js/views/blick.js", "js/views/blick-geraet.js",
  "fonts/archivo-latin.woff2", "fonts/plexmono-400-latin.woff2", "fonts/plexmono-500-latin.woff2",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png",
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: "reload" = am HTTP-Cache vorbei direkt vom Server holen
    await Promise.all(FILES.map(async f => {
      const res = await fetch(new Request(f, { cache: "reload" }));
      if (!res.ok) throw new Error(f + " " + res.status);
      await cache.put(f, res);
    }));
    // Erstinstallation: sofort aktiv. Bei Updates wartet der neue SW, bis die App „Jetzt laden“ sagt.
    if (!self.registration.active) self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("zuhause-") && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("message", e => { if (e.data === "skipWaiting") self.skipWaiting(); });

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return; // HA-API etc. nie anfassen
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req.mode === "navigate" ? "index.html" : req, { ignoreSearch: true });
    return hit || fetch(req);
  })());
});
