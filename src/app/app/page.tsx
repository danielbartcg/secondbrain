import Link from "next/link";
import { Apple, Download, Monitor, RefreshCw, Share, ShieldCheck, SquarePlus, WifiOff } from "lucide-react";
import { latestDesktop } from "@/lib/downloads";

export const metadata = { title: "Applications" };
export const dynamic = "force-dynamic";

/**
 * Page publique de téléchargement de l'application desktop (Windows), aussi
 * ouverte par l'application quand une mise à jour est obligatoire.
 */
export default function AppDownloadPage() {
  const release = latestDesktop();
  const size = release ? `${(release.size / 1024 / 1024).toFixed(0)} Mo` : null;
  const date = release ? new Date(release.publishedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }) : null;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-2xl text-on-brand">🧠</span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Second Brain sur vos appareils</h1>
          <p className="text-sm text-muted">Windows (même sans connexion) et iPhone (écran d&apos;accueil).</p>
        </div>
      </div>

      <section className="rounded-2xl border border-line bg-surface p-6">
        <h2 className="flex items-center gap-2 font-semibold">
          <Monitor className="h-5 w-5 text-brand-600" /> Windows
        </h2>
        {release ? (
          <>
            <p className="mt-1 text-sm text-muted">
              Version {release.version} · {size} · publiée le {date}
            </p>
            <a href={`/downloads/${release.file}`} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-on-brand hover:bg-brand-700">
              <Download className="h-4 w-4" /> Télécharger l&apos;installateur
            </a>
            <p className="mt-3 break-all text-[11px] text-faint">SHA-256 : {release.sha256}</p>
          </>
        ) : (
          <p className="mt-2 text-sm text-muted">L&apos;installateur n&apos;est pas encore publié.</p>
        )}
        <ul className="mt-5 space-y-2 text-sm text-ink-2">
          <li className="flex gap-2">
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-muted" /> Projets, étapes, tâches, cartes mentales et notes restent consultables et modifiables hors ligne ; tout se synchronise au retour de la connexion.
          </li>
          <li className="flex gap-2">
            <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-muted" /> En cas de modifications concurrentes, la valeur la plus récente du serveur l&apos;emporte ; la vôtre est conservée dans « Conflits ».
          </li>
          <li className="flex gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted" /> L&apos;installateur n&apos;est pas encore signé : Windows peut afficher « Windows a protégé votre ordinateur » → « Informations complémentaires » → « Exécuter quand même ».
          </li>
        </ul>
      </section>

      <section className="mt-4 rounded-2xl border border-dashed border-line-strong bg-surface p-6">
        <h2 className="flex items-center gap-2 font-semibold">
          <Apple className="h-5 w-5 text-muted" /> iPhone
        </h2>
        <p className="mt-1 text-sm text-muted">
          Dès aujourd&apos;hui : installez la version web sur l&apos;écran d&apos;accueil, elle s&apos;ouvre en plein écran comme une application (connexion nécessaire).
        </p>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-ink-2">
          <li>Ouvrez <b>{process.env.NEXT_PUBLIC_SITE_URL?.replace(/^https?:\/\//, "") || "le site"}</b> dans <b>Safari</b> et connectez-vous.</li>
          <li>
            Touchez le bouton <b>Partager</b> <Share className="inline h-4 w-4 align-text-bottom" aria-hidden /> en bas de l&apos;écran.
          </li>
          <li>
            Choisissez <b>« Sur l&apos;écran d&apos;accueil »</b> <SquarePlus className="inline h-4 w-4 align-text-bottom" aria-hidden />, puis <b>Ajouter</b>.
          </li>
        </ol>
        <p className="mt-3 text-xs text-muted">L&apos;application iPhone avec mode hors ligne arrivera ensuite via TestFlight.</p>
      </section>

      <p className="mt-6 text-center text-sm text-muted">
        <Link href="/dashboard" className="text-brand-700 hover:underline">
          Ouvrir la version web
        </Link>
      </p>
    </main>
  );
}
