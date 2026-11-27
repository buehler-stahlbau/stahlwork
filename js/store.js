/* =========================================================
   App-Zustand
   Projekt (Bauvorhaben):
   {
     id, number: "12345", title: "Neubau Lagerhalle",
     fav,                  // Favorit = komplett auf diesem Gerät
     docs: [...] | null,   // null = nur Name bekannt, Inhalt liegt online
     deletedDocs: [{id, at}],   // gelöschte Dokus (für Abgleich mehrerer Geräte)
     pendingDeletes: [itemId],  // OneDrive-Dateien/Ordner, die noch gelöscht werden müssen
     moveTo: "archive" | "active" | null,
     remote: { folderId, baseName, etag },
     updatedAt, rev, dirty
   }
   Doku:    { id, title, date, updatedAt, remote: {folderId, baseName, bilderId}, entries: [...] }
   Eintrag: { id, description, images: [{ id, rid? }] }   // rid = OneDrive-Datei-ID
========================================================= */
import * as db from "./db.js";
import { newId, toast } from "./util.js";
import { dataUrlToBlob, makeThumb } from "./images.js";
import { contentCode, isSafeSig } from "./integrity.js";
import { cleanGeo } from "./geo.js";

function defaultState() {
  return {
    version: 2,
    projects: [],
    archivedProjects: [],
    view: "projects", // "projects" | "favorites" | "archive" | "settings"
    selectedProjectId: null,
    selectedDocId: null,
    remote: { rootId: null, pendingFolderDeletes: [] },
    prefs: { favUpdatedAt: 0, rev: 0, dirty: false }, // Favoriten je Nutzer
    accountId: null,
    sparte: "doc", // "doc" = BauDoc, "mon" = BauMon, "kon" = BauKon
    rights: null,      // eigene Rechte in der gemeinsamen Ablage { doc, mon, admin }
    rightsData: null,  // Rechte-Datei (für Verwalter)
    rightsDirty: false,
  };
}

export const S = { state: defaultState() };

/* ---------- Änderungs-Benachrichtigung ---------- */
const listeners = new Set();
export function onChange(fn) { listeners.add(fn); }
function emit(kind) {
  listeners.forEach((fn) => { try { fn(kind); } catch (e) { console.error(e); } });
}

/* ---------- Laden / Speichern ----------
   Der App-Stand liegt doppelt: im Gerätespeicher (IndexedDB) und als Sicherung im
   localStorage. Safari öffnet IndexedDB gelegentlich nicht (hängt) – dann startet die App
   mit der Sicherung, ohne Datenverlust und ohne „Zurücksetzen“. */
