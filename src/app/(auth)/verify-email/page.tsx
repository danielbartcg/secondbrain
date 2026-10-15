"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, ApiClientError } from "@/lib/client";
import { AuthFrame, authButtonClass } from "@/components/AuthFrame";

/** Lien de validation d'adresse reçu par e-mail (bienvenue ou changement d'adresse). */
function Verify() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!token) {
      setState({ ok: false, text: "Lien incomplet : ouvrez le lien reçu par e-mail tel quel." });
      return;
    }
    api
      .post<{ email: string }>("/auth/verify-email", { token })
      .then((r) => setState({ ok: true, text: `Merci ! L'adresse ${r.email} est validée.` }))
      .catch((e) => setState({ ok: false, text: e instanceof ApiClientError ? e.message : "Validation impossible." }));
  }, [token]);

  if (!state) return <p className="text-sm text-muted">Validation en cours…</p>;
  return (
    <div className="space-y-4 text-sm">
      <p className={`rounded-lg px-3 py-2 ${state.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-danger"}`}>{state.text}</p>
      {!state.ok && <p className="text-muted">Vous pouvez demander un nouveau lien depuis Préférences → Adresse e-mail.</p>}
      <Link href="/dashboard" className={`${authButtonClass} block text-center`}>
        Ouvrir Second Brain
      </Link>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <AuthFrame title="Validation de l'adresse e-mail">
      <Suspense>
        <Verify />
      </Suspense>
    </AuthFrame>
  );
}
