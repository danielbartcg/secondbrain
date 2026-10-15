import { notFound } from "next/navigation";
import { ApiError } from "@/lib/api";
import { requireAdminPage } from "@/lib/admin-page";
import { getProjectAdmin } from "@/lib/projects";
import { AdminProjectView } from "@/components/admin/AdminProjectView";

export const metadata = { title: "Administration · Projet" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminPage();
  const { id } = await params;
  try {
    return <AdminProjectView project={await getProjectAdmin(admin, id)} />;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
}
