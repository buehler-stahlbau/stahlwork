/* =========================================================
   OneDrive über Microsoft Graph
   - Anmeldung mit dem Firmenkonto (MSAL, Redirect – funktioniert
     auch in der installierten iPhone-App)
   - Ordner/Dateien anlegen, hochladen, herunterladen
========================================================= */
import { CONFIG } from "./config.js";
import { sleep } from "./util.js";

const GRAPH = "https://graph.microsoft.com/v1.0";
const SMALL_UPLOAD_MAX = 4 * 1024 * 1024 - 1;

let pca = null;
let account = null;

/* Gemeinsame Ablage: Ordner „Stahlwork“ im OneDrive eines anderen Kontos (freigegeben).
   Ohne Eintrag = eigenes OneDrive. Später z. B. das OneDrive der Info-Adresse. */
let ablage = null;
try { ablage = JSON.parse(localStorage.getItem("stahlwork-ablage") || "null"); } catch { ablage = null; }
if (ablage && !(ablage.driveId && ablage.itemId)) ablage = null;
export function getAblage() { return ablage; }
export function setAblage(a) {
  ablage = a && a.driveId && a.itemId ? { driveId: String(a.driveId), itemId: String(a.itemId), owner: String(a.owner || "").slice(0, 120) } : null;
  try { ablage ? localStorage.setItem("stahlwork-ablage", JSON.stringify(ablage)) : localStorage.removeItem("stahlwork-ablage"); } catch {}
}
// Fremdes OneDrive braucht zusätzlich Files.ReadWrite.All (nur dann anfragen – das eigene OneDrive geht ohne)
const scopes = () => (ablage ? [...CONFIG.scopes, "Files.ReadWrite.All"] : CONFIG.scopes);
let authError = null; // z. B. Administratorzustimmung nötig
export function getAuthError() { return authError; }

export class GraphError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export class AuthRequired extends Error {
  constructor() { super("Anmeldung erforderlich"); this.authRequired = true; }
}

export function isConfigured() { return !!(CONFIG.clientId && window.msal); }
export function isSignedIn() { return !!account; }
export function getAccount() { return account; }

// https://buehler-stahlbau.github.io/stahlwork/  (ohne index.html)
export function redirectUri() {
  return location.origin + location.pathname.replace(/[^/]*$/, "");
}

export async function init() {
  if (!isConfigured()) return null;
  pca = new window.msal.PublicClientApplication({
    auth: {
      clientId: CONFIG.clientId,
      authority: `https://login.microsoftonline.com/${CONFIG.tenantId || "organizations"}`,
      redirectUri: redirectUri(),
      postLogoutRedirectUri: redirectUri(),
      navigateToLoginRequestUrl: false,
    },
    cache: { cacheLocation: "localStorage", storeAuthStateInCookie: false },
  });
  let res = null;
  try { localStorage.removeItem("mailCheckPending"); localStorage.removeItem("mailCheckResult"); } catch {}
  try {
    res = await pca.handleRedirectPromise();
  } catch (e) {
    // Zustimmung verweigert / Administrator nötig: App startet trotzdem und zeigt einen Hinweis
    authError = { code: (e && e.errorCode) || "", msg: String((e && e.errorMessage) || e || "").slice(0, 400) };
    console.warn("Anmeldung", e);
  } finally {
    // Anmelde-Antwort (#code=…) sofort aus der Adresse entfernen: beim Neuladen würde
    // sonst der alte, schon verbrauchte Code erneut eingelöst (Fehler AADSTS70008)
    if (/[#&](code|error|state)=/.test(location.hash)) {
      try { history.replaceState(history.state, "", location.pathname + location.search); } catch {}
    }
  }
  account = (res && res.account) || pca.getAllAccounts()[0] || null;
  if (account) pca.setActiveAccount(account);
  return account;
}

export function login() {
  return pca.loginRedirect({ scopes: scopes(), prompt: "select_account" });
}
// Anmeldung abgelaufen (z. B. iPhone nach einiger Zeit): mit demselben Konto neu anmelden,
// meist ohne Passwort, weil Microsoft die Sitzung noch kennt
export function relogin() {
  return pca.loginRedirect({ scopes: scopes(), loginHint: account ? account.username : undefined });
}
export function logout() {
  return pca.logoutRedirect({ account });
}

async function getToken(forceRefresh = false) {
  if (!pca || !account) throw new AuthRequired();
  try {
    const r = await pca.acquireTokenSilent({ scopes: scopes(), account, forceRefresh });
    return r.accessToken;
  } catch (e) {
    if (
      (window.msal.InteractionRequiredAuthError && e instanceof window.msal.InteractionRequiredAuthError) ||
      /interaction_required|login_required|consent_required|no_tokens_found/.test(e && e.errorCode || "")
    ) throw new AuthRequired();
    throw e;
  }
}

/* ---------- Grundfunktion mit Wiederholung bei Drosselung ---------- */
async function gfetch(path, { method = "GET", body, headers = {} } = {}) {
  const url = path.startsWith("https://") ? path : GRAPH + path;
  let force = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    const token = await getToken(force);
    let res;
    try {
      // Zeitlimit bis zur Antwort: schlechtes Handynetz soll den Abgleich nicht endlos blockieren
      const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = ctl && setTimeout(() => ctl.abort(), body ? 120000 : 30000);
      try { res = await fetch(url, { method, body, headers: { Authorization: `Bearer ${token}`, ...headers }, signal: ctl ? ctl.signal : undefined }); }
      finally { if (timer) clearTimeout(timer); }
    } catch (e) {
      if (attempt < 2) { await sleep(1000 * (attempt + 1)); continue; }
      throw new GraphError(0, "Keine Verbindung zu OneDrive");
    }
    if (res.status === 401 && !force) { force = true; continue; }
    if ([429, 500, 502, 503, 504].includes(res.status) && attempt < 5) {
      const ra = Number(res.headers.get("Retry-After"));
      await sleep(ra > 0 ? ra * 1000 : 1000 * 2 ** attempt);
      continue;
    }
    return res;
  }
  throw new GraphError(0, "OneDrive antwortet nicht");
}

