"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Link2 } from "lucide-react";
import { api } from "@/lib/client";
import type { Backlink } from "@/lib/links";
import { LINK_KIND_COLOR, LINK_KIND_LABEL } from "@/lib/shared/links";

/**
 * « Mentionné dans » : objets dont les notes contiennent un lien `[[…]]` vers
 * `objectRef` (« kind:id »). Masqué s'il n'y en a aucun ou hors ligne.
 * `refreshKey` : recharge (après un enregistrement, par exemple).
 */
export function Backlinks({ objectRef, refreshKey, className = "" }: { objectRef: string; refreshKey?: unknown; className?: string }) {
  const [items, setItems] = useState<Backlink[] | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<{ items: Backlink[] }>(`/links/backlinks?ref=${encodeURIComponent(objectRef)}`)
      .then((r) => alive && setItems(r.items))
      .catch(() => alive && setItems(null));
    return () => {
      alive = false;
    };
  }, [objectRef, refreshKey]);

  if (!items || items.length === 0) return null;
  return (
    <section className={`rounded-2xl border border-line bg-surface p-4 ${className}`} aria-label="Mentionné dans">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Link2 className="h-4 w-4 text-brand-600" /> Mentionné dans
        <span className="rounded-full bg-surface-3 px-1.5 text-xs font-normal text-muted">{items.length}</span>
      </h2>
      <ul className="mt-2 divide-y divide-line">
        {items.map((b) => (
          <li key={b.ref} className="py-2">
            <Link href={b.href} className="group block">
              <span className="flex items-baseline gap-2">
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide" style={{ color: LINK_KIND_COLOR[b.kind] }}>
                  {LINK_KIND_LABEL[b.kind]}
                </span>
                <span className="min-w-0 truncate text-sm font-medium group-hover:text-brand-700">{b.title}</span>
                <span className="ml-auto hidden shrink-0 truncate text-xs text-muted sm:block">{b.context}</span>
              </span>
              {b.excerpt && <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{b.excerpt}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
