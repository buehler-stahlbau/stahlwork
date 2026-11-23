/* =========================================================
   Service Worker – App funktioniert auch ohne Netz.
   Strategie: erst Netz (damit Updates sofort ankommen),
   bei fehlendem Netz der zwischengespeicherte Stand.
   Bei jeder neuen Version CACHE hochzählen.
========================================================= */
const CACHE = "stahlwork-3.8.3-beta-1";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./logo.png",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
  "./favicon.svg",
  "./sparte-baudoc.svg",
  "./sparte-baumon.svg",
  "./app-logo.svg",
  "./favicon-16.png",
  "./favicon-32.png",
  "./favicon-48.png",
  "./vendor/jspdf.umd.min.js",
  "./vendor/msal-browser.min.js",
  "./vendor/leaflet/leaflet.js",
  "./vendor/leaflet/leaflet.css",
  "./vendor/leaflet/leaflet.markercluster.js",
  "./vendor/leaflet/MarkerCluster.css",
  "./vendor/pdf.min.js",
  "./vendor/pdf.worker.min.js",
  "./js/app.js",
  "./js/backup.js",
  "./js/camera.js",
  "./js/config.js",
  "./js/db.js",
  "./js/geo.js",
  "./js/images.js",
  "./js/integrity.js",
  "./js/onedrive.js",
  "./js/pdf.js",
  "./js/signature.js",
  "./js/store.js",
  "./js/sync.js",
  "./js/util.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => (k.startsWith("stahlwork-") || k.startsWith("baudoc-")) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Microsoft/OneDrive nie abfangen

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    try {
      // "no-cache": beim Server nachfragen, ob es eine neuere Fassung gibt (sonst bis zu 10 Min. alter Stand)
      const res = await Promise.race([fetch(req, { cache: "no-cache" }), timeout(cached ? 4000 : 30000)]);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch (e) {
      if (cached) return cached;
      if (req.mode === "navigate") {
        const index = await cache.match("./index.html");
        if (index) return index;
      }
      throw e;
    }
  })());
});
