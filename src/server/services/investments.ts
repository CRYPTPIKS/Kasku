import type { InvestmentAssetClass, Prisma } from "@prisma/client";
import { computeHolding, tradeTotal, valuate, type InvestmentTrade } from "@/lib/investments";
import { prisma, type Tx } from "../db";
import { AppError, notFound } from "../errors";
import { canWrite, type ServiceContext } from "../context";
import { writeAudit } from "../audit";
import {
  assetInputSchema,
  investmentTxInputSchema,
  priceInputSchema,
  type AssetInput,
  type InvestmentTxInput,
  type PriceInput,
} from "../validation/tahap4";
import { createTransaction } from "./transactions";

type Source = "web" | "telegram_text" | "system";

export const ASSET_CLASS_LABELS: Record<InvestmentAssetClass, string> = {
  stock: "Saham",
  mutual_fund: "Reksa dana",
  gold: "Emas",
  crypto: "Kripto",
  deposit: "Deposito",
  bond: "Obligasi/SBN",
  other: "Lainnya",
};

export const INVESTMENT_KIND_LABELS = { buy: "Beli", sell: "Jual", dividend: "Dividen", interest: "Bunga/kupon", fee: "Biaya" } as const;

function assertWrite(ctx: ServiceContext) {
  if (!canWrite(ctx)) throw new AppError("Anda tidak punya akses mengubah data.", "forbidden");
}

/** Transaksi investasi yang dihitung: tanpa transaksi kas, atau transaksi kasnya terkonfirmasi & tidak dihapus. */
const countedTrades = {
  OR: [{ transactionId: null }, { transaction: { status: "confirmed", deletedAt: null } }],
} satisfies Prisma.InvestmentTransactionWhereInput;

function toTrade(t: { kind: InvestmentTrade["kind"]; occurredAt: Date; units: Prisma.Decimal; pricePerUnit: Prisma.Decimal; fee: Prisma.Decimal; totalAmount: Prisma.Decimal }): InvestmentTrade {
  return {
    kind: t.kind,
    occurredAt: t.occurredAt,
    units: Number(t.units),
    pricePerUnit: Number(t.pricePerUnit),
    fee: Number(t.fee),
    totalAmount: Number(t.totalAmount),
  };
}

async function loadTrades(db: Tx | typeof prisma, assetId: string) {
  const rows = await db.investmentTransaction.findMany({ where: { assetId, ...countedTrades }, orderBy: { occurredAt: "asc" } });
  return rows.map(toTrade);
}

// ---------------------------------------------------------------------------
// Aset
// ---------------------------------------------------------------------------

export async function createAsset(ctx: ServiceContext, raw: AssetInput, db: Tx | typeof prisma = prisma) {
  assertWrite(ctx);
  const input = assetInputSchema.parse(raw);
  const exists = await db.investmentAsset.findFirst({
    where: { householdId: ctx.householdId, assetClass: input.assetClass, name: { equals: input.name, mode: "insensitive" } },
  });
  if (exists) throw new AppError(`Aset "${input.name}" sudah ada.`, "validation", { name: "Sudah ada" });
  const asset = await db.investmentAsset.create({
    data: {
      householdId: ctx.householdId,
      assetClass: input.assetClass,
      name: input.name,
      symbol: input.symbol,
      unitLabel: input.unitLabel,
      unitsPerLot: input.unitsPerLot ?? (input.assetClass === "stock" ? 100 : null),
    },
  });
  await writeAudit(db as Tx, ctx, { entityType: "InvestmentAsset", entityId: asset.id, action: "create", after: asset });
  return asset;
}

export async function updateAsset(ctx: ServiceContext, id: string, raw: AssetInput) {
  assertWrite(ctx);
  const input = assetInputSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const before = await tx.investmentAsset.findFirst({ where: { id, householdId: ctx.householdId } });
    if (!before) throw notFound("Aset");
    const after = await tx.investmentAsset.update({
      where: { id },
      data: { assetClass: input.assetClass, name: input.name, symbol: input.symbol, unitLabel: input.unitLabel, unitsPerLot: input.unitsPerLot },
    });
    await writeAudit(tx, ctx, { entityType: "InvestmentAsset", entityId: id, action: "update", before, after });
    return after;
  });
}

export async function setAssetArchived(ctx: ServiceContext, id: string, archived: boolean) {
  assertWrite(ctx);
  const asset = await prisma.investmentAsset.findFirst({ where: { id, householdId: ctx.householdId } });
  if (!asset) throw notFound("Aset");
  if (archived) {
    const h = computeHolding(await loadTrades(prisma, id));
    if (h.units > 0) throw new AppError("Aset masih punya unit. Catat penjualannya dulu sebelum diarsipkan.");
  }
  return prisma.investmentAsset.update({ where: { id }, data: { isArchived: archived } });
}

// ---------------------------------------------------------------------------
// Transaksi investasi
// ---------------------------------------------------------------------------

/**
 * Catat beli/jual/dividen/bunga. Jika rekening diisi, kas ikut tercatat
 * (investment_buy keluar, investment_sell & investment_income masuk).
 */
