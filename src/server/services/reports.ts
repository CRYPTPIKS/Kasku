import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import type { ServiceContext } from "../context";

/** Tipe yang dihitung sebagai pemasukan/pengeluaran (transfer & hutang tidak). */
const INCOME_TYPES = ["income", "investment_income"] as const;
const EXPENSE_TYPES = ["expense"] as const;

export interface CashFlowRow {
  month: string; // YYYY-MM (WIB)
  income: number;
  expense: number;
  net: number;
}

/**
 * Arus kas bulanan (pribadi) dalam rentang [from, to). Bulan dihitung di zona
 * Asia/Jakarta. Transaksi usaha dipisah; lihat `personalLines`.
 */
export async function monthlyCashFlow(ctx: ServiceContext, from: Date, to: Date): Promise<CashFlowRow[]> {
  const lines = personalLines(await loadLines(ctx, from, to), await loadBusinesses(ctx));
  const byMonth = new Map<string, { income: number; expense: number }>();
  for (const l of lines) {
    const row = byMonth.get(l.month) ?? { income: 0, expense: 0 };
    row[l.kind] += l.amount;
    byMonth.set(l.month, row);
  }
  // Isi bulan kosong agar grafik/laporan kontinu.
  return monthsBetween(from, to).map((month) => {
    const r = byMonth.get(month) ?? { income: 0, expense: 0 };
    return { month, income: r.income, expense: r.expense, net: r.income - r.expense };
  });
}

function monthsBetween(from: Date, to: Date): string[] {
  const shift = 7 * 3600 * 1000;
  const a = new Date(from.getTime() + shift);
  const b = new Date(to.getTime() + shift - 1);
  const out: string[] = [];
  let y = a.getUTCFullYear();
  let m = a.getUTCMonth();
  while (y < b.getUTCFullYear() || (y === b.getUTCFullYear() && m <= b.getUTCMonth())) {
    out.push(`${y}-${String(m + 1).padStart(2, "0")}`);
    m += 1;
    if (m === 12) {
      m = 0;
      y += 1;
    }
    if (out.length > 600) break;
  }
  return out;
}

export interface CategoryTotal {
  categoryId: string | null;
  name: string;
  icon: string | null;
  color: string | null;
  total: number;
  count: number;
  /** Baris gabungan dari usaha (mis. "Penghasilan Usaha Gas"), bukan kategori asli. */
  businessId?: string;
}

export interface ReportOptions {
  /**
   * "personal" (bawaan): transaksi usaha dipisah, yang masuk hanya uang yang
   * berpindah antara usaha dan rekening pribadi. "all": semua transaksi apa adanya
   * (dipakai anggaran & pertanyaan per kategori).
   */
  scope?: "personal" | "all";
}

/** Total per kategori; transaksi yang dibagi dihitung per bagiannya. */
export async function totalsByCategory(
  ctx: ServiceContext,
  kind: "income" | "expense",
  from: Date,
  to: Date,
  opts: ReportOptions = {},
): Promise<CategoryTotal[]> {
  const [raw, categories, businesses] = await Promise.all([
    loadLines(ctx, from, to),
    prisma.category.findMany({ where: { householdId: ctx.householdId }, select: { id: true, name: true, icon: true, color: true } }),
    loadBusinesses(ctx),
  ]);
  const catById = new Map(categories.map((c) => [c.id, c]));
  const lines = opts.scope === "all" ? allLines(raw) : personalLines(raw, businesses);
  const groups = new Map<string, CategoryTotal & { tids: Set<string> }>();
  for (const l of lines) {
    if (l.kind !== kind) continue;
    const key = l.business ? `biz:${l.business.id}:${l.business.label}` : `cat:${l.categoryId ?? ""}`;
    let g = groups.get(key);
    if (!g) {
      const c = l.categoryId ? catById.get(l.categoryId) : undefined;
      g = l.business
        ? { categoryId: null, name: l.business.label, icon: l.business.icon, color: null, total: 0, count: 0, businessId: l.business.id, tids: new Set() }
        : { categoryId: l.categoryId, name: c?.name ?? "Tanpa kategori", icon: c?.icon ?? null, color: c?.color ?? null, total: 0, count: 0, tids: new Set() };
      groups.set(key, g);
    }
    g.total += l.amount;
    for (const t of l.tids) g.tids.add(t);
  }
  return [...groups.values()]
    .map(({ tids, ...g }) => ({ ...g, total: round2(g.total), count: tids.size }))
    .filter((g) => g.total > 0)
    .sort((a, b) => b.total - a.total);
}

