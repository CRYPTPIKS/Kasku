"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { login } from "@/server/auth/login";
import { SESSION_COOKIE, revokeSession } from "@/server/auth/session";
import { runAction, type ActionState } from "@/server/action-result";
import { cookieSecure } from "@/server/env";

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const result = await runAction(async () => {
    if (!email || !password) return { error: "Isi email dan kata sandi." };
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip");
    const { token, expiresAt } = await login({ email, password, ip, userAgent: h.get("user-agent") });
    (await cookies()).set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: cookieSecure(),
      path: "/",
      expires: expiresAt,
    });
  }, { email });
  if (result.error) return result;
  redirect("/");
}

export async function logoutAction() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await revokeSession(token);
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
