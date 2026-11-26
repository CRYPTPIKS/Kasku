import { parseReceiptText } from "@/lib/parsing/receipt-text";
import type { ReceiptExtractionProvider } from "./types";

/**
 * Penyedia palsu untuk development & test. Mengembalikan struk contoh,
 * atau teks dari env MOCK_RECEIPT_TEXT. Jika teks berisi "GAGAL", melempar error.
 */
export const DEFAULT_MOCK_TEXT = `INDOMARET
TOTAL :             43.000
DEBIT BCA :         43.000
PPN : 4.261`;

export class MockReceiptProvider implements ReceiptExtractionProvider {
  readonly name = "mock";
  constructor(private text: string = process.env.MOCK_RECEIPT_TEXT ?? DEFAULT_MOCK_TEXT) {}
  async extract() {
    if (this.text.includes("GAGAL")) throw new Error("Mock: struk tidak terbaca");
    return { ...parseReceiptText(this.text), rawText: this.text };
  }
}
