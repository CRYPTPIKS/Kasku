import { z } from "zod";
import { parseReceiptText } from "@/lib/parsing/receipt-text";
import type { ReceiptExtractionProvider, ReceiptImage } from "./types";

/**
 * Penyedia HTTP generik untuk menghubungkan layanan OCR/AI apa pun.
 *
 * Kasku mengirim POST ke RECEIPT_HTTP_URL:
 *   Content-Type: application/json
 *   Authorization: Bearer <RECEIPT_HTTP_TOKEN>   (jika diisi)
 *   { "image_base64": "...", "mime_type": "image/jpeg" }
 *
 * Layanan membalas salah satu:
 *   { "text": "<teks OCR>" }                       -> diurai oleh parser struk Kasku
 *   { "merchant", "date", "total", "subtotal", "tax", "discount",
 *     "service_charge", "payment_method", "items": [{name, qty, unit_price, total}] }
 * Lihat docs/RECEIPT_PROVIDERS.md.
 */
const num = z.coerce.number().finite().nullable().optional();
const responseSchema = z.object({
  text: z.string().optional(),
  merchant: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
  total: num,
  subtotal: num,
  tax: num,
  discount: num,
  service_charge: num,
  payment_method: z.string().nullable().optional(),
  items: z
    .array(z.object({ name: z.string(), qty: num, unit_price: num, total: z.coerce.number() }))
    .optional(),
  confidence: num,
});

export class HttpReceiptProvider implements ReceiptExtractionProvider {
  readonly name = "http";
  constructor(
    private url = process.env.RECEIPT_HTTP_URL ?? "",
    private token = process.env.RECEIPT_HTTP_TOKEN ?? "",
    private timeoutMs = Number(process.env.RECEIPT_HTTP_TIMEOUT_MS ?? 60000),
  ) {
    if (!this.url) throw new Error("RECEIPT_HTTP_URL belum diisi untuk RECEIPT_PROVIDER=http");
  }

  async extract(image: ReceiptImage) {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
      body: JSON.stringify({ image_base64: image.data.toString("base64"), mime_type: image.mimeType }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`Penyedia OCR membalas HTTP ${res.status}`);
    const body = responseSchema.parse(await res.json());
    if (body.text !== undefined && body.total === undefined) {
      return { ...parseReceiptText(body.text), rawText: body.text, rawResponse: { mode: "text" } };
    }
    const date = body.date ? new Date(body.date) : null;
    return {
      merchant: body.merchant ?? null,
      occurredAt: date && !Number.isNaN(date.getTime()) ? date : null,
      total: body.total ?? null,
      subtotal: body.subtotal ?? null,
      tax: body.tax ?? null,
      discount: body.discount ?? null,
      serviceCharge: body.service_charge ?? null,
      paymentMethod: body.payment_method ?? null,
      items: (body.items ?? []).map((i) => ({ name: i.name, qty: i.qty ?? null, unitPrice: i.unit_price ?? null, total: i.total })),
      confidence: body.confidence ?? (body.total ? 0.8 : 0),
      rawText: body.text ?? null,
      rawResponse: body,
    };
  }
}
