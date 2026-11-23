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
  edit: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
};

const changed = () => { U.schedule(); U.render(); };
// Kurzformen der Feiertage für die schmale Tagesspalte
const HOL_SHORT = { "Heilige Drei Könige": "Hl. 3 Kön.", "Ostermontag": "Ostermo.", "Tag der Arbeit": "1. Mai", "Christi Himmelfahrt": "Himmelf.",
  "Pfingstmontag": "Pfingstmo.", "Fronleichnam": "Fronleichn.", "Tag der Deutschen Einheit": "Dt. Einheit", "Allerheiligen": "Allerheil.",
  "1. Weihnachtstag": "1. Weihn.", "2. Weihnachtstag": "2. Weihn.", "Karfreitag": "Karfr." };
const editable = () => M.canEdit();

/* ---------- Farben je Baustelle (ruhige Töne) ---------- */
const PALETTE = ["#2e5b8a", "#5b7f3a", "#8a5a2e", "#6a4c8c", "#2e7f7a", "#8c3f52", "#5f5e59", "#a07a14", "#3f6c9e", "#7a6a3a"];
function siteColor(x) {
  const key = x.bvNumber || (x.baustelle || "").toLowerCase();
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
      <ul class="mon-list">${due.slice(0, 6).map((b) => `<li><b>${h(M.buehneText(b))}</b> · ${h(M.baustelleLabel(b))} · ${h(vermieterName(b.vermieterId))} <span class="muted">Mietende ${h(M.shortDate(b.bis))}</span></li>`).join("")}</ul>
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
        <span class="muted">${h(monteurNames(e.monteure, 4))} · bis ${h(M.wdName(e.bis))} ${h(M.shortDate(e.bis))}</span></span>${bs.length ? `<span class="mon-site-lift ${due ? "due" : ""}" title="${bs.length} Bühne(n)${due ? " – abmelden!" : ""}">${ICO.lift}</span>` : ""}</button>`;
      }).join("") : `<span class="muted">nicht eingeplant</span>`}</div></div>`);
    box.appendChild(row);
  }
  if (!any) box.appendChild(U.el(`<p class="muted">Noch keine Trupps angelegt.</p>`));
  U.$$("[data-eid]", card).forEach((b) => { b.onclick = () => openEinsatz(M.get("einsaetze", b.dataset.eid)); });
  app.appendChild(card);
  bindStammButtons(app);
}

