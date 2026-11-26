# Kasku

Pencatat keuangan pribadi yang di-host sendiri. Catat pemasukan, pengeluaran,
dan transfer antar-rekening lewat dashboard web atau bot Telegram (termasuk
foto struk), lalu lihat saldo serta arus kas dalam Rupiah dengan zona waktu
Asia/Jakarta.

> **Status:** Tahap 1 (fondasi), Tahap 2 (bot Telegram), Tahap 3 (foto
> struk), dan Tahap 4 (anggaran, hutang/piutang, investasi, pengingat)
> selesai.

## Fitur Tahap 1

- Login dashboard (email + kata sandi Argon2id), pembatasan percobaan login.
- Rekening: tunai, bank, e-wallet, kartu kredit, deposito, lainnya; saldo awal,
  saldo terkini, riwayat per rekening, arsip.
- Kategori pemasukan/pengeluaran bawaan Indonesia (bisa diubah, sub-kategori,
  kata kunci untuk saran otomatis).
- Transaksi manual: semua jenis (`income`, `expense`, `transfer`, hutang,
  investasi, penyesuaian), draf → konfirmasi, bagi ke beberapa kategori, tag,
  duplikasi, hapus (soft delete) + pulihkan oleh admin, audit log.
- Input nominal fleksibel: `75rb`, `1,5jt`, `2 juta`, `Rp 25.000`.
- Daftar transaksi dengan pencarian, filter (tanggal, kategori, rekening, tag,
  status), pagination, ekspor CSV.
- Dashboard: total saldo, pemasukan/pengeluaran/selisih bulan ini, draf yang
  perlu dikonfirmasi, transaksi terbaru, grafik pengeluaran per kategori.
- Laporan: arus kas bulanan, per kategori, bulan ini vs bulan lalu; filter
  rentang tanggal; ekspor CSV.
- Tampilan responsif, nyaman di ponsel (navigasi bawah).

## Fitur Tahap 2: bot Telegram

- Catat lewat chat dengan bahasa sehari-hari, misalnya
  `keluar 75rb makan siang pakai cash`, `bayar listrik 425000 dari BCA`,
  `masuk 12jt gaji bulan November`, `transfer 500rb dari BCA ke GoPay`.
- Setiap pesan menjadi **draf** dengan tombol: Simpan, Ubah nominal, Ubah
  kategori, Ubah rekening, Bagi transaksi, Hapus. Saldo baru berubah setelah
  Simpan.
- Kalau ada yang kurang (rekening/kategori), bot menanyakan satu hal dengan
  tombol pilihan, tidak menebak.
- Kategori disarankan dari kata kunci dan dipelajari dari transaksi yang
  pernah kamu simpan.
- Perintah: `/start`, `/bantuan`, `/saldo`, `/ringkasan`, `/transaksi`,
  `/anggaran`, `/hutang`, `/piutang`, `/investasi`, `/batal`.
- Hanya akun di `TELEGRAM_ALLOWED_USER_IDS` yang dilayani, hanya di chat
  pribadi. Webhook diverifikasi dengan secret token. Setiap `update_id`
  diproses sekali saja, jadi pesan yang dikirim ulang Telegram tidak membuat
  transaksi ganda.

## Fitur Tahap 3: foto struk

- Kirim foto struk ke bot (atau unggah di dashboard **Transaksi → Struk**).
  Bot membalas "Struk sedang diproses.", lalu mengirim draf berisi toko,
  tanggal, total, diskon/pajak/layanan, metode bayar, dan daftar item.
- Draf memakai tombol yang sama dengan Tahap 2. Rekening ditebak dari metode
  bayar (mis. `DEBIT BCA`) hanya bila jelas; kalau tidak, bot bertanya.
- Kalau struk tidak terbaca, foto tetap disimpan dan bot meminta total
  (balas saja `43rb`). Di dashboard ada isian manual dan tombol **Baca ulang**.
- Foto yang sama persis (SHA-256) tidak diproses dua kali.
- OCR default **gratis, lokal, dan offline**: Tesseract (`ind+eng`, data
  bahasa ikut terpasang, tidak diunduh saat runtime). Bisa diganti
  penyedia lain lewat `RECEIPT_PROVIDER`, lihat
  [docs/RECEIPT_PROVIDERS.md](docs/RECEIPT_PROVIDERS.md).
- Foto disimpan di MinIO (bucket privat, tanpa port publik) dan hanya bisa
  dibuka lewat aplikasi setelah login (`Cache-Control: private, no-store`).
- Pembacaan berjalan di service `worker` lewat antrean Redis/BullMQ, jadi
  webhook Telegram tetap cepat. Tanpa `REDIS_URL` (development), struk
  diproses langsung di proses aplikasi.

