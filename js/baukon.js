/* =========================================================
   BauKon – Einteilung der Konstrukteure: Daten und Abgleich

   Ablage in OneDrive:  Stahlwork/BauKon/_daten/baukon.json

   Datensätze je Art mit eigener ID und Änderungszeit. Beim Abgleich gewinnt je
   Datensatz der neuere Stand; Gelöschtes wird über "Grabsteine" gemerkt (wie BauMon).
     konstrukteure: { name, aktiv, azubi, schule: Rhythmus, teilzeit, frei: Rhythmus }
                    Rhythmus = { w2: 14-tägig?, a: [Wochentage Woche A], b: [Woche B], ref: Montag Woche A }
                    Wochentage 1 = Mo … 5 = Fr
     zuteilungen:   { kId, bvNumber, baustelle, von, bis, text, codes: { "JJJJ-MM-TT": "U" } }
     abwesenheiten: { kId, typ: urlaub|krank|ausgleich|schule|arbeit, von, bis, notiz }
                    "arbeit" = Ausnahme: Schul-/Teilzeit-freier Tag wird zum Arbeitstag
========================================================= */
import * as od from "./onedrive.js";
import { CONFIG } from "./config.js";
import { S, saveSoon } from "./store.js";
import { newId } from "./util.js";
import { addDays, mondayOf, parseDay, today, holiday, wdName, shortDate, longDate } from "./plan-core.js";

export const KINDS = ["konstrukteure", "zuteilungen", "abwesenheiten"];
const FILE = "baukon.json";
const TOMB_MAX_AGE = 180 * 24 * 3600 * 1000;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ---------- Kürzel ---------- */
export const STAHL = ["U", "W", "A", "V", "M", "D"];
export const ROH = ["B", "F", "S"];
export const CODE_NAMES = {
  U: "Übersichten", W: "Werkstattpläne", A: "Ableiten", V: "Verankerungspläne", M: "Modell", D: "Details",
  B: "Bewehrungspläne", F: "Fundamente", S: "Schalpläne",
};
// Art eines Balkens: "stahl" / "roh" nach den eingetragenen Kürzeln, "" = Platzhalter (noch ohne Kürzel)
export function artOf(z) {
  const cs = Object.values((z && z.codes) || {});
  if (cs.some((c) => STAHL.includes(c))) return "stahl";
  if (cs.some((c) => ROH.includes(c))) return "roh";
  return "";
}
export function codesFor(z) { const a = artOf(z); return a === "stahl" ? STAHL : a === "roh" ? ROH : [...STAHL, ...ROH]; }

/* ---------- Abwesenheit ---------- */
export const ABW_TYPES = { urlaub: "Urlaub", krank: "Krank", ausgleich: "Ausgleich", schule: "Schule" };
export const ABW_SHORT = { urlaub: "U", krank: "K", ausgleich: "A", schule: "S" };

/* ---------- Zustand ---------- */
let checked = null;
export function kon() {
  const st = S.state;
  if (!st.kon || typeof st.kon !== "object" || Array.isArray(st.kon)) st.kon = {};
  const m = st.kon;
  if (!m.data || typeof m.data !== "object") m.data = {};
  for (const k of KINDS) if (!m.data[k] || typeof m.data[k] !== "object" || Array.isArray(m.data[k])) m.data[k] = {};
  if (!m.tomb || typeof m.tomb !== "object") m.tomb = {};
  if (typeof m.rev !== "number") m.rev = 0;
  if (checked !== m) { checked = m; if (resolveConflicts(m)) { m.dirty = true; m.rev++; } }
  return m;
}

// Bearbeiten: im eigenen OneDrive immer, in der gemeinsamen Ablage mit dem Recht „BauKon“
export function canEdit() {
  if (od.getAblage && od.getAblage()) return !!(S.state.rights && S.state.rights.kon);
  return true;
}

export function list(kind) { return Object.values(kon().data[kind]); }
export function get(kind, id) { return id ? kon().data[kind][id] || null : null; }
let lastStamp = 0; // streng steigend: die zuletzt gespeicherte Eingabe ist immer die neueste
export function put(kind, rec) {
  const m = kon();
  if (!rec.id) rec.id = newId();
  rec.updatedAt = lastStamp = Math.max(Date.now(), lastStamp + 1);
  m.data[kind][rec.id] = rec;
  m.dirty = true;
  m.rev++;
  saveSoon();
  return rec;
}
export function remove(kind, id) {
  const m = kon();
  if (!m.data[kind][id]) return;
  delete m.data[kind][id];
  m.tomb[id] = Date.now();
  m.dirty = true;
  m.rev++;
  saveSoon();
}
// nach einer Änderung Widersprüche sofort auflösen (neueste Eingabe gilt)
export function settle() {
  const m = kon();
  if (resolveConflicts(m)) { m.dirty = true; m.rev++; saveSoon(); }
}

