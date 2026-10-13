import { requireUser } from "@/lib/auth";
import { children } from "@/lib/notes";
import { NotesWorkspace } from "@/components/notes/NotesWorkspace";

export const metadata = { title: "Prise de notes" };

/** « Prise de notes » : arborescence de tous les objets + document de notes riches par objet. */
export default async function NotesPage() {
  const user = await requireUser();
  const roots = await children(user.id, "root");
  return <NotesWorkspace roots={roots} />;
}
