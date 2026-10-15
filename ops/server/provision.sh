#!/usr/bin/env bash
# =============================================================================
# Provisionnement de Second Brain sur un VPS Ubuntu (idempotent).
#
# Exécuté en root par `npm run prod:setup` (ops/setup.ts). Le serveur peut
# déjà héberger d'autres applications : chaque étape vérifie l'existant.
#
#   utilisateur applicatif + clés SSH héritées (si absent)
#   pare-feu UFW (22/80/443), swap, Docker, Caddy (si absents)
#   site Caddy dédié au domaine, dépôt cloné, .env généré, cron de sauvegarde
#
# Variables : DEPLOY_USER APP_DIR REPO_URL BRANCH DOMAIN BACKUP_DIR
#             RETENTION_DAYS APP_PORT APP_SLUG
# =============================================================================
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
APP_DIR="${APP_DIR:-/home/$DEPLOY_USER/secondbrain}"
REPO_URL="${REPO_URL:?REPO_URL est obligatoire}"
BRANCH="${BRANCH:-main}"
DOMAIN="${DOMAIN:?DOMAIN est obligatoire}"
BACKUP_DIR="${BACKUP_DIR:-/home/$DEPLOY_USER/backups-secondbrain}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
APP_PORT="${APP_PORT:-3001}"
APP_SLUG="${APP_SLUG:-$(basename "$APP_DIR")}"
BUILD_CACHE_MAX="${BUILD_CACHE_MAX:-5GB}"

step() { echo; echo "=== $* ==="; }

step "Paquets de base"
export DEBIAN_FRONTEND=noninteractive
# Non bloquant : un dépôt tiers défaillant (ex. cloudsmith/Caddy en 402) ne
# doit pas empêcher un provisionnement sur un serveur déjà équipé.
apt-get update -qq || echo "⚠ apt-get update incomplet (dépôt tiers indisponible), on continue"
apt-get install -y -qq ca-certificates curl git gnupg ufw cron openssl

step "Utilisateur applicatif : $DEPLOY_USER"
if ! id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
  install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
  SOURCE_KEYS=""
  for candidate in /root/.ssh/authorized_keys "$HOME/.ssh/authorized_keys" \
    "${SUDO_USER:+/home/$SUDO_USER/.ssh/authorized_keys}"; do
    if [ -n "$candidate" ] && [ -s "$candidate" ]; then SOURCE_KEYS="$candidate"; break; fi
  done
  if [ -z "$SOURCE_KEYS" ]; then
    echo "✗ Aucune clé SSH autorisée trouvée : impossible de créer l'accès de $DEPLOY_USER." >&2
    exit 1
  fi
  install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$SOURCE_KEYS" "/home/$DEPLOY_USER/.ssh/authorized_keys"
  echo "$DEPLOY_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/90-$DEPLOY_USER"
  chmod 440 "/etc/sudoers.d/90-$DEPLOY_USER"
else
  echo "déjà présent"
fi

step "Pare-feu"
ufw allow OpenSSH >/dev/null
ufw allow 80,443/tcp >/dev/null
ufw --force enable >/dev/null

step "Swap (2 Go)"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

step "Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
usermod -aG docker "$DEPLOY_USER"
systemctl enable --now docker
if ! grep -q '"gc"' /etc/docker/daemon.json 2>/dev/null; then
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<DAEMON
{ "builder": { "gc": { "enabled": true, "defaultKeepStorage": "$BUILD_CACHE_MAX" } } }
DAEMON
  systemctl restart docker
fi

step "Caddy (HTTPS automatique)"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  echo "deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy
fi
mkdir -p /etc/caddy/sites
if ! grep -q 'import /etc/caddy/sites' /etc/caddy/Caddyfile 2>/dev/null; then
  cat > /etc/caddy/Caddyfile <<'CADDY'
