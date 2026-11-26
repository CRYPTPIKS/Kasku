"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/current";
import { formValues, runAction, type ActionState } from "@/server/action-result";
import { createAccount, setAccountArchived, updateAccount } from "@/server/services/accounts";
import type { AccountInput } from "@/server/validation/account";

function parseForm(fd: FormData): AccountInput {
  const s = (k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string) : undefined);
  return {
    name: s("name") ?? "",
    kind: (s("kind") ?? "") as AccountInput["kind"],
    institution: s("institution"),
    accountNumberLast4: s("accountNumberLast4"),
    initialBalance: s("initialBalance") ?? "0",
    creditLimit: s("creditLimit") || null,
    aliases: s("aliases"),
    color: s("color"),
  };
}

export async function saveAccountAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { ctx } = await requireUser();
  const id = fd.get("id");
  let savedId = "";
  const r = await runAction(async () => {
    const input = parseForm(fd);
    const a = typeof id === "string" && id ? await updateAccount(ctx, id, input) : await createAccount(ctx, input);
    savedId = a.id;
  }, formValues(fd));
  if (r.error) return r;
  revalidatePath("/", "layout");
  redirect(`/rekening/${savedId}?saved=1`);
}

export async function archiveAccountAction(id: string, archived: boolean) {
  const { ctx } = await requireUser();
  const r = await runAction(async () => {
    await setAccountArchived(ctx, id, archived);
  });
  revalidatePath("/", "layout");
  return r;
}
