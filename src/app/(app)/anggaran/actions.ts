"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/current";
import { runAction, type ActionState } from "@/server/action-result";
import { deleteBudget, setBudget } from "@/server/services/budgets";

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string) : undefined);

export async function saveBudgetAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx } = await requireUser();
  const r = await runAction(async () => {
    await setBudget(ctx, {
      categoryId: str(fd, "categoryId") ?? "",
      amount: str(fd, "amount") ?? "",
      scope: str(fd, "scope") === "month" ? "month" : "default",
      month: str(fd, "month"),
    });
    return { ok: true, message: "Anggaran tersimpan." };
  });
  if (!r.error) revalidatePath("/", "layout");
  return r;
}

export async function deleteBudgetAction(id: string) {
  const { ctx } = await requireUser();
  const r = await runAction(async () => {
    await deleteBudget(ctx, id);
  });
  revalidatePath("/", "layout");
  return r;
}