const LS_STATE = "stahlwork-state";
function lsRead() {
  try { const t = localStorage.getItem(LS_STATE); return t ? JSON.parse(t) : null; } catch (e) { console.warn("Sicherung nicht lesbar", e); return null; }
}
let lsWarned = false;
function lsWrite(json) {
  try { localStorage.setItem(LS_STATE, json); return true; }
  catch (e) {
    // zu groß / voll: alte Sicherung entfernen, damit sie nicht veraltet gelesen wird
    try { localStorage.removeItem(LS_STATE); } catch {}
    if (!lsWarned) { lsWarned = true; console.warn("Sicherung im localStorage nicht möglich", e); }
    return false;
  }
}
export async function load() {
  let saved = null;
  const backup = lsRead();
  // "Gespeicherten Stand zurücksetzen" (nach unlesbarem Stand): vor dem Lesen löschen
  let reset = false;
  try { reset = localStorage.getItem("stahlwork-reset-state") === "1"; } catch {}
  if (reset) {
    try { localStorage.removeItem(LS_STATE); } catch {}
    try {
      await Promise.race([db.kvDelete("state"), new Promise((_, rej) => setTimeout(() => rej(new Error("keine Antwort")), 8000))]);
      try { localStorage.removeItem("stahlwork-reset-state"); } catch {}
    } catch (e) {
      try { localStorage.removeItem("stahlwork-reset-state"); } catch {}
      S.loadFailed = true;
      throw new Error("Zurücksetzen nicht möglich: " + e.message);
    }
  }
  try {
    saved = await Promise.race([db.kvGet("state"), new Promise((_, rej) => setTimeout(() => rej(new Error("Gerätespeicher antwortet nicht")), 10000))]);
    // seit 3.10.9 als Text gespeichert (robuster in Safari); ältere Stände sind Objekte
    if (typeof saved === "string") saved = JSON.parse(saved);
    // Wurde zwischenzeitlich ohne Gerätespeicher gestartet: alten Stand dort als Rettungskopie behalten
    let keep = false; try { keep = localStorage.getItem("stahlwork-idb-keep") === "1"; } catch {}
    if (keep && saved) {
      try { await db.kvSet("state_rescue_" + Date.now(), JSON.stringify(saved)); localStorage.removeItem("stahlwork-idb-keep"); } catch (e) { console.warn("Rettungskopie", e); }
    }
    // Sicherung ist neuer (z. B. weil der Gerätespeicher zuletzt hing) -> Sicherung nehmen
    if (backup && (!saved || (backup.savedAt || 0) >= (saved.savedAt || 0))) saved = backup;
  } catch (e) {
    console.warn("Konnte Zustand nicht laden", e);
    let fresh = false; try { fresh = localStorage.getItem("stahlwork-fresh") === "1"; localStorage.removeItem("stahlwork-fresh"); } catch {}
    if (backup && !reset) {
      // Gerätespeicher hängt: mit der Sicherung weiterarbeiten (Fotos ggf. erst nach Neustart)
      saved = backup;
      S.storageDegraded = (e && e.message) || String(e);
      db.markDead(true);
    } else if (fresh) {
      // „Ohne Gerätespeicher starten“: leer starten, Daten kommen aus OneDrive.
      // Der alte Stand im Gerätespeicher bleibt unangetastet (später als Rettungskopie gesichert).
      saved = null;
      S.storageDegraded = (e && e.message) || String(e);
      db.markDead(true);
      try { localStorage.setItem("stahlwork-idb-keep", "1"); } catch {}
    } else {
      // NICHT mit leerem Zustand weitermachen – sonst würden die Daten auf dem Gerät überschrieben
      S.loadFailed = true;
      throw e;
    }
  }

  if (saved && typeof saved === "object") {
    let migrated = false;
    if (!saved.version || saved.version < 2) {
      saved = await migrateV1(saved);
      migrated = true;
    }
    const def = defaultState();
    S.state = Object.assign(def, saved);
    S.state.remote = Object.assign(defaultState().remote, saved.remote || {});
    S.state.prefs = Object.assign(defaultState().prefs, saved.prefs || {});
    if (!["doc", "mon", "kon"].includes(S.state.sparte)) S.state.sparte = "doc";
    for (const k of ["codeIndex", "codeIndexPending"]) {
      if (!S.state[k] || typeof S.state[k] !== "object" || Array.isArray(S.state[k])) S.state[k] = {};
    }
    if (!Array.isArray(S.state.mapRemove)) S.state.mapRemove = [];
    const MON_VIEWS = ["mon", "monplan", "monbuehnen", "monpersonal"];
    if (S.state.view === "monstamm") { S.state.sparte = "mon"; S.state.view = S.state.monStamm === "vermieter" ? "monbuehnen" : "monpersonal"; } // früher: Stammdaten in den Einstellungen
    const KON_VIEWS = ["konplan", "konpersonal"];
    if (!["projects", "favorites", "map", "archive", "settings", ...MON_VIEWS, ...KON_VIEWS].includes(S.state.view)) S.state.view = "projects";
    if (S.state.sparte === "doc" && [...MON_VIEWS, ...KON_VIEWS].includes(S.state.view)) S.state.view = "projects";
    if (S.state.sparte === "kon" && !KON_VIEWS.includes(S.state.view) && !["settings", "map"].includes(S.state.view)) S.state.view = "konplan";
    if (S.state.sparte === "mon" && KON_VIEWS.includes(S.state.view)) S.state.view = "mon";
    if (S.state.sparte === "mon" && !MON_VIEWS.includes(S.state.view) && !["settings", "map"].includes(S.state.view)) S.state.view = "mon";
    allProjects().forEach(normalizeProject);
    if (migrated) await saveNow();
  }
  // ohne Gerätespeicher gestartet: Sicherung sofort anlegen (übersteht Neustart/Anmeldung)
  if (S.storageDegraded) await saveNow();
}

let saveTimer = null;
let saveErrorShown = false;