# Un fichier par application dans /etc/caddy/sites/ — certificats Let's Encrypt automatiques.
import /etc/caddy/sites/*.caddy
CADDY
fi
cat > "/etc/caddy/sites/$APP_SLUG.caddy" <<CADDY
$DOMAIN {
	encode zstd gzip
	# Images des notes (10 Mo) et documents de projet (25 Mo).
	request_body {
		max_size 30MB
	}
	reverse_proxy localhost:$APP_PORT
}
CADDY
caddy validate --config /etc/caddy/Caddyfile >/dev/null
systemctl reload caddy || systemctl restart caddy

step "Dépôt applicatif : $APP_DIR"
case "$REPO_URL" in
  git@*|ssh://*)
    DEPLOY_KEY="/home/$DEPLOY_USER/.ssh/id_ed25519_$APP_SLUG"
    if [ ! -f "$DEPLOY_KEY" ]; then
      sudo -u "$DEPLOY_USER" ssh-keygen -t ed25519 -N "" -C "deploy-$APP_SLUG@$DOMAIN" -f "$DEPLOY_KEY" >/dev/null
    fi
    KNOWN="/home/$DEPLOY_USER/.ssh/known_hosts"
    if ! grep -q '^github.com' "$KNOWN" 2>/dev/null; then
      ssh-keyscan -t rsa,ed25519 github.com >> "$KNOWN" 2>/dev/null
      chown "$DEPLOY_USER:$DEPLOY_USER" "$KNOWN"
    fi
    GIT_SSH="GIT_SSH_COMMAND='ssh -i $DEPLOY_KEY -o IdentitiesOnly=yes'"
    ;;
  *) GIT_SSH="" ;;
esac

if [ ! -d "$APP_DIR/.git" ]; then
  if ! sudo -u "$DEPLOY_USER" env ${GIT_SSH:+GIT_SSH_COMMAND="ssh -i $DEPLOY_KEY -o IdentitiesOnly=yes"} \
      git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"; then
    echo "✗ Clonage impossible : dépôt privé ?"
    if [ -f "${DEPLOY_KEY:-}" ]; then
      echo "  Ajoutez cette clé publique comme « Deploy key » (lecture seule) sur GitHub :"
      cat "$DEPLOY_KEY.pub"
    fi
    exit 1
  fi
  if [ -n "${DEPLOY_KEY:-}" ]; then
    sudo -u "$DEPLOY_USER" git -C "$APP_DIR" config core.sshCommand "ssh -i $DEPLOY_KEY -o IdentitiesOnly=yes"
  fi
fi
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$BACKUP_DIR"
# Créé à l'avance : sinon Docker le crée en root au premier montage et
# l'application (uid 1001) ne peut pas y écrire.
install -d -o 1001 -g 1001 "$APP_DIR/data/uploads" "$APP_DIR/data/documents" "$APP_DIR/data/downloads"

step "Fichier .env"
if [ ! -f "$APP_DIR/.env" ]; then
  SESSION_SECRET="$(openssl rand -hex 32)"
  POSTGRES_PASSWORD="$(openssl rand -hex 24)"
  cat > "$APP_DIR/.env" <<ENVFILE
# Généré par provision.sh le $(date -Iseconds) — secrets aléatoires.
# Modifier avec : npm run prod:env -- --set CLE=valeur --restart
DATABASE_URL="postgresql://secondbrain:$POSTGRES_PASSWORD@db:5432/secondbrain?schema=public"
POSTGRES_PASSWORD="$POSTGRES_PASSWORD"
SESSION_SECRET="$SESSION_SECRET"
NEXT_PUBLIC_SITE_URL="https://$DOMAIN"
DATA_DIR="/app/data"
APP_PORT="$APP_PORT"
# Base non exposée sur l'hôte en production.
DB_PORT="127.0.0.1:55432"
# Inscriptions fermées par défaut : comptes créés par scripts/create-user.ts
# (ouvrir avec npm run prod:env -- --set ALLOW_REGISTRATION=true --restart).
ALLOW_REGISTRATION="false"
ENVFILE
  chown "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  echo ".env créé (SESSION_SECRET et mot de passe PostgreSQL générés)."
else
  echo ".env déjà présent, laissé intact."
fi

step "Sauvegarde quotidienne (cron 3h25)"
cat > "/etc/cron.d/backup-$APP_SLUG" <<CRON
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
25 3 * * * $DEPLOY_USER BACKUP_DIR=$BACKUP_DIR RETENTION_DAYS=$RETENTION_DAYS bash $APP_DIR/ops/server/backup.sh >> $BACKUP_DIR/backup.log 2>&1
CRON
chmod 644 "/etc/cron.d/backup-$APP_SLUG"

echo
echo "Provisionnement terminé."
echo "  Application : $APP_DIR"
echo "  Domaine     : https://$DOMAIN (Caddy → localhost:$APP_PORT)"
echo "  Sauvegardes : $BACKUP_DIR (quotidien 3h25, rétention $RETENTION_DAYS jours)"
echo "Étape suivante : npm run prod:deploy"
