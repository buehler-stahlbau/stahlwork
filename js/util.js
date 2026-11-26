/* =========================================================
   Hilfsfunktionen
========================================================= */

// Für Text in HTML UND in Attributen (value="...") – inkl. Anführungszeichen
export function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const pad = (n) => String(n).padStart(2, "0");

// TT.MM.JJJJ
export function formatDateDE(dateLike) {
  const dt = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (isNaN(dt.getTime())) return "";
  return `${pad(dt.getDate())}.${pad(dt.getMonth() + 1)}.${dt.getFullYear()}`;
}

export function formatDateTimeDE(dateLike) {
  const dt = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (isNaN(dt.getTime())) return "";
  return `${formatDateDE(dt)} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

export function isoDay(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Eindeutige, lesbare ID – wird auch als Dateiname der Bilder verwendet
// z. B. 20261118-143512-04701a3f9 (Datum-Uhrzeit-Millisekunden, Zähler, Zufall).
// Alphabetisch sortiert = Reihenfolge der Entstehung, auch bei mehreren IDs in derselben Sekunde
// (wichtig: Einträge werden auf allen Geräten nach der ID sortiert).
let idMs = 0, idSeq = 0;
export function newId() {
  const d = new Date();
  const ms = d.getTime();
  idSeq = ms <= idMs ? idSeq + 1 : 0;
  idMs = Math.max(ms, idMs);
  const rnd = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${String(d.getMilliseconds()).padStart(3, "0")}${(idSeq & 0xff).toString(16).padStart(2, "0")}${rnd}`;
}

// Gültiger Datei-/Ordnername für OneDrive
export function sanitizeName(s) {
  let n = String(s ?? "")
    .replace(/[\\/:*?"<>|#%\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  if (n.length > 120) n = n.slice(0, 120).trim();
  return n || "Unbenannt";
}

// "12345 Neubau Lagerhalle"
export function projectLabel(p) {
  return p.title ? `${p.number} ${p.title}` : String(p.number);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- Toast-Meldungen ---------- */
export function toast(msg, kind = "info", ms = 4500) {
  let box = document.getElementById("toasts");
  if (!box) {
    box = document.createElement("div");
    box.id = "toasts";
    document.body.appendChild(box);
  }
  const t = document.createElement("div");
  t.className = "toast " + kind;
  t.textContent = msg;
  t.onclick = () => t.remove();
  // immer nur eine Meldung gleichzeitig: die neue ersetzt die alte
  box.replaceChildren(t);
  setTimeout(() => t.remove(), ms);
}

/* ---------- Dateien speichern / teilen ---------- */
export async function saveOrShareFile(blob, filename) {
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (isMobile && navigator.canShare) {
    try {
      const file = new File([blob], filename, { type: blob.type });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return;
      }
    } catch (e) {
      if (e && e.name === "AbortError") return;
      console.warn("Teilen fehlgeschlagen, lade herunter", e);
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
