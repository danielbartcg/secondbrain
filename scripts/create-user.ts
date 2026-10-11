/**
 * Crée (ou met à jour le mot de passe d')un utilisateur.
 *
 * Usage :
 *   npm run user:create -- --email=moi@exemple.fr --password=… --name="Daniel"
 * Production :
 *   npm run prod:exec -- "npx tsx scripts/create-user.ts --email=… --password=… --name=…"
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : undefined;
}

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  const password = arg("password");
  const name = arg("name")?.trim() || email?.split("@")[0] || "Utilisateur";
  if (!email || !password) {
    console.error("Usage : --email=… --password=… [--name=…]");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Mot de passe : 8 caractères minimum.");
    process.exit(1);
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, name },
    create: { email, passwordHash, name },
  });
  console.log(`Utilisateur prêt : ${user.email} (${user.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