export async function recordInvestmentTransaction(ctx: ServiceContext, assetId: string, raw: InvestmentTxInput, opts: { source?: Source; tx?: Tx } = {}) {
  assertWrite(ctx);
  const input = investmentTxInputSchema.parse(raw);
  const run = async (tx: Tx) => {
    const asset = await tx.investmentAsset.findFirst({ where: { id: assetId, householdId: ctx.householdId } });
    if (!asset) throw notFound("Aset");
    if (asset.isArchived) throw new AppError(`Aset "${asset.name}" sudah diarsipkan.`);

    let units = 0;
    let price = 0;
    let total: number;
    if (input.kind === "buy" || input.kind === "sell") {
      if (input.units && input.units > 0) {
        units = input.units;
        price = input.pricePerUnit && input.pricePerUnit > 0 ? input.pricePerUnit : (input.totalAmount! + (input.kind === "buy" ? -input.fee : input.fee)) / units;
      } else {
        // Mode nominal (mis. deposito/reksa dana tanpa unit): unit = nominal, harga 1.
        units = input.totalAmount!;
        price = 1;
      }
      total = input.totalAmount ?? tradeTotal(input.kind, units, price, input.fee);
      if (!(total > 0)) throw new AppError("Total transaksi harus lebih dari 0.", "validation", { totalAmount: "Periksa unit, harga, dan biaya" });
    } else {
      total = input.totalAmount!;
    }

    if (input.kind === "sell") {
      const held = computeHolding(await loadTrades(tx, assetId)).units;
      if (units > held + 1e-9) {
        throw new AppError(`Unit yang dijual (${fmtUnits(units)}) melebihi yang dimiliki (${fmtUnits(held)}).`, "validation", { units: "Melebihi kepemilikan" });
      }
    }

    let transactionId: string | null = null;
    if (input.accountId) {
      const type = input.kind === "buy" ? "investment_buy" : input.kind === "sell" ? "investment_sell" : "investment_income";
      const verb = { buy: "Beli", sell: "Jual", dividend: "Dividen", interest: "Bunga" }[input.kind];
      const t = await createTransaction(
        ctx,
        {
          type,
          status: "confirmed",
          amount: total,
          occurredAt: input.occurredAt,
          description: `${verb} ${asset.symbol ?? asset.name}`,
          note: input.note,
          fromAccountId: type === "investment_buy" ? input.accountId : null,
          toAccountId: type === "investment_buy" ? null : input.accountId,
        },
        { tx, source: opts.source ?? "web" },
      );
      transactionId = t.id;
    }

    const created = await tx.investmentTransaction.create({
      data: {
        assetId,
        transactionId,
        kind: input.kind,
        occurredAt: input.occurredAt,
        units,
        pricePerUnit: price,
        fee: input.fee,
        totalAmount: total,
        note: input.note,
      },
    });
    await writeAudit(tx, ctx, { entityType: "InvestmentTransaction", entityId: created.id, action: "create", after: { ...created, asset: asset.name } });
    return created;
  };
  return opts.tx ? run(opts.tx) : prisma.$transaction(run);
}

export async function deleteInvestmentTransaction(ctx: ServiceContext, id: string) {
  assertWrite(ctx);
  return prisma.$transaction(async (tx) => {
    const before = await tx.investmentTransaction.findFirst({ where: { id, asset: { householdId: ctx.householdId } } });
    if (!before) throw notFound("Transaksi investasi");
    await tx.investmentTransaction.delete({ where: { id } });
    try {
      computeHolding(await loadTrades(tx, before.assetId));
    } catch {
      throw new AppError("Tidak bisa dihapus: unit yang sudah dijual akan melebihi unit yang dimiliki. Hapus penjualannya dulu.");
    }
    if (before.transactionId) {
      await tx.transaction.updateMany({
        where: { id: before.transactionId, deletedAt: null },
        data: { deletedAt: new Date(), deletedById: ctx.userId },
      });
    }
    await writeAudit(tx, ctx, { entityType: "InvestmentTransaction", entityId: id, action: "delete", before });
  });
}

export async function setAssetPrice(ctx: ServiceContext, assetId: string, raw: PriceInput) {
  assertWrite(ctx);
  const input = priceInputSchema.parse(raw);
  const asset = await prisma.investmentAsset.findFirst({ where: { id: assetId, householdId: ctx.householdId } });
  if (!asset) throw notFound("Aset");
  return prisma.investmentPrice.create({ data: { assetId, price: input.price, asOf: input.asOf ?? new Date(), source: "manual" } });
}

// ---------------------------------------------------------------------------
// Portofolio
// ---------------------------------------------------------------------------

export function fmtUnits(n: number) {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 8 }).format(n);
}

export interface PortfolioItem {
  id: string;
  name: string;
  symbol: string | null;
  assetClass: InvestmentAssetClass;
  unitLabel: string;
  unitsPerLot: number | null;
  isArchived: boolean;
  units: number;
  costBasis: number;
  avgCost: number;
  realized: number;
  income: number;
  price: number | null;
  priceAsOf: Date | null;
  priceSource: "manual" | "trade" | null;
  marketValue: number;
  unrealized: number;
  unrealizedPct: number;
}

