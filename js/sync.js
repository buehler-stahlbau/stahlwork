/* =========================================================
   Abgleich mit OneDrive

   Ablage:
     BauDoc/
       _daten/                       <- nur für die App
         bv-<Ordner-ID>.json         <- Texte, Struktur je BV (klein)
         nutzer/<anmeldename>.json   <- Favoriten je Nutzer
         pruefcodes.json             <- Prüfcodes archivierter BV (auch nach dem Auslagern)
       12345 Neubau Lagerhalle/
         18.11.2026 Rohbau/
           12345 18.11.2026 Rohbau.pdf
           Bilder/
             20261118-143512-a3f91c.jpg   (≤ 1 MB)
       _Archiv/
         12345 .../                  <- archiviertes BV: vollständig (PDFs, Bilder,
           Stahlwork-Daten.json         Stahlwork-Daten.json) -> kann auf den Server

   Regeln:
   - Lokale Änderungen werden immer hochgeladen.
   - Die Liste aller Bauvorhaben wird immer geladen (nur Ordnernamen).
   - Favoriten: Inhalt + alle Bilder werden auf dem Gerät gehalten.
   - Andere Bauvorhaben: Inhalt nur beim Öffnen, Bilder nur als
     Vorschau; Archivbilder werden nach dem Hochladen vom Gerät gelöscht.
========================================================= */
import * as od from "./onedrive.js";
import * as db from "./db.js";
import { CONFIG } from "./config.js";
import {
  S, saveNow, allProjects, findByNumber, isActive, moveLocal, uniqueProjectId,
  removeProjectLocal, normalizeProject, imagesOfDoc, imagesOfProject,
} from "./store.js";
import { sanitizeName, projectLabel, sleep, isoDay } from "./util.js";
import { makeThumb } from "./images.js";
import { cleanGeo, geoValid } from "./geo.js";
import { contentCode } from "./integrity.js";
import { syncMon } from "./baumon.js";

const ARCHIVE_FILE = "Stahlwork-Daten.json"; // im archivierten BV-Ordner: alle Daten des BV
const CODE_INDEX = "pruefcodes.json";        // _daten: Prüfcodes archivierter/ausgelagerter BV

// kurzer Fingerabdruck eines Textes (erkennt Änderungen)
function fingerprint(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + ":" + str.length;
}

// Eintrag für die Prüfcode-Übersicht
function codeEntry(p) {
  return {
    number: p.number, title: p.title, client: p.client || "", place: p.place || "",
    docs: (p.docs || []).map((d) => ({
      id: d.id, title: d.title, date: d.date, cur: contentCode(p, d),
      pdf: (d.pdfCodes || []).map((x) => ({ code: x.code, at: x.at })),
    })),
  };
}

const MAP_INDEX = "karte.json"; // _daten/karte.json: Übersicht je BV (Kartenposition, Anzahl Dokus, letzte Doku)

// Kurzübersicht eines geladenen BV
export function projectSummary(p) {
  if (!Array.isArray(p.docs)) return null;
  const last = p.docs.reduce((mx, d) => Math.max(mx, Date.parse(d.date) || 0), 0);
  return { docs: p.docs.length, last: last ? new Date(last).toISOString() : null };
}

const LEGACY_PROJECT_FILE = "baudoc.json"; // bis Version 2.8 im BV-Ordner

// Datendatei eines BV in _daten – über die feste OneDrive-ID des BV-Ordners,
// damit sie auch nach Umbenennen/Umnummerieren/Archivieren passt
function dataFileName(p) {
  return `bv-${String(p.remote.folderId || "").replace(/[^A-Za-z0-9_-]/g, "_")}.json`;
}
const FOLDER_RE = /^(\d{5})(?:\s+(.*))?$/;
const TOMBSTONE_MAX_AGE = 180 * 24 * 3600 * 1000;

/* ---------- Status ---------- */
export const status = { kind: "off", message: "", pending: 0, lastSync: null };
const statusListeners = new Set();
const dataListeners = new Set();
export const onStatus = (fn) => statusListeners.add(fn);
export const onData = (fn) => dataListeners.add(fn);

let outboxCount = 0;

function hasUnuploaded(p) {
  return imagesOfProject(p).some((i) => !i.rid && !i.missing);
}

function countPending() {
  let n = outboxCount + (S.state.remote.pendingFolderDeletes || []).length + (S.state.prefs.dirty ? 1 : 0) + (S.state.mon && S.state.mon.dirty ? 1 : 0);
  for (const p of allProjects()) {
    if (p.dirty || p.moveTo) n++;
    n += (p.pendingDeletes || []).length;
    n += imagesOfProject(p).filter((i) => !i.rid && !i.missing).length;
  }
  return n;
}

function setStatus(kind, message = "") {
  status.kind = kind;
  status.message = message;
  status.pending = countPending();
  statusListeners.forEach((fn) => { try { fn(status); } catch (e) { console.error(e); } });
}

