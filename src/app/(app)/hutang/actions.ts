"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseDateInput } from "@/lib/dates";
import { requireUser } from "@/server/auth/current";
import { formValues, runAction, type ActionState } from "@/server/action-result";
import { createDebt, deleteDebt, recordDebtPayment, updateDebtDetails } from "@/server/services/debts";

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string) : undefined);

export async function createDebtAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx } = await requireUser();
  let id = "";
  const r = await runAction(async () => {
    const withInstallments = str(fd, "useInstallments") === "on";
    const d = await createDebt(ctx, {
      direction: (str(fd, "direction") ?? "") as "payable",
      counterparty: str(fd, "counterparty") ?? "",
      principalAmount: str(fd, "principalAmount") ?? "",
      startDate: str(fd, "startDate") ?? "",
      dueDate: withInstallments ? null : str(fd, "dueDate"),
      note: str(fd, "note"),
      accountId: str(fd, "accountId"),
      installmentCount: withInstallments ? str(fd, "installmentCount") : null,
      installmentAmount: withInstallments ? str(fd, "installmentAmount") : null,
      firstDueDate: withInstallments ? str(fd, "firstDueDate") : null,
      reminderDaysBefore: str(fd, "reminderDaysBefore"),
    });
    id = d.id;
  }, formValues(fd));
  if (r.error) return r;
  revalidatePath("/", "layout");
  redirect(`/hutang/${id}?saved=1`);
}

export async function payDebtAction(debtId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx } = await requireUser();
  const r = await runAction(async () => {
    const { debt } = await recordDebtPayment(ctx, debtId, {
      amount: str(fd, "amount") ?? "",
      occurredAt: str(fd, "occurredAt") ?? "",
      accountId: str(fd, "accountId"),
      installmentId: str(fd, "installmentId"),
      note: str(fd, "note"),
    });
    return { ok: true, message: debt.status === "paid" ? "Pembayaran tercatat. Lunas! 🎉" : "Pembayaran tercatat." };
  });
  if (!r.error) revalidatePath("/", "layout");
  return r;
}

export async function updateDebtAction(debtId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx } = await requireUser();
  const r = await runAction(async () => {
    const due = str(fd, "dueDate");
    await updateDebtDetails(ctx, debtId, {
      counterparty: str(fd, "counterparty"),
      dueDate: due ? parseDateInput(due) : null,
      note: str(fd, "note") ?? null,
      reminderDaysBefore: Number(str(fd, "reminderDaysBefore") ?? 3),
    });
    return { ok: true, message: "Perubahan tersimpan." };
  });
  if (!r.error) revalidatePath("/", "layout");
  return r;
}

export async function deleteDebtAction(debtId: string) {
  const { ctx } = await requireUser();
  const r = await runAction(async () => {
    await deleteDebt(ctx, debtId);
  });
  revalidatePath("/", "layout");
  return r;
}