/* ---------- Werktage ---------- */
export function isWeekday(d) { return !["Sa", "So"].includes(wdName(d)); }
export function weekdayNum(d) { return (parseDay(d).getDay() + 6) % 7 + 1; } // 1 = Mo … 7 = So
export function nextWeekday(d) { while (!isWeekday(d)) d = addDays(d, 1); return d; }
export function prevWeekday(d) { while (!isWeekday(d)) d = addDays(d, -1); return d; }
// Werktage (Mo–Fr) von … bis
export function weekdays(von, bis) {
  const out = [];
  for (let d = von; d <= bis; d = addDays(d, 1)) if (isWeekday(d)) out.push(d);
  return out;
}
// um n Werktage verschieben (n darf negativ sein)
export function shiftWeekdays(d, n) {
  let x = d;
  const step = n < 0 ? -1 : 1;
  for (let i = 0; i < Math.abs(n); i++) { x = addDays(x, step); while (!isWeekday(x)) x = addDays(x, step); }
  return x;
}

/* ---------- Rhythmus (Schultage, Teilzeit) ---------- */
export function rhythmHit(r, d) {
  if (!r || !Array.isArray(r.a)) return false;
  const wd = weekdayNum(d);
  if (!r.w2) return r.a.includes(wd);
  const ref = mondayOf(r.ref && DAY_RE.test(r.ref) ? r.ref : d);
  const weeks = Math.round((parseDay(mondayOf(d)) - parseDay(ref)) / (7 * 86400000));
  return (((weeks % 2) + 2) % 2 === 0 ? r.a : r.b || []).includes(wd);
}
export function rhythmText(r) {
  if (!r || !(r.a || []).length && !(r.b || []).length) return "";
  const n = (xs) => (xs || []).slice().sort().map((x) => ["", "Mo", "Di", "Mi", "Do", "Fr"][x]).join(", ") || "–";
  return r.w2 ? `14-tägig: Woche A ${n(r.a)} · Woche B ${n(r.b)}` : `jede Woche ${n(r.a)}`;
}

export function absRec(kId, d) { return list("abwesenheiten").find((a) => a.kId === kId && a.von <= d && a.bis >= d) || null; }
// Was ist an diesem Tag mit der Person? null = normaler Arbeitstag
//   { typ: "feiertag" | urlaub | krank | ausgleich | schule | "frei", rec?, pattern?, name? }
export function dayInfo(k, d) {
  const hol = holiday(d);
  if (hol) return { typ: "feiertag", name: hol };
  const a = absRec(k.id, d);
  if (a && a.typ !== "arbeit") return { typ: a.typ, rec: a };
  if (a) return null; // Ausnahme: Arbeitstag
  if (k.azubi && rhythmHit(k.schule, d)) return { typ: "schule", pattern: true };
  if (k.teilzeit && rhythmHit(k.frei, d)) return { typ: "frei", pattern: true };
  return null;
}
export function arbeitRec(kId, d) { const a = absRec(kId, d); return a && a.typ === "arbeit" ? a : null; }

/* ---------- Auswertungen ---------- */
export function sortedKonstrukteure(all = false) {
  return list("konstrukteure").filter((x) => all || x.aktiv !== false).sort((a, b) => a.name.localeCompare(b.name, "de", { sensitivity: "base" }));
}
export function bvLabel(x) { return [x.bvNumber, x.baustelle].filter(Boolean).join(" ") || "Bauvorhaben"; }
// andere Zuteilungen derselben Person, die sich mit z überschneiden
export function overlaps(z) {
  return list("zuteilungen").filter((o) => o.id !== z.id && o.kId === z.kId && o.von <= z.bis && o.bis >= z.von);
}
export function overlapText(list) {
  return list.slice(0, 6).map((o) => `${bvLabel(o)} (${shortDate(o.von)}–${shortDate(o.bis)})`).join("\n");
}
export function personUsage(id) {
  return { zut: list("zuteilungen").filter((z) => z.kId === id).length, abw: list("abwesenheiten").filter((a) => a.kId === id).length };
}
export function removePerson(id) {
  for (const z of list("zuteilungen").filter((z) => z.kId === id)) remove("zuteilungen", z.id);
  for (const a of list("abwesenheiten").filter((a) => a.kId === id)) remove("abwesenheiten", a.id);
  remove("konstrukteure", id);
}

