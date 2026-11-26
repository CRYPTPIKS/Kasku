/**
 * Parser pesan transaksi berbahasa Indonesia (berbasis aturan, tanpa AI).
 *
 * Contoh yang dipahami:
 *   keluar 75rb makan siang pakai cash
 *   bayar listrik 425000 dari BCA
 *   masuk 12jt gaji bulan November
 *   transfer 500rb dari BCA ke GoPay
 *   piutang 2jt ke Deni, cicilan 500rb tiap tanggal 5
 *   bayar hutang 1jt ke Rina dari Mandiri
 *   beli 2 lot BBCA di harga 9850
 *   jual emas 5 gram senilai 7jt
 *
 * Prinsip: jika ragu, kembalikan hasil dengan `missing` + satu pertanyaan
 * singkat (`question`) alih-alih menebak hal yang berisiko.
 */
import { findAmounts, type AmountMatch } from "./amount";

export type ParsedIntent =
  | "income"
  | "expense"
  | "transfer"
  | "debt_receivable"
  | "debt_payable"
  | "debt_payment"
  | "investment_buy"
  | "investment_sell"
  | "investment_income";

export interface ParserAccount {
  id: string;
  name: string;
  aliases: string[];
}

export interface ParserCategory {
  id: string;
  name: string;
  kind: "income" | "expense";
  keywords: string[];
}

export interface ParserContext {
  accounts: ParserAccount[];
  categories: ParserCategory[];
  /** Kebiasaan: merchant/kata kunci ternormalisasi -> kategori. */
  merchantRules?: { merchantKey: string; categoryId: string }[];
  now?: Date;
}

export type MissingField = "amount" | "fromAccount" | "toAccount" | "category" | "counterparty";

export interface ParsedTransaction {
  intent: ParsedIntent | null;
  amount: number | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  categoryId: string | null;
  description: string;
  occurredAt: Date;
  /** Pihak terkait untuk hutang/piutang. */
  counterparty: string | null;
  /** Untuk debt_payment: arah hutang yang dibayar. */
  debtDirection: "payable" | "receivable" | null;
  installment: { amount: number; dayOfMonth: number | null } | null;
  investment: {
    assetName: string;
    units: number | null;
    unitLabel: string | null;
    pricePerUnit: number | null;
  } | null;
  missing: MissingField[];
  /** Satu pertanyaan singkat jika ada data penting yang kurang. */
  question: string | null;
}

