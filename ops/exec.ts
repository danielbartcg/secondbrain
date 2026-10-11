/**
 * Exécute une commande sur Second Brain en production.
 *
 * Par défaut dans un conteneur **jetable** bâti sur l'étage `builder` (service
 * `tools`) : c'est le seul à disposer de l'arbre npm complet — CLI Prisma, tsx
 * et `scripts/`. L'image applicative, en sortie standalone, ne contient que le
 * strict nécessaire pour servir les pages.
 *
 * Usage :
 *   npm run prod:exec -- "npx tsx scripts/create-user.ts --email=… --password=… --name=…"
 *   npm run prod:exec -- "npx prisma migrate status"
 *   npm run prod:exec -- --service=db "psql -U secondbrain secondbrain -c '\\dt'"
 *   npm run prod:exec -- --service=app "ls -la /app/data"
 *
 * `--service=app` / `--service=db` visent le conteneur **en cours d'exécution**
 * (`docker compose exec`), pour inspecter l'existant.
 *
 * La commande est transmise encodée : guillemets, accents et `$` passent tels
 * quels, sans réinterprétation par le shell local ni par celui du serveur.
 */
import { argValue, loadConfig } from "./lib/config";
import { inRepo, shellQuote, ssh } from "./lib/ssh";

const cfg = loadConfig();
const service = argValue("service") ?? "tools";
// `tools` : conteneur jetable bâti à la demande (docker compose run --rm).
// `app` / `db` : conteneur déjà en cours d'exécution (docker compose exec -T).
const disposable = service === "tools";

const command = process.argv.slice(2).filter((a) => !a.startsWith("--")).join(" ");
if (!command) {
  console.error(
    'Usage : npm run prod:exec -- "npx tsx scripts/create-user.ts --email=… --password=… --name=…"',
  );
  process.exit(1);
}

const encoded = Buffer.from(command, "utf8").toString("base64");

console.log(`[${cfg.domain} / ${service}] ${command}`);
process.exit(
  ssh(
    cfg,
    inRepo(
      cfg,
      disposable
        ? `docker compose run --rm ${shellQuote(service)} sh -c "$(echo ${encoded} | base64 -d)"`
        : `docker compose exec -T ${shellQuote(service)} sh -c "$(echo ${encoded} | base64 -d)"`,
    ),
  ),
);
