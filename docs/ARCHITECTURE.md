# Arsitektur Kasku

Dokumen singkat tentang cara aplikasi disusun dan alasannya.

## Gambaran besar

```
            ┌──────────── Docker Compose ─────────────┐
 Browser ──▶│ Caddy (HTTPS) ──▶ app (Next.js) ──▶ db   │
 Telegram ─▶│                     │       (PostgreSQL) │
 (Tahap 2)  │                     ├──▶ redis + worker  │  (Tahap 3)
            │                     └──▶ MinIO (struk)   │  (Tahap 3)
            │ backup (pg_dump harian) ──▶ ./backups    │
            └──────────────────────────────────────────┘
```

Satu aplikasi Next.js (App Router) melayani dashboard web, API, dan nanti
webhook Telegram. Pemrosesan struk yang lambat (OCR) akan berjalan di worker
terpisah lewat antrean BullMQ agar webhook tetap cepat.

## Lapisan kode

```
src/
  app/            UI & routing (server components, server actions, route handlers)
  components/     Komponen tampilan saja — tanpa logika bisnis
  lib/            Fungsi murni tanpa I/O: format Rupiah, tanggal WIB, parser nominal, CSV
  server/
    services/     Logika bisnis (rekening, kategori, transaksi, laporan)
    validation/   Skema zod untuk semua input backend
    auth/         Hash kata sandi, sesi, login, rate limit
    ledger.ts     Aturan double-entry (murni, mudah dites)
    audit.ts      Pencatatan audit log
    errors.ts     AppError → pesan ramah pengguna + status HTTP
prisma/           Skema, migrasi, seed
scripts/          CLI: buat pengguna, backup/restore, data contoh
```

Aturan sederhana: **UI hanya memanggil service**. Server action dan route
handler cuma mengurai input, memanggil service dengan `ServiceContext`
(household, user, peran, sumber), lalu menampilkan hasil. Service tidak tahu
soal cookie atau HTTP, sehingga bisa dipanggil juga dari bot Telegram dan
worker, serta dites langsung.

## Model data

- **Household** ("ruang keuangan") adalah batas data. Semua rekening,
  kategori, transaksi, dst. punya `householdId`. Versi awal hanya satu
  household dengan satu pemilik, tetapi `HouseholdMember` + peran
  (`owner/admin/member/viewer`) sudah siap untuk keluarga.
- **User** punya kolom `twoFactorEnabled/twoFactorSecret/recoveryCodes` dan
  `Session.verified` sebagai tempat 2FA nanti.
- **Transaction** menyimpan nominal selalu positif + `type` + rekening
  asal/tujuan. Status `draft` belum memengaruhi saldo; `confirmed` sudah.
- **LedgerEntry** adalah baris buku besar bertanda (+ masuk, − keluar).
  Saldo rekening = `initialBalance + Σ ledger` dari transaksi terkonfirmasi
  yang tidak dihapus.
- **TransactionSplit** membagi satu transaksi ke beberapa kategori; laporan
  per kategori memakai bagian-bagian ini.
- Entitas Tahap 2–4 (TelegramIdentity, ProcessedTelegramUpdate, Receipt,
  ReceiptExtraction, Budget/BudgetPeriod, Debt/DebtInstallment,
  InvestmentAsset/Transaction/Price, Notification) sudah ada di skema.

## Double-entry sederhana

`src/server/ledger.ts` menerjemahkan transaksi menjadi entri:

| Jenis | Entri |
|---|---|
| `expense` | −asal |
| `income` | +tujuan |
| `transfer` | −asal, +tujuan (total 0) |
| `debt_receivable` (memberi pinjaman) | −asal (opsional) |
| `debt_payable` (menerima pinjaman) | +tujuan (opsional) |
| `debt_payment` | −asal (bayar hutang) atau +tujuan (terima cicilan) |
| `investment_buy` / `investment_sell` / `investment_income` | −asal / +tujuan / +tujuan |
| `adjustment` | −asal atau +tujuan |

