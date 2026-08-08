export const apiBaseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(status === 401 ? 'Authentication required' : 'Request failed');
    this.name = 'ApiError';
  }
}

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | undefined;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | undefined): () => void {
  unauthorizedHandler = handler;
  return () => {
    if (unauthorizedHandler === handler) unauthorizedHandler = undefined;
  };
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (response.status === 401) unauthorizedHandler?.();
  if (!response.ok) throw new ApiError(response.status);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
