/* =========================================================
   BauMon – Planung als PDF (A4 quer)
   Kopf wie bei BauDoc: Anschrift links, Logo rechts, Linie mit rotem Akzent.
   Seite(n) 1: Zeitplan (Trupps × Tage), danach Liste aller Einsätze.
========================================================= */
import * as M from "./baumon.js";
import { pdfSafe, ensureLogo, logoRatio } from "./pdf.js";
import { formatDateTimeDE } from "./util.js";

const RED = [202, 50, 45], DARK = [40, 40, 38], GRAY = [71, 70, 66], MUTED = [125, 124, 119], LINE = [222, 222, 219];
const SOFT = [246, 246, 244], WE = [238, 238, 235], HOL = [250, 232, 231];
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export async function buildPlanPdf({ colorOf }) {
  if (!window.jspdf || !window.jspdf.jsPDF) throw new Error("PDF-Bibliothek nicht geladen");
  const logoData = await ensureLogo();
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape", compress: true });
  const _text = pdf.text.bind(pdf);
  pdf.text = (t, ...rest) => _text(Array.isArray(t) ? t.map(pdfSafe) : pdfSafe(t), ...rest);
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
  const ML = 36, FOOT_Y = H - 22, BOTTOM = FOOT_Y - 14;
  const color = (c) => pdf.setTextColor(c[0], c[1], c[2]);
  const fill = (c) => pdf.setFillColor(c[0], c[1], c[2]);
  const font = (style, size, c = DARK) => { pdf.setFont("helvetica", style); pdf.setFontSize(size); color(c); };
  const hair = (x1, y, x2, c = LINE, w = 0.6) => { pdf.setDrawColor(c[0], c[1], c[2]); pdf.setLineWidth(w); pdf.line(x1, y, x2, y); };
  const fit = (txt, maxW) => { // Text auf Breite kürzen
    let t = pdfSafe(txt);
    if (pdf.getTextWidth(t) <= maxW) return t;
    while (t.length > 1 && pdf.getTextWidth(t + "…") > maxW) t = t.slice(0, -1);
    return t + "…";
  };

  const { start, end } = M.range();
  const days = Array.from({ length: 21 }, (_, i) => M.addDays(start, i));
  const title = `KW ${M.isoWeek(days[0])}–${M.isoWeek(days[20])} · ${M.shortDate(start)}–${M.shortDate(end)}${end.slice(0, 4)}`;

  // Kopf wie bei BauDoc (Seite 1 ausführlich, Folgeseiten kompakt)
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
      font("bold", 7.5, RED); pdf.setCharSpace(1); pdf.text("MONTAGEPLANUNG", ML, 90); pdf.setCharSpace(0);
      font("bold", 15, DARK); pdf.text(title, ML, 108);
      return 124;
    }
    font("bold", 7.5, RED); pdf.setCharSpace(1); pdf.text("MONTAGEPLANUNG", ML, 30); pdf.setCharSpace(0);
    font("normal", 9, GRAY); pdf.text(title, ML, 43);
    logo(W - ML, 20, 100, 26);
    hair(ML, 54, W - ML);
    return 70;
  }

  /* ---------- Zeitplan ---------- */
  const NAME_W = 118;
  const gx = ML + NAME_W, gw = W - ML - gx;
  // Werktage breit, Wochenende schmal
  const wts = days.map((d) => (["Sa", "So"].includes(M.wdName(d)) ? 0.45 : 1));
  const sum = wts.reduce((a, b) => a + b, 0);
  const xs = []; let acc = gx;
  for (const w of wts) { xs.push(acc); acc += (gw * w) / sum; }
  xs.push(gx + gw);
  const colX = (i) => xs[i], colW = (i) => xs[i + 1] - xs[i];

  let y = header(true);
  function gridHead() {
    // Wochen
    font("bold", 8, DARK);
    for (let w = 0; w < 3; w++) {
      const x0 = colX(w * 7), x1 = colX(w * 7 + 7);
      pdf.text(`KW ${M.isoWeek(days[w * 7])}`, (x0 + x1) / 2, y + 9, { align: "center" });
      if (w) { pdf.setDrawColor(...LINE); pdf.setLineWidth(0.8); pdf.line(x0, y, x0, y + 28); }
    }
    // Tage
    days.forEach((d, i) => {
      const hol = M.holiday(d), we = ["Sa", "So"].includes(M.wdName(d));
      if (hol || we) { fill(hol ? HOL : WE); pdf.rect(colX(i), y + 13, colW(i), 15, "F"); }
      font("normal", 6.5, hol ? RED : MUTED);
      pdf.text(we ? `${Number(d.slice(8))}.` : `${M.wdName(d)} ${Number(d.slice(8))}.`, colX(i) + colW(i) / 2, y + 23, { align: "center" }); // Wochenende schmal: nur Tag
    });
    font("bold", 7.5, MUTED); pdf.text("Trupp", ML, y + 23);
    y += 28;
    hair(ML, y, W - ML, GRAY, 0.6);
  }
  gridHead();

  const trupps = M.sortedTrupps();
  const all = M.list("einsaetze").filter((e) => e.bis >= days[0] && e.von <= days[20]);
  const rows = trupps.map((tr) => ({ tr, list: all.filter((e) => e.truppId === tr.id) }));
  const rest = all.filter((e) => !e.truppId || !M.get("trupps", e.truppId));
  if (rest.length) rows.push({ tr: null, list: rest });
  const LANE = 17;
  for (const r of rows) {
    const lanes = [];
    for (const e of r.list.slice().sort((a, b) => a.von.localeCompare(b.von))) {
      let li = lanes.findIndex((l) => l.every((x) => x.bis < e.von || x.von > e.bis));
      if (li < 0) { lanes.push([]); li = lanes.length - 1; }
      lanes[li].push(e);
    }
    const rowH = Math.max(1, lanes.length) * LANE + 6;
    if (y + rowH > BOTTOM) { pdf.addPage(); y = header(false); gridHead(); }
    // Hintergrund Wochenende/Feiertage
    days.forEach((d, i) => {
      const hol = M.holiday(d), we = ["Sa", "So"].includes(M.wdName(d));
      if (hol || we) { fill(hol ? HOL : WE); pdf.rect(colX(i), y, colW(i), rowH, "F"); }
    });
    // Trupp-Name + Monteure
    font("bold", 8, DARK);
    pdf.text(fit(M.truppName(r.tr), NAME_W - 6), ML, y + 11);
    if (r.tr && (r.tr.fuehrerId || r.tr.name)) {
      font("normal", 6, MUTED);
      const names = r.tr.monteure.filter((id) => id !== r.tr.fuehrerId).map((id) => M.get("monteure", id)).filter(Boolean).map((m) => m.name).join(", ");
      if (names) pdf.text(fit(names, NAME_W - 6), ML, y + 19);
    }
    // Balken
    lanes.forEach((lane, li) => {
      for (const e of lane) {
        const i0 = Math.max(0, days.indexOf(e.von < days[0] ? days[0] : e.von));
        const i1 = days.indexOf(e.bis > days[20] ? days[20] : e.bis);
        const x0 = colX(i0) + 1.5, x1 = colX(i1) + colW(i1) - 1.5, by = y + 3 + li * LANE;
        fill(hex(colorOf(e)));
        pdf.roundedRect(x0, by, x1 - x0, LANE - 3, 2.5, 2.5, "F");
        font("bold", 6.8, [255, 255, 255]);
        const bh = M.buehnenOf(e).filter((b) => !b.abgemeldetAm).length;
        pdf.text(fit(M.baustelleLabel(e) + (bh ? `  [${bh} Bühne${bh > 1 ? "n" : ""}]` : ""), x1 - x0 - 6), x0 + 3, by + 9.2);
      }
    });
    y += rowH;
    hair(ML, y, W - ML);
  }
  if (!rows.length) { font("normal", 9, MUTED); pdf.text("Keine Trupps angelegt.", ML, y + 14); y += 20; }

  /* ---------- Liste der Einsätze ---------- */
  const list = all.slice().sort((a, b) => truppSort(a) - truppSort(b) || a.von.localeCompare(b.von));
  function truppSort(e) { const i = trupps.findIndex((t) => t.id === e.truppId); return i < 0 ? 999 : i; }
  if (list.length) {
    const cols = [{ t: "Trupp", w: 90 }, { t: "Baustelle", w: 170 }, { t: "Zeitraum", w: 110 }, { t: "Monteure", w: 200 }, { t: "Leiharbeiter / Kran", w: 100 }, { t: "Bühnen", w: W - 2 * ML - 670 }];
    const tableHead = () => {
      font("bold", 7, MUTED);
      let x = ML;
      for (const c of cols) { pdf.text(c.t, x, y + 9); x += c.w; }
      y += 13; hair(ML, y, W - ML, GRAY, 0.5);
    };
    y += 18;
    if (y + 40 > BOTTOM) { pdf.addPage(); y = header(false); }
    font("bold", 10, DARK); pdf.text("Einsätze", ML, y); y += 6;
    tableHead();
    for (const e of list) {
      const bs = M.buehnenOf(e).filter((b) => !b.abgemeldetAm).map((b) => `${M.buehneText(b)} (${b.vermieterId ? (M.get("vermieter", b.vermieterId) || {}).firma || "" : "eigen"}${b.bis ? ", bis " + M.shortDate(b.bis) : ""})`).join("; ");
      const cells = [
        M.truppName(M.get("trupps", e.truppId)),
        M.baustelleLabel(e),
        `${M.wdName(e.von)} ${M.shortDate(e.von)} – ${M.wdName(e.bis)} ${M.shortDate(e.bis)}`,
        e.monteure.map((id) => M.get("monteure", id)).filter(Boolean).map((m) => m.name).join(", "),
        [e.leih, e.kran].filter(Boolean).join(" · "),
        bs,
      ];
      font("normal", 7.2, DARK);
      const lines = cells.map((c, i) => pdf.splitTextToSize(pdfSafe(c || "–"), cols[i].w - 6));
      const h = Math.max(...lines.map((l) => l.length)) * 9 + 5;
      if (y + h > BOTTOM) { pdf.addPage(); y = header(false); tableHead(); }
      let x = ML;
      lines.forEach((l, i) => { font(i === 1 ? "bold" : "normal", 7.2, DARK); pdf.text(l, x, y + 9); x += cols[i].w; });
      y += h;
      hair(ML, y, W - ML);
    }
  }

  /* ---------- Fußzeile ---------- */
  const total = pdf.getNumberOfPages();
  const created = formatDateTimeDE(new Date());
  for (let n = 1; n <= total; n++) {
    pdf.setPage(n);
    hair(ML, FOOT_Y - 9, W - ML);
    font("normal", 7, MUTED);
    pdf.text(`Stahlwork · BauMon · Stand ${created}`, ML, FOOT_Y);
    pdf.text(`Seite ${n} von ${total}`, W - ML, FOOT_Y, { align: "right" });
  }
  const blob = pdf.output("blob");
  return { blob, filename: `Montageplanung KW${M.isoWeek(days[0])}-${M.isoWeek(days[20])} ${start.slice(0, 4)}.pdf` };
}
