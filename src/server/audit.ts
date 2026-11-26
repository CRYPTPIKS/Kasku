import type { AuditAction, Prisma } from "@prisma/client";
import type { ServiceContext } from "./context";
import type { Tx } from "./db";

/** Ubah objek Prisma (Decimal, Date, BigInt) menjadi JSON yang aman disimpan. */
export function toAuditJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => {
      // Decimal Prisma sudah punya toJSON(); BigInt perlu diubah manual.
      if (typeof v === "bigint") return v.toString();
      return v;
    }),
  );
}

export async function writeAudit(
  tx: Tx,
  ctx: ServiceContext,
  entry: { entityType: string; entityId: string; action: AuditAction; before?: unknown; after?: unknown },
) {
  await tx.auditLog.create({
    data: {
      householdId: ctx.householdId,
      actorUserId: ctx.userId,
      actorSource: ctx.source,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      before: entry.before === undefined ? undefined : toAuditJson(entry.before),
      after: entry.after === undefined ? undefined : toAuditJson(entry.after),
    },
  });
}
