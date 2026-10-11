/**
 * Rapatrie une sauvegarde de production sur le poste local.
 *
 * Usage :
 *   npm run prod:backup:pull                        (les plus récentes)
 *   npm run prod:backup:pull -- --file=db-2026-09-12-0305.dump
 *   npm run prod:backup:pull -- --list
 *
 * Destination : répertoire `backups/` à la racine (gitignoré).
 */
import fs from "node:fs";
import path from "node:path";
import { argFlag, argValue, loadConfig } from "./lib/config";
import { scpDownload, shellQuote, sshCapture } from "./lib/ssh";

const cfg = loadConfig();
const dir = shellQuote(cfg.remoteBackupDir);

if (argFlag("list")) {
  console.log(sshCapture(cfg, `ls -lht ${dir} | head -30`));
  process.exit(0);
}

/** Dernier fichier correspondant au motif, ou null. */
function latest(pattern: string): string | null {
  const out = sshCapture(cfg, `ls -1t ${dir}/${pattern} 2>/dev/null | head -1`).trim();
  return out || null;
}

const explicit = argValue("file");
const targets = explicit
  ? [`${cfg.remoteBackupDir}/${explicit}`]
  : [latest("db-*.dump"), latest("files-*.tar.gz")].filter((f): f is string => Boolean(f));

if (targets.length === 0) {
  console.error(
    `Aucune sauvegarde trouvée dans ${cfg.remoteBackupDir}.\n` +
      "Lancer d'abord : npm run prod:backup",
  );
  process.exit(1);
}

fs.mkdirSync(cfg.localBackupDir, { recursive: true });

for (const remote of targets) {
  const local = path.join(cfg.localBackupDir, path.posix.basename(remote));
  console.log(`↓ ${remote}`);
  scpDownload(cfg, remote, local);
  const size = (fs.statSync(local).size / 1024 / 1024).toFixed(1);
  console.log(`  ${local} (${size} Mo)`);
}

console.log(`\nSauvegardes disponibles dans ${cfg.localBackupDir}`);
