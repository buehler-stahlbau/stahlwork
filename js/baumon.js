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

export const KINDS = ["vermieter", "monteure", "trupps", "einsaetze", "buehnen", "abwesenheiten", "farben"];
const FILE = "baumon.json";
const DUE_FILE = "abmelden.json";
const TOMB_MAX_AGE = 180 * 24 * 3600 * 1000;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ---------- Zustand ---------- */
// Jede Bühne ein eigener Eintrag: ältere Einträge mit Anzahl > 1 aufteilen.
// Feste Kennungen (<id>_2, <id>_3 …), damit zwei Geräte beim Aufteilen dasselbe Ergebnis erzeugen.
function splitBuehnen(m) {
  let changed = false;
  const now = Date.now();
  for (const b of Object.values(m.data.buehnen || {})) {
    const n = Number(b.anzahl) || 1;
    if (n <= 1) continue;
    for (let i = 2; i <= n; i++) {
      const id = `${b.id}_${i}`.slice(0, 64);
      if (!m.data.buehnen[id] && !m.tomb[id]) m.data.buehnen[id] = { ...b, id, anzahl: 1, updatedAt: now };
    }
    m.data.buehnen[b.id] = { ...b, anzahl: 1, updatedAt: now };
    changed = true;
  }
  return changed;
}
let splitChecked = null;
export function mon() {
  const st = S.state;
  if (!st.mon || typeof st.mon !== "object" || Array.isArray(st.mon)) st.mon = {};
  const m = st.mon;
  if (!m.data || typeof m.data !== "object") m.data = {};
  for (const k of KINDS) if (!m.data[k] || typeof m.data[k] !== "object" || Array.isArray(m.data[k])) m.data[k] = {};
  if (!m.tomb || typeof m.tomb !== "object") m.tomb = {};
  if (typeof m.rev !== "number") m.rev = 0;
  if (m.zoom === "tage") m.zoom = "personal";
  if (m.zoom === "wochen") m.zoom = "kompakt";
  if (!["kompakt", "personal", "buehnen"].includes(m.zoom)) m.zoom = "personal";
  if (splitChecked !== m) { splitChecked = m; if (splitBuehnen(m)) { m.dirty = true; m.rev++; } }
  return m;
}

// Bearbeiten: später nur die Montageleiter (Liste in config.js), bis dahin alle
export function canEdit() {
  // gemeinsame Ablage: Recht „BauMon“ aus der Rechte-Verwaltung
  if (od.getAblage && od.getAblage()) return !!(S.state.rights && S.state.rights.mon);
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

/* ---------- Feiertage Baden-Württemberg ---------- */
function easter(y) { // Gaußsche Osterformel (gregorianisch)
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), hh = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - hh - k) % 7, m = Math.floor((a + 11 * hh + 22 * l) / 451);
  const month = Math.floor((hh + l - 7 * m + 114) / 31), day = ((hh + l - 7 * m + 114) % 31) + 1;
  return dayStr(new Date(y, month - 1, day, 12));
}
const holCache = new Map();
export function holidaysBW(y) {
  if (holCache.has(y)) return holCache.get(y);
  const o = easter(y);
  const list = {
    [`${y}-01-01`]: "Neujahr", [`${y}-01-06`]: "Heilige Drei Könige", [addDays(o, -2)]: "Karfreitag", [addDays(o, 1)]: "Ostermontag",
    [`${y}-05-01`]: "Tag der Arbeit", [addDays(o, 39)]: "Christi Himmelfahrt", [addDays(o, 50)]: "Pfingstmontag", [addDays(o, 60)]: "Fronleichnam",
    [`${y}-10-03`]: "Tag der Deutschen Einheit", [`${y}-11-01`]: "Allerheiligen", [`${y}-12-25`]: "1. Weihnachtstag", [`${y}-12-26`]: "2. Weihnachtstag",
  };
  holCache.set(y, list);
  return list;
}
export function holiday(day) { return holidaysBW(Number(day.slice(0, 4)))[day] || ""; }

// angezeigter Zeitraum: aktuelle Woche + zwei kommende
export function range() {
  const start = mondayOf(today());
  return { start, end: addDays(start, 20) };
}

