import { requireUser } from "@/lib/auth";
import { MessagesApp } from "@/components/messages/MessagesApp";

export const metadata = { title: "Messages" };

/** L'accès à la conversation est vérifié par l'API (participants uniquement). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, user] = await Promise.all([params, requireUser()]);
  return <MessagesApp me={{ id: user.id, name: user.name, avatarUrl: user.avatarUrl }} conversationId={id} />;
}
