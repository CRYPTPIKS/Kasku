# Penyedia pembaca struk

Kasku membaca foto struk lewat interface `ReceiptExtractionProvider`
(`src/server/receipts/providers/types.ts`). Pilih penyedia dengan
`RECEIPT_PROVIDER`. Ganti penyedia tidak mengubah alur lainnya: hasil selalu
menjadi **draf** yang harus dikonfirmasi pengguna.

| `RECEIPT_PROVIDER` | Biaya | Keterangan |
|---|---|---|
| `tesseract` (default) | Gratis, lokal | OCR Tesseract (`ind+eng`) lewat tesseract.js. Tidak ada data yang keluar dari server. |
| `http` | Tergantung layanan | Kirim foto ke layanan OCR/AI milikmu sendiri. |
| `mock` | Gratis | Untuk development & test. Teks dari `MOCK_RECEIPT_TEXT`; teks berisi `GAGAL` mensimulasikan gagal baca. |

## Tesseract (default)

- Data bahasa Indonesia & Inggris ikut terpasang dari paket npm
  `@tesseract.js-data/ind` dan `@tesseract.js-data/eng`, jadi berjalan
  **offline**. Saat pertama kali jalan, data disalin ke `TESSERACT_CACHE_DIR`
  (di Docker: volume `tesseract_data`).
- Bahasa lain: isi `TESSERACT_LANGS` (mis. `ind+eng+chi_sim`) dan pasang paket
  `@tesseract.js-data/<kode>`, atau arahkan `TESSERACT_LANG_PATH` ke folder
  berisi `<kode>.traineddata.gz`. Jika paket tidak ada, tesseract.js mengunduh
  dari CDN jsDelivr.
- Batas waktu: `TESSERACT_INIT_TIMEOUT_MS` (default 120 detik) dan
  `TESSERACT_TIMEOUT_MS` per struk (default 90 detik).
- Tips akurasi: foto tegak lurus, terang, struk memenuhi bingkai, tidak
  kusut. Struk thermal yang pudar sering gagal; isi totalnya manual.

## HTTP (OCR/AI pilihanmu)

Isi:

```env
RECEIPT_PROVIDER=http
RECEIPT_HTTP_URL=http://ocr-saya:8080/extract
RECEIPT_HTTP_TOKEN=rahasia-acak          # opsional, dikirim sebagai Bearer
RECEIPT_HTTP_TIMEOUT_MS=60000            # opsional
```

Kasku mengirim:

```http
POST /extract
Content-Type: application/json
Authorization: Bearer rahasia-acak

{ "image_base64": "<foto>", "mime_type": "image/jpeg" }
```

Layanan membalas **salah satu** bentuk berikut.

1. Teks mentah saja (Kasku yang mengurai):

   ```json
   { "text": "INDOMARET\nTOTAL 43.000\nDEBIT BCA 43.000" }
   ```

2. Field terstruktur (semua opsional kecuali yang kamu punya):

   ```json
   {
     "merchant": "Indomaret",
     "date": "2026-11-20T14:35:00+07:00",
     "total": 43000,
     "subtotal": 45000,
     "tax": 4261,
     "discount": 2000,
     "service_charge": 0,
     "payment_method": "Debit BCA",
     "items": [{ "name": "Indomie Goreng", "qty": 3, "unit_price": 3100, "total": 9300 }],
     "confidence": 0.9,
     "text": "teks OCR mentah (opsional)"
   }
   ```

Status HTTP selain 2xx dianggap gagal baca: foto tetap tersimpan, pengguna
diminta mengisi total manual atau menekan **Baca ulang**.

Contoh layanan yang bisa dibungkus dengan endpoint kecil seperti ini:
PaddleOCR atau docTR (gratis, self-hosted, lebih akurat untuk foto miring),
model vision lokal lewat Ollama, atau API AI berbayar. **Kasku tidak
mewajibkan API berbayar.** Jika memakai layanan pihak ketiga, ingat bahwa
foto struk (berisi nama toko, waktu, kadang nomor kartu terpotong) akan
dikirim ke sana.

## Menulis penyedia sendiri di kode

```ts
import type { ReceiptExtractionProvider } from "./types";

export class MyProvider implements ReceiptExtractionProvider {
  readonly name = "punyaku";
  async extract(image: { data: Buffer; mimeType: string }) {
    const text = await bacaFoto(image.data);
    return { ...parseReceiptText(text), rawText: text };
  }
}
```

Daftarkan di `getReceiptProvider()` (`providers/index.ts`). Lempar `Error`
jika gagal; Kasku akan menandai struk `failed` dan meminta isi manual.