export function refreshStatus() {
  if (status.kind === "syncing") return setStatus("syncing", status.message);
  if (!od.isConfigured()) return setStatus("off");
  if (!od.isSignedIn()) return setStatus("signedout", status.kind === "signedout" ? status.message : "");
  if (!navigator.onLine) return setStatus("offline");
  if (status.kind === "error") return setStatus("error", status.message);
  setStatus(countPending() ? "pending" : "idle");
}

export async function updateOutboxCount() {
  try { outboxCount = (await db.outboxAll()).length; } catch {}
  refreshStatus();
}

/* ---------- Steuerung ---------- */
let running = false;
let rerun = false;
let rerunFull = false;
let timer = null;
let nextFull = false;

export function schedule(delay = 3000, { full = false } = {}) {
  nextFull = nextFull || full;
  clearTimeout(timer);
  timer = setTimeout(() => {
    const f = nextFull;
    nextFull = false;
    run({ full: f });
  }, delay);
}

export async function whenIdle() {
  while (running) await sleep(150);
}

function snapshot() {
  try {
    return JSON.stringify([S.state.projects, S.state.archivedProjects, S.state.selectedProjectId, S.state.mon && S.state.mon.data]);
  } catch { return Math.random().toString(); }
}

export async function run({ full = false } = {}) {
  if (!od.isConfigured()) return setStatus("off");
  if (!od.isSignedIn()) return setStatus("signedout");
  if (!navigator.onLine) return setStatus("offline");
  if (running) { rerun = true; rerunFull = rerunFull || full; return; }

  running = true;
  const before = snapshot();
  setStatus("syncing");
  try {
    outboxCount = (await db.outboxAll()).length;
    await syncAll(full);
    status.lastSync = Date.now();
    setStatus(countPending() ? "pending" : "idle");
  } catch (e) {
    console.warn("Sync-Fehler", e);
    if (e && e.authRequired) setStatus("signedout", "Anmeldung abgelaufen – bitte neu anmelden");
    else setStatus(navigator.onLine ? "error" : "offline", (e && e.message) || String(e));
  } finally {
    running = false;
    await saveNow();
    if (snapshot() !== before) dataListeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
    if (rerun) {
      const f = rerunFull;
      rerun = false;
      rerunFull = false;
      schedule(300, { full: f });
    }
  }
}

// Bauvorhaben öffnen, dessen Inhalt nur online liegt
export async function loadProject() {
  await whenIdle();
  await run({ full: false });
}

/* ---------- Ablauf ---------- */
async function syncAll(full) {
  const st = S.state;
  const root = await od.getRootFolder();
  st.remote.rootId = root.id;
  const dataDir = await od.ensureFolder(root.id, CONFIG.dataFolder);

  for (const id of [...st.remote.pendingFolderDeletes]) {
    await od.deleteItem(id);
    const df = await od.getChild(dataDir.id, dataFileName({ remote: { folderId: id } }));
    if (df) await od.deleteItem(df.id);
    st.remote.pendingFolderDeletes = st.remote.pendingFolderDeletes.filter((x) => x !== id);
  }

  if (full) await refreshListing(root, dataDir);
  if (full || S.state.prefs.dirty) await syncPrefs(root, dataDir);
  const outbox = await db.outboxAll();
  const sel = st.selectedProjectId;
  const targets = allProjects().filter((p) =>
    p.dirty || p.moveTo || p.pendingDeletes.length || hasUnuploaded(p) ||
    outbox.some((o) => o.projectId === p.id) ||
    p.id === sel || // geöffnetes Bauvorhaben immer aktuell halten (1 kleine Abfrage)
    (full && p.fav && isActive(p)) ||
    (full && !isActive(p) && p.remote.folderId && !p.remote.archiveSnap) // ältere Archiv-BV vervollständigen
  );

  let firstError = null;
  for (const p of targets) {
    try {
      await syncProject(p, root, dataDir, outbox);
    } catch (e) {
      if (e && e.authRequired) throw e;
      console.warn(`Sync ${p.number} fehlgeschlagen`, e);
      if (!firstError) firstError = e;
    }
  }
  if (full || S.state.mapDirty || (S.state.mapRemove || []).length) await syncMapIndex(dataDir);
  if (full || Object.keys(S.state.codeIndexPending || {}).length) await syncCodeIndex(dataDir);
  // BauMon (eigene Datei)
  try { await syncMon({ full }); } catch (e) { if (e && e.authRequired) throw e; console.warn("BauMon", e); if (!firstError) firstError = e; }
  outboxCount = (await db.outboxAll()).length;
  if (firstError) throw firstError;
}

/* Kartenpositionen aller BV in einer kleinen Datei, damit auch nicht geladene
   BV auf der Karte erscheinen */
