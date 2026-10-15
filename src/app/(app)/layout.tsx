import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/roles";
import { listPins } from "@/lib/pins";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [reportCount, pins] = await Promise.all([prisma.user.count({ where: { managerId: user.id } }), listPins(user.id)]);
  return (
    <AppShell user={{ id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl, isAdmin: isAdmin(user), reportCount }} pins={pins}>
      {children}
    </AppShell>
  );
}
