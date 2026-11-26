import type { HouseholdRole } from "@prisma/client";

/** Konteks setiap pemanggilan layanan: siapa, di ruang keuangan mana, dari mana. */
export interface ServiceContext {
  householdId: string;
  userId: string | null;
  role: HouseholdRole;
  source: "web" | "telegram" | "system";
}

export function canWrite(ctx: ServiceContext) {
  return ctx.role !== "viewer";
}

export function isAdmin(ctx: ServiceContext) {
  return ctx.role === "owner" || ctx.role === "admin";
}
