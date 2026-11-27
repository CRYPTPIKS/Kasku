import { describe, expect, it } from "vitest";
import { relativePeriodRange } from "@/lib/dates";
import { detectQuestion } from "@/lib/parsing/question";

const ctx = {
  accounts: [
    { id: "cash", name: "Tunai", aliases: ["cash", "tunai"] },
    { id: "bca", name: "BCA", aliases: ["bca"] },
    { id: "dana", name: "DANA", aliases: ["dana"] },
  ],
  categories: [
    { id: "food", name: "Makan & Minum", kind: "expense" as const, keywords: ["makan", "kopi"] },
    { id: "groc", name: "Belanja Harian", kind: "expense" as const, keywords: ["belanja", "indomaret"] },
    { id: "transport", name: "Transportasi", kind: "expense" as const, keywords: ["bensin", "gojek"] },
    { id: "salary", name: "Gaji", kind: "income" as const, keywords: ["gaji"] },
  ],
};
const q = (s: string) => detectQuestion(s, ctx);

describe("detectQuestion", () => {
  it("saldo", () => {
    expect(q("Berapa saldo sekarang?")).toEqual({ kind: "balance", accountId: null });
    expect(q("saldo bca berapa")).toEqual({ kind: "balance", accountId: "bca" });
    expect(q("duit gua tinggal berapa?")).toMatchObject({ kind: "balance" });
  });

  it("pengeluaran per periode dan kategori", () => {
    expect(q("pengeluaran minggu ini")).toMatchObject({ kind: "spending", period: "week", categoryId: null });
    expect(q("berapa pengeluaran makan bulan ini?")).toMatchObject({ kind: "spending", period: "month", categoryId: "food" });
    expect(q("total jajan kemarin")).toMatchObject({ kind: "spending", period: "yesterday" });
    expect(q("habis berapa buat bensin bulan lalu?")).toMatchObject({ kind: "spending", period: "last_month", categoryId: "transport" });
  });

  it("pemasukan, ringkasan, transaksi", () => {
    expect(q("pemasukan bulan ini")).toMatchObject({ kind: "income", period: "month" });
    expect(q("ringkasan minggu lalu")).toMatchObject({ kind: "summary", period: "last_week" });
    expect(q("rekap hari ini")).toMatchObject({ kind: "summary", period: "today" });
    expect(q("transaksi terakhir")).toMatchObject({ kind: "recent" });
  });

  it("hutang, piutang, anggaran, investasi, bantuan", () => {
    expect(q("hutang ke Budi berapa?")).toMatchObject({ kind: "debts", direction: "payable", counterparty: "Budi" });
    expect(q("piutang")).toMatchObject({ kind: "debts", direction: "receivable", counterparty: null });
    expect(q("sisa anggaran belanja")).toMatchObject({ kind: "budget", categoryId: "groc" });
    expect(q("investasi gua gimana?")).toMatchObject({ kind: "investments" });
    expect(q("bantuan")).toMatchObject({ kind: "help" });
    expect(q("laba usaha bulan ini?")).toEqual({ kind: "business", period: "month" });
    expect(q("untung bulan lalu berapa")).toEqual({ kind: "business", period: "last_month" });
  });

  it("undo", () => {
    expect(q("hapus yang tadi")).toEqual({ kind: "undo" });
    expect(q("batalkan transaksi terakhir")).toEqual({ kind: "undo" });
    expect(q("undo")).toEqual({ kind: "undo" });
  });

  it("pesan transaksi tidak dianggap pertanyaan", () => {
    for (const s of ["keluar 75rb makan siang pakai cash", "makan 50rb", "bayar hutang 500rb ke Budi", "masuk 12jt gaji", "transfer 500rb dari BCA ke DANA", "setor 2jt ke BCA", "beli BBCA 2 lot @9500"]) {
      expect(q(s), s).toBeNull();
    }
  });
});

describe("relativePeriodRange (WIB)", () => {
  const now = new Date("2026-11-26T20:00:00Z"); // Jumat 27 Nov 03:00 WIB
  it("hari ini & kemarin", () => {
    expect(relativePeriodRange("today", now)).toEqual({ start: new Date("2026-11-26T17:00:00Z"), end: new Date("2026-11-27T17:00:00Z") });
    expect(relativePeriodRange("yesterday", now).start).toEqual(new Date("2026-11-25T17:00:00Z"));
  });
  it("minggu dimulai Senin", () => {
    expect(relativePeriodRange("week", now)).toEqual({ start: new Date("2026-11-22T17:00:00Z"), end: new Date("2026-11-29T17:00:00Z") });
    expect(relativePeriodRange("last_week", now).start).toEqual(new Date("2026-11-15T17:00:00Z"));
  });
  it("bulan lalu", () => {
    expect(relativePeriodRange("last_month", now)).toEqual({ start: new Date("2026-09-30T17:00:00Z"), end: new Date("2026-10-31T17:00:00Z") });
  });
});
