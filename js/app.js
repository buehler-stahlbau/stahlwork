/* =========================================================
   BauDoc – Oberfläche
   Läuft als App (Home-Bildschirm) und im Browser.
========================================================= */
import { CONFIG, APP_VERSION, SPARTEN } from "./config.js";
import * as db from "./db.js";
import * as od from "./onedrive.js";
import * as sync from "./sync.js";
import {
  S, load, saveNow, saveSoon, touchProject, touchDoc, onChange,
  findProject, findByNumber, newProject, moveLocal, removeProjectLocal,
  allProjects, imagesOfDoc, imagesOfProject, favoritesChanged, resetLocal, setTitleParts,
  touchEntry, touchMeta, touchAttendee, deleteEntry, deleteAttendee,
  newProtocol, CONTRACTOR_COMPANY, renumberProject,
} from "./store.js";
import { captureSignature } from "./signature.js";
import { captureFromWebcam, hasWebcam, isMobileDevice } from "./camera.js";
import { contentCode, sigValid, validSignatures, normalizeCode, isSafeSig } from "./integrity.js";
import { searchPlaces, geoValid, loadLeaflet, TILE_URL, TILE_ATTRIBUTION } from "./geo.js";
import { processFile, makeThumb } from "./images.js";
import { buildPdf, PDF_MAX_BYTES } from "./pdf.js";
import { exportBackup, importBackup } from "./backup.js";
import { escapeHtml as h, formatDateDE, formatDateTimeDE, newId, toast } from "./util.js";
import { initMonUI, renderMonStart, renderMonPlan, renderMonBuehnen, renderMonStamm, monSettingsCard } from "./baumon-ui.js";
import { dueBuehnen } from "./baumon.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isTouch = window.matchMedia("(pointer: coarse)").matches;
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

/* ---------- Flüchtige UI-Daten (nicht gespeichert) ---------- */
// Entwürfe "Neuer Eintrag" (noch nicht gespeichert) – werden mit dem Zustand gesichert,
// damit Text und Fotos auch beim Schließen der App nicht verloren gehen
let drafts = {};      // docId -> Text
let draftImgs = {};   // docId -> [imageId]
let filterText = "";
let addOpen = false;
let justAdded = null; // frisch angelegtes BV kurz hervorheben
let pendingRender = false;
let deferredInstall = null;
const loadingProjects = new Set();

/* ---------- Fortschritt ---------- */
function setBusy(msg) {
  const b = $("#busy");
  if (!msg) { b.style.display = "none"; return; }
  b.textContent = msg;
  b.style.display = "block";
}

/* ---------- Fehler sichtbar machen ---------- */
window.addEventListener("error", (e) => {
  toast("Fehler: " + (e.message || "unbekannt"), "error", 8000);
});
window.addEventListener("unhandledrejection", (e) => {
  const r = e.reason;
  toast("Fehler: " + ((r && r.message) || r || "unbekannt"), "error", 8000);
});

/* =========================================================
   Navigation (mit Zurück-Taste von Handy und Browser)
========================================================= */
function navState() {
  const st = S.state;
  return { view: st.view, pid: st.selectedProjectId, did: st.selectedDocId, sp: st.sparte };
}

function go(changes, { replace = false, scroll = true } = {}) {
  const opening = changes.selectedProjectId && changes.selectedProjectId !== S.state.selectedProjectId;
  Object.assign(S.state, changes);
  if (opening) sync.schedule(100); // beim Öffnen neuesten Stand holen
  saveSoon();
  try {
    if (replace) history.replaceState(navState(), "");
    else history.pushState(navState(), "");
  } catch {}
  render();
  if (scroll) window.scrollTo(0, 0);
}

window.addEventListener("popstate", (e) => {
  const s = e.state;
  if (!s) return;
  closeDrawer();
  S.state.sparte = s.sp === "mon" ? "mon" : "doc";
  S.state.view = s.view || (S.state.sparte === "mon" ? "mon" : "projects");
  S.state.selectedProjectId = s.pid || null;
  S.state.selectedDocId = s.did || null;
  saveSoon();
  render();
});

function ctx() {
  const st = S.state;
  const p = st.selectedProjectId ? findProject(st.selectedProjectId) : null;
  const d = p && p.docs && st.selectedDocId ? p.docs.find((x) => x.id === st.selectedDocId) || null : null;
  return { p, d };
}

/* =========================================================
   Vorschaubilder
========================================================= */
const thumbUrls = new Map();

async function thumbUrl(id, rid) {
  if (thumbUrls.has(id)) return thumbUrls.get(id);
  let rec = null;
  try { rec = await db.imgGet(id); } catch {}
  let blob = rec && rec.thumb;
  if (!blob && rec && rec.archive) {
    try {
      blob = await makeThumb(rec.archive);
      await db.imgPut({ ...rec, thumb: blob });
    } catch {}
  }
  if (!blob && rid && od.isSignedIn() && navigator.onLine) {
    try {
      const t = await od.thumbnail(rid);
      if (t.blob) {
        blob = t.blob;
        await db.imgPut({ ...(rec || { id }), thumb: blob });
      } else if (t.url) {
        thumbUrls.set(id, t.url);
        return t.url;
      }
    } catch (e) { console.warn("Vorschau", e); }
  }
  if (!blob) return null;
  const u = URL.createObjectURL(blob);
  thumbUrls.set(id, u);
  return u;
}

function hydrateThumbs(root) {
  $$("img[data-img-id]", root).forEach(async (im) => {
    const u = await thumbUrl(im.dataset.imgId, im.dataset.rid || null);
    if (u) im.src = u;
    else im.classList.add("missing");
  });
}

function thumbHtml(img, deletable = true) {
  return `
    <div class="image-wrapper">
      <img data-img-id="${h(img.id)}" data-rid="${h(img.rid || "")}" alt="Foto" />
      ${img.rid || !od.isConfigured() ? "" : `<span class="img-pending" title="Noch nicht hochgeladen">⏳</span>`}
      ${deletable ? `<button class="img-delete" data-del-img="${h(img.id)}" type="button" aria-label="Foto löschen">×</button>` : ""}
    </div>`;
}

// Foto-Knöpfe: Kamera (direkt) + Mediathek/Dateien
function cameraButton(cls, small) {
  if (isMobileDevice) {
    return `<label class="file-btn ${small ? "small" : ""}"><svg class="ico ico-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/></svg> Kamera
        <input class="${cls}" type="file" accept="image/*" capture="environment" />
      </label>`;
  }
  if (hasWebcam()) {
    return `<button class="file-btn ${small ? "small" : ""}" data-cam="${cls}" type="button"><svg class="ico ico-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/></svg> Kamera</button>`;
  }
  return "";
}

function photoButtons(cls, small = false) {
  return `
    <div class="photo-btns">
      ${cameraButton(cls, small)}
      <label class="file-btn ${small ? "small" : ""}"><svg class="ico ico-sm" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg> ${isTouch ? "Fotos" : "Fotos hinzufügen"}
        <input class="${cls}" type="file" accept="image/*" multiple />
      </label>
    </div>`;
}

/* ---------- Großansicht ---------- */
async function openViewer(id, rid) {
  const modal = $("#imgModal");
  const im = $("#imgModalImg");
  im.src = (await thumbUrl(id, rid)) || "";
  modal.style.display = "flex";
  const close = () => { modal.style.display = "none"; im.src = ""; };
  modal.onclick = close;
  try {
    const rec = await db.imgGet(id);
    let blob = rec && rec.archive;
    if (!blob && rid && od.isSignedIn() && navigator.onLine) blob = await od.downloadBlob(rid);
    if (blob && modal.style.display !== "none") {
      const u = URL.createObjectURL(blob);
      im.onload = () => setTimeout(() => URL.revokeObjectURL(u), 1000);
      im.src = u;
    }
  } catch (e) { console.warn(e); }
}

/* =========================================================
   Render
========================================================= */
// Nicht neu zeichnen, während jemand im Inhalt tippt
function requestRender() {
  const a = document.activeElement;
  if (a && a.closest && a.closest("#app") && (a.tagName === "TEXTAREA" || (a.tagName === "INPUT" && a.type !== "file"))) {
    pendingRender = true;
    return;
  }
  render();
}
document.addEventListener("focusout", () => {
  if (!pendingRender) return;
  setTimeout(() => {
    if (!pendingRender) return;
    pendingRender = false;
    requestRender();
  }, 400);
});

// Nach bewusster Aktion (z. B. Fotos gewählt): sofort neu zeichnen.
// Eingetippte Texte sind bereits gespeichert, es geht nichts verloren.
function renderNow() {
  const a = document.activeElement;
  if (a && a.blur && a !== document.body && !a.closest(".appbar")) a.blur();
  render();
}

// Anmeldepflicht: BauDoc ist nur nach Anmeldung mit einem Bühler-Konto nutzbar.
// Nach der ersten Anmeldung bleibt das Konto auf dem Gerät gespeichert -> auch offline nutzbar.
function isLocked() {
  return od.isConfigured() && !od.getAccount();
}

let loginError = "";

function renderLogin(app) {
  const offline = !navigator.onLine;
  app.appendChild(el(`
    <div class="login-wrap">
      <div class="card login-card">
        <img class="login-logo" src="logo.png" alt="Bühler Stahlbau" />
        <h1>Stahlwork</h1>
        <p class="muted">Anwendung der Friedrich Bühler GmbH &amp; Co. KG</p>
        <p>Bitte mit dem <strong>Bühler-Firmenkonto</strong> anmelden.</p>
        <button class="primary block" id="loginGate" type="button" ${offline ? "disabled" : ""}>Mit Microsoft anmelden</button>
        ${offline ? `<p class="muted">Für die erste Anmeldung wird eine Internetverbindung benötigt.</p>` : ""}
        ${loginError ? `<p class="error-text">${h(loginError)}</p>` : ""}
        <p class="muted login-hint">Nach der Anmeldung funktioniert Stahlwork auf diesem Gerät auch ohne Netz.</p>
      </div>
    </div>`));
  const b = $("#loginGate");
  if (b) b.onclick = () => od.login();
}

function render() {
  try { renderInner(); }
  catch (e) {
    console.error("Anzeige", e);
    const app = $("#app");
    if (app) {
      app.innerHTML = `<div class="card boot-fail"><h3>Anzeige fehlgeschlagen</h3><p class="muted">Deine Daten bleiben erhalten.</p>
        <button class="primary" type="button" id="renderRepair">Neu laden</button><p class="muted" style="margin-top:10px;font-size:.75rem">${h(e && e.message || e)}</p></div>`;
      $("#renderRepair").onclick = () => (window.__bootRepair ? window.__bootRepair() : location.reload());
    }
  }
}

function renderInner() {
  pendingRender = false;
  const prevView = currentRenderedView;
  currentRenderedView = S.state.view;
  lastRenderedView = prevView;
  const locked = isLocked();
  document.body.classList.toggle("locked", locked);
  const app = $("#app");
  app.innerHTML = "";
  if (locked) { renderLogin(app); return; }
  updateHeader();
  const st = S.state;

  if (st.view === "settings") renderSettings(app);
  else if (st.view === "monstamm") renderMonStamm(app);
  else if (st.sparte === "mon") {
    if (st.view === "monplan") renderMonPlan(app);
    else if (st.view === "monbuehnen") renderMonBuehnen(app);
    else renderMonStart(app);
  }
  else if (st.view === "archive") renderArchive(app);
  else if (st.view === "settings") renderSettings(app);
  else if (st.view === "map") renderMap(app);
  else {
    const { p, d } = ctx();
    if (p) renderProjectDetail(app, p, d);
    else renderProjectList(app, st.view === "favorites");
  }
  hydrateThumbs(app);
}

