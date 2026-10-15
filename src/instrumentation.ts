/**
 * Démarrage du serveur Next (runtime Node) : lance l'envoyeur des copies
 * e-mail des notifications (src/lib/mailer.ts).
 *
 * Forme imposée par Next : la condition sur NEXT_RUNTIME est remplacée à la
 * compilation, ce qui retire l'import (nodemailer, modules node:) du build Edge.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startEmailWorker } = await import("./lib/mailer");
    startEmailWorker();
  }
}
