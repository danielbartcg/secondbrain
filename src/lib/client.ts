"use client";

/**
 * Client HTTP de l'API /api/v1 pour le navigateur (cookie de session).
 * Une application mobile ferait les mêmes appels avec un header
 * `Authorization: Bearer <token>` — voir docs/04-api.md.
 */

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: body instanceof FormData ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    credentials: "same-origin",
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string; details?: unknown } };
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !location.pathname.startsWith("/login")) {
      location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
    }
    const err = data.error ?? { code: "HTTP_" + res.status, message: `Erreur ${res.status}` };
    throw new ApiClientError(res.status, err.code, err.message, err.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};

export async function uploadImage(file: File): Promise<string | null> {
  const form = new FormData();
  form.append("file", file);
  try {
    const { url } = await api.post<{ url: string }>("/uploads", form);
    return url;
  } catch {
    return null;
  }
}
