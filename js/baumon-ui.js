/* =========================================================
   BauMon – Oberfläche
   Ansichten: Übersicht (mon), Planung (monplan), Bühnen (monbuehnen),
   Stammdaten in den Einstellungen (monstamm)
========================================================= */
import * as M from "./baumon.js";
import { S } from "./store.js";
import { escapeHtml as h, toast } from "./util.js";
import { buildPlanPdf } from "./baumon-pdf.js";

let U = null; // Hilfsfunktionen aus app.js: el, $, $$, go, render, schedule, account, projects
export function initMonUI(helpers) { U = helpers; }

// Einmal-Link zum Übernehmen von Namen: …/stahlwork/#mon-import=<Base64 von {"rm":[…],"m":[…]}>
export function checkImportLink() {
  const m = location.hash.match(/^#mon-import=([A-Za-z0-9_-]+={0,2})$/);
  if (!m) return;
  try { history.replaceState(history.state, "", location.pathname + location.search); } catch {}
  let data;
  try {
    const b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
    data = JSON.parse(decodeURIComponent(escape(atob(b64))));
  } catch { toast("Import-Link ist ungültig.", "error"); return; }
  const rm = Array.isArray(data.rm) ? data.rm.map(String) : [], mon = Array.isArray(data.m) ? data.m.map(String) : [];
  const maler = Array.isArray(data.maler) ? data.maler.map(String) : [];
  if (!rm.length && !mon.length && !maler.length) return;
  if (!editable()) { toast("Keine Berechtigung zum Bearbeiten von BauMon.", "warn"); return; }
  if (!confirm(`BauMon-Stammdaten übernehmen?\n\nRichtmeister (je mit Trupp): ${rm.length}\n${rm.join(", ")}\n\nMonteure: ${mon.length}\n${mon.join(", ")}${maler.length ? `\n\nMaler: ${maler.length}\n${maler.join(", ")}` : ""}\n\nBereits vorhandene Namen werden nicht doppelt angelegt.`)) return;
  const r = M.importPeople({ rm, m: mon, maler });
  toast(`Übernommen: ${r.neuRm} Richtmeister, ${r.neuM} Monteure, ${r.neuMa} Maler.`, "info", 5000);
  U.go({ sparte: "mon", view: "monpersonal" });
  U.schedule();
}

const ICO = {
  plus: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  mail: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  check: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  lift: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3v4M19 3v4M4 3h16M3 7.5h18M6 8l12 7M18 8L6 15"/><rect x="3" y="15" width="18" height="3.5" rx="1" fill="currentColor"/><circle cx="7" cy="20.5" r="1.6"/><circle cx="17" cy="20.5" r="1.6"/></svg>',
  people: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14c2.8 0 5 2.2 5 5"/></svg>',
  trash: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>',
  edit: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
};

const changed = () => { U.schedule(); U.render(); };
// Doppelbelegung: Hinweis bleibt, man kann sich aber darüber hinwegsetzen
const overrideText = (cf) => "Doppelt eingeteilt:\n\n" + M.conflictText(cf) +
  "\n\nTrotzdem übernehmen?\nDie genannten Personen bleiben an diesen Tagen bei der anderen Baustelle und werden hier nicht eingeplant – die übrigen schon.";
// Auswahllisten (BV, Typ, Person): Berühren/Scrollen schließt die Liste nicht, Auswahl per Antippen (click)
let listTouchAt = 0;
const listBusy = () => Date.now() - listTouchAt < 1500;
document.addEventListener("pointerdown", (ev) => {
  if (ev.target.closest(".mon-modal .place-list")) { listTouchAt = Date.now(); if (ev.pointerType === "mouse") ev.preventDefault(); return; }
  for (const l of document.querySelectorAll(".mon-modal .place-list")) if (l.innerHTML && !l.parentElement.contains(ev.target)) l.innerHTML = "";
}, true);
document.addEventListener("click", (ev) => { if (ev.target.closest(".mon-modal .place-list")) setTimeout(() => { listTouchAt = 0; }, 0); }, true);
// Esc schließt immer das oberste Popup: erst Schnellmenü bzw. offene Auswahlliste, dann den obersten Dialog
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape" || ev.defaultPrevented) return;
  const qm = document.querySelector(".quick-menu");
  if (qm) { ev.preventDefault(); qm.remove(); return; }
  const dlgs = document.querySelectorAll(".mon-modal");
  const top = dlgs[dlgs.length - 1];
  if (!top) return;
  ev.preventDefault();
  ev.stopImmediatePropagation();
  const list = [...top.querySelectorAll(".place-list")].find((l) => l.innerHTML.trim());
  if (list) { list.innerHTML = ""; return; }
  top.querySelector("[data-x]")?.click();
}, true);
// Kurzformen der Feiertage für die schmale Tagesspalte
const HOL_SHORT = { "Heilige Drei Könige": "Hl. 3 Kön.", "Ostermontag": "Ostermo.", "Tag der Arbeit": "1. Mai", "Christi Himmelfahrt": "Himmelf.",
  "Pfingstmontag": "Pfingstmo.", "Fronleichnam": "Fronleichn.", "Tag der Deutschen Einheit": "Dt. Einheit", "Allerheiligen": "Allerheil.",
  "1. Weihnachtstag": "1. Weihn.", "2. Weihnachtstag": "2. Weihn.", "Karfreitag": "Karfr." };
const editable = () => M.canEdit();