async function syncMapIndex(dataDir) {
  const remote = await od.getJson(dataDir.id, MAP_INDEX);
  const idx = (remote && remote.data && typeof remote.data === "object" && remote.data.bv) ? { ...remote.data.bv } : {};
  let changed = !remote;
  // ausgelagerte BV aus der Karte entfernen
  for (const fid of S.state.mapRemove || []) if (idx[fid]) { delete idx[fid]; changed = true; }
  S.state.mapRemove = [];
  for (const p of allProjects()) {
    const fid = p.remote && p.remote.folderId;
    if (!fid) continue;
    const raw = idx[fid] && typeof idx[fid] === "object" ? idx[fid] : {};
    const e = cleanGeo(raw);
    const next = { ...raw };
    // Kartenposition
    if (geoValid(p)) {
      next.lat = p.geo.lat; next.lon = p.geo.lon; next.place = p.geo.place; next.label = p.geo.label || "";
    } else if (e && e.place === p.place) {
      p.geo = e; // Position aus der Übersicht übernehmen
    }
    // Anzahl Dokus + letzte Doku
    const sum = projectSummary(p);
    if (sum) { next.docs = sum.docs; next.last = sum.last; }
    else if (Number.isInteger(raw.docs)) p.summary = { docs: raw.docs, last: typeof raw.last === "string" ? raw.last : null };
    if (JSON.stringify(next) !== JSON.stringify(raw)) { idx[fid] = next; changed = true; }
  }
  if (changed) await od.putJson(dataDir.id, MAP_INDEX, { format: "baudoc-map", version: 1, bv: idx }, null);
  S.state.mapDirty = false;
}

/* Prüfcodes archivierter BV: _daten/pruefcodes.json
   Bleibt erhalten, wenn der BV-Ordner aus OneDrive (z. B. auf den Server) verschoben wird. */
async function syncCodeIndex(dataDir) {
  const st = S.state;
  const remote = await od.getJson(dataDir.id, CODE_INDEX);
  const idx = (remote && remote.data && typeof remote.data.bv === "object" && remote.data.bv) ? { ...remote.data.bv } : {};
  const pending = st.codeIndexPending || {};
  let changed = false;
  for (const [fid, e] of Object.entries(pending)) {
    if (e === null) { if (idx[fid]) { delete idx[fid]; changed = true; } }
    else if (JSON.stringify(idx[fid]) !== JSON.stringify(e)) { idx[fid] = e; changed = true; }
  }
  if (changed) await od.putJson(dataDir.id, CODE_INDEX, { format: "stahlwork-codes", version: 1, bv: idx }, null);
  st.codeIndex = idx;
  st.codeIndexPending = {};
}

/* Favoriten je Nutzer: BauDoc/_daten/nutzer/<anmeldename>.json */
async function syncPrefs(root, dataDir) {
  const acc = od.getAccount();
  if (!acc) return;
  const pr = S.state.prefs;
  // Microsoft-Profil für die automatische Signatur: höchstens alle 12 Stunden neu holen
  if (!pr.profileAt || Date.now() - pr.profileAt > 12 * 3600e3 || pr.profileFor !== acc.username) {
    try {
      const me = await od.getMyProfile();
      pr.profile = { name: [me.givenName, me.surname].filter(Boolean).join(" ") || me.displayName || "", job: me.jobTitle || "",
        phone: (me.businessPhones || [])[0] || "", mobile: me.mobilePhone || "", fax: me.faxNumber || "", mail: me.mail || me.userPrincipalName || "" };
      pr.profileAt = Date.now(); pr.profileFor = acc.username;
    } catch (e) { console.warn("Profil", e && e.message); }
  }
  const folder = await od.ensureFolder(dataDir.id, CONFIG.usersFolder);
  const name = sanitizeName(String(acc.username || acc.homeAccountId || "nutzer").toLowerCase()) + ".json";
  let remote = await od.getJson(folder.id, name);

  // Umzug aus dem alten Ordner BauDoc/_Nutzer (bis Version 2.8)
  const legacyDir = await od.getChild(root.id, CONFIG.legacyUsersFolder);
  if (legacyDir) {
    const legacy = await od.getJson(legacyDir.id, name);
    if (legacy) {
      if (!remote) {
        await od.putJson(folder.id, name, legacy.data, null);
        remote = await od.getJson(folder.id, name);
      }
      await od.deleteItem(legacy.id);
    }
    if (!(await od.listChildren(legacyDir.id)).length) await od.deleteItem(legacyDir.id);
  }
  const remoteAt = (remote && remote.data && remote.data.favUpdatedAt) || 0;
  // E-Mail-Signatur: neuere Fassung gewinnt
  const rd = (remote && remote.data) || {};
  if ((rd.sigUpdatedAt || 0) > (pr.sigUpdatedAt || 0)) { pr.mailSignature = rd.mailSignature || ""; pr.sigUpdatedAt = rd.sigUpdatedAt; }
  const sigNewer = (pr.sigUpdatedAt || 0) > (rd.sigUpdatedAt || 0);

  if (remote && remoteAt > (pr.favUpdatedAt || 0)) {
    const favs = new Set(remote.data.favorites || []);
    for (const p of allProjects()) {
      const was = p.fav;
      p.fav = favs.has(p.number);
      if (was && !p.fav) { try { await freeLocal(p); } catch (e) { console.warn(e); } }
    }
    pr.favUpdatedAt = remoteAt;
    pr.dirty = false;
    if (!sigNewer) return;
  }
  if (!remote || pr.dirty || sigNewer) {
    const rev = pr.rev;
    if (!pr.favUpdatedAt) pr.favUpdatedAt = Date.now();
    await od.putJson(folder.id, name, {
      format: "baudoc-user",
      user: acc.username || "",
      favorites: allProjects().filter((p) => p.fav).map((p) => p.number).sort(),
      favUpdatedAt: pr.favUpdatedAt,
      mailSignature: pr.mailSignature || "",
      sigUpdatedAt: pr.sigUpdatedAt || 0,
    }, null);
    if (pr.rev === rev) pr.dirty = false;
  }
}

