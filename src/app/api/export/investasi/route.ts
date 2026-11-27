import { csvNumber, toCsv } from "@/lib/csv";
import { getApiContext } from "@/server/auth/current";
import { csvResponse, jsonError, unauthorized } from "@/server/http";
import { ASSET_CLASS_LABELS, getPortfolio } from "@/server/services/investments";
import { toDateInput } from "@/lib/dates";

/** GET /api/export/investasi — posisi portofolio per aset (CSV). */
export async function GET() {
  const ctx = await getApiContext();
  if (!ctx) return unauthorized();
  try {
    const p = await getPortfolio(ctx, { includeArchived: true });
    const rows = p.items.map((i) => [
      ASSET_CLASS_LABELS[i.assetClass],
      i.symbol ?? "",
      i.name,
      i.valuationMode === "value" ? "" : csvNumber(i.units),
      i.valuationMode === "value" ? "nilai total" : i.unitLabel,
      csvNumber(Math.round(i.avgCost * 100) / 100),
      csvNumber(i.costBasis),
      i.price === null ? "" : csvNumber(i.price),
      i.priceAsOf ? toDateInput(i.priceAsOf) : "",
      csvNumber(i.marketValue),
      csvNumber(i.unrealized),
      csvNumber(i.realized),
      csvNumber(i.income),
    ]);
    return csvResponse(
      toCsv(
        ["Jenis", "Kode", "Nama", "Unit", "Satuan", "Harga rata-rata", "Modal", "Harga terakhir", "Tanggal harga", "Nilai", "Untung/rugi belum terealisasi", "Terealisasi", "Dividen/bunga"],
        rows,
      ),
      `investasi-${toDateInput(new Date())}.csv`,
    );
  } catch (err) {
    return jsonError(err);
  }
}