export async function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (S.loadFailed) return false; // Gerätespeicher nicht gelesen -> nichts überschreiben
  S.state.savedAt = Date.now();
  const json = JSON.stringify(S.state);
  const lsOk = lsWrite(json); // Sicherung (synchron, auch wenn der Gerätespeicher hängt)
  try {
    // als Text speichern: Safari kann gespeicherte Objekte in seltenen Fällen nicht mehr lesen
    await db.kvSet("state", json);
    saveErrorShown = false;
    return true;
  } catch (e) {
    console.warn("Konnte Zustand nicht speichern", e);
    if (lsOk) return true; // Sicherung hat geklappt -> nichts verloren
    if (!saveErrorShown) {
      saveErrorShown = true;
      toast("Speichern fehlgeschlagen! Speicher voll oder Privater Modus?", "error", 10000);
    }
    return false;
  }
}

export function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 200);
}

export function hasPendingSave() { return saveTimer !== null; }

/* ---------- Änderungen markieren ---------- */
export function touchProject(p) {
  p.updatedAt = Date.now();
  p.rev = (p.rev || 0) + 1;
  p.dirty = true;
  saveSoon();
  emit("data");
}

export function touchDoc(p, d) {
  d.updatedAt = Date.now();
  p.rev = (p.rev || 0) + 1;
  p.dirty = true;
  saveSoon();
  emit("data");
}

// Favoriten gehören zum Nutzer und werden über OneDrive auf alle seine Geräte verteilt
// Änderungen je Eintrag / Kopfdaten / Teilnehmer merken (für das Zusammenführen beim Abgleich)
export function touchEntry(p, d, e) { e.updatedAt = Date.now(); touchDoc(p, d); }
export function touchMeta(p, d) { d.metaAt = Date.now(); touchDoc(p, d); }
export function touchAttendee(p, d, a) { a.updatedAt = Date.now(); touchDoc(p, d); }
export function deleteEntry(p, d, id) {
  d.entries = d.entries.filter((x) => x.id !== id);
  d.deletedEntries = [...(d.deletedEntries || []).filter((t) => t.id !== id), { id, at: Date.now() }];
  touchDoc(p, d);
}
export function deleteAttendee(p, d, id) {
  d.protocol.attendees = d.protocol.attendees.filter((x) => x.id !== id);
  d.deletedAtt = [...(d.deletedAtt || []).filter((t) => t.id !== id), { id, at: Date.now() }];
  touchDoc(p, d);
}

export function favoritesChanged() {
  const pr = S.state.prefs;
  pr.favUpdatedAt = Date.now();
  pr.rev = (pr.rev || 0) + 1;
  pr.dirty = true;
  saveSoon();
}

// Alles Lokale entfernen (z. B. bei Wechsel auf ein anderes Konto). OneDrive bleibt unberührt.
export async function resetLocal() {
  const keep = { view: "projects", accountId: S.state.accountId };
  S.state = Object.assign(defaultState(), keep);
  try { for (const k of await db.imgKeys()) await db.imgDelete(k); } catch {}
  try { for (const o of await db.outboxAll()) await db.outboxDelete(o.id); } catch {}
  await saveNow();
}

/* ---------- Zugriff ---------- */
export function allProjects() {
  return [...S.state.projects, ...S.state.archivedProjects];
}
export function findProject(id) {
  return S.state.projects.find((p) => p.id === id) || null;
}
export function findByNumber(num) {
  return allProjects().find((p) => p.number === num) || null;
}
export function isActive(p) {
  return S.state.projects.includes(p);
}
export function moveLocal(p, loc) {
  const st = S.state;
  st.projects = st.projects.filter((x) => x !== p);
  st.archivedProjects = st.archivedProjects.filter((x) => x !== p);
  (loc === "archive" ? st.archivedProjects : st.projects).push(p);
  if (loc === "archive" && st.selectedProjectId === p.id) {
    st.selectedProjectId = null;
    st.selectedDocId = null;
  }
}

// Name für „erstellt von“ in PDFs (Microsoft-Profil, sonst Anmeldekonto)
export function creatorName(account) {
  const p = (S.state && S.state.prefs && S.state.prefs.profile) || {};
  return String(p.name || (account && account.name) || "").trim();
}