/* ---------- Auswertungen ---------- */
// Trupp heißt wie sein Richtmeister (z. B. "Steeb"); ohne Richtmeister: eigener Name oder die Monteure
export function truppName(t) {
  if (!t) return "Ohne Trupp";
  if (t.name) return t.name;
  const f = get("monteure", t.fuehrerId);
  if (f) return f.name;
  const names = (t.monteure || []).map((id) => get("monteure", id)).filter(Boolean).map((m) => m.name);
  return names.length ? names.slice(0, 2).join(", ") + (names.length > 2 ? " …" : "") : "Trupp";
}
export function baustelleLabel(x) {
  return [x.bvNumber, x.baustelle].filter(Boolean).join(" ") || "Baustelle";
}
// Trupps alphabetisch nach Name (= Richtmeister) – überall gleich: Übersicht, Planung, PDF, Stammdaten
export function sortedTrupps() {
  return list("trupps").sort((a, b) => (isMalerTrupp(a) - isMalerTrupp(b)) || truppName(a).localeCompare(truppName(b), "de", { sensitivity: "base" }));
}
export function sortedMonteure(all = false) {
  return list("monteure").filter((x) => all || x.aktiv !== false).sort((a, b) => a.name.localeCompare(b.name));
}
// Namen übernehmen: Richtmeister (je mit eigenem Trupp) und Monteure; Vorhandene werden nicht doppelt angelegt
export function importPeople({ rm = [], m = [], maler = [] }) {
  const clean = (a) => [...new Set((a || []).map((x) => String(x).trim().slice(0, 80)).filter(Boolean))];
  const byName = new Map(list("monteure").map((x) => [x.name.toLowerCase(), x]));
  let neuM = 0, neuRm = 0, neuT = 0, neuMa = 0;
  // Richtmeister und Maler bekommen je eine eigene Zeile (Trupp) in der Planung
  const withTrupp = (name, kat) => {
    let p = byName.get(name.toLowerCase());
    if (!p) { p = put("monteure", { name, aktiv: true, rm: kat === "rm", maler: kat === "maler" }); byName.set(name.toLowerCase(), p); kat === "rm" ? neuRm++ : neuMa++; }
    else if (kind(p) !== kat) p = put("monteure", { ...p, rm: kat === "rm", maler: kat === "maler", aktiv: true });
    if (ensureTrupp(p)) neuT++;
  };
  for (const name of clean(rm)) withTrupp(name, "rm");
  for (const name of clean(maler)) withTrupp(name, "maler");
  for (const name of clean(m)) {
    if (!byName.has(name.toLowerCase())) { const p = put("monteure", { name, aktiv: true, rm: false, maler: false }); byName.set(name.toLowerCase(), p); neuM++; }
  }
  return { neuRm, neuM, neuT, neuMa };
}
// Person löschen: aus Trupps, Einsätzen (inkl. Tages-Ausnahmen) und Krank/Urlaub entfernen.
// Führt sie einen Trupp ohne weitere Mitglieder, wird der Trupp aufgelöst (Einsätze -> „Ohne Trupp“).
export function personUsage(id) {
  const ts = list("trupps");
  const own = ts.filter((t) => t.fuehrerId === id);
  return {
    einsaetze: list("einsaetze").filter((e) => (e.monteure || []).includes(id)).length,
    fuehrt: own.map((t) => truppName(t)),
    truppWeg: own.filter((t) => !(t.monteure || []).some((m) => m !== id)),
    trupps: ts.filter((t) => t.fuehrerId !== id && (t.monteure || []).includes(id)).length,
    abw: list("abwesenheiten").filter((a) => a.monteurId === id).length,
  };
}
export function removePerson(id) {
  for (const t of list("trupps")) {
    if (t.fuehrerId !== id && !(t.monteure || []).includes(id)) continue;
    const rest = (t.monteure || []).filter((m) => m !== id);
    if (t.fuehrerId === id && !rest.length) {
      for (const e of list("einsaetze").filter((e) => e.truppId === t.id)) put("einsaetze", { ...e, truppId: null });
      remove("trupps", t.id);
    } else put("trupps", { ...t, monteure: rest, fuehrerId: t.fuehrerId === id ? null : t.fuehrerId });
  }
  for (const e of list("einsaetze")) {
    if (!(e.monteure || []).includes(id) && !(e.off && e.off[id])) continue;
    const off = { ...(e.off || {}) }; delete off[id];
    put("einsaetze", { ...e, monteure: (e.monteure || []).filter((m) => m !== id), off });
  }
  for (const a of list("abwesenheiten").filter((a) => a.monteurId === id)) remove("abwesenheiten", a.id);
  remove("monteure", id);
}
/* ---------- Feste Farbe je BV ----------
   Ein BV bekommt beim ersten Erscheinen in der Planung eine Farbe, die dann dauerhaft bleibt
   (App, PDF, alle Geräte – wird mit den BauMon-Daten abgeglichen). Gewählt wird die Farbe,
   die bei den aktuell laufenden/kommenden BV am wenigsten vorkommt. */
