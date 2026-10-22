import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { request } from './api';
import { useFlow } from './context';
import { ErrorMessage } from './ui';

export default function PasswordForm({ admin = false }: { admin?: boolean }) {
  const { logout } = useFlow();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <section className="bf-panel bf-settings-panel">
      <h2>Change password</h2>
      <p>Changing your password signs out every session for this account.</p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            await request<void>(admin ? '/admin/password' : '/profile/password', 'POST', {
              currentPassword,
              newPassword,
            });
            await logout();
            navigate('/');
          } catch (failure: any) {
            setError(failure.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Current password
          <input
            type="password"
            autoComplete="current-password"
            required
            minLength={8}
            maxLength={128}
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </label>
        <label>
          New password
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </label>
        <ErrorMessage message={error} />
        <button className="bf-button secondary" disabled={busy}>
          {busy ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </section>
  );
}
