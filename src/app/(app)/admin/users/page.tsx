import { requireUser } from "@/lib/auth";
import { listUsersAdmin } from "@/lib/users";
import { AdminUsers } from "@/components/admin/AdminUsers";

export const metadata = { title: "Administration · Utilisateurs" };

export default async function Page() {
  const user = await requireUser();
  return <AdminUsers initial={await listUsersAdmin()} currentUserId={user.id} />;
}
