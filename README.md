# Kasku

Pencatat keuangan pribadi yang di-host sendiri. Catat pemasukan, pengeluaran,
dan transfer antar-rekening lewat dashboard web (dan segera lewat bot
Telegram), lalu lihat saldo serta arus kas dalam Rupiah dengan zona waktu
Asia/Jakarta.

> **Status:** Tahap 1 (fondasi) selesai. Bot Telegram, foto struk, anggaran,
> hutang/piutang, dan investasi menyusul di Tahap 2–4. Skema database untuk
> semuanya sudah disiapkan.

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

## Kebutuhan server

- Linux dengan Docker Engine 24+ dan Docker Compose v2.
- Minimal 1 vCPU, 1 GB RAM, 5 GB disk (Raspberry Pi 4 64-bit cukup).
- Untuk HTTPS publik: domain yang mengarah ke server, port 80 & 443 terbuka.
  Untuk jaringan rumah saja: lihat bagian [HTTPS di LAN](#https-di-jaringan-lokal).

Untuk development tanpa Docker: Node.js 22+ dan PostgreSQL 16.

## Deployment dengan Docker (production)

```bash
git clone https://github.com/CRYPTPIKS/kasku.git
cd kasku
cp .env.example .env
# Edit .env: isi POSTGRES_PASSWORD (acak), APP_URL, DOMAIN
#   openssl rand -hex 24      # contoh membuat password acak
docker compose up -d --build
```

Saat container `app` mulai, migrasi database dijalankan otomatis
(`prisma migrate deploy`). Lalu isi data awal dan buat akun pemilik:

```bash
# Kategori Indonesia + contoh rekening
docker compose exec app npx prisma db seed

# Akun pemilik (kata sandi diminta tanpa ditampilkan)
docker compose exec -it app npx tsx scripts/create-user.ts --email kamu@contoh.com --name "Nama Kamu"
```

Buka `https://DOMAIN-kamu` dan masuk.

Layanan di `docker-compose.yml`:

| Layanan | Fungsi |
|---|---|
| `db` | PostgreSQL 16, data di volume `pgdata` |
| `app` | Next.js (port 3000, hanya di jaringan internal) |
| `caddy` | Reverse proxy + HTTPS otomatis (Let's Encrypt) |
| `backup` | `pg_dump` harian pukul 02.00 WIB ke `./backups`, disimpan 14 hari |

Perintah berguna:

```bash
docker compose logs -f app                 # log aplikasi
docker compose pull && docker compose up -d --build   # update setelah git pull
docker compose exec -it app npx tsx scripts/create-user.ts --email kamu@contoh.com --reset   # reset kata sandi
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
npx tsx scripts/demo-data.ts            # opsional: transaksi contoh
npm run dev                             # http://localhost:3000
```

Set `COOKIE_SECURE=false` di `.env` saat development lewat `http://`.

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

Variabel Telegram (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
`TELEGRAM_ALLOWED_USER_IDS`) dan object storage ditambahkan di Tahap 2–3.
Nilai rahasia tidak pernah dicetak ke log.

## Migrasi database

```bash
npx prisma migrate dev --name <nama>    # development: buat migrasi baru dari perubahan schema
npx prisma migrate deploy               # production: terapkan migrasi (otomatis di container)
npx prisma studio                       # lihat data
```

## Menjalankan webhook Telegram

Hadir di Tahap 2. Rencananya: production memakai webhook
`https://DOMAIN/api/telegram/webhook` dengan secret token, development
memakai long polling.

## Backup & restore

**Otomatis:** layanan `backup` membuat `backups/kasku-YYYYmmdd-HHMMSS.dump`
setiap hari pukul 02.00 WIB (dan sekali saat pertama kali jalan), dan
menghapus file lebih tua dari `BACKUP_KEEP_DAYS` hari. Salin folder
`backups/` ke tempat lain (NAS, cloud) secara berkala.

**Manual:**

```bash
./scripts/backup.sh
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
npm run test:unit        # parser nominal & aturan double-entry, tanpa database
npm run test:integration # layanan & endpoint API, butuh TEST_DATABASE_URL
npm run lint
npm run typecheck
```

Test integrasi hanya mau mengosongkan database yang namanya berakhiran
`_test`. GitHub Actions menjalankan semuanya plus build image Docker di
setiap PR.

## Struktur & arsitektur

Lihat [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
