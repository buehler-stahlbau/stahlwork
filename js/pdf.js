/* =========================================================
   PDF-Export
   - Anschrift links + Logo rechts, Seitenzahlen unten rechts
   - Bilder 3 Spalten, proportional
   - Bilder werden so komprimiert, dass das PDF ≤ 15 MB bleibt
========================================================= */
import * as db from "./db.js";
import * as od from "./onedrive.js";
import { toPdfImage } from "./images.js";
import { formatDateDE, formatDateTimeDE, sanitizeName, isoDay } from "./util.js";
import { contentCode, sigValid, isSafeSig } from "./integrity.js";
import { imagesOfDoc } from "./store.js";

export const PDF_MAX_BYTES = 15 * 1024 * 1024;
const IMG_BUDGET = 13.5 * 1024 * 1024;
const LEVELS = [
  [1600, 0.65],
  [1400, 0.55],
  [1200, 0.5],
  [1000, 0.45],
  [800, 0.4],
];

let logoDataURL = null;
export let logoRatio = 1005 / 248; // Breite : Höhe, wird beim Laden aus der Datei gelesen
export async function ensureLogo() {
  if (logoDataURL) return logoDataURL;
  try {
    const resp = await fetch("logo.png", { cache: "no-store" });
    if (!resp.ok) throw new Error("logo.png nicht gefunden");
    const blob = await resp.blob();
    logoDataURL = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    await new Promise((resolve) => {
      const im = new Image();
      im.onload = () => { if (im.naturalWidth && im.naturalHeight) logoRatio = im.naturalWidth / im.naturalHeight; resolve(); };
      im.onerror = resolve;
      im.src = logoDataURL;
    });
  } catch (e) {
    console.warn("Logo konnte nicht geladen werden", e);
    logoDataURL = null;
  }
  return logoDataURL;
}

export async function sourceBlob(img) {
  const rec = await db.imgGet(img.id);
  if (rec && rec.archive) return rec.archive;
  if (img.rid && od.isSignedIn() && navigator.onLine) {
    try { return await od.downloadBlob(img.rid); } catch (e) { console.warn("Bild-Download", e); }
  }
  return (rec && rec.thumb) || null; // Notlösung: Vorschaubild
}

/* Die PDF-Standardschrift kann nur den westeuropäischen Zeichensatz (Windows-1252).
   Emojis und Sonderzeichen außerhalb davon würden als Zeichensalat erscheinen. */
const CP1252_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
const PDF_MAP = {
  "→": "->", "←": "<-", "↑": "^", "↓": "v", "⇒": "=>", "≤": "<=", "≥": ">=", "≠": "!=", "≈": "~",
  "✓": "(ok)", "✔": "(ok)", "✗": "(x)", "✘": "(x)", "Ω": "Ohm", "∅": "Ø", "−": "-", "‑": "-",
  "\u00A0": " ", "\u2009": " ", "\u202F": " ", "\u2007": " ",
};
export function pdfSafe(text) {
  let out = "";
  for (const ch of String(text ?? "")) {
    const c = ch.codePointAt(0);
    if (ch === "\n" || ch === "\t" || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || CP1252_EXTRA.includes(ch)) out += ch;
    else if (PDF_MAP[ch]) out += PDF_MAP[ch];
    // alles andere (z. B. Emojis) entfällt
  }
  return out.replace(/ {2,}/g, " ");
}

export function pdfFilename(p, d) {
  const dt = new Date(d.date);
  const day = isNaN(dt) ? "" : isoDay(dt) + " ";
  const kind = d.protocol && d.protocol.enabled && !/abnahme/i.test(d.title || "") ? "Abnahmeprotokoll " : "";
  return `${p.number} ${day}${kind}${sanitizeName(d.title || "Dokumentation")}.pdf`;
}

