/**
 * Mise en production : sauvegarde, récupération du code, rebuild, migrations,
 * contrôle de santé.
 *
 * Usage :
 *   npm run prod:deploy
 *   npm run prod:deploy -- --skip-backup      (sans sauvegarde préalable)
 *   npm run prod:deploy -- --force            (malgré des commits non poussés)
 *
 * Le serveur récupère le code depuis GitHub : tout commit non poussé ne partira
 * PAS en production — d'où le contrôle préalable.
 */
import { spawnSync } from "node:child_process";
import { argFlag, loadConfig, REPO_ROOT } from "./lib/config";
import { inRepo, shellQuote, ssh, sshOrDie } from "./lib/ssh";

const cfg = loadConfig();
const skipBackup = argFlag("skip-backup");
const force = argFlag("force");

function git(...args: string[]): string {
  const r = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  return (r.stdout ?? "").trim();
}

// --- Contrôles locaux --------------------------------------------------------
const dirty = git("status", "--porcelain");
if (dirty) {
  console.warn(
    "⚠ Modifications locales non commitées, elles ne seront pas déployées :\n" +
      dirty.split("\n").map((l) => "   " + l).join("\n"),
  );
}

git("fetch", "origin", cfg.branch);
const local = git("rev-parse", "HEAD");
const remote = git("rev-parse", `origin/${cfg.branch}`);
if (local && remote && local !== remote) {
  const ahead = git("rev-list", "--count", `origin/${cfg.branch}..HEAD`);
  if (Number(ahead) > 0 && !force) {
    console.error(
      [
        `✗ ${ahead} commit(s) local(aux) non poussé(s) sur origin/${cfg.branch}.`,
        "  Le serveur déploierait une version ancienne.",
        `  → git push origin ${cfg.branch}   (ou relancer avec --force)`,
      ].join("\n"),
    );
    process.exit(1);
  }
}

// --- Application desktop à republier ? ---------------------------------------
// Les écrans de l'application desktop sont embarqués : toute modification
// d'écran depuis la dernière version (native/electron/package.json) exige une
// nouvelle version publiée, sinon l'updater ne voit aucun écart.
{
  const bump = git("log", "-1", "--format=%H", "-G\"version\"", "--", "native/electron/package.json");
  const screens = bump ? git("diff", "--name-only", `${bump}..HEAD`, "--", "src/components", "src/lib/shared", "src/lib/client.ts", "src/app/globals.css", "native/src") : "";
  if (screens) {
    console.warn(
      [
        "⚠ Écrans modifiés depuis la dernière version de l'application desktop :",
        ...screens.split("\n").slice(0, 15).map((l) => "   " + l),
        "  → incrémenter native/electron/package.json, npm run desktop:build puis npm run desktop:publish",
        "    (sinon l'application installée garde les anciens écrans et ne propose pas de mise à jour).",
      ].join("\n"),
    );
  }
}

// --- Sauvegarde préalable ----------------------------------------------------
if (!skipBackup) {
  console.log("=== Sauvegarde préalable ===");
  const code = ssh(
    cfg,
    inRepo(
      cfg,
      `if docker compose ps --status running db | grep -q db; then ` +
        `BACKUP_DIR=${shellQuote(cfg.remoteBackupDir)} RETENTION_DAYS=${cfg.retentionDays} bash ops/server/backup.sh; ` +
        `else echo "Base non démarrée : pas de sauvegarde (premier déploiement)."; fi`,
    ),
  );
  if (code !== 0) {
    console.error("La sauvegarde a échoué, déploiement interrompu.\nRelancer avec --skip-backup pour passer outre.");
    process.exit(code);
  }
}

// --- Déploiement -------------------------------------------------------------
console.log("\n=== Récupération du code et rebuild ===");
sshOrDie(
  cfg,
  inRepo(
    cfg,
    [
      `git fetch --prune origin ${shellQuote(cfg.branch)}`,
      `git checkout ${shellQuote(cfg.branch)}`,
      `git pull --ff-only origin ${shellQuote(cfg.branch)}`,
      `echo "Version déployée : $(git rev-parse --short HEAD), $(git log -1 --pretty=%s)"`,
      `docker compose --profile tools build`,
      `docker compose up -d db`,
      // Migrations AVANT de basculer l'application.
      `docker compose run --rm tools node node_modules/prisma/build/index.js migrate deploy`,
      `mkdir -p data/uploads data/documents data/downloads`,
      `sudo chown -R 1001:1001 data`,
      `docker compose up -d --build --force-recreate --no-deps app`,
      `docker compose ps`,
    ].join("\n"),
  ),
);

// --- Contrôle de santé -------------------------------------------------------
async function healthcheck(): Promise<void> {
  const url = `https://${cfg.domain}/`;
  console.log(`\n=== Contrôle de santé : ${url} ===`);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
      if (res.status < 500) {
        console.log(`✓ Réponse HTTP ${res.status}`);
        console.log("\nMise en production terminée.");
        return;
      }
      console.log(`… HTTP ${res.status}, nouvelle tentative`);
    } catch (e) {
      console.log(`… pas encore de réponse (${(e as Error).message})`);
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  console.error(
    [
      "✗ Le site ne répond pas après 2 minutes.",
      "  Diagnostic : npm run prod:logs",
      "  (DNS non propagé, certificat en cours d'émission ou erreur au démarrage)",
    ].join("\n"),
  );
  process.exit(1);
}

healthcheck();
