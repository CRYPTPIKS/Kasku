import { copyFile, mkdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { parseReceiptText } from "@/lib/parsing/receipt-text";
import { logger } from "../../logger";
import type { ReceiptExtractionProvider, ReceiptImage } from "./types";

type TesseractWorker = import("tesseract.js").Worker;

const INIT_TIMEOUT_MS = Number(process.env.TESSERACT_INIT_TIMEOUT_MS ?? 120_000);
const RECOGNIZE_TIMEOUT_MS = Number(process.env.TESSERACT_TIMEOUT_MS ?? 90_000);

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} melebihi ${Math.round(ms / 1000)} detik`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Data bahasa diambil dari paket npm @tesseract.js-data/* yang ikut terpasang,
 * sehingga OCR berjalan offline (tanpa unduhan CDN saat runtime). Semua bahasa
 * disalin ke satu folder karena tesseract.js hanya menerima satu langPath.
 * Mengembalikan null jika ada bahasa yang paketnya tidak terpasang (fallback CDN).
 */
async function bundledLangPath(langs: string[], cacheDir: string): Promise<string | null> {
  const req = createRequire(path.join(process.cwd(), "package.json"));
  const dir = path.join(cacheDir, "lang");
  try {
    await mkdir(dir, { recursive: true });
    for (const lang of langs) {
      const pkgDir = path.dirname(req.resolve(`@tesseract.js-data/${lang}/package.json`));
      const file = `${lang}.traineddata.gz`;
      const target = path.join(dir, file);
      if (!(await stat(target).catch(() => null))) await copyFile(path.join(pkgDir, "4.0.0_best_int", file), target);
    }
    return dir;
  } catch {
    return null;
  }
}

/**
 * OCR lokal gratis memakai Tesseract (tesseract.js, WebAssembly).
 * Bahasa default "ind+eng". Data bahasa: TESSERACT_LANG_PATH jika diisi,
 * lalu paket npm yang ikut terpasang, terakhir CDN jsDelivr.
 */
export class TesseractReceiptProvider implements ReceiptExtractionProvider {
  readonly name = "tesseract";
  private workerPromise: Promise<TesseractWorker> | null = null;

  private worker() {
    this.workerPromise ??= withTimeout(
      (async () => {
        const { createWorker } = await import("tesseract.js");
        const langs = (process.env.TESSERACT_LANGS ?? "ind+eng").split("+").filter(Boolean);
        const cachePath = process.env.TESSERACT_CACHE_DIR ?? "./storage/tesseract";
        const langPath = process.env.TESSERACT_LANG_PATH || (await bundledLangPath(langs, cachePath));
        return createWorker(langs, 1, {
          cachePath,
          ...(langPath ? { langPath } : {}),
          // Tanpa errorHandler, tesseract.js melempar error tak tertangkap dan mematikan proses.
          errorHandler: (err: unknown) => logger.warn("Tesseract error", { reason: String(err) }),
        });
      })(),
      INIT_TIMEOUT_MS,
      "Memuat Tesseract",
    ).catch((e) => {
      this.workerPromise = null;
      throw new Error(`Tesseract belum siap: ${e instanceof Error ? e.message : String(e)}`);
    });
    return this.workerPromise;
  }

  private async reset() {
    const w = this.workerPromise;
    this.workerPromise = null;
    await w?.then((x) => x.terminate()).catch(() => undefined);
  }

  async extract(image: ReceiptImage) {
    const worker = await this.worker();
    let data: Awaited<ReturnType<TesseractWorker["recognize"]>>["data"];
    try {
      ({ data } = await withTimeout(worker.recognize(image.data), RECOGNIZE_TIMEOUT_MS, "Membaca struk"));
    } catch (err) {
      // Worker bisa macet setelah error; mulai baru untuk struk berikutnya.
      await this.reset();
      throw err;
    }
    const text = data.text ?? "";
    const parsed = parseReceiptText(text);
    // Gabungkan keyakinan OCR dengan keyakinan parser.
    const ocrConfidence = typeof data.confidence === "number" ? data.confidence / 100 : 0.5;
    return { ...parsed, confidence: Math.round(parsed.confidence * ocrConfidence * 100) / 100, rawText: text };
  }
}
