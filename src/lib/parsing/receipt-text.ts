/**
 * Parser teks struk belanja Indonesia (hasil OCR) berbasis aturan.
 * Mengambil merchant, tanggal, total, subtotal, pajak, diskon, biaya layanan,
 * metode pembayaran, dan item bila memungkinkan.
 */
import { normalizeNumber } from "./amount";

export interface ReceiptItem {
  name: string;
  qty: number | null;
  unitPrice: number | null;
  total: number;
}

export interface ReceiptData {
  merchant: string | null;
  occurredAt: Date | null;
  total: number | null;
  subtotal: number | null;
  tax: number | null;
  discount: number | null;
  serviceCharge: number | null;
  paymentMethod: string | null;
  items: ReceiptItem[];
  /** 0..1, perkiraan keyakinan terhadap total. */
  confidence: number;
}

const KNOWN_MERCHANTS: [RegExp, string][] = [
  [/indomaret/i, "Indomaret"],
  [/alfamidi/i, "Alfamidi"],
  [/alfamart/i, "Alfamart"],
  [/lawson/i, "Lawson"],
  [/family\s*mart/i, "FamilyMart"],
  [/superindo/i, "Superindo"],
  [/hypermart/i, "Hypermart"],
  [/transmart/i, "Transmart"],
  [/lotte\s*mart/i, "Lotte Mart"],
  [/giant/i, "Giant"],
  [/ranch\s*market/i, "Ranch Market"],
  [/starbucks/i, "Starbucks"],
  [/mcdonald|mc\s*donald/i, "McDonald's"],
  [/\bkfc\b/i, "KFC"],
  [/janji\s*jiwa/i, "Janji Jiwa"],
  [/kopi\s*kenangan/i, "Kopi Kenangan"],
  [/pertamina|spbu/i, "SPBU Pertamina"],
  [/guardian/i, "Guardian"],
  [/watsons/i, "Watsons"],
  [/ace\s*hardware/i, "ACE Hardware"],
  [/informa/i, "Informa"],
  [/uniqlo/i, "Uniqlo"],
];

const PAYMENT_METHODS: [RegExp, string][] = [
  [/\bqris\b/i, "QRIS"],
  [/\bgo-?pay\b/i, "GoPay"],
  [/\bovo\b/i, "OVO"],
  [/\bdana\b/i, "DANA"],
  [/shopee\s*pay/i, "ShopeePay"],
  [/link\s*aja/i, "LinkAja"],
  [/kartu\s*kredit|credit\s*card|\bvisa\b|master\s*card/i, "Kartu kredit"],
  [/\bdebit\b|\bdebet\b|\bedc\b/i, "Kartu debit"],
  [/\bflazz\b|e-?money|brizzi|tapcash/i, "Uang elektronik"],
  [/\btunai\b|\bcash\b/i, "Tunai"],
];

const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1,
  feb: 2, februari: 2, february: 2, peb: 2,
  mar: 3, maret: 3, march: 3,
  apr: 4, april: 4,
  mei: 5, may: 5,
  jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  agu: 8, agt: 8, ags: 8, agustus: 8, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, oct: 10, october: 10,
  nov: 11, nop: 11, november: 11, nopember: 11,
  des: 12, desember: 12, dec: 12, december: 12,
};

const NUM = String.raw`-?\(?(?:rp\.?\s*)?\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?\)?|-?(?:rp\.?\s*)?\d+(?:[.,]\d{1,2})?`;
const TRAILING_AMOUNT = new RegExp(String.raw`(${NUM})\s*(?:,-)?\s*$`, "i");

function parseMoney(token: string): number | null {
  const negative = /^-|^\(.*\)$/.test(token.trim());
  const cleaned = token.replace(/[()\s-]/g, "").replace(/^rp\.?/i, "");
  // Struk sering memakai koma sebagai pemisah ribuan ("9,700"). normalizeNumber
  // menangani keduanya: satu pemisah + 3 digit = ribuan.
  const n = normalizeNumber(cleaned, false);
  if (n === null) return null;
  return negative ? -n : n;
}

