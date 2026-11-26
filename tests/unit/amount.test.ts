import { describe, expect, it } from "vitest";
import { findAmounts, normalizeNumber, parseAmount } from "@/lib/parsing/amount";

describe("parseAmount", () => {
  it.each([
    ["75rb", 75_000],
    ["75 rb", 75_000],
    ["75ribu", 75_000],
    ["75 ribu", 75_000],
    ["75k", 75_000],
    ["75K", 75_000],
    ["1,5jt", 1_500_000],
    ["1.5jt", 1_500_000],
    ["1,25 juta", 1_250_000],
    ["2 juta", 2_000_000],
    ["12jt", 12_000_000],
    ["7jt", 7_000_000],
    ["1M", 1_000_000_000],
    ["2,5 miliar", 2_500_000_000],
    ["Rp 25.000", 25_000],
    ["Rp25.000", 25_000],
    ["rp. 25.000,-", 25_000],
    ["RP 1.250.000", 1_250_000],
    ["25.000,50", 25_000.5],
    ["1.234.567,89", 1_234_567.89],
    ["1,234,567.89", 1_234_567.89],
    ["25,000", 25_000],
    ["425000", 425_000],
    ["9850", 9_850],
    ["25,5", 25.5],
    ["1jt 500rb", 1_500_000],
    ["2jt dan 250rb", 2_250_000],
    ["Rp2.000.000", 2_000_000],
  ])("%s -> %d", (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it.each(["", "abc", "makan siang", "1.50.000", "75rb makan", "12,34,5"])("tolak %j", (input) => {
    expect(parseAmount(input)).toBeNull();
  });
});

describe("normalizeNumber", () => {
  it("pemisah tunggal 3 digit tanpa satuan = ribuan", () => {
    expect(normalizeNumber("25.000", false)).toBe(25_000);
  });
  it("pemisah tunggal 3 digit dengan satuan = desimal", () => {
    expect(normalizeNumber("1.250", true)).toBe(1.25);
  });
  it("grup ribuan tidak valid ditolak", () => {
    expect(normalizeNumber("1.2345.000", false)).toBeNull();
  });
});

describe("findAmounts", () => {
  it("menemukan nominal di tengah kalimat", () => {
    const [m] = findAmounts("keluar 75rb makan siang pakai cash");
    expect(m?.value).toBe(75_000);
    expect(m?.hasUnit).toBe(true);
  });

  it("tidak mengambil angka yang menempel ke huruf", () => {
    expect(findAmounts("beli BBCA2 di toko")).toEqual([]);
  });

  it("menemukan beberapa nominal", () => {
    const values = findAmounts("piutang 2jt ke Deni, cicilan 500rb tiap tanggal 5").map((m) => m.value);
    expect(values).toEqual([2_000_000, 500_000, 5]);
  });

  it("satuan 'gram' bukan satuan uang", () => {
    const values = findAmounts("jual emas 5 gram senilai 7jt").map((m) => m.value);
    expect(values).toEqual([5, 7_000_000]);
  });

  it("menandai Rp", () => {
    expect(findAmounts("bayar Rp 25.000")[0]?.hasCurrency).toBe(true);
  });
});