Laporan pemasukan/pengeluaran hanya menghitung `income`,
`investment_income`, dan `expense`. Karena transfer, pinjaman, dan
beli/jual investasi bukan pemasukan/pengeluaran, semuanya tidak mengacaukan
arus kas, tetapi tetap tercermin di saldo rekening.

Kartu kredit adalah rekening dengan saldo negatif (tagihan). Kekayaan bersih
= saldo positif − saldo negatif (+ investasi & piutang − hutang di Tahap 4).

## Zona waktu & angka

- Waktu disimpan sebagai `timestamptz` (UTC). Batas hari/bulan dihitung di
  Asia/Jakarta (UTC+7, tanpa DST) baik di JavaScript (`src/lib/dates.ts`)
  maupun SQL (`AT TIME ZONE 'Asia/Jakarta'`).
- Uang `Decimal(18,2)`; unit/harga investasi `Decimal(24,8)`.
- Tampilan: `Rp75.000`, `-Rp1.500.000`. CSV memakai pemisah `;` dan koma
  desimal agar rapi di Excel berbahasa Indonesia.

## Keamanan

- Kata sandi: Argon2id (m=19 MiB, t=2, p=1). Login dibatasi 5 percobaan /
  15 menit per email+IP, waktu respons disamakan untuk email tak terdaftar.
- Sesi: token acak 256-bit di cookie `httpOnly`, `SameSite=Lax`, `Secure`
  (production). Database hanya menyimpan SHA-256 token.
- Hapus transaksi = soft delete; hanya owner/admin yang bisa memulihkan.
- Semua perubahan rekening, kategori, dan transaksi masuk `AuditLog`
  (before/after JSON, aktor, sumber).
- Logger menyamarkan kunci yang mirip rahasia (`token`, `password`, dll).
- CSV dinetralkan dari formula injection.
- Rahasia hanya dari environment variable; `.env` tidak di-commit.

## Bot Telegram (Tahap 2)

```
Telegram ──POST──▶ /api/telegram/webhook
                     │ 1. cek header secret (perbandingan waktu-konstan)
                     ▼
               processUpdate()
                     │ 2. INSERT ProcessedTelegramUpdate(update_id)  ── duplikat? stop
                     ▼
               grammY bot.handleUpdate()
                     │ 3. middleware: chat pribadi + TELEGRAM_ALLOWED_USER_IDS
                     │ 4. TelegramIdentity → ServiceContext (source = "telegram")
                     ▼
               handlers.ts ──▶ parseTransactionText() ──▶ services/transactions
```

- `src/lib/parsing/transaction-text.ts`: parser murni berbasis aturan
  (niat, nominal, rekening dari alias, kategori dari kata kunci/kebiasaan,
  pihak hutang, cicilan, unit & harga investasi). Jika ada yang kurang, ia
  mengembalikan `missing` + satu `question`.
- Transaksi dari bot selalu dibuat sebagai **draf** (`source = telegram_text`)
  dan baru `confirmed` saat tombol Simpan ditekan dan datanya lengkap.
- Tombol inline memakai `callback_data` `tx:<aksi>:<id>[:<arg>]` (≤ 64 byte).
  Setiap aksi tetap lewat service, jadi validasi household & audit log sama
  dengan dashboard.
- `TelegramChatState` menyimpan input yang sedang ditunggu (nominal baru,
  pembagian) selama 30 menit; `/batal` menghapusnya.
- `CategoryMerchantRule` diisi saat transaksi disimpan lewat bot, dipakai
  untuk saran kategori berikutnya.
- Idempotensi bersifat *at-most-once*: update dicatat sebelum diproses. Jika
  handler gagal, status `failed` disimpan dan pengguna diberi tahu, sehingga
  Telegram tidak memicu pembuatan transaksi ganda.
- Polling (`scripts/telegram-polling.ts`) memakai `processUpdate()` yang sama.

## Rencana tahap berikutnya

- **Tahap 3:** MinIO + presigned URL berumur pendek, BullMQ worker,
  interface `ReceiptExtractionProvider` (mock, Tesseract lokal, opsional AI).
- **Tahap 4:** anggaran, hutang/piutang + cicilan, investasi, pengingat,
  laporan lanjutan.
