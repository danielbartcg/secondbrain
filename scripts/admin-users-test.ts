/**
 * Tests de bout en bout : création de comptes et réinitialisation forcée du
 * mot de passe par un administrateur (POST /api/v1/admin/users et
 * POST /api/v1/admin/users/:id/password).
 *
 * Usage (serveur de dev lancé) :
 *   npx tsx scripts/admin-users-test.ts          # http://localhost:3000
 *   BASE_URL=http://localhost:3001 npx tsx scripts/admin-users-test.ts
 *
 * Crée des comptes jetables directement en base (sessions à jeton haché),
 * appelle l'API en Bearer, puis supprime tous les comptes créés.
 */
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const ORIGIN = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const BASE = ORIGIN + "/api/v1";
const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || "daniel.barral@outlook.com").trim().toLowerCase();
const prisma = new PrismaClient();

let failures = 0;
let passes = 0;
function check(name: string, cond: unknown, detail?: unknown) {
  if (cond) {
    passes++;
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail, null, 1).slice(0, 800));
  }
}
const tag = randomBytes(4).toString("hex");

type U = { id: string; email: string; token: string; name: string };
type Auth = { token: string } | null;

async function makeUser(label: string, opts: { admin?: boolean } = {}): Promise<U> {
  const email = `adm-${label.toLowerCase()}-${tag}@test.local`;
  const user = await prisma.user.create({
    data: { email, name: `${label} Test`, firstName: label, lastName: "Test", passwordHash: await bcrypt.hash("Password123!", 4), role: opts.admin ? "ADMIN" : "USER" },
  });
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({ data: { userId: user.id, token: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 86400_000), label: "admin-users-test" } });
  return { id: user.id, email, token, name: user.name };
}

async function call<T = Record<string, unknown>>(u: Auth, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(u ? { Authorization: `Bearer ${u.token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data: data as T };
}

async function login(email: string, password: string) {
  return call<{ token?: string; user?: { email: string } }>(null, "POST", "/auth/login", { email, password, client: "admin-users-test" });
}

type UsersResp = { users?: { id: string; email: string; role: string; managerId: string | null; emailVerified: boolean }[] };

async function main() {
  const A = await makeUser("Admin", { admin: true });
  const B = await makeUser("Bob");
  const createdIds: string[] = [A.id, B.id];
  const newEmail = `adm-new-${tag}@test.local`;
  const forced = `Forc3d-${randomBytes(6).toString("hex")}!`;

  try {
    console.log("\n1. Création de compte");
    let r = await call<UsersResp>(B, "POST", "/admin/users", { email: `adm-x-${tag}@test.local`, firstName: "X", lastName: "Y", password: forced });
    check("non-administrateur : création refusée (403)", r.status === 403, r);
    check("non-administrateur : aucun compte créé", (await prisma.user.count({ where: { email: `adm-x-${tag}@test.local` } })) === 0);

    r = await call<UsersResp>(A, "POST", "/admin/users", { email: `  ${newEmail.toUpperCase()} `, firstName: "Nina", lastName: "Nouvelle", password: forced, role: "USER", managerId: A.id });
    const created = r.data.users?.find((u) => u.email === newEmail);
    if (created) createdIds.push(created.id);
    check("administrateur : compte créé (201) et renvoyé dans la liste", r.status === 201 && !!created, r.status === 201 ? r.data.users?.length : r);
    check("e-mail normalisé, manager et rôle appliqués, adresse non validée", created?.role === "USER" && created?.managerId === A.id && created?.emailVerified === false, created);
    check("mot de passe jamais renvoyé", !JSON.stringify(r.data).includes(forced));

    const l1 = await login(newEmail, forced);
    check("le nouveau compte se connecte avec le mot de passe imposé", l1.status === 200 && !!l1.data.token, l1);

    r = await call<UsersResp>(A, "POST", "/admin/users", { email: newEmail, firstName: "Doublon", lastName: "", password: forced });
    check("e-mail déjà utilisé : 409", r.status === 409, r);

    r = await call<UsersResp>(A, "POST", "/admin/users", { email: SUPER_ADMIN_EMAIL, firstName: "Faux", lastName: "Super", password: forced });
    check("e-mail du super administrateur : 409", r.status === 409, r);

    r = await call<UsersResp>(A, "POST", "/admin/users", { email: `adm-short-${tag}@test.local`, firstName: "Court", lastName: "", password: "abc" });
    check("mot de passe trop court : 400", r.status === 400, r);
    r = await call<UsersResp>(A, "POST", "/admin/users", { email: `adm-long-${tag}@test.local`, firstName: "Long", lastName: "", password: "é".repeat(40) });
    check("mot de passe de plus de 72 octets : 400", r.status === 400, r);
    r = await call<UsersResp>(A, "POST", "/admin/users", { email: `adm-noname-${tag}@test.local`, firstName: "", lastName: "", password: forced });
    check("sans prénom ni nom : 400", r.status === 400, r);
    r = await call<UsersResp>(A, "POST", "/admin/users", { email: `adm-mgr-${tag}@test.local`, firstName: "Sans", lastName: "Manager", password: forced, managerId: "inexistant" });
    check("manager inexistant : 404", r.status === 404, r);
    check("aucun compte créé par les requêtes refusées", (await prisma.user.count({ where: { email: { in: [`adm-short-${tag}@test.local`, `adm-long-${tag}@test.local`, `adm-noname-${tag}@test.local`, `adm-mgr-${tag}@test.local`] } } })) === 0);

    console.log("\n2. Réinitialisation du mot de passe");
    const newUser = l1.data.token && created ? { id: created.id, email: newEmail, token: l1.data.token, name: "Nina Nouvelle" } : null;
    if (!newUser) throw new Error("Compte créé indisponible : tests de réinitialisation impossibles.");
    let me = await call(newUser, "GET", "/auth/me");
    check("session du compte créé valide avant réinitialisation", me.status === 200, me.status);

    const other = `R3set-${randomBytes(6).toString("hex")}!`;
    let p = await call(B, "POST", `/admin/users/${newUser.id}/password`, { password: other });
    check("non-administrateur : réinitialisation refusée (403)", p.status === 403, p);
    p = await call(A, "POST", `/admin/users/${newUser.id}/password`, { password: "short" });
    check("mot de passe trop court : 400", p.status === 400, p);
    p = await call(A, "POST", `/admin/users/inexistant/password`, { password: other });
    check("compte inexistant : 404", p.status === 404, p);

    p = await call<{ ok?: boolean }>(A, "POST", `/admin/users/${newUser.id}/password`, { password: other });
    check("administrateur : mot de passe imposé ({ ok: true })", p.status === 200 && (p.data as { ok?: boolean }).ok === true, p);
    me = await call(newUser, "GET", "/auth/me");
    check("anciennes sessions fermées (401)", me.status === 401, me.status);
    check("aucune session restante en base", (await prisma.session.count({ where: { userId: newUser.id } })) === 0);
    const lOld = await login(newEmail, forced);
    check("ancien mot de passe refusé", lOld.status === 401, lOld.status);
    const lNew = await login(newEmail, other);
    check("nouveau mot de passe accepté", lNew.status === 200 && !!lNew.data.token, lNew);
  } finally {
    await prisma.user.deleteMany({ where: { OR: [{ id: { in: createdIds } }, { email: { endsWith: `-${tag}@test.local` } }] } });
    await prisma.$disconnect();
  }

  console.log(`\n${passes} réussi(s), ${failures} échec(s)`);
  if (failures > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
