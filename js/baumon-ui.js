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
  if (!rm.length && !mon.length) return;
  if (!editable()) { toast("Keine Berechtigung zum Bearbeiten von BauMon.", "warn"); return; }
  if (!confirm(`BauMon-Stammdaten übernehmen?\n\nRichtmeister (je mit Trupp): ${rm.length}\n${rm.join(", ")}\n\nMonteure: ${mon.length}\n${mon.join(", ")}\n\nBereits vorhandene Namen werden nicht doppelt angelegt.`)) return;
  const r = M.importPeople({ rm, m: mon });
  toast(`Übernommen: ${r.neuRm} Richtmeister, ${r.neuM} Monteure, ${r.neuT} Trupps.`, "info", 5000);
  U.go({ sparte: "mon", view: "monstamm", monStamm: "monteure" });
  U.schedule();
}

const ICO = {
  plus: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  mail: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  check: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  lift: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3v4M18 3v4M5 3h14M4 7h16M7 9l10 3.5M17 9L7 12.5M7 12.5l10 3.5M17 12.5L7 16M4 16h16v2.5H4z"/><circle cx="7" cy="20.5" r="1.2"/><circle cx="17" cy="20.5" r="1.2"/></svg>',
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
      <div class="muted">Montage beendet – können beim Vermieter abgemeldet werden.</div></div></div>
      <ul class="mon-list">${due.slice(0, 6).map((b) => `<li><b>${h(M.buehneText(b))}</b> · ${h(M.baustelleLabel(b))} · ${h(vermieterName(b.vermieterId))} <span class="muted">bis ${h(M.shortDate(b.bis))}</span></li>`).join("")}</ul>
      <button class="primary" id="toBuehnen" type="button">Zu den Bühnen</button></div>`);
    app.appendChild(card);
    U.$("#toBuehnen").onclick = () => U.go({ view: "monbuehnen" });
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
      <div class="mon-today-sites">${r.list.length ? r.list.map((e) => `<button type="button" class="mon-site" data-eid="${h(e.id)}" style="--c:${siteColor(e)}">
        <span class="mon-site-name">${h(M.baustelleLabel(e))}</span>
        <span class="muted">${h(monteurNames(e.monteure, 4))} · bis ${h(M.wdName(e.bis))} ${h(M.shortDate(e.bis))}</span></button>`).join("") : `<span class="muted">nicht eingeplant</span>`}</div></div>`);
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
  U.$$("[data-stamm]", root).forEach((b) => { b.onclick = () => U.go({ view: "monstamm", monStamm: b.dataset.stamm }); });
}

