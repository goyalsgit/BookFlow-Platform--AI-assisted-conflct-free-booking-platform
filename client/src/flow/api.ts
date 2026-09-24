import type { User } from './types';
export const customerKey = 'bookflow_customer';
export const adminKey = 'bookflow_admin';
export const authChangedEvent = 'bookflow:auth-changed';
export function session(admin = false): { token: string; user: User } | null {
  try {
    const key = admin ? adminKey : customerKey;
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!saved?.token || !saved?.user) return null;
    const payload = JSON.parse(atob(saved.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) {
      localStorage.removeItem(key);
      return null;
    }
    return saved;
  } catch {
    localStorage.removeItem(admin ? adminKey : customerKey);
    return null;
  }
}
export async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const admin = path.startsWith('/admin') || (path === '/workspace' && !!session(true));
  const isAuthEndpoint = ['/session', '/register', '/admin/session', '/admin/register'].includes(path);
  const token = isAuthEndpoint ? undefined : session(admin)?.token;
  let response: Response;
  try {
    response = await fetch('/api/flow' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Cannot reach BookFlow. Check that the API server is running and try again.');
  }
  const data = await response.json().catch(() => null);
  if (!data) throw new Error('The API did not return a valid response. Check that the server is running.');
  if (response.status === 401 && token) {
    localStorage.removeItem(admin ? adminKey : customerKey);
    window.dispatchEvent(new Event(authChangedEvent));
  }
  if (!response.ok) throw new Error(data.details?.join('. ') || data.error || 'Request failed');
  return data;
}
export function dateInZone(value = new Date(), timezone = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}
export function tomorrow(timezone='Asia/Kolkata') {
  return new Date(Date.parse(dateInZone(new Date(),timezone)+'T12:00:00Z')+86400000).toISOString().slice(0,10);
}
export function timeLabel(value: string, timezone = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}
export function dayLabel(value: string, timezone = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: value.length===10?'UTC':timezone,
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date(value.length === 10 ? value + 'T12:00:00Z' : value));
}
export const labels: Record<string, string> = {
  sports_court: 'Sports courts',
  clinician: 'Clinicians',
  lab_instrument: 'Lab equipment',
  meeting_room: 'Meeting rooms',
};

export const typeLabel = (type: string) =>
  labels[type] ?? type.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