interface Line {
  text: string;
  label: string;
  amount: number | null;
}

function splitLines(raw: string): Line[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((text) => {
      const m = TRAILING_AMOUNT.exec(text);
      const amount = m?.[1] ? parseMoney(m[1]) : null;
      const label = (m ? text.slice(0, m.index) : text).replace(/[:=]+\s*$/, "").trim().toLowerCase();
      return { text, label, amount };
    });
}

function findLabeled(lines: Line[], patterns: RegExp[], exclude?: RegExp): number | null {
  for (const p of patterns) {
    // Ambil kemunculan terakhir (biasanya ringkasan di bawah).
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i]!;
      if (l.amount === null || !l.label) continue;
      if (exclude?.test(l.label)) continue;
      if (p.test(l.label)) return l.amount;
    }
  }
  return null;
}

function detectMerchant(lines: Line[], raw: string): string | null {
  for (const [re, name] of KNOWN_MERCHANTS) if (re.test(raw)) return name;
  for (const l of lines.slice(0, 6)) {
    const t = l.text;
    if (/^(jl\.?|jalan|telp|tel\.|npwp|no\.|ruko|kel\.|kec\.|kota|www\.|http)/i.test(t)) continue;
    const letters = (t.match(/\p{L}/gu) ?? []).length;
    const digits = (t.match(/\d/g) ?? []).length;
    if (letters >= 3 && digits <= letters / 2 && !/struk|receipt|invoice|nota|kasir|cashier/i.test(t)) {
      return t
        .toLowerCase()
        .replace(/\b\p{L}/gu, (c) => c.toUpperCase())
        .replace(/\b(Pt|Cv|Tbk)\b/g, (s) => s.toUpperCase())
        .slice(0, 80);
    }
  }
  return null;
}

/** Tanggal struk diartikan sebagai waktu WIB. */
function wib(y: number, m: number, d: number, hh = 12, mm = 0): Date | null {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - 7 * 3600 * 1000);
}

export function detectReceiptDate(raw: string): Date | null {
  // Jam dicari di baris yang sama, tepat setelah tanggal.
  const timeAfter = (m: RegExpExecArray) => {
    const rest = raw.slice(m.index + m[0].length).split(/\r?\n/)[0] ?? "";
    const t = /^\D{0,6}?(\d{1,2})[:.](\d{2})(?![\d.,])/.exec(rest) ?? /^\D{0,6}?(\d{1,2}):(\d{2})/.exec(rest);
    const hh = t ? Number(t[1]) : 12;
    const mm = t ? Number(t[2]) : 0;
    return hh < 24 && mm < 60 ? { hh, mm } : { hh: 12, mm: 0 };
  };
  // 2026-11-26
  let m = /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/.exec(raw);
  if (m) {
    const { hh, mm } = timeAfter(m);
    return wib(Number(m[1]), Number(m[2]), Number(m[3]), hh, mm);
  }
  // 26-11-2026, 26/11/26, 26.11.2026 (format Indonesia: hari dulu)
  m = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/.exec(raw);
  if (m) {
    const { hh, mm } = timeAfter(m);
    return wib(Number(m[3]), Number(m[2]), Number(m[1]), hh, mm);
  }
  // 26 Nov 2026 / 26 November 2026
  m = /\b(\d{1,2})\s*[- ]\s*([a-z]{3,9})\.?\s*[- ]\s*(\d{2,4})\b/i.exec(raw);
  if (m) {
    const month = MONTHS[m[2]!.toLowerCase()];
    if (month) {
      const { hh, mm } = timeAfter(m);
      return wib(Number(m[3]), month, Number(m[1]), hh, mm);
    }
  }
  return null;
}

