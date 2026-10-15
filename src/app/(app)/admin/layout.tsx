import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isAdmin } from "@/lib/roles";
import { AdminNav } from "@/components/admin/AdminNav";

/** Administration : réservée aux administrateurs (et au super administrateur). */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!isAdmin(user)) notFound();
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Administration</h1>
      <p className="mt-1 text-sm text-muted">Comptes, rôles et hiérarchie ; vue d&apos;ensemble des projets et des tâches de tout le monde (lecture seule) ; notifications et e-mails.</p>
      <AdminNav />
      <div className="mt-5">{children}</div>
    </div>
  );
}
