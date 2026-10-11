/**
 * Restaure une sauvegarde en production. Opération DESTRUCTRICE : elle écrase
 * la base actuelle, d'où la double exigence `--file` + `--yes`.
 *
 * Usage :
 *   npm run prod:restore -- --list
 *   npm run prod:restore -- --file=db-2026-09-12-0305.dump --yes
 *   npm run prod:restore -- --files=files-2026-09-12-0305.tar.gz --yes
 *
 * Une sauvegarde de sécurité est prise avant toute restauration (sauf
 * --skip-backup) : se tromper de fichier reste rattrapable.
 */
import { argFlag, argValue, loadConfig } from "./lib/config";
import { inRepo, shellQuote, sshCapture, sshOrDie } from "./lib/ssh";

const cfg = loadConfig();
const dbFile = argValue("file");
const filesArchive = argValue("files");

if (argFlag("list") || (!dbFile && !filesArchive)) {
  console.log(`=== Sauvegardes disponibles sur ${cfg.host} ===`);
  console.log(sshCapture(cfg, `ls -lht ${shellQuote(cfg.remoteBackupDir)} | head -30`));
  if (!argFlag("list")) {
    console.log(
      [
        "Indiquer la sauvegarde à restaurer :",
        "  npm run prod:restore -- --file=db-AAAA-MM-JJ-HHMM.dump --yes",
        "  npm run prod:restore -- --files=files-AAAA-MM-JJ-HHMM.tar.gz --yes",
      ].join("\n"),
    );
  }
  process.exit(0);
}

if (!argFlag("yes")) {
  console.error(
    [
      "✗ Restauration non confirmée.",
      `  Elle écrasera les données actuelles de ${cfg.domain}.`,
      "  Ajouter --yes pour confirmer.",
    ].join("\n"),
  );
  process.exit(1);
}

// --- Filet de sécurité -------------------------------------------------------
if (!argFlag("skip-backup")) {
  console.log("=== Sauvegarde de l'état actuel avant restauration ===");
  sshOrDie(
    cfg,
    inRepo(
      cfg,
      `BACKUP_DIR=${shellQuote(cfg.remoteBackupDir)} RETENTION_DAYS=${cfg.retentionDays} ` +
        `bash ops/server/backup.sh`,
    ),
  );
}

// --- Base de données ---------------------------------------------------------
if (dbFile) {
  const remote = `${cfg.remoteBackupDir}/${dbFile}`;
  console.log(`\n=== Restauration de la base depuis ${dbFile} ===`);
  sshOrDie(
    cfg,
    inRepo(
      cfg,
      [
        `test -f ${shellQuote(remote)} || { echo "Fichier introuvable : ${dbFile}"; exit 1; }`,
        // --clean --if-exists : on repart de l'état du dump, sans doublon.
        `docker compose exec -T db pg_restore -U secondbrain -d secondbrain --clean --if-exists --no-owner < ${shellQuote(remote)}`,
        `echo "Base restaurée."`,
      ].join("\n"),
    ),
  );
}

// --- Fichiers (uploads) ----------------------------------------------
if (filesArchive) {
  const remote = `${cfg.remoteBackupDir}/${filesArchive}`;
  console.log(`\n=== Restauration des fichiers depuis ${filesArchive} ===`);
  sshOrDie(
    cfg,
    inRepo(
      cfg,
      [
        `test -f ${shellQuote(remote)} || { echo "Fichier introuvable : ${filesArchive}"; exit 1; }`,
        `tar xzf ${shellQuote(remote)} -C data`,
        `echo "Fichiers restaurés dans data/."`,
      ].join("\n"),
    ),
  );
}

console.log("\n=== Redémarrage de l'application ===");
sshOrDie(cfg, inRepo(cfg, "docker compose restart app && docker compose ps"));
console.log(
  "\nRestauration terminée. Vérifier : npm run prod:status",
);