/* ---------- Farben je Baustelle (ruhige Töne) ---------- */
// gut unterscheidbare Töne; je Ansicht bekommt jedes BV eine eigene Farbe (keine Doppelungen)
const PALETTE = ["#2e5b8a", "#5b7f3a", "#a07a14", "#6a4c8c", "#2e7f7a", "#8c3f52", "#c0622f", "#5f5e59", "#4a90b8", "#b0567d", "#7d8c2e", "#3d3d6b", "#8a5a2e", "#2f6b4f"];
const siteKeyOf = (x) => x.bvNumber || (x.baustelle || "").trim().toLowerCase();
let colorMap = new Map();
// Farben für die BV einer Ansicht vergeben: nach Beginn sortiert, jede Farbe nur einmal
export function assignColors(list) {
  const first = new Map();
  for (const e of list) { const k = siteKeyOf(e); if (!first.has(k) || (e.von || "") < first.get(k)) first.set(k, e.von || ""); }
  const keys = [...first.keys()].sort((a, b) => first.get(a).localeCompare(first.get(b)) || a.localeCompare(b));
  colorMap = new Map(keys.map((k, i) => [k, PALETTE[i % PALETTE.length]]));
  return colorMap;
}
function siteColor(x) {
  const key = siteKeyOf(x);
  if (colorMap.has(key)) return colorMap.get(key);
  let n = 0;
  for (let i = 0; i < key.length; i++) n = (n * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[n % PALETTE.length];
}

/* =========================================================
   Übersicht
========================================================= */
export function renderMonStart(app) {
  const t = M.today();
  const trupps = M.sortedTrupps();
  const empty = !M.list("monteure").length && !trupps.length;
  app.appendChild(U.el(`<div class="page-head"><h1>BauMon</h1>${editable() ? `<button class="primary" id="monNew" type="button">+ Einsatz</button>` : ""}</div>`));
  const nb = U.$("#monNew");
  if (nb) nb.onclick = () => openEinsatz(null, { von: t, bis: t });

  if (empty) {
    app.appendChild(U.el(`<div class="card mon-empty-card">
      <h3>Los geht's</h3>
      <p class="muted">Zuerst die Stammdaten anlegen – danach Einsätze planen.</p>
      <div class="row wrap">
        <button class="secondary" data-stamm="monteure" type="button">Monteure</button>
        <button class="secondary" data-stamm="trupps" type="button">Trupps</button>
        <button class="secondary" data-stamm="vermieter" type="button">Bühnenvermieter</button>
      </div></div>`));
  }

  // Bühnen abmelden
  const due = M.dueBuehnen(t);
  if (due.length) {
    const card = U.el(`<div class="card mon-due">
      <div class="mon-due-head"><span class="mon-due-ico">${ICO.lift}</span><div><h3>${due.length} Bühne${due.length > 1 ? "n" : ""} abmelden</h3>
      <div class="muted">Mietende am nächsten Werktag oder schon erreicht – beim Vermieter abmelden.</div></div></div>
      <ul class="mon-list">${due.slice(0, 6).map((b) => `<li><b>${h(M.baustelleLabel(b))}</b> · ${h(M.buehneText(b))} · ${h(vermieterName(b.vermieterId))} <span class="muted">Mietende ${h(M.shortDate(b.bis))}</span></li>`).join("")}</ul>
      <button class="primary" id="toBuehnen" type="button">Zu den Bühnen</button></div>`);
    app.appendChild(card);
    U.$("#toBuehnen").onclick = () => U.go({ view: "monbuehnen" });
  }

  // Heute krank / im Urlaub
  const abwHeute = M.absentOn(t).sort((a, b) => (M.get("monteure", a.monteurId).name).localeCompare(M.get("monteure", b.monteurId).name, "de"));
  if (abwHeute.length) {
    const ac = U.el(`<div class="card"><h3 class="section-title">Heute krank / im Urlaub</h3><div class="mon-abw-list">${abwHeute.map((a) => `<button type="button" class="mon-abw-chip ${a.typ}" data-aid="${h(a.id)}"><b>${h(M.get("monteure", a.monteurId).name)}</b> · ${M.ABW_TYPES[a.typ]} bis ${h(M.wdName(a.bis))} ${h(M.shortDate(a.bis))}</button>`).join("")}</div></div>`);
    U.$$("[data-aid]", ac).forEach((b) => { b.onclick = () => openAbw(M.get("abwesenheiten", b.dataset.aid)); });
    app.appendChild(ac);
  }
  // Heute im Einsatz
  const heute = M.activeOn(t);
  assignColors(heute);
  const hol = M.holiday(t);
  const card = U.el(`<div class="card"><h3 class="section-title">Heute im Einsatz · ${h(M.longDate(t))}${hol ? ` <span class="badge hol-badge">${h(hol)}</span>` : ""}</h3><div class="mon-today"></div></div>`);
  const box = card.querySelector(".mon-today");
  const rows = [...trupps.map((tr) => ({ tr, list: heute.filter((e) => e.truppId === tr.id) })), { tr: null, list: heute.filter((e) => !e.truppId || !M.get("trupps", e.truppId)) }];
  let any = false;
  for (const r of rows) {
    if (!r.tr && !r.list.length) continue;
    any = true;
    const row = U.el(`<div class="mon-today-row ${r.list.length ? "" : "free"}">
      <div class="mon-today-trupp">${h(M.truppName(r.tr))}</div>
      <div class="mon-today-sites">${r.list.length ? r.list.map((e) => {
        const bs = M.buehnenOf(e).filter((b) => !b.abgemeldetAm), due = bs.some((b) => M.isDue(b, t));
        return `<button type="button" class="mon-site" data-eid="${h(e.id)}" style="--c:${siteColor(e)}"><span class="mon-site-txt">
        <span class="mon-site-name">${h(M.baustelleLabel(e))}</span>
        <span class="muted">${h(monteurNames((e.monteure || []).filter((id) => M.present(e, id, t)), 4))} · bis ${h(M.wdName(e.bis))} ${h(M.shortDate(e.bis))}</span></span>${bs.length ? `<span class="mon-site-lift ${due ? "due" : ""}" title="${bs.length} Bühne(n)${due ? " – abmelden!" : ""}">${ICO.lift}</span>` : ""}</button>`;
      }).join("") : `<span class="muted">nicht eingeplant</span>`}</div></div>`);
    box.appendChild(row);
  }
  if (!any) box.appendChild(U.el(`<p class="muted">Noch keine Trupps angelegt.</p>`));
  U.$$("[data-eid]", card).forEach((b) => { b.onclick = () => openEinsatz(M.get("einsaetze", b.dataset.eid)); });
  app.appendChild(card);
  bindStammButtons(app);
}

function vermieterName(id) { const v = M.get("vermieter", id); return v ? v.firma : "Bühler (eigene)"; }
function monteurNames(ids, max = 99) {
  const names = (ids || []).map((id) => M.get("monteure", id)).filter(Boolean).map((m) => m.name);
  return names.length > max ? names.slice(0, max).join(", ") + ` +${names.length - max}` : names.join(", ") || "keine Monteure";
}
function bindStammButtons(root) {
  U.$$("[data-stamm]", root).forEach((b) => { b.onclick = () => U.go({ sparte: "mon", view: b.dataset.stamm === "vermieter" ? "monbuehnen" : "monpersonal" }); });
}

/* =========================================================
   Planung: Trupps untereinander, Zeit nach rechts
========================================================= */
let planKeep = null; // Scrollposition nach einer Änderung in der Detailansicht beibehalten
function keepPlanScroll(card) { const sc = card.querySelector(".g-scroll"); planKeep = { x: sc ? sc.scrollLeft : 0, y: window.scrollY }; }
let weekOffset = 0; // Planung: um ganze Wochen nach vorne/hinten verschoben (0 = aktuelle KW + zwei kommende)
export function renderMonPlan(app) {
  const m = M.mon();
  const start = M.addDays(M.range().start, weekOffset * 7);
  const days = Array.from({ length: 21 }, (_, i) => M.addDays(start, i));
  const t = M.today();
  const zoom = m.zoom;
  // Kopf wie auf den anderen Reitern (gleiche Höhe) – Ansichts-Schalter sitzt oben in der Karte
  app.appendChild(U.el(`<div class="page-head"><h1>Planung</h1>${editable() ? `<button class="primary" id="monNew" type="button">+ Einsatz</button>` : ""}</div>`));
  const nb = U.$("#monNew");
  if (nb) nb.onclick = () => openEinsatz(null, { von: t, bis: t });

  const trupps = M.sortedTrupps();
  const einsaetze = M.list("einsaetze").filter((e) => e.bis >= days[0] && e.von <= days[20]);
  // Bühnen, deren BV im Zeitraum keinen Einsatz hat (z. B. Einsatz gelöscht oder verschoben): eigene Zeilen in der Bühnen-Ansicht
  const orphans = M.list("buehnen").filter((b) => {
    const von = b.von || b.bis, bis = b.abgemeldetAm || b.bis;
    if (!von || !bis || bis < days[0] || von > days[20]) return false;
    return !einsaetze.some((e) => M.sameSite(b, e));
  }).sort((a, b) => (a.bis || "").localeCompare(b.bis || "") || M.baustelleLabel(a).localeCompare(M.baustelleLabel(b)));
  assignColors([...einsaetze, ...orphans]);
  // Bühnen-Symbol nur einmal je BV: am Balken, der im dargestellten Zeitraum am weitesten rechts endet
  // (geht das BV über den Zeitraum hinaus, also am letzten dargestellten Tag)
  const siteKey = (e) => e.bvNumber ? "#" + e.bvNumber : (e.baustelle || "").trim().toLowerCase();
  const liftBar = new Map();
  for (const e of einsaetze) {
    const k = siteKey(e) + "|" + (e.truppId || ""), cur = liftBar.get(k);
    const end = e.bis > days[20] ? days[20] : e.bis;
    if (!cur || end > cur.end) liftBar.set(k, { id: e.id, end });
  }
  const rowOf = (tr) => ({ tr, list: einsaetze.filter((e) => e.truppId === tr.id) });
  const rows = trupps.filter((tr) => !M.isMalerTrupp(tr)).map(rowOf);
  const rest = einsaetze.filter((e) => !e.truppId || !M.get("trupps", e.truppId));
  if (rest.length) rows.push({ tr: null, list: rest });
  const malerRows = trupps.filter((tr) => M.isMalerTrupp(tr)).map(rowOf);
  if (malerRows.length) rows.push({ sep: "Maler" }, ...malerRows);
  const abwIn = M.list("abwesenheiten").filter((a) => a.monteurId && a.bis >= days[0] && a.von <= days[20] && M.get("monteure", a.monteurId));
  const abwPeople = [...new Set(abwIn.map((a) => a.monteurId))].map((id) => M.get("monteure", id)).sort((a, b) => a.name.localeCompare(b.name, "de"));
  if (zoom === "buehnen" && orphans.length) rows.push({ sep: "Bühnen ohne Einsatz" }, ...orphans.map((b) => ({ orphan: b })));
  if (abwPeople.length || editable()) {
    rows.push({ sep: "Krank / Urlaub", add: editable() }, ...abwPeople.map((p) => ({ abw: p, list: abwIn.filter((a) => a.monteurId === p.id) })));
  }
  // Detail je Trupp: Personal (eine Zeile je Person) oder Bühnen (eine Zeile je Bühne)
  for (const r of rows) {
    r.subs = [];
    if (r.sep || r.abw || r.orphan || zoom === "kompakt") continue;
    if (zoom === "personal") {
      const ids = [];
      const addId = (id) => { if (id && !ids.includes(id) && M.get("monteure", id)) ids.push(id); };
      if (r.tr) { addId(r.tr.fuehrerId); if (!M.isMalerTrupp(r.tr)) (r.tr.monteure || []).forEach(addId); }
      if (!r.tr || !M.isMalerTrupp(r.tr)) r.list.forEach((e) => (e.monteure || []).forEach(addId));
      r.subs = ids.map((id) => ({ person: M.get("monteure", id) }));
    } else {
      const seen = new Set();
      for (const e of r.list) for (const b of M.buehnenOf(e)) {
        if (seen.has(b.id) || (b.abgemeldetAm && b.abgemeldetAm < days[0])) continue;
        seen.add(b.id); r.subs.push({ lift: b, e });
      }
      r.subs.sort((a, b) => (a.lift.von || "").localeCompare(b.lift.von || ""));
    }
  }

  if (!rows.some((r) => !r.sep && !r.abw)) {
    const empty = U.el(`<div class="card mon-empty-card"><h3>Noch keine Trupps</h3>
      <p class="muted">Für die Planung zuerst Monteure und Trupps anlegen.</p>
      <div class="row wrap"><button class="primary" data-stamm="trupps" type="button">Trupps anlegen</button>
      <button class="secondary" data-stamm="monteure" type="button">Monteure</button></div></div>`);
    app.appendChild(empty);
    bindStammButtons(empty);
    return;
  }

  const card = U.el(`<div class="card mon-plan-card">
    <div class="g-tools"><div class="g-nav"><button type="button" class="icon-btn" id="wkPrev" aria-label="Eine Woche früher" title="Eine Woche früher"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
      <span class="g-range">KW ${M.isoWeek(days[0])}–${M.isoWeek(days[20])}</span>
      <button type="button" class="icon-btn" id="wkNext" aria-label="Eine Woche später" title="Eine Woche später"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
      ${weekOffset ? `<button type="button" class="secondary small" id="wkNow">Heute</button>` : ""}</div>
      <span class="grow"></span><button type="button" class="secondary small g-pdf" id="planPdf">PDF</button><div class="seg" role="group" aria-label="Ansicht">
      <button type="button" class="${zoom === "kompakt" ? "on" : ""}" data-zoom="kompakt">Kompakt</button>
      <button type="button" class="${zoom === "personal" ? "on" : ""}" data-zoom="personal">Personal</button>
      <button type="button" class="${zoom === "buehnen" ? "on" : ""}" data-zoom="buehnen">Bühnen</button>
    </div></div>
    <div class="g-scroll"><div class="gantt ${zoom === "kompakt" ? "wochen" : "tage"} det-${zoom}" style="--days:21"></div></div></div>`);
  U.$$("[data-zoom]", card).forEach((b) => { b.onclick = () => { m.zoom = b.dataset.zoom; U.render(); }; });
  card.querySelector("#planPdf").onclick = () => openPlanPdf();
  card.querySelector("#wkPrev").onclick = () => { weekOffset--; U.render(); };
  card.querySelector("#wkNext").onclick = () => { weekOffset++; U.render(); };
  const now = card.querySelector("#wkNow"); if (now) now.onclick = () => { weekOffset = 0; U.render(); };
  const g = card.querySelector(".gantt");
  // Bühnen-Balken (Mietbeginn bis Mietende bzw. Abmeldung)
  function bueBar(b, gridRow, color) {
    const due = M.isDue(b, t);
    const von = b.von || b.bis || days[0], bis = b.abgemeldetAm || b.bis || days[20];
    if (bis < days[0] || von > days[20]) return "";
    const s0 = Math.max(0, days.indexOf(von < days[0] ? days[0] : von)), e0 = days.indexOf(bis > days[20] ? days[20] : bis);
    return `<button type="button" class="g-bue ${due ? "due" : ""} ${b.abgemeldetAm ? "done" : ""} ${von < days[0] ? "cut-l" : ""} ${bis > days[20] ? "cut-r" : ""}" data-bid="${h(b.id)}" style="grid-column:${2 + s0} / ${3 + e0};grid-row:${gridRow};--c:${color}" title="${h(M.buehneText(b))} · ${h(M.baustelleLabel(b))} · ${h(vermieterName(b.vermieterId))} · Mietbeginn ${h(M.shortDate(von))} · Mietende ${b.bis ? h(M.shortDate(b.bis)) : "fehlt"}${due ? " – abmelden!" : ""}">${editable() && !b.abgemeldetAm && von >= days[0] ? '<span class="g-h l" data-h="start" aria-hidden="true"></span>' : ""}${due ? '<span class="bue-dot" title="abmelden!"></span>' : ""}<span class="g-bue-t">${h(vermieterName(b.vermieterId))} · ${b.abgemeldetAm ? "abgemeldet " + h(M.shortDate(b.abgemeldetAm)) : "bis " + (b.bis ? h(M.shortDate(b.bis)) : "?")}</span>${editable() && !b.abgemeldetAm && b.bis && b.bis <= days[20] ? '<span class="g-h r" data-h="end" aria-hidden="true"></span>' : ""}</button>`;
  }
  // Kopf: Wochen + Tage
  let head = `<div class="g-corner">Trupp</div>`;
  for (let w = 0; w < 3; w++) {
    const d0 = days[w * 7];
    const cur = M.mondayOf(t) === d0;
    head += `<div class="g-week ${cur ? "cur" : ""}" style="grid-column:${2 + w * 7} / span 7">KW ${M.isoWeek(d0)} <span>${M.shortDate(d0)}–${M.shortDate(days[w * 7 + 6])}</span></div>`;
  }
  days.forEach((d, i) => {
    const we = ["Sa", "So"].includes(M.wdName(d));
    const hol = M.holiday(d);
    head += `<div class="g-day ${we ? "we" : ""} ${hol ? "hol" : ""} ${d === t ? "today" : ""}" data-day="${d}" style="grid-column:${2 + i}" ${hol ? `title="${h(hol)}"` : ""}>${M.wdName(d)}<b>${Number(d.slice(8))}</b><i class="g-hol">${hol ? h(HOL_SHORT[hol] || hol) : "&nbsp;"}</i></div>`;
  });
  g.insertAdjacentHTML("beforeend", head);

  // Zeilenhöhen: Trupp-Zeilen fest, Trennzeile (Maler) schmal
  g.style.gridTemplateRows = "auto auto " + rows.map((r) => (r.sep ? "30px" : r.orphan ? "44px" : ["var(--rowh)", ...(r.subs || []).map(() => "var(--subh)")].join(" "))).join(" ");
  let gridRow = 3;
  for (const r of rows) {
    if (r.sep) {
      g.insertAdjacentHTML("beforeend", `<div class="g-sep" style="grid-row:${gridRow}"><span>${h(r.sep)}${r.add ? ` <button type="button" class="g-sep-add" id="abwAdd">+ Krank / Urlaub</button>` : ""}</span></div>`);
      gridRow++;
      continue;
    }
    if (r.orphan) {
      const b = r.orphan;
      g.insertAdjacentHTML("beforeend", `<div class="g-trupp g-orow" style="grid-row:${gridRow}" title="${h(M.baustelleLabel(b))} · ${h(M.buehneText(b))}"><b>${h(M.baustelleLabel(b))}</b><span class="g-osub">${h(M.buehneText(b))}</span></div>`);
      days.forEach((d, i) => g.insertAdjacentHTML("beforeend", `<div class="g-pc ${["Sa", "So"].includes(M.wdName(d)) ? "we" : ""} ${M.holiday(d) ? "hol" : ""} ${d === t ? "today" : ""}" style="grid-column:${2 + i};grid-row:${gridRow}"></div>`));
      g.insertAdjacentHTML("beforeend", bueBar(b, gridRow, siteColor(b)));
      gridRow++;
      continue;
    }
    if (r.abw) {
      const p = r.abw;
      g.insertAdjacentHTML("beforeend", `<div class="g-trupp g-arow" style="grid-row:${gridRow}"><b>${h(p.name)}</b></div>`);
      days.forEach((d, i) => {
        const we = ["Sa", "So"].includes(M.wdName(d)), hol = M.holiday(d);
        g.insertAdjacentHTML("beforeend", `<div class="g-cell ${we ? "we" : ""} ${hol ? "hol" : ""} ${d === t ? "today" : ""}" data-day="${d}" data-trupp="abw:${h(p.id)}" style="grid-column:${2 + i};grid-row:${gridRow}"></div>`);
      });
      for (const a of r.list) {
        const s0 = Math.max(0, days.indexOf(a.von < days[0] ? days[0] : a.von)), e0 = days.indexOf(a.bis > days[20] ? days[20] : a.bis);
        g.insertAdjacentHTML("beforeend", `<button type="button" class="g-abw ${a.typ} ${a.von < days[0] ? "cut-l" : ""} ${a.bis > days[20] ? "cut-r" : ""}" data-aid="${h(a.id)}" style="grid-column:${2 + s0} / ${3 + e0};grid-row:${gridRow}" title="${h(p.name)}: ${M.ABW_TYPES[a.typ]} ${h(M.longDate(a.von))} – ${h(M.longDate(a.bis))}${a.notiz ? " · " + h(a.notiz) : ""}">${editable() && a.von >= days[0] ? '<span class="g-h l" data-h="start" aria-hidden="true"></span>' : ""}${M.ABW_TYPES[a.typ]}${editable() && a.bis <= days[20] ? '<span class="g-h r" data-h="end" aria-hidden="true"></span>' : ""}</button>`);
      }
      gridRow++;
      continue;
    }
    // Bahnen: überlappende Einsätze eines Trupps untereinander
    const lanes = [];
    for (const e of r.list.slice().sort((a, b) => a.von.localeCompare(b.von))) {
      let lane = lanes.findIndex((l) => l.every((x) => x.bis < e.von || x.von > e.bis));
      if (lane < 0) { lanes.push([]); lane = lanes.length - 1; }
      lanes[lane].push(e);
    }
    // Zeile bleibt gleich hoch: mehrere Baustellen am Tag teilen sich die Höhe (Balken übereinander)
    const L = Math.max(1, lanes.length);
    const n = 1;
    const tr = r.tr;
    g.insertAdjacentHTML("beforeend", `<div class="g-trupp" data-row="${tr ? h(tr.id) : ""}" style="grid-row:${gridRow} / span ${n}"><b>${h(M.truppName(tr))}</b></div>`);
    // Hintergrundzellen (Klick = neuer Einsatz an diesem Tag)
    days.forEach((d, i) => {
      const we = ["Sa", "So"].includes(M.wdName(d));
      const hol = M.holiday(d);
      g.insertAdjacentHTML("beforeend", `<div class="g-cell ${we ? "we" : ""} ${hol ? "hol" : ""} ${d === t ? "today" : ""}" ${hol ? `title="${h(hol)}"` : ""} data-day="${d}" data-trupp="${tr ? h(tr.id) : ""}" style="grid-column:${2 + i};grid-row:${gridRow} / span ${n}"></div>`);
    });
    lanes.forEach((lane, li) => {
      for (const e of lane) {
        const s = Math.max(0, days.indexOf(e.von < days[0] ? days[0] : e.von));
        const en = days.indexOf(e.bis > days[20] ? days[20] : e.bis);
        const bh = liftBar.get(siteKey(e) + "|" + (e.truppId || ""))?.id === e.id ? M.buehnenOf(e).filter((b) => !b.abgemeldetAm) : [];
        const dueHere = bh.some((b) => M.isDue(b, t));
        const dbl = M.conflicts(e), abs = M.absenceConflicts(e);
        // Tagesansicht: zweite Zeile mit Besetzung (ohne Richtmeister) und Leiharbeiter/Kran
        const sub = [(e.monteure || []).filter((id) => !tr || id !== tr.fuehrerId).map((id) => (M.get("monteure", id) || {}).name).filter(Boolean).join(", "), e.leih, e.kran].filter(Boolean).join(" · ");
        // Wechsel am selben Tag (Überschneidung am Anfang/Ende): der Tag wird geteilt –
        // alter Balken endet in der Tagesmitte, neuer beginnt dort. Volle Höhe, keine Stufe.
        // Liegt ein Einsatz ganz in einem anderen (Kurzeinsatz), werden beide halb hoch übereinander gezeigt.
        let mode = "", bg = "", pad = "";
        if (L > 1) {
          const N = en - s + 1;
          const ov = Array.from({ length: N }, (_, k) => r.list.some((o) => o !== e && o.von <= days[s + k] && o.bis >= days[s + k]));
          let pl = 0; while (pl < N && ov[pl]) pl++;
          let pr = 0; while (pr < N - pl && ov[N - 1 - pr]) pr++;
          const inner = ov.slice(pl, N - pr).some(Boolean);
          const contains = r.list.some((o) => o !== e && o.von > e.von && o.bis < e.bis); // anderer Einsatz liegt ganz in diesem
          if (ov.every(Boolean) || inner || contains) mode = "stack";
          else if (pl || pr) {
            // Überschneidung: die Balken laufen über die überschneidenden Tage schräg ineinander
            // (alter Balken oben bis Ende der Überschneidung, neuer unten ab Beginn) – Breite der Schräge = Anzahl Tage
            mode = `join ${pl ? "join-l" : ""} ${pr ? "join-r" : ""}`;
            pad = `--ovl:${pl / N};--ovr:${pr / N};`;
          }
        }
        g.insertAdjacentHTML("beforeend", `<button type="button" class="g-bar ${mode} ${dueHere ? "has-due" : ""} ${dbl.length ? "conflict" : ""} ${e.von < days[0] ? "cut-l" : ""} ${e.bis > days[20] ? "cut-r" : ""}" data-eid="${h(e.id)}"
          style="grid-column:${2 + s} / ${3 + en};grid-row:${gridRow};--lanes:${L};--lane:${li};--c:${siteColor(e)};${pad}" title="${h(M.baustelleLabel(e))}: ${h(M.longDate(e.von))} – ${h(M.longDate(e.bis))}${dbl.length ? " – DOPPELT EINGETEILT: " + h([...new Set(dbl.map((c) => (M.get("monteure", c.monteurId) || {}).name))].join(", ")) : ""}${abs.length ? " – krank/Urlaub (an diesen Tagen nicht eingeteilt): " + h([...new Set(abs.map((c) => (M.get("monteure", c.monteurId) || {}).name))].join(", ")) : ""}">
          ${bg}${editable() && e.von >= days[0] ? '<span class="g-h l" data-h="start" aria-hidden="true"></span>' : ""}<span class="g-bar-t"><span class="g-l1">${e.bvNumber ? `<span class="g-num">${h(e.bvNumber)}</span> <span class="g-name">${h(e.baustelle)}</span>` : `<span class="g-name only">${h(e.baustelle || "Baustelle")}</span>`}</span>${sub ? `<span class="g-sub">${h(sub)}</span>` : ""}</span>${bh.length ? `<span class="g-lift ${dueHere ? "due" : ""}" title="${bh.length} Bühne(n)${dueHere ? " – abmelden!" : ""}">${ICO.lift}</span>` : ""}${editable() && e.bis <= days[20] ? '<span class="g-h r" data-h="end" aria-hidden="true"></span>' : ""}</button>`);
        // Überlappung: sichtbarer Griff mitten auf der Schräge (Länge ändern)
        if (editable() && mode.startsWith("join")) {
          const kn = (side) => `<div class="g-knobs" style="grid-column:${2 + s} / ${3 + en};grid-row:${gridRow};${pad}"><span class="g-knob ${side}" data-eid="${h(e.id)}" data-h="${side === "r" ? "end" : "start"}" title="Ziehen: ${side === "r" ? "Ende" : "Beginn"} ändern"></span></div>`;
          if (mode.includes("join-r") && e.bis <= days[20]) g.insertAdjacentHTML("beforeend", kn("r"));
          if (mode.includes("join-l") && e.von >= days[0]) g.insertAdjacentHTML("beforeend", kn("l"));
        }
      }
    });
    gridRow += n;
    for (const sub of r.subs) {
      const bgCls = (d) => `${["Sa", "So"].includes(M.wdName(d)) ? "we" : ""} ${M.holiday(d) ? "hol" : ""} ${d === t ? "today" : ""}`;
      if (sub.person) {
        const p = sub.person;
        g.insertAdjacentHTML("beforeend", `<div class="g-subl" style="grid-row:${gridRow}">${h(p.name)}${M.kind(p) === "rm" ? ' <span class="p-badge">RM</span>' : ""}</div>`);
        days.forEach((d, i) => {
          const es = r.list.filter((e) => e.von <= d && e.bis >= d);
          const a = M.absentRec(p.id, d);
          let inner = "";
          if (a) inner = `<span class="g-pd abs" title="${h(p.name)}: ${M.ABW_TYPES[a.typ]}">${a.typ === "krank" ? "K" : "U"}</span>`;
          else if (es.length) {
            inner = es.map((e) => {
              const on = M.present(e, p.id, d);
              const other = !on && M.list("einsaetze").find((o) => o.id !== e.id && o.truppId !== e.truppId && M.present(o, p.id, d));
              return `<span class="g-pd ${on ? "on" : other ? "busy" : "free"}" data-eid="${h(e.id)}" data-pid="${h(p.id)}" data-day="${d}" data-r="${gridRow}" style="--c:${siteColor(e)}" title="${h(p.name)} · ${h(M.wdName(d))} ${h(M.shortDate(d))} · ${on ? "eingeteilt: " + h(M.baustelleLabel(e)) : other ? "schon bei " + h(M.baustelleLabel(other)) : "nicht eingeteilt – antippen zum Einteilen"}"></span>`;
            }).join("");
          } else {
            const other = M.list("einsaetze").find((o) => M.present(o, p.id, d));
            if (other) inner = `<span class="g-pd elsewhere" style="--c:${siteColor(other)}" title="${h(p.name)}: bei ${h(M.baustelleLabel(other))} (${h(M.truppName(M.get("trupps", other.truppId)))})"></span>`;
          }
          g.insertAdjacentHTML("beforeend", `<div class="g-pc ${bgCls(d)} ${es.length > 1 ? "two" : ""}" data-pid="${h(p.id)}" data-day="${d}" style="grid-column:${2 + i};grid-row:${gridRow}">${inner}</div>`);
        });
      } else {
        const b = sub.lift;
        g.insertAdjacentHTML("beforeend", `<div class="g-subl" style="grid-row:${gridRow}" title="${h(M.buehneText(b))} · ${h(vermieterName(b.vermieterId))}">${h(M.buehneText(b))}</div>`);
        days.forEach((d, i) => g.insertAdjacentHTML("beforeend", `<div class="g-pc ${bgCls(d)}" style="grid-column:${2 + i};grid-row:${gridRow}"></div>`));
        g.insertAdjacentHTML("beforeend", bueBar(b, gridRow, siteColor(sub.e)));
      }
      gridRow++;
    }
  }
  app.appendChild(card);

  U.$$(".g-bar", card).forEach((b) => { b.onclick = () => { if (dragJustEnded) return; openEinsatz(M.get("einsaetze", b.dataset.eid)); }; });
  U.$$(".g-abw", card).forEach((b) => { b.onclick = () => { if (dragJustEnded) return; openAbw(M.get("abwesenheiten", b.dataset.aid)); }; });
  U.$$(".g-bue", card).forEach((b) => { b.onclick = () => { if (dragJustEnded) return; openBuehne(M.get("buehnen", b.dataset.bid)); }; });
  // Personal: mit gedrückter Maus über mehrere Tage ziehen -> alle auf einmal ein- bzw. austragen
  let psel = null, pselEnded = false;
  if (editable()) {
    g.addEventListener("pointerdown", (ev) => {
      if (ev.pointerType !== "mouse" || ev.button !== 0) return;
      const c = ev.target.closest(".g-pd[data-eid]");
      if (!c) return;
      psel = { r: c.dataset.r, add: !c.classList.contains("on"), cells: new Set([c]) };
      c.classList.add("sel");
      ev.preventDefault();
    });
    g.addEventListener("pointermove", (ev) => {
      if (!psel) return;
      const c = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".g-pd[data-eid]");
      if (!c || c.dataset.r !== psel.r || psel.cells.has(c)) return;
      // alle Felder der Zeile zwischen Start und aktuellem Feld markieren
      const first = [...psel.cells][0];
      const [a, b] = [first.dataset.day, c.dataset.day].sort();
      U.$$(`.g-pd[data-r="${psel.r}"]`, g).forEach((x) => { const inn = x.dataset.day >= a && x.dataset.day <= b && x.dataset.eid; x.classList.toggle("sel", !!inn); if (inn) psel.cells.add(x); else psel.cells.delete(x); });
      psel.cells.add(first); first.classList.add("sel");
    });
    window.addEventListener("pointerup", () => {
      if (!psel) return;
      const s0 = psel; psel = null;
      const cells = [...s0.cells];
      cells.forEach((x) => x.classList.remove("sel"));
      if (cells.length < 2) return; // einzelnes Feld: normaler Klick
      pselEnded = true; setTimeout(() => { pselEnded = false; }, 50);
      let n = 0, err = null;
      for (const c of cells) {
        const e = M.get("einsaetze", c.dataset.eid);
        if (!e) continue;
        const on = M.present(e, c.dataset.pid, c.dataset.day);
        if (on === s0.add) continue; // schon im gewünschten Zustand
        const r = M.toggleDay(e, c.dataset.pid, c.dataset.day);
        if (r) err = err || r; else n++;
      }
      if (err) toast(err + (n ? ` (${n} Tag(e) geändert)` : ""), "warn", 5000);
      else if (n) toast(`${n} Tag(e) ${s0.add ? "eingeteilt" : "ausgetragen"}.`, "info", 2000);
      if (n) { keepPlanScroll(card); changed(); }
    });
  }
  // Schnellauswahl Krank/Urlaub: Rechtsklick (PC) bzw. lange halten (Handy) auf ein Personal-Feld
  let quickJust = false;
  if (editable()) {
    g.addEventListener("contextmenu", (ev) => {
      const c = ev.target.closest(".g-pc[data-pid]");
      if (!c) return;
      ev.preventDefault();
      quickMenu(ev.clientX, ev.clientY, c.dataset.pid, c.dataset.day, card);
    });
    let lp = null;
    g.addEventListener("touchstart", (ev) => {
      const c = ev.target.closest(".g-pc[data-pid]");
      if (!c || ev.touches.length !== 1) return;
      const t0 = ev.touches[0];
      lp = { x: t0.clientX, y: t0.clientY, timer: setTimeout(() => {
        quickJust = true; setTimeout(() => { quickJust = false; }, 600);
        if (navigator.vibrate) try { navigator.vibrate(15); } catch {}
        quickMenu(lp.x, lp.y, c.dataset.pid, c.dataset.day, card);
        lp = null;
      }, 550) };
    }, { passive: true });
    g.addEventListener("touchmove", (ev) => { if (lp && Math.hypot(ev.touches[0].clientX - lp.x, ev.touches[0].clientY - lp.y) > 8) { clearTimeout(lp.timer); lp = null; } }, { passive: true });
    g.addEventListener("touchend", () => { if (lp) { clearTimeout(lp.timer); lp = null; } });
  }
  if (editable()) U.$$(".g-pd[data-eid]", card).forEach((c) => {
    c.onclick = () => {
      if (pselEnded || quickJust) return;
      const e = M.get("einsaetze", c.dataset.eid);
      const err = e && M.toggleDay(e, c.dataset.pid, c.dataset.day);
      if (err) { toast(err, "warn", 4000); return; }
      keepPlanScroll(card);
      changed();
    };
  });
  const aa = card.querySelector("#abwAdd"); if (aa) aa.onclick = () => openAbw(null, { von: t, bis: t });
  if (editable()) enableDrag(card, g, days);
  if (editable()) {
    // Maus: gedrückt halten und über mehrere Tage ziehen -> Zeitraum für neuen Einsatz
    let sel = null, selJustEnded = false;
    const cellsOf = (tr) => U.$$(".g-cell", g).filter((x) => x.dataset.trupp === tr);
    const mark = () => {
      const [a, b] = [sel.from, sel.to].sort();
      for (const x of cellsOf(sel.trupp)) x.classList.toggle("sel", x.dataset.day >= a && x.dataset.day <= b);
    };
    g.addEventListener("pointerdown", (ev) => {
      if (ev.pointerType !== "mouse" || ev.button !== 0) return;
      const c = ev.target.closest(".g-cell");
      if (!c) return;
      sel = { trupp: c.dataset.trupp, from: c.dataset.day, to: c.dataset.day };
      ev.preventDefault();
    });
    g.addEventListener("pointermove", (ev) => {
      if (!sel) return;
      const c = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".g-cell");
      if (!c || c.dataset.trupp !== sel.trupp || c.dataset.day === sel.to) return;
      sel.to = c.dataset.day; mark();
    });
    window.addEventListener("pointerup", () => {
      if (!sel) return;
      const s = sel; sel = null;
      U.$$(".g-cell.sel", g).forEach((x) => x.classList.remove("sel"));
      if (s.from === s.to) return; // einzelner Tag: normaler Klick
      selJustEnded = true; setTimeout(() => { selJustEnded = false; }, 50);
      const [von, bis] = [s.from, s.to].sort();
      if (s.trupp.startsWith("abw:")) openAbw(null, { von, bis, monteurId: s.trupp.slice(4) });
      else openEinsatz(null, { von, bis, truppId: s.trupp || null });
    });
    U.$$(".g-cell", card).forEach((c) => {
      c.onclick = () => {
        if (selJustEnded) return;
        if (c.dataset.trupp.startsWith("abw:")) openAbw(null, { von: c.dataset.day, bis: c.dataset.day, monteurId: c.dataset.trupp.slice(4) });
        else openEinsatz(null, { von: c.dataset.day, bis: c.dataset.day, truppId: c.dataset.trupp || null });
      };
    });
  }
  // heutigen Tag ins Bild scrollen
  requestAnimationFrame(() => {
    const sc = card.querySelector(".g-scroll");
    const mo = g.querySelector(`.g-day[data-day="${M.mondayOf(t)}"]`);
    const corner = g.querySelector(".g-corner");
    if (planKeep) { sc.scrollLeft = planKeep.x; window.scrollTo(0, planKeep.y); planKeep = null; }
    else if (mo && sc.scrollWidth > sc.clientWidth) sc.scrollLeft = Math.max(0, mo.offsetLeft - corner.offsetWidth);
    // Name eines Einsatzes, der links aus dem Bild ragt, bleibt sichtbar (rückt neben die Trupp-Spalte)
    const bars = U.$$(".g-bar", g);
    let raf = 0;
    const follow = () => {
      raf = 0;
      const edge = corner.getBoundingClientRect().right;
      for (const b of bars) {
        const l = b.getBoundingClientRect().left;
        if (l < edge) b.style.setProperty("--follow", `${Math.max(8, Math.min(edge - l + 8, b.offsetWidth - 60))}px`);
        else b.style.removeProperty("--follow");
      }
    };
    sc.addEventListener("scroll", () => { if (!raf) raf = requestAnimationFrame(follow); }, { passive: true });
    follow();
  });
  const touch = "ontouchstart" in window;
  app.appendChild(U.el(`<p class="muted center">${editable()
    ? (touch ? "Antippen: öffnen · freier Tag: neuer Einsatz · kurz halten + ziehen: verschieben · Rand ziehen: Länge"
      : "Freier Tag: neuer Einsatz (mit gedrückter Maus über mehrere Tage ziehen: Zeitraum) · Balken ziehen: verschieben (auch zu anderem Trupp) · Rand ziehen: Länge ändern")
    : "Aktuelle und zwei kommende Wochen"}</p>`));
}