async function ensureArchive(root) {
  return od.ensureFolder(root.id, CONFIG.archiveFolder);
}

function folderNameFor(p) {
  return sanitizeName(projectLabel(p));
}

/* Liste aller Bauvorhaben aus OneDrive (nur Ordnernamen) */
async function refreshListing(root, dataDir) {
  const st = S.state;
  const kids = await od.listChildren(root.id);
  const arch = kids.find((k) => k.folder && k.name === CONFIG.archiveFolder);
  const archKids = arch ? await od.listChildren(arch.id) : [];

  const found = [];
  const collect = (list, loc) => {
    for (const k of list) {
      const m = k.folder && k.name.match(FOLDER_RE);
      if (m) found.push({ item: k, number: m[1], title: (m[2] || "").trim(), loc });
    }
  };
  collect(kids, "active");
  collect(archKids, "archive");
  const foundIds = new Set(found.map((f) => f.item.id));

  for (const f of found) {
    let p = allProjects().find((x) => x.remote && x.remote.folderId === f.item.id) || findByNumber(f.number);
    if (!p) {
      p = {
        id: uniqueProjectId(f.number), number: f.number, title: f.title, fav: false,
        docs: null, deletedDocs: [], pendingDeletes: [], moveTo: null,
        remote: { folderId: f.item.id, baseName: f.item.name, etag: null },
        updatedAt: 0, rev: 0, dirty: false,
      };
      normalizeProject(p);
      (f.loc === "archive" ? st.archivedProjects : st.projects).push(p);
      continue;
    }
    if (p.remote.folderId !== f.item.id) {
      if (p.remote.folderId && foundIds.has(p.remote.folderId)) continue; // doppelter Ordner – ignorieren
      p.remote = { folderId: f.item.id, baseName: f.item.name, etag: null };
    }
    if (p.remote.baseName !== f.item.name && !p.dirty) {
      p.remote.baseName = f.item.name;
      if (p.docs === null) { p.number = f.number; p.title = f.title; delete p.client; delete p.place; normalizeProject(p); }
      else if (p.number !== f.number && !findByNumber(f.number)) p.number = f.number; // auf anderem Gerät umnummeriert
    }
    const loc = isActive(p) ? "active" : "archive";
    if (!p.moveTo && loc !== f.loc) moveLocal(p, f.loc);
  }

  // Ordner in OneDrive gelöscht?
  for (const p of allProjects()) {
    if (!p.remote.folderId || foundIds.has(p.remote.folderId)) continue;
    if (p.dirty || hasUnuploaded(p)) {
      // Lokale Änderungen vorhanden -> neu anlegen statt löschen
      p.remote = {};
      for (const d of p.docs || []) {
        d.remote = {};
        for (const img of imagesOfDoc(d)) delete img.rid;
      }
      p.dirty = true;
    } else {
      if (!isActive(p)) await forgetMovedArchive(p, dataDir);
      await removeProjectLocal(p);
    }
  }
}

// Zurückgeholter Ordner: Doku-Ordner und Fotos über ihre Namen neu zuordnen
// (beim Kopieren vom Server bekommen alle Dateien in OneDrive neue IDs)
async function relinkArchive(folderId, proj) {
  const data = JSON.parse(JSON.stringify(proj));
  const kids = (await od.listChildren(folderId)).filter((k) => k.folder);
  for (const d of data.docs) {
    const r = d.remote || {};
    const f = kids.find((k) => k.name === r.baseName);
    if (!f) { d.remote = { folderId: null, baseName: null, bilderId: null }; continue; }
    const bilder = (await od.listChildren(f.id)).find((k) => k.folder && k.name === "Bilder");
    d.remote = { folderId: f.id, baseName: f.name, bilderId: bilder ? bilder.id : null };
    const files = bilder ? await od.listChildren(bilder.id) : [];
    const byName = new Map(files.filter((x) => x.file).map((x) => [x.name, x.id]));
    for (const e of d.entries || []) {
      for (const i of e.images || []) i.rid = byName.get(`${i.id}.jpg`) || null;
    }
  }
  return data;
}

// Archiviertes BV wurde aus OneDrive verschoben (z. B. auf den Server):
// Prüfcodes behalten, Datendatei und Karteneintrag aufräumen
async function forgetMovedArchive(p, dataDir) {
  const st = S.state;
  const fid = p.remote.folderId;
  const known = (st.codeIndexPending || {})[fid] || (st.codeIndex || {})[fid];
  const entry = Array.isArray(p.docs) ? codeEntry(p) : known;
  if (entry) {
    st.codeIndexPending = { ...(st.codeIndexPending || {}), [fid]: { ...entry, gone: new Date().toISOString() } };
  }
  try {
    const df = await od.getChild(dataDir.id, dataFileName(p));
    if (df) await od.deleteItemIn(df.id, dataDir.id);
  } catch (e) { console.warn("Datendatei aufräumen", e); }
  st.mapRemove = [...(st.mapRemove || []), fid];
}

