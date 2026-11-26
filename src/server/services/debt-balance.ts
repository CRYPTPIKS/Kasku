/**
 * Hitung ulang sisa hutang/piutang dan status cicilan dari transaksi pembayaran.
 * Dipisah dari debts.ts agar bisa dipanggil oleh layanan transaksi tanpa
 * ketergantungan melingkar.
 */
import type { DebtStatus } from "@prisma/client";
import type { Tx } from "../db";

/** Jatuh tempo berlaku sampai akhir hari tersebut (WIB). */
const pastDue = (due: Date, now: Date) => due.getTime() + 86400000 <= now.getTime();

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * Total kewajiban = jumlah semua cicilan (jika ada, bisa termasuk bunga) atau pokok.
 * Pembayaran (debt_payment terkonfirmasi, tidak dihapus) dialokasikan ke cicilan
 * secara berurutan (FIFO).
 */
export async function recomputeDebt(tx: Tx, debtId: string, now = new Date()) {
  const debt = await tx.debt.findUnique({
    where: { id: debtId },
    include: { installments: { orderBy: { sequence: "asc" } } },
  });
  if (!debt) return null;
  const payments = await tx.transaction.findMany({
    where: { debtId, type: "debt_payment", status: "confirmed", deletedAt: null },
    orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
    select: { amount: true, occurredAt: true },
  });

  const obligation = debt.installments.length
    ? round2(debt.installments.reduce((a, i) => a + Number(i.amount), 0))
    : Number(debt.principalAmount);
  const paid = round2(payments.reduce((a, p) => a + Number(p.amount), 0));
  const remaining = Math.max(0, round2(obligation - paid));

  // Alokasi FIFO: catat kapan tiap cicilan lunas.
  let pool = 0;
  let pi = 0;
  for (const inst of debt.installments) {
    const due = Number(inst.amount);
    let paidAt: Date | null = null;
    while (pool < due - 0.005 && pi < payments.length) {
      pool = round2(pool + Number(payments[pi]!.amount));
      paidAt = payments[pi]!.occurredAt;
      pi++;
    }
    const applied = Math.min(due, pool);
    pool = round2(pool - applied);
    const isPaid = applied >= due - 0.005;
    if (Number(inst.paidAmount) !== applied || (isPaid ? !inst.paidAt : inst.paidAt)) {
      await tx.debtInstallment.update({
        where: { id: inst.id },
        data: { paidAmount: applied, paidAt: isPaid ? (inst.paidAt ?? paidAt ?? now) : null },
      });
    }
  }

  let status: DebtStatus = "active";
  if (remaining <= 0) status = "paid";
  else {
    const overdueInstallment = debt.installments.some((i, idx) => {
      // Cicilan ke-idx dianggap lunas jika total bayar menutup cicilan s.d. idx.
      const cumulative = debt.installments.slice(0, idx + 1).reduce((a, x) => a + Number(x.amount), 0);
      return pastDue(i.dueDate, now) && paid < cumulative - 0.005;
    });
    if (overdueInstallment || (debt.dueDate && pastDue(debt.dueDate, now))) status = "overdue";
  }

  return tx.debt.update({ where: { id: debtId }, data: { remainingAmount: remaining, status } });
}