export const PALETTE = [
  "#2e5b8a", "#5b7f3a", "#a07a14", "#6a4c8c", "#2e7f7a", "#8c3f52", "#c0622f", "#5f5e59", "#4a90b8", "#b0567d", "#7d8c2e", "#3d3d6b",
  "#8a5a2e", "#2f6b4f", "#7a3b8f", "#1f7a8c", "#9c4a1a", "#4f6d2a", "#b5476a", "#3f5fa8", "#7b6b2a", "#5a3e6e", "#2a8a5c", "#6b7a8f",
];
const colorKey = (x) => (x.bvNumber ? "#" + x.bvNumber : "n:" + (x.baustelle || "").trim().toLowerCase());
function hashStr(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; return h; }
const colorId = (key) => (key.startsWith("#") ? "f" + key.slice(1) : "fn" + hashStr(key).toString(36));
export function colorOf(x) {
  const key = colorKey(x);
  const r = get("farben", colorId(key));
  return PALETTE[(r ? r.farbe : hashStr(key)) % PALETTE.length];
}
export function ensureColors(items) {
  if (!canEdit()) return false;
  const first = new Map();
  for (const x of items) {
    const k = colorKey(x);
    if (get("farben", colorId(k))) continue;
    const v = x.von || x.bis || "";
    if (!first.has(k) || v < first.get(k)) first.set(k, v);
  }
  if (!first.size) return false;
  // Farben der laufenden/kommenden BV (letzte 4 Wochen bis Zukunft) zählen
  const from = addDays(today(), -28);
  const active = new Set([...list("einsaetze").filter((e) => e.bis >= from), ...list("buehnen").filter((b) => !b.abgemeldetAm && (b.bis || "") >= from)].map(colorKey));
  const use = new Array(PALETTE.length).fill(0);
  for (const k of active) { const r = get("farben", colorId(k)); if (r) use[r.farbe % PALETTE.length]++; }
  const keys = [...first.keys()].sort((a, b) => first.get(a).localeCompare(first.get(b)) || a.localeCompare(b));
  for (const k of keys) {
    let best = 0;
    for (let i = 1; i < use.length; i++) if (use[i] < use[best]) best = i;
    put("farben", { id: colorId(k), key: k, farbe: best });
    use[best]++;
  }
  return true;
}
// Farbe eines BV bewusst ändern (nächste freie Farbe)
export function nextColor(x) {
  const key = colorKey(x), id = colorId(key);
  const r = get("farben", id);
  const cur = r ? r.farbe : hashStr(key) % PALETTE.length;
  put("farben", { id, key, farbe: (cur + 1) % PALETTE.length });
}

// Kategorie einer Person: "rm" (Richtmeister), "maler" oder "monteur"
export function kind(p) { return p && p.maler ? "maler" : p && p.rm ? "rm" : "monteur"; }
export const PERSON_KINDS = { rm: "Richtmeister", monteur: "Monteur", maler: "Maler" };
function ensureTrupp(p) {
  if (list("trupps").some((t) => t.fuehrerId === p.id)) return false;
  put("trupps", { name: "", fuehrerId: p.id, monteure: [p.id], sort: list("trupps").length });
  return true;
}
export function setKind(p, k) {
  const np = put("monteure", { ...p, rm: k === "rm", maler: k === "maler" });
  if (k !== "monteur") ensureTrupp(np);
  return np;
}
// Maler-Zeile? (Trupp, dessen "Richtmeister" ein Maler ist)
export function isMalerTrupp(t) { const f = t && t.fuehrerId && get("monteure", t.fuehrerId); return !!(f && f.maler); }

