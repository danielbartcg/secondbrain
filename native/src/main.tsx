import "./app.css";
import { createRoot } from "react-dom/client";
import { createRuntime } from "./local/runtime";
import { App } from "./App";

/**
 * Point d'entrée de l'application native (desktop Electron ; iPhone plus tard).
 * En développement dans un navigateur (Vite), les appels serveur passent par
 * le relais /__remote (native/vite.config.mts).
 */
(globalThis as { __SB_DEV_PROXY__?: boolean }).__SB_DEV_PROXY__ = import.meta.env.DEV && !window.secondBrain;

async function boot() {
  const root = createRoot(document.getElementById("root")!);
  try {
    const runtime = await createRuntime();
    document.documentElement.dataset.theme = runtime.store.meta.user?.theme ?? "light";
    runtime.store.subscribe(() => {
      document.documentElement.dataset.theme = runtime.store.meta.user?.theme ?? "light";
    });
    root.render(<App runtime={runtime} />);
  } catch (e) {
    root.render(
      <main className="flex min-h-dvh items-center justify-center p-8 text-center">
        <div>
          <h1 className="text-lg font-semibold">Impossible d&apos;ouvrir la base locale</h1>
          <p className="mt-2 text-sm text-muted">{e instanceof Error ? e.message : String(e)}</p>
        </div>
      </main>,
    );
  }
}

void boot();
