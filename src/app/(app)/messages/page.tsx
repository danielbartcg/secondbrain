import { requireUser } from "@/lib/auth";
import { MessagesApp } from "@/components/messages/MessagesApp";

export const metadata = { title: "Messages" };

export default async function Page() {
  const user = await requireUser();
  return <MessagesApp me={{ id: user.id, name: user.name, avatarUrl: user.avatarUrl }} />;
}