function vermieterName(id) { const v = M.get("vermieter", id); return v ? v.firma : "Bühler (eigen)"; }
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
let weekOffset = 0; // Planung: um ganze Wochen nach vorne/hinten verschoben (0 = Vorwoche, aktuelle, nächste)
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
  // Bühnen-Symbol nur einmal je BV: am Balken, der im dargestellten Zeitraum am weitesten rechts endet
  // (geht das BV über den Zeitraum hinaus, also am letzten dargestellten Tag)
  const siteKey = (e) => e.bvNumber ? "#" + e.bvNumber : (e.baustelle || "").trim().toLowerCase();
  const liftBar = new Map();
  for (const e of einsaetze) {
    const k = siteKey(e), cur = liftBar.get(k);
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
  if (abwPeople.length || editable()) rows.push({ sep: "Krank / Urlaub", add: editable() }, ...abwPeople.map((p) => ({ abw: p, list: abwIn.filter((a) => a.monteurId === p.id) })));

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
      <button type="button" class="${zoom === "tage" ? "on" : ""}" data-zoom="tage">Tage</button>
      <button type="button" class="${zoom === "wochen" ? "on" : ""}" data-zoom="wochen">Wochen</button>
    </div></div>
    <div class="g-scroll"><div class="gantt ${zoom}" style="--days:21"></div></div></div>`);
  U.$$("[data-zoom]", card).forEach((b) => { b.onclick = () => { m.zoom = b.dataset.zoom; U.render(); }; });
  card.querySelector("#planPdf").onclick = () => openPlanPdf();
  card.querySelector("#wkPrev").onclick = () => { weekOffset--; U.render(); };
  card.querySelector("#wkNext").onclick = () => { weekOffset++; U.render(); };
  const now = card.querySelector("#wkNow"); if (now) now.onclick = () => { weekOffset = 0; U.render(); };
  const g = card.querySelector(".gantt");
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
    head += `<div class="g-day ${we ? "we" : ""} ${hol ? "hol" : ""} ${d === t ? "today" : ""}" data-day="${d}" style="grid-column:${2 + i}" ${hol ? `title="${h(hol)}"` : ""}>${M.wdName(d)}<b>${Number(d.slice(8))}</b>${hol ? `<i class="g-hol">${h(HOL_SHORT[hol] || hol)}</i>` : ""}</div>`;
  });
  g.insertAdjacentHTML("beforeend", head);

  // Zeilenhöhen: Trupp-Zeilen fest, Trennzeile (Maler) schmal
  g.style.gridTemplateRows = "auto auto " + rows.map((r) => (r.sep ? "30px" : "var(--rowh)")).join(" ");
  let gridRow = 3;
  for (const r of rows) {
    if (r.sep) {
      g.insertAdjacentHTML("beforeend", `<div class="g-sep" style="grid-row:${gridRow}"><span>${h(r.sep)}${r.add ? ` <button type="button" class="g-sep-add" id="abwAdd">+ Krank / Urlaub</button>` : ""}</span></div>`);
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
        g.insertAdjacentHTML("beforeend", `<button type="button" class="g-abw ${a.typ}" data-aid="${h(a.id)}" style="grid-column:${2 + s0} / ${3 + e0};grid-row:${gridRow}" title="${h(p.name)}: ${M.ABW_TYPES[a.typ]} ${h(M.longDate(a.von))} – ${h(M.longDate(a.bis))}${a.notiz ? " · " + h(a.notiz) : ""}">${M.ABW_TYPES[a.typ]}</button>`);
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
        const bh = liftBar.get(siteKey(e))?.id === e.id ? M.buehnenOf(e).filter((b) => !b.abgemeldetAm) : [];
        const dueHere = bh.some((b) => M.isDue(b, t));
        const dbl = M.conflicts(e), abs = M.absenceConflicts(e);
        // Tagesansicht: zweite Zeile mit Besetzung (ohne Richtmeister) und Leiharbeiter/Kran
        const sub = [(e.monteure || []).filter((id) => !tr || id !== tr.fuehrerId).map((id) => (M.get("monteure", id) || {}).name).filter(Boolean).join(", "), e.leih, e.kran].filter(Boolean).join(" · ");
        // Nur an den Tagen, an denen sich zwei Baustellen überschneiden, wird der Balken schmal
        let mode = "", bg = "", pad = "";
        if (L > 1) {
          const N = en - s + 1;
          const ov = Array.from({ length: N }, (_, k) => r.list.some((o) => o !== e && o.von <= days[s + k] && o.bis >= days[s + k]));
          if (ov.every(Boolean)) mode = "stack";
          else if (ov.some(Boolean)) {
            mode = "part";
            const runs = [];
            ov.forEach((v, k) => { const last = runs[runs.length - 1]; if (last && last.v === v) last.to = k; else runs.push({ v, from: k, to: k }); });
            bg = runs.map((ru, k) => `<span class="g-bg ${ru.v ? "ov" : ""} ${k === 0 ? "first" : ""} ${k === runs.length - 1 ? "last" : ""}" style="left:${(ru.from / N) * 100}%;width:${((ru.to - ru.from + 1) / N) * 100}%"></span>`).join("");
            // Text und Symbol nur im breiten Teil
            const pl = ov[0] ? runs[0].to + 1 : 0, pr = ov[N - 1] ? N - runs[runs.length - 1].from : 0;
            pad = `--padl:calc(${(pl / N) * 100}% + 8px);--padr:calc(${(pr / N) * 100}% + 8px);`;
          }
        }
        g.insertAdjacentHTML("beforeend", `<button type="button" class="g-bar ${mode} ${dueHere ? "has-due" : ""} ${dbl.length || abs.length ? "conflict" : ""} ${e.von < days[0] ? "cut-l" : ""} ${e.bis > days[20] ? "cut-r" : ""}" data-eid="${h(e.id)}"
          style="grid-column:${2 + s} / ${3 + en};grid-row:${gridRow};--lanes:${L};--lane:${li};--c:${siteColor(e)};${pad}" title="${h(M.baustelleLabel(e))}: ${h(M.longDate(e.von))} – ${h(M.longDate(e.bis))}${dbl.length ? " – DOPPELT EINGETEILT: " + h([...new Set(dbl.map((c) => (M.get("monteure", c.monteurId) || {}).name))].join(", ")) : ""}${abs.length ? " – KRANK/URLAUB: " + h([...new Set(abs.map((c) => (M.get("monteure", c.monteurId) || {}).name))].join(", ")) : ""}">
          ${bg}${editable() && e.von >= days[0] ? '<span class="g-h l" data-h="start" aria-hidden="true"></span>' : ""}<span class="g-bar-t"><span class="g-l1">${e.bvNumber ? `<span class="g-num">${h(e.bvNumber)}</span> <span class="g-name">${h(e.baustelle)}</span>` : `<span class="g-name only">${h(e.baustelle || "Baustelle")}</span>`}</span>${sub ? `<span class="g-sub">${h(sub)}</span>` : ""}</span>${bh.length ? `<span class="g-lift ${dueHere ? "due" : ""}" title="${bh.length} Bühne(n)${dueHere ? " – abmelden!" : ""}">${ICO.lift}</span>` : ""}${editable() && e.bis <= days[20] ? '<span class="g-h r" data-h="end" aria-hidden="true"></span>' : ""}</button>`);
      }
    });
    gridRow += n;
  }
  app.appendChild(card);

  U.$$(".g-bar", card).forEach((b) => { b.onclick = () => { if (dragJustEnded) return; openEinsatz(M.get("einsaetze", b.dataset.eid)); }; });
  U.$$(".g-abw", card).forEach((b) => { b.onclick = () => openAbw(M.get("abwesenheiten", b.dataset.aid)); });
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
    if (mo && sc.scrollWidth > sc.clientWidth) sc.scrollLeft = Math.max(0, mo.offsetLeft - corner.offsetWidth);
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
    : "Vorwoche, aktuelle und nächste Woche"}</p>`));
}

