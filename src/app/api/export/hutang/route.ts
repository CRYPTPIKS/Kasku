import { csvNumber, toCsv } from "@/lib/csv";
import { toDateInput } from "@/lib/dates";
import { getApiContext } from "@/server/auth/current";
import { csvResponse, jsonError, unauthorized } from "@/server/http";
import { DEBT_DIRECTION_LABELS, DEBT_STATUS_LABELS, listDebts, nextInstallment } from "@/server/services/debts";

/** GET /api/export/hutang — daftar hutang & piutang (CSV). */
export async function GET() {
  const ctx = await getApiContext();
  if (!ctx) return unauthorized();
  try {
    const debts = await listDebts(ctx, { includePaid: true });
    const rows = debts.map((d) => {
      const next = nextInstallment(d);
      const obligation = d.installments.length ? d.installments.reduce((a, i) => a + Number(i.amount), 0) : Number(d.principalAmount);
      return [
        DEBT_DIRECTION_LABELS[d.direction],
        d.counterparty,
        toDateInput(d.startDate),
        csvNumber(d.principalAmount),
        csvNumber(obligation),
        csvNumber(d.remainingAmount),
        DEBT_STATUS_LABELS[d.status],
        d.installments.length,
        next ? toDateInput(next.dueDate) : d.dueDate ? toDateInput(d.dueDate) : "",
        d.note ?? "",
      ];
    });
    return csvResponse(
      toCsv(["Jenis", "Pihak", "Tanggal", "Pokok", "Total kewajiban", "Sisa", "Status", "Jumlah cicilan", "Jatuh tempo berikutnya", "Catatan"], rows),
      `hutang-piutang-${toDateInput(new Date())}.csv`,
    );
  } catch (err) {
    return jsonError(err);
  }
}
