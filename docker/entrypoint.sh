#!/bin/sh
set -e
# Terapkan migrasi database sebelum aplikasi berjalan (aman diulang).
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "Menerapkan migrasi database..."
  npx prisma migrate deploy
fi
exec "$@"