/* ---------- PDF: Kalenderwochen wählen (Standard: aktuelle + nächste Woche) ---------- */
function openPlanPdf() {
  const cur = M.mondayOf(M.today());
  const weeks = Array.from({ length: 31 }, (_, i) => M.addDays(cur, (i - 10) * 7)); // 10 Wochen zurück, 20 voraus
  const yr = cur.slice(0, 4);
  const label = (mo) => { const so = M.addDays(mo, 6); return `KW ${M.isoWeek(mo)} · ${M.shortDate(mo)}–${M.shortDate(so)}${so.slice(0, 4) !== yr ? so.slice(0, 4) : ""}${mo === cur ? " (aktuell)" : ""}`; };
  const opts = (sel) => weeks.map((mo) => `<option value="${mo}" ${mo === sel ? "selected" : ""}>${h(label(mo))}</option>`).join("");
  const body = U.el(`<div class="mon-form">
    <div class="grid2"><div><label class="field-label">von KW</label><select class="f-from">${opts(cur)}</select></div>
    <div><label class="field-label">bis KW</label><select class="f-to">${opts(M.addDays(cur, 7))}</select></div></div>
    <p class="muted pdf-range-info"></p></div>`);
  const from = body.querySelector(".f-from"), to = body.querySelector(".f-to"), info = body.querySelector(".pdf-range-info");
  const upd = () => {
    if (to.value < from.value) to.value = from.value;
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
          const { blob, filename } = await buildPlanPdf({ colorOf: siteColor, start: from.value, weeks: n });
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
    for (const el of rowEls) { const r = el.getBoundingClientRect(); if (y >= r.top && y <= r.bottom) return el; }
    return y < rowEls[0].getBoundingClientRect().top ? rowEls[0] : rowEls[rowEls.length - 1];
  };
  let st = null;
  const ghost = U.el(`<div class="g-ghost" hidden><span></span></div>`);
  g.appendChild(ghost);

  const start = (bar, mode, ev) => {
    const e = M.get("einsaetze", bar.dataset.eid);
    if (!e) return;
    st = { bar, e, mode, x0: ev.clientX, y0: ev.clientY, i0: dayAt(ev.clientX), von: e.von, bis: e.bis, truppId: e.truppId || "", active: false, pid: ev.pointerId, touch: ev.pointerType === "touch", timer: null };
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
      truppId = rowAt(y).dataset.row || "";
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
    const row = rowEls.find((r) => (r.dataset.row || "") === truppId) || rowAt(y);
    const rr = row.getBoundingClientRect();
    Object.assign(ghost.style, { left: `${a.left - gr.left + 2}px`, width: `${b.right - a.left - 4}px`, top: `${rr.top - gr.top + 4}px`, height: `${rr.height - 8}px` });
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
    const next = { ...e, von: s0.von, bis: s0.bis, truppId: s0.truppId || null };
    // Trupp gewechselt: Monteure übernehmen, wenn noch die Stammbesetzung eingetragen war
    if (next.truppId !== (e.truppId || null)) {
      const oldT = M.get("trupps", e.truppId), newT = M.get("trupps", next.truppId);
      const same = oldT && [...e.monteure].sort().join() === [...oldT.monteure].sort().join();
      if (newT && (same || !e.monteure.length)) next.monteure = newT.monteure.slice();
    }
    const ob = M.overbooked(next);
    if (ob) { alert("Nicht möglich:\n\n" + M.overbookedText(next, ob)); return; }
    const cf = M.conflicts(next);
    if (cf.length) { alert("Nicht möglich – doppelt eingeteilt:\n\n" + M.conflictText(cf)); return; }
    const ac = M.absenceConflicts(next);
    if (ac.length) { alert("Nicht möglich – Krank / Urlaub:\n\n" + M.absenceText(ac)); return; }
    M.put("einsaetze", next);
    followBuehnen(e, next);
    toast(`${M.baustelleLabel(next)}: ${M.longDate(next.von)} – ${M.longDate(next.bis)}${next.truppId !== (e.truppId || null) ? " · " + M.truppName(M.get("trupps", next.truppId)) : ""}`, "info", 2500);
    changed();
  };

  // Maus/Stift: Zeiger-Ereignisse
  g.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType === "touch") return;
    const bar = ev.target.closest(".g-bar");
    if (!bar || ev.button > 0) return;
    const hnd = ev.target.closest(".g-h");
    start(bar, hnd ? hnd.dataset.h : "move", ev);
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
    const bar = ev.target.closest(".g-bar");
    if (!bar) return;
    const t = ev.touches[0];
    const hnd = ev.target.closest(".g-h");
    start(bar, hnd ? hnd.dataset.h : "move", { clientX: t.clientX, clientY: t.clientY, pointerId: "touch", pointerType: "touch" });
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
  for (const b of M.buehnenOf(newE)) {
    if (!b.abgemeldetAm && b.bis === oldE.bis && siteEnd && b.bis !== siteEnd) M.put("buehnen", { ...b, bis: siteEnd });
  }
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
  const ab = all.filter((b) => b.abgemeldetAm && b.abgemeldetAm >= M.addDays(t, -30)).sort((a, b) => (a.bis || "9").localeCompare(b.bis || "9"));

  // fällig: je Vermieter eine E-Mail
  if (due.length) {
    const byV = new Map();
    for (const b of due) { if (!byV.has(b.vermieterId)) byV.set(b.vermieterId, []); byV.get(b.vermieterId).push(b); }
    const card = U.el(`<div class="card mon-due"><h3 class="section-title">Abmelden fällig</h3></div>`);
    for (const [vid, list] of byV) {
      const v = M.get("vermieter", vid);
      const grp = U.el(`<div class="mon-vgroup">
        <div class="mon-vhead"><div><b>${h(v ? v.firma : "Unbekannter Vermieter")}</b>${v && v.ansprechpartner ? ` <span class="muted">· ${h(v.ansprechpartner)}</span>` : ""}</div>
          ${editable() ? `<button class="primary small" type="button" data-mail="${h(vid)}">${ICO.mail} Abmelden per E-Mail</button>` : ""}</div>
        ${list.map((b) => buehneRow(b, true)).join("")}
        <div class="mon-sent" hidden><span>E-Mail an ${h(v ? v.firma : "")} gesendet?</span><button class="secondary small" type="button" data-done="${h(vid)}">${ICO.check} Als abgemeldet markieren</button></div>
      </div>`);
      card.appendChild(grp);
      const mb = grp.querySelector("[data-mail]");
      if (mb) mb.onclick = () => {
        if (!v || !v.email) { toast("Für diesen Vermieter ist keine E-Mail-Adresse hinterlegt (Einstellungen › BauMon › Bühnenvermieter).", "warn", 7000); return; }
        const acc = U.account();
        location.href = M.abmeldeMail(v, list, acc && acc.name);
        grp.querySelector(".mon-sent").hidden = false;
      };
      const db = grp.querySelector("[data-done]");
      if (db) db.onclick = () => { for (const b of list) M.put("buehnen", { ...b, abgemeldetAm: t }); toast(`${list.length} Bühne(n) als abgemeldet markiert.`, "info", 3000); changed(); };
    }
    app.appendChild(card);
  }
  const sec = (title, list, info) => {
    const card = U.el(`<div class="card"><h3 class="section-title">${title}</h3>${list.length ? list.map((b) => buehneRow(b)).join("") : `<p class="muted">${info}</p>`}</div>`);
    app.appendChild(card);
  };
  sec("Im Einsatz", aktiv, "Keine Bühnen im Einsatz.");
  if (ab.length) sec("Abgemeldet (letzte 30 Tage)", ab, "");
  U.$$("[data-bid]", app).forEach((r) => { r.onclick = () => openBuehne(M.get("buehnen", r.dataset.bid)); });
  app.appendChild(vermieterCard());
}