// ---------------------------------------------------------------------------
// Utilitas teks
// ---------------------------------------------------------------------------

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}&]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Kunci merchant ternormalisasi untuk aturan kebiasaan. */
export function merchantKey(s: string): string {
  return normalizeText(s).slice(0, 60);
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasWord(text: string, word: string) {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(word)}(?![\\p{L}\\p{N}])`, "iu").test(text);
}

// ---------------------------------------------------------------------------
// Deteksi niat
// ---------------------------------------------------------------------------

const UNIT_WORDS = ["lot", "lembar", "saham", "gram", "gr", "unit", "koin", "coin", "btc", "eth", "sol", "usdt"];
const ASSET_WORDS = ["emas", "saham", "reksa dana", "reksadana", "rd", "kripto", "crypto", "btc", "eth", "obligasi", "sbn", "ori", "sukuk", "deposito"];

function detectIntent(t: string): { intent: ParsedIntent | null; debtDirection: "payable" | "receivable" | null } {
  const first = t.split(" ")[0] ?? "";

  // Pembayaran hutang / penerimaan cicilan piutang
  if (/\b(bayar|cicil|lunasi|nyicil)\s+(hutang|utang)\b/.test(t)) return { intent: "debt_payment", debtDirection: "payable" };
  if (/\b(terima|dapat)\s+(cicilan|bayaran|pembayaran)\b/.test(t) || /\b(bayar|cicil|lunas)\s+piutang\b/.test(t) || /\bpiutang\s+(dibayar|lunas|masuk)\b/.test(t)) {
    return { intent: "debt_payment", debtDirection: "receivable" };
  }
  // Hutang / piutang baru
  if (/^(piutang|pinjamkan|pinjemin|minjemin|meminjamkan|kasih pinjam)\b/.test(t) || /\bpiutang\b/.test(t)) return { intent: "debt_receivable", debtDirection: null };
  if (/^(hutang|utang|pinjam|minjam|ngutang)\b/.test(t) || /\b(hutang|utang)\s+(ke|dari|sama)\b/.test(t)) return { intent: "debt_payable", debtDirection: null };

  // Investasi
  const mentionsUnits = UNIT_WORDS.some((u) => new RegExp(`\\d\\s*${u}\\b`).test(t));
  const mentionsAsset = ASSET_WORDS.some((a) => hasWord(t, a));
  if (/\b(dividen|kupon|bunga deposito|imbal hasil)\b/.test(t)) return { intent: "investment_income", debtDirection: null };
  if (first === "beli" && (mentionsUnits || mentionsAsset)) return { intent: "investment_buy", debtDirection: null };
  if (first === "jual" && (mentionsUnits || mentionsAsset)) return { intent: "investment_sell", debtDirection: null };

  // Transfer antar-rekening
  if (/^(transfer|tf|trf|pindah|pindahkan|mutasi|topup|top up|isi saldo|isi)\b/.test(t)) return { intent: "transfer", debtDirection: null };

  // Pemasukan
  if (/^(masuk|terima|dapat|dapet|pemasukan|income|gaji|gajian|bonus|thr|cashback|refund)\b/.test(t)) return { intent: "income", debtDirection: null };

  // Pengeluaran
  if (/^(keluar|bayar|beli|belanja|jajan|pengeluaran|expense|makan|ngopi|isi bensin|bensin)\b/.test(t)) return { intent: "expense", debtDirection: null };

  // Jual non-investasi -> pemasukan
  if (first === "jual") return { intent: "income", debtDirection: null };

  return { intent: null, debtDirection: null };
}

// ---------------------------------------------------------------------------
// Rekening
// ---------------------------------------------------------------------------

interface AccountHit {
  id: string;
  index: number;
  length: number;
  preposition: string | null;
}

function accountTerms(a: ParserAccount): string[] {
  return [...new Set([a.name, ...a.aliases].map((x) => normalizeText(x)).filter(Boolean))].sort((x, y) => y.length - x.length);
}

function findAccounts(t: string, accounts: ParserAccount[]): AccountHit[] {
  const hits: AccountHit[] = [];
  for (const a of accounts) {
    for (const term of accountTerms(a)) {
      const re = new RegExp(`(?:\\b(dari|pakai|pake|via|lewat|ke|ke rekening|di|dengan|pakai kartu)\\s+)?(?<![\\p{L}\\p{N}])${escapeRe(term)}(?![\\p{L}\\p{N}])`, "giu");
      for (const m of t.matchAll(re)) {
        const prep = m[1]?.toLowerCase() ?? null;
        hits.push({ id: a.id, index: m.index ?? 0, length: m[0].length, preposition: prep });
      }
    }
  }
  // Satu posisi hanya untuk satu rekening (ambil yang paling panjang).
  hits.sort((x, y) => x.index - y.index || y.length - x.length);
  const out: AccountHit[] = [];
  for (const h of hits) {
    const last = out[out.length - 1];
    if (last && h.index < last.index + last.length) continue;
    out.push(h);
  }
  return out;
}

const FROM_PREPS = new Set(["dari", "pakai", "pake", "via", "lewat", "dengan", "pakai kartu"]);
const TO_PREPS = new Set(["ke", "ke rekening"]);

// ---------------------------------------------------------------------------
// Kategori
// ---------------------------------------------------------------------------

export function suggestCategory(
  text: string,
  kind: "income" | "expense",
  categories: ParserCategory[],
  merchantRules: ParserContext["merchantRules"] = [],
): string | null {
  const t = normalizeText(text);
  if (!t) return null;
  // 1) Kebiasaan pengguna (merchant yang pernah dikonfirmasi).
  const candidates = categories.filter((c) => c.kind === kind);
  const ids = new Set(candidates.map((c) => c.id));
  let best: { id: string; score: number } | null = null;
  for (const r of merchantRules) {
    if (!ids.has(r.categoryId) || !r.merchantKey) continue;
    if (t === r.merchantKey || hasWord(t, r.merchantKey)) {
      const score = 1000 + r.merchantKey.length;
      if (!best || score > best.score) best = { id: r.categoryId, score };
    }
  }
  if (best) return best.id;
  // 2) Kata kunci kategori & nama kategori.
  for (const c of candidates) {
    const terms = [...c.keywords, c.name].map((k) => normalizeText(k)).filter(Boolean);
    for (const k of terms) {
      if (hasWord(t, k)) {
        const score = k.length + (k.includes(" ") ? 5 : 0);
        if (!best || score > best.score) best = { id: c.id, score };
      }
    }
  }
  return best?.id ?? null;
}

// ---------------------------------------------------------------------------
// Tanggal
// ---------------------------------------------------------------------------

function detectDate(t: string, now: Date): Date {
  if (/\bkemarin lusa\b/.test(t)) return new Date(now.getTime() - 2 * 86400000);
  if (/\bkemarin\b/.test(t)) return new Date(now.getTime() - 86400000);
  return now;
}

// ---------------------------------------------------------------------------
// Parser utama
// ---------------------------------------------------------------------------

const INTENT_WORDS =
  /^(keluar|bayar|beli|belanja|jajan|pengeluaran|expense|masuk|terima|dapat|dapet|pemasukan|income|transfer|tf|trf|pindah|pindahkan|mutasi|topup|top up|isi saldo|piutang|hutang|utang|pinjamkan|pinjemin|minjemin|pinjam|minjam|ngutang|jual)\s+/i;

const FILLER = /\b(sebesar|senilai|seharga|total|sejumlah|rp|untuk|buat|kemarin lusa|kemarin|tadi|hari ini)\b/gi;

export function parseTransactionText(input: string, ctx: ParserContext): ParsedTransaction {
  const now = ctx.now ?? new Date();
  const raw = input.trim().replace(/\s+/g, " ");
  const t = raw.toLowerCase();
  const { intent: detected, debtDirection } = detectIntent(normalizeText(raw));
  const amounts = findAmounts(raw);

  // Tandai angka yang bukan nominal uang.
  const isUnitCount = (m: AmountMatch) =>
    !m.hasUnit && new RegExp(`^\\s*(${UNIT_WORDS.join("|")})\\b`, "i").test(raw.slice(m.end));
  const isDayNumber = (m: AmountMatch) => /(tanggal|tgl|tiap tgl|setiap tanggal)\s*$/i.test(raw.slice(0, m.start)) && m.value <= 31;
  const isPrice = (m: AmountMatch) => /(harga|@|per\s+\w+)\s*$/i.test(raw.slice(0, m.start));
  const isInstallment = (m: AmountMatch) => /(cicilan|cicil|angsuran)\s*$/i.test(raw.slice(0, m.start));

  let intent = detected;
  let investment: ParsedTransaction["investment"] = null;
  let amount: number | null = null;
  let installment: ParsedTransaction["installment"] = null;
  const used = new Set<AmountMatch>();

  if (intent === "investment_buy" || intent === "investment_sell") {
    const unitsM = amounts.find(isUnitCount);
    // "2 lot BBCA di 9500" -> 9500 adalah harga per lembar.
    const priceM = amounts.find((m) => isPrice(m) || (m !== unitsM && /\bdi\s*$/i.test(raw.slice(0, m.start)) && !m.hasUnit));
    const totalM = amounts.find((m) => m !== unitsM && m !== priceM && !isDayNumber(m));
    const unitLabel = unitsM ? (/^\s*(\w+)/.exec(raw.slice(unitsM.end))?.[1]?.toLowerCase() ?? null) : null;
    const units = unitsM?.value ?? null;
    const price = priceM?.value ?? null;
    const sharesPerUnit = unitLabel === "lot" ? 100 : 1;
    // Nama aset: kata setelah satuan, atau kata kunci aset.
    let assetName = "";
    if (unitsM) {
      const after = raw
        .slice(unitsM.end)
        .replace(/^\s*\w+\s*/, "")
        // Buang mulai dari kata depan/harga, dan token nominal (3jt, 9.500, Rp10rb).
        .replace(/(^|\s)(di|@|dengan|harga|senilai|seharga|dari|ke|pakai|pake|via|total)(\s.*|$)/i, "")
        .replace(/@.*$/, "")
        .replace(/(^|\s)(rp\.?\s*)?\d[\d.,]*\s*(rb|ribu|k|jt|juta|m|miliar)?(?=\s|$)/gi, " ")
        .trim();
      assetName = /^([\p{L}\p{N}.-]+(?:\s+[\p{L}\p{N}.-]+)?)/u.exec(after)?.[1] ?? "";
    }
    if (!assetName) {
      const asset = ASSET_WORDS.find((a) => hasWord(t, a));
      assetName = asset ?? "";
    }
    if (!assetName || /^(di|harga|senilai)$/i.test(assetName)) {
      const beforeUnits = raw.slice(0, unitsM?.start ?? raw.length).replace(INTENT_WORDS, "").trim();
      assetName = beforeUnits || assetName;
    }
    investment = { assetName: assetName.trim(), units, unitLabel, pricePerUnit: price };
    if (totalM) {
      amount = totalM.value;
      used.add(totalM);
    } else if (units !== null && price !== null) {
      amount = Math.round(units * sharesPerUnit * price * 100) / 100;
    }
    for (const m of [unitsM, priceM]) if (m) used.add(m);
  } else {
    for (const m of amounts) {
      if (isUnitCount(m) || isDayNumber(m) || isPrice(m)) {
        used.add(m);
        continue;
      }
      if ((intent === "debt_receivable" || intent === "debt_payable") && isInstallment(m)) {
        installment = { amount: m.value, dayOfMonth: null };
        used.add(m);
        continue;
      }
      if (amount === null) {
        amount = m.value;
        used.add(m);
      }
    }
    if (installment) {
      const day = amounts.find(isDayNumber);
      if (day) installment.dayOfMonth = day.value;
    }
  }

  // Jika tidak ada kata kerja tetapi ada nominal -> anggap pengeluaran (paling umum),
  // namun tetap draf sehingga pengguna bisa mengoreksi.
  if (!intent && amount !== null) intent = "expense";

  // Rekening
  const hits = findAccounts(t, ctx.accounts);
  let fromAccountId: string | null = null;
  let toAccountId: string | null = null;
  if (intent === "transfer") {
    const from = hits.find((h) => h.preposition && FROM_PREPS.has(h.preposition));
    const to = hits.find((h) => h.preposition && TO_PREPS.has(h.preposition));
    fromAccountId = from?.id ?? null;
    toAccountId = to?.id ?? null;
    const rest = hits.filter((h) => h !== from && h !== to);
    if (!fromAccountId && rest[0]) fromAccountId = rest.shift()!.id;
    if (!toAccountId && rest[0]) toAccountId = rest.shift()!.id;
    if (fromAccountId && fromAccountId === toAccountId) toAccountId = null;
  } else if (intent === "income" || intent === "investment_income" || intent === "investment_sell" || intent === "debt_payable") {
    const h = hits.find((x) => !x.preposition || TO_PREPS.has(x.preposition) || x.preposition === "di") ?? hits[0];
    toAccountId = h?.id ?? null;
  } else if (intent === "debt_payment") {
    const h = hits[0];
    if (debtDirection === "receivable") toAccountId = h?.id ?? null;
    else fromAccountId = h?.id ?? null;
  } else if (intent) {
    const h = hits.find((x) => !x.preposition || FROM_PREPS.has(x.preposition)) ?? hits.find((x) => x.preposition !== "ke");
    fromAccountId = h?.id ?? null;
  }

  // Pihak terkait hutang/piutang
  let counterparty: string | null = null;
  if (intent === "debt_receivable" || intent === "debt_payable" || intent === "debt_payment") {
    const m = /\b(?:ke|dari|sama|kepada|oleh|untuk)\s+([\p{Lu}][\p{L}.'-]*(?:\s+[\p{Lu}][\p{L}.'-]*)*)/u.exec(raw);
    const accountNames = new Set(ctx.accounts.flatMap(accountTerms));
    const candidate = m?.[1]?.trim() ?? null;
    counterparty = candidate && !accountNames.has(normalizeText(candidate)) ? candidate : null;
    if (!counterparty) {
      const m2 = /\b(?:ke|dari|sama|kepada)\s+([\p{L}][\p{L}.'-]*)/u.exec(raw);
      const c2 = m2?.[1] ?? null;
      if (c2 && !accountNames.has(normalizeText(c2))) counterparty = c2.charAt(0).toUpperCase() + c2.slice(1);
    }
  }

  // Keterangan: hapus kata kerja, nominal, frasa rekening.
  let description = raw;
  const spans: [number, number][] = [...used].map((m) => [m.start, m.end]);
  for (const h of hits) {
    // posisi pada teks lowercase == posisi pada raw (panjang sama)
    spans.push([h.index, h.index + h.length]);
  }
  spans.sort((a, b) => b[0] - a[0]);
  for (const [s, e] of spans) description = description.slice(0, s) + " " + description.slice(e);
  description = description
    .replace(INTENT_WORDS, "")
    .replace(/\b(cicilan|angsuran)\b.*$/i, "")
    .replace(/\b(tiap|setiap)\s+(tanggal|tgl)\b.*$/i, "")
    .replace(/\b(di harga|harga|di|@)\s*$/i, "")
    .replace(FILLER, " ")
    .replace(/[,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (intent === "debt_payment" || intent === "debt_receivable" || intent === "debt_payable") {
    description = description.replace(/^(hutang|utang|piutang)\b\s*/i, "").replace(/\b(ke|dari|sama|kepada)\s*$/i, "").trim();
  }
  description = description.charAt(0).toUpperCase() + description.slice(1);

  // Kategori
  let categoryId: string | null = null;
  if (intent === "expense" || intent === "income" || intent === "investment_income") {
    const kind = intent === "expense" ? "expense" : "income";
    categoryId = suggestCategory(`${description} ${raw}`, kind, ctx.categories, ctx.merchantRules);
  }

  // Data yang kurang + satu pertanyaan
  const missing: MissingField[] = [];
  if (amount === null) missing.push("amount");
  if (intent === "transfer") {
    if (!fromAccountId) missing.push("fromAccount");
    if (!toAccountId) missing.push("toAccount");
  } else if (intent === "expense" || intent === "investment_buy") {
    if (!fromAccountId) missing.push("fromAccount");
  } else if (intent === "income" || intent === "investment_sell" || intent === "investment_income") {
    if (!toAccountId) missing.push("toAccount");
  }
  if ((intent === "expense" || intent === "income") && !categoryId) missing.push("category");
  if ((intent === "debt_receivable" || intent === "debt_payable" || intent === "debt_payment") && !counterparty) missing.push("counterparty");

  return {
    intent,
    amount,
    fromAccountId,
    toAccountId,
    categoryId,
    description,
    occurredAt: detectDate(t, now),
    counterparty,
    debtDirection,
    installment,
    investment,
    missing,
    question: questionFor(missing, intent),
  };
}

export function questionFor(missing: MissingField[], intent: ParsedIntent | null): string | null {
  const first = missing[0];
  switch (first) {
    case "amount":
      return "Berapa nominalnya?";
    case "fromAccount":
      return intent === "transfer" ? "Transfer dari rekening mana?" : "Pakai rekening mana?";
    case "toAccount":
      return intent === "transfer" ? "Transfer ke rekening mana?" : "Masuk ke rekening mana?";
    case "category":
      return "Masuk kategori apa?";
    case "counterparty":
      return "Dengan siapa?";
    default:
      return null;
  }
}
