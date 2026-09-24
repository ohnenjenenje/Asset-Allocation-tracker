import { API_BASE_URL, API_TIMEOUT_MS } from './config';

/** Fetch wrapper that targets the Next.js backend on Render with a long timeout
 *  (free-tier cold starts can take ~30-60s). */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function apiGetJson<T = any>(path: string): Promise<T> {
  const res = await apiFetch(path);
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from ${path} (status ${res.status})`);
  }
  return json as T;
}
