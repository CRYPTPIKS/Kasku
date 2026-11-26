"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseAmount } from "@/lib/parsing/amount";
import { requireUser } from "@/server/auth/current";
import { formValues, runAction, type ActionState } from "@/server/action-result";
import { prisma } from "@/server/db";
import {
  createAsset,
  deleteInvestmentTransaction,
  recordInvestmentTransaction,
  setAssetArchived,
  setAssetPrice,
} from "@/server/services/investments";
import type { AssetInput } from "@/server/validation/tahap4";

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string) : undefined);

export async function createAssetAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx } = await requireUser();
  let id = "";
  const r = await runAction(async () => {
    const a = await createAsset(ctx, {
      assetClass: (str(fd, "assetClass") ?? "") as AssetInput["assetClass"],
      name: str(fd, "name") ?? "",
      symbol: str(fd, "symbol"),
      unitLabel: str(fd, "unitLabel"),
      unitsPerLot: str(fd, "unitsPerLot"),
    });
    id = a.id;
  }, formValues(fd));
  if (r.error) return r;
  revalidatePath("/", "layout");
  redirect(`/investasi/${id}`);
}

export async function recordTradeAction(assetId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx } = await requireUser();
  const r = await runAction(async () => {
    const kind = (str(fd, "kind") ?? "buy") as "buy" | "sell" | "dividend" | "interest";
    const asset = await prisma.investmentAsset.findFirst({ where: { id: assetId, householdId: ctx.householdId }, select: { unitsPerLot: true } });
    const rawUnits = str(fd, "units");
    let units: number | null = rawUnits ? parseAmount(rawUnits) : null;
    // Saham: jumlah bisa diisi dalam lot.
    if (units !== null && str(fd, "unitMode") === "lot" && asset?.unitsPerLot) units *= asset.unitsPerLot;
    await recordInvestmentTransaction(ctx, assetId, {
      kind,
      occurredAt: str(fd, "occurredAt") ?? "",
      units: kind === "buy" || kind === "sell" ? units : null,
      pricePerUnit: kind === "buy" || kind === "sell" ? str(fd, "pricePerUnit") || null : null,
      fee: str(fd, "fee") || null,
      totalAmount: str(fd, "totalAmount"),
      accountId: str(fd, "accountId"),
      note: str(fd, "note"),
    });
    return { ok: true, message: "Transaksi investasi tercatat." };
  });
  if (!r.error) revalidatePath("/", "layout");
  return r;
}

export async function setPriceAction(assetId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx } = await requireUser();
  const r = await runAction(async () => {
    await setAssetPrice(ctx, assetId, { price: str(fd, "price") ?? "", asOf: str(fd, "asOf") || undefined });
    return { ok: true, message: "Harga diperbarui." };
  });
  if (!r.error) revalidatePath("/", "layout");
  return r;
}

export async function deleteTradeAction(id: string) {
  const { ctx } = await requireUser();
  const r = await runAction(async () => {
    await deleteInvestmentTransaction(ctx, id);
  });
  revalidatePath("/", "layout");
  return r;
}

export async function archiveAssetAction(id: string, archived: boolean) {
  const { ctx } = await requireUser();
  const r = await runAction(async () => {
    await setAssetArchived(ctx, id, archived);
  });
  revalidatePath("/", "layout");
  return r;
}
