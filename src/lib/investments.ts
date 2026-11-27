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

export interface ValueSnapshot {
  asOf: Date;
  /** Nilai total aset pada tanggal ini (mis. "Total nilai" di aplikasi robo-advisor). */
  value: number;
}

export interface ValueHolding extends Holding {
  /** Perkiraan nilai saat ini: nilai terakhir dicatat + setoran − penarikan sesudahnya. */
  marketValue: number;
  lastValueAt: Date | null;
}

/**
 * Mode "nilai portofolio" (robo-advisor, dsb.): pengguna hanya mencatat nominal setor
 * (buy) dan tarik (sell), lalu sesekali nilai total. Modal berkurang sebanding porsi
 * nilai yang ditarik, sehingga untung/rugi terealisasi dihitung seperti metode
 * biaya rata-rata. Pada waktu yang sama, transaksi dihitung sebelum pencatatan nilai.
 */
export function computeValueHolding(trades: InvestmentTrade[], snapshots: ValueSnapshot[]): ValueHolding {
  type Ev = { at: number; order: number; trade?: InvestmentTrade; snap?: ValueSnapshot };
  const events: Ev[] = [
    ...trades.map((t) => ({ at: t.occurredAt.getTime(), order: 0, trade: t })),
    ...snapshots.map((s) => ({ at: s.asOf.getTime(), order: 1, snap: s })),
  ].sort((a, b) => a.at - b.at || a.order - b.order);
  let value = 0;
  let cost = 0;
  let realized = 0;
  let income = 0;
  let fees = 0;
  let lastValueAt: Date | null = null;
  for (const e of events) {
    if (e.snap) {
      value = e.snap.value;
      lastValueAt = e.snap.asOf;
      continue;
    }
    const t = e.trade!;
    switch (t.kind) {
      case "buy":
        value += t.totalAmount;
        cost += t.totalAmount;
        fees += t.fee;
        break;
      case "sell": {
        if (t.totalAmount > value + 0.005) throw new Error("Penarikan melebihi nilai aset.");
        const removed = value > EPS ? cost * (t.totalAmount / value) : 0;
        cost -= removed;
        realized += t.totalAmount - removed;
        value -= t.totalAmount;
        fees += t.fee;
        if (value < 0.005) {
          value = 0;
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
  }
  return {
    units: r2(value),
    costBasis: r2(cost),
    avgCost: value > EPS ? cost / value : 0,
    realized: r2(realized),
    income: r2(income),
    fees: r2(fees),
    lastTradePrice: null,
    lastTradeAt: null,
    marketValue: r2(value),
    lastValueAt,
  };
}
