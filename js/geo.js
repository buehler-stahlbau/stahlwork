/* =========================================================
   Orte & Karte
   - Ortssuche über OpenStreetMap (Nominatim): beim Eintippen des Bauorts
     Vorschläge; die Auswahl legt die Kartenposition (Ortsmitte) fest.
   - Es werden nur Ortsnamen gesendet, keine Bauherren oder Inhalte.
   - Nutzungsregeln: höchstens 1 Anfrage pro Sekunde, Ergebnisse werden gemerkt.
========================================================= */
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
export const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

const cache = new Map();
let lastCall = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function searchPlaces(query) {
  const q = String(query || "").trim();
  if (q.length < 3) return [];
  const key = q.toLowerCase();
  if (cache.has(key)) return cache.get(key);

  const wait = lastCall + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();

  const url = `${NOMINATIM}?format=jsonv2&addressdetails=1&limit=8&featureType=settlement&accept-language=de&q=${encodeURIComponent(q)}`;
  // höchstens 6 s warten (langsames Netz / Dienst nicht erreichbar)
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  let res;
  try { res = await fetch(url, { referrerPolicy: "strict-origin-when-cross-origin", signal: ctl.signal }); }
  catch (e) { throw new Error(e && e.name === "AbortError" ? "Ortssuche antwortet nicht" : "Ortssuche nicht erreichbar"); }
  finally { clearTimeout(t); }
  if (!res.ok) throw new Error(`Ortssuche nicht erreichbar (${res.status})`);
  const data = await res.json();

  const seen = new Set();
  const out = [];
  for (const r of Array.isArray(data) ? data : []) {
    const a = r.address || {};
    const name = String(r.name || a.village || a.town || a.city || a.hamlet || a.municipality || "").trim();
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    if (!name || !isFinite(lat) || !isFinite(lon)) continue;
    const muni = a.city || a.town || a.village || a.municipality;
    const parts = [];
    if (muni && muni !== name) parts.push(muni);
    const region = a.county || a.state_district || a.state;
    if (region && region !== name) parts.push(region);
    if (a.country_code && a.country_code !== "de" && a.country) parts.push(a.country);
    const ctx = parts.join(", ");
    const k = name + "|" + ctx;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ name, ctx, lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5 });
    if (out.length >= 6) break;
  }
  cache.set(key, out);
  return out;
}

// Gilt die gespeicherte Position noch? (nur wenn der Bauort seither nicht geändert wurde)
export function geoValid(p) {
  const g = p && p.geo;
  return !!(g && isFinite(g.lat) && isFinite(g.lon) && Math.abs(g.lat) <= 90 && Math.abs(g.lon) <= 180 && g.place === p.place);
}

export function cleanGeo(g) {
  if (!g || typeof g !== "object") return null;
  const lat = Number(g.lat), lon = Number(g.lon);
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon, place: String(g.place || ""), label: String(g.label || "").slice(0, 200) };
}

/* ---------- Leaflet bei Bedarf laden ---------- */
let leafletPromise = null;
export function loadLeaflet() {
  if (window.L && window.L.map) return Promise.resolve(window.L);
  if (!leafletPromise) {
    leafletPromise = new Promise((resolve, reject) => {
      for (const href of ["vendor/leaflet/leaflet.css", "vendor/leaflet/MarkerCluster.css"]) {
        const css = document.createElement("link");
        css.rel = "stylesheet";
        css.href = href;
        document.head.appendChild(css);
      }
      const load = (src) => new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = src;
        s.onload = res;
        s.onerror = () => rej(new Error("Karte konnte nicht geladen werden"));
        document.head.appendChild(s);
      });
      // Leaflet + Erweiterung zum Gruppieren naher Pins
      load("vendor/leaflet/leaflet.js")
        .then(() => load("vendor/leaflet/leaflet.markercluster.js"))
        .then(() => resolve(window.L))
        .catch((e) => { leafletPromise = null; reject(e); });
    });
  }
  return leafletPromise;
}
