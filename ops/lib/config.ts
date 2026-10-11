/**
 * Configuration des opérations de production.
 *
 * Tout est lu dans `.env.deploy` à la racine du dépôt (fichier gitignoré :
 * il contient l'adresse du serveur et, le cas échéant, les clés B2).
 * Voir `.env.deploy.example` et docs/10-deployment.md.
 */
import fs from "node:fs";
import path from "node:path";

/** Racine du dépôt : les scripts sont toujours lancés via npm, donc depuis la racine. */
export const REPO_ROOT = path.resolve(process.cwd());
const CONFIG_FILE = path.join(REPO_ROOT, ".env.deploy");

export type DeployConfig = {
  /** IP ou nom d'hôte du VPS */
  host: string;
  /** Utilisateur applicatif (non root) */
  user: string;
  /** Utilisateur utilisé pour le provisionnement initial (root en général) */
  setupUser: string;
  port: string;
  /** Chemin de la clé privée SSH ; vide = configuration ssh par défaut */
  keyFile: string | null;
  /** Répertoire du dépôt sur le serveur */
  dir: string;
  /** Domaine public, utilisé pour le contrôle de santé et Caddy */
  domain: string;
  /** Dépôt git cloné par `prod:setup` */
  repo: string;
  branch: string;
  /** Répertoire des sauvegardes sur le serveur */
  remoteBackupDir: string;
  /** Répertoire local de rapatriement des sauvegardes */
  localBackupDir: string;
  retentionDays: number;
  /** Port local de l'application ; distinct par boutique sur un serveur partagé. */
  appPort: string;
  /** Cache catalogue, mutualisable entre boutiques du même serveur. */
  cacheDir: string;
  /** Nom court : distingue les fichiers système (cron, site Caddy). */
  shopSlug: string;
  b2: { bucket: string; keyId: string; appKey: string } | null;
};

/** Parseur minimal de fichier .env (pas de dépendance supplémentaire). */
function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function readDeployEnv(): Record<string, string> {
  if (!fs.existsSync(CONFIG_FILE)) {
    console.error(
      [
        "Fichier .env.deploy introuvable.",
        "",
        "Créez-le à partir du modèle :",
        "  cp .env.deploy.example .env.deploy",
        "puis renseignez au minimum PROD_HOST et PROD_DOMAIN.",
      ].join("\n"),
    );
    process.exit(1);
  }
  return parseEnvFile(fs.readFileSync(CONFIG_FILE, "utf8"));
}

export function loadConfig(): DeployConfig {
  const env = readDeployEnv();
  const required = (key: string): string => {
    const value = env[key];
    if (!value) {
      console.error(`.env.deploy : la variable ${key} est obligatoire.`);
      process.exit(1);
    }
    return value;
  };

  const user = env.PROD_USER || "deploy";
  const b2Bucket = env.B2_BUCKET || "";
  const b2KeyId = env.B2_KEY_ID || "";
  const b2AppKey = env.B2_APP_KEY || "";

  return {
    host: required("PROD_HOST"),
    user,
    setupUser: env.PROD_SETUP_USER || "root",
    port: env.PROD_PORT || "22",
    keyFile: env.PROD_SSH_KEY || null,
    dir: env.PROD_DIR || `/home/${user}/boutique`,
    domain: required("PROD_DOMAIN"),
    repo: env.PROD_REPO || "",
    branch: env.PROD_BRANCH || "main",
    remoteBackupDir: env.PROD_BACKUP_DIR || `/home/${user}/backups`,
    localBackupDir: path.resolve(REPO_ROOT, env.BACKUP_LOCAL_DIR || "backups"),
    retentionDays: Number(env.BACKUP_RETENTION_DAYS || "14"),
    appPort: env.APP_PORT || "3000",
    cacheDir: env.CACHE_DIR || "/srv/tcg/cache",
    shopSlug: env.SHOP_SLUG || (env.PROD_DIR || "boutique").split("/").filter(Boolean).pop()!,
    b2: b2Bucket && b2KeyId && b2AppKey ? { bucket: b2Bucket, keyId: b2KeyId, appKey: b2AppKey } : null,
  };
}

/** Récupère la valeur d'un argument `--nom=valeur` de la ligne de commande. */
export function argValue(name: string): string | null {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : null;
}

/** Vrai si le drapeau `--nom` est présent. */
export function argFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
