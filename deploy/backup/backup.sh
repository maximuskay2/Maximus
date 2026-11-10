#!/bin/sh
# Nightly snapshot of the Maximus data volume. Runs inside the `backup` sidecar
# (compose.prod.yml / compose.staging.yml): /data is the live volume mounted
# read-only, /backups holds the snapshots. Keeps BACKUP_RETENTION_DAYS days.
#
# The snapshot is a plain tar.gz of the volume (SQLite files copy safely for
# backup while the server runs; restore runs on a STOPPED container and then
# verifies integrity — see docs/prod-infra.md "Restore drill"). Exit nonzero on
# any failure so the sidecar log shows it.
set -eu

DATA_DIR="${DATA_DIR:-/data}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

command -v tar >/dev/null 2>&1 || { echo "backup: tar not found" >&2; exit 1; }
test -d "$DATA_DIR" || { echo "backup: $DATA_DIR is not a directory" >&2; exit 1; }
mkdir -p "$BACKUP_DIR"

stamp="$(date -u +%Y%m%d-%H%M%S)"
tmp="$BACKUP_DIR/.maximus-backup-$stamp.tar.gz"
final="$BACKUP_DIR/maximus-backup-$stamp.tar.gz"

# -p preserves modes (keys stay 0600); the temp name keeps partial files out of
# retention/restore until the snapshot verifies.
tar -cpzf "$tmp" -C "$DATA_DIR" .
tar -tzf "$tmp" >/dev/null
mv "$tmp" "$final"
echo "backup: wrote $final ($(du -h "$final" | cut -f1))"

# Prune snapshots older than the retention window (verified files only).
# shellcheck disable=SC2086
find "$BACKUP_DIR" -maxdepth 1 -name 'maximus-backup-*.tar.gz' -mtime +"$RETENTION_DAYS" -print -delete

echo "backup: done ($(ls "$BACKUP_DIR"/maximus-backup-*.tar.gz 2>/dev/null | wc -l | tr -d ' ') snapshots kept)"
