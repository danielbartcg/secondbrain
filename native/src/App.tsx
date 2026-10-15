import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Download, Loader2, RefreshCw, WifiOff } from "lucide-react";
import { api, ApiClientError } from "@/lib/client";
import { AppShell } from "@/components/AppShell";
import { HomeDashboard } from "@/components/dashboard/HomeDashboard";
import { MindMapList } from "@/components/mindmap/MindMapList";
import { MindMapEditor } from "@/components/mindmap/MindMapEditor";
import { ProjectList } from "@/components/projects/ProjectList";
import { MessagesApp } from "@/components/messages/MessagesApp";
import { AdminNotifications } from "@/components/admin/AdminNotifications";
import type { NotificationSettingsDto } from "@/lib/settings";
import { ProjectWorkspace } from "@/components/projects/ProjectWorkspace";
import { OrphanTasks } from "@/components/projects/OrphanTasks";
import { TaskSheet } from "@/components/projects/TaskSheet";
import { TaskOrganizer } from "@/components/organizer/TaskOrganizer";
import { NotesWorkspace } from "@/components/notes/NotesWorkspace";
import { NotificationsPage } from "@/components/NotificationsPage";
import { PreferencesPage } from "@/components/PreferencesPage";
import { TeamOverview } from "@/components/admin/TeamOverview";
import { AdminNav } from "@/components/admin/AdminNav";
import { AdminUsers } from "@/components/admin/AdminUsers";
import { AdminProjects } from "@/components/admin/AdminProjects";
import { AdminProjectView } from "@/components/admin/AdminProjectView";
import { TaskOverviewTable } from "@/components/admin/TaskOverviewTable";
import type { DashboardDto } from "@/lib/dashboard";
import type { MindMapDto, MindMapSummary } from "@/lib/mindmaps";
import type { AdminProjectSummary, ProjectDto, ProjectSummary, TaskDto } from "@/lib/projects";
import type { OrganizerDto, OverviewTask, TaskDetailDto } from "@/lib/tasks";
import type { TreeItem } from "@/lib/notes";
import type { AdminUserDto, ProfileDto } from "@/lib/users";
import { getLocation, navigate, refresh, subscribe } from "./shims/router";
import type { Runtime } from "./local/runtime";
import { SyncPanel, useSyncStatus } from "./ui/SyncPanel";
import { UpdateBanner } from "./ui/UpdateBanner";
import { useData } from "./ui/useData";
import { Login } from "./screens/Login";
import { Conflicts } from "./screens/Conflicts";

/**
 * Application native : connexion, coque du site (AppShell) et écrans du site
 * alimentés par l'API locale hors ligne. Les écrans « en ligne » (équipe,
 * administration, préférences…) passent par le serveur quand c'est possible.
 */

function usePath() {
  return useSyncExternalStore(subscribe, () => getLocation().pathname, () => "/");
}

/** Écrans dont l'affichage peut être actualisé sans risque quand le serveur envoie des changements. */
const PASSIVE = [/^\/dashboard$/, /^\/mindmaps$/, /^\/projects$/, /^\/projects\/sans-projet$/, /^\/conflicts$/];

export function App({ runtime }: { runtime: Runtime }) {
  const path = usePath();
  const status = useSyncStatus(runtime.sync);
  const [, setSession] = useState(0);
  const user = runtime.store.meta.user;
  const signedIn = !!(user && runtime.store.meta.token) && !status.signedOut;

  // Changements arrivés du serveur : actualisation automatique des écrans « passifs ».
  useEffect(() => {
    if (!status.remoteChanges) return;
    if (PASSIVE.some((re) => re.test(path))) {
      runtime.sync.ackRemoteChanges();
      refresh();
    }
  }, [status.remoteChanges, path, runtime.sync]);

  useEffect(() => {
    if (signedIn) runtime.sync.start();
    return () => runtime.sync.stop();
  }, [signedIn, runtime.sync]);

  if (status.upgradeRequired) return <UpgradeRequired serverUrl={runtime.store.meta.serverUrl} />;
  if (!signedIn) {
    return (
      <Login
        runtime={runtime}
        message={status.signedOut ? "Votre session a expiré : reconnectez-vous (vos modifications non envoyées sont conservées)." : undefined}
        onDone={() => {
          runtime.sync.status = { ...runtime.sync.status, signedOut: false };
          setSession((x) => x + 1);
          navigate(path === "/login" || path === "/" ? "/dashboard" : path, { replace: true });
        }}
      />
    );
  }
  if (path === "/" || path === "/login") return <Redirect to="/dashboard" />;

  return (
    <AppShell
      user={{ id: user!.id, name: user!.name, email: user!.email, avatarUrl: user!.avatarUrl, isAdmin: user!.isAdmin, reportCount: user!.reportCount }}
      statusSlot={<SyncPanel sync={runtime.sync} />}
    >
      <UpdateBanner runtime={runtime} />
      {status.remoteChanges > 0 && !PASSIVE.some((re) => re.test(path)) && (
        <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-brand-100 bg-brand-50 px-4 py-2 text-sm text-brand-700">
          <RefreshCw className="h-4 w-4" /> Des modifications sont arrivées du serveur.
          <button
            type="button"
            className="ml-auto rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-medium text-on-brand hover:bg-brand-700"
            onClick={() => {
              runtime.sync.ackRemoteChanges();
              refresh();
            }}
          >
            Actualiser
          </button>
        </div>
      )}
      <Screen key={path} path={path} runtime={runtime} />
    </AppShell>
  );
}

