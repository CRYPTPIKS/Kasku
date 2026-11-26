/**
 * Parser nominal Rupiah berbasis aturan.
 *
 * Mendukung contoh:
 *   75rb, 75 ribu, 75k, 1,5jt, 1.5jt, 2 juta, 12jt, 1M, 2 miliar,
 *   Rp 25.000, Rp25.000,-, 25.000,50, 425000, 1jt 500rb
 *
 * Aturan pemisah:
 * - Ada "." dan "," sekaligus -> yang terakhir adalah pemisah desimal.
 * - Satu jenis pemisah muncul berkali-kali -> pemisah ribuan (grup harus 3 digit).
 * - Satu pemisah muncul sekali:
 *     - dengan satuan (rb/jt/...) -> desimal ("1,5jt", "1.25jt")
 *     - tanpa satuan & tepat 3 digit di belakang -> ribuan ("25.000")
 *     - selain itu -> desimal ("25,5")
 */

const UNIT_MULTIPLIERS: Record<string, number> = {
  rb: 1e3,
  rbu: 1e3,
  ribu: 1e3,
  k: 1e3,
  jt: 1e6,
  juta: 1e6,
  m: 1e9,
  miliar: 1e9,
  milyar: 1e9,
  t: 1e12,
  triliun: 1e12,
};

// Urutan: yang lebih panjang dulu agar "juta" tidak terbaca "j".
const UNIT_PATTERN = "ribu|rbu|rb|k|juta|jt|miliar|milyar|m|triliun|t";

export interface AmountMatch {
  value: number;
  raw: string;
  start: number;
  end: number;
  /** Ada satuan seperti rb/jt. */
  hasUnit: boolean;
  /** Diawali "Rp". */
  hasCurrency: boolean;
}

const TOKEN_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(rp\.?\s*)?(\d+(?:[.,]\d+)*)(?:\s*(${UNIT_PATTERN}))?(?:\s*,-)?(?![\p{L}\p{N}])`,
  "giu",
);

/** Ubah string angka dengan pemisah Indonesia/Inggris menjadi number. null jika tidak valid. */
export function normalizeNumber(input: string, hasUnit: boolean): number | null {
  const s = input.trim();
  if (!/^\d+(?:[.,]\d+)*$/.test(s)) return null;

  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;

  let intPart: string;
  let fracPart = "";

  if (dots > 0 && commas > 0) {
    const decimalSep = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    const thousandSep = decimalSep === "," ? "." : ",";
    const [left, right, ...rest] = s.split(decimalSep);
    if (rest.length > 0 || left === undefined || right === undefined) return null;
    if (!validThousandGroups(left, thousandSep)) return null;
    intPart = left.split(thousandSep).join("");
    fracPart = right;
  } else if (dots + commas === 0) {
    intPart = s;
  } else {
    const sep = dots > 0 ? "." : ",";
    const count = dots + commas;
    const parts = s.split(sep);
    if (count > 1) {
      if (!validThousandGroups(s, sep)) return null;
      intPart = parts.join("");
    } else {
      const [left = "", right = ""] = parts;
      if (!hasUnit && right.length === 3) {
        intPart = left + right;
      } else {
        intPart = left;
        fracPart = right;
      }
    }
  }

  const value = Number(fracPart ? `${intPart}.${fracPart}` : intPart);
  return Number.isFinite(value) ? value : null;
}

function validThousandGroups(s: string, sep: string): boolean {
  const groups = s.split(sep);
  if (groups.length === 1) return true;
  const [first, ...rest] = groups;
  if (!first || first.length > 3) return false;
  return rest.every((g) => g.length === 3);
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Temukan semua nominal di dalam teks. Nominal majemuk seperti "1jt 500rb"
 * digabung menjadi satu (1.500.000) bila satuannya menurun.
 */
export function findAmounts(text: string): AmountMatch[] {
  const raw: AmountMatch[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const [full, currency, digits, unitRaw] = m;
    if (digits === undefined || m.index === undefined) continue;
    const unit = unitRaw?.toLowerCase();
    const multiplier = unit ? (UNIT_MULTIPLIERS[unit] ?? 1) : 1;
    const base = normalizeNumber(digits, Boolean(unit));
    if (base === null) continue;
    raw.push({
      value: roundMoney(base * multiplier),
      raw: full.trim(),
      start: m.index,
      end: m.index + full.length,
      hasUnit: Boolean(unit),
      hasCurrency: Boolean(currency),
    });
  }

  // Gabungkan "1jt 500rb" -> 1.500.000
  const merged: AmountMatch[] = [];
  for (const cur of raw) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.hasUnit &&
      cur.hasUnit &&
      !cur.hasCurrency &&
      /^\s*(?:dan\s+)?$/i.test(text.slice(prev.end, cur.start)) &&
      unitMagnitude(cur.raw) < unitMagnitude(prev.raw)
    ) {
      merged[merged.length - 1] = {
        ...prev,
        value: roundMoney(prev.value + cur.value),
        raw: text.slice(prev.start, cur.end),
        end: cur.end,
      };
    } else {
      merged.push(cur);
    }
  }
  return merged;
}

function unitMagnitude(raw: string): number {
  const m = new RegExp(String.raw`(${UNIT_PATTERN})\s*(?:,-)?$`, "i").exec(raw);
  return m?.[1] ? (UNIT_MULTIPLIERS[m[1].toLowerCase()] ?? 1) : 1;
}

/**
 * Parse teks yang seluruhnya berupa nominal (mis. isian form atau balasan bot).
 * Mengembalikan null jika teks bukan nominal tunggal yang valid.
 */
export function parseAmount(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const matches = findAmounts(trimmed);
  if (matches.length !== 1) return null;
  const [only] = matches;
  if (!only) return null;
  const rest = (trimmed.slice(0, only.start) + trimmed.slice(only.end)).trim();
  if (rest !== "") return null;
  return only.value;
}