export async function buildPdf(p, d, onProgress = () => {}) {
  const code = contentCode(p, d);
  if (!window.jspdf || !window.jspdf.jsPDF) throw new Error("PDF-Bibliothek nicht geladen");
  const { jsPDF } = window.jspdf;

  // ---- Bilder sammeln ----
  const all = imagesOfDoc(d);
  const sources = new Map();
  let missing = 0;
  for (let i = 0; i < all.length; i++) {
    onProgress(`Bilder laden ${i + 1}/${all.length} …`);
    const b = await sourceBlob(all[i]);
    if (b) sources.set(all[i].id, b);
    else missing++;
  }

  // ---- Bilder für PDF aufbereiten (bei Bedarf stärker komprimieren) ----
  let converted = new Map();
  for (const [maxDim, q] of LEVELS) {
    converted = new Map();
    let total = 0;
    let j = 0;
    for (const [id, blob] of sources) {
      onProgress(`Bilder aufbereiten ${++j}/${sources.size} …`);
      try {
        const r = await toPdfImage(blob, maxDim, q);
        converted.set(id, r);
        total += r.data.length * 0.75;
      } catch (e) {
        console.warn("Bild nicht lesbar", e);
      }
    }
    if (total <= IMG_BUDGET) break;
  }

  onProgress("PDF wird erstellt …");
  await ensureLogo();

  const pdf = new jsPDF({ unit: "pt", format: "a4", compress: true });
  // alle Texte automatisch auf darstellbare Zeichen umstellen
  const _text = pdf.text.bind(pdf);
  pdf.text = (t, ...rest) => _text(Array.isArray(t) ? t.map(pdfSafe) : pdfSafe(t), ...rest);
  const _split = pdf.splitTextToSize.bind(pdf);
  pdf.splitTextToSize = (t, ...rest) => _split(pdfSafe(t), ...rest);
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  /* ---------- Gestaltung ---------- */
  const ML = 48;                         // Rand links/rechts
  const maxW = pageWidth - 2 * ML;
  const FOOT_Y = pageHeight - 34;        // Fußzeile
  const BOTTOM = FOOT_Y - 18;            // Inhalt endet hier
  const RED = [202, 50, 45];
  const DARK = [40, 40, 38];
  const GRAY = [71, 70, 66];
  const MUTED = [125, 124, 119];
  const LINE = [222, 222, 219];
  const SOFT = [246, 246, 244];
  const proto = d.protocol && d.protocol.enabled ? d.protocol : null;
  const kicker = proto ? "ABNAHMEPROTOKOLL" : "BAUDOKUMENTATION";
  const color = (c) => pdf.setTextColor(c[0], c[1], c[2]);
  const font = (style, size, c = DARK) => { pdf.setFont("helvetica", style); pdf.setFontSize(size); color(c); };
  const spaced = (txt, x, yy, space = 1.1, opts = {}) => {
    pdf.setCharSpace(space);
    pdf.text(txt, x, yy, opts);
    pdf.setCharSpace(0);
  };
  const hair = (x1, yy, x2, c = LINE, w = 0.6) => { pdf.setDrawColor(c[0], c[1], c[2]); pdf.setLineWidth(w); pdf.line(x1, yy, x2, yy); };

  function logo(x, top, maxLw, maxLh) {
    if (!logoDataURL) return 0;
    let lw = maxLw;
    let lh = lw / logoRatio;
    if (lh > maxLh) { lh = maxLh; lw = lh * logoRatio; }
    try { pdf.addImage(logoDataURL, "PNG", x - lw, top, lw, lh); } catch (e) { console.warn("Logo nicht ins PDF", e); }
    return lh;
  }

  // Kopf Seite 1: Anschrift links, Logo rechts, feine Linie mit rotem Akzent
  function headerFirst() {
    font("normal", 8.5, MUTED);
    pdf.text(["Friedrich Bühler GmbH & Co. KG", "Daimlerstraße 7+11", "72213 Altensteig"], ML, 44, { lineHeightFactor: 1.35 });
    logo(pageWidth - ML, 30, 150, 40);
    hair(ML, 86, pageWidth - ML);
    pdf.setFillColor(RED[0], RED[1], RED[2]);
    pdf.rect(ML, 85, 46, 2, "F");
    return 112;
  }
  // Kopf Folgeseiten: kompakt
  function headerNext() {
    font("bold", 7.5, RED);
    spaced(kicker, ML, 40, 1);
    font("normal", 9, GRAY);
    pdf.text(`BV ${p.number} · ${d.title || "Dokumentation"}`, ML, 53, { maxWidth: maxW - 130 });
    logo(pageWidth - ML, 30, 100, 26);
    hair(ML, 66, pageWidth - ML);
    return 88;
  }

  let y = headerFirst();
  function newPage() {
    pdf.addPage();
    y = headerNext();
  }
  function ensureSpace(h) {
    if (y + h > BOTTOM) newPage();
  }
  const usableH = BOTTOM - 88;

  /* ---------- Titelblock ---------- */
  font("bold", 9, RED);
  spaced(kicker, ML, y, 1.6);
  y += 22;
  font("bold", 21, DARK);
  const titleLines = pdf.splitTextToSize(d.title || "Dokumentation", maxW);
  pdf.text(titleLines, ML, y, { lineHeightFactor: 1.15 });
  y += 21 * 1.15 * (titleLines.length - 1) + 16;

  // Infokasten: BV-Nr. | Bauherr | Bauort | Datum
  // Zeilen begrenzen; gekürzter Text bekommt "…"
  const clamp = (lines, n) => {
    if (lines.length <= n) return lines;
    const out = lines.slice(0, n);
    out[n - 1] = out[n - 1].replace(/[\s,;:–-]*$/, "") + " …";
    return out;
  };
  const fields = [
    ["BV-NR.", p.number, 0.15],
    ["BAUHERR / AUFTRAGGEBER", p.client || p.title || "–", 0.37],
    ["BAUORT", p.place || "–", 0.30],
    ["DATUM", formatDateDE(d.date), 0.18],
  ];
  const padX = 12;
  const innerW = maxW - 2 * padX;
  font("normal", 10.5, DARK);
  const valLines = fields.map(([, v, w]) => clamp(pdf.splitTextToSize(String(v), innerW * w - 10), 3));
  const boxH = 30 + Math.max(...valLines.map((l) => l.length)) * 13;
  pdf.setFillColor(SOFT[0], SOFT[1], SOFT[2]);
  pdf.setDrawColor(LINE[0], LINE[1], LINE[2]);
  pdf.setLineWidth(0.6);
  pdf.roundedRect(ML, y, maxW, boxH, 4, 4, "FD");
  let fx = ML + padX;
  fields.forEach(([label, , w], i) => {
    font("bold", 6.8, MUTED);
    spaced(label, fx, y + 15, 0.8);
    font(i === 0 ? "bold" : "normal", 10.5, i === 0 ? RED : DARK);
    pdf.text(valLines[i], fx, y + 29, { lineHeightFactor: 1.2 });
    fx += innerW * w;
  });
  y += boxH + 26;

  // Abschnittsüberschrift
  function section(title) {
    ensureSpace(46);
    font("bold", 8.5, GRAY);
    spaced(title, ML, y, 1.3);
    y += 6;
    hair(ML, y, pageWidth - ML);
    y += 16;
  }

  // Unterschrift (PNG) in einen Rahmen einpassen
  async function drawSig(sig, x, top, boxW, boxH2) {
    if (!isSafeSig(sig)) return;
    try {
      const dim = await new Promise((resolve) => {
        const im = new Image();
        im.onload = () => resolve({ w: im.naturalWidth || 1, h: im.naturalHeight || 1 });
        im.onerror = () => resolve({ w: 3, h: 1 });
        im.src = sig;
      });
      const sc = Math.min(boxW / dim.w, boxH2 / dim.h);
      const w = dim.w * sc;
      const hgt = dim.h * sc;
      pdf.addImage(sig, "PNG", x, top + (boxH2 - hgt), w, hgt);
    } catch (e) { console.warn("Unterschrift nicht ins PDF", e); }
  }

  /* ---------- Anwesende ---------- */
  const attendees = proto ? proto.attendees.filter((a) => a.name || a.company || a.sig) : [];
  if (proto && attendees.length) {
    section("ANWESENDE");
    const colW = [maxW * 0.32, maxW * 0.36, maxW * 0.32];
    const rowH = 38;
    const tableHead = () => {
      pdf.setFillColor(SOFT[0], SOFT[1], SOFT[2]);
      pdf.rect(ML, y - 11, maxW, 18, "F");
      font("bold", 7, MUTED);
      spaced("NAME", ML + 8, y, 0.8);
      spaced("FIRMA", ML + colW[0] + 8, y, 0.8);
      spaced("UNTERSCHRIFT", ML + colW[0] + colW[1] + 8, y, 0.8);
      y += 7;
    };
    ensureSpace(26 + rowH * Math.min(2, attendees.length));
    tableHead();
    for (const a of attendees) {
      if (y + rowH > BOTTOM) { newPage(); tableHead(); }
      font("normal", 10, DARK);
      const nameL = clamp(pdf.splitTextToSize(a.name || "", colW[0] - 14), 2);
      const compL = clamp(pdf.splitTextToSize(a.company || "", colW[1] - 14), 2);
      const mid = y + rowH / 2 + 3.5;
      pdf.text(nameL, ML + 8, mid - (nameL.length > 1 ? 6 : 0), { lineHeightFactor: 1.2 });
      font("normal", 10, GRAY);
      pdf.text(compL, ML + colW[0] + 8, mid - (compL.length > 1 ? 6 : 0), { lineHeightFactor: 1.2 });
      const sx = ML + colW[0] + colW[1] + 8;
      if (sigValid(a, code)) {
        await drawSig(a.sig, sx, y + 4, colW[2] - 20, rowH - 9);
      } else {
        // Platz zum Unterschreiben (z. B. auf Papier)
        pdf.setDrawColor(190, 190, 186);
        pdf.setLineWidth(0.5);
        pdf.setLineDashPattern([1.5, 2], 0);
        pdf.line(sx, y + rowH - 9, ML + maxW - 10, y + rowH - 9);
        pdf.setLineDashPattern([], 0);
      }
      y += rowH;
      hair(ML, y, pageWidth - ML);
    }
    y += 26;
  }

  /* ---------- Einträge ---------- */
  const cols = 3;
  const gap = 10;
  const indent = 24;
  const gridW = maxW - indent;
  const slotW = (gridW - gap * (cols - 1)) / cols;
  const fontSize = 10.5;
  const LHF = 1.38;

  if (d.entries.length) section(proto ? "FESTSTELLUNGEN" : "EINTRÄGE");

  for (let idx = 0; idx < d.entries.length; idx++) {
    const en = d.entries[idx];
    font("normal", fontSize, DARK);
    pdf.setLineHeightFactor(LHF);
    const lineH = fontSize * LHF;
    const lines = (en.description || "").trim() ? pdf.splitTextToSize(en.description.trim(), maxW - indent) : [];

    const infos = (en.images || []).map((i) => converted.get(i.id)).filter(Boolean);
    const capH = 12;
    const rowHeight = (row) => Math.min(usableH - capH - 30, row.reduce((mx, it) => Math.max(mx, slotW * (it.h / it.w)), 0));
    const firstRowH = infos.length ? rowHeight(infos.slice(0, cols)) + capH : 0;

    // Nummer + Text + erste Bildreihe möglichst zusammenhalten
    const blockH = Math.max(lineH, lines.length * lineH) + 8 + firstRowH;
    if (blockH <= usableH) ensureSpace(blockH);
    else ensureSpace(lineH * 2);

    // Nummer in rotem Kreis
    pdf.setFillColor(RED[0], RED[1], RED[2]);
    pdf.circle(ML + 8, y + 6, 8, "F");
    font("bold", idx + 1 >= 10 ? 7.5 : 8.5, [255, 255, 255]);
    pdf.text(String(idx + 1), ML + 8, y + 9, { align: "center" });

    font("normal", fontSize, DARK);
    if (lines.length) {
      for (const line of lines) {
        ensureSpace(lineH);
        pdf.text(line, ML + indent, y, { baseline: "top" });
        y += lineH;
      }
    } else {
      y += lineH;
    }
    y += 6;

    for (let i = 0; i < infos.length; i += cols) {
      const row = infos.slice(i, i + cols);
      const rowH = rowHeight(row);
      ensureSpace(rowH + capH);
      let x = ML + indent;
      row.forEach((it, k) => {
        let w = slotW;
        let hgt = slotW * (it.h / it.w);
        if (hgt > rowH) { w = w * (rowH / hgt); hgt = rowH; }
        try { pdf.addImage(it.data, "JPEG", x, y, w, hgt); } catch (e) { console.warn("Bild nicht ins PDF", e); }
        pdf.setDrawColor(LINE[0], LINE[1], LINE[2]);
        pdf.setLineWidth(0.5);
        pdf.rect(x, y, w, hgt);
        font("normal", 7, MUTED);
        pdf.text(`Bild ${idx + 1}.${i + k + 1}`, x, y + hgt + 9);
        x += slotW + gap;
      });
      y += rowH + capH + 6;
    }
    pdf.setLineHeightFactor(1.15);

    if (idx < d.entries.length - 1) {
      y += 4;
      hair(ML + indent, y, pageWidth - ML, [236, 236, 233], 0.5);
      y += 16;
    }
  }

  /* ---------- Fußzeile + Prüfcode auf jeder Seite ---------- */
  const total = pdf.getNumberOfPages();
  const created = formatDateTimeDE(new Date());
  for (let n = 1; n <= total; n++) {
    pdf.setPage(n);
    // Fußzeile nur mit Seitenzahl (Firma, BV und Titel stehen schon im Kopf)
    hair(ML, FOOT_Y - 10, pageWidth - ML);
    font("normal", 7.5, MUTED);
    pdf.text(`Seite ${n} von ${total}`, pageWidth - ML, FOOT_Y, { align: "right" });
    // Prüfcode dezent senkrecht am linken Rand
    font("normal", 6.5, [170, 170, 166]);
    pdf.text(`BauDoc · Prüfcode ${code} · erstellt ${created}`, 22, FOOT_Y - 10, { angle: 90 });
  }
  color(DARK);

  const blob = pdf.output("blob");
  return { blob, filename: pdfFilename(p, d), missing, code };
}