/** Ringkasan pemasukan & pengeluaran (pribadi) untuk satu rentang. */
export async function periodTotals(ctx: ServiceContext, from: Date, to: Date, opts: ReportOptions = {}) {
  const raw = await loadLines(ctx, from, to);
  const lines = opts.scope === "all" ? allLines(raw) : personalLines(raw, await loadBusinesses(ctx));
  let income = 0;
  let expense = 0;
  for (const l of lines) {
    if (l.kind === "income") income += l.amount;
    else expense += l.amount;
  }
  income = round2(income);
  expense = round2(expense);
  return { income, expense, net: round2(income - expense) };
}

// ---------------------------------------------------------------------------
// Pemisahan usaha vs pribadi
// ---------------------------------------------------------------------------

/** Satu baris transaksi terkonfirmasi (per bagian jika dibagi) beserta tanda usahanya. */
export interface RawLine {
  tid: string;
  type: string;
  month: string;
  amount: number;
  categoryId: string | null;
  fromBiz: string | null;
  toBiz: string | null;
  catBiz: string | null;
}

export interface PersonalLine {
  kind: "income" | "expense";
  month: string;
  amount: number;
  categoryId: string | null;
  tids: string[];
  business?: { id: string; label: string; icon: string | null };
}

export interface BusinessInfo {
  id: string;
  name: string;
  icon: string | null;
}

export async function loadBusinesses(ctx: ServiceContext): Promise<BusinessInfo[]> {
  return prisma.business.findMany({ where: { householdId: ctx.householdId }, select: { id: true, name: true, icon: true }, orderBy: { createdAt: "asc" } });
}

