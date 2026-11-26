import { describe, expect, it } from "vitest";
import { parseTransactionText, type ParserContext } from "@/lib/parsing/transaction-text";

const ctx: ParserContext = {
  now: new Date("2026-11-26T10:00:00Z"),
  accounts: [
    { id: "cash", name: "Tunai", aliases: ["cash", "tunai", "dompet"] },
    { id: "bca", name: "BCA", aliases: ["bca"] },
    { id: "mandiri", name: "Mandiri", aliases: ["mandiri"] },
    { id: "gopay", name: "GoPay", aliases: ["gopay"] },
    { id: "cc", name: "Kartu Kredit", aliases: ["cc", "kartu kredit"] },
  ],
  categories: [
    { id: "food", name: "Makan & Minum", kind: "expense", keywords: ["makan", "makan siang", "kopi"] },
    { id: "bills", name: "Tagihan & Utilitas", kind: "expense", keywords: ["listrik", "pln", "internet"] },
    { id: "transport", name: "Transportasi", kind: "expense", keywords: ["bensin", "gojek", "parkir"] },
    { id: "salary", name: "Gaji", kind: "income", keywords: ["gaji"] },
    { id: "other-in", name: "Pemasukan Lainnya", kind: "income", keywords: [] },
  ],
};

const parse = (s: string, c: ParserContext = ctx) => parseTransactionText(s, c);

describe("contoh dari spesifikasi", () => {
  it("keluar 75rb makan siang pakai cash", () => {
    const r = parse("keluar 75rb makan siang pakai cash");
    expect(r).toMatchObject({ intent: "expense", amount: 75_000, fromAccountId: "cash", toAccountId: null, categoryId: "food", missing: [] });
    expect(r.description).toBe("Makan siang");
  });

  it("bayar listrik 425000 dari BCA", () => {
    const r = parse("bayar listrik 425000 dari BCA");
    expect(r).toMatchObject({ intent: "expense", amount: 425_000, fromAccountId: "bca", categoryId: "bills", missing: [] });
    expect(r.description).toBe("Listrik");
  });

  it("masuk 12jt gaji bulan November -> tanya rekening", () => {
    const r = parse("masuk 12jt gaji bulan November");
    expect(r).toMatchObject({ intent: "income", amount: 12_000_000, toAccountId: null, categoryId: "salary" });
    expect(r.missing).toEqual(["toAccount"]);
    expect(r.question).toBe("Masuk ke rekening mana?");
    expect(r.description).toBe("Gaji bulan November");
  });

  it("transfer 500rb dari BCA ke GoPay", () => {
    const r = parse("transfer 500rb dari BCA ke GoPay");
    expect(r).toMatchObject({ intent: "transfer", amount: 500_000, fromAccountId: "bca", toAccountId: "gopay", categoryId: null, missing: [] });
  });

  it("piutang 2jt ke Deni, cicilan 500rb tiap tanggal 5", () => {
    const r = parse("piutang 2jt ke Deni, cicilan 500rb tiap tanggal 5");
    expect(r).toMatchObject({
      intent: "debt_receivable",
      amount: 2_000_000,
      counterparty: "Deni",
      installment: { amount: 500_000, dayOfMonth: 5 },
      missing: [],
    });
  });

  it("bayar hutang 1jt ke Rina dari Mandiri", () => {
    const r = parse("bayar hutang 1jt ke Rina dari Mandiri");
    expect(r).toMatchObject({ intent: "debt_payment", debtDirection: "payable", amount: 1_000_000, counterparty: "Rina", fromAccountId: "mandiri", missing: [] });
  });

  it("beli 2 lot BBCA di harga 9850", () => {
    const r = parse("beli 2 lot BBCA di harga 9850");
    expect(r.intent).toBe("investment_buy");
    expect(r.investment).toEqual({ assetName: "BBCA", units: 2, unitLabel: "lot", pricePerUnit: 9850 });
    // 2 lot x 100 lembar x 9.850
    expect(r.amount).toBe(1_970_000);
    expect(r.missing).toEqual(["fromAccount"]);
  });

  it("jual emas 5 gram senilai 7jt", () => {
    const r = parse("jual emas 5 gram senilai 7jt");
    expect(r.intent).toBe("investment_sell");
    expect(r.amount).toBe(7_000_000);
    expect(r.investment).toMatchObject({ units: 5, unitLabel: "gram" });
    expect(r.investment?.assetName.toLowerCase()).toContain("emas");
  });
});

