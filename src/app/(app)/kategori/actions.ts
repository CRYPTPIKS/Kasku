"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/current";
import { formValues, runAction, type ActionState } from "@/server/action-result";
import { createCategory, deleteCategory, setCategoryArchived, updateCategory } from "@/server/services/categories";
import type { CategoryInput } from "@/server/validation/category";

function parseForm(fd: FormData): CategoryInput {
  const s = (k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string) : undefined);
  return {
    name: s("name") ?? "",
    kind: (s("kind") ?? "") as CategoryInput["kind"],
    parentId: s("parentId"),
    icon: s("icon"),
    color: s("color"),
    keywords: s("keywords"),
  };
}

export async function saveCategoryAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx } = await requireUser();
  const id = fd.get("id");
  const r = await runAction(async () => {
    const input = parseForm(fd);
    if (typeof id === "string" && id) await updateCategory(ctx, id, input);
    else await createCategory(ctx, input);
  }, formValues(fd));
  if (r.error) return r;
  revalidatePath("/", "layout");
  redirect("/kategori?saved=1");
}

export async function archiveCategoryAction(id: string, archived: boolean) {
  const { ctx } = await requireUser();
  const r = await runAction(async () => {
    await setCategoryArchived(ctx, id, archived);
  });
  revalidatePath("/", "layout");
  return r;
}

export async function deleteCategoryAction(id: string) {
  const { ctx } = await requireUser();
  const r = await runAction(async () => {
    await deleteCategory(ctx, id);
  });
  revalidatePath("/", "layout");
  return r;
}