export function imagesOfDoc(d) {
  const out = [];
  for (const e of d.entries || []) for (const i of e.images || []) out.push(i);
  return out;
}
export function imagesOfProject(p) {
  const out = [];
  for (const d of p.docs || []) out.push(...imagesOfDoc(d));
  return out;
}

export async function removeProjectLocal(p) {
  const st = S.state;
  st.projects = st.projects.filter((x) => x !== p);
  st.archivedProjects = st.archivedProjects.filter((x) => x !== p);
  if (st.selectedProjectId === p.id) {
    st.selectedProjectId = null;
    st.selectedDocId = null;
  }
  for (const img of imagesOfProject(p)) {
    try { await db.imgDelete(img.id); } catch {}
  }
}

// Bezeichnung = "Bauherr/Auftraggeber, Bauort"
export function joinTitle(client, place) {
  return [client, place].map((x) => String(x || "").trim()).filter(Boolean).join(", ");
}
export function splitTitle(title) {
  const t = String(title || "");
  const i = t.indexOf(",");
  return i < 0 ? { client: t.trim(), place: "" } : { client: t.slice(0, i).trim(), place: t.slice(i + 1).trim() };
}
export function setTitleParts(p, client, place) {
  p.client = String(client || "").trim().replace(/\s+/g, " ");
  p.place = String(place || "").trim().replace(/\s+/g, " ");
  p.title = joinTitle(p.client, p.place);
}

// Interne Kennung: normalerweise die BV-Nummer; ist sie schon vergeben
// (z. B. weil ein BV umnummeriert wurde), eine neue eindeutige Kennung.
export function uniqueProjectId(number) {
  return allProjects().some((x) => x.id === number) ? newId() : number;
}

// BV-Nummer ändern. Rückgabe: Fehlermeldung oder null
export function renumberProject(p, number) {
  number = String(number || "").trim();
  if (!/^\d{5}$/.test(number)) return "Die BV-Nummer muss 5-stellig sein (nur Ziffern).";
  if (number === p.number) return null;
  const ex = findByNumber(number);
  if (ex && ex !== p) {
    const where = S.state.archivedProjects.includes(ex) ? " (im Archiv)" : "";
    return `BV ${number} existiert bereits${where}: ${ex.number} ${ex.title}`;
  }
  p.number = number;
  touchProject(p);
  return null;
}

export function newProject(number, client, place) {
  const p = {
    id: uniqueProjectId(number), number, title: "", client: "", place: "", fav: true,
    docs: [], deletedDocs: [], pendingDeletes: [], moveTo: null,
    remote: {}, updatedAt: Date.now(), rev: 1, dirty: true,
  };
  setTitleParts(p, client, place);
  return p;
}

/* Abnahmeprotokoll (optional je Dokumentation)
   d.protocol = {
     enabled,
     attendees: [{ id, name, company, sig, sigAt }],   // Anwesende, Unterschrift direkt dahinter
     contractor: { name, sig, sigAt },                  // Auftragnehmer (Bühler)
     client:     { name, sig, sigAt },                  // Auftraggeber
   }
   sig = PNG als DataURL, sigAt = Zeitpunkt der Unterschrift */
export const CONTRACTOR_COMPANY = "Friedrich Bühler GmbH & Co. KG";

export function normalizeProtocol(d, p) {
  if (!Array.isArray(d.pdfCodes)) d.pdfCodes = [];
  if (!d.protocol || typeof d.protocol !== "object") return;
  const pr = d.protocol;
  pr.enabled = !!pr.enabled;
  if (!Array.isArray(pr.attendees)) pr.attendees = [];
  let code = null;
  for (const a of pr.attendees) {
    if (!a.id) a.id = newId();
    a.name = String(a.name ?? "");
    a.company = String(a.company ?? "");
    if (a.sig && !isSafeSig(a.sig)) { a.sig = null; a.sigAt = null; a.sigCode = null; }
    // Unterschriften aus Version 2.5 und älter: dem aktuellen Stand zuordnen
    if (a.sig && !a.sigCode && p) a.sigCode = code || (code = contentCode(p, d));
  }
  for (const k of ["contractor", "client"]) {
    if (!pr[k] || typeof pr[k] !== "object") pr[k] = { name: "" };
    pr[k].name = String(pr[k].name ?? "");
  }
}

