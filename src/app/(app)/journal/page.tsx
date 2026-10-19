import { requireUser } from "@/lib/auth";
import { getJournalDay } from "@/lib/journal";
import { parisYmd } from "@/lib/shared/activity-period";
import { isValidDay } from "@/lib/shared/journal";
import { JournalView } from "@/components/journal/JournalView";

export const metadata = { title: "Journal quotidien" };

/** Journal quotidien (aujourd'hui par défaut ; `?day=AAAA-MM-JJ` pour un autre jour passé). */
export default async function Page({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const user = await requireUser();
  const today = parisYmd();
  const asked = (await searchParams).day;
  const day = asked && isValidDay(asked) && asked <= today ? asked : today;
  return <JournalView initial={await getJournalDay(user, day)} />;
}