/* =========================================================
   Planung: Trupps untereinander, Zeit nach rechts
========================================================= */
export function renderMonPlan(app) {
  const m = M.mon();
  const { start } = M.range();
  const days = Array.from({ length: 21 }, (_, i) => M.addDays(start, i));
  const t = M.today();
  const zoom = m.zoom;
  // Kopf wie auf den anderen Reitern (gleiche Höhe) – Ansichts-Schalter sitzt oben in der Karte
  app.appendChild(U.el(`<div class="page-head"><h1>Planung</h1>${editable() ? `<button class="primary" id="monNew" type="button">+ Einsatz</button>` : ""}</div>`));
  const nb = U.$("#monNew");
  if (nb) nb.onclick = () => openEinsatz(null, { von: t, bis: t });

  const trupps = M.sortedTrupps();
  const einsaetze = M.list("einsaetze").filter((e) => e.bis >= days[0] && e.von <= days[20]);
  const rows = trupps.map((tr) => ({ tr, list: einsaetze.filter((e) => e.truppId === tr.id) }));
  const rest = einsaetze.filter((e) => !e.truppId || !M.get("trupps", e.truppId));
  if (rest.length) rows.push({ tr: null, list: rest });

  if (!rows.length) {
    const empty = U.el(`<div class="card mon-empty-card"><h3>Noch keine Trupps</h3>
      <p class="muted">Für die Planung zuerst Monteure und Trupps anlegen.</p>
      <div class="row wrap"><button class="primary" data-stamm="trupps" type="button">Trupps anlegen</button>
      <button class="secondary" data-stamm="monteure" type="button">Monteure</button></div></div>`);
    app.appendChild(empty);
    bindStammButtons(empty);
    return;
  }

  const card = U.el(`<div class="card mon-plan-card">
    <div class="g-tools"><button type="button" class="secondary small g-pdf" id="planPdf">PDF</button><div class="seg" role="group" aria-label="Ansicht">
      <button type="button" class="${zoom === "tage" ? "on" : ""}" data-zoom="tage">Tage</button>
      <button type="button" class="${zoom === "wochen" ? "on" : ""}" data-zoom="wochen">Wochen</button>
    </div></div>
    <div class="g-scroll"><div class="gantt ${zoom}" style="--days:21"></div></div></div>`);
  U.$$("[data-zoom]", card).forEach((b) => { b.onclick = () => { m.zoom = b.dataset.zoom; U.render(); }; });
  card.querySelector("#planPdf").onclick = () => openPlanPdf();
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

  let gridRow = 3;
  for (const r of rows) {
    // Bahnen: überlappende Einsätze eines Trupps untereinander
    const lanes = [];
    for (const e of r.list.slice().sort((a, b) => a.von.localeCompare(b.von))) {
      let lane = lanes.findIndex((l) => l.every((x) => x.bis < e.von || x.von > e.bis));
      if (lane < 0) { lanes.push([]); lane = lanes.length - 1; }
      lanes[lane].push(e);
    }
    const n = Math.max(1, lanes.length);
    const tr = r.tr;
    const fuehrer = tr && M.get("monteure", tr.fuehrerId);
    g.insertAdjacentHTML("beforeend", `<div class="g-trupp" data-row="${tr ? h(tr.id) : ""}" style="grid-row:${gridRow} / span ${n}"><b>${h(M.truppName(tr))}</b>${tr && (tr.fuehrerId || tr.name) ? `<span class="muted">${h(monteurNames(tr.monteure.filter((id) => id !== tr.fuehrerId), 3))}${fuehrer ? "" : ""}</span>` : ""}</div>`);
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
        const bh = M.buehnenOf(e).filter((b) => !b.abgemeldetAm);
        const dueHere = bh.some((b) => b.vermieterId && b.bis && b.bis <= t);
        const dbl = M.conflicts(e);
        g.insertAdjacentHTML("beforeend", `<button type="button" class="g-bar ${dueHere ? "has-due" : ""} ${dbl.length ? "conflict" : ""} ${e.von < days[0] ? "cut-l" : ""} ${e.bis > days[20] ? "cut-r" : ""}" data-eid="${h(e.id)}"
          style="grid-column:${2 + s} / ${3 + en};grid-row:${gridRow + li};--c:${siteColor(e)}" title="${h(M.baustelleLabel(e))}: ${h(M.longDate(e.von))} – ${h(M.longDate(e.bis))}${dbl.length ? " – DOPPELT EINGETEILT: " + h([...new Set(dbl.map((c) => (M.get("monteure", c.monteurId) || {}).name))].join(", ")) : ""}">
          ${editable() && e.von >= days[0] ? '<span class="g-h l" data-h="start" aria-hidden="true"></span>' : ""}<span class="g-bar-t">${e.bvNumber ? `<span class="g-num">${h(e.bvNumber)}</span> <span class="g-name">${h(e.baustelle)}</span>` : `<span class="g-name only">${h(e.baustelle || "Baustelle")}</span>`}</span>${bh.length ? `<span class="g-lift ${dueHere ? "due" : ""}" title="${bh.length} Bühne(n)${dueHere ? " – abmelden!" : ""}">${ICO.lift}</span>` : ""}${editable() && e.bis <= days[20] ? '<span class="g-h r" data-h="end" aria-hidden="true"></span>' : ""}</button>`);
      }
    });
    gridRow += n;
  }
  app.appendChild(card);

  U.$$(".g-bar", card).forEach((b) => { b.onclick = () => { if (dragJustEnded) return; openEinsatz(M.get("einsaetze", b.dataset.eid)); }; });
  if (editable()) enableDrag(card, g, days);
  if (editable()) {
    U.$$(".g-cell", card).forEach((c) => {
      c.onclick = () => openEinsatz(null, { von: c.dataset.day, bis: c.dataset.day, truppId: c.dataset.trupp || null });
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
        b.style.paddingLeft = l < edge ? `${Math.max(8, Math.min(edge - l + 8, b.offsetWidth - 60))}px` : "";
      }
    };
    sc.addEventListener("scroll", () => { if (!raf) raf = requestAnimationFrame(follow); }, { passive: true });
    follow();
  });
  const touch = "ontouchstart" in window;
  app.appendChild(U.el(`<p class="muted center">${editable()
    ? (touch ? "Antippen: öffnen · freier Tag: neuer Einsatz · kurz halten + ziehen: verschieben · Rand ziehen: Länge"
      : "Freier Tag: neuer Einsatz · Balken ziehen: verschieben (auch zu anderem Trupp) · Rand ziehen: Länge ändern")
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
  const rowEls = U.$$(".g-trupp", g);
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
    const cf = M.conflicts(next);
    if (cf.length) { alert("Nicht möglich – doppelt eingeteilt:\n\n" + M.conflictText(cf)); return; }
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
  const ab = all.filter((b) => b.abgemeldetAm && b.abgemeldetAm >= M.addDays(t, -30)).sort((a, b) => b.abgemeldetAm.localeCompare(a.abgemeldetAm));

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
}

function buehneRow(b, due = false) {
  const status = b.abgemeldetAm ? `abgemeldet ${M.shortDate(b.abgemeldetAm)}` : b.bis ? `benötigt bis ${M.wdName(b.bis)} ${M.shortDate(b.bis)}` : "ohne Enddatum";
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
    listEl.innerHTML = ps.map((p) => `<button type="button" class="place-opt" data-n="${h(p.number)}" data-t="${h(p.title)}">${h(p.number)} ${h(p.client || p.title)}<span>${h(p.place || "")}</span></button>`).join("");
    U.$$(".place-opt", listEl).forEach((b) => b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      val = { bvNumber: b.dataset.n, baustelle: b.dataset.t };
      input.value = M.baustelleLabel(val);
      listEl.innerHTML = "";
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
      return `<button type="button" class="chip ${sel.has(x.id) ? "on" : ""} ${b ? "busy" : ""}" data-id="${h(x.id)}" ${b ? `title="schon bei ${h(M.baustelleLabel(b))}"` : ""}>${x.rm ? "★ " : ""}${h(x.name)}${b ? ` <small>· ${h(b.bvNumber || "belegt")}</small>` : ""}</button>`;
    }).join("") || `<span class="muted">Noch keine Monteure angelegt.</span>`;
    U.$$(".chip", box).forEach((c) => { c.onclick = () => { sel.has(c.dataset.id) ? sel.delete(c.dataset.id) : sel.add(c.dataset.id); draw(); }; });
  };
  draw();
  return { box, value: () => [...sel], set: (ids) => { sel.clear(); ids.forEach((i) => sel.add(i)); draw(); },
    setBusy: (m) => { busy = m; draw(); } };
}

export function openEinsatz(e, preset = {}) {
  const isNew = !e;
  const cur = e ? { ...e } : { id: null, truppId: preset.truppId || (M.sortedTrupps()[0] || {}).id || null, bvNumber: "", baustelle: "", von: preset.von, bis: preset.bis, monteure: [], leih: "", kran: "", notiz: "" };
  if (isNew && cur.truppId) cur.monteure = (M.get("trupps", cur.truppId) || {}).monteure || [];
  const ro = !editable();
  const body = U.el(`<div class="mon-form"></div>`);
  const site = siteField(cur);
  body.appendChild(site.box);
  body.appendChild(U.el(`<div class="grid2">
    <div><label class="field-label">Trupp</label><select class="f-trupp">${M.sortedTrupps().map((t) => `<option value="${h(t.id)}" ${t.id === cur.truppId ? "selected" : ""}>${h(M.truppName(t))}</option>`).join("")}<option value="" ${!cur.truppId ? "selected" : ""}>Ohne Trupp</option></select></div>
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
    bbox.innerHTML = `<label class="field-label">Bühnen auf dieser Baustelle</label>${bs.map((b) => buehneRow(b, !b.abgemeldetAm && b.vermieterId && b.bis && b.bis <= M.today())).join("") || `<p class="muted">Keine.</p>`}
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
  site.box.querySelector(".site-in").addEventListener("blur", () => setTimeout(drawB, 200));
  const truppSel = body.querySelector(".f-trupp");
  const updBusy = () => {
    const von = body.querySelector(".f-von").value, bis = body.querySelector(".f-bis").value;
    const map = new Map();
    if (von && bis && bis >= von) for (const c of M.conflicts({ ...cur, von, bis, truppId: truppSel.value || null }, M.list("monteure").map((x) => x.id))) map.set(c.monteurId, c.other);
    chips.setBusy(map);
  };
  body.querySelector(".f-von").addEventListener("change", updBusy);
  body.querySelector(".f-bis").addEventListener("change", updBusy);
  updBusy();
  truppSel.onchange = () => { if (isNew) chips.set((M.get("trupps", truppSel.value) || {}).monteure || []); updBusy(); };
  if (ro) U.$$("input,select,textarea,.chip", body).forEach((x) => { x.disabled = true; });

  const save = () => {
    const s = site.value();
    const von = body.querySelector(".f-von").value;
    const bis = body.querySelector(".f-bis").value;
    if (!s.bvNumber && !s.baustelle) { toast("Bitte die Baustelle angeben.", "warn"); return false; }
    if (!von || !bis || bis < von) { toast("Bitte einen gültigen Zeitraum angeben (bis ≥ von).", "warn"); return false; }
    const cf = M.conflicts({ ...cur, von, bis, truppId: truppSel.value || null }, chips.value());
    if (cf.length) { alert("Doppelt eingeteilt – bitte ändern:\n\n" + M.conflictText(cf)); return false; }
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
  body.appendChild(U.el(`<div><div class="grid2">
    <div><label class="field-label">Vermieter</label><select class="f-v">${vs.map((v) => `<option value="${h(v.id)}" ${v.id === cur.vermieterId ? "selected" : ""}>${h(v.firma)}</option>`).join("")}<option value="" ${!cur.vermieterId ? "selected" : ""}>Bühler (eigen)</option></select></div>
    <div class="grid2 tight"><div><label class="field-label">Typ</label><input type="text" class="f-typ" list="mon-typen" value="${h(cur.typ)}" placeholder="Arbeitsbühne" /></div>
    <div><label class="field-label">Anzahl</label><input type="number" min="1" max="99" class="f-n" value="${h(cur.anzahl)}" /></div></div></div>
    <datalist id="mon-typen">${TYPEN.map((x) => `<option value="${h(x)}">`).join("")}</datalist>
    <div class="grid2"><div class="grid2 tight"><div><label class="field-label">angeliefert</label><input type="date" class="f-von" value="${h(cur.von)}" /></div>
    <div><label class="field-label">benötigt bis</label><input type="date" class="f-bis" value="${h(cur.bis)}" /></div></div>
    <div><label class="field-label">Auftrags-Nr. Vermieter</label><input type="text" class="f-nr" value="${h(cur.auftragsNr)}" /></div></div>
    <label class="field-label">Standort / Adresse (für den Vermieter)</label><input type="text" class="f-ort" value="${h(cur.standort)}" placeholder="optional" />
    ${cur.abgemeldetAm ? `<p class="muted">Abgemeldet am ${h(M.longDate(cur.abgemeldetAm))}.</p>` : ""}</div>`));
  if (ro) U.$$("input,select,textarea", body).forEach((x) => { x.disabled = true; });
  const save = () => {
    const s = site.value();
    if (!s.bvNumber && !s.baustelle) { toast("Bitte die Baustelle angeben.", "warn"); return false; }
    const bis = body.querySelector(".f-bis").value;
    const von = body.querySelector(".f-von").value;
    if (bis && von && bis < von) { toast("„benötigt bis“ liegt vor der Anlieferung.", "warn"); return false; }
    M.put("buehnen", { ...cur, ...s, vermieterId: body.querySelector(".f-v").value || null, typ: body.querySelector(".f-typ").value.trim(),
      anzahl: Math.max(1, Number(body.querySelector(".f-n").value) || 1), von, bis, auftragsNr: body.querySelector(".f-nr").value.trim(), standort: body.querySelector(".f-ort").value.trim() });
    changed();
    if (after) after();
  };
  const actions = ro ? [{ label: "Schließen", fn: () => {} }] : [
    ...(isNew ? [] : [{ label: "Löschen", cls: "danger-outline", fn: () => { if (!confirm("Diese Bühne löschen?")) return false; M.remove("buehnen", cur.id); changed(); if (after) after(); } }]),
    ...(!isNew && cur.abgemeldetAm ? [{ label: "Wieder aktiv", fn: () => { M.put("buehnen", { ...cur, abgemeldetAm: "" }); changed(); if (after) after(); } }] : []),
    ...(!isNew && !cur.abgemeldetAm ? [{ label: "Abgemeldet", fn: () => { M.put("buehnen", { ...cur, abgemeldetAm: M.today() }); changed(); if (after) after(); } }] : []),
    { label: isNew ? "Anlegen" : "Speichern", cls: "primary", fn: save },
  ];
  modal(isNew ? "Neue Bühne" : "Bühne", body, actions);
}

/* =========================================================
   Stammdaten (Einstellungen › BauMon)
========================================================= */
export function monSettingsCard() {
  const n = (k) => M.list(k).length;
  const card = U.el(`<div class="card"><h3 class="section-title">BauMon – Stammdaten</h3>
    <div class="mon-stamm-links">
      <button type="button" class="drawer-item" data-stamm="vermieter"><span class="d-ico">${ICO.lift}</span><span class="d-text"><b>Bühnenvermieter</b><small>${n("vermieter")} angelegt · Ansprechpartner, E-Mail</small></span></button>
      <button type="button" class="drawer-item" data-stamm="monteure"><span class="d-ico">${ICO.people}</span><span class="d-text"><b>Monteure</b><small>${M.sortedMonteure().length} aktiv</small></span></button>
      <button type="button" class="drawer-item" data-stamm="trupps"><span class="d-ico">${ICO.people}</span><span class="d-text"><b>Trupps</b><small>${n("trupps")} angelegt · Richtmeister + Monteure</small></span></button>
    </div></div>`);
  bindStammButtons(card);
  return card;
}

export function renderMonStamm(app) {
  const kind = S.state.monStamm || "vermieter";
  const ro = !editable();
  const titles = { vermieter: "Bühnenvermieter", monteure: "Monteure", trupps: "Trupps" };
  app.appendChild(U.el(`<div class="page-head"><h1>${titles[kind] || ""}</h1><button class="secondary" id="stBack" type="button">Zurück</button></div>`));
  // zurück dorthin, woher man kam (Einstellungen oder BauMon-Startseite)
  U.$("#stBack").onclick = () => { if (history.state && history.length > 1) history.back(); else U.go({ view: "settings" }); };
  if (kind === "vermieter") {
    const card = U.el(`<div class="card list-card">${M.list("vermieter").sort((a, b) => a.firma.localeCompare(b.firma)).map((v) => `
      <button type="button" class="mon-brow" data-vid="${h(v.id)}"><span class="mon-brow-main"><b>${h(v.firma)}</b>${v.ansprechpartner ? " · " + h(v.ansprechpartner) : ""}</span>
      <span class="muted">${h(v.email || "keine E-Mail")}${v.telefon ? " · " + h(v.telefon) : ""}${v.kundenNr ? " · Kd.-Nr. " + h(v.kundenNr) : ""}</span></button>`).join("") || `<p class="muted">Noch keine Vermieter.</p>`}</div>`);
    app.appendChild(card);
    if (!ro) app.appendChild(btn("+ Vermieter", () => editVermieter(null)));
    U.$$("[data-vid]", card).forEach((b) => { b.onclick = () => editVermieter(M.get("vermieter", b.dataset.vid)); });
  } else if (kind === "monteure") {
    const all = M.sortedMonteure(true);
    const row = (m) => `<div class="mon-mrow ${m.aktiv === false ? "off" : ""}"><span>${h(m.name)}${m.aktiv === false ? ' <span class="muted">(inaktiv)</span>' : ""}</span>
      ${ro ? "" : `<span class="row"><button type="button" class="secondary small" data-rm="${h(m.id)}" title="Als Richtmeister kennzeichnen">${m.rm ? "★ Richtmeister" : "☆ Richtmeister"}</button><button type="button" class="secondary small" data-ren="${h(m.id)}">Umbenennen</button><button type="button" class="secondary small" data-tog="${h(m.id)}">${m.aktiv === false ? "Aktivieren" : "Inaktiv"}</button></span>`}</div>`;
    const rms = all.filter((m) => m.rm), mons = all.filter((m) => !m.rm);
    const card = U.el(`<div><div class="card list-card"><h3 class="section-title">Richtmeister (${rms.length})</h3>${rms.map(row).join("") || `<p class="muted">Noch keine Richtmeister.</p>`}</div>
      <div class="card list-card"><h3 class="section-title">Monteure (${mons.length})</h3>${mons.map(row).join("") || `<p class="muted">Noch keine Monteure.</p>`}</div></div>`);
    app.appendChild(card);
    if (!ro) {
      const add = U.el(`<div class="card"><div class="grid2">
        <div><label class="field-label">Richtmeister hinzufügen (ein Name pro Zeile – je Richtmeister wird ein Trupp angelegt)</label><textarea id="rmAdd" rows="4"></textarea></div>
        <div><label class="field-label">Monteure hinzufügen (ein Name pro Zeile)</label><textarea id="mAdd" rows="4"></textarea></div></div>
        <button class="primary" id="mAddBtn" type="button">Hinzufügen</button></div>`);
      app.appendChild(add);
      U.$("#mAddBtn").onclick = () => {
        const split = (v) => v.split(/\n|;/).map((x) => x.trim()).filter(Boolean);
        const r = M.importPeople({ rm: split(U.$("#rmAdd").value), m: split(U.$("#mAdd").value) });
        toast(`${r.neuRm} Richtmeister, ${r.neuM} Monteur(e), ${r.neuT} Trupp(s) angelegt.`, "info", 3500);
        changed();
      };
      U.$$("[data-rm]", card).forEach((b) => { b.onclick = () => { const m = M.get("monteure", b.dataset.rm); M.put("monteure", { ...m, rm: !m.rm }); if (!m.rm) M.importPeople({ rm: [m.name] }); changed(); }; });
      U.$$("[data-ren]", card).forEach((b) => { b.onclick = () => { const m = M.get("monteure", b.dataset.ren); const nn = prompt("Name", m.name); if (nn && nn.trim()) { M.put("monteure", { ...m, name: nn.trim() }); changed(); } }; });
      U.$$("[data-tog]", card).forEach((b) => { b.onclick = () => { const m = M.get("monteure", b.dataset.tog); M.put("monteure", { ...m, aktiv: m.aktiv === false }); changed(); }; });
    }
  } else if (kind === "trupps") {
    const card = U.el(`<div class="card list-card">${M.sortedTrupps().map((t) => `<button type="button" class="mon-brow" data-tid="${h(t.id)}"><span class="mon-brow-main"><b>${h(M.truppName(t))}</b></span>
      <span class="muted">${h(monteurNames(t.monteure))}</span></button>`).join("") || `<p class="muted">Noch keine Trupps.</p>`}</div>`);
    app.appendChild(card);
    if (!ro) app.appendChild(btn("+ Trupp", () => editTrupp(null)));
    U.$$("[data-tid]", card).forEach((b) => { b.onclick = () => editTrupp(M.get("trupps", b.dataset.tid)); });
  }
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
    <label class="field-label">Richtmeister</label><select class="f-f"><option value="">– ohne Richtmeister –</option>${[...M.sortedMonteure().filter((m) => m.rm), ...M.sortedMonteure().filter((m) => !m.rm)].map((m) => `<option value="${h(m.id)}" ${m.id === cur.fuehrerId ? "selected" : ""}>${h(m.name)}${m.rm ? " (Richtmeister)" : ""}</option>`).join("")}</select>
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
    M.put("trupps", { ...cur, fuehrerId, name, monteure: ids, sort: cur.sort ?? M.list("trupps").length });
    changed();
  };
  modal(t ? "Trupp" : "Neuer Trupp", body, [
    ...(t ? [{ label: "Löschen", cls: "danger-outline", fn: () => { if (!confirm("Trupp löschen? Seine Einsätze bleiben als „Ohne Trupp“ erhalten.")) return false; M.remove("trupps", cur.id); changed(); } }] : []),
    { label: "Abbrechen", fn: () => {} }, { label: t ? "Speichern" : "Anlegen", cls: "primary", fn: save }]);
}
