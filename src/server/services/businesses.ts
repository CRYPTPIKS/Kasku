/**
 * Unit usaha: rekening atau kategori yang ditandai usaha dipisah dari laporan
 * pribadi (lihat `personalLines` di reports.ts). Di sini: kelola usaha dan
 * laporan laba per usaha.
 */
import { z } from "zod";
import { monthRange } from "@/lib/dates";
import { prisma } from "../db";
import { AppError, notFound } from "../errors";
import { canWrite, type ServiceContext } from "../context";
import { writeAudit } from "../audit";
import { listAccounts } from "./accounts";
import { businessOf, loadBusinesses, loadLines } from "./reports";

const businessInputSchema = z.object({
  name: z.string().trim().min(1, "Nama usaha wajib diisi").max(60),
  icon: z
    .string()
    .trim()
    .max(8)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
});
export type BusinessInput = z.input<typeof businessInputSchema>;

function assertWrite(ctx: ServiceContext) {
  if (!canWrite(ctx)) throw new AppError("Anda tidak punya akses mengubah data.", "forbidden");
}

export async function listBusinesses(ctx: ServiceContext) {
  return prisma.business.findMany({
    where: { householdId: ctx.householdId },
    orderBy: { createdAt: "asc" },
    include: {
      accounts: { select: { id: true, name: true, isArchived: true }, orderBy: { name: "asc" } },
      categories: { select: { id: true, name: true, kind: true, icon: true }, orderBy: [{ kind: "asc" }, { name: "asc" }] },
    },
  });
}

export async function createBusiness(ctx: ServiceContext, raw: BusinessInput) {
  assertWrite(ctx);
  const input = businessInputSchema.parse(raw);
  const clash = await prisma.business.findFirst({ where: { householdId: ctx.householdId, name: { equals: input.name, mode: "insensitive" } } });
  if (clash) throw new AppError(`Usaha "${clash.name}" sudah ada.`, "conflict");
  return prisma.$transaction(async (tx) => {
    const b = await tx.business.create({ data: { householdId: ctx.householdId, ...input } });
    await writeAudit(tx, ctx, { entityType: "Business", entityId: b.id, action: "create", after: b });
    return b;
  });
}

/** Hapus usaha. Rekening & kategorinya tetap ada dan kembali dihitung sebagai pribadi. */
export async function deleteBusiness(ctx: ServiceContext, id: string) {
  assertWrite(ctx);
  const before = await prisma.business.findFirst({ where: { id, householdId: ctx.householdId } });
  if (!before) throw notFound("Usaha");
  await prisma.$transaction(async (tx) => {
    await tx.business.delete({ where: { id } });
    await writeAudit(tx, ctx, { entityType: "Business", entityId: id, action: "delete", before });
  });
}

// ---------------------------------------------------------------------------
// Siapkan usaha contoh (Usaha Gas & Konten & Kerja)
// ---------------------------------------------------------------------------

interface TemplateCategory {
  name: string;
  kind: "income" | "expense";
  icon: string;
  keywords: string[];
}

export const BUSINESS_TEMPLATES: { name: string; icon: string; categories: TemplateCategory[] }[] = [
  {
    name: "Usaha Gas",
    icon: "🔥",
    categories: [
      { name: "Tebus Gas", kind: "expense", icon: "🛢️", keywords: ["beli gas", "tebus gas", "tebus", "gas lpg", "lpg", "elpiji", "brimola"] },
      { name: "Penjualan Gas", kind: "income", icon: "💵", keywords: ["setor tunai", "setoran", "setor", "jualan gas", "penjualan gas", "jual gas"] },
    ],
  },
  {
    name: "Konten & Kerja",
    icon: "🎬",
    categories: [
      {
        name: "Langganan & Software",
        kind: "expense",
        icon: "💻",
        keywords: ["capcut", "claude", "anthropic", "chatgpt", "openai", "canva", "transkrip", "langganan", "subscription", "google one", "icloud"],
      },
      { name: "Usaha & Freelance", kind: "income", icon: "🧑‍💻", keywords: ["adsense", "tiktok", "youtube", "klien", "fee", "endorse"] },
    ],
  },
];

/**
 * Buat usaha contoh beserta kategorinya. Kategori yang sudah ada (nama sama)
 * dipakai ulang dan kata kuncinya ditambah, tidak dibuat dobel. Aman dijalankan ulang.
 */