/* =========================================================
   Kopfzeile: BV · Fav · Archiv · Einstellungen · Logo + Suche
========================================================= */
function updateHeader() {
  const st = S.state;
  const tabs = {
    tabProjects: "projects",
    tabFav: "favorites",
    tabMap: "map",
    tabArchive: "archive",
    tabMon: "mon",
    tabMonPlan: "monplan",
    tabMonBuehnen: "monbuehnen",
  };
  const inSettings = st.view === "settings" || st.view === "monstamm";
  document.body.classList.toggle("sparte-mon", st.sparte === "mon");
  document.body.classList.toggle("view-settings", inSettings); // Einstellungen gehören zu keiner Sparte
  // oben rechts: Logo der aktuellen Sparte, in den Einstellungen das Stahlwork-Logo
  const sp = SPARTEN.find((x) => x.id === st.sparte) || SPARTEN[0];
  const logo = inSettings ? { icon: "app-logo.svg", name: "Stahlwork" } : sp;
  const li = $("#sparteLogoImg");
  if (li.getAttribute("src") !== logo.icon) li.setAttribute("src", logo.icon);
  li.alt = logo.name;
  $("#sparteLogo").title = logo.name + " – Menü öffnen";
  for (const [id, view] of Object.entries(tabs)) {
    const b = $("#" + id);
    b.classList.toggle("active", st.view === view);
    b.onclick = () => {
      if (st.view === view && !st.selectedProjectId) { window.scrollTo(0, 0); return; }
      go({ view, selectedProjectId: null, selectedDocId: null });
    };
  }
  const cnt = (n) => (n ? String(n) : ""); // 0 nicht anzeigen
  $("#cntProjects").textContent = cnt(st.projects.length);
  $("#cntFav").textContent = cnt(st.projects.filter((p) => p.fav).length);
  $("#cntArchive").textContent = cnt(st.archivedProjects.length);
  $("#cntMonB").textContent = cnt(dueBuehnen().length); // Bühnen zum Abmelden

  $("#searchBtn").classList.toggle("active", !!filterText.trim());
  const search = $("#search");
  search.placeholder = st.view === "archive" ? "Archiv: Nr., Bauherr, Ort, Prüfcode" : "Nr., Bauherr, Ort, Prüfcode";
  if (search.value !== filterText) search.value = filterText;
  updateSyncChip();
}

/* =========================================================
   Burgermenü: Sparte wechseln (BauDoc, BauMon …) + Einstellungen
========================================================= */
const SPARTE_ICONS = {
  doc: `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v2h6V3M8.5 10h7M8.5 14h7M8.5 18h4"/></svg>`,
  mon: `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3.6 17.4a2 2 0 0 0 2.8 2.8l5.7-5.7a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.3-.5-.5-2.3z"/></svg>`,
};

const CHECK_ICO = '<svg class="ico d-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function openDrawer() {
  const st = S.state;
  $("#drawerSparten").innerHTML = SPARTEN.map((sp) => {
    const on = st.sparte === sp.id && st.view !== "settings";
    return `<button type="button" class="drawer-item ${on ? "active" : ""}" data-sparte="${sp.id}" aria-current="${on ? "true" : "false"}">
      <span class="d-ico${sp.icon ? " img" : ""}">${sp.icon ? `<img src="${h(sp.icon)}" alt="">` : SPARTE_ICONS[sp.id] || ""}</span>
      <span class="d-text"><b>${h(sp.name)}</b><small>${h(sp.desc)}</small></span>
      ${on ? CHECK_ICO : ""}
    </button>`;
  }).join("");
  $$("#drawerSparten [data-sparte]").forEach((b) => {
    b.onclick = () => {
      const sp = b.dataset.sparte;
      closeDrawer();
      if (sp === st.sparte && st.view !== "settings") { window.scrollTo(0, 0); return; }
      go({ sparte: sp, view: sp === "mon" ? "mon" : "projects", selectedProjectId: null, selectedDocId: null });
    };
  });
  const ds = $("#drawerSettings");
  ds.classList.toggle("active", st.view === "settings");
  ds.querySelector(".d-check")?.remove();
  if (st.view === "settings") ds.insertAdjacentHTML("beforeend", CHECK_ICO);
  $("#drawerVer").textContent = "Stahlwork " + APP_VERSION;
  $("#drawer").hidden = false;
  document.body.classList.add("drawer-open");
  $("#menuBtn").setAttribute("aria-expanded", "true");
}

function closeDrawer() {
  const d = $("#drawer");
  if (!d || d.hidden) return;
  d.hidden = true;
  document.body.classList.remove("drawer-open");
  $("#menuBtn").setAttribute("aria-expanded", "false");
}

function setupDrawer() {
  $("#menuBtn").onclick = () => ($("#drawer").hidden ? openDrawer() : closeDrawer());
  $("#sparteLogo").onclick = () => ($("#drawer").hidden ? openDrawer() : closeDrawer());
  $$("#drawer [data-close]").forEach((b) => (b.onclick = closeDrawer));
  $("#drawerSettings").onclick = () => {
    closeDrawer();
    if (S.state.view === "settings") return;
    go({ view: "settings", selectedProjectId: null, selectedDocId: null });
  };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
}

// BauMon (Montage): Bereich in Vorbereitung
/* ---------- Anmeldung abgelaufen ----------
   Konto ist bekannt, aber Microsoft verlangt eine neue Anmeldung: Hinweis mit Knopf. */
function authExpired() { return od.isConfigured() && od.isSignedIn() && sync.status.kind === "signedout"; }
function updateAuthBar() {
  let bar = $("#authBar");
  if (!authExpired()) { if (bar) bar.remove(); return; }
  // Kein automatisches Neuanmelden mehr: am iPhone konnte das in eine Schleife aus
  // Weiterleitungen laufen ("Stahlwork wird geladen …"). Nur Hinweis mit Knopf.
  if (bar) return;
  bar = el(`<div id="authBar" class="update-bar auth-bar"><span>Anmeldung abgelaufen – Änderungen bleiben auf dem Gerät und werden nach dem Anmelden hochgeladen.</span><button class="primary small" type="button">Neu anmelden</button></div>`);
  bar.querySelector("button").onclick = async () => { await saveNow(); od.relogin(); };
  document.body.appendChild(bar);
}

function setupSearch() {
  const search = $("#search");
  const bar = $("#appbar");
  // App-Ansicht: Lupe klappt das Suchfeld auf
  $("#searchBtn").onclick = () => {
    bar.classList.add("searching");
    search.focus();
  };
  const closeSearch = () => {
    bar.classList.remove("searching");
    if (filterText) { filterText = ""; search.value = ""; render(); }
    search.blur();
  };
  $("#searchClose").onclick = closeSearch;
  search.addEventListener("blur", () => {
    // leer verlassen -> wieder zuklappen
    if (!search.value.trim()) setTimeout(() => { if (document.activeElement !== search) bar.classList.remove("searching"); }, 150);
  });
  search.addEventListener("input", () => {
    filterText = search.value;
    const st = S.state;
    if (!filterText.trim()) {
      if (!st.selectedProjectId && st.view !== "settings") render();
    } else if (st.view === "settings" || st.view === "map" && searchCode() || st.selectedProjectId) {
      go({ view: st.view === "settings" || st.view === "map" ? "projects" : st.view, selectedProjectId: null, selectedDocId: null }, { replace: true });
    } else {
      render();
    }
  });
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      // Genau ein Treffer -> direkt öffnen
      const hits = $$("#app .project-item[data-pid]");
      if (hits.length === 1) hits[0].click();
      else search.blur();
    }
    if (e.key === "Escape") closeSearch();
  });
}

/* ---------- Prüfcode über die Suche ----------
   Ein 8-stelliger Code (z. B. 7F3A-91C2) in der Suche wird als Prüfcode eines PDFs geprüft. */
function searchCode() {
  const q = filterText.trim();
  return /^[0-9a-f]{4}[\s-]?[0-9a-f]{4}$/i.test(q) ? normalizeCode(q) : null;
}

function checkCode(code) {
  const st = S.state;
  const current = [], older = [];
  let notLoaded = 0;
  const seen = new Set();
  const consider = (x) => {
    if (x.cur === code) current.push(x);
    else if ((x.pdf || []).some((v) => v.code === code)) older.push(x);
  };
  for (const p of allProjects()) {
    const fid = p.remote && p.remote.folderId;
    if (!p.docs) { if (!(fid && st.codeIndex[fid])) notLoaded++; continue; }
    if (fid) seen.add(fid);
    const arch = st.archivedProjects.includes(p);
    for (const d of p.docs) {
      consider({ number: p.number, name: p.client || p.title, title: d.title, date: d.date, cur: contentCode(p, d), pdf: d.pdfCodes || [],
        tag: arch ? "Archiv" : "", pid: arch ? null : p.id, did: d.id });
    }
  }
  // archivierte BV, die hier nicht geladen sind oder schon ausgelagert wurden
  for (const [fid, e] of Object.entries(st.codeIndex || {})) {
    if (seen.has(fid) || !e || !Array.isArray(e.docs)) continue;
    for (const d of e.docs) {
      consider({ number: e.number, name: e.client || e.title, title: d.title, date: d.date, cur: d.cur, pdf: d.pdf || [],
        tag: e.gone ? `ausgelagert am ${formatDateDE(e.gone)}` : "Archiv", pid: null, did: null });
    }
  }
  const link = (x) => {
    const txt = `BV ${h(x.number)} ${h(x.name)} – „${h(x.title)}“ vom ${formatDateDE(x.date)}${x.tag ? ` (${h(x.tag)})` : ""}`;
    return x.pid ? `<button type="button" class="link-btn" data-open-pid="${h(x.pid)}" data-open-did="${h(x.did)}">${txt}</button>` : txt;
  };
  // alle PDF-Stände der Doku: Version, Datum, Code; gesuchter und aktueller Stand markiert
  const versions = (x) => {
    const cur = x.cur;
    const list = (x.pdf || []).map((v, i) => ({ ...v, n: i + 1 }));
    if (!list.length) return "";
    return `<ol class="pdf-versions">${list.slice().reverse().map((v) =>
      `<li class="${v.code === code ? "hit" : ""}"><span>Stand ${v.n}</span><span>${formatDateTimeDE(v.at)}</span><code>${v.code}</code>${v.code === cur ? '<em class="cur">aktuell</em>' : ""}${v.code === code ? '<em class="you">gesucht</em>' : ""}</li>`).join("")}</ol>` +
      (list[list.length - 1].code !== cur ? `<div class="muted small-note">Seit dem letzten PDF wurde die Doku geändert – für den aktuellen Stand ein neues PDF erstellen.</div>` : "");
  };
  if (current.length) return { cls: "ok", html: `✓ Prüfcode <strong>${code}</strong> entspricht dem <strong>aktuellen Stand</strong>:<br>${current.map((x) => link(x) + versions(x)).join("")}` };
  if (older.length) return { cls: "warn", html: `⚠ Prüfcode <strong>${code}</strong> gehört zu einem <strong>älteren Stand</strong> – die Dokumentation wurde danach geändert:<br>${older.map((x) => link(x) + versions(x)).join("")}` };
  return { cls: "bad", html: `✗ Zu Prüfcode <strong>${code}</strong> wurde keine Dokumentation gefunden.` +
    (notLoaded ? ` Hinweis: ${notLoaded} Bauvorhaben sind auf diesem Gerät nicht geladen – dort einmal öffnen und erneut prüfen.` : "") };
}

// Karte mit dem Prüfergebnis (nur wenn die Suche ein Prüfcode ist)
function renderCodeCheck(app) {
  const code = searchCode();
  if (!code) return false;
  const r = checkCode(code);
  const card = el(`<div class="card code-card"><h3 class="section-title">PDF-Prüfcode</h3><div id="chkResult" class="check-result ${r.cls}">${r.html}</div></div>`);
  $$("[data-open-pid]", card).forEach((b) => {
    b.onclick = () => {
      filterText = ""; $("#search").value = ""; $("#appbar").classList.remove("searching");
      go({ view: "projects", selectedProjectId: b.dataset.openPid, selectedDocId: b.dataset.openDid });
    };
  });
  app.appendChild(card);
  return true;
}

