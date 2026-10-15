import { redirect } from "next/navigation";
import { requireAdminPage } from "@/lib/admin-page";

export default async function AdminIndex() {
  await requireAdminPage();
  redirect("/admin/users");
}
