const API_URL = import.meta.env.VITE_API_URL as string;

function getToken(): string | null {
  return localStorage.getItem('access_token');
}

async function tryRefreshToken(): Promise<boolean> {
  const refreshToken = localStorage.getItem('refresh_token');
  if (!refreshToken) return false;

  try {
    const response = await fetch(`${API_URL}/auth/investor/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) return false;

    const data = await response.json();
    localStorage.setItem('access_token', data.accessToken);
    localStorage.setItem('refresh_token', data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

// Shared refresh promise. When several requests hit 401 in parallel
// (typical on page load — 5 stores fetch at once), they all await the
// SAME refresh call here instead of each one racing to /auth/refresh.
// First caller starts the refresh; everyone else gets the result, then
// retries their own request. Previous boolean-flag version made every
// non-first caller fall through to logout, which is why partners got
// kicked even though refresh would have worked.
let refreshPromise: Promise<boolean> | null = null;

function ensureRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = tryRefreshToken().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

function clearSessionAndRedirect(): never {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('user');
  window.location.href = '/login';
  throw new Error('Сессия истекла');
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  skipAuthRedirect = false,
  // `_retried` caps the refresh→retry chain at one round per request. If
  // the brand-new access token from refresh STILL gets a 401 back (e.g.
  // the partner got blocked server-side during the refresh, or there's
  // clock skew), bail out instead of looping. Private — callers should
  // not set this.
  _retried = false,
): Promise<T> {
  const token = getToken();

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const isAuthPath = path.startsWith('/auth/');
  // Public endpoints (e.g. /public/co-investors/:token/...) are token-based,
  // not JWT — a 401 there has nothing to do with the user's partner session.
  // Skip the /login redirect so the page can render its own error state.
  const isPublicPath = path.startsWith('/public/');
  // If there's no token in storage at all, the user is anonymous — they have
  // no session to expire, so redirecting them to /login on a background 401
  // makes no sense (and breaks public pages like /investor/:token that the
  // shared partner layout might brush against).
  const hasToken = !!token;
  if (response.status === 401 && !skipAuthRedirect && !isAuthPath && !isPublicPath && hasToken) {
    if (_retried) {
      // We already burned one refresh-and-retry for this request and the
      // fresh token also got rejected. Don't loop.
      clearSessionAndRedirect();
    }
    // Every parallel 401 awaits the same refresh; only the actual refresh
    // failure (no/invalid refresh token, server error) triggers logout.
    const refreshed = await ensureRefresh();
    if (refreshed) {
      return request<T>(method, path, body, skipAuthRedirect, true);
    }
    clearSessionAndRedirect();
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Ошибка сервера' }));
    const message = Array.isArray(error.message) ? error.message[0] : error.message;
    const err = new Error(message || `HTTP ${response.status}`);
    // Пробрасываем структурированные поля (code/status) — фронт распознаёт
    // тарифные блокировки (DEAL_LOCKED, CASHBOX_LIMIT и т.п.).
    (err as any).code = error.code;
    (err as any).status = response.status;
    throw err;
  }

  return response.json();
}

async function uploadRequest<T>(path: string, formData: FormData, _retried = false): Promise<T> {
  const token = getToken();

  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  });

  if (response.status === 401) {
    if (_retried) clearSessionAndRedirect();
    const refreshed = await ensureRefresh();
    if (refreshed) return uploadRequest<T>(path, formData, true);
    clearSessionAndRedirect();
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Ошибка сервера' }));
    const message = Array.isArray(error.message) ? error.message[0] : error.message;
    const err = new Error(message || `HTTP ${response.status}`);
    // Пробрасываем структурированные поля (code/status) — фронт распознаёт
    // тарифные блокировки (DEAL_LOCKED, CASHBOX_LIMIT и т.п.).
    (err as any).code = error.code;
    (err as any).status = response.status;
    throw err;
  }

  return response.json();
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
  // Silent version — won't redirect on 401, just throws
  getSilent: <T>(path: string) => request<T>('GET', path, undefined, true),
  upload: async (file: File, folder: string): Promise<string> => {
    const formData = new FormData();
    formData.append('file', file);
    const result = await uploadRequest<{ url: string }>(
      `/upload?folder=${encodeURIComponent(folder)}`,
      formData,
    );
    return result.url;
  },
  uploadDocument: async (file: File, folder: string): Promise<string> => {
    // `/upload` rejects PDFs (images-only filter). Documents (PDF/DOC/DOCX
    // etc.) go through the dedicated `/upload/document` endpoint that
    // accepts them with a 20MB limit.
    const formData = new FormData();
    formData.append('file', file);
    const result = await uploadRequest<{ url: string }>(
      `/upload/document?folder=${encodeURIComponent(folder)}`,
      formData,
    );
    return result.url;
  },
  uploadMultiple: async (files: File[], folder: string): Promise<string[]> => {
    const formData = new FormData();
    files.forEach((f) => formData.append('files', f));
    const result = await uploadRequest<{ urls: string[] }>(
      `/upload/multiple?folder=${encodeURIComponent(folder)}`,
      formData,
    );
    return result.urls;
  },
  deleteFile: async (url: string): Promise<void> => {
    await request<void>('DELETE', `/upload?url=${encodeURIComponent(url)}`);
  },
  uploadTo: async <T>(path: string, file: File, extraFields?: Record<string, string>): Promise<T> => {
    const formData = new FormData();
    formData.append('file', file);
    if (extraFields) {
      for (const [k, v] of Object.entries(extraFields)) formData.append(k, v);
    }
    return uploadRequest<T>(path, formData);
  },
};