/* ---------- PDF: Kalenderwochen wählen (Standard: aktuelle + zwei kommende Wochen) ---------- */
function openPlanPdf() {
  const cur = M.mondayOf(M.today());
  const weeks = Array.from({ length: 31 }, (_, i) => M.addDays(cur, (i - 10) * 7)); // 10 Wochen zurück, 20 voraus
  const yr = cur.slice(0, 4);
  const label = (mo) => { const so = M.addDays(mo, 6); return `KW ${M.isoWeek(mo)} · ${M.shortDate(mo)}–${M.shortDate(so)}${so.slice(0, 4) !== yr ? so.slice(0, 4) : ""}${mo === cur ? " (aktuell)" : ""}`; };
  const opts = (sel) => weeks.map((mo) => `<option value="${mo}" ${mo === sel ? "selected" : ""}>${h(label(mo))}</option>`).join("");
  const body = U.el(`<div class="mon-form">
    <div class="grid2"><div><label class="field-label">von KW</label><select class="f-from">${opts(cur)}</select></div>
    <div><label class="field-label">bis KW</label><select class="f-to">${opts(M.addDays(cur, 14))}</select></div></div>
    <p class="muted pdf-range-info"></p></div>`);
  const from = body.querySelector(".f-from"), to = body.querySelector(".f-to"), info = body.querySelector(".pdf-range-info");
  const upd = () => {
    const maxTo = M.addDays(from.value, 28);
    for (const o of to.options) o.disabled = o.value < from.value || o.value > maxTo;
    if (to.value < from.value) to.value = from.value;
    if (to.value > maxTo) to.value = maxTo;
    const n = Math.round((M.parseDay(to.value) - M.parseDay(from.value)) / (7 * 86400000)) + 1;
    info.textContent = n > 5 ? `${n} Wochen – bitte höchstens 5 Wochen wählen.` : `${n} Woche${n > 1 ? "n" : ""} · A3 quer.`;
    info.classList.toggle("error-text", n > 5);
    return n;
  };
  from.onchange = upd; to.onchange = upd; upd();
  modal("Planung als PDF", body, [
    { label: "Abbrechen", fn: () => {} },
    { label: "PDF erstellen", cls: "primary", fn: () => {
      const n = upd();
      if (n > 5) { toast("Bitte höchstens 5 Kalenderwochen wählen.", "warn"); return false; }
      (async () => {
        U.busy("PDF wird erstellt …");
        try {
          const pEnd = M.addDays(from.value, n * 7 - 1);
          const pmap = new Map(assignColors(M.list("einsaetze").filter((e) => e.bis >= from.value && e.von <= pEnd)));
          const { blob, filename } = await buildPlanPdf({ colorOf: (x) => pmap.get(siteKeyOf(x)) || siteColor(x), start: from.value, weeks: n });
          U.busy(null);
          U.openPdf(blob, filename, "Montageplanung");
        } catch (e) {
          U.busy(null);
          toast("PDF konnte nicht erstellt werden: " + (e.message || e), "error", 8000);
        }
      })();
    } },
  ]);
}

/* ---------- Ziehen ----------
   Maus: sofort ziehen (ab 4 px Bewegung). Finger: kurz halten (0,35 s), dann ziehen –
   so bleibt normales Wischen/Scrollen möglich. */