async function toError(res) {
  let msg = "";
  try { const j = await res.json(); msg = (j.error && j.error.message) || ""; } catch {}
  return new GraphError(res.status, `OneDrive-Fehler ${res.status}${msg ? ": " + msg : ""}`);
}

async function gjson(path, opts) {
  const res = await gfetch(path, opts);
  if (!res.ok) throw await toError(res);
  return res.status === 204 ? null : res.json();
}

const D = () => (ablage ? `/drives/${iid(ablage.driveId)}` : CONFIG.driveBase);

// OneDrive-Kennungen kommen teils aus Datendateien -> nur gültige Zeichen zulassen
function iid(id) {
  const v = String(id ?? "");
  if (!/^[A-Za-z0-9!._-]{1,200}$/.test(v)) throw new GraphError(400, "Ungültige OneDrive-Kennung");
  return encodeURIComponent(v);
}
const enc = (name) => encodeURIComponent(name);
const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");
const JSON_HDR = { "Content-Type": "application/json" };

/* ---------- Ordner ---------- */
// Eigenes Microsoft-Profil (für die automatische E-Mail-Signatur)
export async function getMyProfile() {
  return gjson("/me?$select=displayName,givenName,surname,jobTitle,businessPhones,mobilePhone,faxNumber,mail,userPrincipalName");
}

export async function getByPath(path) {
  const res = await gfetch(`${D()}/root:/${encPath(path)}`);
  if (res.ok) return res.json();
  if (res.status === 404) return null;
  throw await toError(res);
}

export async function getChild(parentId, name) {
  const res = await gfetch(`${D()}/items/${iid(parentId)}:/${enc(name)}`);
  if (res.ok) return res.json();
  if (res.status === 404) return null;
  throw await toError(res);
}

export async function createFolder(parentId, name, conflict = "fail") {
  const url = parentId ? `${D()}/items/${iid(parentId)}/children` : `${D()}/root/children`;
  const res = await gfetch(url, {
    method: "POST",
    headers: JSON_HDR,
    body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": conflict }),
  });
  if (res.ok) return res.json();
  if (res.status === 409 && conflict === "fail") {
    const existing = parentId ? await getChild(parentId, name) : await getByPath(name);
    if (existing) return existing;
  }
  throw await toError(res);
}

export async function ensureFolder(parentId, name) {
  return (await getChild(parentId, name)) || createFolder(parentId, name, "fail");
}

