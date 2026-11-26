#!/usr/bin/env bash
# Pulihkan database dari file backup.
#   ./scripts/restore.sh backups/kasku-20261126-020000.dump
# PERINGATAN: data di database saat ini akan DIGANTI isi backup.
set -euo pipefail
cd "$(dirname "$0")/.."
file="${1:?Pakai: ./scripts/restore.sh <file.dump>}"
[ -f "$file" ] || { echo "File tidak ditemukan: $file" >&2; exit 1; }
read -r -p "Data saat ini akan diganti dengan isi $file. Ketik PULIHKAN untuk lanjut: " ans
[ "$ans" = "PULIHKAN" ] || { echo "Dibatalkan."; exit 1; }
docker compose stop app
docker compose exec -T db sh -c 'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$file"
docker compose start app
echo "Selesai. Aplikasi dijalankan kembali."
