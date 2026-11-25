/* =========================================================
   IndexedDB
   - kv:     App-Zustand (Projekte, Dokus, Einträge – ohne Bilder)
   - images: Bilder als Blob { id, archive?, thumb? }
   - outbox: PDFs, die noch nach OneDrive hochgeladen werden müssen
========================================================= */
// Name des Gerätespeichers. Ausweichspeicher, falls Safari den bisherigen nicht mehr öffnet
// (der alte bleibt unangetastet erhalten).
const DB_DEFAULT = "baudoc_db_v1";
const DB_NAME = (() => { try { return localStorage.getItem("stahlwork-db") || DB_DEFAULT; } catch { return DB_DEFAULT; } })();
const DB_VERSION = 2;
export const dbName = DB_NAME;

// Prüft, ob Safari überhaupt einen (neuen) Gerätespeicher öffnen kann
export function probeDb(name, ms = 5000) {
  return new Promise((resolve) => {
    let done = false;
    const fin = (ok, why) => { if (!done) { done = true; resolve({ ok, why }); } };
    setTimeout(() => fin(false, "keine Antwort"), ms);
    try {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => { try { req.result.createObjectStore("t"); } catch {} };
      req.onsuccess = () => { try { req.result.close(); } catch {} fin(true); };
      req.onerror = () => fin(false, String(req.error && req.error.message || req.error));
    } catch (e) { fin(false, e.message); }
  });
}

let dbPromise = null;
// Speicher hängt (Safari): weitere Zugriffe sofort ablehnen statt jedes Mal 8 s zu warten.
// Ein Hintergrund-Versuch (force) prüft später, ob er wieder geht.
let dead = false;
export function markDead(v) { dead = v; if (v) dbPromise = null; }
export const isDead = () => dead;

// Safari: IndexedDB ist direkt nach dem Start manchmal noch nicht bereit und
// "open" antwortet dann nie. Erst warten, bis indexedDB.databases() antwortet.
async function idbReady() {
  if (!indexedDB.databases) return;
  for (let i = 0; i < 20; i++) {
    const ok = await Promise.race([indexedDB.databases().then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), 100))]);
    if (ok) return;
  }
}

export function openDb(force = false) {
  if (dead && !force) return Promise.reject(new Error("Gerätespeicher gerade nicht erreichbar"));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(async (resolve, reject) => {
    try { await idbReady(); } catch {}
    // nie endlos warten
    const timer = setTimeout(() => { dbPromise = null; reject(new Error("Gerätespeicher antwortet nicht")); }, 8000);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("images")) db.createObjectStore("images", { keyPath: "id" });
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "id" });
    };
    req.onsuccess = () => {
      clearTimeout(timer);
      dead = false;
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { clearTimeout(timer); dbPromise = null; reject(req.error); };
    req.onblocked = () => console.warn("IndexedDB: Upgrade blockiert (andere BauDoc-Fenster schließen)");
  });
  return dbPromise;
}

// Jeder Zugriff mit Zeitlimit: Safari lässt Vorgänge manchmal einfach hängen –
// dann nicht endlos warten (z. B. „synchronisiert ewig“), sondern als hängend markieren.
async function tx(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { markDead(true); reject(new Error("Gerätespeicher antwortet nicht")); }, 10000);
    let t;
    try { t = db.transaction(storeName, mode); } catch (e) { clearTimeout(timer); dbPromise = null; reject(e); return; }
    const req = fn(t.objectStore(storeName));
    let result;
    if (req) req.onsuccess = () => { result = req.result; };
    t.oncomplete = () => { clearTimeout(timer); resolve(result); };
    t.onerror = () => { clearTimeout(timer); reject(t.error); };
    t.onabort = () => { clearTimeout(timer); reject(t.error); };
  });
}

export const kvGet = (key) => tx("kv", "readonly", (s) => s.get(key));
export const kvSet = (key, val) => tx("kv", "readwrite", (s) => s.put(val, key));
export const kvDelete = (key) => tx("kv", "readwrite", (s) => s.delete(key));

export const imgGet = (id) => tx("images", "readonly", (s) => s.get(id));
export const imgPut = (rec) => tx("images", "readwrite", (s) => s.put(rec));
export const imgDelete = (id) => tx("images", "readwrite", (s) => s.delete(id));
export const imgKeys = () => tx("images", "readonly", (s) => s.getAllKeys());

export const outboxAll = () => tx("outbox", "readonly", (s) => s.getAll());
export const outboxPut = (rec) => tx("outbox", "readwrite", (s) => s.put(rec));
export const outboxDelete = (id) => tx("outbox", "readwrite", (s) => s.delete(id));
