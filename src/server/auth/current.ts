import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { ServiceContext } from "../context";
import { SESSION_COOKIE, validateSessionToken } from "./session";

/** Ambil sesi aktif (di-cache per request). */
export const getCurrentSession = cache(async () => {
  const store = await cookies();
  return validateSessionToken(store.get(SESSION_COOKIE)?.value);
});

/** Wajib login; arahkan ke /login bila belum. */
export async function requireUser() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  const membership = session.user.memberships[0];
  if (!membership) redirect("/login?error=no_household");
  const ctx: ServiceContext = {
    householdId: membership.householdId,
    userId: session.user.id,
    role: membership.role,
    source: "web",
  };
  return { user: session.user, ctx };
}

/** Untuk route handler API: kembalikan null alih-alih redirect. */
export async function getApiContext(): Promise<ServiceContext | null> {
  const session = await getCurrentSession();
  const membership = session?.user.memberships[0];
  if (!session || !membership) return null;
  return { householdId: membership.householdId, userId: session.user.id, role: membership.role, source: "web" };
}
