import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { request } from './api';
import { ErrorMessage, Icon } from './ui';

export default function AccountAction({ purpose }: { purpose: 'verify' | 'reset' }) {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const started = useRef(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (purpose !== 'verify' || started.current) return;
    started.current = true;
    if (!token) {
      setError('This verification link is incomplete.');
      return;
    }
    setBusy(true);
    request<void>('/account/verify', 'POST', { token })
      .then(() => setDone(true))
      .catch((failure) => setError(failure.message))
      .finally(() => setBusy(false));
  }, [purpose, token]);
  return (
    <div className="bf-page-heading">
      <section className="bf-panel bf-settings-panel">
        <h1>
          {purpose === 'verify' ? 'Verify your email' : 'Reset your password'}
          <span>.</span>
        </h1>
        {busy && <p>Working…</p>}
        {done && (
          <p role="status">
            {purpose === 'verify'
              ? 'Your email is verified. You can sign in.'
              : 'Your password was updated. You can sign in.'}
          </p>
        )}
        <ErrorMessage message={error} />
        {purpose === 'reset' && !done && (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (!token) {
                setError('This reset link is incomplete.');
                return;
              }
              setBusy(true);
              setError('');
              try {
                await request<void>('/account/reset', 'POST', { token, newPassword: password });
                setDone(true);
              } catch (failure: any) {
                setError(failure.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              New password
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button className="bf-button primary" disabled={busy}>
              Update password
            </button>
          </form>
        )}
        <Link className="bf-button secondary" to="/">
          <Icon name="arrow" size={16} /> Return to BookFlow
        </Link>
      </section>
    </div>
  );
}