/* ---------- Widersprüche nach dem Abgleich (Ergebnis auf allen Geräten gleich) ---------- */
// Zeiträume derselben Person, die sich überschneiden: der zuletzt geänderte gilt,
// der ältere wird an diesen Tagen gekürzt (ggf. geteilt oder gelöscht)
function trimOverlaps(m, kind) {
  const D = m.data[kind];
  const byP = new Map();
  for (const a of Object.values(D)) {
    if (!a.kId || !a.von || !a.bis) continue;
    if (!byP.has(a.kId)) byP.set(a.kId, []);
    byP.get(a.kId).push(a);
  }
  let changed = false;
  const now = Date.now();
  for (const items of byP.values()) {
    if (items.length < 2) continue;
    items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) || a.id.localeCompare(b.id));
    const kept = [];
    for (const a of items) {
      let parts = [[a.von, a.bis]];
      for (const k of kept) {
        const next = [];
        for (const [v, b] of parts) {
          if (k.bis < v || k.von > b) { next.push([v, b]); continue; }
          if (v < k.von) next.push([v, addDays(k.von, -1)]);
          if (b > k.bis) next.push([addDays(k.bis, 1), b]);
        }
        parts = next;
      }
      // Zuteilungen: nur Werktage zählen (ein Rest nur aus Sa/So entfällt)
      if (kind === "zuteilungen") parts = parts.map(([v, b]) => [nextWeekday(v), prevWeekday(b)]).filter(([v, b]) => v <= b);
      if (parts.length === 1 && parts[0][0] === a.von && parts[0][1] === a.bis) { kept.push(a); continue; }
      changed = true;
      if (!parts.length) { delete D[a.id]; m.tomb[a.id] = now; continue; }
      parts.forEach(([v, b], i) => {
        const id = i === 0 ? a.id : `${a.id}-${i}`.slice(0, 64);
        const rec = { ...a, id, von: v, bis: b, updatedAt: a.updatedAt || 0 };
        if (kind === "zuteilungen") {
          const codes = {};
          for (const [d, c] of Object.entries(a.codes || {})) if (d >= v && d <= b) codes[d] = c;
          rec.codes = codes;
        }
        D[id] = rec;
        kept.push(rec);
      });
    }
  }
  return changed;
}
// dieselbe Person zweimal angelegt (gleicher Name) -> zu einer zusammenführen
function mergeDupPeople(m) {
  const D = m.data;
  const byName = new Map();
  for (const p of Object.values(D.konstrukteure)) {
    const k = String(p.name || "").trim().toLowerCase();
    if (!k) continue;
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(p);
  }
  let changed = false;
  const now = Date.now();
  for (const items of byName.values()) {
    if (items.length < 2) continue;
    items.sort((a, b) => a.id.localeCompare(b.id));
    const keep = items[0];
    for (const dup of items.slice(1)) {
      for (const kind of ["zuteilungen", "abwesenheiten"]) {
        for (const r of Object.values(D[kind])) if (r.kId === dup.id) D[kind][r.id] = { ...r, kId: keep.id, updatedAt: now };
      }
      delete D.konstrukteure[dup.id];
      m.tomb[dup.id] = now;
      changed = true;
    }
  }
  return changed;
}
// Codes nur innerhalb des Zeitraums und nur an Werktagen
function cleanCodes(m) {
  let changed = false;
  for (const z of Object.values(m.data.zuteilungen)) {
    const codes = z.codes || {};
    const bad = Object.keys(codes).filter((d) => d < z.von || d > z.bis || !isWeekday(d));
    if (!bad.length) continue;
    const c2 = { ...codes }; bad.forEach((d) => delete c2[d]);
    m.data.zuteilungen[z.id] = { ...z, codes: c2 };
    changed = true;
  }
  return changed;
}
function resolveConflicts(m) {
  const a = mergeDupPeople(m);
  const b = trimOverlaps(m, "abwesenheiten");
  const c = trimOverlaps(m, "zuteilungen");
  const d = cleanCodes(m);
  return a || b || c || d;
}

/* ---------- Betriebsurlaub: für mehrere Personen auf einmal (danach je Person normaler Urlaub) ---------- */
export function betriebsurlaub(ids, von, bis, notiz = "Betriebsurlaub") {
  for (const kId of ids) put("abwesenheiten", { kId, typ: "urlaub", von, bis, notiz });
  settle();
}

