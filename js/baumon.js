/* =========================================================
   BauMon – Daten und Abgleich

   Ablage in OneDrive:
     Stahlwork/BauMon/_daten/
       baumon.json     <- Stammdaten + Einteilung (für die App)
       abmelden.json   <- fällige Bühnen je Tag (für die tägliche E-Mail, Power Automate)

   Datensätze je Art (vermieter, monteure, trupps, einsaetze, buehnen) mit
   eigener ID und Änderungszeit. Beim Abgleich gewinnt je Datensatz der neuere
   Stand; Gelöschtes wird über "Grabsteine" gemerkt.
========================================================= */
import * as od from "./onedrive.js";
import { CONFIG } from "./config.js";
import { S, saveSoon } from "./store.js";
import { newId } from "./util.js";

export const KINDS = ["vermieter", "monteure", "trupps", "einsaetze", "buehnen"];
const FILE = "baumon.json";
const DUE_FILE = "abmelden.json";
const TOMB_MAX_AGE = 180 * 24 * 3600 * 1000;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ---------- Zustand ---------- */
export function mon() {
  const st = S.state;
  if (!st.mon || typeof st.mon !== "object" || Array.isArray(st.mon)) st.mon = {};
  const m = st.mon;
  if (!m.data || typeof m.data !== "object") m.data = {};
  for (const k of KINDS) if (!m.data[k] || typeof m.data[k] !== "object" || Array.isArray(m.data[k])) m.data[k] = {};
  if (!m.tomb || typeof m.tomb !== "object") m.tomb = {};
  if (typeof m.rev !== "number") m.rev = 0;
  if (!["tage", "wochen"].includes(m.zoom)) m.zoom = "tage";
  return m;
}

// Bearbeiten: später nur die Montageleiter (Liste in config.js), bis dahin alle
export function canEdit() {
  const list = (CONFIG.monEditors || []).map((x) => String(x).toLowerCase());
  if (!list.length) return true;
  const acc = od.getAccount && od.getAccount();
  return !!(acc && list.includes(String(acc.username || "").toLowerCase()));
}

export function list(kind) { return Object.values(mon().data[kind]); }
export function get(kind, id) { return id ? mon().data[kind][id] || null : null; }

export function put(kind, rec) {
  const m = mon();
  if (!rec.id) rec.id = newId();
  rec.updatedAt = Date.now();
  m.data[kind][rec.id] = rec;
  m.dirty = true;
  m.rev++;
  saveSoon();
  return rec;
}

export function remove(kind, id) {
  const m = mon();
  if (!m.data[kind][id]) return;
  delete m.data[kind][id];
  m.tomb[id] = Date.now();
  m.dirty = true;
  m.rev++;
  saveSoon();
}

