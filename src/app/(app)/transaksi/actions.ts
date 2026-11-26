"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/current";
import { formValues, runAction, type ActionState } from "@/server/action-result";
import {
  confirmTransaction,
  createTransaction,
  deleteTransaction,
  duplicateTransaction,
  restoreTransaction,
  updateTransaction,
} from "@/server/services/transactions";
import type { TransactionInput } from "@/server/validation/transaction";

function parseForm(formData: FormData): TransactionInput {
  const get = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v : undefined;
  };
  const splits: { categoryId?: string; amount: string; note?: string }[] = [];
  if (get("useSplits") === "on") {
    for (let i = 0; i < 50; i++) {
      const amount = get(`split.${i}.amount`);
      if (amount === undefined) break;
      if (!amount.trim()) continue;
      splits.push({ categoryId: get(`split.${i}.categoryId`), amount, note: get(`split.${i}.note`) });
    }
  }
  const type = (get("type") ?? "expense") as TransactionInput["type"];
  return {
    type,
    status: get("saveAsDraft") === "on" ? "draft" : "confirmed",
    occurredAt: get("occurredAt") ?? "",
    amount: get("amount") ?? "",
    description: get("description"),
    merchant: get("merchant"),
    note: get("note"),
    categoryId: get("categoryId"),
    fromAccountId: get("fromAccountId"),
    toAccountId: get("toAccountId"),
    tags: get("tags"),
    splits,
  };
}

function revalidateAll() {
  revalidatePath("/", "layout");
}

export async function saveTransactionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { ctx } = await requireUser();
  const id = formData.get("id");
  let savedId = "";
  const result = await runAction(async () => {
    const input = parseForm(formData);
    const t = typeof id === "string" && id ? await updateTransaction(ctx, id, input) : await createTransaction(ctx, input);
    savedId = t.id;
  }, formValues(formData));
  if (result.error) return result;
  revalidateAll();
  redirect(formData.get("addAnother") === "1" ? "/transaksi/baru?saved=1" : `/transaksi/${savedId}?saved=1`);
}

export async function confirmTransactionAction(id: string) {
  const { ctx } = await requireUser();
  const r = await runAction(async () => {
    await confirmTransaction(ctx, id);
  });
  revalidateAll();
  return r;
}

export async function deleteTransactionAction(id: string) {
  const { ctx } = await requireUser();
  const r = await runAction(async () => {
    await deleteTransaction(ctx, id);
  });
  revalidateAll();
  return r;
}

export async function restoreTransactionAction(id: string) {
  const { ctx } = await requireUser();
  const r = await runAction(async () => {
    await restoreTransaction(ctx, id);
  });
  revalidateAll();
  return r;
}

export async function duplicateTransactionAction(id: string): Promise<void> {
  const { ctx } = await requireUser();
  let newId = "";
  const r = await runAction(async () => {
    newId = (await duplicateTransaction(ctx, id)).id;
  });
  if (r.error) redirect(`/transaksi/${id}?error=${encodeURIComponent(r.error)}`);
  revalidateAll();
  redirect(`/transaksi/${newId}?duplicated=1`);
}
