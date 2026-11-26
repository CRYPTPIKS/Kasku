/**
 * Perhitungan portofolio investasi (fungsi murni).
 * Metode biaya rata-rata: harga pokok per unit = total biaya beli (termasuk biaya)
 * dibagi unit yang dimiliki. Saat jual, harga pokok berkurang sebanding unit terjual.
 */
export type InvestmentKind = "buy" | "sell" | "dividend" | "interest" | "fee";

export interface InvestmentTrade {
  kind: InvestmentKind;
  occurredAt: Date;
  units: number;
  pricePerUnit: number;
  fee: number;
  totalAmount: number;
}

export interface Holding {
  units: number;
  /** Harga pokok unit yang masih dimiliki. */
  costBasis: number;
  avgCost: number;
  /** Untung/rugi yang sudah terealisasi dari penjualan. */
  realized: number;
  /** Dividen/bunga diterima. */
  income: number;
  fees: number;
  lastTradePrice: number | null;
  lastTradeAt: Date | null;
}

const EPS = 1e-9;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function computeHolding(trades: InvestmentTrade[]): Holding {
  const sorted = [...trades].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  let units = 0;
  let cost = 0;
  let realized = 0;
  let income = 0;
  let fees = 0;
  let lastTradePrice: number | null = null;
  let lastTradeAt: Date | null = null;
  for (const t of sorted) {
    switch (t.kind) {
      case "buy":
        units += t.units;
        cost += t.totalAmount; // sudah termasuk biaya
        fees += t.fee;
        break;
      case "sell": {
        if (t.units > units + EPS) throw new Error("Unit yang dijual melebihi unit yang dimiliki.");
        const avg = units > EPS ? cost / units : 0;
        const removed = avg * t.units;
        units -= t.units;
        cost -= removed;
        realized += t.totalAmount - removed; // totalAmount = hasil bersih setelah biaya
        fees += t.fee;
        if (units < EPS) {
          units = 0;
          cost = 0;
        }
        break;
      }
      case "dividend":
      case "interest":
        income += t.totalAmount;
        break;
      case "fee":
        fees += t.totalAmount;
        realized -= t.totalAmount;
        break;
    }
    if ((t.kind === "buy" || t.kind === "sell") && t.pricePerUnit > 0) {
      lastTradePrice = t.pricePerUnit;
      lastTradeAt = t.occurredAt;
    }
  }
  return {
    units: Math.round(units * 1e8) / 1e8,
    costBasis: r2(cost),
    avgCost: units > EPS ? cost / units : 0,
    realized: r2(realized),
    income: r2(income),
    fees: r2(fees),
    lastTradePrice,
    lastTradeAt,
  };
}

/** Nilai pasar & untung/rugi belum terealisasi berdasarkan harga terakhir. */
export function valuate(h: Holding, price: number | null) {
  const marketValue = price === null ? h.costBasis : r2(h.units * price);
  const unrealized = r2(marketValue - h.costBasis);
  return {
    marketValue,
    unrealized,
    unrealizedPct: h.costBasis > 0 ? unrealized / h.costBasis : 0,
  };
}

/** Total kas transaksi beli/jual dari unit, harga, dan biaya. */
export function tradeTotal(kind: "buy" | "sell", units: number, price: number, fee: number) {
  const gross = units * price;
  return r2(kind === "buy" ? gross + fee : gross - fee);
}
