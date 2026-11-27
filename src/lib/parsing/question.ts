/**
 * Pengenal pertanyaan sederhana untuk bot (tanpa AI): "saldo BCA berapa?",
 * "pengeluaran minggu ini", "hutang ke Budi", "hapus yang tadi", dst.
 * Hanya mencocokkan kata kunci; pesan yang berisi nominal tetap dianggap catatan transaksi.
 */
import { findAmounts } from "./amount";
import { hasWord, normalizeText, suggestCategory, type ParserAccount, type ParserCategory } from "./transaction-text";

export type QuestionPeriod = "today" | "yesterday" | "week" | "last_week" | "month" | "last_month";

export type Question =
  | { kind: "undo" }
  | { kind: "balance"; accountId: string | null }
  | { kind: "spending"; period: QuestionPeriod; categoryId: string | null }
  | { kind: "income"; period: QuestionPeriod }
  | { kind: "summary"; period: QuestionPeriod }
  | { kind: "debts"; direction: "payable" | "receivable"; counterparty: string | null }
  | { kind: "budget"; categoryId: string | null }
  | { kind: "investments" }
  | { kind: "business"; period: "month" | "last_month" }
  | { kind: "recent" }
  | { kind: "help" };

export const PERIOD_LABELS: Record<QuestionPeriod, string> = {
  today: "hari ini",
  yesterday: "kemarin",
  week: "minggu ini",
  last_week: "minggu lalu",
  month: "bulan ini",
  last_month: "bulan lalu",
};

const QUESTION_WORDS = /\b(berapa|brp|brapa|cek|lihat|liat|sisa|total|gimana|bagaimana|daftar|list|info|rekap|ada)\b/;
const FILLER =
  /\b(berapa|brp|brapa|cek|lihat|liat|sisa|total|gimana|bagaimana|sekarang|skrg|sih|dong|ya|yg|yang|aku|gua|gue|saya|ku|udah|sudah|sampai|sampe|buat|untuk|di|ke|ini|itu|kah|habis|abis|pengeluaran|pengeluaranku|keluar|spend|bulan|minggu|hari|kemarin|lalu|kemaren|anggaran|budget|bujet)\b/g;

export function detectPeriod(t: string, fallback: QuestionPeriod = "month"): QuestionPeriod {
  if (/\bhari ini\b|\btadi\b/.test(t)) return "today";
  if (/\bkemar[ie]n\b/.test(t)) return "yesterday";
  if (/\bminggu (ini|sekarang)\b|\bpekan ini\b/.test(t)) return "week";
  if (/\bminggu (lalu|kemar[ie]n)\b|\bpekan lalu\b/.test(t)) return "last_week";
  if (/\bbulan (lalu|kemar[ie]n)\b/.test(t)) return "last_month";
  if (/\bbulan (ini|sekarang)\b/.test(t)) return "month";
  return fallback;
}

function findAccount(t: string, accounts: ParserAccount[]): string | null {
  let best: { id: string; len: number } | null = null;
  for (const a of accounts) {
    for (const term of [a.name, ...a.aliases].map(normalizeText).filter(Boolean)) {
      if (hasWord(t, term) && (!best || term.length > best.len)) best = { id: a.id, len: term.length };
    }
  }
  return best?.id ?? null;
}

