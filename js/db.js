/* =========================================================
   IndexedDB
   - kv:     App-Zustand (Projekte, Dokus, Einträge – ohne Bilder)
   - images: Bilder als Blob { id, archive?, thumb? }
   - outbox: PDFs, die noch nach OneDrive hochgeladen werden müssen
========================================================= */
const DB_NAME = "baudoc_db_v1";
const DB_VERSION = 2;

let dbPromise = null;

// Safari: IndexedDB ist direkt nach dem Start manchmal noch nicht bereit und
// "open" antwortet dann nie. Erst warten, bis indexedDB.databases() antwortet.
async function idbReady() {
  if (!indexedDB.databases) return;
  for (let i = 0; i < 20; i++) {
    const ok = await Promise.race([indexedDB.databases().then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), 100))]);
    if (ok) return;
  }
}

export function openDb() {
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
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { clearTimeout(timer); dbPromise = null; reject(req.error); };
    req.onblocked = () => console.warn("IndexedDB: Upgrade blockiert (andere BauDoc-Fenster schließen)");
  });
  return dbPromise;
}

async function tx(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const req = fn(t.objectStore(storeName));
    let result;
    if (req) req.onsuccess = () => { result = req.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const kvGet = (key) => tx("kv", "readonly", (s) => s.get(key));
export const kvSet = (key, val) => tx("kv", "readwrite", (s) => s.put(val, key));

export const imgGet = (id) => tx("images", "readonly", (s) => s.get(id));
export const imgPut = (rec) => tx("images", "readwrite", (s) => s.put(rec));
export const imgDelete = (id) => tx("images", "readwrite", (s) => s.delete(id));
export const imgKeys = () => tx("images", "readonly", (s) => s.getAllKeys());

export const outboxAll = () => tx("outbox", "readonly", (s) => s.getAll());
export const outboxPut = (rec) => tx("outbox", "readwrite", (s) => s.put(rec));
export const outboxDelete = (id) => tx("outbox", "readwrite", (s) => s.delete(id));