// Hauptordner der App (darin je Sparte ein Ordner)
export async function getAppFolder() {
  if (ablage) {
    const res = await gfetch(`${D()}/items/${iid(ablage.itemId)}`);
    if (res.ok) return res.json();
    if (res.status === 403 || res.status === 404) throw new GraphError(res.status, "Kein Zugriff auf die gemeinsame Ablage – Freigabe fehlt oder wurde entfernt");
    throw await toError(res);
  }
  return (await getByPath(CONFIG.appFolder)) || createFolder(null, CONFIG.appFolder, "fail");
}

/* ---------- Freigabe des Hauptordners (nur der Besitzer der Ablage) ---------- */
export async function shareAppFolder(email) {
  const app = await getAppFolder();
  return gjson(`${D()}/items/${iid(app.id)}/invite`, {
    method: "POST", headers: JSON_HDR,
    body: JSON.stringify({ recipients: [{ email }], requireSignIn: true, sendInvitation: false, roles: ["write"] }),
  });
}
export async function unshareAppFolder(email) {
  const app = await getAppFolder();
  const j = await gjson(`${D()}/items/${iid(app.id)}/permissions`);
  const want = String(email).toLowerCase();
  let n = 0;
  for (const p of j.value || []) {
    if ((p.roles || []).includes("owner")) continue;
    const users = [p.grantedToV2 && p.grantedToV2.user, p.grantedTo && p.grantedTo.user, ...(p.grantedToIdentitiesV2 || []).map((x) => x.user), ...(p.grantedToIdentities || []).map((x) => x.user)].filter(Boolean);
    if (users.some((u) => String(u.email || u.userPrincipalName || "").toLowerCase() === want)) {
      const res = await gfetch(`${D()}/items/${iid(app.id)}/permissions/${iid(p.id)}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw await toError(res);
      n++;
    }
  }
  return n;
}

// Ordner der Sparte BauDoc: <Hauptordner>/BauDoc
// Ältere Ablage (BauDoc direkt in OneDrive oder unter einem früheren Hauptordner)
// wird als Ganzes verschoben – alle Verknüpfungen (IDs) bleiben dabei gültig.
export async function getRootFolder() {
  if (ablage) { const a = await getAppFolder(); return ensureFolder(a.id, CONFIG.rootFolder); }
  const app = CONFIG.appFolder;
  const path = `${app}/${CONFIG.rootFolder}`;
  const cur = await getByPath(path);
  if (cur) return cur;
  const appDir = (await getByPath(app)) || (await createFolder(null, app, "fail"));
  const olds = [CONFIG.rootFolder, ...(CONFIG.legacyAppFolders || []).map((a) => `${a}/${CONFIG.rootFolder}`)];
  for (const old of olds) {
    const o = await getByPath(old);
    if (o && o.folder && o.id !== appDir.id) {
      await moveItem(o.id, appDir.id);
      const moved = await getByPath(path);
      if (moved) return moved;
    }
  }
  return createFolder(appDir.id, CONFIG.rootFolder, "fail");
}

export async function listChildren(itemId) {
  let url = `${D()}/items/${iid(itemId)}/children?$select=id,name,folder,file,eTag&$top=999`;
  const out = [];
  while (url) {
    const j = await gjson(url);
    out.push(...(j.value || []));
    url = j["@odata.nextLink"] || null;
  }
  return out;
}

export async function renameItem(itemId, name) {
  for (let i = 0; i < 5; i++) {
    const n = i ? `${name} (${i + 1})` : name;
    const res = await gfetch(`${D()}/items/${iid(itemId)}`, { method: "PATCH", headers: JSON_HDR, body: JSON.stringify({ name: n }) });
    if (res.ok) return res.json();
    if (res.status !== 409) throw await toError(res);
  }
  throw new GraphError(409, "Umbenennen nicht möglich – Name schon vergeben");
}

export async function moveItem(itemId, parentId) {
  let res = await gfetch(`${D()}/items/${iid(itemId)}`, {
    method: "PATCH", headers: JSON_HDR, body: JSON.stringify({ parentReference: { id: parentId } }),
  });
  if (res.status === 409) {
    const item = await gjson(`${D()}/items/${iid(itemId)}`);
    res = await gfetch(`${D()}/items/${iid(itemId)}`, {
      method: "PATCH", headers: JSON_HDR,
      body: JSON.stringify({ parentReference: { id: parentId }, name: `${item.name} (${Date.now() % 10000})` }),
    });
  }
  if (!res.ok) throw await toError(res);
  return res.json();
}

export async function getItem(itemId) {
  const res = await gfetch(`${D()}/items/${iid(itemId)}?$select=id,name,parentReference`);
  if (res.ok) return res.json();
  if (res.status === 404) return null;
  throw await toError(res);
}

// Nur ausführen, wenn das Element wirklich im erwarteten Ordner liegt
// (Schutz gegen manipulierte Datendateien)
export async function isChildOf(itemId, parentId) {
  if (!itemId || !parentId) return false;
  const it = await getItem(itemId);
  return !!(it && it.parentReference && it.parentReference.id === parentId);
}

export async function deleteItemIn(itemId, parentId) {
  const it = await getItem(itemId);
  if (!it) return true; // schon weg
  if (!it.parentReference || it.parentReference.id !== parentId) {
    console.warn("Löschen verweigert: Element liegt nicht im erwarteten Ordner", itemId);
    return false;
  }
  await deleteItem(itemId);
  return true;
}

// Gelöschtes landet im OneDrive-Papierkorb
export async function deleteItem(itemId) {
  const res = await gfetch(`${D()}/items/${iid(itemId)}`, { method: "DELETE" });
  if (res.ok || res.status === 404) return;
  throw await toError(res);
}

/* ---------- Dateien ---------- */
export async function uploadFile(parentId, name, blob, contentType = "application/octet-stream") {
  if (blob.size <= SMALL_UPLOAD_MAX) {
    const res = await gfetch(`${D()}/items/${iid(parentId)}:/${enc(name)}:/content`, {
      method: "PUT", headers: { "Content-Type": contentType }, body: blob,
    });
    if (!res.ok) throw await toError(res);
    return res.json();
  }
  return uploadLarge(parentId, name, blob);
}

async function uploadLarge(parentId, name, blob) {
  const session = await gjson(`${D()}/items/${iid(parentId)}:/${enc(name)}:/createUploadSession`, {
    method: "POST", headers: JSON_HDR,
    body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }),
  });
  const CHUNK = 320 * 1024 * 10; // muss ein Vielfaches von 320 KiB sein
  let start = 0;
  let last = null;
  while (start < blob.size) {
    const end = Math.min(start + CHUNK, blob.size);
    let res = null;
    for (let a = 0; a < 4; a++) {
      try {
        res = await fetch(session.uploadUrl, {
          method: "PUT",
          headers: { "Content-Range": `bytes ${start}-${end - 1}/${blob.size}` },
          body: blob.slice(start, end),
        });
        if (res.ok || res.status < 500) break;
      } catch (e) {
        if (a === 3) throw new GraphError(0, "Upload abgebrochen (Verbindung)");
      }
      await sleep(1500 * (a + 1));
    }
    if (!res || !res.ok) throw await toError(res);
    last = res;
    start = end;
  }
  return last.json();
}

async function fetchContent(item) {
  const url = item["@microsoft.graph.downloadUrl"];
  const res = url ? await fetch(url, { cache: "no-store" }) : await gfetch(`${D()}/items/${iid(item.id)}/content`);
  if (!res.ok) throw await toError(res);
  return res;
}

export async function getJson(parentId, name) {
  const item = await getChild(parentId, name);
  if (!item) return null;
  const res = await fetchContent(item);
  return { data: await res.json(), eTag: item.eTag, id: item.id };
}

// eTag = nur überschreiben, wenn sich die Datei seitdem nicht geändert hat
export async function putJson(parentId, name, obj, eTag) {
  const headers = { "Content-Type": "application/json" };
  if (eTag) headers["If-Match"] = eTag;
  const res = await gfetch(`${D()}/items/${iid(parentId)}:/${enc(name)}:/content`, {
    method: "PUT", headers, body: JSON.stringify(obj, null, 1),
  });
  if (res.status === 412) return { conflict: true };
  if (!res.ok) throw await toError(res);
  const j = await res.json();
  return { eTag: j.eTag, id: j.id };
}

export async function downloadBlob(itemId) {
  const item = await gjson(`${D()}/items/${iid(itemId)}`);
  const res = await fetchContent(item);
  return res.blob();
}

// Vorschaubild direkt von OneDrive (spart Datenvolumen)
export async function thumbnail(itemId) {
  const j = await gjson(`${D()}/items/${iid(itemId)}/thumbnails/0/medium`);
  try {
    const res = await fetch(j.url);
    if (res.ok) return { blob: await res.blob() };
  } catch {}
  return { url: j.url };
}
