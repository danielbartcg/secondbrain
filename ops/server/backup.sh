#!/usr/bin/env bash
# =============================================================================
# Sauvegarde de Second Brain en production.
#
# Produit deux fichiers horodatés dans $BACKUP_DIR :
#   db-<horodatage>.dump       — dump PostgreSQL au format custom (compressé)
#   files-<horodatage>.tar.gz  — data/uploads (images des notes)
#
#
# Exécuté :
#   - chaque nuit par /etc/cron.d/backup-secondbrain (posé par ops/setup.ts) ;
#   - à la demande depuis le poste de dev : `npm run prod:backup`.
#
# Variables (toutes optionnelles) :
#   BACKUP_DIR=~/backups   RETENTION_DAYS=14
#   POSTGRES_USER=secondbrain  POSTGRES_DB=secondbrain
#   B2_BUCKET=...          (copie hors-site via rclone si le profil existe)
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
POSTGRES_USER="${POSTGRES_USER:-secondbrain}"
POSTGRES_DB="${POSTGRES_DB:-secondbrain}"
STAMP="$(date +%Y-%m-%d-%H%M)"

cd "$REPO_DIR"
mkdir -p "$BACKUP_DIR"

# --- Base de données ---------------------------------------------------------
# Format « custom » : compressé, restaurable sélectivement avec pg_restore.
# On écrit d'abord un .part pour qu'une sauvegarde interrompue ne soit jamais
# prise pour une sauvegarde valide (ni copiée hors-site).
db_tmp="$BACKUP_DIR/db-$STAMP.dump.part"
docker compose exec -T db pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > "$db_tmp"
mv "$db_tmp" "$BACKUP_DIR/db-$STAMP.dump"

# --- Fichiers non reconstructibles ------------------------------------------
files_tmp="$BACKUP_DIR/files-$STAMP.tar.gz.part"
targets=()
[ -d "$REPO_DIR/data/uploads" ] && targets+=(uploads)
if [ ${#targets[@]} -gt 0 ]; then
  tar czf "$files_tmp" -C "$REPO_DIR/data" "${targets[@]}"
  mv "$files_tmp" "$BACKUP_DIR/files-$STAMP.tar.gz"
else
  echo "Aucun fichier à archiver (data/uploads absent)."
fi

# --- Rotation locale ---------------------------------------------------------
find "$BACKUP_DIR" -maxdepth 1 -name 'db-*.dump' -mtime "+$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -maxdepth 1 -name 'files-*.tar.gz' -mtime "+$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -maxdepth 1 -name '*.part' -mtime +1 -delete

# --- Copie hors-site (Backblaze B2 via rclone) -------------------------------
# Le profil rclone « b2 » et ce fichier d'environnement sont posés par
# `npm run prod:setup` quand B2_* est renseigné dans .env.deploy.
# Absents : on saute silencieusement cette étape.
BACKUP_ENV="$HOME/.config/secondbrain/backup.env"
# shellcheck source=/dev/null
[ -f "$BACKUP_ENV" ] && . "$BACKUP_ENV"

if [ -n "${B2_BUCKET:-}" ] && command -v rclone >/dev/null 2>&1; then
  # `sync` réplique aussi les suppressions : la rétention hors-site suit la
  # rétention locale, ce qui borne la facture de stockage.
  rclone sync "$BACKUP_DIR" "b2:$B2_BUCKET/$(hostname)" \
    --exclude '*.part' --exclude '*.log' --transfers 2 --quiet
  echo "Copie hors-site effectuée vers b2:$B2_BUCKET/$(hostname)"
fi

echo "Sauvegarde terminée ($(date -Iseconds)) :"
ls -lh "$BACKUP_DIR/db-$STAMP.dump" "$BACKUP_DIR/files-$STAMP.tar.gz" 2>/dev/null || true
df -h "$BACKUP_DIR" | tail -1