function matches(p) {
  const q = filterText.trim().toLowerCase();
  if (!q) return true;
  const hay = (p.number + " " + p.title).toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

const SYNC_ICONS = {
  idle: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.8"/></svg>',
  syncing: '<svg class="ico spin" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3"/><path d="M18 3v4h-4M6 21v-4h4"/></svg>',
  pending: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.4 1.6A4 4 0 0 1 17 18"/><path d="M12 12v8M9 15l3-3 3 3"/></svg>',
  offline: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.4 1.6A4 4 0 0 1 17 18H7z"/><path d="M4 4l16 16"/></svg>',
  error: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.5v.01"/></svg>',
  signedout: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  off: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="3" width="12" height="18" rx="2"/><path d="M11 18h2"/></svg>',
};

function updateSyncChip() {
  const chip = $("#syncChip");
  if (!chip) return;
  const s = sync.status;
  const titles = {
    off: "Daten liegen nur auf diesem Gerät",
    signedout: "Nicht angemeldet – klicken zum Anmelden",
    syncing: "Synchronisierung mit OneDrive läuft …",
    idle: "Alles mit OneDrive synchronisiert",
    pending: `${s.pending} Änderung(en) warten auf Upload – klicken zum Synchronisieren`,
    offline: "Keine Internetverbindung – Änderungen werden später hochgeladen",
    error: "Fehler beim Synchronisieren: " + (s.message || ""),
  };
  chip.innerHTML = SYNC_ICONS[s.kind] || "";
  if (s.kind === "pending" && s.pending) chip.insertAdjacentHTML("beforeend", `<span class="sync-cnt">${s.pending > 99 ? "99+" : s.pending}</span>`);
  chip.className = "sync-chip " + s.kind;
  chip.title = titles[s.kind] || "";
  chip.setAttribute("aria-label", titles[s.kind] || "Synchronisierung");
  const mdot = $("#menuDot");
  if (mdot) mdot.className = "sync-dot " + s.kind;
  const dsync = $("#drawerSync");
  if (dsync) dsync.textContent = titles[s.kind] ? titles[s.kind].replace(/ – klicken.*$/, "") : "Anmeldung, Synchronisierung";
  chip.onclick = () => {
    if (s.kind === "signedout") { od.login(); return; }
    if (s.kind === "error") { toast(s.message || "Unbekannter Fehler", "error", 8000); sync.run({ full: true }); return; }
    if (s.kind === "pending" || s.kind === "idle") { sync.run({ full: true }); return; }
    go({ view: "settings", selectedProjectId: null, selectedDocId: null });
  };
}

/* =========================================================
   Listen: Bauvorhaben / Favoriten
========================================================= */
function renderProjectList(app, onlyFav) {
  const st = S.state;
  const sorted = st.projects.slice().sort((a, b) => a.number.localeCompare(b.number) || a.title.localeCompare(b.title));
  const base = onlyFav ? sorted.filter((p) => p.fav) : sorted;
  const shown = base.filter(matches);

  const head = el(`
    <div class="page-head">
      <h1>${onlyFav ? "Favoriten" : "Bauvorhaben"}</h1>
      ${onlyFav ? "" : `<button class="${addOpen ? "secondary" : "primary"}" id="toggleAdd" type="button">${addOpen ? "Abbrechen" : "+ Neu"}</button>`}
    </div>`);
  app.appendChild(head);

  if (!onlyFav && addOpen) {
    const form = el(`
      <div class="card add-card">
        <label class="field-label" for="newNum">Neues Bauvorhaben</label>
        <div class="add-row">
          <input id="newNum" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="5" placeholder="BV-Nr." autocomplete="off" enterkeyhint="next" />
          <input id="newClient" type="text" placeholder="Bauherr / Auftraggeber" autocomplete="off" enterkeyhint="next" />
          <div class="place-field">
            <input id="newPlace" type="text" placeholder="Bauort" autocomplete="off" enterkeyhint="done" />
            <div class="place-list" id="newPlaceList"></div>
          </div>
        </div>
        <button class="primary block" id="addP" type="button">Bauvorhaben anlegen</button>
      </div>`);
    app.appendChild(form);
    const numEl = $("#newNum");
    numEl.addEventListener("input", () => {
      numEl.value = numEl.value.replace(/\D/g, "").slice(0, 5);
    });
    // Kein automatisches Weiterspringen (Tab-Gewohnheit); Enter = nächstes Feld
    numEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("#newClient").focus(); } });
    $("#addP").onclick = () => addProject();
    newGeo = null;
    newPlaceSuggest = attachPlaceSuggest($("#newPlace"), $("#newPlaceList"), (g) => {
      newGeo = g;
      if (pickToAdd) { pickToAdd = false; addProject(); } // Auswahl nach Hinweis -> gleich anlegen
    });
    $("#newClient").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#newPlace").focus(); });
    $("#newPlace").addEventListener("keydown", (e) => { if (e.key === "Enter") addProject(); });
    // Cursor ins Nummernfeld – nur wenn noch kein Feld des Formulars aktiv ist
    setTimeout(() => { if (!form.contains(document.activeElement)) numEl.focus(); }, 50);
  }
  const t = $("#toggleAdd");
  if (t) t.onclick = () => { addOpen = !addOpen; pickToAdd = false; newGeo = null; render(); };

  const isCode = renderCodeCheck(app);
  if (isCode && !shown.length) return;
  const list = el(`<div class="card list-card"></div>`);
  if (filterText.trim()) {
    list.appendChild(el(`<div class="muted list-info">${shown.length} Treffer für „${h(filterText.trim())}“</div>`));
  }
  if (!base.length) {
    list.appendChild(el(onlyFav
      ? `<div class="empty"><div class="empty-icon">☆</div><p><strong>Noch keine Favoriten.</strong></p>
         <p class="muted">Markiere deine eigenen Bauvorhaben mit dem Stern. Favoriten werden komplett auf dem Gerät gespeichert – auch die Fotos – und sind offline verfügbar.</p></div>`
      : `<div class="empty"><div class="empty-icon">▦</div><p><strong>Noch keine Bauvorhaben.</strong></p>
         <p class="muted">Lege mit „+ Neu“ das erste Bauvorhaben an.</p></div>`));
  } else if (!shown.length) {
    list.appendChild(el(`<p class="muted">Keine Treffer.</p>`));
  }
  shown.forEach((p) => list.appendChild(projectRow(p)));
  app.appendChild(list);
}

// "3 Dokumentationen · zuletzt 19.11.2026" – auch für BV, deren Inhalt noch nicht geladen ist
function docsMeta(p) {
  let n = null, last = 0;
  if (Array.isArray(p.docs)) {
    n = p.docs.length;
    last = p.docs.reduce((mx, d) => Math.max(mx, Date.parse(d.date) || 0), 0);
  } else if (p.summary) {
    n = p.summary.docs;
    last = Date.parse(p.summary.last) || 0;
  }
  const cloud = p.docs === null ? `<span class="cloud-wrap" title="Inhalt liegt in OneDrive und wird beim Öffnen geladen"><svg class="ico cloud-hint" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.4 1.6A4 4 0 0 1 17 18H7z"/></svg></span>` : "";
  if (n === null) return `<span class="meta-line">${cloud}<span class="muted">Wird beim Öffnen geladen</span></span>`;
  return `<span class="meta-line">${cloud}<span class="muted">${n} ${n === 1 ? "Doku" : "Dokus"}${last ? " · zuletzt " + formatDateDE(last) : ""}</span></span>`;
}

function projectRow(p) {
  const meta = docsMeta(p);
  // Noch nicht hochgeladen: Sanduhr rechts neben dem Pfeil (ändert die Zeilenhöhe nicht)
  const pending = p.dirty && od.isConfigured();
  const pend = pending ? `<span class="p-pend" title="Noch nicht hochgeladen" aria-label="Noch nicht hochgeladen">⏳</span>` : "";
  const row = el(`
    <div class="project-item ${pending ? "has-pend" : ""} ${justAdded === p.id ? "flash" : ""}" data-pid="${h(p.id)}">
      <button class="fav-btn ${p.fav ? "is-fav" : ""}" type="button" data-a="fav" aria-label="Favorit umschalten"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.8 5.9 6.2.7-4.6 4.3 1.2 6.1L12 17l-5.6 3 1.2-6.1L3 9.6l6.2-.7z"/></svg></button>
      <div class="p-info">
        <div class="p-title"><span class="bv-num">${h(p.number)}</span> ${h(p.client || p.title)}</div>
        ${p.place ? `<div class="p-place">${h(p.place)}</div>` : ""}
        <div class="p-meta">${meta}</div>
      </div>
      ${pend}<span class="chevron" aria-hidden="true">›</span>
    </div>`);
  row.onclick = (e) => {
    const a = e.target.closest("[data-a]");
    if (a) { e.stopPropagation(); toggleFav(p); return; }
    go({ selectedProjectId: p.id, selectedDocId: null });
  };
  return row;
}

let newPlaceSuggest = null;
let pickToAdd = false;
let adding = false;

async function addProject() {
  if (adding) return;
  const num = $("#newNum").value.trim();
  const client = $("#newClient").value.trim();
  const place = $("#newPlace").value.trim();
  if (!/^\d{5}$/.test(num)) {
    toast("Bitte eine 5-stellige Bauvorhaben-Nummer eingeben (nur Ziffern).", "warn");
    $("#newNum").focus();
    return;
  }
  if (!client) {
    toast("Bitte Bauherr / Auftraggeber eingeben.", "warn");
    $("#newClient").focus();
    return;
  }
  if (!place) {
    toast("Bitte den Bauort eingeben.", "warn");
    $("#newPlace").focus();
    return;
  }
  const ex = findByNumber(num);
  if (ex) {
    const where = S.state.archivedProjects.includes(ex) ? " (im Archiv)" : "";
    toast(`Bauvorhaben ${num} existiert bereits${where}: ${ex.number} ${ex.title}`, "warn", 6000);
    return;
  }
  // Bauort immer aus der Vorschlagsliste (damit das BV auf der Karte erscheint):
  // eindeutiger Vorschlag -> automatisch übernehmen, mehrere -> auswählen lassen
  let geo = newGeo && newGeo.place === place ? newGeo : null;
  if (!geo) {
    if (!navigator.onLine) {
      toast("Offline: BV wird ohne Kartenposition angelegt. Den Ort später im BV aus der Liste wählen.", "warn", 7000);
    } else {
      let res = null;
      adding = true;
      try { res = await searchPlaces(place); } catch (e) { console.warn("Ortssuche", e); } finally { adding = false; }
      if (!$("#newPlace")) return; // Formular inzwischen geschlossen
      if (res === null) {
        toast("Ortssuche nicht erreichbar – BV wird ohne Kartenposition angelegt.", "warn", 7000);
      } else if (res.length === 1) {
        geo = placeToGeo(res[0]);
        $("#newPlace").value = geo.place;
      } else if (!res.length) {
        toast(`Ort „${place}“ nicht gefunden – bitte Schreibweise prüfen.`, "warn", 6000);
        $("#newPlace").focus();
        return;
      } else {
        toast("Mehrere Orte passen – bitte den Ort aus der Liste wählen.", "warn", 6000);
        $("#newPlace").focus();
        pickToAdd = true;
        if (newPlaceSuggest) newPlaceSuggest.show(res);
        return;
      }
    }
  }
  const p = newProject(num, client, geo ? geo.place : place);
  if (geo) { p.geo = geo; S.state.mapDirty = true; }
  S.state.projects.push(p);
  touchProject(p);
  favoritesChanged();
  addOpen = false;
  justAdded = p.id;
  render();
  toast(`BV ${p.number} angelegt.`, "info", 2500);
  const row = $(`.project-item[data-pid="${CSS.escape(p.id)}"]`);
  if (row) row.scrollIntoView({ block: "center", behavior: "smooth" });
  setTimeout(() => { justAdded = null; }, 2500);
}

function toggleFav(p) {
  p.fav = !p.fav;
  favoritesChanged();
  render();
  toast(p.fav ? `${p.number} ist jetzt Favorit – wird auf diesem Gerät gespeichert.` : `${p.number} ist kein Favorit mehr.`, "info", 2500);
  sync.refreshStatus();
  if (p.fav) sync.schedule(300, { full: true });
  else { sync.freeLocal(p).catch((e) => console.warn(e)); sync.schedule(1500); }
}

/* =========================================================
   Ortsvorschläge (Bauort)
========================================================= */
let newGeo = null;
const PIN_ICON = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';

function showPlaceGeo(p) {
  const box = $("#placeGeo");
  if (!box || !p) return;
  const typed = ($("#projPlace") || {}).value;
  const valid = geoValid(p) && (typed === undefined || typed.trim() === p.place);
  box.className = "place-geo" + (valid ? " ok" : "");
  box.innerHTML = valid
    ? `${PIN_ICON} Auf der Karte: ${h(p.geo.label || p.geo.place)}`
    : `${PIN_ICON} Ort aus den Vorschlägen wählen, damit das BV auf der Karte erscheint`;
}

// Ortsvorschlag -> Kartenposition
function placeToGeo(r) {
  return { lat: r.lat, lon: r.lon, place: r.name, label: r.ctx ? `${r.name}, ${r.ctx}` : r.name };
}

function attachPlaceSuggest(input, list, onPick) {
  let timer = null;
  let seq = 0;
  const close = () => { list.innerHTML = ""; };
  const show = (res) => {
    list.innerHTML = res.map((r, i) => `<button type="button" class="place-opt" data-i="${i}">${h(r.name)}${r.ctx ? `<span>${h(r.ctx)}</span>` : ""}</button>`).join("");
    $$(".place-opt", list).forEach((b) => {
      // pointerdown statt click: Auswahl vor dem Verlassen des Feldes
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        const g = placeToGeo(res[Number(b.dataset.i)]);
        input.value = g.place;
        close();
        onPick(g);
      });
    });
  };
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) { close(); return; }
    timer = setTimeout(async () => {
      if (!navigator.onLine) { list.innerHTML = `<div class="place-msg">Ortsvorschläge nur mit Internet</div>`; return; }
      const my = ++seq;
      list.innerHTML = `<div class="place-msg">Suche …</div>`;
      try {
        const res = await searchPlaces(q);
        if (my !== seq || document.activeElement !== input) { if (my === seq) close(); return; }
        if (!res.length) { list.innerHTML = `<div class="place-msg">Kein Ort gefunden</div>`; return; }
        show(res);
      } catch (e) {
        if (my === seq) list.innerHTML = `<div class="place-msg">${h(e.message)}</div>`;
      }
    }, 450);
  });
  input.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== input) close(); }, 150));
  input.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  return { show, close };
}

