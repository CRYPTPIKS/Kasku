"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/current";
import { formValues, runAction, type ActionState } from "@/server/action-result";
import { createBusiness, deleteBusiness, setupBusinessTemplates } from "@/server/services/businesses";

export async function createBusinessAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx } = await requireUser();
  const r = await runAction(async () => {
    const b = await createBusiness(ctx, { name: String(fd.get("name") ?? ""), icon: String(fd.get("icon") ?? "") });
    return { ok: true, message: `Usaha "${b.name}" dibuat. Tandai rekening atau kategorinya lewat halaman Rekening/Kategori.` };
  }, formValues(fd));
  revalidatePath("/", "layout");
  return r;
}

export async function setupTemplatesAction() {
  const { ctx } = await requireUser();
  const r = await runAction(async () => {
    await setupBusinessTemplates(ctx);
  });
  revalidatePath("/", "layout");
  return r;
}

export async function deleteBusinessAction(id: string) {
  const { ctx } = await requireUser();
  const r = await runAction(async () => {
    await deleteBusiness(ctx, id);
  });
  revalidatePath("/", "layout");
  return r;
}