function buehneRow(b, due = false) {
  const status = b.abgemeldetAm ? `abgemeldet ${M.shortDate(b.abgemeldetAm)}` : b.bis ? `Mietende ${M.wdName(b.bis)} ${M.shortDate(b.bis)}` : "ohne Enddatum";
  return `<button type="button" class="mon-brow ${due ? "due" : ""}" data-bid="${h(b.id)}">
    <span class="mon-brow-main"><b>${h(M.buehneText(b))}</b> · ${h(M.baustelleLabel(b))}</span>
    <span class="muted">${h(vermieterName(b.vermieterId))}${b.auftragsNr ? " · Nr. " + h(b.auftragsNr) : ""} · ${h(status)}</span></button>`;
}

/* =========================================================
   Dialoge
========================================================= */
function modal(title, body, actions) {
  const wrap = U.el(`<div class="mon-modal" role="dialog" aria-modal="true" aria-label="${h(title)}">
    <div class="mon-modal-card"><div class="mon-modal-head"><h3>${h(title)}</h3><button type="button" class="icon-btn" data-x aria-label="Schließen"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    <div class="mon-modal-body"></div><div class="mon-modal-foot"></div></div></div>`);
  wrap.querySelector(".mon-modal-body").appendChild(body);
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
    const ps = U.projects().filter((p) => !q || (p.number + " " + p.title).toLowerCase().includes(q)).slice(0, 8);
    const qRaw = input.value.trim();
    listEl.innerHTML = ps.map((p) => `<button type="button" class="place-opt" data-n="${h(p.number)}" data-t="${h(p.title)}">${h(p.number)} ${h(p.client || p.title)}<span>${h(p.place || "")}</span></button>`).join("")
      + (editable() && U.createBV ? `<button type="button" class="place-opt new-bv" data-new="1">+ Neues BV anlegen${qRaw ? ` „${h(qRaw)}“` : ""}</button>` : "");
    const nb = listEl.querySelector("[data-new]");
    if (nb) nb.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      listEl.innerHTML = "";
      openNewBV(qRaw, (p) => {
        val = { bvNumber: p.number, baustelle: p.title };
        input.value = M.baustelleLabel(val);
        box.dispatchEvent(new Event("sitechange"));
      });
    });
    U.$$(".place-opt:not([data-new])", listEl).forEach((b) => b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      val = { bvNumber: b.dataset.n, baustelle: b.dataset.t };
      input.value = M.baustelleLabel(val);
      listEl.innerHTML = "";
      box.dispatchEvent(new Event("sitechange"));
    }));
  };
  input.addEventListener("focus", show);
  input.addEventListener("input", () => { val = { bvNumber: "", baustelle: input.value.trim() }; show(); });
  input.addEventListener("blur", () => setTimeout(() => { listEl.innerHTML = ""; }, 150));
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
    <label class="field-label">Bauherr / Auftraggeber</label><input type="text" class="f-client" value="${h(client)}" autocomplete="off" />
    <label class="field-label">Bauort</label><div class="place-field"><input type="text" class="f-place" autocomplete="off" placeholder="Ort aus der Liste wählen" /><div class="place-list f-plist"></div></div>
    <p class="muted small-note">Das BV wird wie in BauDoc angelegt und steht dort sofort zur Verfügung.</p></div>`);
  const numEl = body.querySelector(".f-num"), cEl = body.querySelector(".f-client"), pEl = body.querySelector(".f-place");
  numEl.addEventListener("input", () => { numEl.value = numEl.value.replace(/\D/g, "").slice(0, 5); });
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
  setTimeout(() => (num.length === 5 ? (client ? pEl : cEl) : numEl).focus(), 50);
}

// Krank / Urlaub eintragen
export function openAbw(a, preset = {}) {
  const isNew = !a;
  const cur = a ? { ...a } : { id: null, monteurId: preset.monteurId || "", typ: preset.typ || "urlaub", von: preset.von || M.today(), bis: preset.bis || preset.von || M.today(), notiz: "" };
  const ro = !editable();
  const people = M.sortedMonteure();
  const body = U.el(`<div class="mon-form">
    <label class="field-label">Person</label><select class="f-p"><option value="">– wählen –</option>${people.map((p) => `<option value="${h(p.id)}" ${p.id === cur.monteurId ? "selected" : ""}>${h(p.name)}${p.maler ? " · Maler" : p.rm ? " · RM" : ""}</option>`).join("")}</select>
    <label class="field-label">Art</label><div class="seg abw-seg" role="group">${Object.entries(M.ABW_TYPES).map(([k, l]) => `<button type="button" data-typ="${k}" class="${cur.typ === k ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="grid2 tight"><div><label class="field-label">von</label><input type="date" class="f-von" value="${h(cur.von)}" /></div>
    <div><label class="field-label">bis</label><input type="date" class="f-bis" value="${h(cur.bis)}" /></div></div>
    <label class="field-label">Notiz</label><input type="text" class="f-notiz" value="${h(cur.notiz)}" placeholder="optional" /></div>`);
  let typ = cur.typ;
  U.$$("[data-typ]", body).forEach((b) => { b.onclick = () => { typ = b.dataset.typ; U.$$("[data-typ]", body).forEach((x) => x.classList.toggle("on", x === b)); }; });
  if (ro) U.$$("input,select,button", body).forEach((x) => { x.disabled = true; });
  const save = () => {
    const monteurId = body.querySelector(".f-p").value;
    const von = body.querySelector(".f-von").value, bis = body.querySelector(".f-bis").value;
    if (!monteurId) { toast("Bitte die Person wählen.", "warn"); return false; }
    if (!von || !bis || bis < von) { toast("Bitte einen gültigen Zeitraum angeben (bis ≥ von).", "warn"); return false; }
    const rec = M.put("abwesenheiten", { ...cur, monteurId, typ, von, bis, notiz: body.querySelector(".f-notiz").value.trim() });
    // schon eingeplant? -> Hinweis (Einsatz wird im Plan rot gestrichelt markiert)
    const hits = M.list("einsaetze").filter((e) => (e.monteure || []).includes(monteurId) && e.von <= rec.bis && e.bis >= rec.von);
    if (hits.length) alert(`${M.get("monteure", monteurId).name} ist in diesem Zeitraum eingeplant:\n\n${hits.map((e) => `${M.baustelleLabel(e)} (${M.shortDate(e.von)}–${M.shortDate(e.bis)})`).join("\n")}\n\nBitte dort aus dem Einsatz nehmen (im Plan rot gestrichelt).`);
    changed();
  };
  const actions = ro ? [{ label: "Schließen", fn: () => {} }] : [
    ...(isNew ? [] : [{ label: "Löschen", cls: "danger-outline", fn: () => { if (!confirm("Eintrag löschen?")) return false; M.remove("abwesenheiten", cur.id); changed(); } }]),
    { label: "Abbrechen", fn: () => {} },
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
  body.appendChild(U.el(`<label class="field-label">Monteure</label>`));
  const chips = chipPicker(M.sortedMonteure(), cur.monteure);
  body.appendChild(chips.box);
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
  truppSel.onchange = () => { if (isNew) chips.set(crewOf(truppSel.value)); updBusy(); };
  if (ro) U.$$("input,select,textarea,.chip", body).forEach((x) => { x.disabled = true; });

  const save = () => {
    const s = site.value();
    const von = body.querySelector(".f-von").value;
    const bis = body.querySelector(".f-bis").value;
    if (!s.bvNumber && !s.baustelle) { toast("Bitte die Baustelle angeben.", "warn"); return false; }
    if (!von || !bis || bis < von) { toast("Bitte einen gültigen Zeitraum angeben (bis ≥ von).", "warn"); return false; }
    const ob = M.overbooked({ ...cur, von, bis, truppId: truppSel.value || null });
    if (ob) { alert(M.overbookedText({ truppId: truppSel.value }, ob)); return false; }
    const cf = M.conflicts({ ...cur, von, bis, truppId: truppSel.value || null }, chips.value());
    if (cf.length) { alert("Doppelt eingeteilt – bitte ändern:\n\n" + M.conflictText(cf)); return false; }
    const ac = M.absenceConflicts({ von, bis }, chips.value());
    if (ac.length) { alert("Krank / Urlaub – bitte aus dem Einsatz nehmen:\n\n" + M.absenceText(ac)); return false; }
    M.put("einsaetze", { ...cur, ...s, truppId: truppSel.value || null, von, bis, monteure: chips.value(),
      leih: body.querySelector(".f-leih").value.trim(), kran: body.querySelector(".f-kran").value.trim(), notiz: body.querySelector(".f-notiz").value.trim() });
    // Bühnen ohne Enddatum dieser Baustelle bekommen das Einsatzende
    for (const b of M.buehnenOf(s)) if (!b.bis && !b.abgemeldetAm) M.put("buehnen", { ...b, bis });
    changed();
  };
  const actions = ro ? [{ label: "Schließen", fn: () => {} }] : [
    ...(isNew ? [] : [{ label: "Löschen", cls: "danger-outline", fn: () => { if (!confirm("Diesen Einsatz löschen?")) return false; M.remove("einsaetze", cur.id); changed(); } }]),
    { label: "Abbrechen", fn: () => {} },
    { label: isNew ? "Anlegen" : "Speichern", cls: "primary", fn: save },
  ];
  modal(isNew ? "Neuer Einsatz" : "Einsatz", body, actions);
}

const TYPEN = ["Arbeitsbühne", "Scherenbühne", "Gelenkteleskopbühne", "Teleskopbühne", "Raupenbühne", "LKW-Bühne", "Teleskopstapler", "MRT (Manitou)"];

export function openBuehne(b, preset = {}, after) {
  const isNew = !b;
  const cur = b ? { ...b } : { id: null, bvNumber: preset.bvNumber || "", baustelle: preset.baustelle || "", vermieterId: (M.list("vermieter")[0] || {}).id || null,
    typ: "", anzahl: 1, von: preset.von || M.today(), bis: preset.bis || "", abgemeldetAm: "", auftragsNr: "", standort: "", notiz: "" };
  const ro = !editable();
  const body = U.el(`<div class="mon-form"></div>`);
  const site = siteField(cur);
  body.appendChild(site.box);
  const vs = M.list("vermieter").sort((a, c) => a.firma.localeCompare(c.firma));
  const typen = [...new Set([...TYPEN, ...M.list("buehnen").map((b) => b.typ).filter(Boolean)])];
  body.appendChild(U.el(`<div><div class="grid2">
    <div><label class="field-label">Vermieter</label><select class="f-v">${vs.map((v) => `<option value="${h(v.id)}" ${v.id === cur.vermieterId ? "selected" : ""}>${h(v.firma)}</option>`).join("")}<option value="" ${!cur.vermieterId ? "selected" : ""}>Bühler (eigen)</option></select></div>
    <div class="grid2 tight"><div><label class="field-label">Typ</label><div class="typ-field"><input type="text" class="f-typ" value="${h(cur.typ)}" placeholder="eingeben" autocomplete="off" />
      <button type="button" class="typ-open" aria-label="Typen anzeigen" tabindex="-1"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button><div class="place-list typ-list"></div></div></div>
    <div><label class="field-label">Anzahl</label><input type="number" min="1" max="99" class="f-n" value="${h(cur.anzahl)}" /></div></div></div>
    <div class="grid2"><div class="grid2 tight"><div><label class="field-label">angeliefert</label><input type="date" class="f-von" value="${h(cur.von)}" /></div>
    <div><label class="field-label">Mietende</label><input type="date" class="f-bis" value="${h(cur.bis)}" /></div></div>
    <div><label class="field-label">Auftrags-Nr. Vermieter <span class="muted">(optional)</span></label><input type="text" class="f-nr" value="${h(cur.auftragsNr)}" /></div></div>
    <label class="field-label">Standort / Adresse (für den Vermieter)</label><input type="text" class="f-ort" value="${h(cur.standort)}" placeholder="optional" />
    ${cur.abgemeldetAm ? `<p class="muted">Abgemeldet am ${h(M.longDate(cur.abgemeldetAm))}.</p>` : ""}</div>`));
  // Typ: frei eintippen oder aus der Liste (Standard + bisher verwendete) übernehmen
  const tin = body.querySelector(".f-typ"), tlist = body.querySelector(".typ-list");
  const showTypen = (all) => {
    const q = all ? "" : tin.value.trim().toLowerCase();
    const xs = typen.filter((x) => !q || x.toLowerCase().includes(q));
    tlist.innerHTML = xs.map((x) => `<button type="button" class="place-opt" data-t="${h(x)}">${h(x)}</button>`).join("");
    U.$$(".place-opt", tlist).forEach((o) => o.addEventListener("pointerdown", (ev) => { ev.preventDefault(); tin.value = o.dataset.t; tlist.innerHTML = ""; }));
  };
  tin.addEventListener("focus", () => showTypen(true));
  tin.addEventListener("input", () => showTypen(false));
  tin.addEventListener("blur", () => setTimeout(() => { tlist.innerHTML = ""; }, 150));
  body.querySelector(".typ-open").addEventListener("pointerdown", (ev) => { ev.preventDefault(); if (tlist.innerHTML) tlist.innerHTML = ""; else { tin.focus(); showTypen(true); } });
  // Dauer: standardmäßig wie die Einsätze des BV, solange nicht von Hand geändert
  if (isNew) {
    const vonIn = body.querySelector(".f-von"), bisIn = body.querySelector(".f-bis");
    let manual = !!(preset.von || preset.bis);
    vonIn.addEventListener("input", () => { manual = true; });
    bisIn.addEventListener("input", () => { manual = true; });
    const fromSite = () => {
      if (manual) return;
      const es = M.list("einsaetze").filter((e) => M.sameSite(e, site.value()) && e.von && e.bis && e.bis >= M.today());
      if (!es.length) return;
      vonIn.value = es.reduce((m, e) => (e.von < m ? e.von : m), es[0].von);
      bisIn.value = es.reduce((m, e) => (e.bis > m ? e.bis : m), es[0].bis);
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
    if (bis && von && bis < von) { toast("Das Mietende liegt vor der Anlieferung.", "warn"); return false; }
    M.put("buehnen", { ...cur, ...s, vermieterId: body.querySelector(".f-v").value || null, typ: body.querySelector(".f-typ").value.trim(),
      anzahl: Math.max(1, Number(body.querySelector(".f-n").value) || 1), von, bis, auftragsNr: body.querySelector(".f-nr").value.trim(), standort: body.querySelector(".f-ort").value.trim() });
    changed();
    if (after) after();
  };
  const actions = ro ? [{ label: "Schließen", fn: () => {} }] : [
    ...(isNew ? [] : [{ label: "Löschen", cls: "danger-outline", fn: () => { if (!confirm("Diese Bühne löschen?")) return false; M.remove("buehnen", cur.id); changed(); if (after) after(); } }]),
    ...(!isNew && cur.abgemeldetAm ? [{ label: "Wieder aktiv", fn: () => { M.put("buehnen", { ...cur, abgemeldetAm: "" }); changed(); if (after) after(); } }] : []),
    // Abmelden: Mietbühne -> vorformulierte E-Mail an den Vermieter, danach als abgemeldet markieren
    ...(!isNew && !cur.abgemeldetAm ? [{ label: "Bühne abmelden", fn: () => {
      const v = cur.vermieterId && M.get("vermieter", cur.vermieterId);
      if (v && v.email) {
        const acc = U.account();
        location.href = M.abmeldeMail(v, [cur], acc && acc.name);
        if (!confirm(`E-Mail an ${v.firma} gesendet?\n\nOK = Bühne als abgemeldet markieren.`)) return false;
      } else if (v) {
        if (!confirm(`Für ${v.firma} ist keine E-Mail-Adresse hinterlegt.\nBühne trotzdem als abgemeldet markieren?`)) return false;
      } else if (!confirm("Eigene Bühne als abgemeldet (zurück) markieren?")) return false;
      M.put("buehnen", { ...cur, abgemeldetAm: M.today() }); changed(); if (after) after();
    } }] : []),
    { label: isNew ? "Anlegen" : "Speichern", cls: "primary", fn: save },
  ];
  modal(isNew ? "Neue Bühne" : "Bühne", body, actions);
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
    <label class="field-label">Richtmeister (ein Name pro Zeile – je Richtmeister wird ein Trupp angelegt)</label><textarea id="rmAdd" rows="3"></textarea>
    <label class="field-label">Monteure (ein Name pro Zeile)</label><textarea id="mAdd" rows="4"></textarea>
    <label class="field-label">Maler (ein Name pro Zeile – je Maler eine eigene Zeile in der Planung)</label><textarea id="maAdd" rows="2"></textarea></div>`);
  modal("Personal hinzufügen", body, [
    { label: "Abbrechen", fn: () => {} },
    { label: "Hinzufügen", cls: "primary", fn: () => {
      const split = (v) => v.split(/\n|;/).map((x) => x.trim()).filter(Boolean);
      const rm = split(body.querySelector("#rmAdd").value), m = split(body.querySelector("#mAdd").value), maler = split(body.querySelector("#maAdd").value);
      if (!rm.length && !m.length && !maler.length) { toast("Bitte mindestens einen Namen eingeben.", "warn"); return false; }
      const r = M.importPeople({ rm, m, maler });
      toast(`${r.neuRm} Richtmeister, ${r.neuM} Monteur(e), ${r.neuMa} Maler angelegt.`, "info", 3500);
      changed();
    } },
  ]);
  setTimeout(() => body.querySelector("#rmAdd").focus(), 50);
}

export function renderMonPersonal(app) {
  const ro = !editable();
  // Wer einen Trupp führt, aber noch als Monteur geführt wird -> Richtmeister
  if (!ro) for (const tr of M.list("trupps")) { const f = tr.fuehrerId && M.get("monteure", tr.fuehrerId); if (f && M.kind(f) === "monteur") M.setKind(f, "rm"); }
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
  const tRow = (tr) => `<button type="button" class="mon-brow" data-tid="${h(tr.id)}"><span class="mon-brow-main"><b>${h(M.truppName(tr))}</b></span>
    <span class="muted">${(() => { const ms = (tr.monteure || []).filter((id) => id !== tr.fuehrerId); return ms.length ? h(monteurNames(ms)) : "noch keine Monteure"; })()}</span></button>`;
  const ts = M.sortedTrupps().filter((tr) => !M.isMalerTrupp(tr));
  const tCard = U.el(`<div class="card list-card">${cardHead(`Trupps (${ts.length})`, "truppNew", "+ Trupp", ro)}${ts.map(tRow).join("") || `<p class="muted">Noch keine Trupps.</p>`}</div>`);
  app.appendChild(tCard);
  const tn = tCard.querySelector("#truppNew"); if (tn) tn.onclick = () => editTrupp(null);
  U.$$("[data-tid]", tCard).forEach((b) => { b.onclick = () => editTrupp(M.get("trupps", b.dataset.tid)); });

  // Personen
  const all = M.sortedMonteure(true);
  const row = (m) => `<div class="mon-mrow ${m.aktiv === false ? "off" : ""}"><span>${h(m.name)}${m.aktiv === false ? ' <span class="muted">(inaktiv)</span>' : ""}</span>
    ${ro ? "" : `<span class="row"><select class="kind-sel" data-kind="${h(m.id)}" aria-label="Kategorie">${Object.entries(M.PERSON_KINDS).map(([k, l]) => `<option value="${k}" ${M.kind(m) === k ? "selected" : ""}>${l}</option>`).join("")}</select><button type="button" class="secondary small" data-ren="${h(m.id)}" title="Umbenennen" aria-label="Umbenennen"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 4.5l3 3L8 17l-4 1 1-4z"/></svg><span class="lbl">Umbenennen</span></button><button type="button" class="secondary small" data-tog="${h(m.id)}">${m.aktiv === false ? "Aktivieren" : "Inaktiv"}</button></span>`}</div>`;
  const grp = (k, title) => { const xs = all.filter((m) => M.kind(m) === k); return `<div class="card list-card"><h3 class="section-title">${title} (${xs.length})</h3>${xs.map(row).join("") || `<p class="muted">Noch keine ${title}.</p>`}</div>`; };
  const pCard = U.el(`<div>${grp("rm", "Richtmeister")}${grp("monteur", "Monteure")}${grp("maler", "Maler")}</div>`);
  app.appendChild(pCard);
  if (!ro) {
    U.$$("[data-kind]", pCard).forEach((sel) => { sel.onchange = () => { M.setKind(M.get("monteure", sel.dataset.kind), sel.value); changed(); }; });
    U.$$("[data-ren]", pCard).forEach((b) => { b.onclick = () => { const m = M.get("monteure", b.dataset.ren); const nn = prompt("Name", m.name); if (nn && nn.trim()) { M.put("monteure", { ...m, name: nn.trim() }); changed(); } }; });
    U.$$("[data-tog]", pCard).forEach((b) => { b.onclick = () => { const m = M.get("monteure", b.dataset.tog); M.put("monteure", { ...m, aktiv: m.aktiv === false }); changed(); }; });
  }
}

// Bühnenvermieter (im Reiter "Bühnen" unten)
function vermieterCard() {
  const ro = !editable();
  const card = U.el(`<div class="card list-card">${cardHead("Bühnenvermieter", "vermNew", "+ Vermieter", ro)}${M.list("vermieter").sort((a, b) => a.firma.localeCompare(b.firma)).map((v) => `
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
    <label class="field-label">Monteure im Trupp (werden bei neuen Einsätzen vorgeschlagen)</label></div>`);
  const chips = chipPicker(M.sortedMonteure(), cur.monteure);
  body.appendChild(chips.box);
  const fsel = body.querySelector(".f-f");
  fsel.onchange = () => { if (fsel.value) chips.set([...new Set([fsel.value, ...chips.value()])]); };
  const save = () => {
    const fuehrerId = fsel.value || null;
    const name = body.querySelector(".f-name").value.trim();
    const ids = chips.value();
    if (!fuehrerId && !name && !ids.length) { toast("Bitte Richtmeister, Monteure oder einen Namen angeben.", "warn"); return false; }
    if (fuehrerId && !ids.includes(fuehrerId)) ids.unshift(fuehrerId);
    const f = fuehrerId && M.get("monteure", fuehrerId);
    if (f && M.kind(f) === "monteur") M.setKind(f, "rm");
    M.put("trupps", { ...cur, fuehrerId, name, monteure: ids, sort: cur.sort ?? M.list("trupps").length });
    changed();
  };
  modal(t ? "Trupp" : "Neuer Trupp", body, [
    ...(t ? [{ label: "Löschen", cls: "danger-outline", fn: () => { if (!confirm("Trupp löschen? Seine Einsätze bleiben als „Ohne Trupp“ erhalten.")) return false; M.remove("trupps", cur.id); changed(); } }] : []),
    { label: "Abbrechen", fn: () => {} }, { label: t ? "Speichern" : "Anlegen", cls: "primary", fn: save }]);
}