async function syncProject(p, root, dataDir, outbox) {
  // 1) Projektordner
  if (!p.remote.folderId) {
    const parent = isActive(p) ? root : await ensureArchive(root);
    const existing = (await od.listChildren(parent.id)).find((k) => {
      const m = k.folder && k.name.match(FOLDER_RE);
      return m && m[1] === p.number;
    });
    const f = existing || (await od.createFolder(parent.id, folderNameFor(p), "fail"));
    p.remote = { folderId: f.id, baseName: f.name, etag: null };
    p.moveTo = null;
  }

  // 2) Archivieren / Wiederherstellen
  if (p.moveTo) {
    const parent = p.moveTo === "archive" ? await ensureArchive(root) : root;
    await od.moveItem(p.remote.folderId, parent.id);
    if (p.moveTo === "active") {
      const af = await od.getChild(p.remote.folderId, ARCHIVE_FILE);
      if (af) await od.deleteItemIn(af.id, p.remote.folderId);
      p.remote.archiveSnap = null;
      S.state.codeIndexPending = { ...(S.state.codeIndexPending || {}), [p.remote.folderId]: null };
    }
    p.moveTo = null;
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    // 3) Stand aus OneDrive holen und zusammenführen
    let remote = await od.getJson(dataDir.id, dataFileName(p));
    let legacy = null;
    if (!remote) {
      // bis Version 2.8 lag die Datei als baudoc.json im BV-Ordner -> umziehen
      legacy = await od.getJson(p.remote.folderId, LEGACY_PROJECT_FILE);
      if (legacy) remote = { data: legacy.data, eTag: legacy.eTag, id: null };
    }
    if (!remote) {
      // Ordner z. B. vom Server zurückgeholt: alle Daten stehen in Stahlwork-Daten.json
      const arc = await od.getJson(p.remote.folderId, ARCHIVE_FILE);
      const a = arc && arc.data;
      if (a && a.format === "stahlwork-bv-archiv" && a.project && Array.isArray(a.project.docs)) {
        remote = { data: await relinkArchive(p.remote.folderId, a.project), eTag: null, id: null, restored: true };
        if (a.folderId && a.folderId !== p.remote.folderId) {
          S.state.codeIndexPending = { ...(S.state.codeIndexPending || {}), [a.folderId]: null }; // alter Eintrag "ausgelagert"
        }
        if (p.docs !== null && !p.docs.length) p.docs = null; // leeren Stand durch die Archivdaten ersetzen
      }
    }
    if (remote && (remote.restored || remote.eTag !== p.remote.etag)) {
      if (p.docs === null) adoptRemote(p, remote.data);
      else await mergeRemote(p, remote.data);
    }
    if (p.docs === null) p.docs = [];

    // 4) Ordnername an Bezeichnung anpassen
    const want = folderNameFor(p);
    if (want !== p.remote.baseName) {
      await od.renameItem(p.remote.folderId, want);
      p.remote.baseName = want;
    }

    // 5) Doku-Ordner + Bilder
    for (const d of p.docs) await syncDoc(p, d);

    // 6) Gelöschtes in OneDrive entfernen (-> Papierkorb)
    for (const job of [...p.pendingDeletes]) {
      if (typeof job === "string") await od.deleteItem(job); // ältere Version (lokal erzeugt)
      else if (job && job.id && job.parent) await od.deleteItemIn(job.id, job.parent);
      p.pendingDeletes = p.pendingDeletes.filter((x) => x !== job);
    }

    // 7) PDFs ablegen
    for (const o of outbox.filter((x) => x.projectId === p.id && !x.done)) {
      const d = p.docs.find((x) => x.id === o.docId);
      if (d) {
        await syncDoc(p, d);
        await od.uploadFile(d.remote.folderId, o.name, o.blob, "application/pdf");
      }
      await db.outboxDelete(o.id);
      o.done = true;
      outboxCount = Math.max(0, outboxCount - 1);
    }

    // 8) Datendatei in _daten schreiben (nur wenn sich etwas geändert hat oder umgezogen wird)
    const rev = p.rev;
    const json = serialize(p);
    if (!remote || legacy || remote.restored || JSON.stringify(remote.data) !== JSON.stringify(json)) {
      const res = await od.putJson(dataDir.id, dataFileName(p), json, remote && !legacy && !remote.restored ? remote.eTag : null);
      if (res.conflict) continue; // zwischenzeitlich von anderem Gerät geändert -> nochmal
      p.remote.etag = res.eTag;
      if (legacy) await od.deleteItem(legacy.id); // alte baudoc.json aus dem BV-Ordner entfernen
    } else {
      p.remote.etag = remote.eTag;
    }
    // Archiv: alle Daten zusätzlich in den BV-Ordner + Prüfcodes merken
    if (!isActive(p)) {
      const fp = fingerprint(JSON.stringify(json));
      if (p.remote.archiveSnap !== fp) {
        await od.putJson(p.remote.folderId, ARCHIVE_FILE, {
          format: "stahlwork-bv-archiv", version: 1, savedAt: new Date().toISOString(), folderId: p.remote.folderId,
          hinweis: "Alle Daten dieses Bauvorhabens aus Stahlwork (Texte, Unterschriften, Prüfcodes). PDFs und Bilder liegen in den Unterordnern.",
          project: json,
        }, null);
        p.remote.archiveSnap = fp;
      }
      const e = codeEntry(p);
      if (JSON.stringify((S.state.codeIndex || {})[p.remote.folderId]) !== JSON.stringify(e)) {
        S.state.codeIndexPending = { ...(S.state.codeIndexPending || {}), [p.remote.folderId]: e };
      }
    }
    if (p.rev === rev) p.dirty = false;
    const sum = projectSummary(p);
    if (sum && JSON.stringify(sum) !== JSON.stringify(p.summary || null)) { p.summary = sum; S.state.mapDirty = true; }

    // 9) Speicher auf dem Gerät
    await applyCachePolicy(p);
    return;
  }
  throw new Error(`Bauvorhaben ${p.number}: gleichzeitige Änderung – wird erneut versucht`);
}