let dragJustEnded = false;
function enableDrag(card, g, days) {
  const dayEls = U.$$(".g-day", g);
  const rowEls = U.$$(".g-trupp:not(.g-arow)", g);
  const dayAt = (x) => {
    let best = 0, bd = Infinity;
    dayEls.forEach((el, i) => { const r = el.getBoundingClientRect(); const c = (r.left + r.right) / 2; const d = Math.abs(x - c); if (d < bd) { bd = d; best = i; } });
    return best;
  };
  const rowAt = (y) => {
    let best = rowEls[0];
    for (const el of rowEls) { if (el.getBoundingClientRect().top <= y) best = el; }
    return best;
  };
  let st = null;
  const ghost = U.el(`<div class="g-ghost" hidden><span></span></div>`);
  g.appendChild(ghost);

  const start = (bar, mode, ev) => {
    const abw = !!bar.dataset.aid || !!bar.dataset.bid; // Krank/Urlaub und Bühnen bleiben in ihrer Zeile
    const lift = !!bar.dataset.bid;
    const e = lift ? M.get("buehnen", bar.dataset.bid) : bar.dataset.aid ? M.get("abwesenheiten", bar.dataset.aid) : M.get("einsaetze", bar.dataset.eid);
    if (!e || (lift && (!e.von || !e.bis))) return;
    st = { bar, e, abw, lift, mode, x0: ev.clientX, y0: ev.clientY, i0: dayAt(ev.clientX), von: e.von, bis: e.bis, truppId: e.truppId || "", active: false, pid: ev.pointerId, touch: ev.pointerType === "touch", timer: null };
    if (st.touch) {
      st.timer = setTimeout(() => { if (st && !st.moved) activate(); }, 350);
    }
  };
  const activate = () => {
    st.active = true;
    st.bar.classList.add("dragging");
    document.body.classList.add("g-dragging");
    if (navigator.vibrate) try { navigator.vibrate(15); } catch {}
    update(st.x0, st.y0);
  };
  const clampDay = (i) => Math.max(0, Math.min(days.length - 1, i));
  const update = (x, y) => {
    const di = dayAt(x) - st.i0;
    const e = st.e;
    let von = e.von, bis = e.bis, truppId = e.truppId || "";
    if (st.mode === "move") {
      von = M.addDays(e.von, di); bis = M.addDays(e.bis, di);
      if (!st.abw) truppId = rowAt(y).dataset.row || "";
    } else if (st.mode === "start") {
      von = M.addDays(e.von, di); if (von > bis) von = bis;
    } else {
      bis = M.addDays(e.bis, di); if (bis < von) bis = von;
    }
    Object.assign(st, { von, bis, truppId });
    // Vorschau
    const gr = g.getBoundingClientRect();
    const iv = clampDay(days.indexOf(von) >= 0 ? days.indexOf(von) : (von < days[0] ? 0 : days.length - 1));
    const ib = clampDay(days.indexOf(bis) >= 0 ? days.indexOf(bis) : (bis < days[0] ? 0 : days.length - 1));
    const a = dayEls[iv].getBoundingClientRect(), b = dayEls[ib].getBoundingClientRect();
    const rr = st.abw ? st.bar.getBoundingClientRect() : (rowEls.find((r) => (r.dataset.row || "") === truppId) || rowAt(y)).getBoundingClientRect();
    Object.assign(ghost.style, { left: `${a.left - gr.left + 2}px`, width: `${b.right - a.left - 4}px`, top: `${rr.top - gr.top + (st.abw ? 0 : 4)}px`, height: `${rr.height - (st.abw ? 0 : 8)}px` });
    ghost.querySelector("span").textContent = `${M.wdName(von)} ${M.shortDate(von)} – ${M.wdName(bis)} ${M.shortDate(bis)}`;
    ghost.hidden = false;
  };
  const finish = (commit) => {
    if (!st) return;
    clearTimeout(st.timer);
    const s0 = st;
    st = null;
    ghost.hidden = true;
    s0.bar.classList.remove("dragging");
    document.body.classList.remove("g-dragging");
    if (!s0.active) return;
    dragJustEnded = true;
    setTimeout(() => { dragJustEnded = false; }, 50);
    const e = s0.e;
    if (!commit || (s0.von === e.von && s0.bis === e.bis && s0.truppId === (e.truppId || ""))) return;
    if (s0.lift) {
      const rec = M.put("buehnen", { ...e, von: s0.von, bis: s0.bis });
      toast(`${M.buehneText(rec)} · ${M.baustelleLabel(rec)}: Mietbeginn ${M.longDate(rec.von)} – Mietende ${M.longDate(rec.bis)}`, "info", 3000);
      changed();
      return;
    }
    if (s0.abw) {
      const rec = M.put("abwesenheiten", { ...e, von: s0.von, bis: s0.bis });
      const pn = (M.get("monteure", rec.monteurId) || {}).name || "";
      toast(`${pn}: ${M.ABW_TYPES[rec.typ]} ${M.longDate(rec.von)} – ${M.longDate(rec.bis)}`, "info", 2500);
      const hits = M.list("einsaetze").filter((x) => (x.monteure || []).includes(rec.monteurId) && x.von <= rec.bis && x.bis >= rec.von);
      if (hits.length) toast(`${pn} ist an diesen Tagen automatisch nicht eingeteilt.`, "info", 4000);
      changed();
      return;
    }
    const next = { ...e, von: s0.von, bis: s0.bis, truppId: s0.truppId || null };
    // tagesgenaue Abweichungen wandern beim Verschieben mit, beim Kürzen fallen Tage außerhalb weg
    if (st === null && s0.mode === "move") next.off = M.shiftOff(e.off, Math.round((M.parseDay(s0.von) - M.parseDay(e.von)) / 86400000));
    next.off = M.cleanOff(next);
    // Trupp gewechselt: Monteure übernehmen, wenn noch die Stammbesetzung eingetragen war
    if (next.truppId !== (e.truppId || null)) {
      const oldT = M.get("trupps", e.truppId), newT = M.get("trupps", next.truppId);
      const same = oldT && [...e.monteure].sort().join() === [...oldT.monteure].sort().join();
      if (newT && (same || !e.monteure.length)) next.monteure = newT.monteure.slice();
    }
    const ob = M.overbooked(next);
    if (ob) { alert("Nicht möglich:\n\n" + M.overbookedText(next, ob)); return; }
    const cf = M.conflicts(next);
    if (cf.length) {
      if (!confirm(overrideText(cf))) return;
      Object.assign(next, M.withoutConflicts(next));
    }
    M.put("einsaetze", next);
    followBuehnen(e, next);
    toast(`${M.baustelleLabel(next)}: ${M.longDate(next.von)} – ${M.longDate(next.bis)}${next.truppId !== (e.truppId || null) ? " · " + M.truppName(M.get("trupps", next.truppId)) : ""}`, "info", 2500);
    changed();
  };

  // Überlappende Balken: die Kante ist schräg – Anfassen nahe der Schräge = Länge ändern
  const slantEdge = (bar, x, y) => {
    if (!editable() || !bar.classList.contains("join")) return null;
    const r = bar.getBoundingClientRect(), cs = getComputedStyle(bar);
    const f = Math.min(1, Math.max(0, (y - r.top) / r.height)), w = r.width + 2;
    const grip = 16;
    if (bar.classList.contains("join-r")) {
      const xr = r.right - parseFloat(cs.getPropertyValue("--ovr")) * w * f; // sichtbare rechte Kante in dieser Höhe
      if (x <= xr && x >= xr - grip && bar.querySelector(".g-h.r")) return "end";
    }
    if (bar.classList.contains("join-l")) {
      const xl = r.left + 3 + parseFloat(cs.getPropertyValue("--ovl")) * w * (1 - f); // sichtbare linke Kante
      if (x >= xl && x <= xl + grip && bar.querySelector(".g-h.l")) return "start";
    }
    return null;
  };
  g.addEventListener("pointermove", (ev) => {
    if (st || ev.pointerType === "touch") return;
    const bar = ev.target.closest(".g-bar.join");
    if (bar) bar.style.cursor = slantEdge(bar, ev.clientX, ev.clientY) ? "ew-resize" : "";
  });
  // Maus/Stift: Zeiger-Ereignisse
  const knobBar = (t) => { const k = t.closest && t.closest(".g-knob"); return k ? [g.querySelector(`.g-bar[data-eid="${k.dataset.eid}"]`), k.dataset.h] : null; };
  g.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType === "touch") return;
    const kb = knobBar(ev.target);
    if (kb && kb[0] && ev.button === 0) { ev.preventDefault(); start(kb[0], kb[1], ev); try { ev.target.setPointerCapture(ev.pointerId); } catch {} return; }
    const bar = ev.target.closest(".g-bar, .g-abw, .g-bue");
    if (!bar || ev.button > 0) return;
    const hnd = ev.target.closest(".g-h");
    start(bar, slantEdge(bar, ev.clientX, ev.clientY) || (hnd ? hnd.dataset.h : "move"), ev);
    try { bar.setPointerCapture(ev.pointerId); } catch {}
  });
  g.addEventListener("pointermove", (ev) => {
    if (!st || st.touch || ev.pointerId !== st.pid) return;
    if (!st.active) {
      if (Math.hypot(ev.clientX - st.x0, ev.clientY - st.y0) < 4) return;
      activate();
    }
    update(ev.clientX, ev.clientY);
  });
  g.addEventListener("pointerup", (ev) => { if (st && !st.touch && ev.pointerId === st.pid) finish(true); });
  g.addEventListener("pointercancel", () => { if (st && !st.touch) finish(false); });
  // Finger: Touch-Ereignisse (kurz halten, dann ziehen; sonst normal wischen/scrollen)
  g.addEventListener("touchstart", (ev) => {
    if (ev.touches.length !== 1) { finish(false); return; }
    const kb = knobBar(ev.target);
    if (kb && kb[0]) { const t = ev.touches[0]; start(kb[0], kb[1], { clientX: t.clientX, clientY: t.clientY, pointerId: "touch", pointerType: "touch" }); if (st) { clearTimeout(st.timer); activate(); } return; }
    const bar = ev.target.closest(".g-bar, .g-abw, .g-bue");
    if (!bar) return;
    const t = ev.touches[0];
    const hnd = ev.target.closest(".g-h");
    start(bar, slantEdge(bar, t.clientX, t.clientY) || (hnd ? hnd.dataset.h : "move"), { clientX: t.clientX, clientY: t.clientY, pointerId: "touch", pointerType: "touch" });
  }, { passive: true });
  g.addEventListener("touchmove", (ev) => {
    if (!st || !st.touch) return;
    const t = ev.touches[0];
    if (!st.active) {
      if (Math.hypot(t.clientX - st.x0, t.clientY - st.y0) > 8) { clearTimeout(st.timer); st = null; } // Wischen = Scrollen
      return;
    }
    ev.preventDefault(); // während des Ziehens nicht scrollen
    update(t.clientX, t.clientY);
  }, { passive: false });
  g.addEventListener("touchend", () => { if (st && st.touch) finish(true); });
  g.addEventListener("touchcancel", () => { if (st && st.touch) finish(false); });
  g.addEventListener("contextmenu", (ev) => { if (st) ev.preventDefault(); });
}

// Bühnen der Baustelle, die mit dem Einsatz enden, ziehen beim Verschieben mit
function followBuehnen(oldE, newE) {
  const siteEnd = M.list("einsaetze").filter((x) => M.sameSite(x, newE)).reduce((mx, x) => (x.bis > mx ? x.bis : mx), "");
  let n = 0;
  for (const b of M.buehnenOf(newE)) {
    if (!b.abgemeldetAm && b.bis === oldE.bis && siteEnd && b.bis !== siteEnd) { M.put("buehnen", { ...b, bis: siteEnd }); n++; }
  }
  if (n) setTimeout(() => toast(`Mietende von ${n} Bühne${n > 1 ? "n" : ""} mit angepasst: ${M.longDate(siteEnd)}`, "info", 4000), 2600);
}

/* =========================================================
   Bühnen
========================================================= */
export function renderMonBuehnen(app) {
  const t = M.today();
  app.appendChild(U.el(`<div class="page-head"><h1>Bühnen</h1>${editable() ? `<button class="primary" id="newB" type="button">+ Bühne</button>` : ""}</div>`));
  const nb = U.$("#newB");
  if (nb) nb.onclick = () => openBuehne(null, {});
  const all = M.list("buehnen");
  const due = M.dueBuehnen(t);
  const aktiv = all.filter((b) => !b.abgemeldetAm && !due.includes(b)).sort((a, b) => (a.bis || "9").localeCompare(b.bis || "9"));
  const ab = all.filter((b) => b.abgemeldetAm && b.abgemeldetAm >= M.addDays(t, -14)).sort((a, b) => (a.bis || "9").localeCompare(b.bis || "9"));

  // fällig: je Vermieter eine E-Mail
  if (due.length) {
    const byV = new Map();
    for (const b of due) { if (!byV.has(b.vermieterId)) byV.set(b.vermieterId, []); byV.get(b.vermieterId).push(b); }
    const card = U.el(`<div class="card mon-due"><h3 class="section-title">Abmelden fällig</h3></div>`);
    for (const [vid, list] of byV) {
      const v = M.get("vermieter", vid);
      const grp = U.el(`<div class="mon-vgroup">
        <div class="mon-vhead"><div><b>${h(v ? v.firma : vid ? "Unbekannter Vermieter" : "Bühler (eigene)")}</b>${v && v.ansprechpartner ? ` <span class="muted">· ${h(v.ansprechpartner)}</span>` : ""}</div>
          ${!editable() ? "" : v ? `<button class="primary small" type="button" data-mail="${h(vid)}">${ICO.mail} Abmelden per E-Mail</button>` : `<button class="primary small" type="button" data-done="${h(vid || "")}">${ICO.check} Als abgemeldet markieren</button>`}</div>
        ${list.map((b) => buehneRow(b, true)).join("")}
        <div class="mon-sent" hidden><span>E-Mail an ${h(v ? v.firma : "")} gesendet?</span><span class="row"><button class="secondary small" type="button" data-notsent>Nein</button><button class="primary small" type="button" data-done="${h(vid)}">${ICO.check} Ja, als abgemeldet markieren</button></span></div>
      </div>`);
      card.appendChild(grp);
      const mb = grp.querySelector("[data-mail]");
      if (mb) mb.onclick = () => {
        if (!v || !v.email) { toast("Für diesen Vermieter ist keine E-Mail-Adresse hinterlegt (Einstellungen › BauMon › Bühnenvermieter).", "warn", 7000); return; }
        const acc = U.account();
        U.openMail(M.abmeldeMail(v, list, acc && acc.name));
        grp.querySelector(".mon-sent").hidden = false;
      };
      const ns = grp.querySelector("[data-notsent]");
      if (ns) ns.onclick = () => { grp.querySelector(".mon-sent").hidden = true; };
      for (const db of grp.querySelectorAll("[data-done]")) db.onclick = () => { for (const b of list) M.put("buehnen", { ...b, abgemeldetAm: t }); toast(`${list.length} Bühne(n) als abgemeldet markiert.`, "info", 3000); changed(); };
    }
    app.appendChild(card);
  }
  const sec = (title, list, info) => {
    const card = U.el(`<div class="card"><h3 class="section-title">${title}</h3>${list.length ? list.map((b) => buehneRow(b)).join("") : `<p class="muted">${info}</p>`}</div>`);
    app.appendChild(card);
  };
  sec("Im Einsatz", aktiv, "Keine Bühnen im Einsatz.");
  if (ab.length) sec("Abgemeldet (letzte 14 Tage)", ab, "");
  U.$$("[data-bid]", app).forEach((r) => { r.onclick = () => openBuehne(M.get("buehnen", r.dataset.bid)); });
  app.appendChild(vermieterCard());
}

function buehneRow(b, due = false) {
  const status = b.abgemeldetAm ? `abgemeldet ${M.shortDate(b.abgemeldetAm)}` : b.bis ? `Mietende ${M.wdName(b.bis)} ${M.shortDate(b.bis)}` : "ohne Enddatum";
  return `<button type="button" class="mon-brow ${due ? "due" : ""}" data-bid="${h(b.id)}">
    <span class="mon-brow-main"><b>${h(M.baustelleLabel(b))}</b> · ${h(M.buehneText(b))}</span>
    <span class="muted">${h(vermieterName(b.vermieterId))}${b.auftragsNr ? " · Nr. " + h(b.auftragsNr) : ""} · ${h(status)}</span></button>`;
}

/* =========================================================
   Dialoge
========================================================= */
// von/bis-Datumsfelder koppeln: "bis" kann nicht vor "von" gewählt werden
function linkRange(root) {
  const von = root.querySelector('input[type="date"].f-von'), bis = root.querySelector('input[type="date"].f-bis');
  if (!von || !bis) return;
  const sync = () => {
    bis.min = von.value || "";
    if (von.value && bis.value && bis.value < von.value) bis.value = von.value;
  };
  von.addEventListener("change", sync);
  von.addEventListener("input", sync);
  bis.addEventListener("change", () => { if (von.value && bis.value && bis.value < von.value) bis.value = von.value; });
  sync();
}