export function newProtocol(p) {
  return {
    enabled: true,
    attendees: [
      { id: newId(), name: "", company: CONTRACTOR_COMPANY, sig: null, sigAt: null },
      { id: newId(), name: "", company: "", sig: null, sigAt: null },
    ],
    contractor: { name: "", sig: null, sigAt: null },
    client: { name: "", sig: null, sigAt: null },
  };
}

export function normalizeProject(p) {
  p.geo = cleanGeo(p.geo);
  if (p.summary && !(Number.isInteger(p.summary.docs) && p.summary.docs >= 0)) p.summary = null;
  p.number = String(p.number ?? p.id ?? "");
  p.title = String(p.title ?? "");
  if (typeof p.client !== "string" || typeof p.place !== "string") {
    const s = splitTitle(p.title);
    p.client = s.client;
    p.place = s.place;
  }
  p.fav = !!p.fav;
  if (!Array.isArray(p.deletedDocs)) p.deletedDocs = [];
  if (!Array.isArray(p.pendingDeletes)) p.pendingDeletes = [];
  if (!p.remote || typeof p.remote !== "object") p.remote = {};
  if (p.docs !== null && !Array.isArray(p.docs)) p.docs = [];
  for (const d of p.docs || []) {
    if (!d.remote || typeof d.remote !== "object") d.remote = {};
    if (!Array.isArray(d.entries)) d.entries = [];
    for (const k of ["deletedEntries", "deletedAtt"]) {
      d[k] = Array.isArray(d[k]) ? d[k].filter((t) => t && typeof t.id === "string" && Number.isFinite(t.at)) : [];
    }
    normalizeProtocol(d, p);
    for (const e of d.entries) {
      if (!e.id) e.id = newId();
      if (typeof e.description !== "string") e.description = String(e.description ?? "");
      if (!Array.isArray(e.images)) e.images = [];
    }
  }
}

/* ---------- Umstellung alter Daten (Version 1) ----------
   v1: Projekt { id, name, docs, fav }, Bilder als DataURL im Eintrag.
   Vorher wird eine Sicherheitskopie unter "state_v1_backup" abgelegt.
--------------------------------------------------------- */
async function migrateV1(old) {
  try { await db.kvSet("state_v1_backup", old); } catch (e) { console.warn(e); }

  const usedIds = new Set();
  const convert = async (p) => {
    const name = String(p.name ?? p.id ?? "").trim();
    const m = name.match(/^(\d{5})\s*[-–]?\s*(.*)$/);
    const idIsNumber = /^\d{5}$/.test(String(p.id));
    const number = m ? m[1] : idIsNumber ? String(p.id) : "00000";
    const title = m ? m[2].trim() : name;
    let id = number;
    if (usedIds.has(id) || number === "00000") id = newId();
    usedIds.add(id);

    const docs = [];
    for (const d of p.docs || []) {
      const entries = [];
      for (const en of d.entries || []) {
        const imgs = [];
        for (const src of en.images || []) {
          if (typeof src !== "string" || !src.startsWith("data:")) continue;
          try {
            const blob = dataUrlToBlob(src);
            const imgId = newId();
            let thumb = null;
            try { thumb = await makeThumb(blob); } catch {}
            await db.imgPut({ id: imgId, archive: blob, thumb });
            imgs.push({ id: imgId });
          } catch (e) {
            console.warn("Bild konnte nicht übernommen werden", e);
          }
        }
        entries.push({ id: newId(), description: en.description || "", images: imgs });
      }
      docs.push({
        id: String(d.id || newId()),
        title: d.title || "Dokumentation",
        date: d.date || new Date().toISOString(),
        updatedAt: Date.parse(d.date) || Date.now(),
        entries,
        remote: {},
      });
    }
    return {
      id, number, title, fav: !!p.fav,
      docs, deletedDocs: [], pendingDeletes: [], moveTo: null,
      remote: {}, updatedAt: Date.now(), rev: 1, dirty: true,
    };
  };

  const projects = [];
  for (const p of old.projects || []) projects.push(await convert(p));
  const archivedProjects = [];
  for (const p of old.archivedProjects || []) archivedProjects.push(await convert(p));

  const st = { ...defaultState(), projects, archivedProjects };
  st.prefs = { favUpdatedAt: 0, rev: 1, dirty: true };
  return st;
}
