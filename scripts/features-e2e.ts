/**
 * Tests de bout en bout : notifications par e-mail (Administration →
 * Notifications), e-mails de compte (bienvenue / validation, mot de passe
 * oublié, changement d'adresse), messagerie interne et connecteur MCP.
 *
 * Usage (serveur de dev lancé) :
 *   npm run test:features                       # http://localhost:3000
 *
 * Démarre un faux serveur SMTP local (port 2526) qui capture les e-mails,
 * crée des comptes jetables directement en base, puis nettoie tout (comptes,
 * conversations, paramètres SMTP d'origine restaurés).
 */
import { createHash, randomBytes } from "node:crypto";
import net from "node:net";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const ORIGIN = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const BASE = ORIGIN + "/api/v1";
const SMTP_PORT = 2526;
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tag = randomBytes(4).toString("hex");

// --- Faux serveur SMTP ------------------------------------------------------------------------
type Mail = { to: string[]; raw: string; text: string };
const inbox: Mail[] = [];

function decodeQP(s: string) {
  return s.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function startSmtp(): Promise<net.Server> {
  const server = net.createServer((sock) => {
    let buf = "";
    let inData = false;
    let current: Mail = { to: [], raw: "", text: "" };
    sock.write("220 test-smtp ESMTP\r\n");
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      for (;;) {
        if (inData) {
          const end = buf.indexOf("\r\n.\r\n");
          if (end === -1) return;
          current.raw = buf.slice(0, end);
          current.text = decodeQP(current.raw);
          inbox.push(current);
          current = { to: [], raw: "", text: "" };
          buf = buf.slice(end + 5);
          inData = false;
          sock.write("250 OK queued\r\n");
          continue;
        }
        const nl = buf.indexOf("\r\n");
        if (nl === -1) return;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO") sock.write("250-test-smtp\r\n250 8BITMIME\r\n");
        else if (cmd === "HELO") sock.write("250 test-smtp\r\n");
        else if (cmd === "MAIL") sock.write("250 OK\r\n");
        else if (cmd === "RCPT") {
          current.to.push((/<([^>]+)>/.exec(line)?.[1] ?? "").toLowerCase());
          sock.write("250 OK\r\n");
        } else if (cmd === "DATA") {
          inData = true;
          sock.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (cmd === "QUIT") {
          sock.write("221 Bye\r\n");
          sock.end();
        } else sock.write("250 OK\r\n");
      }
    });
    sock.on("error", () => {});
  });
  return new Promise((resolve) => server.listen(SMTP_PORT, "127.0.0.1", () => resolve(server)));
}

async function waitMail(to: string, pred: (m: Mail) => boolean = () => true, timeoutMs = 30_000): Promise<Mail | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const m = inbox.find((x) => x.to.includes(to.toLowerCase()) && pred(x));
    if (m) return m;
    await sleep(300);
  }
  return null;
}

const linkToken = (m: Mail | null, path: string) => (m ? new RegExp(`${path}\\?token=([A-Za-z0-9_-]+)`).exec(m.text)?.[1] ?? null : null);

// --- Comptes et appels ------------------------------------------------------------------------
type U = { id: string; email: string; token: string; name: string };

async function makeUser(label: string, opts: { admin?: boolean; password?: string } = {}): Promise<U> {
  const email = `feat-${label.toLowerCase()}-${tag}@test.local`;
  const user = await prisma.user.create({
    data: { email, name: `${label} Test`, firstName: label, lastName: "Test", passwordHash: await bcrypt.hash(opts.password ?? "Password123!", 4), role: opts.admin ? "ADMIN" : "USER" },
  });
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({ data: { userId: user.id, token: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 86400_000), label: "features-e2e" } });
  return { id: user.id, email, token, name: user.name };
}

async function call<T = Record<string, unknown>>(u: U | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: T }> {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(u ? { Authorization: `Bearer ${u.token}` } : {}), ...headers },
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

