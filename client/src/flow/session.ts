import type { User } from './types';

// Browser persistence only. The API verifies the JWT and account permissions.
export const customerKey = 'bookflow_customer';
export const adminKey = 'bookflow_admin';
export const authChangedEvent = 'bookflow:auth-changed';
export function session(admin = false): { token: string; user: User } | null {
  try {
    const key = admin ? adminKey : customerKey;
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!saved?.token || !saved?.user) return null;
    const payload = JSON.parse(
      atob(saved.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    );
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
