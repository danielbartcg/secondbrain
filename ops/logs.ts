/**
 * Journaux applicatifs de la production.
 *
 * Usage :
 *   npm run prod:logs
 *   npm run prod:logs -- --tail=500
 *   npm run prod:logs -- --service=db
 *   npm run prod:logs -- --follow          (Ctrl+C pour sortir)
 */
import { argFlag, argValue, loadConfig } from "./lib/config";
import { inRepo, shellQuote, ssh } from "./lib/ssh";

const cfg = loadConfig();
const tail = argValue("tail") ?? "200";
const service = argValue("service") ?? "app";
const follow = argFlag("follow");

if (!/^\d+$/.test(tail)) {
  console.error("--tail attend un nombre de lignes.");
  process.exit(1);
}

process.exit(
  ssh(
    cfg,
    inRepo(
      cfg,
      `docker compose logs --tail=${tail}${follow ? " --follow" : ""} ${shellQuote(service)}`,
    ),
  ),
);
