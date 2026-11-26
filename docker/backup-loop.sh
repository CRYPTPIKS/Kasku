#!/bin/sh
# Backup harian pukul 02.00 WIB (dan sekali saat pertama kali jalan).
# Format custom pg_dump, dipulihkan dengan pg_restore (lihat scripts/restore.sh).
set -eu
mkdir -p /backups
while true; do
  now=$(date +%H%M)
  if [ "$now" = "0200" ] || [ ! -f /backups/.last ]; then
    file="/backups/kasku-$(date +%Y%m%d-%H%M%S).dump"
    if pg_dump -Fc -f "$file.tmp"; then
      mv "$file.tmp" "$file"
      date > /backups/.last
      echo "Backup tersimpan: $file"
      # Hapus backup yang lebih tua dari BACKUP_KEEP_DAYS hari.
      find /backups -name 'kasku-*.dump' -mtime +"${BACKUP_KEEP_DAYS:-14}" -exec rm -f {} +
    else
      echo "Backup GAGAL" >&2
    fi
    sleep 61
  fi
  sleep 30
done
