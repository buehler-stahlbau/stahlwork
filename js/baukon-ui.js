/* =========================================================
   BauKon – Einteilung der Konstrukteure (Oberfläche)
   Reiter: Planung (Kalender Mo–Fr, eine Zeile je Konstrukteur) · Personal
   Ein BV-Balken hat zwei Zeilen: oben BV-Nummer + Name (+ Freitext), darunter je Tag ein Kürzel.
   Ohne Kürzel ist der Balken ein weißer Platzhalter; mit Kürzeln grau (Stahlbau) bzw. braunrot (Rohbau),
   der Ton wechselt von BV zu BV. Abwesenheiten liegen farbig über beiden Zeilen.
========================================================= */
import * as K from "./baukon.js";
import { addDays, mondayOf, isoWeek, wdName, shortDate, longDate, holiday, parseDay, HOL_SHORT } from "./plan-core.js";
import { escapeHtml as h, toast } from "./util.js";
import { modal, siteField } from "./baumon-ui.js";
import { buildKonPdf } from "./baukon-pdf.js";

let U = null; // Hilfsfunktionen aus app.js
export function initKonUI(helpers) { U = helpers; }

const editable = () => K.canEdit();
const changed = () => { keepScroll(); U.schedule(); U.render(); };
const WEEKS = 5; // Standard: 5 Wochen
let weekOffset = 0;
let keep = null; // Scrollposition nach Änderungen behalten
function keepScroll() { const sc = document.querySelector(".kon-plan-card .g-scroll"); keep = { x: sc ? sc.scrollLeft : 0, y: window.scrollY }; }
let flashBv = null; // nach dem Öffnen aus Suche/Karte: Balken dieses BV kurz hervorheben

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const ABW_LABEL = { ...K.ABW_TYPES, feiertag: "Feiertag", frei: "frei (Teilzeit)" };
const ABW_ONE = { ...K.ABW_SHORT, feiertag: "FT", frei: "frei" };

/* =========================================================
   Übersicht: tagesaktuell – wer an welchem BV arbeitet, wer abwesend ist
========================================================= */
export function renderKonStart(app) {
  const t = K.today();
  // Wochenende: nächster Werktag
  const day = K.nextWeekday(t);
  app.appendChild(U.el(`<div class="page-head"><h1>BauKon</h1>${editable() ? `<button class="primary" id="konNew" type="button">+ Zuteilung</button>` : ""}</div>`));
  const nb = U.$("#konNew");
  if (nb) nb.onclick = () => openZut(null, { von: day });
  const people = K.sortedKonstrukteure();
  if (!people.length) {
    const empty = U.el(`<div class="card mon-empty-card"><h3>Los geht's</h3>
      <p class="muted">Zuerst die Konstrukteure anlegen – danach in der Planung die Bauvorhaben zuteilen.</p>
      <div class="row wrap"><button class="primary" type="button" id="konToPers">Konstrukteure anlegen</button></div></div>`);
    app.appendChild(empty);
    empty.querySelector("#konToPers").onclick = () => U.go({ view: "konpersonal" });
    return;
  }
  const hol = holiday(day);
  const title = day === t ? `Heute · ${longDate(day)}` : `${longDate(day)} (nächster Werktag)`;
  // abwesend (inkl. Schule, Teilzeit-frei)
  const abw = people.map((k) => ({ k, info: K.dayInfo(k, day) })).filter((x) => x.info && x.info.typ !== "feiertag");
  if (abw.length) {
    const until = (x) => (x.info.rec ? ` bis ${wdName(x.info.rec.bis)} ${shortDate(x.info.rec.bis)}` : x.info.pattern ? " (regelmäßig)" : "");
    const ac = U.el(`<div class="card"><h3 class="section-title">${day === t ? "Heute" : "Am " + shortDate(day)} abwesend</h3><div class="mon-abw-list">${abw.map((x) => `<button type="button" class="mon-abw-chip kon-abw ${x.info.typ}" data-kid="${h(x.k.id)}" ${x.info.rec ? `data-aid="${h(x.info.rec.id)}"` : ""}><b>${h(x.k.name)}</b> · ${h(ABW_LABEL[x.info.typ])}${h(until(x))}</button>`).join("")}</div></div>`);
    U.$$("[data-kid]", ac).forEach((b) => { b.onclick = () => { if (b.dataset.aid) openAbw(K.get("abwesenheiten", b.dataset.aid)); else U.go({ view: "konplan" }); }; });
    app.appendChild(ac);
  }
  const card = U.el(`<div class="card"><h3 class="section-title">${h(title)}${hol ? ` <span class="badge hol-badge">${h(hol)}</span>` : ""}</h3><div class="mon-today kon-today"></div></div>`);
  const box = card.querySelector(".kon-today");
  for (const k of people) {
    const info = K.dayInfo(k, day);
    const zs = K.list("zuteilungen").filter((z) => z.kId === k.id && z.von <= day && z.bis >= day);
    const tones = toneMap(k.id);
    const off = info && info.typ !== "feiertag";
    const row = U.el(`<div class="mon-today-row ${zs.length && !off ? "" : "free"}">
      <div class="mon-today-trupp">${h(k.name)}${k.azubi ? ' <span class="p-badge">A</span>' : ""}${k.teilzeit ? ' <span class="p-badge">T</span>' : ""}</div>
      <div class="mon-today-sites">${zs.map((z) => {
        const c = (z.codes || {})[day];
        const next = K.list("zuteilungen").filter((o) => o.kId === k.id && o.von > z.bis).sort((a, b) => a.von.localeCompare(b.von))[0];
        return `<button type="button" class="mon-site kon-site ${toneCls(z, tones.get(z.id) || 0)}" data-zid="${h(z.id)}"><span class="mon-site-txt">
          <span class="mon-site-name">${h(K.bvLabel(z))}${z.text ? ` <small class="muted">· ${h(z.text)}</small>` : ""}</span>
          <span class="muted">${c ? `${h(c)} – ${h(K.CODE_NAMES[c])}` : "noch ohne Kürzel"} · bis ${h(wdName(z.bis))} ${h(shortDate(z.bis))}${next ? ` · danach ${h(K.bvLabel(next))}` : ""}</span></span>${c ? `<span class="kon-code-big">${h(c)}</span>` : ""}</button>`;
      }).join("")}${!zs.length ? `<span class="muted">${off ? h(ABW_LABEL[info.typ]) : "nicht eingeteilt"}</span>` : off ? `<span class="muted">heute ${h(ABW_LABEL[info.typ])}</span>` : ""}</div></div>`);
    box.appendChild(row);
  }
  U.$$("[data-zid]", card).forEach((b) => { b.onclick = () => openZut(K.get("zuteilungen", b.dataset.zid)); });
  app.appendChild(card);
}