/* ---------- Abgleich mit OneDrive ---------- */
function rhythm(v) {
  const days = (xs) => (Array.isArray(xs) ? [...new Set(xs.map(Number).filter((x) => x >= 1 && x <= 5))].sort() : []);
  const r = v && typeof v === "object" ? v : {};
  return { w2: r.w2 === true, a: days(r.a), b: days(r.b), ref: typeof r.ref === "string" && DAY_RE.test(r.ref) ? r.ref : "" };
}
function cleanRecord(kind, r) {
  if (!r || typeof r !== "object" || !ID_RE.test(String(r.id || ""))) return null;
  const s = (v, n = 200) => (typeof v === "string" ? v.slice(0, n) : "");
  const day = (v) => (typeof v === "string" && DAY_RE.test(v) ? v : "");
  const kid = (v) => (ID_RE.test(String(v || "")) ? v : null);
  const base = { id: r.id, updatedAt: Number(r.updatedAt) || 0 };
  switch (kind) {
    case "konstrukteure": return { ...base, name: s(r.name, 80), aktiv: r.aktiv !== false, azubi: r.azubi === true, schule: rhythm(r.schule), teilzeit: r.teilzeit === true, frei: rhythm(r.frei) };
    case "zuteilungen": {
      const codes = {};
      if (r.codes && typeof r.codes === "object" && !Array.isArray(r.codes)) {
        for (const [d, c] of Object.entries(r.codes)) if (DAY_RE.test(d) && (STAHL.includes(c) || ROH.includes(c))) codes[d] = c;
      }
      return { ...base, kId: kid(r.kId), bvNumber: /^\d{5}$/.test(r.bvNumber || "") ? r.bvNumber : "", baustelle: s(r.baustelle), von: day(r.von), bis: day(r.bis), text: s(r.text, 120), codes };
    }
    case "abwesenheiten": return { ...base, kId: kid(r.kId), typ: ["krank", "ausgleich", "schule", "arbeit"].includes(r.typ) ? r.typ : "urlaub", von: day(r.von), bis: day(r.bis), notiz: s(r.notiz, 500) };
  }
  return null;
}
function mergeRemote(m, remote) {
  const now = Date.now();
  const tomb = { ...m.tomb };
  for (const [id, at] of Object.entries((remote && remote.tomb) || {})) {
    if (ID_RE.test(id) && Number(at) > (tomb[id] || 0)) tomb[id] = Number(at);
  }
  let localNewer = false;
  for (const kind of KINDS) {
    const r = (remote && remote.data && remote.data[kind]) || {};
    const out = {};
    const ids = new Set([...Object.keys(m.data[kind]), ...Object.keys(r)]);
    for (const id of ids) {
      const a = m.data[kind][id];
      const b = cleanRecord(kind, r[id]);
      const pick = a && b ? ((a.updatedAt || 0) > (b.updatedAt || 0) ? a : b) : a || b;
      if (!pick) continue;
      if (tomb[id] && tomb[id] >= (pick.updatedAt || 0)) { if (b) localNewer = true; continue; }
      if (pick !== b) localNewer = true;
      out[id] = pick;
    }
    m.data[kind] = out;
  }
  for (const id of Object.keys(tomb)) if (now - tomb[id] > TOMB_MAX_AGE) delete tomb[id];
  m.tomb = tomb;
  if (resolveConflicts(m)) localNewer = true;
  const rt = (remote && remote.tomb) || {};
  if (Object.keys(tomb).some((id) => !rt[id])) localNewer = true;
  return localNewer;
}

// Gibt true zurück, wenn sich durch den Abgleich etwas geändert hat
export async function syncKon({ full = false } = {}) {
  const m = kon();
  if (!full && !m.dirty) return false;
  const appDir = await od.getAppFolder();
  const dir = await od.ensureFolder(appDir.id, CONFIG.konFolder || "BauKon");
  const dd = await od.ensureFolder(dir.id, CONFIG.dataFolder);
  const before = JSON.stringify(m.data);
  for (let attempt = 0; attempt < 3; attempt++) {
    const remote = await od.getJson(dd.id, FILE);
    const rev = m.rev;
    let upload = m.dirty || !remote;
    if (remote && remote.eTag !== m.etag) upload = mergeRemote(m, remote.data) || upload;
    if (upload && canEdit()) {
      const res = await od.putJson(dd.id, FILE, { format: "stahlwork-baukon", version: 1, data: m.data, tomb: m.tomb }, remote ? remote.eTag : null);
      if (res.conflict) continue;
      m.etag = res.eTag;
    } else if (remote) {
      m.etag = remote.eTag;
    }
    if (m.rev === rev) m.dirty = false;
    break;
  }
  saveSoon();
  return JSON.stringify(m.data) !== before;
}

export { today, longDate, shortDate };