// Doppelt eingeteilt? Monteure (auch Richtmeister) dürfen je Tag nur in EINEM Trupp stehen.
// Derselbe Trupp darf zwei Baustellen am Tag haben (Wechsel, Kurzeinsatz).
// Liefert je betroffener Person den anderen Einsatz.
export function conflicts(e, ids = e.monteure) {
  const out = [];
  if (!e.von || !e.bis) return out;
  const off = e.off || {};
  for (const o of list("einsaetze")) {
    if (o.id === e.id || o.bis < e.von || o.von > e.bis) continue;
    if (e.truppId && o.truppId === e.truppId) continue; // gleicher Trupp: zwei Baustellen erlaubt
    const from = o.von > e.von ? o.von : e.von, to = o.bis < e.bis ? o.bis : e.bis;
    for (const mid of ids || []) {
      if (!(o.monteure || []).includes(mid)) continue;
      for (let d = from; d <= to; d = addDays(d, 1)) {
        if (!(off[mid] || []).includes(d) && !isAbsent(mid, d) && present(o, mid, d)) { out.push({ monteurId: mid, other: o, day: d }); break; }
      }
    }
  }
  return out;
}
// Neuer Einsatz: Sa/So standardmäßig nicht eingeplant (je Tag änderbar). Nur Wochenende -> nichts aussparen.
export function weekendOff(e) {
  const we = [];
  let work = false;
  for (let d = e.von; d && d <= e.bis; d = addDays(d, 1)) { if (["Sa", "So"].includes(wdName(d))) we.push(d); else work = true; }
  const off = {};
  for (const [k, v] of Object.entries(e.off || {})) off[k] = v.slice();
  if (!work || !we.length) return off;
  for (const mid of e.monteure || []) off[mid] = [...new Set([...(off[mid] || []), ...we])].sort();
  return off;
}
// Doppelbelegung übergehen: betroffene Personen an den Tagen, an denen sie woanders eingeplant sind,
// hier nicht einplanen (bleiben bei der anderen Baustelle). Ganz belegt -> aus der Besetzung nehmen.
export function withoutConflicts(e) {
  const off = {};
  for (const [k, v] of Object.entries(e.off || {})) off[k] = v.slice();
  for (const o of list("einsaetze")) {
    if (o.id === e.id || o.bis < e.von || o.von > e.bis) continue;
    if (e.truppId && o.truppId === e.truppId) continue;
    const from = o.von > e.von ? o.von : e.von, to = o.bis < e.bis ? o.bis : e.bis;
    for (const mid of e.monteure || []) {
      for (let d = from; d <= to; d = addDays(d, 1)) {
        if (present(o, mid, d) && !(off[mid] || []).includes(d)) (off[mid] = off[mid] || []).push(d);
      }
    }
  }
  let n = 0; for (let d = e.von; d <= e.bis; d = addDays(d, 1)) n++;
  const monteure = (e.monteure || []).filter((mid) => (off[mid] || []).length < n);
  const next = { ...e, monteure, off };
  next.off = cleanOff(next);
  return next;
}
// Ist die Person an diesem Tag auf dem Einsatz? (eingeplant, nicht ausgenommen, nicht krank/Urlaub)
export function present(e, pid, day) {
  return (e.monteure || []).includes(pid) && day >= e.von && day <= e.bis && !((e.off || {})[pid] || []).includes(day) && !isAbsent(pid, day);
}
export function isAbsent(pid, day) { return list("abwesenheiten").some((a) => a.monteurId === pid && a.von <= day && a.bis >= day); }
export function absentRec(pid, day) { return list("abwesenheiten").find((a) => a.monteurId === pid && a.von <= day && a.bis >= day) || null; }
// Abweichungen aufräumen: nur Tage im Zeitraum, nur eingeplante Personen
export function cleanOff(e) {
  const out = {};
  for (const [pid, ds] of Object.entries(e.off || {})) {
    if (!(e.monteure || []).includes(pid)) continue;
    const keep = ds.filter((d) => d >= e.von && d <= e.bis);
    if (keep.length) out[pid] = keep;
  }
  return out;
}
export function shiftOff(off, delta) {
  const out = {};
  for (const [pid, ds] of Object.entries(off || {})) out[pid] = ds.map((d) => addDays(d, delta));
  return out;
}
// Person an einem Tag auf einem Einsatz ein-/austragen. Liefert eine Fehlermeldung oder null.
export function toggleDay(e, pid, day) {
  const p = get("monteure", pid);
  if (!p) return "Person nicht gefunden.";
  if (present(e, pid, day)) {
    const off = { ...(e.off || {}) };
    off[pid] = [...new Set([...(off[pid] || []), day])].sort();
    let crew = e.monteure.slice();
    // an keinem Tag mehr dabei -> ganz aus dem Einsatz nehmen
    let all = true;
    for (let d = e.von; d <= e.bis; d = addDays(d, 1)) if (!off[pid].includes(d)) { all = false; break; }
    if (all) { crew = crew.filter((x) => x !== pid); delete off[pid]; }
    put("einsaetze", { ...e, monteure: crew, off });
    return null;
  }
  const tr = get("trupps", e.truppId);
  if (tr && isMalerTrupp(tr) && pid !== tr.fuehrerId) return "Maler-Trupps bestehen nur aus dem Maler.";
  const a = absentRec(pid, day);
  if (a) return `${p.name} ist an diesem Tag ${ABW_TYPES[a.typ] === "Krank" ? "krank" : "im Urlaub"}.`;
  for (const o of list("einsaetze")) {
    if (o.id === e.id || (e.truppId && o.truppId === e.truppId)) continue;
    if (present(o, pid, day)) return `${p.name} ist an diesem Tag schon bei ${baustelleLabel(o)} (${truppName(get("trupps", o.truppId))}).`;
  }
  const off = { ...(e.off || {}) };
  let crew = e.monteure.slice();
  if (!crew.includes(pid)) {
    crew.push(pid);
    const ds = [];
    for (let d = e.von; d <= e.bis; d = addDays(d, 1)) if (d !== day) ds.push(d);
    if (ds.length) off[pid] = ds; else delete off[pid];
  } else {
    off[pid] = (off[pid] || []).filter((d) => d !== day);
    if (!off[pid].length) delete off[pid];
  }
  put("einsaetze", { ...e, monteure: crew, off });
  return null;
}
// Höchstens zwei Baustellen je Trupp und Tag. Liefert den ersten Tag, an dem es mehr wären (sonst null).
export const MAX_SITES_PER_DAY = 2;
export function overbooked(e) {
  if (!e.truppId || !e.von || !e.bis) return null;
  const others = list("einsaetze").filter((o) => o.id !== e.id && o.truppId === e.truppId && o.von <= e.bis && o.bis >= e.von);
  if (others.length < MAX_SITES_PER_DAY) return null;
  for (let d = e.von; d <= e.bis; d = addDays(d, 1)) {
    if (others.filter((o) => o.von <= d && o.bis >= d).length >= MAX_SITES_PER_DAY) return d;
  }
  return null;
}
export function overbookedText(e, d) {
  return `${truppName(get("trupps", e.truppId))} hat am ${longDate(d)} schon ${MAX_SITES_PER_DAY} Baustellen – mehr sind je Tag nicht möglich.`;
}

