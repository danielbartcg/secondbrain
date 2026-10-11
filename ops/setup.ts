/**
 * Provisionne l'application sur le VPS (idempotent : relançable sans risque).
 *
 * Usage : npm run prod:setup
 *
 * Le serveur peut déjà héberger d'autres applications (boutique TCG…) : le
 * script n'installe que ce qui manque (Docker, Caddy, utilisateur…) et ajoute
 * un site Caddy + un dépôt + un .env propres à Second Brain.
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig, REPO_ROOT } from "./lib/config";
import { shellQuote, sshOrDie, writeRemoteFile } from "./lib/ssh";

const cfg = loadConfig();

if (!cfg.repo) {
  console.error(".env.deploy : PROD_REPO est obligatoire (URL du dépôt git que le serveur va cloner).");
  process.exit(1);
}

const provision = fs.readFileSync(path.join(REPO_ROOT, "ops", "server", "provision.sh"), "utf8");

console.log(`Provisionnement de ${cfg.host} (${cfg.domain}) en tant que ${cfg.setupUser}…`);

writeRemoteFile(cfg, "/tmp/provision-secondbrain.sh", provision, { mode: "700", user: cfg.setupUser });

const vars = [
  `DEPLOY_USER=${shellQuote(cfg.user)}`,
  `APP_DIR=${shellQuote(cfg.dir)}`,
  `REPO_URL=${shellQuote(cfg.repo)}`,
  `BRANCH=${shellQuote(cfg.branch)}`,
  `DOMAIN=${shellQuote(cfg.domain)}`,
  `BACKUP_DIR=${shellQuote(cfg.remoteBackupDir)}`,
  `RETENTION_DAYS=${cfg.retentionDays}`,
  `APP_PORT=${shellQuote(cfg.appPort)}`,
  `APP_SLUG=${shellQuote(cfg.shopSlug)}`,
].join(" ");

const asRoot = cfg.setupUser === "root" ? "" : "sudo ";
sshOrDie(cfg, `${asRoot}${vars} bash /tmp/provision-secondbrain.sh`, { user: cfg.setupUser });

console.log(
  [
    "",
    "Serveur prêt. Suite :",
    `  1. vérifier que le DNS de ${cfg.domain} pointe bien sur ${cfg.host}`,
    "  2. npm run prod:deploy          (build + migrations + démarrage)",
    '  3. npm run prod:exec -- "npx tsx scripts/create-user.ts --email=… --password=… --name=…"',
  ].join("\n"),
);
