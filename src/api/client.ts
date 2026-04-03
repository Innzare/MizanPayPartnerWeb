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

let isRefreshing = false;

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  skipAuthRedirect = false,
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
  if (response.status === 401 && !skipAuthRedirect && !isAuthPath) {
    if (!isRefreshing) {
      isRefreshing = true;
      const refreshed = await tryRefreshToken();
      isRefreshing = false;
      if (refreshed) {
        return request<T>(method, path, body, skipAuthRedirect);
      }
    }
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
    window.location.href = '/login';
    throw new Error('Сессия истекла');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Ошибка сервера' }));
    const message = Array.isArray(error.message) ? error.message[0] : error.message;
    throw new Error(message || `HTTP ${response.status}`);
  }

  return response.json();
}

async function uploadRequest<T>(path: string, formData: FormData): Promise<T> {
  const token = getToken();

  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  });

  if (response.status === 401) {
    if (!isRefreshing) {
      isRefreshing = true;
      const refreshed = await tryRefreshToken();
      isRefreshing = false;
      if (refreshed) return uploadRequest<T>(path, formData);
    }
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
    window.location.href = '/login';
    throw new Error('Сессия истекла');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Ошибка сервера' }));
    const message = Array.isArray(error.message) ? error.message[0] : error.message;
    throw new Error(message || `HTTP ${response.status}`);
  }

  return response.json();
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
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
};