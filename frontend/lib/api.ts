import type { RefreshResponse } from './types';

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const ACCESS_TOKEN_KEY = 'loc_access_token';
const REFRESH_TOKEN_KEY = 'loc_refresh_token';
const USER_KEY = 'loc_user';

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setTokens(token: string, refreshToken: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(ACCESS_TOKEN_KEY, token);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function clearTokens() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function storeUser(user: unknown) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function loadStoredUser<T>(): T | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

function redirectToLogin() {
  clearTokens();
  if (typeof window !== 'undefined') {
    window.location.href = '/auth/login';
  }
}

// Single-flight refresh: concurrent 401s share one refresh request.
let refreshPromise: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refreshToken = getRefreshToken();
      if (!refreshToken) return false;
      try {
        const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
        if (!res.ok) return false;
        const data = (await res.json()) as RefreshResponse;
        setTokens(data.token, data.refresh_token);
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      // allow future refreshes after this one settles
      setTimeout(() => {
        refreshPromise = null;
      }, 0);
    });
  }
  return refreshPromise;
}

async function parseError(res: Response): Promise<ApiError> {
  let detail: unknown = null;
  let message = `Request failed (${res.status})`;
  try {
    const body = await res.json();
    detail = body;
    if (typeof body?.detail === 'string') message = body.detail;
    else if (typeof body?.message === 'string') message = body.message;
    else if (Array.isArray(body?.detail) && body.detail[0]?.msg) {
      message = body.detail[0].msg;
    }
  } catch {
    // non-JSON body, keep default message
  }
  return new ApiError(res.status, message, detail);
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  /** raw FormData body — skips JSON serialization */
  formData?: FormData;
  /** skip auth header (e.g. login/register) */
  noAuth?: boolean;
  signal?: AbortSignal;
}

async function rawRequest(path: string, options: ApiOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  if (!options.formData) {
    headers['Content-Type'] = 'application/json';
  }
  if (!options.noAuth) {
    const token = getAccessToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return fetch(`${API_BASE}${path}`, {
    method: options.method || (options.body || options.formData ? 'POST' : 'GET'),
    headers,
    body: options.formData
      ? options.formData
      : options.body !== undefined
        ? JSON.stringify(options.body)
        : undefined,
    signal: options.signal,
  });
}

/**
 * Core fetch wrapper. Attaches Authorization, refreshes on 401 (once),
 * redirects to /auth/login if refresh fails.
 */
export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  let res = await rawRequest(path, options);

  if (res.status === 401 && !options.noAuth) {
    const refreshed = await refreshTokens();
    if (!refreshed) {
      redirectToLogin();
      throw new ApiError(401, 'Session expired. Please sign in again.');
    }
    res = await rawRequest(path, options);
    if (res.status === 401) {
      redirectToLogin();
      throw new ApiError(401, 'Session expired. Please sign in again.');
    }
  }

  if (!res.ok) {
    throw await parseError(res);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await res.json()) as T;
  }
  return (await res.text()) as unknown as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) =>
    apiFetch<T>(path, { method: 'GET', signal }),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData, method: string = 'POST') =>
    apiFetch<T>(path, { method, formData }),
};

/** Download a file (e.g. CSV export) with auth, triggering a browser download. */
export async function apiDownload(path: string, filename: string): Promise<void> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw await parseError(res);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Build the websocket URL for the inbox stream. */
export function buildWsUrl(): string | null {
  const token = getAccessToken();
  if (!token) return null;
  const wsBase = API_BASE.replace(/^http/, 'ws');
  return `${wsBase}/ws/inbox?token=${encodeURIComponent(token)}`;
}
