/* =========================================================
   BauKon – Einteilung der Konstrukteure als PDF (A3 quer, 3 bis 7 Wochen, Mo–Fr)
   Gleiche Darstellung wie in der App: Balken grau (Stahlbau) / braunrot (Rohbau), Ton im Wechsel
   je BV, darunter je Tag das Kürzel; Abwesenheiten farbig über beiden Zeilen.
========================================================= */
import * as K from "./baukon.js";
import { addDays, mondayOf, isoWeek, wdName, shortDate, holiday, today } from "./plan-core.js";
import { pdfSafe, ensureLogo, logoRatio } from "./pdf.js";
import { formatDateTimeDE } from "./util.js";
import { creatorName } from "./store.js";
import { getAccount } from "./onedrive.js";

const RED = [202, 50, 45], DARK = [40, 40, 38], GRAY = [71, 70, 66], MUTED = [125, 124, 119], LINE = [222, 222, 219], WEEK = [120, 118, 112];
// gleiche Farben wie in der App (index.html, .gantt.kon)
export const KON_COLORS = {
  stahl0: [214, 213, 209], stahl1: [184, 182, 176], roh0: [236, 192, 186], roh1: [214, 149, 141],
  urlaub: [58, 166, 96], krank: [243, 166, 50], ausgleich: [159, 211, 106], schule: [255, 224, 58], feiertag: [92, 182, 230], frei: [191, 224, 238],
};
const LABEL = { urlaub: "Urlaub", krank: "Krank", ausgleich: "Ausgleich", schule: "Schule", feiertag: "Feiertag", frei: "frei" };
const SHORT = { urlaub: "U", krank: "K", ausgleich: "A", schule: "S", feiertag: "FT", frei: "–" };

