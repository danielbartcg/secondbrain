/**
 * Publie l'installateur Windows de l'application desktop sur le serveur :
 * il devient téléchargeable sur https://<domaine>/app (et /downloads/…).
 *
 * Usage :
 *   npm run desktop:build      (produit native/release/SecondBrain-Setup-<version>.exe)
 *   npm run desktop:publish
 *
 * Écrit DATA_DIR/downloads/<installateur> et DATA_DIR/downloads/latest.json
 * (version, taille, empreinte SHA-256, date). Les deux versions précédentes
 * sont conservées, les plus anciennes supprimées.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, loadConfig } from "./lib/config";
import { scpUpload, shellQuote, sshOrDie, writeRemoteFile } from "./lib/ssh";

const cfg = loadConfig();
const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "native/electron/package.json"), "utf8")) as { version: string };
const file = `SecondBrain-Setup-${pkg.version}.exe`;
const local = path.join(REPO_ROOT, "native/release", file);
if (!fs.existsSync(local)) {
  console.error(`Installateur introuvable : ${local}\nLancer d'abord : npm run desktop:build`);
  process.exit(1);
}
const buf = fs.readFileSync(local);
const meta = {
  platform: "windows",
  version: pkg.version,
  file,
  size: buf.length,
  sha256: crypto.createHash("sha256").update(buf).digest("hex"),
  publishedAt: new Date().toISOString(),
};
const dir = `${cfg.dir}/data/downloads`;

console.log(`Publication de ${file} (${(buf.length / 1024 / 1024).toFixed(1)} Mo) sur ${cfg.host}…`);
sshOrDie(cfg, `mkdir -p ${shellQuote(dir)} && sudo chown ${cfg.user} ${shellQuote(dir)}`);
scpUpload(cfg, local, `${dir}/${file}.part`);
writeRemoteFile(cfg, `${dir}/latest.json.part`, JSON.stringify(meta, null, 2) + "\n");
sshOrDie(
  cfg,
  [
    `cd ${shellQuote(dir)}`,
    `mv -f ${shellQuote(file + ".part")} ${shellQuote(file)}`,
    `mv -f latest.json.part latest.json`,
    // Garder les trois installateurs les plus récents.
    `ls -1t SecondBrain-Setup-*.exe 2>/dev/null | tail -n +4 | xargs -r rm -f`,
    `sudo chown -R 1001:1001 .`,
    `ls -lh`,
  ].join(" && "),
);
console.log(`\n✓ Publié : https://${cfg.domain}/app`);
