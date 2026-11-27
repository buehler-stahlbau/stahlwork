/* =========================================================
   Service Worker – App funktioniert auch ohne Netz.
   Strategie: erst Netz (damit Updates sofort ankommen),
   bei fehlendem Netz der zwischengespeicherte Stand.
   Bei jeder neuen Version CACHE hochzählen.
========================================================= */
const CACHE = "stahlwork-3.18.4-beta-1";
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
  "./js/boot.js",
  "./js/baumon.js",
  "./js/baumon-ui.js",
  "./js/baumon-pdf.js",
  "./js/camera.js",
  "./js/config.js",
  "./js/db.js",
  "./js/geo.js",
  "./js/images.js",
  "./js/integrity.js",
  "./js/onedrive.js",
  "./js/pdf.js",
  "./js/zip.js",
  "./js/draw.js",
  "./js/signature.js",
  "./js/store.js",
  "./js/sync.js",
  "./js/util.js",
];

// Installation: alle App-Dateien dieser Version frisch vom Server (nicht aus dem Browser-Zwischenspeicher)
// Prüft dabei, dass Startseite und Programm wirklich dieselbe Version haben (direkt nach einer
// Veröffentlichung kann der Server kurz noch alte Dateien liefern) – sonst später erneut versuchen.
const VERSION = CACHE.replace(/^stahlwork-/, "").replace(/-\d+$/, "");
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const tmp = await caches.open(CACHE);
    await tmp.addAll(ASSETS.map((u) => new Request(u, { cache: "reload" })));
    const page = await (await tmp.match("./index.html")).text();
    const conf = await (await tmp.match("./js/config.js")).text();
    if (!page.includes(`content="${VERSION}"`) || !conf.includes(`"${VERSION}"`)) {
      await caches.delete(CACHE);
      throw new Error("Server liefert noch nicht die vollständige neue Version");
    }
    await self.skipWaiting();
  })());
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

// Abruf: App-Dateien immer aus dem Speicher DIESER Version (passen garantiert zusammen).
// Neue Versionen kommen über einen neuen Service Worker (Hinweis "Jetzt aktualisieren").
// Alles andere: erst Netz, ohne Netz aus dem Speicher.
const ASSET_PATHS = new Set(ASSETS.map((u) => new URL(u, self.location).pathname));
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Microsoft/OneDrive nie abfangen

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Startseite der App (nicht z. B. diag.html) kommt aus dem Speicher dieser Version
    const isNav = req.mode === "navigate" && /\/(index\.html)?$/.test(url.pathname);
    const isAsset = isNav || ASSET_PATHS.has(url.pathname);
    if (isAsset) {
      const hit = await cache.match(isNav ? "./index.html" : req, { ignoreSearch: true });
      if (hit) return hit;
    }
    try {
      const res = await Promise.race([fetch(req, { cache: "no-cache" }), timeout(30000)]);
      if (res && res.ok && !isAsset) cache.put(req, res.clone());
      return res;
    } catch (e) {
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) return cached;
      throw e;
    }
  })());
});
