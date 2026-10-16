import { requireAdminPage } from "@/lib/admin-page";
import { customFieldUsage, listCustomFields } from "@/lib/custom-fields";
import { AdminCustomFields } from "@/components/admin/AdminCustomFields";

export const metadata = { title: "Administration · Champs personnalisés" };

export default async function Page() {
  await requireAdminPage();
  const [fields, usage] = await Promise.all([listCustomFields({ includeArchived: true }), customFieldUsage()]);
  return <AdminCustomFields initial={fields} usage={usage} />;
}