export function docFolderName(d) {
  const dt = new Date(d.date);
  return sanitizeName(`${isNaN(dt) ? "" : isoDay(dt) + " "}${d.title || "Dokumentation"}`);
}

const verifiedIds = new Set(); // in dieser Sitzung geprüfte Ordner

async function verifyDocFolders(p, d) {
  const r = d.remote || {};
  if (r.folderId && !verifiedIds.has(r.folderId)) {
    if (await od.isChildOf(r.folderId, p.remote.folderId)) verifiedIds.add(r.folderId);
    else { console.warn("Doku-Ordner gehört nicht zum BV – wird neu angelegt", d.id); d.remote = {}; return; }
  }
  if (r.bilderId && !verifiedIds.has(r.bilderId)) {
    if (await od.isChildOf(r.bilderId, r.folderId)) verifiedIds.add(r.bilderId);
    else d.remote.bilderId = null;
  }
}

async function syncDoc(p, d, retry = true) {
  if (!d.remote) d.remote = {};
  await verifyDocFolders(p, d);
  const want = docFolderName(d);
  try {
    if (!d.remote.folderId) {
      const f = await od.createFolder(p.remote.folderId, want, "rename");
      d.remote = { folderId: f.id, baseName: want, bilderId: null };
      verifiedIds.add(f.id);
    } else if (d.remote.baseName !== want) {
      await od.renameItem(d.remote.folderId, want);
      d.remote.baseName = want;
    }

    const todo = imagesOfDoc(d).filter((i) => !i.rid && !i.missing);
    if (!todo.length) return;
    if (!d.remote.bilderId) {
      const b = await od.ensureFolder(d.remote.folderId, "Bilder");
      d.remote.bilderId = b.id;
      verifiedIds.add(b.id);
    }
    for (const img of todo) {
      const rec = await db.imgGet(img.id);
      if (!rec || !rec.archive) { img.missing = true; continue; }
      const item = await od.uploadFile(d.remote.bilderId, `${img.id}.jpg`, rec.archive, "image/jpeg");
      img.rid = item.id;
      setStatus("syncing");
    }
  } catch (e) {
    if (retry && e && e.status === 404) {
      d.remote = {};
      return syncDoc(p, d, false);
    }
    throw e;
  }
}

/* ---------- Format von baudoc.json ---------- */
function serialize(p) {
  return {
    format: "baudoc-project",
    version: 2,
    number: p.number,
    title: p.title,
    client: p.client || "",
    place: p.place || "",
    geo: p.geo || null,
    updatedAt: p.updatedAt || 0,
    deletedDocs: p.deletedDocs || [],
    docs: (p.docs || []).map((d) => ({
      id: d.id,
      title: d.title,
      date: d.date,
      updatedAt: d.updatedAt || 0,
      metaAt: d.metaAt || 0,
      protocol: d.protocol || null,
      pdfCodes: d.pdfCodes || [],
      deletedEntries: d.deletedEntries || [],
      deletedAtt: d.deletedAtt || [],
      remote: {
        folderId: d.remote?.folderId || null,
        baseName: d.remote?.baseName || null,
        bilderId: d.remote?.bilderId || null,
      },
      entries: (d.entries || []).map((e) => ({
        id: e.id,
        description: e.description || "",
        updatedAt: e.updatedAt || 0,
        images: (e.images || []).map((i) => ({ id: i.id, rid: i.rid || null })),
      })),
    })),
  };
}

function cleanDoc(d) {
  const c = JSON.parse(JSON.stringify(d));
  c.remote = c.remote || {};
  for (const e of c.entries || []) {
    for (const i of e.images || []) if (!i.rid) delete i.rid;
  }
  return c;
}

