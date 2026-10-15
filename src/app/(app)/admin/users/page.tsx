import { requireAdminPage } from "@/lib/admin-page";
import { listUsersAdmin } from "@/lib/users";
import { getRegistrationSettings } from "@/lib/settings";
import { AdminUsers } from "@/components/admin/AdminUsers";
import { AdminRegistrationToggle } from "@/components/admin/AdminRegistrationToggle";

export const metadata = { title: "Administration · Utilisateurs" };

export default async function Page() {
  const user = await requireAdminPage();
  const [users, registration] = await Promise.all([listUsersAdmin(user), getRegistrationSettings()]);
  return (
    <>
      <AdminRegistrationToggle initial={registration} />
      <AdminUsers initial={users} currentUserId={user.id} />
    </>
  );
}