describe("variasi", () => {
  it("tanpa kata kerja dianggap pengeluaran", () => {
    expect(parse("kopi 25rb gopay")).toMatchObject({ intent: "expense", amount: 25_000, fromAccountId: "gopay", categoryId: "food" });
  });

  it("tidak ada nominal -> tanya nominal", () => {
    const r = parse("bayar listrik dari BCA");
    expect(r.amount).toBeNull();
    expect(r.question).toBe("Berapa nominalnya?");
  });

  it("transfer tanpa tujuan -> tanya tujuan", () => {
    const r = parse("tf 1,5jt dari bca");
    expect(r).toMatchObject({ intent: "transfer", amount: 1_500_000, fromAccountId: "bca", toAccountId: null });
    expect(r.question).toBe("Transfer ke rekening mana?");
  });

  it("topup gopay dari bca", () => {
    expect(parse("topup gopay 200rb dari bca")).toMatchObject({ intent: "transfer", fromAccountId: "bca", toAccountId: "gopay", amount: 200_000 });
  });

  it("kategori tidak dikenali -> tanya kategori", () => {
    const r = parse("keluar 50rb sumbangan masjid pakai cash");
    expect(r.categoryId).toBeNull();
    expect(r.question).toBe("Masuk kategori apa?");
  });

  it("alias multi-kata: kartu kredit", () => {
    expect(parse("bayar bensin 150rb pakai kartu kredit")).toMatchObject({ fromAccountId: "cc", categoryId: "transport" });
  });

  it("kemarin menggeser tanggal satu hari", () => {
    const r = parse("kemarin makan 30rb cash");
    expect(r.occurredAt.toISOString()).toBe("2026-11-25T10:00:00.000Z");
    expect(r.description.toLowerCase()).toBe("makan");
  });

  it("aturan kebiasaan merchant diutamakan", () => {
    const r = parse("keluar 120rb indomaret cash", {
      ...ctx,
      categories: [...ctx.categories, { id: "groceries", name: "Belanja Harian", kind: "expense", keywords: [] }],
      merchantRules: [{ merchantKey: "indomaret", categoryId: "groceries" }],
    });
    expect(r.categoryId).toBe("groceries");
  });

  it("Rp dengan titik ribuan", () => {
    expect(parse("bayar internet Rp 350.000 dari BCA").amount).toBe(350_000);
  });

  it("teks tanpa nominal & niat -> intent null", () => {
    const r = parse("halo bot");
    expect(r.intent).toBeNull();
    expect(r.amount).toBeNull();
  });

  it("terima cicilan piutang dari Deni ke BCA", () => {
    expect(parse("terima cicilan 500rb dari Deni ke BCA")).toMatchObject({
      intent: "debt_payment",
      debtDirection: "receivable",
      amount: 500_000,
      toAccountId: "bca",
      counterparty: "Deni",
    });
  });

  it("nama aset investasi tidak ikut nominal/kata depan", () => {
    expect(parse("beli emas 2 gram 3jt dari BCA").investment).toMatchObject({ assetName: "emas", units: 2, unitLabel: "gram" });
    expect(parse("jual emas 5 gram 8jt ke BCA").investment?.assetName).toBe("emas");
    expect(parse("beli BBCA 2 lot @9500 dari BCA")).toMatchObject({ amount: 1_900_000, investment: { assetName: "BBCA", units: 2, pricePerUnit: 9500 } });
  });

  it("harga dengan 'di' dan kripto berunit", () => {
    expect(parse("beli 2 lot BBCA di 9500")).toMatchObject({ amount: 1_900_000, investment: { assetName: "BBCA", pricePerUnit: 9500 } });
    expect(parse("beli 0,01 btc 15jt pakai BCA")).toMatchObject({ amount: 15_000_000, investment: { assetName: "btc", units: 0.01 } });
    expect(parse("keluar 25rb di 7 eleven").amount).toBe(25_000);
  });
});
