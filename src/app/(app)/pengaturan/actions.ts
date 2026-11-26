"use server";

import { cookies } from "next/headers";
import { requireUser } from "@/server/auth/current";
import { changePassword } from "@/server/auth/change-password";
import { SESSION_COOKIE } from "@/server/auth/session";
import { runAction, type ActionState } from "@/server/action-result";

export async function changePasswordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { user } = await requireUser();
  return runAction(async () => {
    const current = String(fd.get("current") ?? "");
    const next = String(fd.get("next") ?? "");
    if (next !== String(fd.get("confirm") ?? "")) return { error: "Konfirmasi kata sandi tidak sama." };
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    await changePassword(user.id, current, next, token);
    return { ok: true, message: "Kata sandi diperbarui. Sesi di perangkat lain sudah dikeluarkan." };
  });
}
