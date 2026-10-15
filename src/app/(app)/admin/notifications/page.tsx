import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isAdmin } from "@/lib/roles";
import { getNotificationSettings } from "@/lib/settings";
import { AdminNotifications } from "@/components/admin/AdminNotifications";

export const metadata = { title: "Administration · Notifications" };

export default async function Page() {
  const user = await requireUser();
  if (!isAdmin(user)) notFound();
  return <AdminNotifications initial={await getNotificationSettings()} adminEmail={user.email} />;
}
