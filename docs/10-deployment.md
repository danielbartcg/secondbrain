# Déploiement et exploitation

Second Brain tourne sur le **même VPS que la boutique TCG** : Caddy route
chaque domaine vers le port local de son application. Rien n'est partagé entre
les deux applications (dépôt, base, conteneurs, sauvegardes distincts).

| | Boutique | Second Brain |
| --- | --- | --- |
| Dépôt serveur | `/home/deploy/boutique` | `/home/deploy/secondbrain` |
| Port local | 3000 | **3001** |
| Site Caddy | `/etc/caddy/sites/boutique.caddy` | `/etc/caddy/sites/secondbrain.caddy` |
| Base | conteneur `boutique-db-1` | conteneur `secondbrain-db-1` |
| Sauvegardes | `/home/deploy/backups` | `/home/deploy/backups-secondbrain` (cron 3h25) |

Domaine : `secondbrain.danielbar-tcg.fr` (enregistrement A dans la zone DNS
OVH de `danielbar-tcg.fr`). Certificat Let's Encrypt automatique par Caddy.

## Configuration locale

Les scripts `ops/` lisent `.env.deploy` (gitignoré) : hôte, utilisateur, clé
SSH, domaine, dépôt, port. Modèle : `.env.deploy.example`.

## Première installation / mise à jour de l'infrastructure

```bash
npm run prod:setup
```

Idempotent. Sur un serveur déjà provisionné, il se contente d'ajouter ou de
réécrire : le site Caddy du domaine (limite de corps 30 Mo), le clone du dépôt,
le `.env` (secrets générés, laissé intact s'il existe), les répertoires
`data/uploads` et `data/documents` (uid 1001), le cron de sauvegarde.
**À relancer chaque fois que `ops/server/provision.sh` change.**

`apt-get update` est non bloquant : le dépôt apt de Caddy (cloudsmith)
répond parfois 402 ; Caddy étant déjà installé, on continue.

## Mettre en production

```bash
git push origin main
npm run prod:deploy
```

Séquence : sauvegarde (si la base tourne) → `git pull` → build des images →
`prisma migrate deploy` (conteneur `tools`) → `chown` des données →
recréation du conteneur `app` → contrôle de santé HTTPS (2 min).

Options : `--skip-backup`, `--force` (déployer malgré des commits non poussés —
inutile, le serveur tire GitHub).

## Exploitation

| Commande | Rôle |
| --- | --- |
| `npm run prod:status` | conteneurs, ressources, sauvegardes, version, ping HTTPS |
| `npm run prod:logs -- [--tail=500] [--follow] [--service=db]` | journaux |
| `npm run prod:exec -- "npx tsx scripts/create-user.ts --email=… --password=… --name=…"` | commande dans le conteneur `tools` |
| `npm run prod:exec -- --service=db "psql -U secondbrain secondbrain -c '\dt'"` | SQL direct |
| `npm run prod:env` / `-- --set CLE=valeur --restart` | lire / modifier le `.env` serveur (jamais à la main) |
| `npm run prod:backup [-- --pull]` | sauvegarde immédiate (dump + uploads + documents), rapatriement optionnel |
| `npm run prod:restore -- --file=db-….dump --yes` | restauration (destructive, sauvegarde préalable automatique) |
| `npm run desktop:build` puis `npm run desktop:publish` | construit l'installateur Windows (`native/release/`) puis le dépose dans `data/downloads` du serveur (page `/app`) |

Fermer les inscriptions une fois les comptes créés :

```bash
npm run prod:env -- --set ALLOW_REGISTRATION=false --restart
```

## Conteneurs (docker-compose.yml)

- `db` : PostgreSQL 16, volume `postgres_data`, publié sur `127.0.0.1:55432`
  en production (`DB_PORT`) — jamais exposé publiquement.
- `app` : image standalone Next.js, port `APP_PORT:3000`, volumes
  `./data/uploads`, `./data/documents` et `./data/downloads` (installateurs
  de l'application desktop, non sauvegardés : republiables).
- `tools` (profil `tools`) : étage `builder` de la même image, pour les
  migrations et les scripts. Même uid 1001 que l'application.

## Application iPhone (TestFlight)

Pas de build iOS possible sous Windows : le workflow GitHub Actions
`.github/workflows/ios-testflight.yml` (déclenchement manuel, runner macOS)
construit l'interface, synchronise `native/ios`, archive et envoie le build à
App Store Connect (numéro de build = numéro d'exécution du workflow).

Préalables, une fois :
1. compte Apple Developer (99 €/an) ; créer l'app `fr.danielbartcg.secondbrain`
   dans App Store Connect ;
2. clé d'API App Store Connect (rôle Admin, pour la signature automatique) ;
3. secrets du dépôt : `APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`,
   `ASC_KEY_P8_BASE64` (`base64 -w0 AuthKey_XXXX.p8`) ;
4. dans TestFlight, ajouter les testeurs (internes : immédiat ; externes :
   revue bêta d'Apple).

Sur un Mac, alternative manuelle : `npm ci`, `npm run ios:sync`,
`npm run ios:open`, puis Product → Archive dans Xcode.

## Sauvegardes

`ops/server/backup.sh` (cron quotidien 3h25 + `prod:backup`) produit
`db-<date>.dump` (pg_dump format custom) et `files-<date>.tar.gz`
(`data/uploads` + `data/documents`), rotation 14 jours. Copie hors-site
Backblaze possible si un profil rclone `b2` et `~/.config/secondbrain/backup.env`
existent (non configuré pour l'instant).

## Pièges connus

- Les commandes distantes sont encodées en base64 (`ops/lib/ssh.ts`) : pas
  d'échappement à gérer, et `docker compose run` ne peut pas avaler le reste du
  script.
- `data/uploads`, `data/documents` et `data/downloads` doivent exister **avant** le premier
  `docker compose up`, sinon Docker les crée en root et l'application
  (uid 1001) ne peut plus écrire. `provision.sh` et `deploy.ts` s'en chargent.
- Un fichier `.sh` modifié sous Windows doit rester en LF (`.gitattributes`).
- Le cache de build Docker est plafonné (`/etc/docker/daemon.json`, posé par
  le provisionnement de la boutique).
- Le contrôle de santé échoue tant que le DNS ne pointe pas sur le serveur ;
  les conteneurs tournent quand même (`curl http://localhost:3001` sur le VPS).