function Screen({ path, runtime }: { path: string; runtime: Runtime }) {
  const userId = runtime.store.meta.user!.id;
  const m = (re: RegExp) => re.exec(path);
  let r: RegExpExecArray | null;
  if (path === "/dashboard") return <DashboardScreen userName={runtime.store.meta.user!.name} />;
  if (path === "/mindmaps")
    return (
      <Loaded load={() => api.get<{ mindmaps: MindMapSummary[] }>("/mindmaps")} render={(d) => (
        <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
          <MindMapList initial={d.mindmaps} />
        </div>
      )} />
    );
  if ((r = m(/^\/mindmaps\/([^/]+)$/))) {
    const id = r[1];
    return <Loaded load={() => api.get<{ mindmap: MindMapDto }>(`/mindmaps/${id}`)} render={(d) => <MindMapEditor initial={d.mindmap} />} />;
  }
  if (path === "/projects")
    return (
      <Loaded
        load={() => Promise.all([api.get<{ projects: ProjectSummary[] }>("/projects"), api.get<{ tasks: TaskDto[] }>("/tasks")])}
        render={([p, t]) => (
          <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
            <ProjectList initial={p.projects} currentUserId={userId} orphanCount={t.tasks.filter((x) => x.status !== "CLOSED").length} />
          </div>
        )}
      />
    );
  if (path === "/projects/sans-projet") return <Loaded load={() => api.get<{ tasks: TaskDto[] }>("/tasks")} render={(d) => <OrphanTasks initial={d.tasks} />} />;
  if ((r = m(/^\/projects\/([^/]+)\/tasks\/([^/]+)$/))) return <Redirect to={`/tasks/${r[2]}`} />;
  if ((r = m(/^\/projects\/([^/]+)$/))) {
    const id = r[1];
    return <Loaded load={() => api.get<{ project: ProjectDto }>(`/projects/${id}`)} render={(d) => <ProjectWorkspace initial={d.project} currentUserId={userId} />} />;
  }
  if ((r = m(/^\/tasks\/([^/]+)$/))) {
    const id = r[1];
    return <Loaded load={() => api.get<{ task: TaskDetailDto }>(`/tasks/${id}`)} render={(d) => <TaskSheet initial={d.task} currentUserId={userId} />} />;
  }
  if (path === "/organize") return <Loaded load={() => api.get<OrganizerDto>("/me/tasks")} render={(d) => <TaskOrganizer initial={d} />} />;
  if (path === "/notes") return <Loaded load={() => api.get<{ children: TreeItem[] }>("/notes/tree?parent=root")} render={(d) => <NotesWorkspace roots={d.children} />} />;
  if (path === "/notifications") return <NotificationsPage />;
  // Messagerie : en ligne uniquement (relayée au serveur).
  if (path === "/messages" || (r = m(/^\/messages\/([^/]+)$/))) {
    const u = runtime.store.meta.user!;
    return <MessagesApp key={path} me={{ id: u.id, name: u.name, avatarUrl: u.avatarUrl ?? null }} conversationId={r?.[1]} />;
  }
  if (path === "/conflicts") return <Conflicts store={runtime.store} />;
  if (path === "/preferences") return <Loaded load={() => api.get<{ profile: ProfileDto }>("/me")} render={(d) => <PreferencesPage initial={d.profile} />} />;
  if (path === "/team") return <Loaded load={() => api.get<{ members: Parameters<typeof TeamOverview>[0]["members"]; tasks: OverviewTask[] }>("/me/team")} render={(d) => <TeamOverview members={d.members} tasks={d.tasks} />} />;
  if (path === "/admin") return <Redirect to="/admin/users" />;
  if (path.startsWith("/admin/")) return <AdminScreen path={path} userId={userId} />;
  return <Message title="Page introuvable" />;
}

