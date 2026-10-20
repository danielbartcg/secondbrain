/**
 * Génère `src/lib/generated/lucide-icons.json` : nom → éléments SVG (sans les
 * clés React) de toutes les icônes Lucide installées. Un seul module chargé
 * à la demande par l'interface (au lieu d'un module par icône : compilation
 * et application légères). À relancer après une mise à jour de lucide-react :
 *   npm run icons:build
 */
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = join(process.cwd(), "node_modules/lucide-react/dist/esm/icons");
const files = readdirSync(dir).filter((f) => f.endsWith(".mjs"));
const out = {};
for (const f of files.sort()) {
  const mod = await import(pathToFileURL(join(dir, f)).href);
  const data = mod.__iconData;
  if (!data?.name || !Array.isArray(data.node)) continue;
  out[data.name] = data.node.map(([tag, attrs]) => {
    const { key: _k, ...rest } = attrs;
    return [tag, rest];
  });
}
writeFileSync(join(process.cwd(), "src/lib/generated/lucide-icons.json"), JSON.stringify(out));
console.log(`${Object.keys(out).length} icônes`);
