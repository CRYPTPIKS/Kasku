import { describe, expect, it } from "vitest";
import { detectReceiptDate, parseReceiptText } from "@/lib/parsing/receipt-text";

const ALFAMART = `ALFAMART
PT. SUMBER ALFARIA TRIJAYA, TBK
JL. RAYA BOGOR KM 30
NPWP : 01.336.238.9-054.000
Bon 1A2B3C        Kasir : DEWI
INDOMIE GRG       2   3,100     6,200
AQUA 600ML        1   3,500     3,500
TEH PUCUK 350     3   3,800    11,400
Total Item        6            21,100
HEMAT                          -1,100
Total Belanja                  20,000
TUNAI                          50,000
Kembalian                      30,000
PPN                             1,982
Tgl. 26-11-2026 13:45:10 V.2026`;

const RESTO = `Warung Makan Sederhana
Jl. Melati No. 5, Bandung
Telp 022-123456
26 Nov 2026  19:20
Nasi Goreng Spesial    2 x 35.000    70.000
Es Teh Manis           2 x 8.000     16.000
Subtotal                            86.000
Service Charge 5%                    4.300
PB1 10%                              9.030
Grand Total                         99.330
QRIS                                99.330`;

const INDOMARET = `INDOMARET
CIBUBUR 2
HARGA JUAL :        45.500
DISKON :            -2.500
TOTAL :             43.000
DEBIT BCA :         43.000
PPN : 4.261
2026-11-20 08:15`;

describe("parseReceiptText", () => {
  it("struk minimarket (koma ribuan)", () => {
    const r = parseReceiptText(ALFAMART);
    expect(r.merchant).toBe("Alfamart");
    expect(r.total).toBe(20_000);
    expect(r.discount).toBe(1_100);
    expect(r.tax).toBe(1_982);
    expect(r.paymentMethod).toBe("Tunai");
    expect(r.occurredAt?.toISOString()).toBe("2026-11-26T06:45:00.000Z");
    expect(r.items).toEqual([
      { name: "INDOMIE GRG", qty: 2, unitPrice: 3_100, total: 6_200 },
      { name: "AQUA 600ML", qty: 1, unitPrice: 3_500, total: 3_500 },
      { name: "TEH PUCUK 350", qty: 3, unitPrice: 3_800, total: 11_400 },
    ]);
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("struk restoran dengan service & PB1", () => {
    const r = parseReceiptText(RESTO);
    expect(r.merchant).toBe("Warung Makan Sederhana");
    expect(r.total).toBe(99_330);
    expect(r.subtotal).toBe(86_000);
    expect(r.serviceCharge).toBe(4_300);
    expect(r.tax).toBe(9_030);
    expect(r.paymentMethod).toBe("QRIS");
    expect(r.occurredAt?.toISOString()).toBe("2026-11-26T12:20:00.000Z");
    expect(r.items.map((i) => i.name)).toEqual(["Nasi Goreng Spesial", "Es Teh Manis"]);
  });

  it("struk dengan label bertitik dua", () => {
    const r = parseReceiptText(INDOMARET);
    expect(r.merchant).toBe("Indomaret");
    expect(r.total).toBe(43_000);
    expect(r.subtotal).toBe(45_500);
    expect(r.discount).toBe(2_500);
    expect(r.paymentMethod).toBe("Kartu debit");
    expect(r.occurredAt?.toISOString()).toBe("2026-11-20T01:15:00.000Z");
  });

  it("tanpa label total: pakai nominal terbesar dengan keyakinan rendah", () => {
    const r = parseReceiptText("TOKO MAJU\nSabun 12.000\nSikat gigi 15.500\nTunai 50.000");
    expect(r.total).toBe(15_500);
    expect(r.confidence).toBeLessThan(0.5);
  });

  it("teks kosong", () => {
    const r = parseReceiptText("");
    expect(r).toMatchObject({ total: null, merchant: null, confidence: 0, items: [] });
  });
});

describe("detectReceiptDate", () => {
  it.each([
    ["26/11/2026", "2026-11-26T05:00:00.000Z"],
    ["26-11-26 07:05", "2026-11-26T00:05:00.000Z"],
    ["5 Desember 2026", "2026-12-05T05:00:00.000Z"],
  ])("%s", (input, iso) => {
    expect(detectReceiptDate(input)?.toISOString()).toBe(iso);
  });
  it("tanggal tidak valid -> null", () => {
    expect(detectReceiptDate("99/99/2026")).toBeNull();
  });
});
