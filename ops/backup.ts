/**
 * Déclenche une sauvegarde immédiate de la production.
 *
 * Usage :
 *   npm run prod:backup
 *   npm run prod:backup -- --pull        (puis rapatriement sur le poste local)
 *
 * Produit un dump PostgreSQL + une archive des uploads, puis applique la rotation.
 * Le détail est dans ops/server/backup.sh.
 */
import { spawnSync } from "node:child_process";
import { argFlag, loadConfig, REPO_ROOT } from "./lib/config";
import { inRepo, shellQuote, sshOrDie } from "./lib/ssh";

const cfg = loadConfig();

sshOrDie(
  cfg,
  inRepo(
    cfg,
    `BACKUP_DIR=${shellQuote(cfg.remoteBackupDir)} RETENTION_DAYS=${cfg.retentionDays} ` +
      `bash ops/server/backup.sh`,
  ),
);

if (argFlag("pull")) {
  console.log();
  const r = spawnSync("npx", ["tsx", "ops/backup-pull.ts"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  process.exit(r.status ?? 0);
}