export async function getPortfolio(ctx: ServiceContext, opts: { includeArchived?: boolean } = {}) {
  const assets = await prisma.investmentAsset.findMany({
    where: { householdId: ctx.householdId, ...(opts.includeArchived ? {} : { isArchived: false }) },
    include: {
      transactions: { where: countedTrades, orderBy: { occurredAt: "asc" } },
      prices: { orderBy: { asOf: "desc" }, take: 1 },
    },
    orderBy: [{ assetClass: "asc" }, { name: "asc" }],
  });
  const items: PortfolioItem[] = assets.map((a) => {
    const h = computeHolding(a.transactions.map(toTrade));
    const manual = a.prices[0];
    // Harga terbaru: pembaruan manual atau harga transaksi terakhir, mana yang lebih baru.
    const useManual = manual && (!h.lastTradeAt || manual.asOf >= h.lastTradeAt);
    const price = useManual ? Number(manual.price) : h.lastTradePrice;
    const v = valuate(h, price);
    return {
      id: a.id,
      name: a.name,
      symbol: a.symbol,
      assetClass: a.assetClass,
      unitLabel: a.unitLabel,
      unitsPerLot: a.unitsPerLot,
      isArchived: a.isArchived,
      units: h.units,
      costBasis: h.costBasis,
      avgCost: h.avgCost,
      realized: h.realized,
      income: h.income,
      price,
      priceAsOf: useManual ? manual.asOf : h.lastTradeAt,
      priceSource: useManual ? "manual" : price !== null ? "trade" : null,
      ...v,
    };
  });
  const held = items.filter((i) => i.units > 0);
  const totals = {
    marketValue: held.reduce((a, i) => a + i.marketValue, 0),
    costBasis: held.reduce((a, i) => a + i.costBasis, 0),
    realized: items.reduce((a, i) => a + i.realized, 0),
    income: items.reduce((a, i) => a + i.income, 0),
  };
  const byClass = new Map<InvestmentAssetClass, number>();
  for (const i of held) byClass.set(i.assetClass, (byClass.get(i.assetClass) ?? 0) + i.marketValue);
  return {
    items,
    totals: { ...totals, unrealized: totals.marketValue - totals.costBasis },
    allocation: [...byClass.entries()]
      .map(([assetClass, value]) => ({ assetClass, label: ASSET_CLASS_LABELS[assetClass], value }))
      .sort((a, b) => b.value - a.value),
  };
}

export async function getAssetDetail(ctx: ServiceContext, id: string) {
  const asset = await prisma.investmentAsset.findFirst({
    where: { id, householdId: ctx.householdId },
    include: {
      transactions: {
        where: countedTrades,
        orderBy: { occurredAt: "desc" },
        include: { transaction: { select: { id: true, fromAccount: { select: { name: true } }, toAccount: { select: { name: true } } } } },
      },
      prices: { orderBy: { asOf: "desc" }, take: 10 },
    },
  });
  if (!asset) throw notFound("Aset");
  const portfolio = await getPortfolio(ctx, { includeArchived: true });
  const summary = portfolio.items.find((i) => i.id === id)!;
  return { asset, summary };
}

/** Cari aset berdasarkan simbol atau nama (untuk bot). */
export async function findAsset(ctx: ServiceContext, query: string) {
  const q = query.trim();
  if (!q) return null;
  return prisma.investmentAsset.findFirst({
    where: {
      householdId: ctx.householdId,
      isArchived: false,
      OR: [{ symbol: { equals: q, mode: "insensitive" } }, { name: { equals: q, mode: "insensitive" } }],
    },
  });
}

/** Tebak jenis aset dari satuan/nama (untuk aset baru dari bot). */
export function guessAssetClass(name: string, unitLabel: string | null): { assetClass: InvestmentAssetClass; unitLabel: string } {
  const n = name.toLowerCase();
  const u = (unitLabel ?? "").toLowerCase();
  if (u === "lot" || u === "lembar" || u === "saham" || /^[a-z]{4}$/.test(n)) return { assetClass: "stock", unitLabel: "lembar" };
  if (u === "gram" || u === "gr" || /\bemas|antam|logam mulia\b/.test(n)) return { assetClass: "gold", unitLabel: "gram" };
  if (u === "koin" || u === "coin" || /\b(btc|eth|usdt|sol|bnb|kripto|crypto|bitcoin)\b/.test(n)) return { assetClass: "crypto", unitLabel: "koin" };
  if (/reksa ?dana|\brd\b/.test(n)) return { assetClass: "mutual_fund", unitLabel: "unit" };
  if (/deposito/.test(n)) return { assetClass: "deposit", unitLabel: "unit" };
  if (/\b(sbn|ori|sbr|sukuk|obligasi|st\d+)\b/.test(n)) return { assetClass: "bond", unitLabel: "unit" };
  return { assetClass: "other", unitLabel: u || "unit" };
}
