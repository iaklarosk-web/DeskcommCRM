#!/usr/bin/env bash
# scripts/prod/backup-diario.sh — backup DIÁRIO e verificável do Postgres de
# PRODUÇÃO para o Google Drive (F08-T09), no mesmo desenho dos outros OS desta
# VPS (`~/bin/backup-pdv-os`): pg_dump custom → rclone → confere o tamanho no
# remoto → grava um marcador de sucesso que um monitor pode ler → retenção.
#
# Instalação (docs/ops/prod.md): `install -m 755 scripts/prod/backup-diario.sh
# ~/bin/backup-crm-os` e uma linha no crontab do klarosk:
#   20 3 * * * /home/klarosk/bin/backup-crm-os >> /home/klarosk/backup.log 2>&1
# Nenhum segredo neste arquivo: a senha do banco fica no container (pg_dump
# roda DENTRO dele, como usuário postgres, sem rede).
set -euo pipefail
umask 077

backup_date="${CRM_BACKUP_DATE:-$(date +%F)}"
backup_dir="${CRM_BACKUP_DIR:-/srv/backup}"
backup_remote="${CRM_BACKUP_REMOTE:-gdrive-crypt:crm-os/db}"
backup_marker="${CRM_BACKUP_MARKER:-/var/tmp/crm-os-backup-success.marker}"
backup_lock="${CRM_BACKUP_LOCK_FILE:-/var/tmp/crm-os-backup.lock}"
postgres_container="${CRM_POSTGRES_CONTAINER:-crm-prod-db}"
retention_days="${CRM_BACKUP_RETENTION_DAYS:-14}"

[[ "$backup_date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "ABORTADO: data de backup inválida" >&2; exit 1; }
[[ "$retention_days" =~ ^[0-9]+$ ]] || { echo "ABORTADO: retenção inválida" >&2; exit 1; }

mkdir -p "$backup_dir" "$(dirname "$backup_marker")" "$(dirname "$backup_lock")"
exec 9>"$backup_lock"
flock -n 9 || { echo "ABORTADO: outro backup do CRM OS já está em execução" >&2; exit 1; }

dump=$(mktemp --suffix=.dump "$backup_dir/.crm-db-$backup_date.XXXXXX")
remote_file="$backup_remote/crm-db-$backup_date.dump"
marker_tmp=$(mktemp "$(dirname "$backup_marker")/.crm-backup-marker.XXXXXX")
cleanup() { rm -f -- "$dump" "$marker_tmp"; }
trap cleanup EXIT

# Os três schemas que o produto usa (como scripts/backup.sh); sem owner nem
# privilégios: o restore recria o que precisa num banco novo (D36).
sudo docker exec "$postgres_container" \
  pg_dump -U postgres -Fc --schema=public --schema=auth --schema=storage --no-owner --no-privileges postgres >"$dump"
local_size=$(stat -c%s "$dump")
(( local_size > 0 )) || { echo "ABORTADO: dump vazio" >&2; exit 1; }

# O arquivo local permanece disponível até a confirmação remota.
rclone copyto "$dump" "$remote_file" -q
remote_size=$(rclone lsl "$remote_file" | awk 'NR == 1 { print $1 }')
[[ "$remote_size" =~ ^[0-9]+$ ]] && (( remote_size == local_size )) || {
  echo "ABORTADO: cópia remota não confirmada com o mesmo tamanho" >&2
  exit 1
}

# O monitor só considera o backup recente depois desta confirmação.
printf '%s\n%s\n%s\n%s\n' "$(date +%s)" "$backup_date" "$remote_size" "$remote_file" >"$marker_tmp"
mv -f -- "$marker_tmp" "$backup_marker"

if ! rclone delete "$backup_remote" --min-age "${retention_days}d" -q; then
  echo "AVISO: backup confirmado, mas a retenção remota falhou" >&2
fi

echo "backup crm-os confirmado $backup_date (${remote_size}B) remote=$remote_file"
