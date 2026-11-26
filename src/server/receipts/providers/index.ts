import { HttpReceiptProvider } from "./http";
import { MockReceiptProvider } from "./mock";
import { TesseractReceiptProvider } from "./tesseract";
import type { ReceiptExtractionProvider } from "./types";

export type { ReceiptExtractionProvider, ReceiptExtractionOutput, ReceiptImage } from "./types";

let instance: ReceiptExtractionProvider | null = null;

/** Pilih penyedia dari RECEIPT_PROVIDER: tesseract (default) | mock | http. */
export function getReceiptProvider(): ReceiptExtractionProvider {
  if (instance) return instance;
  const name = process.env.RECEIPT_PROVIDER ?? (process.env.NODE_ENV === "test" ? "mock" : "tesseract");
  switch (name) {
    case "mock":
      instance = new MockReceiptProvider();
      break;
    case "http":
      instance = new HttpReceiptProvider();
      break;
    case "tesseract":
      instance = new TesseractReceiptProvider();
      break;
    default:
      throw new Error(`RECEIPT_PROVIDER tidak dikenal: ${name}`);
  }
  return instance;
}

/** Hanya untuk test. */
export function setReceiptProvider(p: ReceiptExtractionProvider | null) {
  instance = p;
}