// Krank / Urlaub
export const ABW_TYPES = { urlaub: "Urlaub", krank: "Krank" };
export function absences(monteurId, von, bis) {
  return list("abwesenheiten").filter((a) => a.monteurId === monteurId && a.von && a.bis && a.von <= bis && a.bis >= von);
}
export function absentOn(day) {
  return list("abwesenheiten").filter((a) => a.monteurId && a.von <= day && a.bis >= day && get("monteure", a.monteurId));
}
// Eingeplante Personen, die im Zeitraum krank sind oder Urlaub haben
export function absenceConflicts(e, ids = e.monteure) {
  const out = [];
  if (!e.von || !e.bis) return out;
  for (const mid of ids || []) for (const a of absences(mid, e.von, e.bis)) out.push({ monteurId: mid, abw: a });
  return out; // nur noch als Hinweis: an diesen Tagen ist die Person automatisch nicht eingeteilt
}
export function absenceText(list) {
  return list.slice(0, 6).map((c) => `${(get("monteure", c.monteurId) || {}).name || "?"}: ${ABW_TYPES[c.abw.typ]} ${shortDate(c.abw.von)}–${shortDate(c.abw.bis)}`).join("\n");
}

export function conflictText(list) {
  return list.slice(0, 6).map((c) => {
    const p = get("monteure", c.monteurId);
    const o = c.other;
    const von = o.von > "" ? `${shortDate(o.von)}–${shortDate(o.bis)}` : "";
    return `${p ? p.name : "?"}: schon bei ${baustelleLabel(o)} (${truppName(get("trupps", o.truppId))}, ${von})`;
  }).join("\n") + (list.length > 6 ? `\n… und ${list.length - 6} weitere` : "");
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

// Bühnen von Vermietern, die abgemeldet werden müssen (ab dem Werktag vor dem Mietende)
// Abmelden fällig ab dem Werktag (Mo–Fr, ohne Feiertage) VOR dem Mietende:
// Mietende Di 24.11. -> rot ab Mo 23.11.; Mietende Mo 30.11. -> rot ab Fr 27.11.
export function abmeldenAb(b) {
  let d = addDays(b.bis, -1);
  while (["Sa", "So"].includes(wdName(d)) || holiday(d)) d = addDays(d, -1);
  return d;
}
export function isDue(b, day = today()) {
  return !b.abgemeldetAm && !!b.bis && abmeldenAb(b) <= day;
}
export function dueBuehnen(day = today()) {
  return list("buehnen")
    .filter((b) => isDue(b, day))
    .sort((a, b) => a.bis.localeCompare(b.bis));
}

/* ---------- Abmelde-E-Mail an den Vermieter ---------- */
export function buehneText(b) {
  const n = Number(b.anzahl) > 1 ? `${b.anzahl}x ` : "";
  return `${n}${b.typ || "Bühne"}`;
}
// Signatur: eigene aus den Einstellungen, sonst automatisch aus dem Microsoft-Profil + Firmenblock
export const SIG_FIRMA = [
  "Friedrich Bühler GmbH & Co. KG",
  "Daimlerstr. 7 + 11 · 72213 Altensteig",
];
export const SIG_RECHT = [
  "Kommanditgesellschaft, Sitz Altensteig, Registergericht Stuttgart HRA 340760",
  "Komplementär: Bühler GmbH, Sitz Altensteig, Registergericht Stuttgart HRB 340170",
  "Geschäftsführer: Dipl.-Ing. (FH) Ulrich Bühler, Dipl.-Ing. (FH) Volker Bühler",
];
export function autoSignature() {
  const p = S.state.prefs && S.state.prefs.profile;
  if (!p || !p.name) return "";
  // Fax mit gleicher Vorwahl wie Telefon kurz: "Tel. +49 (0) 7453 9398-93 · Fax -33"
  let fax = p.fax || "";
  const pre = p.phone.lastIndexOf("-");
  if (fax && pre > 0 && fax.startsWith(p.phone.slice(0, pre + 1))) fax = fax.slice(pre);
  const tel = [p.phone ? `Tel. ${p.phone}` : "", fax ? `Fax ${fax}` : ""].filter(Boolean).join(" · ");
  return [
    `i. A. ${p.name}`, ...(p.job ? [p.job] : []), "",
    ...SIG_FIRMA, "",
    ...(tel ? [tel] : []), ...(p.mobile ? [`Mobil ${p.mobile}`] : []), ...(tel || p.mobile ? [""] : []),
    ...(p.mail ? [p.mail] : []), "www.buehler-stahlbau.de", "",
    ...SIG_RECHT,
  ].join("\n");
}
export function ownSignature() { return String((S.state.prefs && S.state.prefs.mailSignature) || "").trim(); }
export function signature() { return ownSignature() || autoSignature(); }
export function abmeldeMail(vermieter, buehnen, absender) {
  const anrede = vermieter.ansprechpartner ? `Guten Tag ${vermieter.ansprechpartner},` : "Sehr geehrte Damen und Herren,";
  const sites = [...new Set(buehnen.map((b) => baustelleLabel(b)))];
  const subject = `Abmeldung Mietbühne${buehnen.length > 1 ? "n" : ""} – ${sites.join(", ")}`;
  const grouped = new Map();
  for (const b of buehnen) {
    const k = [b.typ, baustelleLabel(b), b.standort, b.auftragsNr, b.bis].join("|");
    if (grouped.has(k)) grouped.get(k).anzahl += Number(b.anzahl) || 1;
    else grouped.set(k, { ...b, anzahl: Number(b.anzahl) || 1 });
  }
  const lines = [...grouped.values()].map((b) => {
    const parts = [`- ${buehneText(b)}`, `Baustelle: ${baustelleLabel(b)}${b.standort ? ", " + b.standort : ""}`];
    if (b.auftragsNr) parts.push(`Ihre Auftrags-Nr.: ${b.auftragsNr}`);
    parts.push(`Mietende: ${longDate(b.bis)}`);
    return parts.join("\n  ");
  });
  const body = [
    anrede, "",
    `hiermit melden wir folgende Mietbühne${buehnen.length > 1 ? "n" : ""} ab und bitten um Abholung:`, "",
    ...lines, "",
    // Signatur: eigene (Einstellungen) oder automatisch aus dem Microsoft-Profil – sonst Name + Firma
    ...(signature() ? [...(/gr(u|ü)(ß|ss)/i.test(signature().split("\n")[0]) ? [] : ["Mit freundlichen Grüßen", ""]), signature()] : ["Mit freundlichen Grüßen", "", absender ? `i. A. ${absender}` : "", "", ...SIG_FIRMA, "www.buehler-stahlbau.de"]),
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
      return { buehne: buehneText(b), baustelle: baustelleLabel(b), bis: b.bis, vermieter: v ? v.firma : "Bühler (eigene)", email: v ? v.email || "" : "" };
    });
    const text = rows.map((r) => `- ${r.buehne} – ${r.baustelle} – ${r.vermieter} (Mietende ${longDate(r.bis)})`).join("\n");
    const html = rows.length
      ? `<p>Diese Bühnen können abgemeldet werden:</p><ul>${rows.map((r) => `<li><b>${esc(r.buehne)}</b> – ${esc(r.baustelle)} – ${esc(r.vermieter)} (Mietende ${esc(longDate(r.bis))})</li>`).join("")}</ul>`
      : "";
    tage[day] = { anzahl: rows.length, text, html, buehnen: rows };
  }
  return { format: "stahlwork-buehnen-abmelden", version: 1, stand: new Date().toISOString(), tage };
}