## Fitur Tahap 4: anggaran, hutang/piutang, investasi, pengingat

- **Anggaran** per kategori (anggaran kategori induk ikut menghitung
  sub-kategori). Nominal default berlaku tiap bulan, bisa diganti khusus untuk
  satu bulan. Halaman **Anggaran** menampilkan terpakai, sisa, dan jatah per
  hari. Bot memberi peringatan saat anggaran lewat 80% dan 100%, sekali per
  bulan per tingkat.
- **Hutang & piutang** dengan pihak terkait, jatuh tempo, dan cicilan
  (jadwal otomatis, cicilan terakhir menyesuaikan sisa pokok). Pembayaran
  dialokasikan ke cicilan paling lama dulu. Status aktif, lunas, atau
  terlambat dihitung ulang setiap ada transaksi yang diubah atau dihapus.
- **Investasi**: saham (lot = 100 lembar), reksa dana, emas, kripto,
  deposito, obligasi. Beli, jual, dividen, bunga, dan harga manual. Modal
  dihitung dengan metode harga rata-rata, lengkap dengan untung/rugi
  terealisasi dan belum terealisasi serta alokasi aset.
- **Bot**: `pinjam 2jt dari Budi ke BCA cicilan 300rb tiap tanggal 10`,
  `bayar hutang 400rb ke budi`, `pinjamkan 300rb ke Andi dari Tunai`,
  `beli BBCA 2 lot @9500 dari BCA`, `jual emas 1 gram 1,6jt ke BCA`,
  `dividen BBCA 150rb ke BCA`. Semuanya muncul sebagai usulan dengan tombol
  Simpan, Ubah rekening, dan Batal, dan baru tercatat setelah Simpan.
- **Pengingat** lewat Telegram: cicilan atau hutang yang jatuh tempo dalam
  beberapa hari (default 3) atau sudah terlambat, dan anggaran yang lewat
  batas. Setiap pengingat dikirim sekali saja dan hanya antara 07.00 dan
  21.00 WIB. Berjalan otomatis di service `worker` setiap
  `REMINDER_INTERVAL_MINUTES` (default 15). Tanpa worker, jalankan
  `npm run reminders` dari cron.
- Dashboard menampilkan anggaran bulan ini, jatuh tempo 14 hari ke depan, dan
  kekayaan bersih. Laporan menampilkan kekayaan bersih serta anggaran vs
  realisasi, dengan ekspor CSV untuk investasi dan hutang/piutang.

## Kebutuhan server

- Linux dengan Docker Engine 24+ dan Docker Compose v2.
- Minimal 1 vCPU, 2 GB RAM (OCR Tesseract butuh ±300 MB saat membaca),
  10 GB disk untuk foto struk (Raspberry Pi 4 64-bit 4 GB cukup).