function modal(title, body, actions) {
  const wrap = U.el(`<div class="mon-modal" role="dialog" aria-modal="true" aria-label="${h(title)}">
    <div class="mon-modal-card"><div class="mon-modal-head"><h3>${h(title)}</h3><button type="button" class="icon-btn" data-x aria-label="Schließen"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    <div class="mon-modal-body"></div><div class="mon-modal-foot"></div></div></div>`);
  wrap.querySelector(".mon-modal-body").appendChild(body);
  linkRange(body);
  const foot = wrap.querySelector(".mon-modal-foot");
  const close = () => { wrap.remove(); document.body.classList.remove("modal-open"); };
  for (const a of actions) {
    const b = U.el(`<button type="button" class="${a.cls || "secondary"}">${h(a.label)}</button>`);
    b.onclick = () => { if (a.fn() !== false) close(); };
    foot.appendChild(b);
  }
  wrap.querySelector("[data-x]").onclick = close;
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
  document.body.appendChild(wrap);
  document.body.classList.add("modal-open");
  return { wrap, close };
}

// Baustelle wählen: BV aus BauDoc (Nummer, Bauherr, Ort) oder freier Text
function siteField(init) {
  const box = U.el(`<div class="mon-site-field">
    <label class="field-label">Baustelle (BV)</label>
    <input type="text" class="site-in" placeholder="BV-Nr. oder Name suchen" autocomplete="off" />
    <div class="place-list site-list"></div></div>`);
  const input = box.querySelector(".site-in");
  const listEl = box.querySelector(".site-list");
  let val = { bvNumber: init.bvNumber || "", baustelle: init.baustelle || "" };
  input.value = M.baustelleLabel(val) === "Baustelle" ? "" : M.baustelleLabel(val);
  const show = () => {
    const q = input.value.trim().toLowerCase();
    const ps = U.projects().filter((p) => !q || (p.number + " " + p.title + " " + (p.client || "") + " " + (p.place || "")).toLowerCase().includes(q)).slice(0, 300);
    const qRaw = input.value.trim();
    listEl.innerHTML = (editable() && U.createBV ? `<button type="button" class="place-opt new-bv" data-new="1">+ Neues BV anlegen${qRaw ? ` „${h(qRaw)}“` : ""}</button>` : "")
      + ps.map((p) => `<button type="button" class="place-opt" data-n="${h(p.number)}" data-t="${h(p.title)}">${h(p.number)} ${h(p.client || p.title)}<span>${h(p.place || "")}</span></button>`).join("");
    const nb = listEl.querySelector("[data-new]");
    if (nb) nb.addEventListener("click", (e) => {
      e.preventDefault();
      listEl.innerHTML = "";
      openNewBV(qRaw, (p) => {
        val = { bvNumber: p.number, baustelle: p.title };
        input.value = M.baustelleLabel(val);
        box.dispatchEvent(new Event("sitechange"));
      });
    });
    U.$$(".place-opt:not([data-new])", listEl).forEach((b) => b.addEventListener("click", (e) => {
      e.preventDefault();
      val = { bvNumber: b.dataset.n, baustelle: b.dataset.t };
      input.value = M.baustelleLabel(val);
      listEl.innerHTML = "";
      box.dispatchEvent(new Event("sitechange"));
    }));
  };
  input.addEventListener("focus", show);
  input.addEventListener("input", () => { val = { bvNumber: "", baustelle: input.value.trim() }; show(); });
  input.addEventListener("blur", () => setTimeout(() => { if (!listBusy()) listEl.innerHTML = ""; }, 150));
  return { box, value: () => {
    const m = input.value.trim().match(/^(\d{5})\s+(.*)$/);
    if (!val.bvNumber && m) return { bvNumber: m[1], baustelle: m[2] };
    return val.bvNumber ? val : { bvNumber: "", baustelle: input.value.trim() };
  } };
}

function chipPicker(all, selected) {
  const sel = new Set(selected);
  let busy = new Map(); // Monteur -> anderer Einsatz im gewählten Zeitraum
  const box = U.el(`<div class="chips"></div>`);
  const draw = () => {
    box.innerHTML = all.map((x) => {
      const b = busy.get(x.id);
      return `<button type="button" class="chip ${sel.has(x.id) ? "on" : ""} ${b ? "busy" : ""}" data-id="${h(x.id)}" ${b ? `title="${h(b.title)}"` : ""}>${h(x.name)}${x.rm ? ' <span class="p-badge">RM</span>' : x.maler ? ' <span class="p-badge">Maler</span>' : ""}${b ? ` <small>· ${h(b.label)}</small>` : ""}</button>`;
    }).join("") || `<span class="muted">Noch keine Monteure angelegt.</span>`;
    U.$$(".chip", box).forEach((c) => { c.onclick = () => { sel.has(c.dataset.id) ? sel.delete(c.dataset.id) : sel.add(c.dataset.id); draw(); }; });
  };
  draw();
  return { box, value: () => [...sel], set: (ids) => { sel.clear(); ids.forEach((i) => sel.add(i)); draw(); },
    setBusy: (m) => { busy = m; draw(); } };
}

// Neues BV direkt aus BauMon anlegen (erscheint auch in BauDoc)
function openNewBV(text, done) {
  const t = String(text || "").trim();
  const m = t.match(/^(\d{5})\s*(.*)$/);
  const num = m ? m[1] : /^\d{1,5}$/.test(t) ? t : "";
  const client = m ? m[2] : /^\d+$/.test(t) ? "" : t;
  const body = U.el(`<div class="mon-form">
    <label class="field-label">BV-Nummer</label><input type="text" class="f-num" inputmode="numeric" maxlength="5" value="${h(num)}" placeholder="5-stellig" />
    <div class="num-exists" hidden></div>
    <label class="field-label">Bauherr / Auftraggeber</label><input type="text" class="f-client" value="${h(client)}" autocomplete="off" />
    <label class="field-label">Bauort</label><div class="place-field"><input type="text" class="f-place" autocomplete="off" placeholder="Ort eingeben" /><div class="place-list f-plist"></div></div>
    <p class="muted small-note">Das BV wird wie in BauDoc angelegt und steht dort sofort zur Verfügung.</p></div>`);
  const numEl = body.querySelector(".f-num"), cEl = body.querySelector(".f-client"), pEl = body.querySelector(".f-place");
  // Nummer schon vergeben? -> sofort anzeigen, vorhandenes BV kann direkt übernommen werden
  const exBox = body.querySelector(".num-exists");
  const checkNum = () => {
    numEl.value = numEl.value.replace(/\D/g, "").slice(0, 5);
    const ex = numEl.value.length === 5 && U.findBV ? U.findBV(numEl.value) : null;
    numEl.classList.toggle("invalid", !!ex);
    exBox.hidden = !ex;
    if (!ex) return;
    exBox.innerHTML = `BV ${h(ex.p.number)} gibt es schon${ex.archived ? " (im Archiv)" : ""}: ${h(ex.p.client || ex.p.title)}${ex.p.place ? ", " + h(ex.p.place) : ""}
      ${ex.archived ? "" : `<button type="button" class="secondary small" data-use>Dieses BV übernehmen</button>`}`;
    const use = exBox.querySelector("[data-use]");
    if (use) use.onclick = () => { dlg.close(); done(ex.p); };
  };
  numEl.addEventListener("input", checkNum);
  let geo = null, busy = false;
  const sug = U.placeSuggest(pEl, body.querySelector(".f-plist"), (g) => { geo = g; });
  const dlg = modal("Neues Bauvorhaben", body, [
    { label: "Abbrechen", fn: () => {} },
    { label: "Anlegen", cls: "primary", fn: () => {
      if (busy) return false;
      busy = true;
      U.createBV({ num: numEl.value, client: cEl.value, place: pEl.value, geo }).then((r) => {
        busy = false;
        if (r.pick) { toast("Mehrere Orte passen – bitte den Ort aus der Liste wählen.", "warn", 5000); pEl.focus(); sug.show(r.pick); return; }
        if (r.error) { toast(r.error, "warn", 6000); ({ num: numEl, client: cEl, place: pEl })[r.field]?.focus(); return; }
        dlg.close();
        toast(`BV ${r.p.number} angelegt.`, "info", 2500);
        done(r.p);
      });
      return false; // Dialog bleibt offen, bis das BV angelegt ist
    } },
  ]);
  checkNum();
  setTimeout(() => (num.length === 5 ? (client ? pEl : cEl) : numEl).focus(), 50);
}

// Kleines Menü an der Zeigerposition: Krank/Urlaub für einen Tag schnell eintragen
function quickMenu(x, y, pid, day, card) {
  document.querySelector(".quick-menu")?.remove();
  const p = M.get("monteure", pid);
  if (!p) return;
  const a = M.absentRec(pid, day);
  const menu = U.el(`<div class="quick-menu" role="menu"><div class="qm-head">${h(p.name)} · ${h(M.wdName(day))} ${h(M.shortDate(day))}</div>
    ${a ? `<button type="button" data-q="edit">${M.ABW_TYPES[a.typ]} ${h(M.shortDate(a.von))}–${h(M.shortDate(a.bis))} bearbeiten …</button>
      <button type="button" data-q="del" class="qm-danger">${M.ABW_TYPES[a.typ]} löschen</button>`
    : `<button type="button" data-q="krank">Krank – dieser Tag</button>
      <button type="button" data-q="urlaub">Urlaub – dieser Tag</button>
      <button type="button" data-q="range">Krank / Urlaub mit Zeitraum …</button>`}</div>`);
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - r.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - r.height - 8))}px`;
  const close = () => { menu.remove(); document.removeEventListener("pointerdown", outside, true); window.removeEventListener("scroll", close, true); };
  const outside = (ev) => { if (!menu.contains(ev.target)) close(); };
  setTimeout(() => { document.addEventListener("pointerdown", outside, true); window.addEventListener("scroll", close, true); }, 0);
  U.$$("[data-q]", menu).forEach((b) => { b.onclick = () => {
    const q = b.dataset.q;
    close();
    if (q === "edit") return openAbw(a);
    if (q === "range") return openAbw(null, { monteurId: pid, von: day, bis: day });
    if (q === "del") { if (!confirm(`${M.ABW_TYPES[a.typ]} von ${p.name} (${M.shortDate(a.von)}–${M.shortDate(a.bis)}) löschen?`)) return; M.remove("abwesenheiten", a.id); keepPlanScroll(card); changed(); return; }
    // ein Tag: an einen direkt angrenzenden Eintrag gleicher Art anhängen, sonst neu
    const prev = M.absentRec(pid, M.addDays(day, -1)), next = M.absentRec(pid, M.addDays(day, 1));
    if (prev && prev.typ === q && next && next.typ === q && prev.id !== next.id) { M.put("abwesenheiten", { ...prev, bis: next.bis }); M.remove("abwesenheiten", next.id); }
    else if (prev && prev.typ === q) M.put("abwesenheiten", { ...prev, bis: day });
    else if (next && next.typ === q) M.put("abwesenheiten", { ...next, von: day });
    else M.put("abwesenheiten", { monteurId: pid, typ: q, von: day, bis: day, notiz: "" });
    toast(`${p.name}: ${M.ABW_TYPES[q]} am ${M.longDate(day)}`, "info", 2500);
    keepPlanScroll(card);
    changed();
  }; });
}

// Krank / Urlaub eintragen
export function openAbw(a, preset = {}) {
  const isNew = !a;
  const cur = a ? { ...a } : { id: null, monteurId: preset.monteurId || "", typ: preset.typ || "urlaub", von: preset.von || M.today(), bis: preset.bis || preset.von || M.today(), notiz: "" };
  const ro = !editable();
  const people = M.sortedMonteure();
  const body = U.el(`<div class="mon-form">
    <label class="field-label">Person</label><div class="typ-field p-field"><input type="text" class="f-pname" value="${h((M.get("monteure", cur.monteurId) || {}).name || "")}" placeholder="Name eingeben oder wählen" autocomplete="off" />
      <button type="button" class="typ-open" aria-label="Personen anzeigen" tabindex="-1"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button><div class="place-list typ-list p-list"></div>
      <input type="hidden" class="f-p" value="${h(cur.monteurId || "")}" /></div>
    <label class="field-label">Art</label><div class="seg abw-seg" role="group">${Object.entries(M.ABW_TYPES).map(([k, l]) => `<button type="button" data-typ="${k}" class="${cur.typ === k ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="grid2 tight"><div><label class="field-label">von</label><input type="date" class="f-von" value="${h(cur.von)}" /></div>
    <div><label class="field-label">bis</label><input type="date" class="f-bis" value="${h(cur.bis)}" /></div></div>
    <label class="field-label">Notiz</label><input type="text" class="f-notiz" value="${h(cur.notiz)}" placeholder="optional" /></div>`);
  // Person: eintippen oder aus der Liste – es muss ein Treffer aus der Liste sein
  const pIn = body.querySelector(".f-pname"), pHid = body.querySelector(".f-p"), pList = body.querySelector(".p-list");
  const label = (p) => `${p.name}${p.maler ? " · Maler" : p.rm ? " · RM" : ""}`;
  const showP = (all) => {
    const q = all ? "" : pIn.value.trim().toLowerCase();
    const xs = people.filter((p) => !q || p.name.toLowerCase().includes(q));
    pList.innerHTML = xs.length ? xs.map((p) => `<button type="button" class="place-opt" data-pid="${h(p.id)}">${h(label(p))}</button>`).join("") : `<div class="place-opt muted">Kein Treffer</div>`;
    U.$$("[data-pid]", pList).forEach((o) => o.addEventListener("click", (ev) => { ev.preventDefault(); const p = M.get("monteure", o.dataset.pid); pIn.value = p.name; pHid.value = p.id; pIn.classList.remove("invalid"); pList.innerHTML = ""; }));
  };
  const matchP = () => {
    const q = pIn.value.trim().toLowerCase();
    const exact = people.filter((p) => p.name.toLowerCase() === q);
    const part = people.filter((p) => p.name.toLowerCase().includes(q));
    const hit = exact.length === 1 ? exact[0] : q && part.length === 1 ? part[0] : null;
    pHid.value = hit ? hit.id : "";
    if (hit) pIn.value = hit.name;
    pIn.classList.toggle("invalid", !!q && !hit);
  };
  pIn.addEventListener("focus", () => showP(true));
  pIn.addEventListener("input", () => { pHid.value = ""; showP(false); });
  pIn.addEventListener("blur", () => setTimeout(() => { if (listBusy()) return; pList.innerHTML = ""; matchP(); }, 150));
  body.querySelector(".p-field .typ-open").addEventListener("pointerdown", (ev) => { ev.preventDefault(); if (pList.innerHTML) pList.innerHTML = ""; else { pIn.focus(); showP(true); } });
  let typ = cur.typ;
  U.$$("[data-typ]", body).forEach((b) => { b.onclick = () => { typ = b.dataset.typ; U.$$("[data-typ]", body).forEach((x) => x.classList.toggle("on", x === b)); }; });
  if (ro) U.$$("input,select,button", body).forEach((x) => { x.disabled = true; });
  const save = () => {
    if (!pHid.value) matchP();
    const monteurId = pHid.value;
    const von = body.querySelector(".f-von").value, bis = body.querySelector(".f-bis").value;
    if (!monteurId) { toast(pIn.value.trim() ? `„${pIn.value.trim()}“ gibt es nicht – bitte eine Person aus der Liste wählen.` : "Bitte die Person wählen.", "warn", 5000); pIn.focus(); return false; }
    if (!von || !bis || bis < von) { toast("Bitte einen gültigen Zeitraum angeben (bis ≥ von).", "warn"); return false; }
    const ov = M.list("abwesenheiten").find((x) => x.id !== cur.id && x.monteurId === monteurId && x.von <= bis && x.bis >= von);
    if (ov) { toast(`Überschneidet sich mit ${M.ABW_TYPES[ov.typ]} ${M.shortDate(ov.von)}–${M.shortDate(ov.bis)}.`, "warn", 5000); return false; }
    const rec = M.put("abwesenheiten", { ...cur, monteurId, typ, von, bis, notiz: body.querySelector(".f-notiz").value.trim() });
    const hits = M.list("einsaetze").filter((e) => (e.monteure || []).includes(monteurId) && e.von <= rec.bis && e.bis >= rec.von);
    if (hits.length) toast(`${M.get("monteure", monteurId).name} ist an diesen Tagen automatisch nicht eingeteilt.`, "info", 4000);
    changed();
  };
  const actions = ro ? [{ label: "Schließen", fn: () => {} }] : [
    ...(isNew ? [] : [{ label: "Löschen", cls: "danger-outline", fn: () => { if (!confirm("Eintrag löschen?")) return false; M.remove("abwesenheiten", cur.id); changed(); } }]),
    { label: "Abbrechen", fn: () => {} },
    ...(isNew ? [{ label: "+ Weiterer Zeitraum", fn: () => {
      if (save() === false) return false;
      const pid = body.querySelector(".f-p").value, nb = M.addDays(body.querySelector(".f-bis").value, 1);
      setTimeout(() => openAbw(null, { monteurId: pid, typ, von: nb, bis: nb }), 0);
    } }] : []),
    { label: isNew ? "Eintragen" : "Speichern", cls: "primary", fn: save },
  ];
  modal(isNew ? "Krank / Urlaub eintragen" : "Krank / Urlaub", body, actions);
}