function adoptTitle(p, r) {
  if (r.geo !== undefined) p.geo = cleanGeo(r.geo);
  if (r.number && /^\d{5}$/.test(r.number)) p.number = r.number;
  if (!r.title) return;
  p.title = r.title;
  if (typeof r.client === "string") { p.client = r.client; p.place = r.place || ""; }
  else { delete p.client; delete p.place; } // wird aus title abgeleitet
}

function adoptRemote(p, r) {
  adoptTitle(p, r);
  p.updatedAt = r.updatedAt || 0;
  p.deletedDocs = r.deletedDocs || [];
  p.docs = (r.docs || []).map(cleanDoc);
  normalizeProject(p);
}

// Zusammenführen auf Ebene der Dokumentationen: neuere Version gewinnt
/* ---------- Zusammenführen einer Doku (beide Seiten haben sie geändert) ----------
   - Kopfdaten (Titel, Datum, Protokoll ein/aus): neuere Fassung
   - Einträge: je Eintrag die neuere Fassung; neue Einträge beider Seiten bleiben erhalten;
     gelöschte Einträge bleiben gelöscht (Grabstein)
   - Teilnehmer/Unterschriften: je Person die neuere Fassung, gelöschte bleiben gelöscht
   - PDF-Prüfcodes: alle beider Seiten */
const MERGE_ENTRIES = true;
function mergeTombs(a, b) {
  const m = new Map();
  for (const t of [...(a || []), ...(b || [])]) if (t && t.id && (!m.has(t.id) || m.get(t.id) < t.at)) m.set(t.id, t.at);
  const now = Date.now();
  return [...m].map(([id, at]) => ({ id, at })).filter((t) => now - t.at < TOMBSTONE_MAX_AGE);
}
function mergeList(lList, rList, tombs, fallbackL, fallbackR, keepRid) {
  const dead = new Map(tombs.map((t) => [t.id, t.at]));
  const rById = new Map((rList || []).map((x) => [x.id, x]));
  const lById = new Map((lList || []).map((x) => [x.id, x]));
  const pick = (id) => {
    const l = lById.get(id), r = rById.get(id);
    let x;
    if (l && r) x = (r.updatedAt || fallbackR) > (l.updatedAt || fallbackL) ? r : l;
    else x = l || r;
    const t = x === l ? (x.updatedAt || fallbackL) : (x.updatedAt || fallbackR);
    if (dead.has(id) && dead.get(id) >= t) return null;
    if (keepRid && l && r) keepRid(x, x === l ? r : l);
    return x;
  };
  // Reihenfolge: OneDrive-Stand, lokale neue Einträge an ihrer Stelle einfügen
  const order = (rList || []).map((x) => x.id);
  let prev = -1;
  for (const x of lList || []) {
    const i = order.indexOf(x.id);
    if (i >= 0) { prev = i; continue; }
    order.splice(prev + 1, 0, x.id);
    prev++;
  }
  const out = order.map(pick).filter(Boolean);
  // Einträge der App haben Zeit-IDs (JJJJMMTT-hhmmss-…): dann nach Entstehung sortieren
  if (out.every((x) => /^\d{8}-\d{6}-/.test(x.id))) out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}
function mergeDoc(ld, rd) {
  const lAt = ld.updatedAt || 0, rAt = rd.updatedAt || 0;
  // Kopfdaten
  if ((rd.metaAt || rAt) > (ld.metaAt || lAt)) {
    ld.title = rd.title; ld.date = rd.date; ld.metaAt = rd.metaAt || rAt;
    if (rd.protocol) { ld.protocol = ld.protocol || {}; ld.protocol.enabled = rd.protocol.enabled; }
  }
  // Einträge (Fotos: OneDrive-IDs der anderen Seite übernehmen, wenn sie fehlen)
  ld.deletedEntries = mergeTombs(ld.deletedEntries, rd.deletedEntries);
  ld.entries = mergeList(ld.entries, rd.entries, ld.deletedEntries, lAt, rAt, (win, other) => {
    const rids = new Map((other.images || []).map((i) => [i.id, i.rid]));
    for (const i of win.images || []) if (!i.rid && rids.get(i.id)) i.rid = rids.get(i.id);
  });
  // Protokoll
  if (ld.protocol || rd.protocol) {
    const lp = ld.protocol || {}, rp = rd.protocol || {};
    ld.deletedAtt = mergeTombs(ld.deletedAtt, rd.deletedAtt);
    const attendees = mergeList(lp.attendees || [], rp.attendees || [], ld.deletedAtt, lAt, rAt);
    const out = { ...(rAt > lAt ? rp : lp), ...lp, enabled: (ld.protocol || rp).enabled, attendees };
    for (const k of ["contractor", "client"]) {
      const a = lp[k], b = rp[k];
      out[k] = a && b ? ((b.updatedAt || rAt) > (a.updatedAt || lAt) ? b : a) : a || b || { name: "" };
    }
    ld.protocol = out;
  }
  // PDF-Prüfcodes
  const codes = new Map();
  for (const c of [...(ld.pdfCodes || []), ...(rd.pdfCodes || [])]) if (c && c.code && !codes.has(c.code + c.at)) codes.set(c.code + c.at, c);
  ld.pdfCodes = [...codes.values()].sort((a, b) => a.at - b.at).slice(-30);
  // OneDrive-Ordner der Doku
  ld.remote = ld.remote || {};
  for (const k of ["folderId", "baseName", "bilderId"]) if (!ld.remote[k] && rd.remote && rd.remote[k]) ld.remote[k] = rd.remote[k];
  ld.updatedAt = Math.max(lAt, rAt);
}

