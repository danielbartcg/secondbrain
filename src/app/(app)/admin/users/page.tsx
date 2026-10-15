import { requireAdminPage } from "@/lib/admin-page";
import { listUsersAdmin } from "@/lib/users";
import { AdminUsers } from "@/components/admin/AdminUsers";

export const metadata = { title: "Administration · Utilisateurs" };

export default async function Page() {
  const user = await requireAdminPage();
  return <AdminUsers initial={await listUsersAdmin(user)} currentUserId={user.id} />;
}