export function openEinsatz(e, preset = {}) {
  const isNew = !e;
  const cur = e ? { ...e } : { id: null, truppId: preset.truppId || null, bvNumber: "", baustelle: "", von: preset.von, bis: preset.bis, monteure: [], leih: "", kran: "", notiz: "" };
  // Stammbesetzung eines Trupps: Richtmeister + hinterlegte Monteure
  const crewOf = (tid) => { const t = M.get("trupps", tid); return t ? [...new Set([t.fuehrerId, ...(t.monteure || [])].filter((id) => id && M.get("monteure", id)))] : []; };
  if (isNew && cur.truppId) cur.monteure = crewOf(cur.truppId);
  const ro = !editable();
  const body = U.el(`<div class="mon-form"></div>`);
  const site = siteField(cur);
  body.appendChild(site.box);
  body.appendChild(U.el(`<div class="grid2">
    <div><label class="field-label">Trupp</label><select class="f-trupp"><option value="" ${!cur.truppId ? "selected" : ""}>– kein Trupp –</option>${M.sortedTrupps().map((t) => `<option value="${h(t.id)}" ${t.id === cur.truppId ? "selected" : ""}>${h(M.truppName(t))}</option>`).join("")}</select></div>
    <div class="grid2 tight"><div><label class="field-label">von</label><input type="date" class="f-von" value="${h(cur.von || "")}" /></div>
    <div><label class="field-label">bis</label><input type="date" class="f-bis" value="${h(cur.bis || "")}" /></div></div></div>`));
  const crewLabel = U.el(`<label class="field-label">Monteure</label>`);
  body.appendChild(crewLabel);
  const chips = chipPicker(M.sortedMonteure(), cur.monteure);
  body.appendChild(chips.box);
  const malerInfo = U.el(`<p class="muted maler-info" hidden></p>`);
  body.appendChild(malerInfo);
  // Maler-Trupp: besteht nur aus dem Maler – keine Monteur-Auswahl
  const malerOf = (tid) => { const tr = M.get("trupps", tid); return tr && M.isMalerTrupp(tr) ? M.get("monteure", tr.fuehrerId) : null; };
  const updMaler = () => {
    const mp = malerOf(body.querySelector(".f-trupp").value);
    chips.box.hidden = !!mp; crewLabel.hidden = !!mp; malerInfo.hidden = !mp;
    if (mp) { malerInfo.textContent = `Maler: ${mp.name} (Maler-Trupps bestehen nur aus dem Maler)`; chips.set([mp.id]); }
  };
  body.appendChild(U.el(`<div><div class="grid2">
    <div><label class="field-label">Leiharbeiter</label><input type="text" class="f-leih" value="${h(cur.leih)}" placeholder="z. B. 2x Profutura" /></div>
    <div><label class="field-label">Kran</label><input type="text" class="f-kran" value="${h(cur.kran)}" placeholder="z. B. Baukran, MRT" /></div></div>
    <label class="field-label">Notiz</label><textarea class="f-notiz" rows="2">${h(cur.notiz)}</textarea></div>`));
  // Bühnen dieser Baustelle
  const bbox = U.el(`<div class="mon-bbox"></div>`);
  const drawB = () => {
    const s = site.value();
    const bs = s.bvNumber || s.baustelle ? M.buehnenOf(s) : [];
    bbox.innerHTML = `<label class="field-label">Bühnen auf dieser Baustelle</label>${bs.map((b) => buehneRow(b, M.isDue(b))).join("") || `<p class="muted">Keine.</p>`}
      ${ro ? "" : `<button type="button" class="secondary small" data-addb>${ICO.plus} Bühne hinzufügen</button>`}`;
    U.$$("[data-bid]", bbox).forEach((r) => { r.onclick = () => openBuehne(M.get("buehnen", r.dataset.bid), {}, drawB); });
    const ab = bbox.querySelector("[data-addb]");
    if (ab) ab.onclick = () => {
      const s2 = site.value();
      if (!s2.bvNumber && !s2.baustelle) { toast("Bitte zuerst die Baustelle wählen.", "warn"); return; }
      openBuehne(null, { ...s2, von: body.querySelector(".f-von").value, bis: body.querySelector(".f-bis").value }, drawB);
    };
  };
  body.appendChild(bbox);
  drawB();
  site.box.addEventListener("sitechange", drawB);
  site.box.querySelector(".site-in").addEventListener("blur", () => setTimeout(drawB, 200));
  const truppSel = body.querySelector(".f-trupp");
  const updBusy = () => {
    const von = body.querySelector(".f-von").value, bis = body.querySelector(".f-bis").value;
    const map = new Map();
    const allIds = M.list("monteure").map((x) => x.id);
    if (von && bis && bis >= von) {
      for (const c of M.conflicts({ ...cur, von, bis, truppId: truppSel.value || null }, allIds)) map.set(c.monteurId, { label: c.other.bvNumber || "belegt", title: "schon bei " + M.baustelleLabel(c.other) });
      for (const c of M.absenceConflicts({ von, bis }, allIds)) map.set(c.monteurId, { label: M.ABW_TYPES[c.abw.typ], title: `${M.ABW_TYPES[c.abw.typ]} ${M.shortDate(c.abw.von)}–${M.shortDate(c.abw.bis)}` });
    }
    chips.setBusy(map);
  };
  body.querySelector(".f-von").addEventListener("change", updBusy);
  body.querySelector(".f-bis").addEventListener("change", updBusy);
  updBusy();
  truppSel.onchange = () => { if (isNew || malerOf(truppSel.value)) chips.set(crewOf(truppSel.value)); updMaler(); updBusy(); };
  updMaler();
  if (ro) U.$$("input,select,textarea,.chip", body).forEach((x) => { x.disabled = true; });

  const save = () => {
    const s = site.value();
    const von = body.querySelector(".f-von").value;
    const bis = body.querySelector(".f-bis").value;
    if (!s.bvNumber && !s.baustelle) { toast("Bitte die Baustelle angeben.", "warn"); return false; }
    if (!von || !bis || bis < von) { toast("Bitte einen gültigen Zeitraum angeben (bis ≥ von).", "warn"); return false; }
    const ob = M.overbooked({ ...cur, von, bis, truppId: truppSel.value || null });
    if (ob) { alert(M.overbookedText({ truppId: truppSel.value }, ob)); return false; }
    let rec = { ...cur, ...s, truppId: truppSel.value || null, von, bis, monteure: chips.value(),
      leih: body.querySelector(".f-leih").value.trim(), kran: body.querySelector(".f-kran").value.trim(), notiz: body.querySelector(".f-notiz").value.trim() };
    // neu: Wochenende standardmäßig ausgespart (danach je Tag in der Personal-Ansicht änderbar)
    if (isNew) rec.off = M.weekendOff(rec);
    rec.off = M.cleanOff(rec);
    const cf = M.conflicts(rec);
    if (cf.length) {
      if (!confirm(overrideText(cf))) return false;
      rec = M.withoutConflicts(rec);
    }
    M.put("einsaetze", rec);
    changed();
  };
  const actions = ro ? [{ label: "Schließen", fn: () => {} }] : [
    ...(isNew ? [] : [{ label: "Löschen", cls: "danger-outline", fn: () => deleteEinsatz(cur) }]),
    { label: "Abbrechen", fn: () => {} },
    { label: isNew ? "Anlegen" : "Speichern", cls: "primary", fn: save },
  ];
  modal(isNew ? "Neuer Einsatz" : "Einsatz", body, actions);
}

// Einsatz löschen. Letzter Einsatz eines BV, auf dem noch Bühnen stehen -> fragen, was mit den Bühnen passiert.
function deleteEinsatz(e) {
  const others = M.list("einsaetze").some((o) => o.id !== e.id && M.sameSite(o, e));
  const bs = others ? [] : M.buehnenOf(e).filter((b) => !b.abgemeldetAm);
  if (!bs.length) {
    if (!confirm("Diesen Einsatz löschen?")) return false;
    M.remove("einsaetze", e.id); changed(); return;
  }
  const body = U.el(`<div class="mon-form"><p>Auf <b>${h(M.baustelleLabel(e))}</b> ${bs.length === 1 ? "steht noch eine Bühne" : `stehen noch ${bs.length} Bühnen`}, und es gibt danach keinen Einsatz mehr für dieses BV:</p>
    <ul class="mon-list">${bs.map((b) => `<li>${h(M.buehneText(b))} · ${h(vermieterName(b.vermieterId))}${b.bis ? ` <span class="muted">Mietende ${h(M.shortDate(b.bis))}</span>` : ""}</li>`).join("")}</ul>
    <p class="muted">Was soll mit ${bs.length === 1 ? "der Bühne" : "den Bühnen"} passieren? Der Einsatz wird in jedem Fall gelöscht.</p></div>`);
  const done = (msg) => { M.remove("einsaetze", e.id); toast(msg, "info", 3500); changed(); };
  modal("Einsatz löschen", body, [
    { label: "Bühnen löschen", cls: "danger-outline", fn: () => { if (!confirm(`${bs.length} Bühne(n) endgültig löschen?`)) return false; for (const b of bs) M.remove("buehnen", b.id); done(`Einsatz und ${bs.length} Bühne(n) gelöscht.`); } },
    { label: "Abbrechen", fn: () => {} },
    { label: "Bühnen trotzdem behalten", fn: () => done("Einsatz gelöscht – Bühnen bleiben (Planung › Bühnen › „Bühnen ohne Einsatz“).") },
    { label: "Bühnen abmelden", cls: "primary", fn: () => { done("Einsatz gelöscht."); setTimeout(() => abmeldenDialog(bs), 50); } },
  ]);
  return true; // Einsatz-Fenster schließen
}

// Mehrere Bühnen abmelden – je Vermieter eine E-Mail (wie im Reiter Bühnen), eigene direkt markieren
function abmeldenDialog(bs) {
  const groups = new Map();
  for (const b of bs) { const k = b.vermieterId || ""; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(b); }
  const body = U.el(`<div class="mon-form"></div>`);
  const draw = () => {
    body.innerHTML = "";
    let open = 0;
    for (const [vid, list0] of groups) {
      const list = list0.map((b) => M.get("buehnen", b.id)).filter((b) => b && !b.abgemeldetAm);
      if (!list.length) continue;
      open++;
      const v = vid && M.get("vermieter", vid);
      const grp = U.el(`<div class="mon-vgroup">
        <div class="mon-vhead"><div><b>${h(v ? v.firma : "Bühler (eigene)")}</b></div>
          ${v && v.email ? `<button class="primary small" type="button" data-mail>${ICO.mail} Abmelden per E-Mail</button>` : `<button class="primary small" type="button" data-done>${ICO.check} Als abgemeldet markieren</button>`}</div>
        ${list.map((b) => `<div class="muted">${h(M.buehneText(b))}${b.bis ? " · Mietende " + h(M.shortDate(b.bis)) : ""}</div>`).join("")}
        ${v && !v.email ? `<p class="muted small-note">Für ${h(v.firma)} ist keine E-Mail-Adresse hinterlegt.</p>` : ""}
        <div class="mon-sent" hidden><span>E-Mail an ${h(v ? v.firma : "")} gesendet?</span><span class="row"><button class="secondary small" type="button" data-notsent>Nein</button><button class="primary small" type="button" data-done>${ICO.check} Ja, als abgemeldet markieren</button></span></div></div>`);
      body.appendChild(grp);
      const mb = grp.querySelector("[data-mail]");
      if (mb) mb.onclick = () => { U.openMail(M.abmeldeMail(v, list, (U.account() || {}).name)); grp.querySelector(".mon-sent").hidden = false; };
      const ns = grp.querySelector("[data-notsent]"); if (ns) ns.onclick = () => { grp.querySelector(".mon-sent").hidden = true; };
      for (const d of grp.querySelectorAll("[data-done]")) d.onclick = () => { for (const b of list) M.put("buehnen", { ...b, abgemeldetAm: M.today() }); toast(`${list.length} Bühne(n) als abgemeldet markiert.`, "info", 3000); U.schedule(); U.render(); draw(); };
    }
    if (!open) body.innerHTML = `<p>${ICO.check} Alle Bühnen sind abgemeldet.</p>`;
  };
  draw();
  modal("Bühnen abmelden", body, [{ label: "Fertig", cls: "primary", fn: () => {} }]);
}

const TYPEN = ["Arbeitsbühne", "Scherenbühne", "Gelenkteleskopbühne", "Teleskopbühne", "Raupenbühne", "LKW-Bühne", "Teleskopstapler", "MRT (Manitou)"];