async function mergeRemote(p, r) {
  if ((r.updatedAt || 0) > (p.updatedAt || 0)) {
    adoptTitle(p, r);
    p.updatedAt = r.updatedAt;
  }

  const tomb = new Map();
  for (const t of [...(p.deletedDocs || []), ...(r.deletedDocs || [])]) {
    if (!tomb.has(t.id) || tomb.get(t.id) < t.at) tomb.set(t.id, t.at);
  }
  const now = Date.now();
  p.deletedDocs = [...tomb].map(([id, at]) => ({ id, at })).filter((t) => now - t.at < TOMBSTONE_MAX_AGE);

  const rById = new Map((r.docs || []).map((d) => [d.id, d]));
  const isDeleted = (d) => tomb.has(d.id) && tomb.get(d.id) >= (d.updatedAt || 0);

  for (let i = p.docs.length - 1; i >= 0; i--) {
    const ld = p.docs[i];
    const rd = rById.get(ld.id);
    if (isDeleted(ld)) {
      p.docs.splice(i, 1);
      for (const img of imagesOfDoc(ld)) { try { await db.imgDelete(img.id); } catch {} }
      continue;
    }
    if (!rd) continue;
    if (MERGE_ENTRIES) {
      const before = new Set(imagesOfDoc(ld).map((x) => x.id));
      mergeDoc(ld, cleanDoc(rd));
      for (const img of imagesOfDoc(ld)) before.delete(img.id);
      for (const id of before) { try { await db.imgDelete(id); } catch {} } // Fotos, die nicht mehr vorkommen
    } else if ((rd.updatedAt || 0) > (ld.updatedAt || 0)) {
      // Remote ist neuer -> lokal ersetzen (Objekt bleibt dasselbe)
      const oldRids = new Map(imagesOfDoc(ld).map((x) => [x.id, x.rid]));
      const oldIds = new Set(oldRids.keys());
      const oldRemote = ld.remote || {};
      const fresh = cleanDoc(rd);
      for (const k of Object.keys(ld)) delete ld[k];
      Object.assign(ld, fresh);
      ld.remote = { ...oldRemote, ...Object.fromEntries(Object.entries(fresh.remote).filter(([, v]) => v)) };
      for (const img of imagesOfDoc(ld)) {
        if (!img.rid && oldRids.get(img.id)) img.rid = oldRids.get(img.id);
        oldIds.delete(img.id);
      }
      for (const id of oldIds) { try { await db.imgDelete(id); } catch {} }
    } else {
      // Lokal ist neuer/gleich -> nur fehlende OneDrive-IDs übernehmen
      const rRids = new Map(imagesOfDoc(rd).map((x) => [x.id, x.rid]));
      for (const img of imagesOfDoc(ld)) if (!img.rid && rRids.get(img.id)) img.rid = rRids.get(img.id);
      ld.remote = ld.remote || {};
      for (const k of ["folderId", "baseName", "bilderId"]) {
        if (!ld.remote[k] && rd.remote && rd.remote[k]) ld.remote[k] = rd.remote[k];
      }
    }
  }

  const localIds = new Set(p.docs.map((d) => d.id));
  for (const rd of r.docs || []) {
    if (!localIds.has(rd.id) && !isDeleted(rd)) p.docs.push(cleanDoc(rd));
  }
  normalizeProject(p);
}

/* ---------- Was bleibt auf dem Gerät? ---------- */
async function applyCachePolicy(p) {
  for (const img of imagesOfProject(p)) {
    if (!img.rid) continue;
    try {
      const rec = await db.imgGet(img.id);
      if (p.fav) {
        if (!rec || !rec.archive) {
          const blob = await od.downloadBlob(img.rid);
          const thumb = (rec && rec.thumb) || (await makeThumb(blob));
          await db.imgPut({ id: img.id, archive: blob, thumb });
        }
      } else if (rec && rec.archive) {
        const thumb = rec.thumb || (await makeThumb(rec.archive));
        await db.imgPut({ id: img.id, thumb });
      }
    } catch (e) {
      if (e && e.authRequired) throw e;
      console.warn("Bild-Cache", img.id, e);
    }
  }
}

// Favorit entfernt -> Archivbilder (die schon online sind) vom Gerät löschen
export async function freeLocal(p) {
  if (p.fav || !od.isConfigured()) return;
  for (const img of imagesOfProject(p)) {
    if (!img.rid) continue;
    const rec = await db.imgGet(img.id);
    if (rec && rec.archive) {
      const thumb = rec.thumb || (await makeThumb(rec.archive));
      await db.imgPut({ id: img.id, thumb });
    }
  }
}