export async function loadLines(ctx: ServiceContext, from: Date, to: Date): Promise<RawLine[]> {
  const rows = await prisma.$queryRaw<
    { tid: string; type: string; month: string; amount: Prisma.Decimal; categoryId: string | null; fromBiz: string | null; toBiz: string | null; catBiz: string | null }[]
  >`
    SELECT t.id AS tid,
           t.type::text AS type,
           to_char(t."occurredAt" AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') AS month,
           COALESCE(s.amount, t.amount) AS amount,
           COALESCE(s."categoryId", t."categoryId") AS "categoryId",
           fa."businessId" AS "fromBiz",
           ta."businessId" AS "toBiz",
           COALESCE(c."businessId", pc."businessId") AS "catBiz"
    FROM "Transaction" t
    LEFT JOIN "TransactionSplit" s ON s."transactionId" = t.id
    LEFT JOIN "Account" fa ON fa.id = t."fromAccountId"
    LEFT JOIN "Account" ta ON ta.id = t."toAccountId"
    LEFT JOIN "Category" c ON c.id = COALESCE(s."categoryId", t."categoryId")
    LEFT JOIN "Category" pc ON pc.id = c."parentId"
    WHERE t."householdId" = ${ctx.householdId}
      AND t.status = 'confirmed'
      AND t."deletedAt" IS NULL
      AND t.type::text IN (${Prisma.join([...INCOME_TYPES, ...EXPENSE_TYPES, "transfer"])})
      AND t."occurredAt" >= ${from} AND t."occurredAt" < ${to}`;
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

function kindOf(type: string): "income" | "expense" | null {
  if ((INCOME_TYPES as readonly string[]).includes(type)) return "income";
  if ((EXPENSE_TYPES as readonly string[]).includes(type)) return "expense";
  return null;
}

/** Rekening yang terkena: pemasukan → rekening tujuan, pengeluaran → rekening asal. */
function accountBiz(l: RawLine): string | null {
  return kindOf(l.type) === "income" ? l.toBiz : l.fromBiz;
}

/** Usaha pemilik baris pemasukan/pengeluaran: rekening usaha didahulukan, lalu kategori usaha. */
export function businessOf(l: RawLine): string | null {
  return accountBiz(l) ?? l.catBiz;
}

function allLines(raw: RawLine[]): PersonalLine[] {
  const out: PersonalLine[] = [];
  for (const l of raw) {
    const kind = kindOf(l.type);
    if (kind) out.push({ kind, month: l.month, amount: l.amount, categoryId: l.categoryId, tids: [l.tid] });
  }
  return out;
}

/**
 * Baris untuk laporan pribadi:
 * - Transaksi biasa (rekening & kategori bukan usaha) → apa adanya.
 * - Pemasukan/pengeluaran di **rekening usaha** → tidak dihitung (urusan usaha).
 * - Transfer rekening usaha → pribadi → pemasukan "Penghasilan <usaha>".
 * - Transfer pribadi → rekening usaha → pengeluaran "Modal <usaha>".
 * - Pemasukan/pengeluaran berkategori usaha di rekening pribadi → dijumlah per
 *   bulan; laba bersihnya masuk "Penghasilan <usaha>", ruginya "Modal <usaha>".
 */
export function personalLines(raw: RawLine[], businesses: BusinessInfo[]): PersonalLine[] {
  const biz = new Map(businesses.map((b) => [b.id, b]));
  const out: PersonalLine[] = [];
  const synthetic = new Map<string, PersonalLine>();
  const catNet = new Map<string, { bizId: string; month: string; net: number; tids: string[] }>();

  const addSynthetic = (bizId: string, kind: "income" | "expense", month: string, amount: number, tids: string[]) => {
    if (amount <= 0) return;
    const b = biz.get(bizId);
    const label = `${kind === "income" ? "Penghasilan" : "Modal"} ${b?.name ?? "Usaha"}`;
    const key = `${bizId}|${kind}|${month}`;
    const line = synthetic.get(key) ?? { kind, month, amount: 0, categoryId: null, tids: [], business: { id: bizId, label, icon: b?.icon ?? null } };
    line.amount += amount;
    line.tids.push(...tids);
    synthetic.set(key, line);
  };

  for (const l of raw) {
    if (l.type === "transfer") {
      if (l.fromBiz && !l.toBiz) addSynthetic(l.fromBiz, "income", l.month, l.amount, [l.tid]);
      else if (!l.fromBiz && l.toBiz) addSynthetic(l.toBiz, "expense", l.month, l.amount, [l.tid]);
      continue;
    }
    const kind = kindOf(l.type);
    if (!kind) continue;
    if (accountBiz(l)) continue;
    if (l.catBiz) {
      const key = `${l.catBiz}|${l.month}`;
      const e = catNet.get(key) ?? { bizId: l.catBiz, month: l.month, net: 0, tids: [] };
      e.net += kind === "income" ? l.amount : -l.amount;
      e.tids.push(l.tid);
      catNet.set(key, e);
      continue;
    }
    out.push({ kind, month: l.month, amount: l.amount, categoryId: l.categoryId, tids: [l.tid] });
  }
  for (const e of catNet.values()) {
    const net = round2(e.net);
    if (net > 0) addSynthetic(e.bizId, "income", e.month, net, e.tids);
    else if (net < 0) addSynthetic(e.bizId, "expense", e.month, -net, e.tids);
  }
  return [...out, ...synthetic.values()];
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
