/**
 * État de la production en une commande : conteneurs, ressources, dernières
 * sauvegardes, réponse HTTP publique.
 *
 * Usage : npm run prod:status
 */
import { loadConfig } from "./lib/config";
import { inRepo, shellQuote, sshOrDie } from "./lib/ssh";

const cfg = loadConfig();

console.log(`=== ${cfg.host} (${cfg.domain}) ===`);

sshOrDie(
  cfg,
  inRepo(
    cfg,
    [
      `echo "[ Système ]"`,
      `uptime`,
      `free -h | head -2`,
      `df -h / | tail -1`,
      `echo`,
      `echo "[ Conteneurs ]"`,
      `docker compose ps`,
      `echo`,
      `echo "[ Volume de données ]"`,
      `du -sh data 2>/dev/null || true`,
      `echo`,
      `echo "[ Dernières sauvegardes ]"`,
      `ls -lht ${shellQuote(cfg.remoteBackupDir)} 2>/dev/null | head -6 || echo "aucune"`,
      `echo`,
      `echo "[ Version déployée ]"`,
      `git log -1 --pretty="%h %ad %s" --date=short`,
    ].join("\n"),
  ),
);

async function ping(): Promise<void> {
  const url = `https://${cfg.domain}/`;
  const started = Date.now();
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
    console.log(`\n[ Site public ]\n${url} → HTTP ${res.status} en ${Date.now() - started} ms`);
  } catch (e) {
    console.error(`\n[ Site public ]\n${url} → INJOIGNABLE (${(e as Error).message})`);
    process.exitCode = 1;
  }
}

ping();