/* =========================================================
   Karte
========================================================= */
let mapInstance = null;
let mapView = null; // zuletzt gezeigter Ausschnitt

// Farben der Pins: gold = Favoriten, grau = weitere, weiß = Archiv (gleicher Umriss)
// Pins und angehängte Kreise einheitlich: ganz grau, ganz gold bzw. ganz weiß (Zahl direkt darauf)
const PIN_STYLE = {
  fav: { fill: "#d6a21c", stroke: "#fff", text: "#fff" },
  other: { fill: "#8d8c87", stroke: "#fff", text: "#fff" },
  archive: { fill: "#fff", stroke: "#8d8c87", text: "#5f5e59" },
};

// Pin mit Anzahl im Kopf; optional goldenes Abzeichen oben rechts (Anzahl Favoriten)
// schlanke Form (24 x 34 px), damit viele Pins wenig von der Karte verdecken
// Grundfarbe: grau, wenn aktive BV (ohne Favoriten) da sind; sonst gold (nur Favoriten) bzw. weiß (nur Archiv).
// Weitere Arten am selben Ort als Abzeichen: gold = Favoriten, weiß = Archiv.
function pinIcon(L, counts, cluster = false) {
  const kind = counts.other ? "other" : counts.fav ? "fav" : "archive";
  const st = PIN_STYLE[kind];
  const count = counts[kind];
  const num = (v) => (v > 99 ? "99+" : String(v));
  // Sammel-Pin (mehrere Orte): zweiter, leicht versetzter Umriss dahinter ("Stapel")
  const stack = cluster ? `<path transform="translate(2.6 -1.6)" d="M12 33s9.5-10.2 9.5-20.3A9.5 9.5 0 0 0 2.5 12.7C2.5 22.8 12 33 12 33z" fill="${st.fill}" stroke="${st.stroke}" stroke-width="1.6" opacity=".55"/>` : "";
  const n = num(count);
  const size = n.length >= 3 ? 7.2 : n.length === 2 ? 9.4 : 10.8;
  const body = `${stack}
      <path d="M12 33s9.5-10.2 9.5-20.3A9.5 9.5 0 0 0 2.5 12.7C2.5 22.8 12 33 12 33z" fill="${st.fill}" stroke="${st.stroke}" stroke-width="1.6"/>
      <text x="12" y="12.6" text-anchor="middle" dominant-baseline="central" font-family="system-ui, sans-serif" font-weight="700" font-size="${size}" fill="${st.text}">${n}</text>`;
  const badges = [];
  if (kind !== "fav" && counts.fav) badges.push({ v: counts.fav, ...PIN_STYLE.fav, k: "fav" });
  if (kind !== "archive" && counts.archive) badges.push({ v: counts.archive, ...PIN_STYLE.archive, k: "arch" });
  const data = `data-kind="${kind}" data-count="${n}" data-fav="${badges.find((b) => b.k === "fav")?.v || ""}" data-arch="${badges.find((b) => b.k === "arch")?.v || ""}" data-cluster="${cluster ? 1 : ""}"`;
  if (!badges.length) {
    if (cluster) {
      return L.divIcon({ className: "", html: `<div class="pin" ${data}><svg viewBox="0 -2 28 36" width="28" height="36" aria-hidden="true">${body}</svg></div>`,
        iconSize: [28, 36], iconAnchor: [12, 35], popupAnchor: [0, -30] });
    }
    return L.divIcon({ className: "", html: `<div class="pin" ${data}><svg viewBox="0 0 24 34" width="24" height="34" aria-hidden="true">${body}</svg></div>`,
      iconSize: [24, 34], iconAnchor: [12, 33], popupAnchor: [0, -30] });
  }
  // Abzeichen rechts am Pin: erstes oben, zweites darunter
  const H = badges.length > 1 ? 44 : 36;
  const marks = badges.map((b, i) => {
    const t = num(b.v);
    const fs = t.length >= 3 ? 5.6 : t.length === 2 ? 7.2 : 8.2;
    const r = t.length >= 2 ? 7.5 : 6.8;
    const cx = 34 - r - 1.2, cy = 8.7 + i * 16;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${b.fill}" stroke="${b.stroke}" stroke-width="1.6"/>
      <text x="${cx}" y="${cy + 0.2}" text-anchor="middle" dominant-baseline="central" font-family="system-ui, sans-serif" font-weight="700" font-size="${fs}" fill="${b.text}">${t}</text>`;
  }).join("");
  const dy = H - 34;
  return L.divIcon({ className: "", html: `<div class="pin mixed" ${data}><svg viewBox="0 0 34 ${H}" width="34" height="${H}" aria-hidden="true">
      <g transform="translate(0 ${dy})">${body}</g>${marks}
    </svg></div>`, iconSize: [34, H], iconAnchor: [12, H - 1], popupAnchor: [0, -(H - 5)] });
}

// Startausschnitt: Altensteig in der Mitte, ca. 65 km Umkreis (Karlsruhe, Stuttgart, Straßburg)
const MAP_HOME = { lat: 48.5866, lon: 8.6046, radiusKm: 65 };
function homeBounds() {
  const dLat = MAP_HOME.radiusKm / 111.32;
  const dLon = MAP_HOME.radiusKm / (111.32 * Math.cos((MAP_HOME.lat * Math.PI) / 180));
  return [[MAP_HOME.lat - dLat, MAP_HOME.lon - dLon], [MAP_HOME.lat + dLat, MAP_HOME.lon + dLon]];
}
let updating = false; // "Jetzt aktualisieren" gedrückt
let lastRenderedView = null;
let currentRenderedView = null;

function renderMap(app) {
  // Karte neu geöffnet -> Startausschnitt; nur innerhalb der Karte (z. B. nach Abgleich) Ausschnitt behalten
  const stay = lastRenderedView === "map";
  if (mapInstance) {
    try { if (stay) mapView = { c: mapInstance.getCenter(), z: mapInstance.getZoom() }; mapInstance.remove(); } catch {}
    mapInstance = null;
  }
  if (!stay) mapView = null;
  const st = S.state;
  // Welche Arten werden angezeigt? (wird gemerkt)
  if (!st.mapFilter || typeof st.mapFilter !== "object") st.mapFilter = { fav: true, other: true, archive: false };
  const f = st.mapFilter;
  const kindOf = (p) => (st.archivedProjects.includes(p) ? "archive" : p.fav ? "fav" : "other");
  const list = [...st.projects, ...st.archivedProjects].filter((p) => f[kindOf(p)] && matches(p));
  const onMap = list.filter(geoValid);
  const missing = list.filter((p) => !geoValid(p));

  const chip = (key, label, cls) => `<button type="button" class="map-chip ${cls} ${f[key] ? "on" : ""}" data-filter="${key}" aria-pressed="${f[key] ? "true" : "false"}"><span class="map-dot"></span>${label}</button>`;
  app.appendChild(el(`
    <div class="page-head map-head"><h1>Karte</h1>
      <div class="map-filter" role="group" aria-label="Anzeigen">
        ${chip("other", "Bauvorhaben", "c-other")}${chip("fav", "Favoriten", "c-fav")}${chip("archive", "Archiv", "c-arch")}
      </div>
    </div>`));
  $$(".map-chip").forEach((b) => {
    b.onclick = () => {
      f[b.dataset.filter] = !f[b.dataset.filter];
      saveSoon();
      render(); // Ausschnitt bleibt erhalten
    };
  });
  const card = el(`
    <div class="card map-card">
      <div id="map"></div>
      ${missing.length ? `<div class="map-info"><button class="map-missing" id="mapMissing" type="button">${missing.length} BV ohne Kartenposition</button></div>` : ""}
    </div>`);
  app.appendChild(card);

  const mm = $("#mapMissing");
  if (mm) mm.onclick = () => {
    const names = missing.slice(0, 12).map((p) => `${p.number} ${p.client || p.title}${p.place ? " (" + p.place + ")" : ""}`).join("\n");
    alert(`Ohne Kartenposition:\n\n${names}${missing.length > 12 ? "\n…" : ""}\n\nIm BV beim Bauort einen Ort aus den Vorschlägen wählen.`);
  };

  if (!navigator.onLine) {
    $("#map").innerHTML = `<div class="empty"><p class="muted">Die Karte braucht eine Internetverbindung.</p></div>`;
    return;
  }

  loadLeaflet().then((L) => {
    const box = $("#map");
    if (!box || S.state.view !== "map") return;
    const map = L.map(box, { zoomControl: true, attributionControl: true, zoomSnap: 0.25, zoomDelta: 1 });
    mapInstance = map;
    if (navigator.webdriver) window.__bdMap = map; // nur für automatische Tests
    L.tileLayer(TILE_URL, { maxZoom: 18, attribution: TILE_ATTRIBUTION, referrerPolicy: "strict-origin-when-cross-origin" }).addTo(map);

    // je Ort gruppieren; Favoriten (gold) und weitere (grau) als zwei Pins nebeneinander
    const groups = new Map();
    for (const p of onMap) {
      const k = p.geo.lat.toFixed(4) + "," + p.geo.lon.toFixed(4);
      if (!groups.has(k)) groups.set(k, { lat: p.geo.lat, lon: p.geo.lon, place: p.geo.place, fav: [], other: [], archive: [] });
      groups.get(k)[kindOf(p)].push(p);
    }
    const byNum = (a, b) => a.number.localeCompare(b.number);
    // nahe beieinander liegende Orte automatisch zu einem Sammel-Pin zusammenfassen
    const clusters = L.markerClusterGroup({
      maxClusterRadius: 42,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      disableClusteringAtZoom: 14,
      iconCreateFunction: (c) => {
        const sum = { fav: 0, other: 0, archive: 0 };
        for (const mk of c.getAllChildMarkers()) for (const k in sum) sum[k] += mk.options.counts[k];
        return pinIcon(L, sum, true);
      },
    });
    for (const g of groups.values()) {
      const total = g.fav.length + g.other.length + g.archive.length;
      // ein Pin je Ort, gleicher Umriss: Farbe nach der "wichtigsten" Art,
      // Favoriten als goldenes Abzeichen, wenn noch andere Arten am selben Ort sind
      const icon = pinIcon(L, { fav: g.fav.length, other: g.other.length, archive: g.archive.length });
      const m = L.marker([g.lat, g.lon], { icon, title: `${g.place}: ${total} BV`, counts: { fav: g.fav.length, other: g.other.length, archive: g.archive.length } });
      clusters.addLayer(m);
      const sorted = [...g.fav.sort(byNum), ...g.other.sort(byNum), ...g.archive.sort(byNum)];
      m.bindPopup(`<div class="map-pop"><h4>${h(g.place)} · ${total} BV</h4>${sorted.map((p) => {
        const arch = st.archivedProjects.includes(p);
        return `<button type="button" data-pid="${h(p.id)}" data-arch="${arch ? 1 : ""}">${p.fav && !arch ? '<span class="star">★</span>' : ""}<span class="bv-num">${h(p.number)}</span> ${h(p.client || p.title)}${arch ? ' <span class="arch-tag">Archiv</span>' : ""}</button>`;
      }).join("")}</div>`);
    }
    map.addLayer(clusters);
    map.on("popupopen", (e) => {
      $$("[data-pid]", e.popup.getElement()).forEach((b) => {
        b.onclick = () => {
          if (b.dataset.arch) {
            // archiviertes BV: im Archiv zeigen
            const ap = S.state.archivedProjects.find((x) => x.id === b.dataset.pid);
            filterText = ap ? ap.number : "";
            go({ view: "archive", selectedProjectId: null, selectedDocId: null });
          } else {
            go({ view: "projects", selectedProjectId: b.dataset.pid, selectedDocId: null });
          }
        };
      });
    });
    if (mapView) map.setView(mapView.c, mapView.z);
    else map.setView([MAP_HOME.lat, MAP_HOME.lon], map.getBoundsZoom(homeBounds(), false)); // Altensteig genau in der Mitte
  }).catch((e) => {
    const box = $("#map");
    if (box) box.innerHTML = `<div class="empty"><p class="muted">${h(e.message)}</p></div>`;
  });
}

/* =========================================================
   Archiv
========================================================= */
function renderArchive(app) {
  app.appendChild(el(`
    <div class="page-head">
      <h1>Archiv</h1>
    </div>`));
  if (renderCodeCheck(app) && !S.state.archivedProjects.some(matches)) return;
  const list = el(`<div class="card list-card"></div>`);
  const all = S.state.archivedProjects.slice().sort((a, b) => a.number.localeCompare(b.number));
  const arch = all.filter(matches);
  if (!all.length) {
    list.appendChild(el(`<div class="empty"><div class="empty-icon">🗄</div><p><strong>Archiv ist leer.</strong></p>
      <p class="muted">Abgeschlossene Bauvorhaben kannst du im Bauvorhaben über „Archivieren“ hierher verschieben.</p></div>`));
  } else if (!arch.length) list.appendChild(el(`<p class="muted">Keine Treffer.</p>`));

  arch.forEach((p) => {
    const count = docsMeta(p);
    const row = el(`
      <div class="archive-item">
        <div class="p-info">
          <div class="p-title"><span class="bv-num">${h(p.number)}</span> ${h(p.client || p.title)}</div>
          <div class="muted">${p.place ? h(p.place) + " · " : ""}${count}</div>
        </div>
        <div class="row">
          <button class="danger-outline small" data-a="delete" type="button">Löschen</button>
          <button class="secondary small" data-a="restore" type="button">Wiederherstellen</button>
        </div>
      </div>`);
    $('[data-a="restore"]', row).onclick = () => {
      moveLocal(p, "active");
      if (p.remote.folderId) p.moveTo = "active";
      // wer wiederherstellt, arbeitet daran -> bei ihm immer Favorit (andere Nutzer unverändert)
      if (!p.fav) { p.fav = true; favoritesChanged(); }
      touchProject(p);
      toast(`${p.number} wiederhergestellt – in deinen Favoriten.`, "info", 3000);
      render();
    };
    $('[data-a="delete"]', row).onclick = async () => {
      const extra = p.remote.folderId ? "\n\nDer Ordner wird auch in OneDrive gelöscht (landet im OneDrive-Papierkorb)." : "";
      if (!confirm(`Bauvorhaben „${p.number} ${p.title}“ endgültig löschen?${extra}`)) return;
      if (p.remote.folderId) {
        S.state.remote.pendingFolderDeletes.push(p.remote.folderId);
        // gelöschtes BV auch aus der Prüfcode-Übersicht und der Karte nehmen
        S.state.codeIndexPending = { ...(S.state.codeIndexPending || {}), [p.remote.folderId]: null };
        S.state.mapRemove = [...(S.state.mapRemove || []), p.remote.folderId];
      }
      await removeProjectLocal(p);
      await saveNow();
      render();
      sync.schedule(500);
    };
    list.appendChild(row);
  });
  app.appendChild(list);
}

/* =========================================================
   Bauvorhaben – Detail
   Handy: untereinander · Breiter Bildschirm: Liste links, Bearbeiten rechts
========================================================= */
function renderProjectDetail(app, p, d) {
  const wrap = el(`<div class="detail ${d ? "has-doc" : ""}"><div class="detail-main"></div><div class="detail-side"></div></div>`);
  app.appendChild(wrap);
  const main = $(".detail-main", wrap);
  const side = $(".detail-side", wrap);

  const head = el(`
    <div class="card">
      <div class="row">
        <button id="back" class="icon-btn" type="button" aria-label="Zurück"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
        <label class="bv-num-edit grow" title="BV-Nummer ändern">
          <span class="bv-num big">BV</span>
          <input id="projNum" class="bv-num big" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="5" value="${h(p.number)}" aria-label="BV-Nummer" enterkeyhint="done" />
          <svg class="ico ico-sm edit-hint" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 4.5l3 3L8 17l-4 1 1-4z"/></svg>
        </label>
        <button class="fav-btn ${p.fav ? "is-fav" : ""}" id="favD" type="button" aria-label="Favorit umschalten"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.8 5.9 6.2.7-4.6 4.3 1.2 6.1L12 17l-5.6 3 1.2-6.1L3 9.6l6.2-.7z"/></svg></button>
      </div>
      <div class="bv-fields">
        <div>
          <label class="field-label" for="projClient">Bauherr / Auftraggeber</label>
          <input id="projClient" class="title-input" type="text" value="${h(p.client)}" enterkeyhint="next" />
        </div>
        <div>
          <label class="field-label" for="projPlace">Bauort</label>
          <div class="place-field">
            <input id="projPlace" type="text" value="${h(p.place)}" autocomplete="off" enterkeyhint="done" />
            <div class="place-list" id="projPlaceList"></div>
          </div>
          <div class="place-geo" id="placeGeo"></div>
        </div>
      </div>
      <div class="row wrap actions">
        <button class="secondary" id="archP" type="button">Archivieren</button>
        <button class="primary" id="newD" type="button"><span class="long">+ Neue Dokumentation</span><span class="short">+ Neue Doku</span></button>
      </div>
    </div>`);
  main.appendChild(head);

  $("#back").onclick = () => go({ selectedProjectId: null, selectedDocId: null });
  $("#favD").onclick = () => toggleFav(p);
  $("#archP").onclick = () => {
    const noPdf = (p.docs || []).filter((d) => { const last = (d.pdfCodes || []).slice(-1)[0]; return !last || last.code !== contentCode(p, d); });
    const warnPdf = noPdf.length
      ? `\n\nAchtung: ${noPdf.length} Dokumentation(en) ohne aktuelles PDF:\n${noPdf.slice(0, 8).map((d) => "– " + (d.title || "Dokumentation")).join("\n")}${noPdf.length > 8 ? "\n– …" : ""}\nBitte vorher das PDF erstellen, wenn der Ordner auf den Server soll.`
      : "";
    if (!confirm(`Bauvorhaben „${p.number} ${p.title}“ ins Archiv verschieben?\n\nDer Ordner liegt danach vollständig in OneDrive › ${CONFIG.appFolder} › ${CONFIG.rootFolder} › ${CONFIG.archiveFolder} und kann von dort auf den Server verschoben werden.${warnPdf}`)) return;
    moveLocal(p, "archive");
    if (p.remote.folderId) p.moveTo = "archive";
    touchProject(p);
    toast(`${p.number} archiviert.`, "info", 2500);
    go({ selectedProjectId: null, selectedDocId: null }, { replace: true });
  };

  // BV-Nummer ändern (nach Bestätigung)
  const numEl = $("#projNum");
  numEl.addEventListener("input", () => { numEl.value = numEl.value.replace(/\D/g, "").slice(0, 5); });
  numEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") numEl.blur();
    if (e.key === "Escape") { numEl.value = p.number; numEl.blur(); }
  });
  numEl.addEventListener("change", () => {
    const cur = findProject(p.id);
    if (!cur) return;
    const v = numEl.value.trim();
    if (v === cur.number) return;
    if (!/^\d{5}$/.test(v)) {
      toast("Die BV-Nummer muss 5-stellig sein (nur Ziffern).", "warn");
      numEl.value = cur.number;
      return;
    }
    const extra = cur.remote && cur.remote.folderId ? "\nDer Ordner in OneDrive wird automatisch umbenannt." : "";
    if (!confirm(`BV-Nummer von ${cur.number} auf ${v} ändern?${extra}`)) { numEl.value = cur.number; return; }
    const err = renumberProject(cur, v);
    if (err) { toast(err, "warn", 6000); numEl.value = cur.number; return; }
    favoritesChanged(); // Favoriten auf anderen Geräten richtig zuordnen
    toast(`BV-Nummer geändert: ${v}`, "info", 2500);
    renderNow();
  });

  const clientEl = $("#projClient");
  const placeEl = $("#projPlace");
  const onTitle = () => {
    const c = clientEl.value.trim();
    if (!c) return; // Bauherr ist Pflicht
    const cur = findProject(p.id);
    if (!cur) return;
    const before = cur.title;
    setTitleParts(cur, c, placeEl.value);
    if (cur.title !== before) touchProject(cur);
  };
  clientEl.addEventListener("input", onTitle);
  placeEl.addEventListener("input", onTitle);
  clientEl.addEventListener("change", () => { if (!clientEl.value.trim()) clientEl.value = p.client; });
  clientEl.addEventListener("keydown", (e) => { if (e.key === "Enter") placeEl.focus(); });
  placeEl.addEventListener("keydown", (e) => { if (e.key === "Enter") placeEl.blur(); });
  placeEl.addEventListener("input", () => showPlaceGeo(findProject(p.id)));
  attachPlaceSuggest(placeEl, $("#projPlaceList"), (g) => {
    const cur = findProject(p.id);
    if (!cur) return;
    setTitleParts(cur, clientEl.value.trim() || cur.client, g.place);
    cur.geo = g;
    S.state.mapDirty = true;
    touchProject(cur);
    showPlaceGeo(cur);
  });
  showPlaceGeo(p);

  // Inhalt liegt nur online
  if (p.docs === null) {
    $("#newD").disabled = true;
    const c = el(`<div class="card"><p class="muted" id="loadMsg">Inhalt wird aus OneDrive geladen …</p></div>`);
    main.appendChild(c);
    if (!od.isSignedIn() || !navigator.onLine) {
      $("#loadMsg").textContent = "Der Inhalt liegt nur in OneDrive. Bitte anmelden bzw. Internetverbindung herstellen.";
    } else if (!loadingProjects.has(p.id)) {
      loadingProjects.add(p.id);
      sync.loadProject(p).finally(() => {
        loadingProjects.delete(p.id);
        const cur = findProject(p.id);
        if (cur && cur.docs === null) {
          const m = $("#loadMsg");
          if (m) m.textContent = "Laden fehlgeschlagen. " + (sync.status.message || "");
        } else requestRender();
      });
    }
    return;
  }

  $("#newD").onclick = () => {
    const now = new Date();
    const doc = {
      id: newId(),
      title: "Dokumentation",
      date: now.toISOString(),
      updatedAt: Date.now(),
      entries: [],
      remote: {},
    };
    p.docs.push(doc);
    touchDoc(p, doc);
    go({ selectedDocId: doc.id }, { scroll: false });
    const t = $("#docTitle");
    if (t) { t.focus(); t.select(); }
  };

  // ---- Dokumentationen (neueste oben) ----
  const list = el(`<div class="card list-card"><h3 class="section-title">Dokumentationen</h3></div>`);
  if (!p.docs.length) {
    list.appendChild(el(`<div class="empty small"><p class="muted">Noch keine Dokumentationen. Lege mit „+ Neue Dokumentation“ die erste an.</p></div>`));
  }
  p.docs.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).forEach((doc) => {
    const n = imagesOfDoc(doc).length;
    const r = el(`
      <div class="doc-item ${d && d.id === doc.id ? "selected" : ""}" data-doc-id="${h(doc.id)}">
        <div class="grow">
          <div class="doc-title">${h(doc.title)}${doc.protocol && doc.protocol.enabled ? ` <span class="badge-abn">Abnahme</span>` : ""}</div>
          <div class="muted doc-meta">${formatDateDE(doc.date)} · ${doc.entries.length} ${doc.entries.length === 1 ? "Eintrag" : "Einträge"} · ${n} ${n === 1 ? "Foto" : "Fotos"}</div>
        </div>
        <button class="secondary small" data-a="pdf" type="button">PDF</button>
      </div>`);
    r.onclick = (e) => {
      const a = e.target.closest("[data-a]");
      if (a) { e.stopPropagation(); exportPdf(p.id, doc.id); return; }
      if (d && d.id === doc.id) {
        go({ selectedDocId: null }, { scroll: false });
      } else {
        go({ selectedDocId: doc.id }, { replace: !!d, scroll: false });
        const ed = $("#docEditor");
        if (ed && window.innerWidth < 1000) ed.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    list.appendChild(r);
  });
  main.appendChild(list);

  if (d) renderDocEditor(side, p, d);
  else side.appendChild(el(`<div class="card side-hint"><p class="muted">Dokumentation auswählen oder neu anlegen.</p></div>`));
}

async function deleteDoc(pid, did) {
  const p = findProject(pid);
  const d = p && p.docs.find((x) => x.id === did);
  if (!d) return;
  const extra = d.remote && d.remote.folderId ? "\n\nDer Ordner in OneDrive (inkl. Fotos und PDF) wird ebenfalls gelöscht (OneDrive-Papierkorb)." : "";
  if (!confirm(`Dokumentation „${d.title}“ wirklich löschen?${extra}`)) return;
  p.docs = p.docs.filter((x) => x.id !== did);
  p.deletedDocs.push({ id: did, at: Date.now() });
  if (d.remote && d.remote.folderId) p.pendingDeletes.push({ id: d.remote.folderId, parent: p.remote.folderId });
  for (const img of imagesOfDoc(d)) { try { await db.imgDelete(img.id); } catch {} }
  try { await db.outboxDelete(`pdf:${pid}:${did}`); } catch {}
  for (const id of draftImgs[did] || []) { try { await db.imgDelete(id); } catch {} }
  delete draftImgs[did];
  delete drafts[did];
  touchProject(p);
  go({ selectedDocId: null }, { replace: true, scroll: false });
}

/* =========================================================
   Dokumentation bearbeiten
========================================================= */
function toDateInput(iso) {
  const dt = new Date(iso);
  if (isNaN(dt)) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function renderDocEditor(container, p, d) {
  const pend = draftImgs[d.id] || [];
  const card = el(`
    <div class="card" id="docEditor">
      <div class="row space-between">
        <h3 class="section-title">Dokumentation</h3>
        <button class="icon-btn" id="closeDoc" type="button" aria-label="Schließen"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>
      <div class="doc-fields">
        <div class="grow">
          <label class="field-label" for="docTitle">Titel</label>
          <input id="docTitle" type="text" value="${h(d.title)}" enterkeyhint="done" />
        </div>
        <div>
          <label class="field-label" for="docDate">Datum</label>
          <input id="docDate" type="date" value="${toDateInput(d.date)}" />
        </div>
      </div>

      <label class="switch-row">
        <input type="checkbox" id="protoToggle" ${d.protocol && d.protocol.enabled ? "checked" : ""} />
        <span class="switch" aria-hidden="true"></span>
        <span class="switch-text"><strong>Abnahmeprotokoll</strong><span class="muted">mit Anwesenden und Unterschriften</span></span>
      </label>
      <div id="protoBox"></div>

      <div class="new-entry">
        <label class="field-label" for="eText">Neuer Eintrag</label>
        <textarea id="eText" placeholder="Was wurde gemacht / festgestellt?">${h(drafts[d.id] || "")}</textarea>
        <div class="images" id="draftImages">${pend.map((id) => thumbHtml({ id }, true)).join("")}</div>
        <div class="row wrap entry-actions">
          ${photoButtons("newImg")}
          <button type="button" class="primary" id="addE"><span class="long">Eintrag speichern</span><span class="short">Speichern</span></button>
        </div>
      </div>

      <h3 class="section-title">Einträge (${d.entries.length})</h3>
      <div id="elist"></div>

      <div class="row wrap doc-footer">
        <button class="danger-outline" id="delDoc" type="button">Doku löschen</button>
        <button class="primary" id="pdfDoc" type="button">PDF erstellen</button>
      </div>
    </div>`);
  container.appendChild(card);

  $("#closeDoc").onclick = () => go({ selectedDocId: null }, { scroll: false });
  $("#pdfDoc").onclick = () => exportPdf(p.id, d.id);
  $("#delDoc").onclick = () => deleteDoc(p.id, d.id);

  const titleEl = $("#docTitle");
  guardTyping(titleEl);
  titleEl.addEventListener("input", () => {
    const v = titleEl.value.trim().replace(/\s+/g, " ");
    if (!v) return;
    const { p: cp, d: cd } = ctx();
    if (!cd || cd.id !== d.id || cd.title === v) return;
    cd.title = v;
    touchMeta(cp, cd);
    updateProtoStatus();
    const rowTitle = $(`[data-doc-id="${CSS.escape(d.id)}"] .doc-title`);
    if (rowTitle) rowTitle.textContent = v;
  });
  titleEl.addEventListener("change", () => { if (!titleEl.value.trim()) titleEl.value = d.title; });
  titleEl.addEventListener("keydown", (e) => { if (e.key === "Enter") titleEl.blur(); });

  $("#docDate").addEventListener("change", (e) => {
    const v = e.target.value;
    if (guardContentEdit() === false) { e.target.value = toDateInput(d.date); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
    const { p: cp, d: cd } = ctx();
    if (!cd) return;
    cd.date = new Date(v + "T12:00:00").toISOString();
    touchMeta(cp, cd);
    renderNow();
  });

  const tEl = $("#eText");
  tEl.addEventListener("input", () => { drafts[d.id] = tEl.value; saveSoon(); });

  $$("input.newImg", card).forEach((inp) => inp.addEventListener("change", async (ev) => {
    const files = Array.from(ev.target.files || []);
    ev.target.value = "";
    if (!files.length) return;
    const ids = await processFiles(files);
    draftImgs[d.id] = (draftImgs[d.id] || []).concat(ids);
    saveNow();
    renderNow();
  }));

  $$('[data-cam="newImg"]', card).forEach((b) => {
    b.onclick = async () => {
      const files = await captureFromWebcam();
      if (!files.length) return;
      const ids = await processFiles(files);
      draftImgs[d.id] = (draftImgs[d.id] || []).concat(ids);
      saveNow();
      renderNow();
    };
  });

  $$("[data-del-img]", $("#draftImages")).forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      const id = b.dataset.delImg;
      draftImgs[d.id] = (draftImgs[d.id] || []).filter((x) => x !== id);
      saveSoon();
      try { await db.imgDelete(id); } catch {}
      render();
    };
  });

  $("#addE").onclick = () => addEntry();

  $("#protoToggle").addEventListener("change", (e) => {
    const { p: cp, d: cd } = ctx();
    if (!cd) return;
    if (e.target.checked) {
      if (!cd.protocol) cd.protocol = newProtocol(cp);
      cd.protocol.enabled = true;
    } else if (cd.protocol) {
      cd.protocol.enabled = false; // Angaben bleiben erhalten, falls wieder eingeschaltet wird
    }
    touchMeta(cp, cd);
    renderNow();
  });
  if (d.protocol && d.protocol.enabled) renderProtocol($("#protoBox"), p, d);

  renderEntries($("#elist"), p, d);
}

/* ---------- Abnahmeprotokoll: Anwesende + Unterschriften ---------- */
function sigCell(a, code, key) {
  if (a.sig && sigValid(a, code) && isSafeSig(a.sig)) {
    return `<button class="sig-thumb" data-sign="${h(key)}" type="button" title="Unterschrift ändern">
         <img src="${h(a.sig)}" alt="Unterschrift" /><span class="muted">${a.sigAt ? formatDateDE(a.sigAt) : ""}</span>
       </button>`;
  }
  if (a.sig) {
    return `<button class="secondary small sign-btn sig-invalid" data-sign="${h(key)}" type="button" title="Inhalt wurde nach der Unterschrift geändert"><svg class="ico ico-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21c3-1 5-4 7-4s1 3 4 3 4-3 7-3"/><path d="M14.5 4.5l3 3L9 16l-4 1 1-4z"/></svg> Ungültig – neu unterschreiben</button>`;
  }
  return `<button class="secondary small sign-btn" data-sign="${h(key)}" type="button"><svg class="ico ico-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21c3-1 5-4 7-4s1 3 4 3 4-3 7-3"/><path d="M14.5 4.5l3 3L9 16l-4 1 1-4z"/></svg> Unterschreiben</button>`;
}

// Status über den Anwesenden: Prüfcode + Anzahl Unterschriften
function protoStatusHtml(p, d) {
  const code = contentCode(p, d);
  const named = d.protocol.attendees.filter((a) => a.name.trim());
  const signed = validSignatures(d, code).length;
  return `Prüfcode <strong>${code}</strong> · ${signed} von ${named.length} unterschrieben`;
}
function updateProtoStatus() {
  const { p, d } = ctx();
  const elS = $("#protoStatus");
  if (elS && p && d && d.protocol && d.protocol.enabled) elS.innerHTML = protoStatusHtml(p, d);
}

/* Inhalt ändern, obwohl schon unterschrieben wurde?
   Rückgabe: false = abgebrochen, "ok" = keine Unterschriften betroffen,
   "cleared" = bestätigt, Unterschriften wurden entfernt */
function guardContentEdit() {
  const { p, d } = ctx();
  if (!p || !d || !d.protocol || !d.protocol.enabled) return "ok";
  const valid = validSignatures(d, contentCode(p, d));
  if (!valid.length) return "ok";
  const names = valid.map((a) => a.name).filter(Boolean).join(", ");
  const ok = confirm(
    `Dieses Protokoll wurde bereits unterschrieben (${valid.length}${names ? ": " + names : ""}).\n\n` +
    `Wenn du den Inhalt änderst, werden diese Unterschriften ungültig und müssen neu geleistet werden.\n\n` +
    `Trotzdem ändern?`
  );
  if (!ok) return false;
  const now = Date.now();
  for (const a of d.protocol.attendees) { a.sig = null; a.sigAt = null; a.sigCode = null; a.updatedAt = now; }
  for (const k of ["contractor", "client"]) if (d.protocol[k]) { d.protocol[k].sig = null; d.protocol[k].sigAt = null; d.protocol[k].sigCode = null; d.protocol[k].updatedAt = now; }
  touchDoc(p, d);
  const box = $("#protoBox");
  if (box) { box.innerHTML = ""; renderProtocol(box, p, d); }
  toast("Unterschriften entfernt – bitte nach der Änderung neu unterschreiben lassen.", "warn", 5000);
  return "cleared";
}

// Tippen in ein Inhaltsfeld: vorher prüfen
function guardTyping(field) {
  field.addEventListener("beforeinput", (e) => {
    if (guardContentEdit() === false) e.preventDefault();
  });
}

function renderProtocol(box, p, d) {
  const pr = d.protocol;
  box.appendChild(el(`
    <div class="proto">
      <h4>Anwesende</h4>
      <div class="proto-status" id="protoStatus">${protoStatusHtml(p, d)}</div>
      <div id="attList">
        ${pr.attendees.map((a) => `
          <div class="att-row" data-att="${h(a.id)}">
            <input class="att-name" type="text" placeholder="Name" value="${h(a.name)}" autocomplete="off" />
            <input class="att-company" type="text" placeholder="Firma" value="${h(a.company)}" autocomplete="off" />
            <div class="att-sig">${sigCell(a, contentCode(p, d), "att:" + a.id)}</div>
            <button class="icon-btn att-del" data-del-att="${h(a.id)}" type="button" aria-label="Person entfernen"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
          </div>`).join("")}
      </div>
      <button class="secondary small" id="attAdd" type="button">+ Person hinzufügen</button>
      <p class="proto-hint">Ohne Unterschrift bleibt das Feld im PDF frei (z. B. für Papier).</p>
    </div>`));

  const cur = () => {
    const { p: cp, d: cd } = ctx();
    return cd && cd.protocol ? { cp, cd, pr: cd.protocol } : null;
  };

  $$(".att-row", box).forEach((row) => {
    const id = row.dataset.att;
    const upd = () => {
      const c = cur(); if (!c) return;
      const a = c.pr.attendees.find((x) => x.id === id); if (!a) return;
      a.name = $(".att-name", row).value;
      a.company = $(".att-company", row).value;
      touchAttendee(c.cp, c.cd, a);
    };
    $(".att-name", row).addEventListener("input", upd);
    $(".att-company", row).addEventListener("input", upd);
  });
  $$("[data-del-att]", box).forEach((b) => {
    b.onclick = () => {
      const c = cur(); if (!c) return;
      const a = c.pr.attendees.find((x) => x.id === b.dataset.delAtt);
      if (a && a.sig && !confirm(`${a.name || "Person"} hat bereits unterschrieben. Trotzdem entfernen?`)) return;
      deleteAttendee(c.cp, c.cd, b.dataset.delAtt);
      renderNow();
    };
  });
  $("#attAdd").onclick = () => {
    const c = cur(); if (!c) return;
    const id = newId();
    c.pr.attendees.push({ id, name: "", company: "", sig: null, sigAt: null, updatedAt: Date.now() });
    touchDoc(c.cp, c.cd);
    renderNow();
    const inp = $(`[data-att="${CSS.escape(id)}"] .att-name`);
    if (inp) inp.focus();
  };

  $$("[data-sign]", box).forEach((b) => {
    b.onclick = async () => {
      const c = cur(); if (!c) return;
      const [kind, key] = b.dataset.sign.split(":");
      let target, title, subtitle;
      if (kind === "att") {
        target = c.pr.attendees.find((x) => x.id === key);
        if (!target) return;
        if (!target.name.trim()) {
          toast("Bitte zuerst den Namen eintragen.", "warn");
          const nameEl = $(`[data-att="${CSS.escape(key)}"] .att-name`);
          if (nameEl) nameEl.focus();
          return;
        }
        title = `Unterschrift ${target.name}`;
        subtitle = target.company;
      } else {
        target = c.pr[key];
        title = `Unterschrift ${key === "contractor" ? "Auftragnehmer" : "Auftraggeber"}${target.name ? " – " + target.name : ""}`;
        subtitle = key === "contractor" ? CONTRACTOR_COMPANY : (c.cp.client || "");
      }
      const res = await captureSignature({ title, subtitle, canRemove: !!target.sig });
      if (res === undefined) return;
      target.sig = res;
      target.sigAt = res ? Date.now() : null;
      target.sigCode = res ? contentCode(c.cp, c.cd) : null; // Unterschrift gilt für genau diesen Stand
      touchAttendee(c.cp, c.cd, target);
      renderNow();
    };
  });
}

async function processFiles(files) {
  const ids = [];
  try {
    for (let i = 0; i < files.length; i++) {
      setBusy(files.length > 1 ? `Foto ${i + 1}/${files.length} wird verarbeitet …` : "Foto wird verarbeitet …");
      try {
        const r = await processFile(files[i]);
        const id = newId();
        await db.imgPut({ id, archive: r.archive, thumb: r.thumb });
        ids.push(id);
      } catch (e) {
        console.warn(e);
        toast(`Foto „${files[i].name}“: ${e.message}`, "error", 7000);
      }
    }
  } finally {
    setBusy(null);
  }
  return ids;
}

async function addEntry() {
  const { p, d } = ctx();
  if (!d) return;
  const text = (drafts[d.id] || "").trim();
  const imgs = draftImgs[d.id] || [];
  if (!text && !imgs.length) {
    toast("Bitte Beschreibung eingeben oder Fotos hinzufügen.", "warn");
    return;
  }
  if (guardContentEdit() === false) return;
  d.entries.push({ id: newId(), description: text, images: imgs.map((id) => ({ id })), updatedAt: Date.now() });
  drafts[d.id] = "";
  draftImgs[d.id] = [];
  touchDoc(p, d);
  await saveNow();
  renderNow();
  toast("Eintrag gespeichert.", "info", 1800);
}

function renderEntries(container, p, d) {
  if (!d.entries.length) {
    container.appendChild(el(`<p class="muted">Noch keine Einträge.</p>`));
    return;
  }
  d.entries.forEach((en, i) => {
    const c = el(`
      <div class="entry" data-entry-id="${h(en.id)}">
        <div class="row space-between">
          <span class="entry-no">${i + 1}.</span>
          <button class="link-danger small" data-a="del-entry" type="button">Löschen</button>
        </div>
        <textarea class="entryText" placeholder="Beschreibung">${h(en.description)}</textarea>
        <div class="images">${en.images.map((img) => thumbHtml(img, true)).join("")}</div>
        ${photoButtons("entryImg", true)}
      </div>`);

    const findEntry = () => {
      const { p: cp, d: cd } = ctx();
      const ce = cd && cd.entries.find((x) => x.id === en.id);
      return ce ? { cp, cd, ce } : null;
    };

    const ta = $(".entryText", c);
    guardTyping(ta);
    // Fotos zu einem Eintrag hinzufügen ändert den Inhalt -> vorher prüfen
    $$(".photo-btns .file-btn", c).forEach((btn) => btn.addEventListener("click", (e) => {
      if (guardContentEdit() === false) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true));
    ta.addEventListener("input", () => {
      const f = findEntry();
      if (!f) return;
      f.ce.description = ta.value;
      touchEntry(f.cp, f.cd, f.ce);
      updateProtoStatus();
    });

    $('[data-a="del-entry"]', c).onclick = async () => {
      const g = guardContentEdit();
      if (g === false) return;
      if (g === "ok" && !confirm(`Eintrag ${i + 1} wirklich löschen?`)) return;
      const f = findEntry();
      if (!f) return;
      for (const img of f.ce.images) {
        if (img.rid) f.cp.pendingDeletes.push({ id: img.rid, parent: (f.cd.remote || {}).bilderId || null });
        try { await db.imgDelete(img.id); } catch {}
      }
      deleteEntry(f.cp, f.cd, en.id);
      renderNow();
    };

    $$("[data-del-img]", c).forEach((b) => {
      b.onclick = async (e) => {
        e.stopPropagation();
        const g = guardContentEdit();
        if (g === false) return;
        if (g === "ok" && !confirm("Foto löschen?")) return;
        const f = findEntry();
        if (!f) return;
        const img = f.ce.images.find((x) => x.id === b.dataset.delImg);
        if (!img) return;
        f.ce.images = f.ce.images.filter((x) => x !== img);
        if (img.rid) f.cp.pendingDeletes.push({ id: img.rid, parent: (f.cd.remote || {}).bilderId || null });
        try { await db.imgDelete(img.id); } catch {}
        touchEntry(f.cp, f.cd, f.ce);
        renderNow();
      };
    });

    $$("input.entryImg", c).forEach((inp) => inp.addEventListener("change", async (ev) => {
      const files = Array.from(ev.target.files || []);
      ev.target.value = "";
      if (!files.length) return;
      const ids = await processFiles(files);
      const f = findEntry();
      if (!f) return;
      f.ce.images.push(...ids.map((id) => ({ id })));
      touchEntry(f.cp, f.cd, f.ce);
      renderNow();
    }));

    $$('[data-cam="entryImg"]', c).forEach((b) => {
      b.onclick = async () => {
        const files = await captureFromWebcam();
        if (!files.length) return;
        const ids = await processFiles(files);
        const f = findEntry();
        if (!f) return;
        f.ce.images.push(...ids.map((id) => ({ id })));
        touchEntry(f.cp, f.cd, f.ce);
        renderNow();
      };
    });

    container.appendChild(c);
  });
}

// Tippen auf ein Vorschaubild -> Großansicht
document.addEventListener("click", (e) => {
  const im = e.target.closest && e.target.closest("#app img[data-img-id]");
  if (im) openViewer(im.dataset.imgId, im.dataset.rid || null);
});

/* =========================================================
   PDF
========================================================= */
let lastPdf = { blob: null, url: null, name: "dokumentation.pdf" };

async function exportPdf(pid, did) {
  const p = findProject(pid);
  const d = p && p.docs && p.docs.find((x) => x.id === did);
  if (!d) return;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  await saveNow();
  setBusy("PDF wird erstellt …");
  try {
    const { blob, filename, missing, code } = await buildPdf(p, d, (m) => setBusy(m));
    // erzeugte Prüfcodes merken (für "Prüfcode prüfen")
    if (!Array.isArray(d.pdfCodes)) d.pdfCodes = [];
    const last = d.pdfCodes[d.pdfCodes.length - 1];
    if (!last || last.code !== code) {
      d.pdfCodes.push({ code, at: Date.now() });
      if (d.pdfCodes.length > 30) d.pdfCodes.splice(0, d.pdfCodes.length - 30);
      p.rev = (p.rev || 0) + 1;
      p.dirty = true;
      saveSoon();
    }
    const what = d.protocol && d.protocol.enabled ? "Abnahmeprotokoll" : "Dokumentation";
    openPdfPreview(blob, filename, `BV ${p.number}${p.client ? " " + p.client : ""} – ${what} „${d.title}“ vom ${formatDateDE(d.date)}`);
    if (missing) toast(`${missing} Foto(s) konnten nicht geladen werden (offline?).`, "warn", 7000);
    if (blob.size > PDF_MAX_BYTES) toast(`PDF ist ${(blob.size / 1048576).toFixed(1)} MB groß (über 15 MB).`, "warn", 7000);
    if (od.isConfigured()) {
      await db.outboxPut({ id: `pdf:${p.id}:${d.id}`, projectId: p.id, docId: d.id, name: filename, blob });
      await sync.updateOutboxCount();
      sync.schedule(800);
    }
  } catch (e) {
    console.error(e);
    toast("PDF konnte nicht erstellt werden: " + e.message, "error", 8000);
  } finally {
    setBusy(null);
  }
}

function openPdfPreview(blob, filename, shareText = "") {
  if (lastPdf.url) { try { URL.revokeObjectURL(lastPdf.url); } catch {} }
  lastPdf = { blob, url: URL.createObjectURL(blob), name: filename };

  const modal = $("#pdfModal");
  const frame = $("#pdfFrame");
  const pages = $("#pdfPages");
  $("#pdfName").textContent = filename;
  $("#pdfSize").textContent = `${(blob.size / 1048576).toFixed(1)} MB` +
    (od.isConfigured() ? " · wird in OneDrive abgelegt" : "");
  modal.style.display = "block";
  document.body.style.overflow = "hidden";
  if (isTouch) {
    // Handy/Tablet: Seiten direkt in der App anzeigen (Browser können PDFs dort oft nicht öffnen)
    pages.innerHTML = `<p class="muted center">PDF wird angezeigt …</p>`;
    renderPdfPages(blob, pages).catch((e) => {
      console.warn(e);
      pages.innerHTML = `<p class="muted center">Vorschau nicht möglich – bitte „Teilen“ verwenden.</p>`;
    });
  } else {
    frame.src = lastPdf.url;
  }
  try { history.pushState({ ...navState(), pdf: true }, ""); } catch {}

  const close = () => {
    modal.style.display = "none";
    frame.src = "about:blank";
    pages.innerHTML = "";
    document.body.style.overflow = "";
  };
  $("#pdfClose").onclick = () => { if (history.state && history.state.pdf) history.back(); else close(); };
  window.addEventListener("popstate", close, { once: true });

  $("#pdfOpenTab").onclick = () => window.open(lastPdf.url, "_blank");
  $("#pdfDownload").onclick = () => {
    const a = document.createElement("a");
    a.href = lastPdf.url;
    a.download = lastPdf.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  $("#pdfOpenTab").style.display = isTouch ? "none" : "";
  // iPhone: „Speichern“ steckt im Teilen-Menü („In Dateien sichern“)
  $("#pdfDownload").style.display = isIOS && navigator.share ? "none" : "";
  const shareBtn = $("#pdfShare");
  shareBtn.style.display = navigator.share ? "" : "none";
  shareBtn.onclick = async () => {
    try {
      const file = new File([lastPdf.blob], lastPdf.name, { type: "application/pdf" });
      if (navigator.canShare && !navigator.canShare({ files: [file] })) {
        toast("Dieses Gerät kann PDFs nicht direkt teilen – bitte „Speichern“ verwenden.", "warn", 6000);
        return;
      }
      await navigator.share({ files: [file], title: lastPdf.name, text: shareText || lastPdf.name });
    } catch (e) {
      if (!e || e.name !== "AbortError") toast("Teilen nicht möglich – bitte „Öffnen“ oder „Speichern“ verwenden.", "warn");
    }
  };
}

// pdf.js erst bei Bedarf laden (spart Ladezeit beim Start)
let pdfjsPromise = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!pdfjsPromise) {
    pdfjsPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "vendor/pdf.min.js";
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
        resolve(window.pdfjsLib);
      };
      s.onerror = () => { pdfjsPromise = null; reject(new Error("PDF-Anzeige konnte nicht geladen werden")); };
      document.head.appendChild(s);
    });
  }
  return pdfjsPromise;
}

async function renderPdfPages(blob, container) {
  const lib = await loadPdfJs();
  const data = new Uint8Array(await blob.arrayBuffer());
  const doc = await lib.getDocument({ data, isEvalSupported: false }).promise;
  container.innerHTML = "";
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const cssW = Math.min(container.clientWidth - 16, 900);
  for (let n = 1; n <= doc.numPages; n++) {
    if (!container.isConnected || $("#pdfModal").style.display === "none") return;
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = (cssW / base.width) * dpr;
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    canvas.style.width = cssW + "px";
    canvas.className = "pdf-page";
    container.appendChild(canvas);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
  }
  doc.destroy();
}

/* =========================================================
   Einstellungen
========================================================= */
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstall = e;
  if (S.state.view === "settings") requestRender();
});

function installHtml() {
  if (isStandalone()) return `<p>✓ Läuft als App.</p>`;
  if (deferredInstall) return `
    <p class="muted">Stahlwork installieren: eigenes Symbol auf dem Startbildschirm, Vollbild, schneller Start.</p>
    <button class="primary" id="installBtn" type="button">App installieren</button>`;
  if (isIOS) return `
    <p class="muted">So wird Stahlwork auf dem iPhone/iPad installiert:</p>
    <ol class="steps">
      <li>Diese Seite in <strong>Safari</strong> öffnen</li>
      <li>Unten auf <strong>Teilen</strong> tippen (Quadrat mit Pfeil nach oben)</li>
      <li><strong>„Zum Home-Bildschirm“</strong> wählen</li>
    </ol>
    <p class="muted">Wichtig: Als App bleiben die Daten auf dem Gerät dauerhaft gespeichert.</p>`;
  return `<p class="muted">Im Browser-Menü <strong>„App installieren“</strong> bzw. <strong>„Zum Startbildschirm hinzufügen“</strong> wählen. Im Browser am PC funktioniert Stahlwork auch ohne Installation.</p>`;
}

function renderSettings(app) {
  const s = sync.status;
  let odHtml;
  if (!od.isConfigured()) {
    odHtml = `
      <p><strong>Noch nicht eingerichtet.</strong> Stahlwork speichert derzeit nur auf diesem Gerät.</p>
      <p class="muted">Für OneDrive muss die App bei Microsoft registriert und die Anwendungs-ID in <code>js/config.js</code> eingetragen werden (siehe README).</p>`;
  } else if (!od.isSignedIn()) {
    odHtml = `
      <p>Nicht angemeldet.${s.message ? ` <span class="muted">(${h(s.message)})</span>` : ""}</p>
      <p class="muted">Mit dem Firmenkonto anmelden. Danach sind deine Bauvorhaben und Favoriten auf allen deinen Geräten gleich.</p>
      <button class="primary" id="login" type="button">Mit Microsoft anmelden</button>`;
  } else {
    const acc = od.getAccount();
    odHtml = `
      <p>Angemeldet als <strong>${h(acc.name || acc.username)}</strong><br><span class="muted">${h(acc.username || "")}</span></p>
      ${s.kind === "signedout" ? `<div class="auth-expired"><p><strong>Anmeldung abgelaufen.</strong> Es wird gerade nicht synchronisiert – deine Änderungen bleiben auf dem Gerät und werden nach dem Anmelden hochgeladen.</p>
        <button class="primary" id="relogin" type="button">Neu anmelden</button></div>` : ""}
      <p class="muted">Ablage: OneDrive › ${h(CONFIG.appFolder)}<br>
        Zuletzt synchronisiert: ${s.lastSync ? formatDateTimeDE(s.lastSync) : "–"}<br>
        Ausstehend: ${s.pending}${s.kind === "error" ? `<br><span class="error-text">Fehler: ${h(s.message)}</span>` : ""}</p>
      <div class="row wrap">
        <button class="secondary" id="logout" type="button">Abmelden</button>
        <button class="primary" id="syncNow" type="button">Jetzt synchronisieren</button>
      </div>
      <p class="muted" style="margin:14px 0 6px">Verlorenes Handy, fremder oder gemeinsam genutzter PC?</p>
      <button class="danger-outline" id="wipe" type="button">Abmelden und Daten von diesem Gerät löschen</button>`;
  }

  app.appendChild(el(`<div class="page-head"><h1>Einstellungen</h1></div>`));
  app.appendChild(el(`<div class="card"><h3 class="section-title">Konto &amp; OneDrive</h3>${odHtml}</div>`));
  app.appendChild(el(`<div class="card"><h3 class="section-title">App</h3>${installHtml()}</div>`));
  app.appendChild(monSettingsCard());
  app.appendChild(el(`
    <div class="card">
      <h3 class="section-title">Datensicherung</h3>
      <p class="muted">Speichert alle Bauvorhaben und alle Fotos, die auf diesem Gerät liegen, in eine Datei.</p>
      <div class="row wrap">
        <button class="secondary" id="bkExport" type="button">Sicherung speichern</button>
        <label class="file-btn">Sicherung laden
          <input id="bkImport" type="file" accept="application/json,.json" />
        </label>
      </div>
    </div>`));
  app.appendChild(el(`
    <div class="card">
      <h3 class="section-title">Speicher auf diesem Gerät</h3>
      <p class="muted" id="storageInfo">wird ermittelt …</p>
    </div>`));
  app.appendChild(el(`<p class="muted center">Stahlwork ${h(APP_VERSION)}</p>`));

  const reBtn = $("#relogin");
  if (reBtn) reBtn.onclick = async () => { await saveNow(); od.relogin(); };
  const loginBtn = $("#login");
  if (loginBtn) loginBtn.onclick = () => od.login();
  const syncBtn = $("#syncNow");
  if (syncBtn) syncBtn.onclick = async () => { await sync.run({ full: true }); render(); };
  const wipeBtn = $("#wipe");
  if (wipeBtn) wipeBtn.onclick = async () => {
    const pending = sync.status.pending;
    const warn = pending
      ? `\n\nACHTUNG: ${pending} Änderung(en) sind noch NICHT in OneDrive und gehen dabei verloren!`
      : "\n\nIn OneDrive bleibt alles erhalten.";
    if (!confirm(`Alle App-Daten von diesem Gerät löschen und abmelden?${warn}`)) return;
    await resetLocal();
    try { const dbs = await caches.keys(); await Promise.all(dbs.filter((k) => k.startsWith("baudoc-") || k.startsWith("stahlwork-")).map((k) => caches.delete(k))); } catch {}
    od.logout();
  };
  const logoutBtn = $("#logout");
  if (logoutBtn) logoutBtn.onclick = () => {
    if (confirm("Abmelden?\n\nDie Daten bleiben auf diesem Gerät gespeichert, sind aber erst nach erneuter Anmeldung wieder zugänglich.")) od.logout();
  };
  const installBtn = $("#installBtn");
  if (installBtn) installBtn.onclick = async () => {
    try { deferredInstall.prompt(); await deferredInstall.userChoice; } catch {}
    deferredInstall = null;
    render();
  };


  $("#bkExport").onclick = async () => {
    try {
      const r = await exportBackup((m) => setBusy(m));
      if (r.online) toast(`${r.online} Foto(s) liegen nur in OneDrive und sind nur als Vorschau bzw. gar nicht enthalten.`, "warn", 8000);
    } catch (e) {
      toast("Sicherung fehlgeschlagen: " + e.message, "error", 8000);
    } finally { setBusy(null); }
  };
  $("#bkImport").addEventListener("change", async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!f) return;
    if (!confirm("Sicherung laden?\n\nAlle Bauvorhaben auf diesem Gerät werden durch den Inhalt der Sicherung ersetzt.")) return;
    try {
      const r = await importBackup(f, (m) => setBusy(m));
      toast(`Sicherung geladen: ${r.projects} Bauvorhaben, ${r.images} Fotos.`, "info", 6000);
      go({ view: "projects", selectedProjectId: null, selectedDocId: null }, { replace: true });
      sync.schedule(1000, { full: true });
    } catch (e) {
      toast("Laden fehlgeschlagen: " + e.message, "error", 8000);
    } finally { setBusy(null); }
  });

  (async () => {
    const info = $("#storageInfo");
    try {
      const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
      const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
      const mb = (n) => (n / 1048576).toFixed(1) + " MB";
      if (info) {
        info.innerHTML =
          (est ? `Belegt: ${mb(est.usage || 0)}<br>` : "") +
          (persisted || isStandalone()
            ? "Daten sind vor automatischem Löschen geschützt ✓"
            : "Daten sind <strong>nicht</strong> vor automatischem Löschen durch den Browser geschützt. Tipp: Stahlwork installieren (siehe oben).");
      }
    } catch {
      if (info) info.textContent = "Keine Angaben verfügbar.";
    }
  })();
}

/* =========================================================
   Start
========================================================= */
async function cleanupOrphanImages() {
  try {
    const used = new Set();
    for (const p of allProjects()) for (const img of imagesOfProject(p)) used.add(img.id);
    for (const ids of Object.values(draftImgs)) ids.forEach((id) => used.add(id));
    const keys = await db.imgKeys();
    for (const k of keys) if (!used.has(k)) await db.imgDelete(k);
  } catch (e) { console.warn("Aufräumen", e); }
}

// Anderes Konto als zuletzt? Dann nicht die Daten zweier Nutzer vermischen.
async function checkAccount() {
  const acc = od.getAccount();
  if (!acc) return;
  const st = S.state;
  const id = acc.homeAccountId || acc.username;
  if (st.accountId && st.accountId !== id && allProjects().length) {
    const ok = confirm(
      `Angemeldet als ${acc.username}.\n\nAuf diesem Gerät liegen noch Daten eines anderen Kontos. ` +
      `Sollen diese lokalen Daten entfernt werden? (In OneDrive bleibt alles erhalten.)\n\n` +
      `Abbrechen = Daten behalten`
    );
    if (ok) await resetLocal();
  }
  st.accountId = id;
  await saveNow();
}

function setupServiceWorker() {
  // Offline-Speicher: auf der echten Seite (https); lokal nur zum Testen mit ?sw
  if ("serviceWorker" in navigator && (location.protocol === "https:" || (location.hostname === "localhost" && location.search.includes("sw")))) {
    // Erste Installation übernimmt still; jede weitere Übernahme = neue Version -> Hinweis
    let swReady = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" })
      .then((reg) => {
        // beim Zurückkehren in die App nach neuer Version schauen
        document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
      })
      .catch((e) => console.warn("Service Worker", e));
    // neue Version übernommen -> Hinweis mit Knopf (kein automatisches Neuladen beim Tippen)
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!swReady) { swReady = true; return; }
      if ($("#updateBar")) return;
      const bar = el(`<div id="updateBar" class="update-bar"><span>Neue Version von Stahlwork verfügbar</span><button class="primary small" type="button">Jetzt aktualisieren</button></div>`);
      const btn = bar.querySelector("button");
      btn.onclick = async () => {
        updating = true;
        btn.disabled = true;
        btn.textContent = "Wird aktualisiert …";
        // Zustand sichern (höchstens 2 s warten), dann neu laden
        await Promise.race([saveNow().catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
        location.reload();
        setTimeout(() => { location.href = location.pathname; }, 2500); // falls der Browser das Neuladen verweigert
      };
      document.body.appendChild(bar);
    });
  }
}

// Passen Startseite (index.html) und Programm (js) zusammen? Sonst Offline-Speicher erneuern.
function versionMismatch() {
  const m = document.querySelector('meta[name="app-version"]');
  const page = m ? m.content : "(alt)";
  if (page === APP_VERSION) return false;
  console.warn("Versionen passen nicht zusammen", page, APP_VERSION);
  let last = 0;
  try { last = Number(localStorage.getItem("stahlwork-repair") || 0); } catch {}
  if (Date.now() - last > 10 * 60 * 1000 && window.__bootRepair) {
    // einmal automatisch reparieren (höchstens alle 10 Minuten, keine Schleife)
    try { localStorage.setItem("stahlwork-repair", String(Date.now())); } catch {}
    window.__bootRepair();
  } else if (window.__bootShow) {
    window.__bootShow(`Startseite ${page}, Programm ${APP_VERSION}`);
  }
  return true;
}

(async function init() {
  if (versionMismatch()) return;
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch {}
  // zuerst: Offline-Speicher/Updates – damit ein Update auch dann ankommt, wenn der Start hängt
  try { setupServiceWorker(); } catch (e) { console.warn("Service Worker", e); }

  window.__bootStep = "Gerätespeicher lesen";
  try {
    await load();
  } catch (e) {
    if (window.__bootShow) window.__bootShow(`Gerätespeicher konnte nicht gelesen werden: ${e && e.message || e}. Bitte die App bzw. Safari ganz schließen und neu öffnen.`);
    return;
  }
  if (!S.state.drafts || typeof S.state.drafts !== "object") S.state.drafts = {};
  if (!S.state.draftImgs || typeof S.state.draftImgs !== "object") S.state.draftImgs = {};
  drafts = S.state.drafts;
  draftImgs = S.state.draftImgs;

  // Browser schließen, während noch hochgeladen wird -> nachfragen (PC)
  window.addEventListener("beforeunload", (e) => {
    if (updating) return; // "Jetzt aktualisieren": nicht nachfragen (Daten liegen sicher im Gerätespeicher)
    if (od.isSignedIn() && navigator.onLine && (sync.status.kind === "syncing" || sync.status.pending > 0)) {
      saveNow();
      e.preventDefault();
      e.returnValue = "";
    }
  });
  // Startseite ist immer die erste Seite der Sparte: BauDoc "Bauvorhaben", BauMon "Übersicht"
  S.state.view = S.state.sparte === "mon" ? "mon" : "projects";
  S.state.selectedProjectId = null;
  S.state.selectedDocId = null;

  try {
    window.__bootStep = "Anmeldung vorbereiten";
    // Anmeldung vorbereiten – höchstens 10 s warten, damit die App nie an dieser Stelle hängen bleibt
    await Promise.race([od.init(), new Promise((_, rej) => setTimeout(() => rej(new Error("Zeitüberschreitung")), 10000))]);
  } catch (e) {
    console.warn("Anmeldung", e);
    loginError = "Anmeldung fehlgeschlagen: " + (e.message || e);
    toast(loginError, "error", 10000);
  }
  window.__bootStep = "Konto prüfen";
  await checkAccount();

  window.__bootStep = "Anzeige aufbauen";
  setupSearch();
  setupDrawer();
  initMonUI({ el, $, $$, go, render, busy: setBusy, openPdf: openPdfPreview, schedule: () => sync.schedule(2000), account: () => od.getAccount(), projects: () => S.state.projects.slice().sort((a, b) => a.number.localeCompare(b.number)) });
  sync.onStatus(() => { updateSyncChip(); updateAuthBar(); });
  sync.onData(() => requestRender());
  onChange((kind) => {
    if (kind === "data") { sync.refreshStatus(); sync.schedule(4000); }
  });

  try { history.replaceState(navState(), ""); } catch {}
  render();
  window.__appReady = true; // Startwächter (boot.js) Bescheid geben
  await sync.updateOutboxCount();
  cleanupOrphanImages();
  sync.run({ full: true });

  window.addEventListener("online", () => { if (isLocked()) render(); sync.run({ full: true }); });
  window.addEventListener("offline", () => { if (isLocked()) render(); sync.refreshStatus(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveNow();
    else sync.schedule(500, { full: true });
  });
  window.addEventListener("pagehide", () => { saveNow(); });
  setInterval(() => { if (document.visibilityState === "visible") sync.schedule(0, { full: true }); }, 5 * 60 * 1000);

})();
