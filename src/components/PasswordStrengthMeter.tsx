"use client";

import { passwordStrength } from "@/lib/shared/password";

/** Jauge de sécurité du mot de passe : faible / moyenne / élevée (indicative). */
export function PasswordStrengthMeter({ password, personal = [] }: { password: string; personal?: string[] }) {
  const s = passwordStrength(password, personal);
  if (s.level === "empty") return null;
  const filled = s.level === "strong" ? 3 : s.level === "medium" ? 2 : 1;
  const color = s.level === "strong" ? "bg-ok" : s.level === "medium" ? "bg-warn" : "bg-danger";
  const text = s.level === "strong" ? "text-ok" : s.level === "medium" ? "text-warn" : "text-danger";
  return (
    <div className="mt-1.5" aria-live="polite">
      <div className="flex gap-1" role="meter" aria-label="Sécurité du mot de passe" aria-valuemin={0} aria-valuemax={3} aria-valuenow={s.level === "short" ? 0 : filled} aria-valuetext={s.label}>
        {[1, 2, 3].map((i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= filled && s.level !== "short" ? color : "bg-surface-3"}`} />
        ))}
      </div>
      <p className="mt-1 text-xs">
        <span className={`font-medium ${text}`}>{s.level === "short" ? s.label : `Sécurité : ${s.label.toLowerCase()}`}</span>
        <span className="text-muted"> — {s.hint}</span>
      </p>
    </div>
  );
}