function findCounterparty(raw: string): string | null {
  const m = /\b(?:ke|sama|dari|dgn|dengan|di)\s+([\p{L}][\p{L}\p{N} .'-]{0,40})/iu.exec(raw);
  if (!m) return null;
  const name = m[1]!
    .replace(/[?!.]+$/g, "")
    .replace(/\b(berapa|brp|masih|sisa|ya|sih|dong|lagi|sekarang|skrg)\b.*$/i, "")
    .trim();
  return name.length ? name : null;
}

export function detectQuestion(input: string, ctx: { accounts: ParserAccount[]; categories: ParserCategory[] }): Question | null {
  const raw = input.trim();
  const t = normalizeText(raw);
  if (!t) return null;

  if (/^(hapus|batal(kan|in)?|undo|cancel)\b/.test(t) && /\b(tadi|terakhir|barusan|td)\b/.test(t)) return { kind: "undo" };
  if (t === "undo") return { kind: "undo" };

  // Ada nominal → ini catatan transaksi, bukan pertanyaan.
  if (findAmounts(raw).some((a) => a.value >= 100)) return null;
  const first = t.split(" ")[0] ?? "";
  if (["beli", "jual", "bayar", "pinjam", "pinjamkan", "transfer", "tf", "masuk", "terima", "setor"].includes(first)) return null;

  const asks = raw.includes("?") || QUESTION_WORDS.test(t);

  if (/\b(bantuan|help|bisa apa)\b/.test(t) || /\bcara (pakai|catat|pake)\b/.test(t)) return { kind: "help" };

  if (/\bpiutang\b/.test(t) || /\b(siapa|yg|yang) (masih )?(pinjam|ngutang|utang|hutang) (ke|sama) (aku|gua|gue|saya)\b/.test(t)) {
    return { kind: "debts", direction: "receivable", counterparty: /\bpiutang\b/.test(t) ? findCounterparty(raw) : null };
  }
  if (/\b(hutang|utang|cicilan|tagihan cicilan)\b/.test(t)) return { kind: "debts", direction: "payable", counterparty: findCounterparty(raw) };

  if (/\b(laba|untung|rugi|omzet|omset)\b/.test(t) || (/\busaha\b/.test(t) && (asks || t.split(" ").length <= 4))) {
    return { kind: "business", period: /\bbulan (lalu|kemar[ie]n)\b/.test(t) ? "last_month" : "month" };
  }

  if (/\b(anggaran|budget|bujet)\b/.test(t)) {
    const rest = t.replace(FILLER, " ").trim();
    return { kind: "budget", categoryId: rest ? suggestCategory(rest, "expense", ctx.categories) : null };
  }

  if (/\b(investasi|portofolio|portfolio|saham|reksa ?dana|bibit|emas|kripto|crypto)\b/.test(t) && (asks || t.split(" ").length <= 3)) {
    return { kind: "investments" };
  }

  if (/\b(saldo|duit|uang)\b/.test(t) && !/\b(pengeluaran|keluar|habis|abis)\b/.test(t)) {
    return { kind: "balance", accountId: findAccount(t, ctx.accounts) };
  }

  if (/\b(ringkasan|rekap|laporan|summary)\b/.test(t)) return { kind: "summary", period: detectPeriod(t) };

  if (/\b(pemasukan|pendapatan|penghasilan|income)\b/.test(t) || (asks && /\b(dapat|dapet|masuk)\b/.test(t))) {
    return { kind: "income", period: detectPeriod(t) };
  }

  const spendWord = /\b(pengeluaran|pengeluaranku|spend|spending|boros)\b/.test(t);
  const spendVerb = /\b(habis|abis|keluar|belanja|jajan|kepakai|kepake|terpakai)\b/.test(t);
  if (spendWord || (asks && spendVerb)) {
    const rest = t.replace(FILLER, " ").replace(/\s+/g, " ").trim();
    return { kind: "spending", period: detectPeriod(t), categoryId: rest ? suggestCategory(rest, "expense", ctx.categories) : null };
  }
  // "makan bulan ini berapa?" → pengeluaran kategori.
  if (asks) {
    const rest = t.replace(FILLER, " ").replace(/\s+/g, " ").trim();
    const cat = rest ? suggestCategory(rest, "expense", ctx.categories) : null;
    if (cat) return { kind: "spending", period: detectPeriod(t), categoryId: cat };
  }

  if (/\b(transaksi|riwayat|histori|history|mutasi)\b/.test(t)) return { kind: "recent" };
  return null;
}
