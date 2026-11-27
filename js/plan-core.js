/* =========================================================
   Planung – gemeinsame Grundlage für BauMon und BauKon
   Datum (Tage als "JJJJ-MM-TT"), Kalenderwochen, Feiertage Baden-Württemberg
========================================================= */
export function dayStr(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}
export function today() { return dayStr(new Date()); }
export function parseDay(s) { const [y, mo, d] = s.split("-").map(Number); return new Date(y, mo - 1, d, 12); }
export function addDays(s, n) { const d = parseDay(s); d.setDate(d.getDate() + n); return dayStr(d); }
export function mondayOf(s) { const d = parseDay(s); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return dayStr(d); }
export function isoWeek(s) {
  const d = parseDay(s);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(d.getFullYear(), 0, 4, 12);
  return 1 + Math.round(((d - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}
export const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
export function wdName(s) { return WD[parseDay(s).getDay()]; }
export function shortDate(s) { const d = parseDay(s); return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.`; }
export function longDate(s) { const d = parseDay(s); return `${WD[d.getDay()]} ${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`; }

/* ---------- Feiertage Baden-Württemberg ---------- */
function easter(y) { // Gaußsche Osterformel (gregorianisch)
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), hh = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - hh - k) % 7, m = Math.floor((a + 11 * hh + 22 * l) / 451);
  const month = Math.floor((hh + l - 7 * m + 114) / 31), day = ((hh + l - 7 * m + 114) % 31) + 1;
  return dayStr(new Date(y, month - 1, day, 12));
}
const holCache = new Map();
export function holidaysBW(y) {
  if (holCache.has(y)) return holCache.get(y);
  const o = easter(y);
  const list = {
    [`${y}-01-01`]: "Neujahr", [`${y}-01-06`]: "Heilige Drei Könige", [addDays(o, -2)]: "Karfreitag", [addDays(o, 1)]: "Ostermontag",
    [`${y}-05-01`]: "Tag der Arbeit", [addDays(o, 39)]: "Christi Himmelfahrt", [addDays(o, 50)]: "Pfingstmontag", [addDays(o, 60)]: "Fronleichnam",
    [`${y}-10-03`]: "Tag der Deutschen Einheit", [`${y}-11-01`]: "Allerheiligen", [`${y}-12-25`]: "1. Weihnachtstag", [`${y}-12-26`]: "2. Weihnachtstag",
  };
  holCache.set(y, list);
  return list;
}
export function holiday(day) { return holidaysBW(Number(day.slice(0, 4)))[day] || ""; }


// Kurzformen der Feiertage für die schmale Tagesspalte
export const HOL_SHORT = { "Heilige Drei Könige": "Hl. 3 Kön.", "Ostermontag": "Ostermo.", "Tag der Arbeit": "1. Mai", "Christi Himmelfahrt": "Himmelf.",
  "Pfingstmontag": "Pfingstmo.", "Fronleichnam": "Fronleichn.", "Tag der Deutschen Einheit": "Dt. Einheit", "Allerheiligen": "Allerheil.",
  "1. Weihnachtstag": "1. Weihn.", "2. Weihnachtstag": "2. Weihn.", "Karfreitag": "Karfr." };
