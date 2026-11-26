import type { ReceiptData } from "@/lib/parsing/receipt-text";

export interface ReceiptImage {
  data: Buffer;
  mimeType: string;
}

export interface ReceiptExtractionOutput extends ReceiptData {
  /** Teks mentah hasil OCR (jika ada) untuk audit/koreksi. */
  rawText: string | null;
  /** Respons mentah penyedia (tanpa rahasia). */
  rawResponse?: unknown;
}

/**
 * Abstraksi pembaca struk. Implementasi bisa OCR lokal, layanan OCR, atau model AI.
 * Kembalikan field null bila tidak terbaca — jangan menebak.
 */
export interface ReceiptExtractionProvider {
  readonly name: string;
  extract(image: ReceiptImage): Promise<ReceiptExtractionOutput>;
}