// Einmal-Link zum Anlegen der Konstrukteure: …/stahlwork/#kon-import=<Base64 von {"k":[{"n":"Name","az":Rhythmus,"tz":Rhythmus}]}>
export function checkKonImportLink() {
  const m = location.hash.match(/^#kon-import=([A-Za-z0-9_-]+={0,2})$/);
  if (!m) return;
  try { history.replaceState(history.state, "", location.pathname + location.search); } catch {}
  let data;
  try {
    const b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
    data = JSON.parse(decodeURIComponent(escape(atob(b64))));
  } catch { toast("Import-Link ist ungültig.", "error"); return; }
  const list = (Array.isArray(data && data.k) ? data.k : []).filter((x) => x && typeof x.n === "string" && x.n.trim()).slice(0, 200);
  if (!list.length) return;
  if (!editable()) { toast("Keine Berechtigung zum Bearbeiten von BauKon.", "warn"); return; }
  const have = new Set(K.list("konstrukteure").map((k) => k.name.toLowerCase()));
  const neu = list.filter((x) => !have.has(x.n.trim().toLowerCase()));
  const tag = (x) => [x.az ? "Azubi" : "", x.tz ? "Teilzeit" : ""].filter(Boolean).join(", ");
  if (!neu.length) { toast("Alle Konstrukteure aus dem Link sind schon angelegt.", "info", 4000); return; }
  if (!confirm(`BauKon: ${neu.length} Konstrukteure anlegen?\n\n${neu.map((x) => x.n.trim() + (tag(x) ? ` (${tag(x)})` : "")).join(", ")}\n\nBereits vorhandene Namen werden nicht doppelt angelegt.`)) return;
  const r = (v) => (v && typeof v === "object" ? { w2: v.w2 === true, a: Array.isArray(v.a) ? v.a : [], b: Array.isArray(v.b) ? v.b : [], ref: typeof v.ref === "string" ? v.ref : "" } : null);
  for (const x of neu) K.put("konstrukteure", { name: x.n.trim().slice(0, 80), aktiv: true, azubi: !!x.az, schule: r(x.az), teilzeit: !!x.tz, frei: r(x.tz) });
  toast(`${neu.length} Konstrukteure angelegt.`, "info", 4000);
  U.go({ sparte: "kon", view: "konpersonal", selectedProjectId: null, selectedDocId: null });
  U.schedule();
}

/* =========================================================
   Planung
========================================================= */
function viewDays() {
  const start = addDays(mondayOf(K.today()), weekOffset * 7);
  const days = [];
  for (let w = 0; w < WEEKS; w++) for (let i = 0; i < 5; i++) days.push(addDays(start, w * 7 + i));
  return days;
}
// Ton je Balken: wechselt von BV zu BV in der Zeile einer Person (nach Beginn sortiert)
function toneMap(kId) {
  const zs = K.list("zuteilungen").filter((z) => z.kId === kId).sort((a, b) => a.von.localeCompare(b.von) || a.id.localeCompare(b.id));
  const m = new Map();
  zs.forEach((z, i) => m.set(z.id, i % 2));
  return m;
}
const toneCls = (z, t) => { const a = K.artOf(z); return a ? `${a} t${t}` : "ph"; };

export function renderKonPlan(app) {
  const days = viewDays();
  const last = days.length - 1;
  const t = K.today();
  app.appendChild(U.el(`<div class="page-head"><h1>Planung</h1>${editable() ? `<button class="primary" id="konNew" type="button">+ Zuteilung</button>` : ""}</div>`));
  const nb = U.$("#konNew");
  if (nb) nb.onclick = () => openZut(null, { von: K.nextWeekday(t) });
  const people = K.sortedKonstrukteure();
  if (!people.length) {
    const empty = U.el(`<div class="card mon-empty-card"><h3>Noch keine Konstrukteure</h3>
      <p class="muted">Für die Planung zuerst die Konstrukteure anlegen.</p>
      <div class="row wrap"><button class="primary" type="button" id="konToPers">Konstrukteure anlegen</button></div></div>`);
    app.appendChild(empty);
    empty.querySelector("#konToPers").onclick = () => U.go({ view: "konpersonal" });
    return;
  }
  const card = U.el(`<div class="card mon-plan-card kon-plan-card">
    <div class="g-tools"><div class="g-nav"><button type="button" class="icon-btn" id="kwPrev" aria-label="Eine Woche früher" title="Eine Woche früher"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
      <span class="g-range">KW ${isoWeek(days[0])}–${isoWeek(days[last])}</span>
      <button type="button" class="icon-btn" id="kwNext" aria-label="Eine Woche später" title="Eine Woche später"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
      ${weekOffset ? `<button type="button" class="secondary small" id="kwNow">Heute</button>` : ""}</div>
      <span class="grow"></span><button type="button" class="secondary small g-pdf" id="konPdf">PDF</button></div>
    <div class="g-scroll"><div class="gantt kon" style="--days:${days.length}"></div></div></div>`);
  card.querySelector("#kwPrev").onclick = () => { weekOffset--; U.render(); };
  card.querySelector("#kwNext").onclick = () => { weekOffset++; U.render(); };
  const now = card.querySelector("#kwNow"); if (now) now.onclick = () => { weekOffset = 0; U.render(); };
  card.querySelector("#konPdf").onclick = () => openKonPdf();
  const g = card.querySelector(".gantt");

  // Kopf: Wochen + Tage (Mo–Fr), dicker Strich zwischen den Wochen
  let html = `<div class="g-corner" style="grid-row:1 / span 3">Konstrukteur</div>`;
  // Monate über den Kalenderwochen
  for (let i = 0; i < days.length;) {
    let j = i; while (j + 1 < days.length && days[j + 1].slice(0, 7) === days[i].slice(0, 7)) j++;
    const m = parseDay(days[i]);
    html += `<div class="g-month ${i ? "mstart" : ""}" style="grid-column:${2 + i} / ${3 + j}"><span>${MONTHS[m.getMonth()]} ${m.getFullYear()}</span></div>`;
    i = j + 1;
  }
  for (let w = 0; w < WEEKS; w++) {
    const d0 = days[w * 5];
    html += `<div class="g-week wk ${mondayOf(t) === d0 ? "cur" : ""}" style="grid-column:${2 + w * 5} / span 5;grid-row:2">KW ${isoWeek(d0)} <span>${shortDate(d0)}–${shortDate(days[w * 5 + 4])}</span></div>`;
  }
  days.forEach((d, i) => {
    const hol = holiday(d);
    html += `<div class="g-day ${i % 5 === 0 ? "wk" : ""} ${hol ? "hol" : ""} ${d === t ? "today" : ""}" data-day="${d}" style="grid-column:${2 + i};grid-row:3" ${hol ? `title="${h(hol)}"` : ""}>${wdName(d)}<b>${Number(d.slice(8))}</b><i class="g-hol">${hol ? h(HOL_SHORT[hol] || hol) : "&nbsp;"}</i></div>`;
  });
  g.style.gridTemplateRows = "auto auto auto " + people.map(() => "var(--k1) var(--k2)").join(" ");
  const col = (d, dir) => { // Spalte eines Tages (Wochenende -> nächster/vorheriger Werktag)
    let x = dir > 0 ? K.nextWeekday(d) : K.prevWeekday(d);
    if (x < days[0]) x = days[0];
    if (x > days[last]) x = days[last];
    return days.indexOf(x);
  };
  people.forEach((k, n) => {
    const r = 4 + n * 2;
    html += `<div class="g-trupp k-name" style="grid-row:${r} / span 2" data-kid="${h(k.id)}" title="${h(k.name)}${k.azubi ? " · Azubi" : ""}${k.teilzeit ? " · Teilzeit" : ""}"><b>${h(k.name)}</b>${k.azubi || k.teilzeit ? `<span class="k-bdg">${k.azubi ? '<span class="p-badge" title="Azubi">A</span>' : ""}${k.teilzeit ? '<span class="p-badge" title="Teilzeit">T</span>' : ""}</span>` : ""}</div>`;
    days.forEach((d, i) => {
      html += `<div class="k-bg ${i % 5 === 0 ? "wk" : ""} ${holiday(d) ? "hol" : ""} ${d === t ? "today" : ""}" data-kid="${h(k.id)}" data-day="${d}" style="grid-column:${2 + i};grid-row:${r} / span 2"></div>`;
    });
    // BV-Balken (Zeile 1) + Kürzel je Tag (Zeile 2)
    const tones = toneMap(k.id);
    for (const z of K.list("zuteilungen").filter((z) => z.kId === k.id && z.bis >= days[0] && z.von <= days[last])) {
      const s = col(z.von < days[0] ? days[0] : z.von, 1), e = col(z.bis > days[last] ? days[last] : z.bis, -1);
      if (s < 0 || e < s) continue;
      const tc = toneCls(z, tones.get(z.id) || 0);
      const cutL = z.von < days[0], cutR = z.bis > days[last];
      const label = `<span class="g-num">${h(z.bvNumber)}</span> ${h(z.baustelle || "")}`;
      html += `<button type="button" class="k-bar ${tc} ${s % 5 === 0 ? "wk" : ""} ${cutL ? "cut-l" : ""} ${cutR ? "cut-r" : ""} ${flashBv && z.bvNumber === flashBv ? "flash-bar" : ""}" data-zid="${h(z.id)}" style="grid-column:${2 + s} / ${3 + e};grid-row:${r}"
        title="${h(K.bvLabel(z))}${z.text ? " · " + h(z.text) : ""}: ${h(longDate(z.von))} – ${h(longDate(z.bis))}">${editable() && !cutL ? '<span class="g-h l" data-h="start" aria-hidden="true"></span>' : ""}<span class="k-bar-t">${z.bvNumber ? label : h(z.baustelle || "Bauvorhaben")}${z.text ? ` <small>· ${h(z.text)}</small>` : ""}</span>${editable() && !cutR ? '<span class="g-h r" data-h="end" aria-hidden="true"></span>' : ""}</button>`;
      for (let i = s; i <= e; i++) {
        const d = days[i], c = (z.codes || {})[d] || "";
        html += `<div class="k-code ${tc} ${i % 5 === 0 ? "wk" : ""}" data-zid="${h(z.id)}" data-day="${d}" style="grid-column:${2 + i};grid-row:${r + 1}" title="${c ? h(c + " – " + K.CODE_NAMES[c]) : "Kürzel eintragen"}">${h(c)}</div>`;
      }
    }
    // Abwesenheit, Schule, Teilzeit-frei, Feiertag: farbig über beiden Zeilen (zusammenhängende Tage als ein Block)
    let run = null;
    const flush = () => {
      if (!run) return;
      const one = run.e === run.s;
      const rec = run.aid ? K.get("abwesenheiten", run.aid) : null;
      const hl = rec && editable() && rec.von >= days[0], hr = rec && editable() && rec.bis <= days[last];
      html += `<button type="button" class="k-st ${run.typ} ${one ? "one" : ""} ${run.s % 5 === 0 ? "wk" : ""}" data-kid="${h(k.id)}" data-day="${days[run.s]}" data-end="${days[run.e]}" ${run.aid ? `data-aid="${h(run.aid)}"` : ""} style="grid-column:${2 + run.s} / ${3 + run.e};grid-row:${r} / span 2" title="${h(k.name)}: ${h(run.title)}">${hl ? '<span class="g-h l" data-h="start" aria-hidden="true"></span>' : ""}<span class="l">${h(ABW_LABEL[run.typ] || run.typ)}</span><span class="s">${h(ABW_ONE[run.typ] || "")}</span>${hr ? '<span class="g-h r" data-h="end" aria-hidden="true"></span>' : ""}</button>`;
      run = null;
    };
    days.forEach((d, i) => {
      const info = K.dayInfo(k, d);
      const key = info ? (info.rec ? "a:" + info.rec.id : info.typ) : null;
      if (run && (key !== run.key || i % 5 === 0 && run.typ === "feiertag")) flush();
      if (!info) return;
      if (!run) run = { key, typ: info.typ, s: i, e: i, aid: info.rec ? info.rec.id : "", title: info.rec ? `${ABW_LABEL[info.typ]} ${shortDate(info.rec.von)}–${shortDate(info.rec.bis)}${info.rec.notiz ? " · " + info.rec.notiz : ""}` : info.typ === "feiertag" ? info.name : ABW_LABEL[info.typ] + (info.pattern ? " (regelmäßig)" : "") };
      else run.e = i;
    });
    flush();
  });
  g.innerHTML = html;
  app.appendChild(card);
  flashBv = null;

  // Klicks
  U.$$(".k-bg", g).forEach((c) => { c.onclick = (ev) => { if (dragJustEnded || menuJustClosed()) return; if (editable()) dayMenu(ev.clientX, ev.clientY, c.dataset.kid, c.dataset.day); }; });
  U.$$(".k-bar", g).forEach((b) => { b.onclick = () => { if (dragJustEnded || menuJustClosed()) return; openZut(K.get("zuteilungen", b.dataset.zid)); }; });
  U.$$(".k-code", g).forEach((c) => { c.onclick = (ev) => { if (dragJustEnded || menuJustClosed()) return; if (editable()) codeMenu(ev.clientX, ev.clientY, c.dataset.zid, [c.dataset.day]); }; });
  U.$$(".k-st", g).forEach((b) => {
    b.onclick = (ev) => {
      if (dragJustEnded || menuJustClosed()) return;
      if (b.classList.contains("feiertag")) { toast(`${shortDate(b.dataset.day)}: ${holiday(b.dataset.day)}`, "info", 2500); return; }
      if (b.dataset.aid) { openAbw(K.get("abwesenheiten", b.dataset.aid)); return; }
      if (editable()) dayMenu(ev.clientX, ev.clientY, b.dataset.kid, dayAt(b, ev.clientX, days));
    };
  });
  if (editable()) enableDrag(g, days);

  // Scrollposition wiederherstellen (nach einer Änderung) bzw. zum heutigen Tag
  const sc = card.querySelector(".g-scroll");
  if (keep) { const k0 = keep; keep = null; requestAnimationFrame(() => { sc.scrollLeft = k0.x; window.scrollTo(0, k0.y); }); }
}
// Tag unter dem Zeiger innerhalb eines mehrtägigen Blocks
function dayAt(el, x, days) {
  const cols = [...document.querySelectorAll(".gantt.kon .g-day")];
  const i = cols.findIndex((c) => { const r = c.getBoundingClientRect(); return x >= r.left && x < r.right; });
  return i >= 0 ? days[i] : el.dataset.day;
}

/* ---------- Schnellmenüs ---------- */
// Klick, mit dem ein offenes Menü geschlossen wurde, öffnet nicht gleich etwas Neues
let swallow = false, swallowTimer = 0;
const menuJustClosed = () => { if (!swallow) return false; swallow = false; return true; };
function showMenu(x, y, html, onPick) {
  document.querySelector(".quick-menu")?.remove();
  const menu = U.el(`<div class="quick-menu kon-menu" role="menu">${html}</div>`);
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - r.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - r.height - 8))}px`;
  const close = () => { menu.remove(); document.removeEventListener("pointerdown", outside, true); window.removeEventListener("scroll", close, true); };
  // Klick/Tippen daneben schließt nur das Menü – es öffnet nicht gleich das nächste
  const outside = (ev) => {
    if (!menu.isConnected) { close(); return; } // schon anders geschlossen (z. B. Esc): nur aufräumen
    if (!menu.contains(ev.target)) { swallow = true; clearTimeout(swallowTimer); swallowTimer = setTimeout(() => { swallow = false; }, 700); close(); }
  };
  setTimeout(() => { document.addEventListener("pointerdown", outside, true); window.addEventListener("scroll", close, true); }, 0);
  U.$$("[data-q]", menu).forEach((b) => { b.onclick = () => { close(); onPick(b.dataset.q); }; });
}
// Abwesenheit für einen Tag: an einen direkt angrenzenden Eintrag gleicher Art anhängen, sonst neu
function setDayAbsence(k, day, typ) {
  const isAbs = (a) => a && a.typ === typ;
  const prev = K.absRec(k.id, K.shiftWeekdays(day, -1)), next = K.absRec(k.id, K.shiftWeekdays(day, 1));
  if (isAbs(prev) && isAbs(next) && prev.id !== next.id) { K.put("abwesenheiten", { ...prev, bis: next.bis }); K.remove("abwesenheiten", next.id); }
  else if (isAbs(prev)) K.put("abwesenheiten", { ...prev, bis: day });
  else if (isAbs(next)) K.put("abwesenheiten", { ...next, von: day });
  else K.put("abwesenheiten", { kId: k.id, typ, von: day, bis: day, notiz: "" });
  K.settle();
  toast(`${k.name}: ${K.ABW_TYPES[typ]} am ${longDate(day)}`, "info", 2500);
  changed();
}
function absenceItems(k, day) {
  const info = K.dayInfo(k, day);
  const arb = K.arbeitRec(k.id, day);
  if (info && info.rec) return `<button type="button" data-q="edit">${K.ABW_TYPES[info.typ]} ${h(shortDate(info.rec.von))}–${h(shortDate(info.rec.bis))} bearbeiten …</button>
    <button type="button" data-q="del" class="qm-danger">${K.ABW_TYPES[info.typ]} löschen</button>`;
  return `${info && info.pattern ? `<button type="button" data-q="arbeit">Arbeitstag (Ausnahme)</button>` : ""}
    ${arb ? `<button type="button" data-q="arbeit-weg">Ausnahme „Arbeitstag“ entfernen</button>` : ""}
    <button type="button" data-q="krank">Krank – dieser Tag</button>
    <button type="button" data-q="urlaub">Urlaub – dieser Tag</button>
    <button type="button" data-q="ausgleich">Ausgleich – dieser Tag</button>
    ${k.azubi ? `<button type="button" data-q="schule">Schule – dieser Tag</button>` : ""}
    <button type="button" data-q="range">Abwesenheit mit Zeitraum …</button>`;
}
function absencePick(q, k, day) {
  const info = K.dayInfo(k, day);
  if (q === "edit") return openAbw(info.rec);
  if (q === "del") { if (!confirm(`${K.ABW_TYPES[info.typ]} von ${k.name} (${shortDate(info.rec.von)}–${shortDate(info.rec.bis)}) löschen?`)) return; K.remove("abwesenheiten", info.rec.id); changed(); return; }
  if (q === "range") return openAbw(null, { kId: k.id, von: day, bis: day });
  if (q === "arbeit") { K.put("abwesenheiten", { kId: k.id, typ: "arbeit", von: day, bis: day, notiz: "" }); K.settle(); changed(); return; }
  if (q === "arbeit-weg") { const a = K.arbeitRec(k.id, day); if (a) K.remove("abwesenheiten", a.id); changed(); return; }
  if (K.ABW_TYPES[q]) setDayAbsence(k, day, q);
}
function dayMenu(x, y, kId, day) {
  const k = K.get("konstrukteure", kId);
  if (!k || !day) return;
  const info = K.dayInfo(k, day);
  if (info && info.typ === "feiertag") { toast(`${shortDate(day)}: ${info.name}`, "info", 2500); return; }
  showMenu(x, y, `<div class="qm-head">${h(k.name)} · ${h(wdName(day))} ${h(shortDate(day))}</div>
    ${!info || !info.rec ? `<button type="button" data-q="zut">+ Zuteilung ab hier …</button>` : ""}
    ${absenceItems(k, day)}`, (q) => {
    if (q === "zut") return openZut(null, { kId, von: day });
    absencePick(q, k, day);
  });
}
// Kürzel für einen oder mehrere Tage eines Balkens
function codeMenu(x, y, zid, ds) {
  const z = K.get("zuteilungen", zid);
  if (!z) return;
  const k = K.get("konstrukteure", z.kId);
  const sets = K.artOf(z) === "stahl" ? [["", K.STAHL]] : K.artOf(z) === "roh" ? [["", K.ROH]] : [["Stahlbau", K.STAHL], ["Rohbau", K.ROH]];
  const cur = ds.length === 1 ? (z.codes || {})[ds[0]] || "" : "";
  const when = ds.length === 1 ? `${wdName(ds[0])} ${shortDate(ds[0])}` : `${shortDate(ds[0])}–${shortDate(ds[ds.length - 1])} (${ds.length} Tage)`;
  const any = ds.some((d) => (z.codes || {})[d]);
  showMenu(x, y, `<div class="qm-head">${h(K.bvLabel(z))} · ${h(when)}</div>
    ${sets.map(([title, cs]) => `${title ? `<div class="qm-sub">${title}</div>` : ""}<div class="qm-codes">${cs.map((c) => `<button type="button" data-q="c:${c}" class="${c === cur ? "on" : ""}" title="${h(K.CODE_NAMES[c])}">${c}</button>`).join("")}</div>`).join("")}
    ${any ? `<button type="button" data-q="clear">Kürzel entfernen</button>` : ""}
    <button type="button" data-q="zedit">Zuteilung bearbeiten …</button>
    ${ds.length === 1 && k ? `<div class="qm-sep"></div>${absenceItems(k, ds[0])}` : ""}`, (q) => {
    if (q === "zedit") return openZut(z);
    if (q === "clear" || q.startsWith("c:")) {
      const codes = { ...(z.codes || {}) };
      for (const d of ds) { if (q === "clear") delete codes[d]; else codes[d] = q.slice(2); }
      K.put("zuteilungen", { ...z, codes });
      changed();
      return;
    }
    absencePick(q, k, ds[0]);
  });
}

/* ---------- Ziehen ----------
   Balken: verschieben bzw. an den Griffen Beginn/Ende ändern (Werktage). Kürzel: über mehrere Tage
   ziehen -> Kürzel für alle auf einmal. Freie Tage einer Person: über mehrere Tage ziehen -> neue Zuteilung
   für diesen Zeitraum. Maus: sofort (ab 4 px); Finger: kurz halten (0,35 s), dann ziehen. */
let dragJustEnded = false;
function enableDrag(g, days) {
  let st = null;
  const colAt = (x) => {
    const cols = st.cols;
    if (x < cols[0].left) return 0;
    for (let i = 0; i < cols.length; i++) if (x < cols[i].right) return i;
    return cols.length - 1;
  };
  const markCodes = () => {
    U.$$(".k-code.sel", g).forEach((c) => c.classList.remove("sel"));
    if (st.kind !== "codes") return;
    const [a, b] = st.a <= st.b ? [st.a, st.b] : [st.b, st.a];
    U.$$(`.k-code[data-zid="${CSS.escape(st.zid)}"]`, g).forEach((c) => { const i = days.indexOf(c.dataset.day); if (i >= a && i <= b) c.classList.add("sel"); });
  };
  // neue Zuteilung: markierte Tage in der Zeile der Person
  const markNew = () => {
    U.$$(".k-bg.sel", g).forEach((c) => c.classList.remove("sel"));
    if (!st || st.kind !== "new") return;
    const [a, b] = st.a <= st.b ? [st.a, st.b] : [st.b, st.a];
    U.$$(`.k-bg[data-kid="${CSS.escape(st.kid)}"]`, g).forEach((c) => { const i = days.indexOf(c.dataset.day); if (i >= a && i <= b) c.classList.add("sel"); });
  };
  const begin = (ev) => {
    st.active = true;
    document.body.classList.add("dragging");
    if (st.touch && navigator.vibrate) { try { navigator.vibrate(15); } catch {} }
    if (st.kind === "codes") markCodes(); else if (st.kind === "new") markNew(); else st.bar.classList.add("drag");
  };
  const move = (ev) => {
    if (!st || ev.pointerId !== st.pid) return;
    const dx = ev.clientX - st.x0, dy = ev.clientY - st.y0;
    if (!st.active) {
      if (st.touch) { if (Math.abs(dx) > 8 || Math.abs(dy) > 8) cancel(); return; }
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      begin(ev);
    }
    ev.preventDefault();
    const c = colAt(ev.clientX);
    if (st.kind === "new") { st.b = c; markNew(); return; }
    if (st.kind === "codes") {
      st.b = Math.max(st.s, Math.min(st.e, c));
      markCodes();
      return;
    }
    const delta = c - st.c0;
    let s = st.s, e = st.e;
    if (st.kind === "move") { s += delta; e += delta; }
    else if (st.kind === "start") s = Math.min(st.e, st.s + delta);
    else e = Math.max(st.s, st.e + delta);
    st.delta = delta;
    st.bar.style.gridColumn = `${2 + Math.max(0, s)} / ${3 + Math.min(days.length - 1, e)}`;
    U.$$(`.k-code[data-zid="${CSS.escape(st.zid)}"]`, g).forEach((x) => x.classList.add("ghost"));
  };
  const cancel = () => {
    if (!st) return;
    clearTimeout(st.timer);
    st = null;
    document.body.classList.remove("dragging");
  };
  const end = (ev) => {
    if (!st || ev.pointerId !== st.pid) return;
    const s0 = st;
    clearTimeout(s0.timer);
    st = null;
    document.body.classList.remove("dragging");
    if (!s0.active) return;
    dragJustEnded = true; setTimeout(() => { dragJustEnded = false; }, 50);
    if (s0.kind === "new") {
      U.$$(".k-bg.sel", g).forEach((c) => c.classList.remove("sel"));
      const [a, b] = s0.a <= s0.b ? [s0.a, s0.b] : [s0.b, s0.a];
      if (a === b) dayMenu(ev.clientX, ev.clientY, s0.kid, days[a]); // nur ein Tag: Menü wie beim Antippen
      else openZut(null, { kId: s0.kid, von: days[a], bis: days[b] });
      return;
    }
    if (s0.abw) {
      const a = K.get("abwesenheiten", s0.aid);
      const delta = s0.delta || 0;
      if (!a || !delta) { U.render(); return; }
      let von = a.von, bis = a.bis;
      if (s0.kind === "move") { von = K.shiftWeekdays(K.nextWeekday(a.von), delta); bis = K.shiftWeekdays(K.prevWeekday(a.bis), delta); }
      else if (s0.kind === "start") { von = K.shiftWeekdays(K.nextWeekday(a.von), delta); if (von > a.bis) von = K.prevWeekday(a.bis); }
      else { bis = K.shiftWeekdays(K.prevWeekday(a.bis), delta); if (bis < a.von) bis = K.nextWeekday(a.von); }
      const ov = K.list("abwesenheiten").find((x) => x.id !== a.id && x.kId === a.kId && x.typ !== "arbeit" && x.von <= bis && x.bis >= von);
      if (ov) { toast(`Überschneidet sich mit ${K.ABW_TYPES[ov.typ]} ${shortDate(ov.von)}–${shortDate(ov.bis)}.`, "warn", 4000); U.render(); return; }
      K.put("abwesenheiten", { ...a, von, bis });
      K.settle();
      changed();
      return;
    }
    const z = K.get("zuteilungen", s0.zid);
    if (!z) return;
    if (s0.kind === "codes") {
      const [a, b] = s0.a <= s0.b ? [s0.a, s0.b] : [s0.b, s0.a];
      const k = K.get("konstrukteure", z.kId);
      const ds = days.slice(a, b + 1).filter((d) => !k || !K.dayInfo(k, d));
      if (!ds.length) { U.$$(".k-code.sel", g).forEach((c) => c.classList.remove("sel")); return; }
      codeMenu(ev.clientX, ev.clientY, z.id, ds);
      return;
    }
    const delta = s0.delta || 0;
    if (!delta) { U.render(); return; }
    let next;
    if (s0.kind === "move") {
      const codes = {};
      for (const [d, c] of Object.entries(z.codes || {})) codes[K.shiftWeekdays(d, delta)] = c;
      next = { ...z, von: K.shiftWeekdays(z.von, delta), bis: K.shiftWeekdays(z.bis, delta), codes };
    } else if (s0.kind === "start") {
      const v = K.shiftWeekdays(z.von, delta);
      next = { ...z, von: v > z.bis ? z.bis : v };
    } else {
      const b = K.shiftWeekdays(z.bis, delta);
      next = { ...z, bis: b < z.von ? z.von : b };
    }
    saveZut(next) || U.render();
  };
  g.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    const hd = ev.target.closest(".g-h");
    const bar = ev.target.closest(".k-bar");
    const code = ev.target.closest(".k-code");
    const ab = !bar && !code && ev.target.closest(".k-st[data-aid]");
    if (ab) {
      const cols = [...g.querySelectorAll(".g-day")].map((c) => c.getBoundingClientRect());
      st = { pid: ev.pointerId, x0: ev.clientX, y0: ev.clientY, touch: ev.pointerType !== "mouse", active: false, abw: true, aid: ab.dataset.aid, bar: ab, cols,
        kind: hd ? hd.dataset.h : "move", s: days.indexOf(ab.dataset.day), e: days.indexOf(ab.dataset.end) };
      st.c0 = colAt(ev.clientX);
      if (st.touch) st.timer = setTimeout(() => { if (st && !st.active) begin(ev); }, 350);
      else if (hd) begin(ev);
      return;
    }
    const bg = !bar && !code && ev.target.closest(".k-bg");
    if (bg) {
      const cols = [...g.querySelectorAll(".g-day")].map((c) => c.getBoundingClientRect());
      st = { pid: ev.pointerId, x0: ev.clientX, y0: ev.clientY, touch: ev.pointerType !== "mouse", active: false, kind: "new", kid: bg.dataset.kid, cols };
      st.a = st.b = st.c0 = colAt(ev.clientX);
      if (st.touch) st.timer = setTimeout(() => { if (st && !st.active) begin(ev); }, 350);
      else ev.preventDefault(); // kein Markieren von Text beim Ziehen
      return;
    }
    if (!bar && !code) return;
    const zid = (bar || code).dataset.zid;
    const z = K.get("zuteilungen", zid);
    if (!z) return;
    const cols = [...g.querySelectorAll(".g-day")].map((c) => c.getBoundingClientRect());
    const barEl = bar || g.querySelector(`.k-bar[data-zid="${CSS.escape(zid)}"]`);
    const span = U.$$(`.k-code[data-zid="${CSS.escape(zid)}"]`, g).map((c) => days.indexOf(c.dataset.day));
    st = { pid: ev.pointerId, x0: ev.clientX, y0: ev.clientY, touch: ev.pointerType !== "mouse", active: false, zid, bar: barEl, cols,
      kind: code ? "codes" : hd ? hd.dataset.h : "move", s: Math.min(...span), e: Math.max(...span) };
    st.c0 = colAt(ev.clientX);
    st.a = st.b = st.c0;
    if (st.touch) st.timer = setTimeout(() => { if (st && !st.active) begin(ev); }, 350);
    else if (hd) begin(ev);
  });
  g.addEventListener("pointermove", move);
  g.addEventListener("pointerup", end);
  g.addEventListener("pointercancel", () => cancel());
  // Finger: während des Ziehens nicht scrollen
  g.addEventListener("touchmove", (ev) => { if (st && st.active) ev.preventDefault(); }, { passive: false });
  g.addEventListener("contextmenu", (ev) => { if (st) ev.preventDefault(); });
}

/* =========================================================
   Dialoge
========================================================= */
function personSelect(cur, cls = "f-k") {
  return `<select class="${cls}"><option value="">– bitte wählen –</option>${K.sortedKonstrukteure().map((k) => `<option value="${h(k.id)}" ${k.id === cur ? "selected" : ""}>${h(k.name)}${k.azubi ? " (Azubi)" : ""}</option>`).join("")}</select>`;
}
// Speichern einer Zuteilung mit Prüfung auf Überschneidung (ein BV je Person und Tag)
function saveZut(rec) {
  const von = K.nextWeekday(rec.von), bis = K.prevWeekday(rec.bis);
  if (bis < von) { toast("Der Zeitraum enthält keinen Werktag (Mo–Fr).", "warn"); return false; }
  const next = { ...rec, von, bis };
  const codes = {};
  for (const [d, c] of Object.entries(next.codes || {})) if (d >= von && d <= bis) codes[d] = c;
  next.codes = codes;
  const ov = K.overlaps(next);
  if (ov.length && !confirm(`${(K.get("konstrukteure", next.kId) || {}).name || "Die Person"} ist an diesen Tagen schon eingeteilt:\n\n${K.overlapText(ov)}\n\nTrotzdem übernehmen?\nDie andere Zuteilung wird an diesen Tagen gekürzt.`)) return false;
  K.put("zuteilungen", next);
  K.settle();
  changed();
  return true;
}
export function openZut(z, preset = {}) {
  const isNew = !z;
  const t = K.today();
  const v0 = K.nextWeekday(preset.von || t);
  const cur = z ? { ...z } : { id: null, kId: preset.kId || "", bvNumber: preset.bvNumber || "", baustelle: preset.baustelle || "", von: v0, bis: preset.bis || addDays(mondayOf(v0), 4), text: "", codes: {} };
  const ro = !editable();
  const body = U.el(`<div class="mon-form">
    <label class="field-label">Konstrukteur</label>${personSelect(cur.kId)}</div>`);
  const site = siteField({ bvNumber: cur.bvNumber, baustelle: cur.baustelle }, editable());
  body.appendChild(site.box);
  body.appendChild(U.el(`<div><div class="grid2 tight"><div><label class="field-label">von</label><input type="date" class="f-von" value="${h(cur.von)}" /></div>
    <div><label class="field-label">bis</label><input type="date" class="f-bis" value="${h(cur.bis)}" /></div></div>
    <label class="field-label">Abschnitt (optional)</label><input type="text" class="f-text" maxlength="120" value="${h(cur.text || "")}" placeholder="z. B. Halle, Bühne, Carport" />
    <p class="muted small-note">${isNew ? "Der Balken ist zunächst ein weißer Platzhalter. Die Kürzel (U, W, A, V, M, D bzw. B, F, S) trägst du danach in der Planung je Tag ein." : `Kürzel: ${Object.keys(cur.codes || {}).length ? h(Object.entries(cur.codes).sort().map(([d, c]) => `${shortDate(d)} ${c}`).join(" · ")) : "noch keine (Platzhalter)"}`}</p></div>`));
  if (ro) U.$$("input,select,textarea", body).forEach((x) => { x.disabled = true; });
  const save = () => {
    const kId = body.querySelector(".f-k").value;
    const s = site.value();
    const von = body.querySelector(".f-von").value, bis = body.querySelector(".f-bis").value;
    if (!kId) { toast("Bitte den Konstrukteur wählen.", "warn"); return false; }
    if (!s.bvNumber && !s.baustelle) { toast("Bitte das Bauvorhaben angeben.", "warn"); return false; }
    if (!von || !bis || bis < von) { toast("Bitte einen gültigen Zeitraum angeben (bis ≥ von).", "warn"); return false; }
    // gleiche Person, anderes Datum: Kürzel bleiben an ihren Tagen (außerhalb entfallen sie)
    return saveZut({ ...cur, kId, bvNumber: s.bvNumber, baustelle: s.baustelle, von, bis, text: body.querySelector(".f-text").value.trim() }) !== false;
  };
  const actions = ro ? [{ label: "Schließen", fn: () => {} }] : [
    ...(isNew ? [] : [{ label: "Löschen", cls: "danger-outline", fn: () => { if (!confirm(`Zuteilung ${K.bvLabel(cur)} löschen?`)) return false; K.remove("zuteilungen", cur.id); changed(); } }]),
    { label: "Abbrechen", fn: () => {} },
    { label: isNew ? "Anlegen" : "Speichern", cls: "primary", fn: () => (save() ? undefined : false) },
  ];
  modal(isNew ? "Neue Zuteilung" : "Zuteilung", body, actions);
}

export function openAbw(a, preset = {}) {
  const isNew = !a;
  const t = K.today();
  const cur = a ? { ...a } : { id: null, kId: preset.kId || "", typ: preset.typ || "urlaub", von: preset.von || t, bis: preset.bis || preset.von || t, notiz: "" };
  const ro = !editable();
  const body = U.el(`<div class="mon-form">
    <label class="field-label">Person</label>${personSelect(cur.kId)}
    <label class="field-label">Art</label><div class="seg abw-seg" role="group"></div>
    <div class="grid2 tight"><div><label class="field-label">von</label><input type="date" class="f-von" value="${h(cur.von)}" /></div>
    <div><label class="field-label">bis</label><input type="date" class="f-bis" value="${h(cur.bis)}" /></div></div>
    <label class="field-label">Notiz</label><input type="text" class="f-notiz" value="${h(cur.notiz || "")}" placeholder="optional" /></div>`);
  const sel = body.querySelector(".f-k"), seg = body.querySelector(".abw-seg");
  let typ = cur.typ;
  const drawSeg = () => {
    const k = K.get("konstrukteure", sel.value);
    const types = Object.entries(K.ABW_TYPES).filter(([x]) => x !== "schule" || (k && k.azubi) || typ === "schule");
    if (!types.some(([x]) => x === typ)) typ = "urlaub";
    seg.innerHTML = types.map(([x, l]) => `<button type="button" data-typ="${x}" class="${typ === x ? "on" : ""}" ${x === "ausgleich" ? 'title="Überstundenabbau"' : ""}>${l}</button>`).join("");
    U.$$("[data-typ]", seg).forEach((b) => { b.onclick = () => { typ = b.dataset.typ; drawSeg(); }; });
  };
  sel.onchange = drawSeg;
  drawSeg();
  if (ro) U.$$("input,select,button", body).forEach((x) => { x.disabled = true; });
  const save = () => {
    const kId = sel.value;
    const von = body.querySelector(".f-von").value, bis = body.querySelector(".f-bis").value;
    if (!kId) { toast("Bitte die Person wählen.", "warn"); return false; }
    if (!von || !bis || bis < von) { toast("Bitte einen gültigen Zeitraum angeben (bis ≥ von).", "warn"); return false; }
    const ov = K.list("abwesenheiten").find((x) => x.id !== cur.id && x.kId === kId && x.typ !== "arbeit" && x.von <= bis && x.bis >= von);
    if (ov) { toast(`Überschneidet sich mit ${K.ABW_TYPES[ov.typ]} ${shortDate(ov.von)}–${shortDate(ov.bis)}.`, "warn", 5000); return false; }
    K.put("abwesenheiten", { ...cur, kId, typ, von, bis, notiz: body.querySelector(".f-notiz").value.trim() });
    K.settle();
    changed();
  };
  const actions = ro ? [{ label: "Schließen", fn: () => {} }] : [
    ...(isNew ? [] : [{ label: "Löschen", cls: "danger-outline", fn: () => { if (!confirm("Eintrag löschen?")) return false; K.remove("abwesenheiten", cur.id); changed(); } }]),
    { label: "Abbrechen", fn: () => {} },
    { label: isNew ? "Eintragen" : "Speichern", cls: "primary", fn: save },
  ];
  modal(isNew ? "Abwesenheit eintragen" : "Abwesenheit", body, actions);
}

// Betriebsurlaub: Zeitraum für mehrere Konstrukteure auf einmal (je Person ein normaler Urlaub)
function openBetriebsurlaub() {
  const people = K.sortedKonstrukteure();
  if (!people.length) { toast("Noch keine Konstrukteure angelegt.", "info"); return; }
  const t = K.today();
  const body = U.el(`<div class="mon-form">
    <div class="grid2 tight"><div><label class="field-label">von</label><input type="date" class="f-von" value="${h(t)}" /></div>
    <div><label class="field-label">bis</label><input type="date" class="f-bis" value="${h(t)}" /></div></div>
    <label class="field-label">Für</label>
    <div class="chips bu-chips">${people.map((k) => `<button type="button" class="chip on" data-id="${h(k.id)}">${h(k.name)}</button>`).join("")}</div>
    <p class="muted small-note">Je Person entsteht ein normaler Urlaub, der danach einzeln geändert werden kann. Tage, an denen schon eine Abwesenheit eingetragen ist (z. B. krank), bleiben unverändert.</p></div>`);
  U.$$(".bu-chips .chip", body).forEach((c) => { c.onclick = () => c.classList.toggle("on"); });
  modal("Betriebsurlaub", body, [
    { label: "Abbrechen", fn: () => {} },
    { label: "Eintragen", cls: "primary", fn: () => {
      const von = body.querySelector(".f-von").value, bis = body.querySelector(".f-bis").value;
      const ids = U.$$(".bu-chips .chip.on", body).map((c) => c.dataset.id);
      if (!von || !bis || bis < von) { toast("Bitte einen gültigen Zeitraum angeben (bis ≥ von).", "warn"); return false; }
      if (!ids.length) { toast("Bitte mindestens eine Person wählen.", "warn"); return false; }
      // je Person nur die Tage ohne bestehende Abwesenheit
      let n = 0;
      for (const kId of ids) {
        let run = null;
        const flush = () => { if (run) { K.put("abwesenheiten", { kId, typ: "urlaub", von: run[0], bis: run[1], notiz: "Betriebsurlaub" }); n++; run = null; } };
        for (let d = von; d <= bis; d = addDays(d, 1)) {
          const a = K.absRec(kId, d);
          if (a && a.typ !== "arbeit") flush();
          else if (run) run[1] = d; else run = [d, d];
        }
        flush();
      }
      K.settle();
      toast(`Betriebsurlaub für ${ids.length} Person(en) eingetragen.`, "info", 3000);
      changed();
    } },
  ]);
}

/* ---------- Rhythmus (Schultage / Teilzeit-freie Tage) ---------- */
const WDN = ["Mo", "Di", "Mi", "Do", "Fr"];
function rhythmEditor(r0) {
  const t = K.today();
  const thisMo = mondayOf(t), nextMo = addDays(thisMo, 7);
  const r = { w2: !!(r0 && r0.w2), a: [...((r0 && r0.a) || [])], b: [...((r0 && r0.b) || [])], ref: (r0 && r0.ref) || thisMo };
  // ist diese Woche Woche A?
  const thisIsA = () => { const w = Math.round((parseDay(thisMo) - parseDay(mondayOf(r.ref))) / (7 * 86400000)); return ((w % 2) + 2) % 2 === 0; };
  const box = U.el(`<div class="rh-box"></div>`);
  const draw = () => {
    const row = (key, label) => `<div class="rh-row"><span class="rh-l">${label}</span>${WDN.map((n, i) => `<button type="button" class="chip ${r[key].includes(i + 1) ? "on" : ""}" data-w="${key}" data-d="${i + 1}">${n}</button>`).join("")}</div>`;
    box.innerHTML = `<div class="seg rh-seg" role="group"><button type="button" data-m="1" class="${!r.w2 ? "on" : ""}">jede Woche</button><button type="button" data-m="2" class="${r.w2 ? "on" : ""}">14-tägig</button></div>
      ${row("a", r.w2 ? "Woche A" : "Tage")}${r.w2 ? row("b", "Woche B") : ""}
      ${r.w2 ? `<label class="field-label">Woche A ist</label><select class="rh-ref"><option value="this" ${thisIsA() ? "selected" : ""}>diese Woche (KW ${isoWeek(thisMo)})</option><option value="next" ${!thisIsA() ? "selected" : ""}>nächste Woche (KW ${isoWeek(nextMo)})</option></select>` : ""}`;
    U.$$("[data-m]", box).forEach((b) => { b.onclick = () => { r.w2 = b.dataset.m === "2"; draw(); }; });
    U.$$("[data-w]", box).forEach((b) => { b.onclick = () => { const xs = r[b.dataset.w], d = Number(b.dataset.d); const i = xs.indexOf(d); i >= 0 ? xs.splice(i, 1) : xs.push(d); draw(); }; });
    const ref = box.querySelector(".rh-ref");
    if (ref) ref.onchange = () => { r.ref = ref.value === "this" ? thisMo : nextMo; };
  };
  draw();
  return { box, value: () => ({ w2: r.w2, a: r.a.slice().sort(), b: r.w2 ? r.b.slice().sort() : [], ref: r.ref }) };
}

function editPerson(k) {
  const isNew = !k;
  const cur = k ? { ...k } : { name: "", aktiv: true, azubi: false, teilzeit: false, schule: null, frei: null };
  const body = U.el(`<div class="mon-form">
    <label class="field-label">Name</label><input type="text" class="f-name" maxlength="80" value="${h(cur.name)}" autocomplete="off" />
    <label class="opt-row"><input type="checkbox" class="f-azubi" ${cur.azubi ? "checked" : ""}> <span>Azubi (Kennzeichen A) – mit Schultagen</span></label>
    <div class="f-schule-box"><label class="field-label">Schultage</label></div>
    <label class="opt-row"><input type="checkbox" class="f-tz" ${cur.teilzeit ? "checked" : ""}> <span>Teilzeit (Kennzeichen T) – mit freien Tagen</span></label>
    <div class="f-frei-box"><label class="field-label">Freie Tage</label></div>
    <p class="muted small-note">Einzelne Tage lassen sich in der Planung ändern (z. B. krank, Urlaub, Ausgleich oder ausnahmsweise Arbeitstag).</p></div>`);
  const sch = rhythmEditor(cur.schule), fr = rhythmEditor(cur.frei);
  body.querySelector(".f-schule-box").appendChild(sch.box);
  body.querySelector(".f-frei-box").appendChild(fr.box);
  const az = body.querySelector(".f-azubi"), tz = body.querySelector(".f-tz");
  const upd = () => { body.querySelector(".f-schule-box").hidden = !az.checked; body.querySelector(".f-frei-box").hidden = !tz.checked; };
  az.onchange = upd; tz.onchange = upd; upd();
  const nameEl = body.querySelector(".f-name");
  const save = () => {
    const name = nameEl.value.trim();
    if (!name) { toast("Bitte einen Namen eingeben.", "warn"); nameEl.focus(); return false; }
    if (K.list("konstrukteure").some((x) => x.id !== cur.id && x.name.toLowerCase() === name.toLowerCase())) { toast(`${name} gibt es schon.`, "warn"); return false; }
    K.put("konstrukteure", { ...cur, name, azubi: az.checked, schule: sch.value(), teilzeit: tz.checked, frei: fr.value() });
    changed();
  };
  modal(isNew ? "Konstrukteur anlegen" : "Konstrukteur", body, [
    ...(isNew ? [] : [{ label: "Löschen", cls: "danger-outline", fn: () => {
      const u = K.personUsage(cur.id);
      if (!confirm(`${cur.name} löschen?${u.zut ? `\n\n${u.zut} Zuteilung(en)` : ""}${u.abw ? `\n${u.abw} Abwesenheit(en)` : ""}${u.zut || u.abw ? "\nwerden ebenfalls gelöscht." : ""}`)) return false;
      K.removePerson(cur.id); changed();
    } }]),
    { label: "Abbrechen", fn: () => {} },
    { label: isNew ? "Anlegen" : "Speichern", cls: "primary", fn: save },
  ]);
  setTimeout(() => { if (isNew) nameEl.focus(); }, 50);
}

/* =========================================================
   Personal
========================================================= */
export function renderKonPersonal(app) {
  const ro = !editable();
  const t = K.today();
  app.appendChild(U.el(`<div class="page-head"><h1>Personal</h1>${ro ? "" : `<button class="primary" id="konPNew" type="button">+ Neu</button>`}</div>`));
  const pn = U.$("#konPNew"); if (pn) pn.onclick = () => editPerson(null);
  // Abwesenheit: laufende und kommende (plus die letzten 14 Tage) – Darstellung wie BauMon
  const abw = K.list("abwesenheiten").filter((a) => a.typ !== "arbeit" && a.bis >= addDays(t, -14) && K.get("konstrukteure", a.kId)).sort((a, b) => a.von.localeCompare(b.von));
  const aCard = U.el(`<div class="card list-card"><div class="card-head"><h3 class="section-title">Abwesenheit</h3>${ro ? "" : `<div class="row"><button type="button" class="secondary small" id="konBU">Betriebsurlaub</button><button type="button" class="secondary small" id="konAbwNew">+ Abwesenheit</button></div>`}</div>
    ${abw.map((a) => `<button type="button" class="mon-brow ${a.von <= t && a.bis >= t ? "now" : ""}" data-aid="${h(a.id)}"><span class="mon-brow-main"><b>${h(K.get("konstrukteure", a.kId).name)}</b> · <span class="abw-tag ${a.typ}">${K.ABW_TYPES[a.typ]}</span></span>
      <span class="muted">${h(wdName(a.von))} ${h(shortDate(a.von))} – ${h(wdName(a.bis))} ${h(shortDate(a.bis))}${a.notiz ? " · " + h(a.notiz) : ""}${a.bis < t ? " · vorbei" : ""}</span></button>`).join("") || `<p class="muted">Niemand abwesend eingetragen.</p>`}</div>`);
  app.appendChild(aCard);
  const an = aCard.querySelector("#konAbwNew"); if (an) an.onclick = () => openAbw(null);
  const bu = aCard.querySelector("#konBU"); if (bu) bu.onclick = () => openBetriebsurlaub();
  U.$$("[data-aid]", aCard).forEach((b) => { b.onclick = () => openAbw(K.get("abwesenheiten", b.dataset.aid)); });
  // Konstrukteure
  const ps = K.sortedKonstrukteure();
  const pCard = U.el(`<div class="card list-card"><div class="card-head"><h3 class="section-title">Konstrukteure (${ps.length})</h3></div>
    ${ps.map((k) => `<button type="button" class="mon-brow" data-kid="${h(k.id)}"><span class="mon-brow-main"><b>${h(k.name)}</b>${k.azubi ? ' <span class="p-badge">A</span>' : ""}${k.teilzeit ? ' <span class="p-badge">T</span>' : ""}</span>
      <span class="muted">${[k.azubi && K.rhythmText(k.schule) ? "Schule: " + K.rhythmText(k.schule) : "", k.teilzeit && K.rhythmText(k.frei) ? "frei: " + K.rhythmText(k.frei) : ""].filter(Boolean).map(h).join(" · ") || (k.azubi ? "Azubi" : k.teilzeit ? "Teilzeit" : "")}</span></button>`).join("") || `<p class="muted">Noch keine Konstrukteure.</p>`}</div>`);
  app.appendChild(pCard);
  U.$$("[data-kid]", pCard).forEach((b) => { b.onclick = () => { if (ro) return; editPerson(K.get("konstrukteure", b.dataset.kid)); }; });
}

/* =========================================================
   PDF
========================================================= */
function openKonPdf() {
  const cur = mondayOf(K.today());
  const weeks = Array.from({ length: 31 }, (_, i) => addDays(cur, (i - 10) * 7));
  const yr = cur.slice(0, 4);
  const label = (mo) => { const fr = addDays(mo, 4); return `KW ${isoWeek(mo)} · ${shortDate(mo)}–${shortDate(fr)}${fr.slice(0, 4) !== yr ? fr.slice(0, 4) : ""}${mo === cur ? " (aktuell)" : ""}`; };
  const opts = (sel) => weeks.map((mo) => `<option value="${mo}" ${mo === sel ? "selected" : ""}>${h(label(mo))}</option>`).join("");
  const body = U.el(`<div class="mon-form">
    <div class="grid2"><div><label class="field-label">von KW</label><select class="f-from">${opts(cur)}</select></div>
    <div><label class="field-label">bis KW</label><select class="f-to">${opts(addDays(cur, 28))}</select></div></div>
    <p class="muted pdf-range-info"></p></div>`);
  const from = body.querySelector(".f-from"), to = body.querySelector(".f-to"), info = body.querySelector(".pdf-range-info");
  const upd = () => {
    const minTo = addDays(from.value, 14), maxTo = addDays(from.value, 42);
    for (const o of to.options) o.disabled = o.value < minTo || o.value > maxTo;
    if (to.value < minTo) to.value = minTo;
    if (to.value > maxTo) to.value = maxTo;
    const n = Math.round((parseDay(to.value) - parseDay(from.value)) / (7 * 86400000)) + 1;
    info.textContent = `${n} Wochen · A3 quer (3 bis 7 Wochen möglich).`;
    return n;
  };
  from.onchange = upd; to.onchange = upd; upd();
  modal("Planung als PDF", body, [
    { label: "Abbrechen", fn: () => {} },
    { label: "PDF erstellen", cls: "primary", fn: () => {
      const n = upd();
      (async () => {
        U.busy("PDF wird erstellt …");
        try {
          const { blob, filename } = await buildKonPdf({ start: from.value, weeks: n });
          U.busy(null);
          const stored = await U.storeKonPdf(blob, filename);
          U.openPdf(blob, filename, "Einteilung Konstruktion", stored);
        } catch (e) {
          U.busy(null);
          toast("PDF konnte nicht erstellt werden: " + (e.message || e), "error", 8000);
        }
      })();
    } },
  ]);
}

/* =========================================================
   Suche, Karte
========================================================= */
export function searchKon(words) {
  const hit = (s) => { const t = String(s || "").toLowerCase(); return words.every((w) => t.includes(w)); };
  const t = K.today();
  const name = (id) => (K.get("konstrukteure", id) || {}).name || "";
  const byTime = (a, b) => ((a.bis >= t) === (b.bis >= t) ? (a.bis >= t ? a.von.localeCompare(b.von) : b.von.localeCompare(a.von)) : a.bis >= t ? -1 : 1);
  const zs = K.list("zuteilungen").filter((z) => hit(`${K.bvLabel(z)} ${z.text || ""} ${name(z.kId)}`)).sort(byTime);
  return [
    { title: "Konstruktion", items: zs.map((z) => ({ label: K.bvLabel(z) + (z.text ? ` · ${z.text}` : ""), sub: `${name(z.kId)} · ${shortDate(z.von)}–${shortDate(z.bis)}`, tag: z.bis < t ? "vorbei" : z.von <= t ? "läuft" : "", kind: "kzut", id: z.id })) },
    { title: "Konstrukteure", items: K.sortedKonstrukteure().filter((k) => hit(k.name)).map((k) => ({ label: k.name, sub: [k.azubi ? "Azubi" : "", k.teilzeit ? "Teilzeit" : ""].filter(Boolean).join(" · ") || "Konstrukteur", kind: "kperson", id: k.id })) },
  ];
}
function showWeekOf(day, bv) {
  weekOffset = Math.round((parseDay(mondayOf(day)) - parseDay(mondayOf(K.today()))) / (7 * 86400000));
  flashBv = bv || null;
}
export function openKonHit(kind, id) {
  if (kind === "kzut") {
    const z = K.get("zuteilungen", id);
    if (!z) return;
    const t = K.today();
    showWeekOf(z.von <= t && z.bis >= t ? t : z.von, z.bvNumber);
    U.go({ sparte: "kon", view: "konplan", selectedProjectId: null, selectedDocId: null });
  } else if (kind === "kperson") {
    U.go({ sparte: "kon", view: "konpersonal", selectedProjectId: null, selectedDocId: null });
    const k = K.get("konstrukteure", id);
    if (k && editable()) setTimeout(() => editPerson(k), 0);
  }
}
// Karte: BV in BauKon öffnen – laufende/nächste Zuteilung zeigen, sonst neue Zuteilung anlegen
export function openBVinKon(bvNumber, title) {
  const t = K.today();
  const zs = K.list("zuteilungen").filter((z) => z.bvNumber === bvNumber);
  const pick = zs.filter((z) => z.bis >= t).sort((a, b) => a.von.localeCompare(b.von))[0] || zs.sort((a, b) => b.bis.localeCompare(a.bis))[0];
  if (pick) {
    showWeekOf(pick.von <= t ? t : pick.von, bvNumber);
    U.go({ sparte: "kon", view: "konplan", selectedProjectId: null, selectedDocId: null });
    return;
  }
  weekOffset = 0;
  U.go({ sparte: "kon", view: "konplan", selectedProjectId: null, selectedDocId: null });
  if (editable()) setTimeout(() => openZut(null, { bvNumber, baustelle: title || "", von: K.nextWeekday(t) }), 0);
  else toast("Für dieses BV ist keine Konstruktion eingeteilt.", "info", 3500);
}
export function konInfo(bvNumber) {
  const t = K.today();
  const zs = K.list("zuteilungen").filter((z) => z.bvNumber === bvNumber && z.bis >= t);
  if (!zs.length) return null;
  const names = [...new Set(zs.map((z) => (K.get("konstrukteure", z.kId) || {}).name).filter(Boolean))];
  return { text: `Konstruktion: ${names.join(", ")}` };
}