/* ---------- Datum ---------- */
export function dayStr(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}
export function today() { return dayStr(new Date()); }
export function parseDay(s) { const [y, mo, d] = s.split("-").map(Number); return new Date(y, mo - 1, d, 12); }
export function addDays(s, n) { const d = parseDay(s); d.setDate(d.getDate() + n); return dayStr(d); }
export function mondayOf(s) { const d = parseDay(s); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return dayStr(d); }
export function isoWeek(s) {
  const d = parseDay(s);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(d.getFullYear(), 0, 4, 12);
  return 1 + Math.round(((d - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
export function wdName(s) { return WD[parseDay(s).getDay()]; }
export function shortDate(s) { const d = parseDay(s); return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.`; }
export function longDate(s) { const d = parseDay(s); return `${WD[d.getDay()]} ${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`; }

// angezeigter Zeitraum: Vorwoche, aktuelle Woche, nächste Woche
export function range() {
  const start = addDays(mondayOf(today()), -7);
  return { start, end: addDays(start, 20) };
}

/* ---------- Auswertungen ---------- */
export function truppName(t) {
  if (!t) return "Ohne Trupp";
  if (t.name) return t.name;
  const f = get("monteure", t.fuehrerId);
  return f ? `Trupp ${f.name}` : "Trupp";
}
export function baustelleLabel(x) {
  return [x.bvNumber, x.baustelle].filter(Boolean).join(" ") || "Baustelle";
}
export function sortedTrupps() {
  return list("trupps").sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || truppName(a).localeCompare(truppName(b)));
}
export function sortedMonteure(all = false) {
  return list("monteure").filter((x) => all || x.aktiv !== false).sort((a, b) => a.name.localeCompare(b.name));
}
export function activeOn(day) {
  return list("einsaetze").filter((e) => e.von <= day && e.bis >= day);
}
// gleiche Baustelle: gleiche BV-Nummer, sonst gleicher Name
export function sameSite(a, b) {
  if (a.bvNumber || b.bvNumber) return !!a.bvNumber && a.bvNumber === b.bvNumber;
  return (a.baustelle || "").trim().toLowerCase() === (b.baustelle || "").trim().toLowerCase();
}
export function buehnenOf(site) { return list("buehnen").filter((b) => sameSite(b, site)); }

// Bühnen von Vermietern, die ab dem Tag "benötigt bis" abgemeldet werden können
export function dueBuehnen(day = today()) {
  return list("buehnen")
    .filter((b) => !b.abgemeldetAm && b.vermieterId && b.bis && b.bis <= day)
    .sort((a, b) => a.bis.localeCompare(b.bis));
}

/* ---------- Abmelde-E-Mail an den Vermieter ---------- */
export function buehneText(b) {
  const n = Number(b.anzahl) > 1 ? `${b.anzahl}x ` : "";
  return `${n}${b.typ || "Bühne"}`;
}
export function abmeldeMail(vermieter, buehnen, absender) {
  const anrede = vermieter.ansprechpartner ? `Guten Tag ${vermieter.ansprechpartner},` : "Sehr geehrte Damen und Herren,";
  const sites = [...new Set(buehnen.map((b) => baustelleLabel(b)))];
  const subject = `Abmeldung Mietbühne${buehnen.length > 1 ? "n" : ""} – ${sites.join(", ")}`;
  const lines = buehnen.map((b) => {
    const parts = [`- ${buehneText(b)}`, `Baustelle: ${baustelleLabel(b)}${b.standort ? ", " + b.standort : ""}`];
    if (b.auftragsNr) parts.push(`Ihre Auftrags-Nr.: ${b.auftragsNr}`);
    parts.push(`benötigt bis: ${longDate(b.bis)}`);
    return parts.join("\n  ");
  });
  const body = [
    anrede, "",
    `hiermit melden wir folgende Mietbühne${buehnen.length > 1 ? "n" : ""} ab und bitten um Abholung:`, "",
    ...lines, "",
    "Vielen Dank und freundliche Grüße", absender || "", CONFIG.companyName || "Friedrich Bühler GmbH & Co. KG",
  ].join("\n");
  return `mailto:${encodeURIComponent(vermieter.email || "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/* ---------- Datei für die tägliche E-Mail (Power Automate) ----------
   Je Tag (heute + 60 Tage) die bis dahin fälligen, nicht abgemeldeten Bühnen –
   fertig als Text/HTML, damit der Ablauf nur noch den heutigen Tag auslesen muss. */
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export function dueFile() {
  const t0 = today();
  const tage = {};
  for (let i = 0; i <= 60; i++) {
    const day = addDays(t0, i);
    const due = dueBuehnen(day);
    const rows = due.map((b) => {
      const v = get("vermieter", b.vermieterId);
      return { buehne: buehneText(b), baustelle: baustelleLabel(b), bis: b.bis, vermieter: v ? v.firma : "", email: v ? v.email || "" : "" };
    });
    const text = rows.map((r) => `- ${r.buehne} – ${r.baustelle} – ${r.vermieter} (benötigt bis ${longDate(r.bis)})`).join("\n");
    const html = rows.length
      ? `<p>Diese Bühnen können abgemeldet werden:</p><ul>${rows.map((r) => `<li><b>${esc(r.buehne)}</b> – ${esc(r.baustelle)} – ${esc(r.vermieter)} (benötigt bis ${esc(longDate(r.bis))})</li>`).join("")}</ul>`
      : "";
    tage[day] = { anzahl: rows.length, text, html, buehnen: rows };
  }
  return { format: "stahlwork-buehnen-abmelden", version: 1, stand: new Date().toISOString(), tage };
}

/* ---------- Abgleich mit OneDrive ---------- */
function cleanRecord(kind, r) {
  if (!r || typeof r !== "object" || !ID_RE.test(String(r.id || ""))) return null;
  const s = (v, n = 200) => (typeof v === "string" ? v.slice(0, n) : "");
  const day = (v) => (typeof v === "string" && DAY_RE.test(v) ? v : "");
  const ids = (v) => (Array.isArray(v) ? v.filter((x) => ID_RE.test(String(x))) : []);
  const base = { id: r.id, updatedAt: Number(r.updatedAt) || 0 };
  switch (kind) {
    case "vermieter": return { ...base, firma: s(r.firma), ansprechpartner: s(r.ansprechpartner), email: s(r.email), telefon: s(r.telefon), kundenNr: s(r.kundenNr) };
    case "monteure": return { ...base, name: s(r.name), aktiv: r.aktiv !== false };
    case "trupps": return { ...base, name: s(r.name), fuehrerId: ID_RE.test(String(r.fuehrerId || "")) ? r.fuehrerId : null, monteure: ids(r.monteure), sort: Number(r.sort) || 0 };
    case "einsaetze": return { ...base, truppId: ID_RE.test(String(r.truppId || "")) ? r.truppId : null, bvNumber: /^\d{5}$/.test(r.bvNumber || "") ? r.bvNumber : "",
      baustelle: s(r.baustelle), von: day(r.von), bis: day(r.bis), monteure: ids(r.monteure), leih: s(r.leih, 500), kran: s(r.kran), notiz: s(r.notiz, 2000) };
    case "buehnen": return { ...base, bvNumber: /^\d{5}$/.test(r.bvNumber || "") ? r.bvNumber : "", baustelle: s(r.baustelle), standort: s(r.standort),
      vermieterId: ID_RE.test(String(r.vermieterId || "")) ? r.vermieterId : null, typ: s(r.typ), anzahl: Math.max(1, Math.min(99, Number(r.anzahl) || 1)),
      von: day(r.von), bis: day(r.bis), abgemeldetAm: day(r.abgemeldetAm), auftragsNr: s(r.auftragsNr), notiz: s(r.notiz, 1000) };
  }
  return null;
}

function mergeRemote(m, remote) {
  const now = Date.now();
  const tomb = { ...m.tomb };
  for (const [id, at] of Object.entries((remote && remote.tomb) || {})) {
    if (ID_RE.test(id) && Number(at) > (tomb[id] || 0)) tomb[id] = Number(at);
  }
  // localNewer = OneDrive-Stand muss aktualisiert werden
  let localNewer = false;
  for (const kind of KINDS) {
    const r = (remote && remote.data && remote.data[kind]) || {};
    const out = {};
    const ids = new Set([...Object.keys(m.data[kind]), ...Object.keys(r)]);
    for (const id of ids) {
      const a = m.data[kind][id];
      const b = cleanRecord(kind, r[id]);
      const pick = a && b ? ((a.updatedAt || 0) > (b.updatedAt || 0) ? a : b) : a || b;
      if (tomb[id] && tomb[id] >= (pick.updatedAt || 0)) {
        if (b) localNewer = true; // in OneDrive noch vorhanden -> dort löschen
        continue;
      }
      if (pick !== b) localNewer = true; // fehlt in OneDrive oder dort älter
      out[id] = pick;
    }
    m.data[kind] = out;
  }
  for (const id of Object.keys(tomb)) if (now - tomb[id] > TOMB_MAX_AGE) delete tomb[id];
  const rt = (remote && remote.tomb) || {};
  if (Object.keys(tomb).some((id) => !rt[id])) localNewer = true;
  m.tomb = tomb;
  return localNewer;
}

function fingerprint(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + ":" + str.length;
}

// Gibt true zurück, wenn sich durch den Abgleich etwas geändert hat
export async function syncMon({ full = false } = {}) {
  const m = mon();
  if (!full && !m.dirty) return false;
  const appDir = await od.getAppFolder();
  const dir = await od.ensureFolder(appDir.id, CONFIG.monFolder || "BauMon");
  const dd = await od.ensureFolder(dir.id, CONFIG.dataFolder);
  const before = JSON.stringify(m.data);
  for (let attempt = 0; attempt < 3; attempt++) {
    const remote = await od.getJson(dd.id, FILE);
    const rev = m.rev;
    let upload = m.dirty || !remote;
    if (remote && remote.eTag !== m.etag) upload = mergeRemote(m, remote.data) || upload;
    if (upload && canEdit()) {
      const res = await od.putJson(dd.id, FILE, { format: "stahlwork-baumon", version: 1, data: m.data, tomb: m.tomb }, remote ? remote.eTag : null);
      if (res.conflict) continue;
      m.etag = res.eTag;
    } else if (remote) {
      m.etag = remote.eTag;
    }
    if (m.rev === rev) m.dirty = false;
    break;
  }
  // Datei für die tägliche E-Mail (nur wenn sich die fälligen Bühnen geändert haben oder ein neuer Tag ist)
  if (canEdit()) {
    const due = dueFile();
    const fp = fingerprint(JSON.stringify(due.tage));
    if (fp !== m.dueFp) {
      await od.putJson(dd.id, DUE_FILE, due, null);
      m.dueFp = fp;
    }
  }
  saveSoon();
  return JSON.stringify(m.data) !== before;
}
