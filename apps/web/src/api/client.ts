const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';

/** An API failure carrying the status so callers can react to 401/409 specifically. */
export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

type RequestOptions = { method?: string; body?: unknown; token?: string | null };

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token } = options;

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(method === 'POST' && path === '/events' ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // A network-level failure is indistinguishable from the API being down;
    // say so plainly instead of leaking a fetch stack trace to the user.
    throw new ApiError(0, 'Não foi possível falar com o servidor. A API está rodando?');
  }

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof payload?.message === 'string' ? payload.message : 'Algo deu errado. Tente novamente.';
    throw new ApiError(response.status, message);
  }
  return payload as T;
}

export const formatBRL = (cents: number): string =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' });

export const posterUrl = (path: string | null, size: 'w342' | 'w780' = 'w342'): string | null =>
  path === null ? null : `https://image.tmdb.org/t/p/${size}${path}`;
