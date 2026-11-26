#!/usr/bin/env bash
# Backup manual: ./scripts/backup.sh  -> backups/kasku-manual-YYYYmmdd-HHMMSS.dump
set -euo pipefail
cd "$(dirname "$0")/.."
file="backups/kasku-manual-$(date +%Y%m%d-%H%M%S).dump"
docker compose exec -T db sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$file"
echo "Backup tersimpan: $file ($(du -h "$file" | cut -f1))"