function detectItems(lines: Line[]): ReceiptItem[] {
  const items: ReceiptItem[] = [];
  const stop = /total|subtotal|sub total|harga jual|ppn|pajak|tunai|cash|kembali|diskon|hemat|bayar|service|change|qris|debit/i;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.text;
    if (stop.test(t)) continue;
    // NAMA  QTY  HARGA  TOTAL  |  NAMA  QTY x HARGA  TOTAL
    let m = new RegExp(String.raw`^(.*?\p{L}.*?)\s+(\d{1,3})\s*[xX@]?\s*(${NUM})\s+(${NUM})$`, "u").exec(t);
    if (m) {
      const qty = Number(m[2]);
      const unit = parseMoney(m[3]!);
      const total = parseMoney(m[4]!);
      if (unit !== null && total !== null && Math.abs(qty * unit - total) <= Math.max(1, total * 0.02)) {
        items.push({ name: m[1]!.trim(), qty, unitPrice: unit, total });
        continue;
      }
    }
    // Baris kuantitas di bawah nama: "2 x 3.100   6.200"
    m = new RegExp(String.raw`^(\d{1,3})\s*[xX@]\s*(${NUM})\s+(${NUM})$`).exec(t);
    const prev = lines[i - 1];
    if (m && prev && prev.amount === null && /\p{L}/u.test(prev.text)) {
      const qty = Number(m[1]);
      const unit = parseMoney(m[2]!);
      const total = parseMoney(m[3]!);
      if (unit !== null && total !== null) items.push({ name: prev.text, qty, unitPrice: unit, total });
    }
  }
  return items.slice(0, 100);
}

export function parseReceiptText(raw: string): ReceiptData {
  const lines = splitLines(raw);
  const notTotal = /item|qty|jumlah item|jml item|disc|diskon|hemat|potongan|sub\s*total|ppn|pajak|tax|kembali|change/;

  const labeledTotal = findLabeled(
    lines,
    [
      /grand\s*total/,
      /total\s*(bayar|belanja|pembayaran|tagihan|harga|akhir)/,
      /jumlah\s*(bayar|tagihan|pembayaran)/,
      /^total\b|\btotal$/,
      /\btotal\b/,
      /\bjumlah\b/,
    ],
    notTotal,
  );

  const subtotal = findLabeled(lines, [/sub\s*total/, /harga\s*jual/, /total\s*item/]);
  const taxRaw = findLabeled(lines, [/\bppn\b/, /\bpb\s*1\b/, /\bpajak\b/, /\btax\b/], /dpp|non\s*ppn|bebas|kena\s*pajak/);
  const discountRaw = findLabeled(lines, [/diskon|discount|\bdisc\b|potongan|hemat|promo|voucher/], /total\s*(bayar|belanja)/);
  const service = findLabeled(lines, [/service|layanan|\bsc\b/]);

  let total = labeledTotal;
  let confidence = labeledTotal !== null ? 0.8 : 0;
  if (total === null) {
    // Cadangan: nominal terbesar yang bukan uang dibayar/kembalian.
    const candidates = lines.filter((l) => l.amount !== null && l.amount > 0 && !/tunai|cash|kembali|change|bayar|dibayar|npwp|telp/.test(l.label));
    const max = Math.max(...candidates.map((l) => l.amount!), 0);
    total = max > 0 ? max : null;
    confidence = total !== null ? 0.3 : 0;
  }
  if (total !== null && total <= 0) {
    total = null;
    confidence = 0;
  }

  let paymentMethod: string | null = null;
  const tail = lines.slice(Math.max(0, lines.length - 15)).map((l) => l.text).join("\n");
  for (const [re, name] of PAYMENT_METHODS) {
    if (re.test(tail)) {
      paymentMethod = name;
      break;
    }
  }

  return {
    merchant: detectMerchant(lines, raw),
    occurredAt: detectReceiptDate(raw),
    total,
    subtotal: subtotal !== null && subtotal > 0 ? subtotal : null,
    tax: taxRaw !== null ? Math.abs(taxRaw) : null,
    discount: discountRaw !== null ? Math.abs(discountRaw) : null,
    serviceCharge: service !== null ? Math.abs(service) : null,
    paymentMethod,
    items: detectItems(lines),
    confidence,
  };
}