/** Redirection après le rendu (jamais pendant). */
function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}

function DashboardScreen({ userName }: { userName: string }) {
  return (
    <Loaded
      load={() => Promise.all([api.get<{ dashboard: DashboardDto }>("/dashboard"), api.get<{ mindmaps: MindMapSummary[] }>("/mindmaps")])}
      render={([d, m]) => <HomeDashboard data={d.dashboard} maps={m.mindmaps} userName={userName} />}
    />
  );
}

function AdminScreen({ path, userId }: { path: string; userId: string }) {
  let body: React.ReactNode;
  let r: RegExpExecArray | null;
  if (path === "/admin/users") body = <Loaded load={() => api.get<{ users: AdminUserDto[] }>("/admin/users")} render={(d) => <AdminUsers initial={d.users} currentUserId={userId} />} />;
  else if (path === "/admin/projects") body = <Loaded load={() => api.get<{ projects: AdminProjectSummary[] }>("/admin/projects")} render={(d) => <AdminProjects projects={d.projects} />} />;
  else if ((r = /^\/admin\/projects\/([^/]+)$/.exec(path))) {
    const id = r[1];
    body = <Loaded load={() => api.get<{ project: ProjectDto & { ownerName: string } }>(`/admin/projects/${id}`)} render={(d) => <AdminProjectView project={d.project} />} />;
  } else if (path === "/admin/notifications") body = <Loaded load={() => api.get<{ settings: NotificationSettingsDto }>("/admin/notifications")} render={(d) => <AdminNotifications initial={d.settings} adminEmail="" />} />;
  else if (path === "/admin/tasks") body = <Loaded load={() => api.get<{ tasks: OverviewTask[] }>("/admin/tasks")} render={(d) => <TaskOverviewTable tasks={d.tasks} />} />;
  else body = <Message title="Page introuvable" />;
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Administration</h1>
      <p className="mt-1 text-sm text-muted">Comptes, rôles et hiérarchie ; vue d&apos;ensemble des projets et des tâches de tout le monde (lecture seule).</p>
      <AdminNav />
      <div className="mt-5">{body}</div>
    </div>
  );
}

/** Charge puis affiche ; gère chargement, introuvable et « nécessite une connexion ». */
function Loaded<T>({ load, render }: { load: () => Promise<T>; render: (data: T) => React.ReactNode }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableLoad = useMemo(() => load, []);
  const { data, error, loading } = useData(stableLoad, []);
  if (error) {
    if (error instanceof ApiClientError && error.status === 503) return <Message title="Disponible uniquement en ligne" hint="Cette page a besoin du serveur. Elle sera disponible dès le retour de la connexion." offline />;
    if (error instanceof ApiClientError && error.status === 404) return <Message title="Introuvable" hint="Cet élément n'existe pas (ou plus) sur cet appareil." />;
    if (error instanceof ApiClientError && error.status === 403) return <Message title="Accès refusé" />;
    return <Message title="Erreur" hint={error.message} />;
  }
  if (loading && !data) {
    return (
      <div className="flex flex-1 items-center justify-center p-10 text-muted">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  return <>{data !== null && render(data)}</>;
}

function Message({ title, hint, offline }: { title: string; hint?: string; offline?: boolean }) {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-2 p-10 text-center">
      {offline && <WifiOff className="h-8 w-8 text-faint" />}
      <h1 className="text-lg font-semibold">{title}</h1>
      {hint && <p className="text-sm text-muted">{hint}</p>}
    </div>
  );
}

/** Le serveur n'accepte plus cette version : on demande simplement une mise à jour. */
function UpgradeRequired({ serverUrl }: { serverUrl: string }) {
  const href = `${serverUrl.replace(/\/+$/, "")}/app`;
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-sm">
        <Download className="mx-auto mb-3 h-10 w-10 text-brand-600" />
        <h1 className="text-xl font-semibold">Mise à jour nécessaire</h1>
        <p className="mt-2 text-sm text-muted">Cette version de l&apos;application n&apos;est plus compatible avec le serveur. Installez la dernière version : vos données locales seront resynchronisées.</p>
        <button
          type="button"
          onClick={() => (window.secondBrain ? void window.secondBrain.openExternal(href) : window.open(href, "_blank"))}
          className="mt-5 rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-on-brand hover:bg-brand-700"
        >
          Télécharger la mise à jour
        </button>
      </div>
    </main>
  );
}
