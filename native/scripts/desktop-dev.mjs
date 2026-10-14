// Développement de l'application desktop : serveur Vite (interface) + Electron qui le charge.
// Le serveur Next (npm run dev) doit tourner à part ; l'application s'y connecte (http://localhost:3000).
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const shell = process.platform === "win32";
const vite = spawn("npm", ["run", "native:dev"], { stdio: "inherit", shell });
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch("http://localhost:5173/")).ok) break;
  } catch {
    /* pas encore prêt */
  }
  await sleep(500);
}
const electron = spawn("npx", ["electron", "native/electron"], { stdio: "inherit", shell, env: { ...process.env, SB_DEV_URL: "http://localhost:5173" } });
electron.on("exit", (code) => {
  vite.kill();
  process.exit(code ?? 0);
});