/* ---------- Abgleich mit OneDrive ---------- */
function offMap(v) {
  const out = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [k, arr] of Object.entries(v)) {
    if (!ID_RE.test(k) || !Array.isArray(arr)) continue;
    const ds = [...new Set(arr.filter((d) => typeof d === "string" && DAY_RE.test(d)))].slice(0, 400).sort();
    if (ds.length) out[k] = ds;
  }
  return out;
}
function cleanRecord(kind, r) {
  if (!r || typeof r !== "object" || !ID_RE.test(String(r.id || ""))) return null;
  const s = (v, n = 200) => (typeof v === "string" ? v.slice(0, n) : "");
  const day = (v) => (typeof v === "string" && DAY_RE.test(v) ? v : "");
  const ids = (v) => (Array.isArray(v) ? v.filter((x) => ID_RE.test(String(x))) : []);
  const base = { id: r.id, updatedAt: Number(r.updatedAt) || 0 };
  switch (kind) {
    case "vermieter": return { ...base, firma: s(r.firma), ansprechpartner: s(r.ansprechpartner), email: s(r.email), telefon: s(r.telefon), kundenNr: s(r.kundenNr) };
    case "monteure": return { ...base, name: s(r.name), aktiv: r.aktiv !== false, rm: r.rm === true && r.maler !== true, maler: r.maler === true };
    case "trupps": return { ...base, name: s(r.name), fuehrerId: ID_RE.test(String(r.fuehrerId || "")) ? r.fuehrerId : null, monteure: ids(r.monteure), sort: Number(r.sort) || 0 };
    case "einsaetze": return { ...base, truppId: ID_RE.test(String(r.truppId || "")) ? r.truppId : null, bvNumber: /^\d{5}$/.test(r.bvNumber || "") ? r.bvNumber : "",
      baustelle: s(r.baustelle), von: day(r.von), bis: day(r.bis), monteure: ids(r.monteure), off: offMap(r.off), leih: s(r.leih, 500), kran: s(r.kran), notiz: s(r.notiz, 2000) };
    case "abwesenheiten": return { ...base, monteurId: ID_RE.test(String(r.monteurId || "")) ? r.monteurId : null,
      typ: r.typ === "krank" ? "krank" : "urlaub", von: day(r.von), bis: day(r.bis), notiz: s(r.notiz, 500) };
    case "farben": return { ...base, key: s(r.key, 160), farbe: Number.isInteger(r.farbe) && r.farbe >= 0 && r.farbe < 64 ? r.farbe : 0 };
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
  m.tomb = tomb;
  if (splitBuehnen(m)) localNewer = true; // ältere Geräte: Anzahl > 1 aufteilen
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
