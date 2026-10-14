import { requireUser } from "@/lib/auth";
import { getProfile } from "@/lib/users";
import { PreferencesPage } from "@/components/PreferencesPage";

export const metadata = { title: "Préférences" };

export default async function Page() {
  const user = await requireUser();
  return <PreferencesPage initial={await getProfile(user)} />;
}