- Untuk HTTPS publik: domain yang mengarah ke server, port 80 & 443 terbuka.
  Untuk jaringan rumah saja: lihat bagian [HTTPS di LAN](#https-di-jaringan-lokal).

Untuk development tanpa Docker: Node.js 22+ dan PostgreSQL 16.

## Deployment dengan Docker (production)

```bash
git clone https://github.com/CRYPTPIKS/kasku.git
cd kasku
cp .env.example .env
# Edit .env: isi POSTGRES_PASSWORD, REDIS_PASSWORD, S3_ACCESS_KEY,
# S3_SECRET_KEY (semuanya acak), APP_URL, DOMAIN
#   openssl rand -hex 24      # contoh membuat password acak
docker compose up -d --build
```

Saat container `app` mulai, migrasi database dijalankan otomatis
(`prisma migrate deploy`). Lalu isi data awal dan buat akun pemilik:

```bash
# Kategori Indonesia + contoh rekening
docker compose exec app npx prisma db seed

# Akun pemilik (kata sandi diminta tanpa ditampilkan)
docker compose exec -it app npm run user:create -- --email kamu@contoh.com --name "Nama Kamu"
```

Buka `https://DOMAIN-kamu` dan masuk.

Layanan di `docker-compose.yml`:

| Layanan | Fungsi |
|---|---|
| `db` | PostgreSQL 16, data di volume `pgdata` |
| `app` | Next.js (port 3000, hanya di jaringan internal) |
| `worker` | Pembaca struk (OCR) dari antrean, image sama dengan `app` |
| `redis` | Antrean BullMQ (dengan password, hanya jaringan internal) |
| `minio` | Penyimpanan foto struk, bucket privat, tanpa port/konsol publik |
| `caddy` | Reverse proxy + HTTPS otomatis (Let's Encrypt) |
| `backup` | `pg_dump` harian pukul 02.00 WIB ke `./backups`, disimpan 14 hari |

Perintah berguna:

```bash
docker compose logs -f app                 # log aplikasi
docker compose pull && docker compose up -d --build   # update setelah git pull
docker compose exec -it app npm run user:create -- --email kamu@contoh.com --reset   # reset kata sandi
```

### HTTPS di jaringan lokal

Jika server hanya diakses dari rumah (tanpa domain publik), isi
`DOMAIN=kasku.lan` (atau nama lain yang kamu arahkan lewat DNS lokal/Pi-hole),
lalu tambahkan baris `tls internal` di dalam blok situs di `docker/Caddyfile`.
Caddy akan memakai sertifikat lokal; pasang root CA Caddy di perangkatmu
(`docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt`).
Alternatif: akses lewat Tailscale/WireGuard.

Jika benar-benar tanpa HTTPS (tidak disarankan), set `DOMAIN=:80` dan
`COOKIE_SECURE=false`.

## Instalasi lokal (development)

```bash
npm install
cp .env.example .env

# PostgreSQL dev (+ database kasku_test untuk test integrasi)
docker compose -f docker-compose.dev.yml up -d

npx prisma migrate dev                  # buat tabel
SEED_ADMIN_EMAIL=saya@contoh.com SEED_ADMIN_PASSWORD='kata-sandi-minimal-10' npm run db:seed
npm run db:demo                         # opsional: transaksi contoh
npm run dev                             # http://localhost:3000
```

Set `COOKIE_SECURE=false` di `.env` saat development lewat `http://`.

Foto struk saat development: tanpa pengaturan apa pun, foto disimpan di
`./storage` dan dibaca langsung oleh proses `npm run dev`. Untuk mencoba
antrean seperti production, nyalakan Redis (dan MinIO bila mau) dari
`docker-compose.dev.yml`, isi `REDIS_URL=redis://localhost:6379`, lalu
jalankan `npm run worker` di terminal lain. `RECEIPT_PROVIDER=mock` berguna
untuk mencoba alur tanpa OCR sungguhan.

## Environment variables

| Variabel | Wajib | Keterangan |
|---|---|---|
| `DATABASE_URL` | ya (non-Docker) | URL PostgreSQL. Di Docker dibentuk otomatis dari `POSTGRES_*`. |
| `POSTGRES_DB`, `POSTGRES_USER` | – | Default `kasku`. |
| `POSTGRES_PASSWORD` | ya (Docker) | Password database. Gunakan nilai acak. |
| `APP_URL` | ya | URL publik dashboard, mis. `https://keuangan.rumahku.id`. |
| `DOMAIN` | ya (Docker) | Domain untuk Caddy. |
| `SESSION_TTL_DAYS` | – | Lama sesi login, default 30 hari. |
| `COOKIE_SECURE` | – | `true` (default di production) agar cookie hanya lewat HTTPS. |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME` | – | Membuat pemilik saat `db:seed`. |
| `SEED_SAMPLE_ACCOUNTS` | – | `false` untuk tidak membuat contoh rekening. |
| `BACKUP_KEEP_DAYS` | – | Lama penyimpanan backup otomatis, default 14. |
| `TEST_DATABASE_URL` | – | Database test integrasi (nama harus berakhiran `_test`). |
| `TELEGRAM_BOT_TOKEN` | untuk bot | Token dari @BotFather. |
| `TELEGRAM_WEBHOOK_SECRET` | untuk webhook | Rahasia 16–256 karakter (`A-Z a-z 0-9 _ -`). |
| `TELEGRAM_ALLOWED_USER_IDS` | untuk bot | ID numerik akun Telegram yang diizinkan, pisahkan koma. |

| `REDIS_PASSWORD` | ya (Docker) | Password Redis. Gunakan hex acak (tanpa simbol, karena masuk ke URL). |
| `REDIS_URL` | – | Non-Docker: `redis://:pass@host:6379/0`. Kosong = struk diproses langsung tanpa antrean. |
| `STORAGE_DRIVER` | – | `s3` (Docker), `local` (default non-Docker, folder `LOCAL_STORAGE_DIR` = `./storage`). |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | ya (Docker) | Kredensial MinIO (secret minimal 8 karakter). |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_FORCE_PATH_STYLE` | – | Default `kasku-receipts`, MinIO internal. Bucket dibuat otomatis, privat. |
| `RECEIPT_PROVIDER` | – | `tesseract` (default), `http`, atau `mock`. |
| `RECEIPT_HTTP_URL`, `RECEIPT_HTTP_TOKEN` | untuk `http` | Layanan OCR/AI sendiri, lihat docs/RECEIPT_PROVIDERS.md. |
| `TESSERACT_LANGS`, `TESSERACT_CACHE_DIR`, `TESSERACT_LANG_PATH` | – | Bahasa OCR (`ind+eng`), cache data bahasa, atau sumber data bahasa offline. |
| `RECEIPT_WORKER_CONCURRENCY` | – | Jumlah struk yang dibaca bersamaan, default 1. |
| `REMINDER_INTERVAL_MINUTES` | – | Jarak antar pengecekan pengingat di worker, default 15. |

Nilai rahasia tidak pernah dicetak ke log.

## Migrasi database

```bash
npx prisma migrate dev --name <nama>    # development: buat migrasi baru dari perubahan schema
npx prisma migrate deploy               # production: terapkan migrasi (otomatis di container)
npx prisma studio                       # lihat data
```

## Menyiapkan bot Telegram

1. Buka [@BotFather](https://t.me/BotFather), kirim `/newbot`, simpan token-nya.
2. Cari ID numerik akun Telegram-mu, misalnya lewat [@userinfobot](https://t.me/userinfobot).
3. Isi di `.env`:

   ```bash
   TELEGRAM_BOT_TOKEN=123456:ABC...
   TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32)   # tempel hasilnya
   TELEGRAM_ALLOWED_USER_IDS=123456789               # boleh lebih dari satu, pisahkan koma
   ```

4. Pastikan akun dashboard pemilik sudah dibuat. Akun Telegram yang diizinkan
   otomatis ditautkan ke pemilik saat pertama kali mengirim pesan.

### Production: webhook

Webhook butuh `APP_URL` HTTPS yang bisa diakses Telegram dari internet.

```bash
docker compose up -d                       # muat ulang env baru
docker compose exec app npm run telegram:webhook -- set     # daftarkan webhook + daftar perintah
docker compose exec app npm run telegram:webhook -- info    # cek status / error terakhir
```

Telegram akan memanggil `https://DOMAIN/api/telegram/webhook` dengan header
`X-Telegram-Bot-Api-Secret-Token`. Permintaan dengan secret salah ditolak
(401).

Jika server hanya bisa diakses di LAN, Telegram tidak bisa mengirim webhook.
Pilihannya: buka hanya path webhook lewat Cloudflare Tunnel / Tailscale
Funnel, atau jalankan mode polling di server (lihat di bawah).

### Development: polling

```bash
npm run telegram:polling
```

Perintah ini menghapus webhook yang aktif lalu mengambil pesan dengan
`getUpdates`. Jalur prosesnya sama dengan webhook (whitelist + anti-duplikat).
Jangan jalankan polling dan webhook bersamaan; setelah selesai, pasang lagi
webhook dengan `telegram:webhook -- set`.

## Backup & restore

**Otomatis:** layanan `backup` membuat `backups/kasku-YYYYmmdd-HHMMSS.dump`
setiap hari pukul 02.00 WIB (dan sekali saat pertama kali jalan), dan
menghapus file lebih tua dari `BACKUP_KEEP_DAYS` hari. Salin folder
`backups/` ke tempat lain (NAS, cloud) secara berkala.

**Manual:**

```bash
./scripts/backup.sh
```

Foto struk ada di volume `miniodata`. Backup juga volume ini, misalnya:

```bash
docker run --rm -v kasku_miniodata:/data -v "$PWD/backups":/out alpine \
  tar czf /out/struk-$(date +%Y%m%d).tar.gz -C /data .
```

**Restore:**

```bash
./scripts/restore.sh backups/kasku-20261126-020000.dump
```

Skrip meminta konfirmasi (ketik `PULIHKAN`), menghentikan `app`, mengganti
isi database dengan backup (`pg_restore --clean`), lalu menyalakan `app`
lagi. Uji restore secara berkala di server cadangan agar yakin backup bisa
dipakai.

Pemulihan manual tanpa skrip:

```bash
docker compose stop app
docker compose exec -T db sh -c 'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < backups/FILE.dump
docker compose start app
```

## Test, lint, type check

```bash
npm test                 # semua test (unit + integrasi)
npm run test:unit        # parser nominal, parser teks transaksi, aturan double-entry
npm run test:integration # layanan, endpoint API, bot & webhook Telegram, struk (tanpa jaringan/OCR sungguhan)
npm run lint
npm run typecheck
```

Test integrasi hanya mau mengosongkan database yang namanya berakhiran
`_test`. GitHub Actions menjalankan semuanya plus build image Docker di
setiap PR.

## Struktur & arsitektur

Lihat [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