async function mcp(key: string, method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const res = await fetch(BASE + "/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${key}`, ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = (await res.json().catch(() => ({}))) as { result?: Record<string, unknown> & { content?: { text: string }[]; isError?: boolean }; error?: { message: string } };
  return { status: res.status, ...data };
}

async function main() {
  const smtp = await startSmtp();
  const original = await prisma.appSettings.findUnique({ where: { id: "global" } });
  const A = await makeUser("Admin", { admin: true });
  const B = await makeUser("Bob");
  const C = await makeUser("Carla");
  const created: { users: string[]; conversations: string[] } = { users: [A.id, B.id, C.id], conversations: [] };

  try {
    console.log("\n1. Administration → Notifications (SMTP)");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: { status: number; data: any } = await call(A, "PATCH", "/admin/notifications", {
      smtpHost: "127.0.0.1",
      smtpPort: SMTP_PORT,
      smtpSecure: false,
      smtpUser: "",
      smtpPassword: "s3cret-smtp",
      smtpFrom: "Second Brain <noreply@test.local>",
      emailEnabled: true,
      types: ["ASSIGNED", "TASK_UPDATED", "REPLY", "MENTION", "MESSAGE"].map((type) => ({ type, enabled: true, email: true })),
    });
    check("paramètres enregistrés par un administrateur", r.status === 200 && r.data.settings.emailEnabled && r.data.settings.smtpPasswordSet, r);
    const row = await prisma.appSettings.findUnique({ where: { id: "global" } });
    check("mot de passe SMTP chiffré en base", !!row && row.smtpPasswordEnc.startsWith("v1:") && !row.smtpPasswordEnc.includes("s3cret"));
    check("mot de passe jamais renvoyé", !JSON.stringify(r.data).includes("s3cret"));
    r = await call(B, "GET", "/admin/notifications");
    check("non-administrateur : refusé", r.status === 403, r.status);
    r = await call(B, "PATCH", "/admin/notifications", { emailEnabled: false });
    check("non-administrateur : modification refusée", r.status === 403, r.status);
    r = await call(A, "PATCH", "/admin/notifications", { smtpHost: "bad host;rm" });
    check("hôte SMTP invalide refusé", r.status === 400, r.status);
    r = await call<{ to: string }>(A, "POST", "/admin/notifications/test");
    check("e-mail de test envoyé", r.status === 200, r);
    check("e-mail de test reçu", !!(await waitMail(A.email, (m) => m.text.includes("E-mail de test"), 10_000)));
    const opts = await call<{ passwordReset: boolean }>(null, "GET", "/auth/options");
    check("options publiques : mot de passe oublié disponible", opts.data.passwordReset === true, opts.data);

    console.log("\n2. Messagerie");
    r = await call<{ conversationId: string; created: boolean }>(A, "POST", "/messages/conversations", { participantIds: [B.id], body: "<p>Bonjour <strong>Bob</strong> 😀</p>" });
    const conv = (r.data as { conversationId: string }).conversationId;
    created.conversations.push(conv);
    check("conversation créée (201)", r.status === 201 && !!conv, r);
    r = await call<{ conversationId: string; created: boolean }>(A, "POST", "/messages/conversations", { participantIds: [B.id], body: "<p>Deuxième message</p>" });
    check("à deux sans titre : conversation reprise (200)", r.status === 200 && (r.data as { conversationId: string }).conversationId === conv, r);
    let unread = await call<{ count: number }>(B, "GET", "/messages/unread");
    check("B : 2 messages non lus", unread.data.count === 2, unread.data);
    const bNotifs = await prisma.notification.findMany({ where: { userId: B.id, type: "MESSAGE", readAt: null } });
    check("B : une seule notification MESSAGE (regroupée)", bNotifs.length === 1, bNotifs.length);
    check("notification MESSAGE en attente d'e-mail", bNotifs[0]?.emailState === "PENDING" || bNotifs[0]?.emailState === "SENT" || bNotifs[0]?.emailState === "SENDING", bNotifs[0]?.emailState);
    const aNotifs = await prisma.notification.count({ where: { userId: A.id, type: "MESSAGE" } });
    check("l'auteur n'est pas notifié", aNotifs === 0, aNotifs);
    r = await call(C, "GET", `/messages/conversations/${conv}`);
    check("C (non participant) : 404", r.status === 404, r.status);
    r = await call(C, "POST", `/messages/conversations/${conv}/messages`, { body: "<p>intrus</p>" });
    check("C ne peut pas écrire", r.status === 404, r.status);
    type Conv = { conversation: { messages: { id: string; authorId: string; body: string; deleted: boolean; createdAt: string; replyTo: { id: string; deleted: boolean; excerpt: string } | null }[]; participants: { id: string; lastReadAt: string | null }[]; serverTime: string } };
    let thread = await call<Conv>(B, "GET", `/messages/conversations/${conv}`);
    const first = thread.data.conversation.messages[0];
    check("fil lisible par B, HTML conservé", thread.status === 200 && first.body.includes("<strong>Bob</strong>") && first.body.includes("😀"), first);
    r = await call<{ message: { id: string; replyTo: { id: string; excerpt: string } | null; body: string } }>(B, "POST", `/messages/conversations/${conv}/messages`, {
      body: '<p>Réponse <img src="x" onerror="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)">lien</a></p>',
      replyToId: first.id,
    });
    const reply = (r.data as { message: { id: string; replyTo: { id: string; excerpt: string } | null; body: string } }).message;
    check("réponse à un message précis", r.status === 201 && reply.replyTo?.id === first.id && reply.replyTo.excerpt.includes("Bonjour Bob"), r);
    check("contenu assaini (script, onerror, javascript:)", !/script|onerror|javascript:/i.test(reply.body), reply.body);
    r = await call(B, "POST", `/messages/conversations/${conv}/messages`, { body: "<p>   </p>" });
    check("message vide refusé", r.status === 400, r.status);
    r = await call(B, "POST", `/messages/conversations/${conv}/messages`, { body: "<p>autre fil</p>", replyToId: "c" + "0".repeat(24) });
    check("citation d'un message d'un autre fil refusée", r.status === 400, r.status);
    unread = await call<{ count: number }>(B, "GET", "/messages/unread");
    check("écrire vaut lecture (B : 0 non lu)", unread.data.count === 0, unread.data);
    thread = await call<Conv>(A, "GET", `/messages/conversations/${conv}`);
    const bPart = thread.data.conversation.participants.find((p) => p.id === B.id);
    check("vu : lastReadAt de B postérieur au premier message", !!bPart?.lastReadAt && bPart.lastReadAt >= first.createdAt, bPart);
    r = await call(A, "DELETE", `/messages/conversations/${conv}/messages/${reply.id}`);
    check("A ne peut pas supprimer le message de B", r.status === 403, r.status);
    const since = thread.data.conversation.serverTime;
    r = await call<{ message: { deleted: boolean; body: string } }>(B, "DELETE", `/messages/conversations/${conv}/messages/${reply.id}`);
    check("B supprime son message (contenu effacé)", r.status === 200 && (r.data as { message: { deleted: boolean; body: string } }).message.deleted && (r.data as { message: { body: string } }).message.body === "", r);
    const delta = await call<Conv>(A, "GET", `/messages/conversations/${conv}?since=${encodeURIComponent(since)}`);
    check("rafraîchissement « since » : la suppression remonte", delta.data.conversation.messages.some((m) => m.id === reply.id && m.deleted), delta.data);
    r = await call<{ message: { replyTo: { deleted: boolean } | null } }>(A, "POST", `/messages/conversations/${conv}/messages`, { body: "<p>Je réponds au message supprimé</p>", replyToId: reply.id });
    check("citation d'un message supprimé marquée « supprimé »", r.status === 201 && (r.data as { message: { replyTo: { deleted: boolean } | null } }).message.replyTo?.deleted === true, r);
    r = await call(B, "POST", `/messages/conversations/${conv}/read`, { read: true });
    unread = await call<{ count: number }>(B, "GET", "/messages/unread");
    check("marquer lu", r.status === 200 && unread.data.count === 0, unread.data);
    const bNotifRead = await prisma.notification.count({ where: { userId: B.id, type: "MESSAGE", readAt: null } });
    check("lecture : notifications MESSAGE de la conversation lues", bNotifRead === 0, bNotifRead);
    r = await call(B, "POST", `/messages/conversations/${conv}/read`, { read: false });
    unread = await call<{ count: number }>(B, "GET", "/messages/unread");
    check("marquer non lu", r.status === 200 && unread.data.count >= 1, unread.data);
    const list = await call<{ conversations: { id: string; unreadCount: number; lastMessage: { excerpt: string } | null }[] }>(B, "GET", "/messages/conversations");
    check("liste : compteur et aperçu", list.data.conversations.some((c) => c.id === conv && c.unreadCount >= 1 && !!c.lastMessage), list.data);
    const mailB = await waitMail(B.email, (m) => m.text.includes("Message de"), 30_000);
    check("copie e-mail de la notification MESSAGE reçue", !!mailB && mailB.text.includes(`/messages/${conv}`));

    console.log("\n3. Conversation de groupe, départ");
    r = await call<{ conversationId: string }>(A, "POST", "/messages/conversations", { participantIds: [B.id, C.id], title: "Groupe test", body: "<p>Salut à tous</p>" });
    const group = (r.data as { conversationId: string }).conversationId;
    created.conversations.push(group);
    check("groupe créé avec titre", r.status === 201, r);
    r = await call(C, "DELETE", `/messages/conversations/${group}`);
    check("C quitte le groupe", r.status === 200, r.status);
    r = await call(C, "GET", `/messages/conversations/${group}`);
    check("C n'y a plus accès", r.status === 404, r.status);
    const contacts = await call<{ contacts: { id: string }[] }>(B, "GET", "/messages/contacts");
    check("contacts de B : ses interlocuteurs", contacts.data.contacts.some((c) => c.id === A.id), contacts.data);

    console.log("\n4. Activation des notifications et préférence e-mail");
    await call(A, "PATCH", "/admin/notifications", { types: ["ASSIGNED", "TASK_UPDATED", "REPLY", "MENTION", "MESSAGE"].map((type) => ({ type, enabled: type !== "MESSAGE", email: true })) });
    await sleep(100);
    const before = await prisma.notification.count({ where: { userId: C.id } });
    r = await call<{ conversationId: string }>(A, "POST", "/messages/conversations", { participantIds: [C.id], body: "<p>Type désactivé</p>" });
    created.conversations.push((r.data as { conversationId: string }).conversationId);
    const after = await prisma.notification.count({ where: { userId: C.id } });
    check("type désactivé pour tout le monde : aucune notification", after === before, { before, after });
    await call(A, "PATCH", "/admin/notifications", { types: ["ASSIGNED", "TASK_UPDATED", "REPLY", "MENTION", "MESSAGE"].map((type) => ({ type, enabled: true, email: type !== "MESSAGE" })) });
    r = await call<{ conversationId: string }>(B, "POST", "/messages/conversations", { participantIds: [C.id], body: "<p>Sans e-mail</p>" });
    created.conversations.push((r.data as { conversationId: string }).conversationId);
    let n = await prisma.notification.findFirst({ where: { userId: C.id, type: "MESSAGE" }, orderBy: { createdAt: "desc" } });
    check("copie e-mail désactivée pour ce type : notification sans e-mail", !!n && n.emailState === null, n);
    await call(A, "PATCH", "/admin/notifications", { types: ["ASSIGNED", "TASK_UPDATED", "REPLY", "MENTION", "MESSAGE"].map((type) => ({ type, enabled: true, email: true })) });
    r = await call<{ profile: { emailNotifications: boolean } }>(C, "PATCH", "/me", { emailNotifications: false });
    check("préférence : notifications e-mail désactivées", r.status === 200 && (r.data as { profile: { emailNotifications: boolean } }).profile.emailNotifications === false, r);
    await prisma.notification.updateMany({ where: { userId: C.id }, data: { readAt: new Date() } });
    r = await call<{ conversationId: string }>(A, "POST", "/messages/conversations", { participantIds: [C.id], title: "Opt-out", body: "<p>Préférence</p>" });
    created.conversations.push((r.data as { conversationId: string }).conversationId);
    n = await prisma.notification.findFirst({ where: { userId: C.id, type: "MESSAGE", readAt: null }, orderBy: { createdAt: "desc" } });
    check("destinataire sans e-mail : notification créée sans copie", !!n && n.emailState === null, n);

    console.log("\n5. Mot de passe oublié");
    r = await call(null, "POST", "/auth/forgot-password", { email: `inconnu-${tag}@test.local` });
    check("adresse inconnue : même réponse (pas d'énumération)", r.status === 200, r);
    r = await call(null, "POST", "/auth/forgot-password", { email: B.email });
    check("demande acceptée", r.status === 200, r);
    const resetMail = await waitMail(B.email, (m) => m.text.includes("/reset-password?token="), 10_000);
    const resetToken = linkToken(resetMail, "/reset-password");
    check("e-mail de réinitialisation reçu avec lien", !!resetToken);
    r = await call(null, "POST", "/auth/reset-password", { token: resetToken, password: "NouveauPass456!", confirmPassword: "NouveauPass456!" });
    check("nouveau mot de passe enregistré", r.status === 200, r);
    r = await call(B, "GET", "/me");
    check("anciennes sessions fermées", r.status === 401, r.status);
    r = await call(null, "POST", "/auth/reset-password", { token: resetToken, password: "Encore789!!" });
    check("lien à usage unique", r.status === 400, r.status);
    const login = await call<{ token: string }>(null, "POST", "/auth/login", { email: B.email, password: "NouveauPass456!", client: "features-e2e" });
    check("connexion avec le nouveau mot de passe", login.status === 200 && !!(login.data as { token: string }).token, login.status);
    B.token = (login.data as { token: string }).token;
    const bUser = await prisma.user.findUnique({ where: { id: B.id } });
    check("réinitialisation par e-mail : adresse validée", !!bUser?.emailVerifiedAt);

    console.log("\n6. Inscription : bienvenue et validation de l'adresse");
    const dEmail = `feat-dana-${tag}@test.local`;
    const reg = await call<{ user: { id: string }; token: string }>(null, "POST", "/auth/register", { email: dEmail, password: "Password123!", firstName: "Dana", lastName: "Test", client: "features-e2e" });
    if (reg.status === 201) {
      const D: U = { id: (reg.data as { user: { id: string } }).user.id, email: dEmail, token: (reg.data as { token: string }).token, name: "Dana Test" };
      created.users.push(D.id);
      const welcome = await waitMail(dEmail, (m) => m.text.includes("/verify-email?token="), 10_000);
      check("e-mail de bienvenue reçu avec lien de validation", !!welcome && /Bienvenue/.test(welcome.text));
      let users = await call<{ users: { id: string; emailVerified: boolean }[] }>(A, "GET", "/admin/users");
      check("administration : adresse non validée", users.data.users.find((u) => u.id === D.id)?.emailVerified === false);
      r = await call<{ email: string }>(null, "POST", "/auth/verify-email", { token: linkToken(welcome, "/verify-email") });
      check("lien de validation accepté", r.status === 200, r);
      users = await call<{ users: { id: string; emailVerified: boolean }[] }>(A, "GET", "/admin/users");
      check("administration : adresse validée", users.data.users.find((u) => u.id === D.id)?.emailVerified === true);

      console.log("\n7. Changement d'adresse");
      const newEmail = `feat-dana2-${tag}@test.local`;
      r = await call(D, "POST", "/me/email", { email: newEmail, currentPassword: "mauvais" });
      check("mot de passe actuel exigé", r.status === 400, r.status);
      r = await call(D, "POST", "/me/email", { email: A.email, currentPassword: "Password123!" });
      check("adresse déjà prise refusée", r.status === 409, r.status);
      r = await call(D, "POST", "/me/email", { email: "daniel.barral@outlook.com", currentPassword: "Password123!" });
      check("adresse du super administrateur refusée", r.status === 409, r.status);
      r = await call<{ email: string; verificationSent: boolean }>(D, "POST", "/me/email", { email: newEmail, currentPassword: "Password123!" });
      check("adresse changée, lien envoyé", r.status === 200 && (r.data as { verificationSent: boolean }).verificationSent, r);
      const me = await call<{ profile: { email: string; emailVerified: boolean } }>(D, "GET", "/me");
      check("profil : nouvelle adresse non validée", me.data.profile.email === newEmail && me.data.profile.emailVerified === false, me.data);
      check("lien de validation reçu à la nouvelle adresse", !!(await waitMail(newEmail, (m) => m.text.includes("/verify-email?token="), 10_000)));
    } else {
      console.log(`  (inscription fermée ou limitée : ${reg.status}, étapes 6-7 ignorées)`);
    }

    console.log("\n8. Clés d'accès et connecteur MCP");
    const pA = await call<{ project: { id: string } }>(A, "POST", "/projects", { name: `Projet admin ${tag}` });
    const pB = await call<{ project: { id: string } }>(B, "POST", "/projects", { name: `Projet Bob ${tag}` });
    const projA = (pA.data as { project: { id: string } }).project?.id;
    const projB = (pB.data as { project: { id: string } }).project?.id;
    check("projets de test créés", !!projA && !!projB, { pA, pB });
    const kB = await call<{ key: string; apiKey: { id: string; prefix: string } }>(B, "POST", "/me/api-keys", { name: "Claude Desktop" });
    const keyB = (kB.data as { key: string }).key;
    check("clé créée (sb_…)", kB.status === 201 && keyB?.startsWith("sb_"), kB);
    const keys = await call<{ apiKeys: unknown[] }>(B, "GET", "/me/api-keys");
    check("la liste ne contient jamais la clé", keys.status === 200 && !JSON.stringify(keys.data).includes(keyB), keys.data);
    const keyRow = await prisma.apiKey.findFirst({ where: { userId: B.id } });
    check("clé stockée hachée", !!keyRow && keyRow.tokenHash !== keyB && keyRow.tokenHash.length === 64);
    const kA = await call<{ key: string; apiKey: { id: string } }>(A, "POST", "/me/api-keys", { name: "Admin" });
    const keyA = (kA.data as { key: string }).key;

    let m = await mcp(keyB, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    check("MCP initialize", m.status === 200 && m.result?.protocolVersion === "2025-06-18" && !!(m.result?.capabilities as { tools?: unknown })?.tools, m);
    const notif = await fetch(BASE + "/mcp", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${keyB}` }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
    check("notification initialized : 202", notif.status === 202, notif.status);
    m = await mcp(keyB, "tools/list");
    const toolNames = ((m.result?.tools as { name: string }[]) ?? []).map((t) => t.name);
    check("tools/list (utilisateur)", toolNames.includes("get_project") && toolNames.includes("list_my_tasks") && !toolNames.includes("list_users"), toolNames);
    m = await mcp(keyA, "tools/list");
    check("tools/list (administrateur) : list_users en plus", ((m.result?.tools as { name: string }[]) ?? []).some((t) => t.name === "list_users"));
    m = await mcp(keyB, "tools/call", { name: "list_projects", arguments: {} });
    const listed = JSON.parse(m.result?.content?.[0]?.text ?? "[]") as { id: string }[];
    check("list_projects : mes projets uniquement", listed.some((p) => p.id === projB) && !listed.some((p) => p.id === projA), listed.map((p) => p.id));
    m = await mcp(keyB, "tools/call", { name: "get_project", arguments: { project_id: projA } });
    check("get_project hors périmètre : refusé", m.result?.isError === true, m.result);
    m = await mcp(keyB, "tools/call", { name: "get_project", arguments: { project_id: projA, admin_access: true } });
    check("admin_access refusé à un non-administrateur", m.result?.isError === true && /administrateur/i.test(m.result?.content?.[0]?.text ?? ""), m.result);
    m = await mcp(keyA, "tools/call", { name: "get_project", arguments: { project_id: projB } });
    check("administrateur sans admin_access : périmètre normal", m.result?.isError === true, m.result);
    m = await mcp(keyA, "tools/call", { name: "get_project", arguments: { project_id: projB, admin_access: true } });
    const proj = JSON.parse(m.result?.isError ? "{}" : (m.result?.content?.[0]?.text ?? "{}")) as { name?: string };
    check("administrateur avec admin_access : projet d'un autre lisible", proj.name === `Projet Bob ${tag}`, m.result);
    m = await mcp(keyA, "tools/call", { name: "list_projects", arguments: { admin_access: true, query: tag } });
    const all = JSON.parse(m.result?.content?.[0]?.text ?? "[]") as { id: string }[];
    check("list_projects admin_access : tous les projets", all.some((p) => p.id === projA) && all.some((p) => p.id === projB), all);
    m = await mcp(keyB, "tools/call", { name: "whoami", arguments: {} });
    check("whoami", (m.result?.content?.[0]?.text ?? "").includes(B.email), m.result);
    m = await mcp(keyB, "tools/call", { name: "search", arguments: { query: "Projet Bob" } });
    check("search", m.result?.isError === false, m.result);
    m = await mcp(keyB, "tools/call", { name: "list_users", arguments: {} });
    check("outil d'administration inaccessible", !!m.error || m.result?.isError === true, m);
    m = await mcp(keyB, "tools/call", { name: "browse_notes", arguments: { ref: "root" } });
    check("browse_notes", m.result?.isError === false, m.result);
    m = await mcp("sb_" + "x".repeat(43), "tools/list");
    check("clé invalide : 401", m.status === 401, m.status);
    m = await mcp(B.token, "tools/list");
    check("jeton de session refusé (clé MCP uniquement)", m.status === 401, m.status);
    m = await mcp(keyB, "tools/list", {}, { Origin: "https://evil.example" });
    check("origine de navigateur étrangère refusée", m.status === 403, m.status);
    const get = await fetch(BASE + "/mcp", { headers: { Authorization: `Bearer ${keyB}` } });
    check("GET (flux SSE) : 405", get.status === 405, get.status);
    r = await call(B, "DELETE", `/me/api-keys/${(kB.data as { apiKey: { id: string } }).apiKey.id}`);
    m = await mcp(keyB, "tools/list");
    check("clé révoquée : 401", r.status === 200 && m.status === 401, m.status);
    r = await call(C, "DELETE", `/me/api-keys/${(kA.data as { apiKey: { id: string } }).apiKey.id}`);
    check("révoquer la clé d'un autre : 404", r.status === 404, r.status);

    console.log("\n9. Prérequis de tâches");
    type TaskResp = { project: { tasks: { id: string; prerequisiteIds: string[] }[] } | null; task?: { id: string } };
    const mk = async (name: string, startDate: string, dueDate: string) => {
      const r = await call<TaskResp>(B, "POST", `/projects/${projB}/tasks`, { name, startDate, dueDate });
      return (r.data as TaskResp).project!.tasks.find((t) => !known.has(t.id))!.id;
    };
    const known = new Set<string>();
    const tA = await mk("Fondations", "2026-11-02", "2026-11-06");
    known.add(tA);
    const tB = await mk("Murs", "2026-11-09", "2026-11-13");
    known.add(tB);
    const tC = await mk("Toit", "2026-11-16", "2026-11-20");
    known.add(tC);
    r = await call(B, "PATCH", `/tasks/${tB}`, { prerequisiteIds: [tA] });
    check("prérequis ajouté (même projet)", r.status === 200, r);
    r = await call(B, "PATCH", `/tasks/${tC}`, { prerequisiteIds: [tB, tB] });
    const detailC = await call<{ task: { prerequisiteIds: string[] } }>(B, "GET", `/tasks/${tC}`);
    check("liste dédoublonnée et renvoyée par la fiche", JSON.stringify(detailC.data.task.prerequisiteIds) === JSON.stringify([tB]), detailC.data);
    r = await call(B, "PATCH", `/tasks/${tA}`, { prerequisiteIds: [tC] });
    check("dépendance circulaire refusée (A ← C ← B ← A)", r.status === 400 && /circulaire/i.test(JSON.stringify(r.data)), r);
    r = await call(B, "PATCH", `/tasks/${tA}`, { prerequisiteIds: [tA] });
    check("une tâche n'est pas son propre prérequis", r.status === 400, r.status);
    const otherProj = await call<{ project: { id: string } }>(B, "POST", "/projects", { name: `Autre ${tag}` });
    const otherId = (otherProj.data as { project: { id: string } }).project.id;
    const otherTask = await call<TaskResp>(B, "POST", `/projects/${otherId}/tasks`, { name: "Ailleurs" });
    const otherTaskId = (otherTask.data as TaskResp).project!.tasks[0].id;
    r = await call(B, "PATCH", `/tasks/${tA}`, { prerequisiteIds: [otherTaskId] });
    check("prérequis d'un autre projet refusé", r.status === 400, r.status);
    r = await call(C, "PATCH", `/tasks/${tB}`, { prerequisiteIds: [] });
    check("non-membre : modification refusée", r.status === 404 || r.status === 403, r.status);
    r = await call(B, "PATCH", `/tasks/${tB}`, { projectId: otherId });
    const afterMove = await call<{ task: { prerequisiteIds: string[] } }>(B, "GET", `/tasks/${tC}`);
    const movedB = await call<{ task: { prerequisiteIds: string[] } }>(B, "GET", `/tasks/${tB}`);
    check("changement de projet : dépendances retirées des deux côtés", afterMove.data.task.prerequisiteIds.length === 0 && movedB.data.task.prerequisiteIds.length === 0, { c: afterMove.data, b: movedB.data });
    await call(B, "PATCH", `/tasks/${tC}`, { prerequisiteIds: [tA] });
    r = await call(B, "DELETE", `/tasks/${tA}`);
    const afterDelete = await call<{ task: { prerequisiteIds: string[] } }>(B, "GET", `/tasks/${tC}`);
    check("suppression d'un prérequis : retiré des tâches dépendantes", r.status === 200 && afterDelete.data.task.prerequisiteIds.length === 0, afterDelete.data);
    r = await call(B, "PATCH", `/tasks/${tC}`, { startDate: "2026-11-23", dueDate: "2026-11-27" });
    const shifted = await call<{ task: { startDate: string; dueDate: string } }>(B, "GET", `/tasks/${tC}`);
    check("décalage dans le temps (Gantt)", shifted.data.task.startDate.startsWith("2026-11-23") && shifted.data.task.dueDate.startsWith("2026-11-27"), shifted.data);
    await call(B, "DELETE", `/projects/${otherId}`);

    console.log("\n10. Épingles du menu");
    type Pins = { pins: { projects: { id: string; name: string }[]; mindmaps: { id: string }[] } };
    let pins = await call<Pins>(B, "PUT", "/me/pins", { kind: "PROJECT", id: projB, pinned: true });
    check("projet épinglé", pins.status === 200 && pins.data.pins.projects.some((p) => p.id === projB), pins.data);
    pins = await call<Pins>(B, "PUT", "/me/pins", { kind: "PROJECT", id: projA, pinned: true });
    check("épingler un projet inaccessible : 404", pins.status === 404, pins.status);
    const mapB = await call<{ mindmap: { id: string } }>(B, "POST", "/mindmaps", { title: `Carte ${tag}` });
    const mapId = (mapB.data as { mindmap: { id: string } }).mindmap?.id;
    pins = await call<Pins>(B, "PUT", "/me/pins", { kind: "MINDMAP", id: mapId, pinned: true });
    check("carte épinglée", pins.status === 200 && pins.data.pins.mindmaps.some((m) => m.id === mapId), pins.data);
    pins = await call<Pins>(C, "PUT", "/me/pins", { kind: "MINDMAP", id: mapId, pinned: true });
    check("épingler la carte d'un autre : 404", pins.status === 404, pins.status);
    await call(B, "DELETE", `/mindmaps/${mapId}`);
    pins = await call<Pins>(B, "GET", "/me/pins");
    check("élément supprimé : épingle purgée", pins.data.pins.mindmaps.length === 0 && pins.data.pins.projects.length === 1, pins.data);
    pins = await call<Pins>(B, "PUT", "/me/pins", { kind: "PROJECT", id: projB, pinned: false });
    check("désépinglé", pins.data.pins.projects.length === 0, pins.data);

    console.log("\n11. Inscription : confirmation du mot de passe");
    r = await call(null, "POST", "/auth/register", { email: `feat-conf-${tag}@test.local`, password: "Password123!", confirmPassword: "Autre123!", firstName: "Conf" });
    check("confirmation différente refusée", r.status === 400 || r.status === 429, r.status);

    console.log("\n12. Piste d'audit des tâches");
    {
      const t = await call<TaskResp>(B, "POST", `/projects/${projB}/tasks`, { name: "Audit", startDate: "2026-12-01", dueDate: "2026-12-05" });
      const auditId = (t.data as TaskResp).project!.tasks.find((x) => !known.has(x.id))!.id;
      known.add(auditId);
      const members = await call<{ project: { members: { id: string; userId: string | null }[] } }>(B, "GET", `/projects/${projB}`);
      const bMember = members.data.project.members.find((m) => m.userId === B.id)!.id;
      await call(B, "PATCH", `/tasks/${auditId}`, { startDate: "2026-12-03", assigneeId: bMember, priority: "HIGH", status: "IN_PROGRESS" });
      await call(B, "POST", `/tasks/${auditId}/comments`, { body: "Un commentaire d'audit" });
      const h = await call<{ events: { kind: string; message: string; actorName: string }[] }>(B, "GET", `/tasks/${auditId}/history`);
      const msgs = h.data.events.map((e) => e.message);
      check("création tracée", msgs.some((m) => /a créé la tâche « Audit »/.test(m)), msgs);
      check("date de début : ancienne et nouvelle valeur", msgs.some((m) => /modifié la date de début du 01\/12\/2026 au 03\/12\/2026/.test(m)), msgs);
      check("affectation tracée", msgs.some((m) => /a assigné la tâche à /.test(m)), msgs);
      check("priorité et statut tracés", msgs.some((m) => /priorité de Moyenne à Haute/.test(m)) && msgs.some((m) => /statut de À faire à En cours/.test(m)), msgs);
      check("commentaire tracé", msgs.some((m) => /a commenté : « Un commentaire d'audit »/.test(m)), msgs);
      check("plus récent d'abord, auteur nommé", h.data.events[0].kind === "comment" && h.data.events.every((e) => e.actorName), h.data.events[0]);
      const hC = await call(C, "GET", `/tasks/${auditId}/history`);
      check("historique d'une tâche inaccessible : 404", hC.status === 404, hC.status);
    }

    console.log("\n13. Réunions et validation des comptes-rendus");
    {
      // C rejoint le projet de B (membre avec compte) pour valider.
      const addC = await call<{ project: { members: { id: string; userId: string | null }[] } }>(B, "POST", `/projects/${projB}/members`, { userId: C.id });
      const cMember = addC.data.project.members.find((m) => m.userId === C.id)!.id;
      const created = await call<{ meetings: { id: string; status: string }[] }>(B, "POST", `/projects/${projB}/meetings`, { title: "Comité", date: "2026-11-10T09:00:00.000Z", location: "Salle A", approverIds: [cMember], participantIds: [cMember] });
      const meetingId = created.data.meetings[0].id;
      check("réunion créée (brouillon)", created.status === 201 && created.data.meetings[0].status === "draft", created.data);
      await prisma.notification.deleteMany({ where: { userId: C.id } });
      let r2 = await call<{ meetings: { id: string; status: string; approvers: { decision: string }[] }[] }>(B, "PATCH", `/meetings/${meetingId}`, { minutes: "<p>Décisions : <strong>GO</strong></p><table><tbody><tr><td>A</td><td>B</td></tr></tbody></table><script>x</script>" });
      check("compte-rendu enregistré, en validation", r2.data.meetings[0].status === "pending", r2.data);
      const list = await call<{ meetings: { minutes: string; myDecision: string | null }[] }>(C, "GET", `/projects/${projB}/meetings`);
      check("compte-rendu assaini (tableau gardé, script retiré)", /<table>/.test(list.data.meetings[0].minutes) && !/script/.test(list.data.meetings[0].minutes), list.data.meetings[0].minutes);
      check("le validateur voit sa décision en attente", list.data.meetings[0].myDecision === "PENDING");
      const review = await prisma.notification.findMany({ where: { userId: C.id, type: "MEETING_REVIEW" } });
      check("validateur notifié (MEETING_REVIEW)", review.length === 1, review.length);
      r2 = await call(C, "PATCH", `/meetings/${meetingId}`, { minutes: "<p>pirate</p>" });
      check("un validateur ne modifie pas le compte-rendu", r2.status === 403, r2.status);
      r2 = await call(C, "POST", `/meetings/${meetingId}/decision`, { decision: "REJECTED", comment: "" });
      check("refus sans motif refusé", r2.status === 400, r2.status);
      r2 = await call(C, "POST", `/meetings/${meetingId}/decision`, { decision: "REJECTED", comment: "Il manque le budget" });
      check("refus avec motif", r2.status === 200 && r2.data.meetings[0].status === "rejected", r2.data);
      const decisionNotif = await prisma.notification.findFirst({ where: { userId: B.id, type: "MEETING_DECISION" }, orderBy: { createdAt: "desc" } });
      check("rédacteur notifié du refus (motif)", !!decisionNotif && /refusé/.test(decisionNotif.title) && /budget/.test(decisionNotif.body), decisionNotif);
      r2 = await call(B, "PATCH", `/meetings/${meetingId}`, { minutes: "<p>Décisions : GO, budget 10 k€</p>" });
      check("modification du compte-rendu : décisions remises en attente", r2.data.meetings[0].status === "pending" && r2.data.meetings[0].approvers.every((a) => a.decision === "PENDING"), r2.data);
      r2 = await call(B, "POST", `/meetings/${meetingId}/decision`, { decision: "APPROVED" });
      check("un non-validateur ne décide pas", r2.status === 403, r2.status);
      r2 = await call(C, "POST", `/meetings/${meetingId}/decision`, { decision: "APPROVED", comment: "" });
      check("validation → compte-rendu validé", r2.status === 200 && r2.data.meetings[0].status === "approved", r2.data);
      r2 = await call(A, "GET", `/projects/${projB}/meetings`);
      check("non-membre : 404", r2.status === 404, r2.status);
    }

    console.log("\n14. Inscriptions libres (administration)");
    {
      let reg = await call<{ registration: { enabled: boolean; open: boolean } }>(B, "PATCH", "/admin/settings", { registrationEnabled: false });
      check("non-administrateur : refusé", reg.status === 403, reg.status);
      reg = await call(A, "PATCH", "/admin/settings", { registrationEnabled: false });
      check("administrateur ferme les inscriptions", reg.status === 200 && reg.data.registration.open === false, reg.data);
      const opts2 = await call<{ registration: boolean }>(null, "GET", "/auth/options");
      check("options publiques : inscription fermée", opts2.data.registration === false, opts2.data);
      const tryReg = await call(null, "POST", "/auth/register", { email: `feat-closed-${tag}@test.local`, password: "Password123!", firstName: "Closed" });
      check("inscription refusée (403)", tryReg.status === 403 || tryReg.status === 429, tryReg.status);
      reg = await call(A, "PATCH", "/admin/settings", { registrationEnabled: true });
      check("réouverture", reg.data.registration.open === true, reg.data);
    }

    console.log("\n15. Export Excel du projet");
    {
      const res = await fetch(`${BASE}/projects/${projB}/export`, { headers: { Authorization: `Bearer ${B.token}` } });
      check("export : 200 et type xlsx", res.status === 200 && (res.headers.get("content-type") ?? "").includes("spreadsheetml"), res.status);
      const ExcelJS = (await import("exceljs")).default;
      const wbx = new ExcelJS.Workbook();
      await wbx.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
      const names = wbx.worksheets.map((w) => w.name);
      check("feuilles attendues", ["Synthèse", "Tâches", "Étapes & activités", "Livrables", "Risques & opportunités", "Matrices", "Réunions", "Équipe", "Documents"].every((n) => names.includes(n)), names);
      const ws = wbx.getWorksheet("Tâches")!;
      const header = (ws.getRow(1).values as unknown[]).slice(1);
      check("colonnes des tâches (dont prérequis et risques)", header.includes("Prérequis") && header.includes("Risques liés") && header.includes("Responsable"), header);
      check("une ligne par tâche", ws.rowCount - 1 >= 2, ws.rowCount);
      const meetingsWs = wbx.getWorksheet("Réunions")!;
      check("réunion exportée avec son compte-rendu", String(meetingsWs.getRow(2).getCell(8).value ?? "").includes("budget"), meetingsWs.getRow(2).getCell(8).value);
      const resC = await fetch(`${BASE}/projects/${projB}/export`, { headers: { Authorization: `Bearer ${A.token}` } });
      check("export d'un projet inaccessible : 404", resC.status === 404, resC.status);
    }

    console.log("\n17. Connecteur MCP : écriture");
    {
      const kw = await call<{ key: string }>(B, "POST", "/me/api-keys", { name: "Écriture", canWrite: true });
      const kr = await call<{ key: string }>(B, "POST", "/me/api-keys", { name: "Lecture", canWrite: false });
      const writeKey = (kw.data as { key: string }).key;
      const readKey = (kr.data as { key: string }).key;
      const toolsR = ((await mcp(readKey, "tools/list")).result?.tools as { name: string }[]).map((t) => t.name);
      const toolsW = ((await mcp(writeKey, "tools/list")).result?.tools as { name: string }[]).map((t) => t.name);
      check("clé lecture seule : pas d'outils d'écriture", !toolsR.includes("update_task") && !toolsR.includes("api_request"), toolsR);
      check("clé écriture : outils d'écriture exposés", ["update_task", "bulk_update_tasks", "update_meeting", "api_request", "api_reference"].every((n) => toolsW.includes(n)), toolsW);
      let m = await mcp(readKey, "tools/call", { name: "update_task", arguments: { task_id: "x", name: "y" } });
      check("écriture refusée avec une clé lecture seule", !!m.error && /lecture seule/i.test(m.error.message), m);

      // Une tâche du projet de B, et C membre (ajouté à l'étape 13).
      const created = await mcp(writeKey, "tools/call", { name: "create_task", arguments: { project_id: projB, name: "Tâche MCP", start_date: "2026-12-10", due_date: "2026-12-12", assignee: "Carla" } });
      check("create_task (responsable désigné par son nom)", created.result?.isError === false, created.result);
      const proj = await call<{ project: { tasks: { id: string; name: string; assigneeId: string | null }[]; members: { id: string; userId: string | null; name: string }[] } }>(B, "GET", `/projects/${projB}`);
      const tMcp = proj.data.project.tasks.find((t) => t.name === "Tâche MCP")!;
      const carla = proj.data.project.members.find((x) => x.userId === C.id)!;
      check("tâche créée et assignée à Carla", !!tMcp && tMcp.assigneeId === carla.id, tMcp);
      m = await mcp(writeKey, "tools/call", { name: "update_task", arguments: { task_id: tMcp.id, status: "IN_PROGRESS", due_date: "2026-12-20", priority: "HIGH" } });
      check("update_task", m.result?.isError === false, m.result);
      const hist = await call<{ events: { message: string }[] }>(B, "GET", `/tasks/${tMcp.id}/history`);
      check("modifications MCP tracées dans l'historique", hist.data.events.some((e) => /échéance du 12\/12\/2026 au 20\/12\/2026/.test(e.message)), hist.data.events.map((e) => e.message));
      m = await mcp(writeKey, "tools/call", { name: "bulk_update_tasks", arguments: { project_id: projB, set: { assignee: "Bob" }, dry_run: true } });
      const dry = JSON.parse(m.result?.content?.[0]?.text ?? "{}") as { count: number };
      check("bulk dry_run : liste sans modifier", dry.count >= 2, dry);
      m = await mcp(writeKey, "tools/call", { name: "bulk_update_tasks", arguments: { project_id: projB, set: { assignee: B.email } } });
      const bulk = JSON.parse(m.result?.content?.[0]?.text ?? "{}") as { updated: number; failed: unknown[] };
      const after = await call<{ project: { tasks: { assigneeId: string | null }[]; members: { id: string; userId: string | null }[] } }>(B, "GET", `/projects/${projB}`);
      const bob = after.data.project.members.find((x) => x.userId === B.id)!;
      check("assigner toutes les tâches du projet à quelqu'un", bulk.updated >= 2 && bulk.failed.length === 0 && after.data.project.tasks.every((t) => t.assigneeId === bob.id), { bulk, tasks: after.data.project.tasks });
      m = await mcp(writeKey, "tools/call", { name: "update_task", arguments: { task_id: tMcp.id, assignee: "Inconnu Total" } });
      check("personne inconnue : erreur claire", m.result?.isError === true && /n'est pas membre/.test(m.result?.content?.[0]?.text ?? ""), m.result);
      const meet = await mcp(writeKey, "tools/call", { name: "create_meeting", arguments: { project_id: projB, title: "Point MCP", date: "2026-12-01T10:00:00Z", approvers: ["Carla"], minutes_text: "Premier point." } });
      const meetingId = (JSON.parse(meet.result?.content?.[0]?.text ?? "{}") as { meetings: { id: string; title: string }[] }).meetings.find((x) => x.title === "Point MCP")?.id;
      check("create_meeting", !!meetingId, meet.result);
      m = await mcp(writeKey, "tools/call", { name: "update_meeting", arguments: { meeting_id: meetingId, append_text: "Deuxième point ajouté par Claude." } });
      const mts = await call<{ meetings: { id: string; minutes: string }[] }>(B, "GET", `/projects/${projB}/meetings`);
      check("update_meeting : compte-rendu complété", m.result?.isError === false && /Premier point\.[\s\S]*Deuxième point ajouté par Claude/.test(mts.data.meetings.find((x) => x.id === meetingId)?.minutes ?? ""), mts.data.meetings.find((x) => x.id === meetingId));
      m = await mcp(writeKey, "tools/call", { name: "api_request", arguments: { method: "PATCH", path: `/projects/${projB}`, body: { description: "Décrit via l'API générique" } } });
      const pd = await call<{ project: { description: string } }>(B, "GET", `/projects/${projB}`);
      check("api_request : n'importe quelle route", m.result?.isError === false && pd.data.project.description === "Décrit via l'API générique", m.result);
      m = await mcp(writeKey, "tools/call", { name: "api_request", arguments: { method: "GET", path: `/projects/${projA}` } });
      check("api_request : droits de l'utilisateur respectés (projet d'autrui)", m.result?.isError === true, m.result);
      m = await mcp(writeKey, "tools/call", { name: "api_request", arguments: { method: "POST", path: "/me/api-keys", body: { name: "évasion" } } });
      check("api_request : routes sensibles interdites", m.result?.isError === true && /pas accessible/.test(m.result?.content?.[0]?.text ?? ""), m.result);
      m = await mcp(writeKey, "tools/call", { name: "api_reference", arguments: { section: "Réunions" } });
      check("api_reference : documentation servie", m.result?.isError === false && /meetings/.test(m.result?.content?.[0]?.text ?? ""), (m.result?.content?.[0]?.text ?? "").slice(0, 200));
      m = await mcp(writeKey, "tools/call", { name: "save_note", arguments: { ref: `task:${tMcp.id}`, text: "Note écrite par Claude", mode: "append" } });
      const note = await call<{ document: { notes: string } }>(B, "GET", `/notes/task/${tMcp.id}`);
      check("save_note (ajout)", /Note écrite par Claude/.test(note.data.document.notes), note.data);
      const leftover = await prisma.session.count({ where: { userId: B.id, label: "Connecteur MCP (temporaire)" } });
      check("sessions éphémères supprimées après chaque appel", leftover === 0, leftover);
    }
    if (projA) await call(A, "DELETE", `/projects/${projA}`);
    if (projB) await call(B, "DELETE", `/projects/${projB}`);
  } finally {
    console.log("\n18. Nettoyage");
    await prisma.conversation.deleteMany({ where: { id: { in: created.conversations.filter(Boolean) } } });
    await prisma.conversation.deleteMany({ where: { participants: { some: { userId: { in: created.users } } } } });
    await prisma.user.deleteMany({ where: { id: { in: created.users } } });
    if (original) {
      const { id: _id, updatedAt: _u, ...rest } = original;
      await prisma.appSettings.update({ where: { id: "global" }, data: rest });
    } else await prisma.appSettings.deleteMany({ where: { id: "global" } });
    console.log("  paramètres SMTP d'origine restaurés, comptes de test supprimés");
    smtp.close();
    await prisma.$disconnect();
  }
  console.log(`\n${passes} vérification(s) réussie(s), ${failures} échec(s).`);
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