export async function setupBusinessTemplates(ctx: ServiceContext) {
  assertWrite(ctx);
  const created: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const t of BUSINESS_TEMPLATES) {
      let b = await tx.business.findFirst({ where: { householdId: ctx.householdId, name: { equals: t.name, mode: "insensitive" } } });
      if (!b) {
        b = await tx.business.create({ data: { householdId: ctx.householdId, name: t.name, icon: t.icon } });
        await writeAudit(tx, ctx, { entityType: "Business", entityId: b.id, action: "create", after: b });
        created.push(t.name);
      }
      for (const c of t.categories) {
        const existing = await tx.category.findFirst({
          where: { householdId: ctx.householdId, kind: c.kind, name: { equals: c.name, mode: "insensitive" } },
        });
        if (existing) {
          const keywords = [...new Set([...existing.keywords, ...c.keywords])];
          const after = await tx.category.update({ where: { id: existing.id }, data: { businessId: b.id, keywords, isArchived: false } });
          await writeAudit(tx, ctx, { entityType: "Category", entityId: existing.id, action: "update", before: existing, after });
        } else {
          const after = await tx.category.create({ data: { householdId: ctx.householdId, name: c.name, kind: c.kind, icon: c.icon, keywords: c.keywords, businessId: b.id } });
          await writeAudit(tx, ctx, { entityType: "Category", entityId: after.id, action: "create", after });
        }
      }
    }
  });
  return { created };
}

// ---------------------------------------------------------------------------
// Laporan usaha
// ---------------------------------------------------------------------------

export interface BusinessMonth {
  month: string;
  income: number;
  expense: number;
  profit: number;
  /** Uang yang dipindah dari rekening usaha ke rekening pribadi. */
  withdrawn: number;
  /** Uang pribadi yang dimasukkan ke rekening usaha. */
  injected: number;
}

export interface BusinessReport {
  id: string;
  name: string;
  icon: string | null;
  accounts: { id: string; name: string; balance: number }[];
  balance: number;
  months: BusinessMonth[];
  total: Omit<BusinessMonth, "month">;
}

/** Laba per usaha per bulan, `months` bulan terakhir sampai bulan (year, month). */
export async function businessReport(ctx: ServiceContext, year: number, month: number, months = 6): Promise<BusinessReport[]> {
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(year, month - 1 - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  const [fy, fm] = keys[0]!.split("-").map(Number) as [number, number];
  const from = monthRange(fy, fm).start;
  const to = monthRange(year, month).end;
  const [businesses, lines, accounts] = await Promise.all([loadBusinesses(ctx), loadLines(ctx, from, to), listAccounts(ctx, { includeArchived: true })]);

  const empty = (m: string): BusinessMonth => ({ month: m, income: 0, expense: 0, profit: 0, withdrawn: 0, injected: 0 });
  const table = new Map(businesses.map((b) => [b.id, new Map(keys.map((k) => [k, empty(k)]))]));
  for (const l of lines) {
    if (l.type === "transfer") {
      if (l.fromBiz && l.fromBiz !== l.toBiz) {
        const r = table.get(l.fromBiz)?.get(l.month);
        if (r) r.withdrawn += l.amount;
      }
      if (l.toBiz && l.toBiz !== l.fromBiz) {
        const r = table.get(l.toBiz)?.get(l.month);
        if (r) r.injected += l.amount;
      }
      continue;
    }
    const bizId = businessOf(l);
    const r = bizId ? table.get(bizId)?.get(l.month) : undefined;
    if (!r) continue;
    if (l.type === "expense") r.expense += l.amount;
    else r.income += l.amount;
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  return businesses.map((b) => {
    const rows = [...table.get(b.id)!.values()].map((r) => ({
      ...r,
      income: round(r.income),
      expense: round(r.expense),
      profit: round(r.income - r.expense),
      withdrawn: round(r.withdrawn),
      injected: round(r.injected),
    }));
    const total = rows.reduce(
      (a, r) => ({ income: a.income + r.income, expense: a.expense + r.expense, profit: a.profit + r.profit, withdrawn: a.withdrawn + r.withdrawn, injected: a.injected + r.injected }),
      { income: 0, expense: 0, profit: 0, withdrawn: 0, injected: 0 },
    );
    const accs = accounts.filter((a) => a.businessId === b.id).map((a) => ({ id: a.id, name: a.name, balance: a.balance }));
    return {
      id: b.id,
      name: b.name,
      icon: b.icon,
      accounts: accs,
      balance: round(accs.reduce((a, x) => a + x.balance, 0)),
      months: rows,
      total: { income: round(total.income), expense: round(total.expense), profit: round(total.profit), withdrawn: round(total.withdrawn), injected: round(total.injected) },
    };
  });
}