export function openBuehne(b, preset = {}, after) {
  const isNew = !b;
  const cur = b ? { ...b } : { id: null, bvNumber: preset.bvNumber || "", baustelle: preset.baustelle || "", vermieterId: (M.list("vermieter").sort((a, c) => a.firma.localeCompare(c.firma, "de"))[0] || {}).id || null,
    typ: "", anzahl: 1, von: preset.von || M.today(), bis: preset.bis || "", abgemeldetAm: "", auftragsNr: "", standort: "", notiz: "" };
  const ro = !editable();
  const body = U.el(`<div class="mon-form"></div>`);
  const site = siteField(cur);
  body.appendChild(site.box);
  // Vermieter alphabetisch, „Bühler (eigene)“ an seiner alphabetischen Stelle
  const vs = [...M.list("vermieter"), { id: "", firma: "Bühler (eigene)" }].sort((a, c) => a.firma.localeCompare(c.firma, "de", { sensitivity: "base" }));
  const typen = [...new Set([...TYPEN, ...M.list("buehnen").map((b) => b.typ).filter(Boolean)])];
  body.appendChild(U.el(`<div><div class="grid2">
    <div><label class="field-label">Vermieter</label><select class="f-v">${vs.map((v) => `<option value="${h(v.id)}" ${v.id === (cur.vermieterId || "") ? "selected" : ""}>${h(v.firma)}</option>`).join("")}</select></div>
    <div class="grid2 tight"><div><label class="field-label">Typ</label><div class="typ-field"><input type="text" class="f-typ" value="${h(cur.typ)}" placeholder="eingeben" autocomplete="off" />
      <button type="button" class="typ-open" aria-label="Typen anzeigen" tabindex="-1"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button><div class="place-list typ-list"></div></div></div>
    ${isNew ? `<div><label class="field-label">Anzahl</label><input type="number" min="1" max="20" class="f-n" value="1" title="Jede Bühne wird einzeln angelegt (eigene Zeile, einzeln abmeldbar)" /></div>` : ""}</div></div>
    <div class="grid2"><div class="grid2 tight"><div><label class="field-label">Mietbeginn</label><input type="date" class="f-von" value="${h(cur.von)}" /></div>
    <div><label class="field-label">Mietende</label><input type="date" class="f-bis" value="${h(cur.bis)}" /><div class="muted small-note bis-hint"></div></div></div>
    <div><label class="field-label">Auftrags-Nr. Vermieter</label><input type="text" class="f-nr" value="${h(cur.auftragsNr)}" placeholder="optional" /></div></div>
    <label class="field-label">Standort / Adresse (für den Vermieter)</label><input type="text" class="f-ort" value="${h(cur.standort)}" placeholder="optional" />
</div>`));
  // Typ: frei eintippen oder aus der Liste (Standard + bisher verwendete) übernehmen
  const tin = body.querySelector(".f-typ"), tlist = body.querySelector(".typ-list");
  const showTypen = (all) => {
    const q = all ? "" : tin.value.trim().toLowerCase();
    const xs = typen.filter((x) => !q || x.toLowerCase().includes(q));
    tlist.innerHTML = xs.map((x) => `<button type="button" class="place-opt" data-t="${h(x)}">${h(x)}</button>`).join("");
    U.$$(".place-opt", tlist).forEach((o) => o.addEventListener("click", (ev) => { ev.preventDefault(); tin.value = o.dataset.t; tlist.innerHTML = ""; }));
  };
  tin.addEventListener("focus", () => showTypen(true));
  tin.addEventListener("input", () => showTypen(false));
  tin.addEventListener("blur", () => setTimeout(() => { if (!listBusy()) tlist.innerHTML = ""; }, 150));
  body.querySelector(".typ-open").addEventListener("pointerdown", (ev) => { ev.preventDefault(); if (tlist.innerHTML) tlist.innerHTML = ""; else { tin.focus(); showTypen(true); } });
  // Mietende: Vorschlag = Ende der geplanten Einsätze des BV – nur solange das Feld leer ist und
  // nicht von Hand bearbeitet wurde. "angeliefert" wird nie automatisch geändert.
  if (isNew) {
    const bisIn = body.querySelector(".f-bis"), hint = body.querySelector(".bis-hint");
    let manual = !!preset.bis, auto = false;
    bisIn.addEventListener("input", () => { manual = true; auto = false; hint.textContent = ""; });
    const fromSite = () => {
      if (manual || (bisIn.value && !auto)) return;
      const es = M.list("einsaetze").filter((e) => M.sameSite(e, site.value()) && e.von && e.bis && e.bis >= M.today());
      if (!es.length) { if (auto) { bisIn.value = ""; auto = false; hint.textContent = ""; } return; }
      bisIn.value = es.reduce((m, e) => (e.bis > m ? e.bis : m), es[0].bis);
      auto = true;
      hint.textContent = "Vorschlag aus der Planung (Ende der Einsätze) – änderbar";
    };
    site.box.addEventListener("sitechange", fromSite);
    fromSite();
  }
  if (ro) U.$$("input,select,textarea", body).forEach((x) => { x.disabled = true; });
  const save = () => {
    const s = site.value();
    if (!s.bvNumber && !s.baustelle) { toast("Bitte die Baustelle angeben.", "warn"); return false; }
    const bis = body.querySelector(".f-bis").value;
    const von = body.querySelector(".f-von").value;
    if (!von) { toast("Bitte den Mietbeginn angeben.", "warn"); body.querySelector(".f-von").focus(); return false; }
    if (!bis) { toast("Bitte das Mietende angeben.", "warn"); body.querySelector(".f-bis").focus(); return false; }
    if (bis < von) { toast("Das Mietende liegt vor dem Mietbeginn.", "warn"); return false; }
    const rec = { ...cur, ...s, vermieterId: body.querySelector(".f-v").value || null, typ: body.querySelector(".f-typ").value.trim(),
      anzahl: 1, von, bis, auftragsNr: body.querySelector(".f-nr").value.trim(), standort: body.querySelector(".f-ort").value.trim() };
    // mehrere gleiche Bühnen: je Bühne ein eigener Eintrag (eigene Zeile, einzeln abmeldbar)
    const n = isNew ? Math.max(1, Math.min(20, Number(body.querySelector(".f-n").value) || 1)) : 1;
    for (let i = 0; i < n; i++) M.put("buehnen", { ...rec, id: i === 0 ? rec.id : null });
    if (n > 1) toast(`${n} Bühnen angelegt (je eine Zeile).`, "info", 3000);
    changed();
    if (after) after();
  };
  const actions = ro ? [{ label: "Schließen", fn: () => {} }] : [
    ...(isNew ? [] : [{ label: "Löschen", cls: "danger-outline", fn: () => { if (!confirm("Diese Bühne löschen?")) return false; M.remove("buehnen", cur.id); changed(); if (after) after(); } }]),
    { label: "Abbrechen", fn: () => {} },
    { label: isNew ? "Anlegen" : "Speichern", cls: "primary", fn: save },
  ];
  const dlg = modal(isNew ? "Neue Bühne" : "Bühne", body, actions);
  if (!isNew && !ro) {
    const bar = U.el(`<div class="mon-abm-bar">${cur.abgemeldetAm
      ? `<span>Abgemeldet am ${h(M.longDate(cur.abgemeldetAm))}</span><button type="button" class="secondary small" data-reakt>Wieder aktiv</button>`
      : `<span>${M.isDue(cur) ? "Abmelden fällig" : "Im Einsatz"}</span><button type="button" class="${M.isDue(cur) ? "primary" : "secondary"} small" data-abm>${ICO.mail} Bühne abmelden</button>`}</div>`);
    body.appendChild(bar);
    const re = bar.querySelector("[data-reakt]");
    if (re) re.onclick = () => { M.put("buehnen", { ...cur, abgemeldetAm: "" }); changed(); if (after) after(); dlg.close(); };
    const ab = bar.querySelector("[data-abm]");
    if (ab) ab.onclick = () => {
      const v = cur.vermieterId && M.get("vermieter", cur.vermieterId);
      const markDone = () => { M.put("buehnen", { ...cur, abgemeldetAm: M.today() }); changed(); if (after) after(); dlg.close(); };
      if (v && v.email) {
        // E-Mail öffnen; die Rückfrage erscheint in der App (kein Systemdialog – der würde in Safari das Öffnen der E-Mail blockieren)
        const acc = U.account();
        U.openMail(M.abmeldeMail(v, [cur], acc && acc.name));
        const before = bar.innerHTML;
        bar.innerHTML = `<span>E-Mail an ${h(v.firma)} gesendet?</span><span class="row"><button type="button" class="secondary small" data-notsent>Nein</button><button type="button" class="primary small" data-sent>${ICO.check} Ja, als abgemeldet markieren</button></span>`;
        bar.querySelector("[data-sent]").onclick = markDone;
        // Nein: nichts ändern, Knopf „Bühne abmelden“ wieder zeigen
        bar.querySelector("[data-notsent]").onclick = () => { bar.innerHTML = before; bar.querySelector("[data-abm]").onclick = ab.onclick; };
        return;
      } else if (v) {
        if (!confirm(`Für ${v.firma} ist keine E-Mail-Adresse hinterlegt.\nBühne trotzdem als abgemeldet markieren?`)) return;
      } else if (!confirm("Eigene Bühne als abgemeldet (zurück) markieren?")) return;
      markDone();
    };
  }
}

/* =========================================================
   Stammdaten (Einstellungen › BauMon)
========================================================= */
/* =========================================================
   Reiter "Personal": Krank/Urlaub, Trupps, Richtmeister/Monteure/Maler
========================================================= */
function cardHead(title, btnId, label, ro) {
  return `<div class="card-head"><h3 class="section-title">${title}</h3>${ro || !btnId ? "" : `<button type="button" class="secondary small" id="${btnId}">${h(label)}</button>`}</div>`;
}
function addPeopleDialog() {
  const body = U.el(`<div class="mon-form">
    <label class="field-label">Name</label><input type="text" class="f-name" autocomplete="off" />
    <label class="field-label">Typ</label><div class="seg kind-seg" role="group">${Object.entries(M.PERSON_KINDS).map(([k, l]) => `<button type="button" data-k="${k}" class="${k === "monteur" ? "on" : ""}">${l}</button>`).join("")}</div>
    <p class="muted kind-hint"></p></div>`);
  let k = "monteur";
  const hint = body.querySelector(".kind-hint");
  const HINTS = { rm: "Bekommt einen eigenen Trupp (Zeile in der Planung).", monteur: "Wird in Trupps und Einsätzen eingeteilt.", maler: "Bekommt eine eigene Zeile in der Planung (unten bei Maler)." };
  const setK = (v) => { k = v; U.$$("[data-k]", body).forEach((b) => b.classList.toggle("on", b.dataset.k === v)); hint.textContent = HINTS[v]; };
  U.$$("[data-k]", body).forEach((b) => { b.onclick = () => setK(b.dataset.k); });
  setK("monteur");
  const nameEl = body.querySelector(".f-name");
  const save = () => {
    const name = nameEl.value.trim();
    if (!name) { toast("Bitte einen Namen eingeben.", "warn"); nameEl.focus(); return false; }
    if (M.list("monteure").some((p) => p.name.toLowerCase() === name.toLowerCase())) { toast(`${name} gibt es schon.`, "warn"); nameEl.focus(); return false; }
    M.importPeople({ rm: k === "rm" ? [name] : [], m: k === "monteur" ? [name] : [], maler: k === "maler" ? [name] : [] });
    toast(`${name} als ${M.PERSON_KINDS[k]} angelegt.`, "info", 2500);
    changed();
  };
  const dlg = modal("Person hinzufügen", body, [
    { label: "Abbrechen", fn: () => {} },
    { label: "Hinzufügen", cls: "primary", fn: save },
  ]);
  nameEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); if (save() !== false) dlg.close(); } });
  setTimeout(() => nameEl.focus(), 50);
}

