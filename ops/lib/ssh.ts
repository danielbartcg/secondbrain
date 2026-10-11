/**
 * Couche SSH des scripts d'exploitation.
 *
 * Principes :
 *  - aucune dépendance npm : on appelle les binaires `ssh` / `scp` du système
 *    (présents sur Windows 10+, macOS et Linux) ;
 *  - les commandes distantes non triviales sont transmises encodées en base64
 *    puis décodées côté serveur : pas de guillemets à échapper, et le shell
 *    local (PowerShell ou bash) n'interprète rien ;
 *  - `StrictHostKeyChecking=accept-new` : la première connexion ne bloque pas
 *    sur une question interactive, mais un changement d'empreinte reste une
 *    erreur (protection contre l'usurpation du serveur).
 */
import { spawnSync } from "node:child_process";
import type { DeployConfig } from "./config";

type Target = { user?: string };

function sshArgs(cfg: DeployConfig, target: Target = {}, noStdin = false): string[] {
  const args = [
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=15",
    "-p",
    cfg.port,
  ];
  // `-n` : entrée standard redirigée depuis /dev/null. Indispensable pour les
  // commandes contenant un `docker compose run/exec`, qui s'attachent à stdin
  // et consommeraient sinon ce qui leur est envoyé.
  if (noStdin) args.push("-n");
  if (cfg.keyFile) args.push("-i", cfg.keyFile);
  args.push(`${target.user ?? cfg.user}@${cfg.host}`);
  return args;
}

/**
 * Enveloppe une commande pour exécution distante.
 *
 * `eval "$(… | base64 -d)"` et NON `… | bash -s` : avec `bash -s`, le shell
 * distant lit son script sur l'entrée standard. Toute commande du script qui
 * lit elle aussi stdin — `docker compose run` en tête — avale alors les lignes
 * suivantes, qui ne sont jamais exécutées. Le déploiement se terminait ainsi
 * « sans erreur » en ayant sauté sa seconde moitié.
 */
function wrap(command: string): string {
  return `eval "$(echo ${encode(command)} | base64 -d)"`;
}

function encode(command: string): string {
  return Buffer.from(command, "utf8").toString("base64");
}

/**
 * Exécute une commande sur le serveur, sortie affichée en direct.
 * Retourne le code de sortie.
 */
export function ssh(cfg: DeployConfig, command: string, target: Target = {}): number {
  const result = spawnSync("ssh", [...sshArgs(cfg, target, true), wrap(command)], {
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    console.error(`Échec de l'appel ssh : ${result.error.message}`);
    process.exit(1);
  }
  return result.status ?? 1;
}

/** Idem, mais interrompt le script si la commande échoue. */
export function sshOrDie(cfg: DeployConfig, command: string, target: Target = {}): void {
  const code = ssh(cfg, command, target);
  if (code !== 0) {
    console.error(`\nCommande distante en échec (code ${code}). Arrêt.`);
    process.exit(code);
  }
}

/** Exécute une commande et retourne sa sortie standard (sans l'afficher). */
export function sshCapture(cfg: DeployConfig, command: string, target: Target = {}): string {
  const result = spawnSync("ssh", [...sshArgs(cfg, target, true), wrap(command)], {
    encoding: "utf8",
    shell: false,
  });
  if (result.error) {
    console.error(`Échec de l'appel ssh : ${result.error.message}`);
    process.exit(1);
  }
  if ((result.status ?? 1) !== 0) {
    console.error(result.stderr?.trim() || `Commande distante en échec (code ${result.status}).`);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

/**
 * Écrit un contenu dans un fichier distant via l'entrée standard.
 * Le contenu ne transite jamais par la ligne de commande : il n'apparaît donc
 * pas dans la liste des processus du serveur (important pour les secrets).
 */
export function writeRemoteFile(
  cfg: DeployConfig,
  remotePath: string,
  content: string,
  options: { mode?: string; sudo?: boolean } & Target = {},
): void {
  const { mode, user, sudo } = options;
  // `sudo` : nécessaire quand le compte de connexion n'est pas root et que la
  // destination lui est interdite (`tee` plutôt que `>`, la redirection étant
  // évaluée par le shell appelant, sans privilège).
  const as = sudo ? "sudo " : "";
  const command = [
    `${as}mkdir -p "$(dirname ${shellQuote(remotePath)})"`,
    `${as}tee ${shellQuote(remotePath)} > /dev/null`,
    mode ? `${as}chmod ${mode} ${shellQuote(remotePath)}` : null,
  ]
    .filter(Boolean)
    .join(" && ");

  const result = spawnSync("ssh", [...sshArgs(cfg, { user }), wrap(command)], {
    input: content,
    stdio: ["pipe", "inherit", "inherit"],
    shell: false,
  });
  if (result.error || (result.status ?? 1) !== 0) {
    console.error(`Écriture distante impossible : ${remotePath}`);
    process.exit(result.status ?? 1);
  }
}

/** Rapatrie un fichier du serveur vers le poste local. */
export function scpDownload(cfg: DeployConfig, remotePath: string, localPath: string): void {
  const args = [
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-P",
    cfg.port,
  ];
  if (cfg.keyFile) args.push("-i", cfg.keyFile);
  args.push(`${cfg.user}@${cfg.host}:${remotePath}`, localPath);

  const result = spawnSync("scp", args, { stdio: "inherit", shell: false });
  if (result.error || (result.status ?? 1) !== 0) {
    console.error(`Téléchargement impossible : ${remotePath}`);
    process.exit(result.status ?? 1);
  }
}

/** Échappe une valeur pour un shell POSIX (guillemets simples). */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Préfixe usuel : se placer dans le dépôt de l'application. */
export function inRepo(cfg: DeployConfig, command: string): string {
  return `set -euo pipefail\ncd ${shellQuote(cfg.dir)}\n${command}`;
}
