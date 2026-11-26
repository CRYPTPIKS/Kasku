import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpReceiptProvider } from "@/server/receipts/providers/http";

const image = { data: Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]), mimeType: "image/jpeg" };

afterEach(() => vi.unstubAllGlobals());

function stubFetch(body: unknown, status = 200) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature fetch untuk tipe mock.calls
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("HttpReceiptProvider", () => {
  it("wajib punya URL", () => {
    expect(() => new HttpReceiptProvider("", "")).toThrow(/RECEIPT_HTTP_URL/);
  });

  it("mengirim gambar base64 + token, dan mengurai balasan teks", async () => {
    const fetchMock = stubFetch({ text: "ALFAMART\nTOTAL 25.500\nTUNAI 30.000\nKEMBALI 4.500" });
    const out = await new HttpReceiptProvider("http://ocr.local/extract", "rahasia").extract(image);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://ocr.local/extract");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer rahasia");
    expect(JSON.parse(String(init.body))).toEqual({ image_base64: image.data.toString("base64"), mime_type: "image/jpeg" });
    expect(out.total).toBe(25_500);
  });

  it("menerima field terstruktur", async () => {
    stubFetch({ merchant: "Kopi Kenangan", date: "2026-11-20T10:15:00+07:00", total: "38000", items: [{ name: "Kopi", qty: 2, total: 38000 }] });
    const out = await new HttpReceiptProvider("http://ocr.local", "").extract(image);
    expect(out.merchant).toBe("Kopi Kenangan");
    expect(out.total).toBe(38_000);
    expect(out.occurredAt?.toISOString()).toBe("2026-11-20T03:15:00.000Z");
    expect(out.items).toEqual([{ name: "Kopi", qty: 2, unitPrice: null, total: 38_000 }]);
  });

  it("melempar error jika layanan gagal", async () => {
    stubFetch({ error: "x" }, 502);
    await expect(new HttpReceiptProvider("http://ocr.local", "").extract(image)).rejects.toThrow(/HTTP 502/);
  });
});