export function renderMonPersonal(app) {
  const ro = !editable();
  const t = M.today();
  app.appendChild(U.el(`<div class="page-head"><h1>Personal</h1>${ro ? "" : `<button class="primary" id="stAdd" type="button">+ Neu</button>`}</div>`));
  const add = U.$("#stAdd"); if (add) add.onclick = addPeopleDialog;

  // Krank / Urlaub: laufende und kommende (plus die letzten 14 Tage)
  const abw = M.list("abwesenheiten").filter((a) => a.bis >= M.addDays(t, -14) && M.get("monteure", a.monteurId)).sort((a, b) => a.von.localeCompare(b.von));
  const abwCard = U.el(`<div class="card list-card">${cardHead("Krank / Urlaub", "abwNew", "+ Krank / Urlaub", ro)}
    ${abw.map((a) => `<button type="button" class="mon-brow ${a.von <= t && a.bis >= t ? "now" : ""}" data-aid="${h(a.id)}"><span class="mon-brow-main"><b>${h(M.get("monteure", a.monteurId).name)}</b> · <span class="abw-tag ${a.typ}">${M.ABW_TYPES[a.typ]}</span></span>
      <span class="muted">${h(M.wdName(a.von))} ${h(M.shortDate(a.von))} – ${h(M.wdName(a.bis))} ${h(M.shortDate(a.bis))}${a.notiz ? " · " + h(a.notiz) : ""}${a.bis < t ? " · vorbei" : ""}</span></button>`).join("") || `<p class="muted">Niemand krank oder im Urlaub eingetragen.</p>`}</div>`);
  app.appendChild(abwCard);
  const an = abwCard.querySelector("#abwNew"); if (an) an.onclick = () => openAbw(null, { von: t, bis: t });
  U.$$("[data-aid]", abwCard).forEach((b) => { b.onclick = () => openAbw(M.get("abwesenheiten", b.dataset.aid)); });

  // Trupps (Maler haben je eine eigene Zeile und stehen unten bei "Maler")
  const tRow = (tr) => `<button type="button" class="mon-brow" data-tid="${h(tr.id)}"><span class="mon-brow-main"><b>${h(M.truppName(tr))}</b>${(() => { const f = M.get("monteure", tr.fuehrerId); return f && M.kind(f) === "monteur" ? ' <span class="p-badge">geführt von Monteur</span>' : !tr.fuehrerId ? ' <span class="p-badge">ohne RM</span>' : ""; })()}</span>
    <span class="muted">${(() => { const ms = (tr.monteure || []).filter((id) => id !== tr.fuehrerId); return ms.length ? h(monteurNames(ms)) : "noch keine Monteure"; })()}</span></button>`;
  const ts = M.sortedTrupps().filter((tr) => !M.isMalerTrupp(tr));
  const tCard = U.el(`<div class="card list-card">${cardHead(`Trupps (${ts.length})`, "truppNew", "+ Trupp", ro)}${ts.map(tRow).join("") || `<p class="muted">Noch keine Trupps.</p>`}</div>`);
  app.appendChild(tCard);
  const tn = tCard.querySelector("#truppNew"); if (tn) tn.onclick = () => editTrupp(null);
  U.$$("[data-tid]", tCard).forEach((b) => { b.onclick = () => editTrupp(M.get("trupps", b.dataset.tid)); });

  // Personen
  const all = M.sortedMonteure(true);
  const row = (m) => `<div class="mon-mrow ${m.aktiv === false ? "off" : ""}" data-person="${h(m.id)}"><span>${h(m.name)}${m.aktiv === false ? ' <span class="muted">(inaktiv)</span>' : ""}</span>
    ${ro ? "" : `<span class="row"><select class="kind-sel" data-kind="${h(m.id)}" aria-label="Kategorie">${Object.entries(M.PERSON_KINDS).map(([k, l]) => `<option value="${k}" ${M.kind(m) === k ? "selected" : ""}>${l}</option>`).join("")}</select><button type="button" class="secondary small" data-ren="${h(m.id)}" title="Umbenennen" aria-label="Umbenennen"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 4.5l3 3L8 17l-4 1 1-4z"/></svg><span class="lbl">Umbenennen</span></button><button type="button" class="secondary small tog-btn" data-tog="${h(m.id)}">${m.aktiv === false ? "Aktivieren" : "Inaktiv"}</button><button type="button" class="secondary small icon-only" data-del="${h(m.id)}" title="Löschen" aria-label="${h(m.name)} löschen">${ICO.trash}</button></span><button type="button" class="secondary small icon-only m-more" data-more="${h(m.id)}" aria-label="Aktionen für ${h(m.name)}"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/></svg></button>`}</div>`;
  const grp = (k, title) => { const xs = all.filter((m) => M.kind(m) === k); return `<div class="card list-card"><h3 class="section-title">${title} (${xs.length})</h3>${xs.map(row).join("") || `<p class="muted">Noch keine ${title}.</p>`}</div>`; };
  const pCard = U.el(`<div>${grp("rm", "Richtmeister")}${grp("monteur", "Monteure")}${grp("maler", "Maler")}</div>`);
  app.appendChild(pCard);
  if (!ro) {
    U.$$("[data-kind]", pCard).forEach((sel) => { sel.onchange = () => changeKind(M.get("monteure", sel.dataset.kind), sel.value, () => { sel.value = M.kind(M.get("monteure", sel.dataset.kind)); }); });
    U.$$("[data-ren]", pCard).forEach((b) => { b.onclick = () => { const m = M.get("monteure", b.dataset.ren); const nn = prompt("Name", m.name); if (nn && nn.trim()) { M.put("monteure", { ...m, name: nn.trim() }); changed(); } }; });
    U.$$("[data-tog]", pCard).forEach((b) => { b.onclick = () => { const m = M.get("monteure", b.dataset.tog); M.put("monteure", { ...m, aktiv: m.aktiv === false }); changed(); }; });
    // Handy: eine Zeile je Person, Aktionen im Menü „⋯“ (lösen dieselben Knöpfe/Auswahl aus)
    U.$$("[data-more]", pCard).forEach((b) => { b.onclick = () => {
      const row = b.closest(".mon-mrow"), m = M.get("monteure", b.dataset.more);
      document.querySelector(".quick-menu")?.remove();
      const k = M.kind(m);
      const menu = U.el(`<div class="quick-menu" role="menu"><div class="qm-head">${h(m.name)}</div>
        ${Object.entries(M.PERSON_KINDS).map(([kk, l]) => `<button type="button" data-k="${kk}">${kk === k ? "✓ " : "\u2003"}${l}</button>`).join("")}
        <button type="button" data-a="ren">Umbenennen …</button>
        <button type="button" data-a="tog">${m.aktiv === false ? "Aktivieren" : "Inaktiv setzen"}</button>
        <button type="button" data-a="del" class="qm-danger">Löschen …</button></div>`);
      document.body.appendChild(menu);
      const rb = b.getBoundingClientRect(), mr = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(rb.right - mr.width, innerWidth - mr.width - 8))}px`;
      menu.style.top = `${rb.bottom + 4 + mr.height > innerHeight ? Math.max(8, rb.top - mr.height - 4) : rb.bottom + 4}px`;
      const close = () => { menu.remove(); document.removeEventListener("pointerdown", out, true); };
      const out = (ev) => { if (!menu.contains(ev.target) && ev.target !== b) close(); };
      setTimeout(() => document.addEventListener("pointerdown", out, true), 0);
      U.$$("[data-k]", menu).forEach((x) => { x.onclick = () => { close(); const sel = row.querySelector(".kind-sel"); if (x.dataset.k === k) return; sel.value = x.dataset.k; sel.dispatchEvent(new Event("change")); }; });
      U.$$("[data-a]", menu).forEach((x) => { x.onclick = () => { close(); row.querySelector(`[data-${x.dataset.a}]`).click(); }; });
    }; });
    U.$$("[data-del]", pCard).forEach((b) => { b.onclick = () => {
      const m = M.get("monteure", b.dataset.del);
      const u = M.personUsage(m.id);
      const lines = [
        u.einsaetze ? `• in ${u.einsaetze} Einsatz/Einsätzen eingeplant – wird dort entfernt` : "",
        u.fuehrt.length ? `• führt Trupp ${u.fuehrt.join(", ")} – ${u.truppWeg.length ? "Trupp wird aufgelöst (Einsätze bleiben unter „Ohne Trupp“)" : "Trupp bleibt ohne Richtmeister"}` : "",
        u.trupps ? `• Mitglied in ${u.trupps} Trupp(s)` : "",
        u.abw ? `• ${u.abw} Krank/Urlaub-Eintrag/Einträge werden gelöscht` : "",
      ].filter(Boolean);
      if (!confirm(`${m.name} endgültig löschen?${lines.length ? "\n\n" + lines.join("\n") : ""}\n\nTipp: „Inaktiv“ blendet die Person aus und behält alles.`)) return;
      M.removePerson(m.id);
      toast(`${m.name} gelöscht.`, "info", 3000);
      changed();
    }; });
  }
}

// Kategorie ändern. Wird ein Richtmeister/Maler zum Monteur, fragen, was mit seinem Trupp passiert.
function changeKind(p, k, undo) {
  const own = M.list("trupps").filter((t) => t.fuehrerId === p.id);
  if (k !== "monteur" || !own.length) { M.setKind(p, k); toast(`${p.name} ist jetzt ${M.PERSON_KINDS[k]}.`, "info", 2500); changed(); return; }
  const t = M.today();
  const planned = M.list("einsaetze").filter((e) => own.some((tr) => tr.id === e.truppId) && e.bis >= t);
  const body = U.el(`<div class="mon-form"><p>${h(p.name)} führt den Trupp <b>„${h(M.truppName(own[0]))}“</b>${planned.length ? ` mit ${planned.length} geplanten Einsätzen` : ""}.</p>
    <p class="muted">Behalten: Der Trupp läuft unter diesem Namen weiter (z. B. Vertretung). Auflösen: Der Trupp wird gelöscht${planned.length ? ", seine Einsätze stehen dann unter „Ohne Trupp“" : ""}.</p></div>`);
  undo(); // Auswahl erst ändern, wenn entschieden ist
  modal(`${p.name} wird Monteur`, body, [
    { label: "Abbrechen", fn: () => {} },
    { label: "Trupp behalten", fn: () => { M.setKind(p, "monteur"); toast(`${p.name} ist jetzt Monteur. Trupp bleibt.`, "info", 3000); changed(); } },
    { label: "Trupp auflösen", cls: "primary", fn: () => {
      if (planned.length && !confirm(`Trupp wirklich auflösen? ${planned.length} geplante Einsätze stehen danach unter „Ohne Trupp“.`)) return false;
      M.setKind(p, "monteur");
      for (const tr of own) M.remove("trupps", tr.id);
      toast(`${p.name} ist jetzt Monteur. Trupp aufgelöst.`, "info", 3000);
      changed();
    } },
  ]);
}

// Bühnenvermieter (im Reiter "Bühnen" unten)
function vermieterCard() {
  const ro = !editable();
  const card = U.el(`<div class="card list-card">${cardHead("Bühnenvermieter", "vermNew", "+ Vermieter", ro)}${M.list("vermieter").sort((a, b) => a.firma.localeCompare(b.firma, "de", { sensitivity: "base" })).map((v) => `
    <button type="button" class="mon-brow" data-vid="${h(v.id)}"><span class="mon-brow-main"><b>${h(v.firma)}</b>${v.ansprechpartner ? " · " + h(v.ansprechpartner) : ""}</span>
    <span class="muted">${h(v.email || "keine E-Mail")}${v.telefon ? " · " + h(v.telefon) : ""}${v.kundenNr ? " · Kd.-Nr. " + h(v.kundenNr) : ""}</span></button>`).join("") || `<p class="muted">Noch keine Vermieter.</p>`}</div>`);
  const vn = card.querySelector("#vermNew"); if (vn) vn.onclick = () => editVermieter(null);
  U.$$("[data-vid]", card).forEach((b) => { b.onclick = () => editVermieter(M.get("vermieter", b.dataset.vid)); });
  return card;
}

function btn(label, fn) { const b = U.el(`<button class="primary" type="button">${h(label)}</button>`); b.onclick = fn; return b; }

function editVermieter(v) {
  const cur = v ? { ...v } : { firma: "", ansprechpartner: "", email: "", telefon: "", kundenNr: "" };
  const ro = !editable();
  const body = U.el(`<div class="mon-form">
    <label class="field-label">Firma</label><input type="text" class="f-firma" value="${h(cur.firma)}" placeholder="z. B. Seeger" />
    <label class="field-label">Ansprechpartner</label><input type="text" class="f-ap" value="${h(cur.ansprechpartner)}" />
    <div class="grid2"><div><label class="field-label">E-Mail (für Abmeldungen)</label><input type="email" class="f-mail" value="${h(cur.email)}" /></div>
    <div><label class="field-label">Telefon</label><input type="tel" class="f-tel" value="${h(cur.telefon)}" /></div></div>
    <label class="field-label">Kunden-Nr. bei diesem Vermieter</label><input type="text" class="f-kd" value="${h(cur.kundenNr)}" placeholder="optional" /></div>`);
  if (ro) U.$$("input", body).forEach((x) => { x.disabled = true; });
  const save = () => {
    const firma = body.querySelector(".f-firma").value.trim();
    const email = body.querySelector(".f-mail").value.trim();
    if (!firma) { toast("Bitte die Firma angeben.", "warn"); return false; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast("Die E-Mail-Adresse sieht nicht gültig aus.", "warn"); return false; }
    M.put("vermieter", { ...cur, firma, email, ansprechpartner: body.querySelector(".f-ap").value.trim(), telefon: body.querySelector(".f-tel").value.trim(), kundenNr: body.querySelector(".f-kd").value.trim() });
    changed();
  };
  modal(v ? "Bühnenvermieter" : "Neuer Bühnenvermieter", body, ro ? [{ label: "Schließen", fn: () => {} }] : [
    ...(v ? [{ label: "Löschen", cls: "danger-outline", fn: () => { if (!confirm(`${cur.firma} löschen?`)) return false; M.remove("vermieter", cur.id); changed(); } }] : []),
    { label: "Abbrechen", fn: () => {} }, { label: v ? "Speichern" : "Anlegen", cls: "primary", fn: save }]);
}

function editTrupp(t) {
  const cur = t ? { ...t } : { name: "", fuehrerId: null, monteure: [] };
  const body = U.el(`<div class="mon-form">
    <label class="field-label">Richtmeister</label><select class="f-f"><option value="">– ohne Richtmeister –</option>${[...M.sortedMonteure().filter((m) => m.rm), ...M.sortedMonteure().filter((m) => !m.rm)].map((m) => `<option value="${h(m.id)}" ${m.id === cur.fuehrerId ? "selected" : ""}>${h(m.name)}${m.rm ? " · RM" : m.maler ? " · Maler" : ""}</option>`).join("")}</select>
    <label class="field-label">Name (optional)</label><input type="text" class="f-name" value="${h(cur.name)}" placeholder="leer = Name des Richtmeisters" />
    <label class="field-label crew-l">Monteure im Trupp (werden bei neuen Einsätzen vorgeschlagen)</label></div>`);
  const chips = chipPicker(M.sortedMonteure(), cur.monteure);
  body.appendChild(chips.box);
  const malerInfo = U.el(`<p class="muted" hidden>Maler-Trupps bestehen nur aus dem Maler.</p>`);
  body.appendChild(malerInfo);
  const fsel = body.querySelector(".f-f");
  const isMalerSel = () => { const p = M.get("monteure", fsel.value); return !!(p && p.maler); };
  const updM = () => { const m = isMalerSel(); chips.box.hidden = m; body.querySelector(".crew-l").hidden = m; malerInfo.hidden = !m; if (m) chips.set([fsel.value]); };
  fsel.onchange = () => { if (fsel.value) chips.set([...new Set([fsel.value, ...chips.value()])]); updM(); };
  updM();
  const save = () => {
    const fuehrerId = fsel.value || null;
    const name = body.querySelector(".f-name").value.trim();
    const ids = chips.value();
    if (!fuehrerId && !name && !ids.length) { toast("Bitte Richtmeister, Monteure oder einen Namen angeben.", "warn"); return false; }
    if (fuehrerId && !ids.includes(fuehrerId)) ids.unshift(fuehrerId);
    if (isMalerSel()) ids.splice(0, ids.length, fuehrerId);
    M.put("trupps", { ...cur, fuehrerId, name, monteure: ids, sort: cur.sort ?? M.list("trupps").length });
    changed();
  };
  modal(t ? "Trupp" : "Neuer Trupp", body, [
    ...(t ? [{ label: "Löschen", cls: "danger-outline", fn: () => { if (!confirm("Trupp löschen? Seine Einsätze bleiben als „Ohne Trupp“ erhalten.")) return false; M.remove("trupps", cur.id); changed(); } }] : []),
    { label: "Abbrechen", fn: () => {} }, { label: t ? "Speichern" : "Anlegen", cls: "primary", fn: save }]);
}

/* ---------- Suche (aus dem Menü) ---------- */
export function searchMon(words) {
  const hit = (s) => { const t = String(s || "").toLowerCase(); return words.every((w) => t.includes(w)); };
  const t = M.today();
  const names = (ids) => (ids || []).map((id) => (M.get("monteure", id) || {}).name).filter(Boolean).join(" ");
  const range = (a, b) => `${M.shortDate(a)}–${M.shortDate(b)}`;
  // aktuelle und kommende zuerst, dann vergangene (neueste zuerst)
  const byTime = (a, b) => ((a.bis >= t) === (b.bis >= t) ? (a.bis >= t ? a.von.localeCompare(b.von) : b.von.localeCompare(a.von)) : a.bis >= t ? -1 : 1);
  const out = [];
  const ein = M.list("einsaetze").filter((e) => hit(`${M.baustelleLabel(e)} ${M.truppName(M.get("trupps", e.truppId))} ${names(e.monteure)} ${e.leih || ""} ${e.kran || ""}`)).sort(byTime);
  out.push({ title: "Einsätze", items: ein.map((e) => ({ label: M.baustelleLabel(e), sub: `${M.truppName(M.get("trupps", e.truppId))} · ${range(e.von, e.bis)}`, tag: e.bis < t ? "vorbei" : e.von <= t ? "läuft" : "", kind: "einsatz", id: e.id })) });
  const vn = (b) => (b.vermieterId ? (M.get("vermieter", b.vermieterId) || {}).firma || "" : "Bühler (eigene)");
  const bue = M.list("buehnen").filter((b) => hit(`${M.baustelleLabel(b)} ${b.typ || ""} ${vn(b)} ${b.auftragsNr || ""} ${b.standort || ""}`)).sort((a, b) => (!!a.abgemeldetAm - !!b.abgemeldetAm) || (a.bis || "").localeCompare(b.bis || ""));
  out.push({ title: "Bühnen", items: bue.map((b) => ({ label: M.baustelleLabel(b), sub: `${M.buehneText(b)} · ${vn(b)}${b.bis ? " · Mietende " + M.shortDate(b.bis) : ""}`, tag: b.abgemeldetAm ? "abgemeldet" : M.isDue(b, t) ? "abmelden!" : "", kind: "buehne", id: b.id })) });
  out.push({ title: "Personal", items: M.sortedMonteure(true).filter((m) => hit(m.name)).map((m) => ({ label: m.name, sub: M.PERSON_KINDS[M.kind(m)], tag: m.aktiv === false ? "inaktiv" : "", kind: "person", id: m.id })) });
  out.push({ title: "Trupps", items: M.sortedTrupps().filter((tr) => hit(`${M.truppName(tr)} ${names(tr.monteure)}`)).map((tr) => ({ label: M.truppName(tr), sub: names((tr.monteure || []).filter((id) => id !== tr.fuehrerId)).split(" ").join(", "), kind: "trupp", id: tr.id })) });
  out.push({ title: "Bühnenvermieter", items: M.list("vermieter").filter((v) => hit(`${v.firma} ${v.ansprechpartner || ""} ${v.email || ""}`)).map((v) => ({ label: v.firma, sub: [v.ansprechpartner, v.email].filter(Boolean).join(" · "), kind: "vermieter", id: v.id })) });
  const abw = M.list("abwesenheiten").filter((a) => a.bis >= M.addDays(t, -14) && hit(`${(M.get("monteure", a.monteurId) || {}).name || ""} ${M.ABW_TYPES[a.typ]}`)).sort((a, b) => a.von.localeCompare(b.von));
  out.push({ title: "Krank / Urlaub", items: abw.map((a) => ({ label: (M.get("monteure", a.monteurId) || {}).name || "?", sub: `${M.ABW_TYPES[a.typ]} · ${range(a.von, a.bis)}`, kind: "abw", id: a.id })) });
  return out;
}

export function openSearchHit(kind, id) {
  const later = (fn) => setTimeout(fn, 60);
  if (kind === "einsatz") {
    const e = M.get("einsaetze", id); if (!e) return;
    // Woche so wählen, dass der Einsatz sichtbar ist
    const start = M.addDays(M.range().start, weekOffset * 7), end = M.addDays(start, 20);
    if (e.bis < start || e.von > end) weekOffset = Math.round((M.parseDay(M.mondayOf(e.von)) - M.parseDay(M.range().start)) / (7 * 86400000));
    U.go({ sparte: "mon", view: "monplan", selectedProjectId: null, selectedDocId: null });
    later(() => openEinsatz(e));
  } else if (kind === "buehne") {
    const b = M.get("buehnen", id); if (!b) return;
    U.go({ sparte: "mon", view: "monbuehnen", selectedProjectId: null, selectedDocId: null });
    later(() => openBuehne(b));
  } else if (kind === "vermieter") {
    const v = M.get("vermieter", id); if (!v) return;
    U.go({ sparte: "mon", view: "monbuehnen", selectedProjectId: null, selectedDocId: null });
    if (editable()) later(() => editVermieter(v));
  } else if (kind === "trupp") {
    const tr = M.get("trupps", id); if (!tr) return;
    U.go({ sparte: "mon", view: "monpersonal", selectedProjectId: null, selectedDocId: null });
    if (editable()) later(() => editTrupp(tr));
  } else if (kind === "abw") {
    const a = M.get("abwesenheiten", id); if (!a) return;
    U.go({ sparte: "mon", view: "monpersonal", selectedProjectId: null, selectedDocId: null });
    if (editable()) later(() => openAbw(a));
  } else if (kind === "person") {
    U.go({ sparte: "mon", view: "monpersonal", selectedProjectId: null, selectedDocId: null });
    later(() => {
      const r = document.querySelector(`.mon-mrow[data-person="${CSS.escape(id)}"]`);
      if (!r) return;
      r.scrollIntoView({ block: "center" });
      r.classList.remove("flash"); void r.offsetWidth; r.classList.add("flash");
    });
  }
}
