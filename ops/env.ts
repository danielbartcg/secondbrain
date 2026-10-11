/**
 * Lecture et modification du fichier .env de production.
 *
 * Usage :
 *   npm run prod:env                                   (liste, secrets masqués)
 *   npm run prod:env -- --set STRIPE_SECRET_KEY=sk_live_…
 *   npm run prod:env -- --set SMTP_HOST=smtp-relay.brevo.com --set SMTP_PORT=587
 *   npm run prod:env -- --set PAYPAL_ENVIRONMENT=live --restart
 *
 * Rappel (docs/13-security.md) : ces valeurs sont des secrets serveur. Elles ne
 * transitent jamais par la ligne de commande distante (écriture par stdin) et
 * le fichier reste en mode 600.
 */
import { argFlag, loadConfig } from "./lib/config";
import { inRepo, shellQuote, sshCapture, sshOrDie, writeRemoteFile } from "./lib/ssh";

const cfg = loadConfig();
const envPath = `${cfg.dir}/.env`;
const SECRET_PATTERN = /SECRET|PASSWORD|KEY|TOKEN|DATABASE_URL/i;

/** `--set CLE=valeur` peut être répété ; la valeur peut contenir des espaces. */
function parseSets(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    let pair: string | null = null;
    if (argv[i] === "--set" && argv[i + 1]) pair = argv[++i];
    else if (argv[i].startsWith("--set=")) pair = argv[i].slice("--set=".length);
    if (!pair) continue;

    const eq = pair.indexOf("=");
    if (eq <= 0) {
      console.error(`--set attend CLE=valeur (reçu : ${pair}).`);
      process.exit(1);
    }
    out.push([pair.slice(0, eq).trim(), pair.slice(eq + 1)]);
  }
  return out;
}

const sets = parseSets();
const current = sshCapture(cfg, `cat ${shellQuote(envPath)}`);

if (sets.length === 0) {
  console.log(`=== ${envPath} ===`);
  for (const line of current.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (!line.trim() || line.trim().startsWith("#") || eq === -1) {
      console.log(line);
      continue;
    }
    const key = line.slice(0, eq);
    const raw = line.slice(eq + 1).replace(/^"|"$/g, "");
    const value = !raw
      ? "(vide)"
      : SECRET_PATTERN.test(key)
        ? `${raw.slice(0, 4)}… (${raw.length} caractères)`
        : raw;
    console.log(`${key}=${value}`);
  }
  process.exit(0);
}

// --- Écriture ----------------------------------------------------------------
const lines = current.split(/\r?\n/);
for (const [key, value] of sets) {
  const escaped = value.replace(/"/g, '\\"');
  const index = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (index === -1) lines.push(`${key}="${escaped}"`);
  else lines[index] = `${key}="${escaped}"`;
  console.log(`${key} ${SECRET_PATTERN.test(key) ? "(secret) " : ""}→ mis à jour`);
}

writeRemoteFile(cfg, envPath, lines.join("\n").replace(/\n+$/, "\n"), { mode: "600" });

if (argFlag("restart")) {
  console.log("\nRedémarrage des conteneurs pour appliquer les nouvelles valeurs…");
  sshOrDie(cfg, inRepo(cfg, "docker compose up -d"));
} else {
  console.log(
    "\nValeurs enregistrées. Elles ne seront actives qu'après redémarrage :\n" +
      "  npm run prod:env -- --restart   (ou npm run prod:deploy)",
  );
}