export async function buildKonPdf({ start: from, weeks = 5 }) {
  if (!window.jspdf || !window.jspdf.jsPDF) throw new Error("PDF-Bibliothek nicht geladen");
  const logoData = await ensureLogo();
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "pt", format: "a3", orientation: "landscape", compress: true });
  const _text = pdf.text.bind(pdf);
  pdf.text = (t, ...rest) => _text(Array.isArray(t) ? t.map(pdfSafe) : pdfSafe(t), ...rest);
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
  const ML = 36, FOOT_Y = H - 22, BOTTOM = FOOT_Y - 60;
  const color = (c) => pdf.setTextColor(c[0], c[1], c[2]);
  const fill = (c) => pdf.setFillColor(c[0], c[1], c[2]);
  const draw = (c) => pdf.setDrawColor(c[0], c[1], c[2]);
  const font = (style, size, c = DARK) => { pdf.setFont("helvetica", style); pdf.setFontSize(size); color(c); };
  const hair = (x1, y, x2, c = LINE, w = 0.6) => { draw(c); pdf.setLineWidth(w); pdf.line(x1, y, x2, y); };
  const fit = (txt, maxW) => {
    let t = pdfSafe(txt);
    if (maxW <= 4) return "";
    if (pdf.getTextWidth(t) <= maxW) return t;
    while (t.length > 1 && pdf.getTextWidth(t + "…") > maxW) t = t.slice(0, -1);
    return t.length > 1 ? t + "…" : "";
  };

  const start = mondayOf(from || today());
  const nW = Math.max(3, Math.min(7, weeks));
  const days = [];
  for (let w = 0; w < nW; w++) for (let i = 0; i < 5; i++) days.push(addDays(start, w * 7 + i));
  const last = days.length - 1, end = days[last];
  const kwA = isoWeek(start), kwB = isoWeek(end);
  const title = `KW ${kwA}${kwA !== kwB ? "–" + kwB : ""} · ${shortDate(start)}${start.slice(0, 4) !== end.slice(0, 4) ? start.slice(0, 4) : ""}–${shortDate(end)}${end.slice(0, 4)}`;

  function logo(x, top, maxLw, maxLh) {
    if (!logoData) return;
    let lw = maxLw, lh = lw / logoRatio;
    if (lh > maxLh) { lh = maxLh; lw = lh * logoRatio; }
    try { pdf.addImage(logoData, "PNG", x - lw, top, lw, lh); } catch {}
  }
  function header(first) {
    if (first) {
      font("normal", 8, MUTED);
      pdf.text(["Friedrich Bühler GmbH & Co. KG", "Daimlerstraße 7+11", "72213 Altensteig"], ML, 34, { lineHeightFactor: 1.35 });
      logo(W - ML, 22, 140, 36);
      hair(ML, 70, W - ML);
      fill(RED); pdf.rect(ML, 69, 46, 2, "F");
      font("bold", 7.5, RED); pdf.setCharSpace(1); pdf.text("EINTEILUNG KONSTRUKTION", ML, 90); pdf.setCharSpace(0);
      font("bold", 15, DARK); pdf.text(title, ML, 108);
      return 124;
    }
    font("bold", 7.5, RED); pdf.setCharSpace(1); pdf.text("EINTEILUNG KONSTRUKTION", ML, 30); pdf.setCharSpace(0);
    font("normal", 9, GRAY); pdf.text(title, ML, 43);
    logo(W - ML, 20, 100, 26);
    hair(ML, 54, W - ML);
    return 70;
  }

  const NAME_W = 120;
  const gx = ML + NAME_W, gw = W - ML - gx, cw = gw / days.length;
  const colX = (i) => gx + i * cw;
  const L1 = 14, L2 = 11, ROW = L1 + L2;
  let y = header(true);

  function gridHead() {
    font("bold", 8, DARK);
    for (let w = 0; w < nW; w++) {
      const x0 = colX(w * 5), x1 = colX(w * 5 + 5);
      pdf.text(`KW ${isoWeek(days[w * 5])}`, (x0 + x1) / 2, y + 9, { align: "center" });
    }
    days.forEach((d, i) => {
      const hol = holiday(d);
      if (hol) { fill(KON_COLORS.feiertag); pdf.rect(colX(i), y + 13, cw, 15, "F"); }
      font(hol ? "bold" : "normal", 7, hol ? [255, 255, 255] : MUTED);
      pdf.text(`${wdName(d)} ${Number(d.slice(8))}.`, colX(i) + cw / 2, y + 23, { align: "center" });
    });
    font("bold", 7.5, MUTED); pdf.text("Konstrukteur", ML, y + 23);
    y += 28;
    hair(ML, y, W - ML, GRAY, 0.6);
  }
  gridHead();
  const top0 = y;
  const weekLines = (y0, y1) => { for (let w = 1; w < nW; w++) { draw(WEEK); pdf.setLineWidth(1.4); pdf.line(colX(w * 5), y0, colX(w * 5), y1); } };
  let blockTop = top0;
  const col = (d, dir) => {
    let x = dir > 0 ? K.nextWeekday(d) : K.prevWeekday(d);
    if (x < days[0]) x = days[0];
    if (x > end) x = end;
    return days.indexOf(x);
  };

  for (const k of K.sortedKonstrukteure()) {
    if (y + ROW > BOTTOM) {
      weekLines(blockTop, y);
      pdf.addPage();
      y = header(false);
      gridHead();
      blockTop = y;
    }
    // Name + Kennzeichen
    font("bold", 8.5, DARK);
    pdf.text(fit(k.name + (k.azubi ? "  A" : "") + (k.teilzeit ? "  T" : ""), NAME_W - 8), ML, y + ROW / 2 + 3);
    // Balken
    const zs = K.list("zuteilungen").filter((z) => z.kId === k.id).sort((a, b) => a.von.localeCompare(b.von) || a.id.localeCompare(b.id));
    zs.forEach((z, idx) => {
      if (z.bis < days[0] || z.von > end) return;
      const s = col(z.von < days[0] ? days[0] : z.von, 1), e = col(z.bis > end ? end : z.bis, -1);
      if (s < 0 || e < s) return;
      const art = K.artOf(z);
      const x0 = colX(s) + 1, x1 = colX(e + 1) - 1;
      if (art) { fill(KON_COLORS[art + (idx % 2)]); pdf.rect(x0, y + 1.5, x1 - x0, ROW - 3, "F"); }
      else { fill([255, 255, 255]); draw([150, 148, 143]); pdf.setLineWidth(0.7); pdf.rect(x0, y + 1.5, x1 - x0, ROW - 3, "FD"); }
      font("bold", 7.5, DARK);
      const lbl = [z.bvNumber, z.baustelle].filter(Boolean).join(" ") + (z.text ? " · " + z.text : "");
      pdf.text(fit(lbl, x1 - x0 - 6), x0 + 3, y + 10.5);
      font("bold", 7, DARK);
      for (let i = s; i <= e; i++) {
        const c = (z.codes || {})[days[i]];
        if (c) pdf.text(c, colX(i) + cw / 2, y + L1 + 7.5, { align: "center" });
      }
    });
    // Abwesenheit / Schule / frei / Feiertag über beiden Zeilen
    let run = null;
    const flush = () => {
      if (!run) return;
      const x0 = colX(run.s) + 0.5, x1 = colX(run.e + 1) - 0.5;
      fill(KON_COLORS[run.typ]); pdf.rect(x0, y + 0.5, x1 - x0, ROW - 1, "F");
      font("bold", 7, run.typ === "urlaub" || run.typ === "feiertag" ? [255, 255, 255] : DARK);
      const t = run.e > run.s ? LABEL[run.typ] : SHORT[run.typ];
      pdf.text(fit(t, x1 - x0 - 4), (x0 + x1) / 2, y + ROW / 2 + 2.5, { align: "center" });
      run = null;
    };
    days.forEach((d, i) => {
      const info = K.dayInfo(k, d);
      const key = info ? (info.rec ? "a:" + info.rec.id : info.typ) : null;
      if (run && (key !== run.key || i % 5 === 0)) flush();
      if (!info) return;
      if (!run) run = { key, typ: info.typ, s: i, e: i }; else run.e = i;
    });
    flush();
    y += ROW;
    hair(ML, y, W - ML, LINE, 0.5);
  }
  weekLines(blockTop, y);

  // Legende
  y += 14;
  if (y > FOOT_Y - 30) { pdf.addPage(); y = header(false); }
  let lx = ML;
  const leg = (c, t, border) => {
    fill(c); if (border) { draw([150, 148, 143]); pdf.setLineWidth(0.7); pdf.rect(lx, y - 7, 14, 9, "FD"); } else pdf.rect(lx, y - 7, 14, 9, "F");
    font("normal", 7.5, GRAY); pdf.text(t, lx + 18, y);
    lx += 18 + pdf.getTextWidth(t) + 14;
  };
  leg([255, 255, 255], "Platzhalter", true);
  leg(KON_COLORS.stahl0, "Stahlbau"); leg(KON_COLORS.roh0, "Rohbau");
  for (const t of ["urlaub", "krank", "ausgleich", "schule", "frei", "feiertag"]) leg(KON_COLORS[t], t === "frei" ? "frei (Teilzeit)" : LABEL[t]);
  y += 13;
  font("normal", 7.5, GRAY);
  pdf.text(`Stahlbau: ${K.STAHL.map((c) => `${c} ${K.CODE_NAMES[c]}`).join(" · ")}     Rohbau: ${K.ROH.map((c) => `${c} ${K.CODE_NAMES[c]}`).join(" · ")}     A = Azubi · T = Teilzeit`, ML, y);

  /* ---------- Fußzeile ---------- */
  const total = pdf.getNumberOfPages();
  const created = formatDateTimeDE(new Date());
  const by = creatorName(getAccount());
  for (let n = 1; n <= total; n++) {
    pdf.setPage(n);
    hair(ML, FOOT_Y - 9, W - ML);
    font("normal", 7, MUTED);
    pdf.text(`Stand ${created}${by ? " · erstellt von " + pdfSafe(by) : ""}`, ML, FOOT_Y);
    pdf.text(`Seite ${n} von ${total}`, W - ML, FOOT_Y, { align: "right" });
  }
  const blob = pdf.output("blob");
  return { blob, filename: `Einteilung Konstruktion KW${kwA}${kwA !== kwB ? "-" + kwB : ""} ${start.slice(0, 4)}.pdf` };
}
