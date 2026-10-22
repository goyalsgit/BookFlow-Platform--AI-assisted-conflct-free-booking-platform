import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { request } from './api';
import { session, customerKey, adminKey, authChangedEvent } from './session';
import type { Resource, User } from './types';
import { Icon, ErrorMessage } from './ui';
type Workspace = {
  demoMode?: boolean;
  assistantProvider?: string;
  id: number;
  name: string;
  business_type?: string;
  timezone: string;
  cancellation_cutoff_min: number;
};
type Context = {
  workspace: Workspace;
  resources: Resource[];
  loading: boolean;
  error: string;
  user: User | null;
  admin: User | null;
  signIn: (admin?: boolean) => void;
  logout: () => Promise<void>;
  updateCustomer: (user: User) => void;
  toast: (text: string) => void;
  refresh: () => void;
};
const Ctx = createContext<Context>(null!);
export const useFlow = () => useContext(Ctx);
export function FlowProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<Workspace>({
    id: 1,
    name: 'Your workspace',
    timezone: 'Asia/Kolkata',
    cancellation_cutoff_min: 60,
  });
  const [resources, setResources] = useState<Resource[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [user, setUser] = useState(session()?.user ?? null),
    [admin, setAdmin] = useState(session(true)?.user ?? null);
  const [dialog, setDialog] = useState<'customer' | 'admin' | null>(null),
    [message, setMessage] = useState('');
  const refresh = () => {
    setLoading(true);
    setError('');
    Promise.all([request<Workspace>('/workspace'), request<Resource[]>('/resources')])
      .then(([workspace, resources]) => {
        setWorkspace(workspace);
        setResources(resources);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(refresh, []);
  useEffect(() => {
    const syncAuth = () => {
      setUser(session()?.user ?? null);
      setAdmin(session(true)?.user ?? null);
      refresh();
    };
    window.addEventListener(authChangedEvent, syncAuth);
    window.addEventListener('storage', syncAuth);
    return () => {
      window.removeEventListener(authChangedEvent, syncAuth);
      window.removeEventListener('storage', syncAuth);
    };
  }, []);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(''), 5000);
    return () => clearTimeout(t);
  }, [message]);
  return (
    <Ctx.Provider
      value={{
        workspace,
        resources,
        loading,
        error,
        user,
        admin,
        signIn: (a = false) => setDialog(a ? 'admin' : 'customer'),
        logout: async () => {
          const revocations: Promise<unknown>[] = [];
          if (session()) revocations.push(request('/logout', 'POST'));
          if (session(true)) revocations.push(request('/admin/logout', 'POST'));
          await Promise.allSettled(revocations);
          localStorage.removeItem(customerKey);
          localStorage.removeItem(adminKey);
          setUser(null);
          setAdmin(null);
          refresh();
        },
        updateCustomer: (next) => {
          const current = session();
          if (current)
            localStorage.setItem(customerKey, JSON.stringify({ ...current, user: next }));
          setUser(next);
        },
        toast: setMessage,
        refresh,
      }}
    >
      {children}
      {message && (
        <div className="bf-toast" role="status">
          <Icon name="check" />
          {message}
          <button aria-label="Dismiss notification" onClick={() => setMessage('')}>
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      {dialog && (
        <LoginDialog
          mode={dialog}
          close={() => setDialog(null)}
          done={(u, business) => {
            if (business) {
              setAdmin(u);
              setUser(null);
            } else {
              setUser(u);
              setAdmin(null);
            }
            setDialog(null);
            setMessage('Welcome back. Your workspace is ready.');
            refresh();
          }}
        />
      )}
    </Ctx.Provider>
  );
}
function LoginDialog({
  mode,
  close,
  done,
}: {
  mode: 'customer' | 'admin';
  close: () => void;
  done: (u: User, business: boolean) => void;
}) {
  const { workspace } = useFlow();
  const navigate = useNavigate();
  const [selectedMode, setSelectedMode] = useState(mode);
  const [register, setRegister] = useState(false),
    [recover, setRecover] = useState(false),
    [info, setInfo] = useState(''),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [name, setName] = useState(''),
    [businessName, setBusinessName] = useState(''),
    [businessType, setBusinessType] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);
  return (
    <div className="bf-modal-backdrop" onClick={close}>
      <section
        className="bf-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-heading"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="bf-modal-close" onClick={close} aria-label="Close sign in">
          <Icon name="close" />
        </button>
        <div className="bf-brand-icon">
          <Icon name="grid" size={24} />
        </div>
        <div className="bf-login-roles" role="group" aria-label="Account type">
          <button
            type="button"
            className={selectedMode === 'customer' ? 'active' : ''}
            onClick={() => {
              setSelectedMode('customer');
              setRegister(false);
              setRecover(false);
              setError('');
              setInfo('');
            }}
          >
            Customer
          </button>
          <button
            type="button"
            className={selectedMode === 'admin' ? 'active' : ''}
            onClick={() => {
              setSelectedMode('admin');
              setRegister(false);
              setRecover(false);
              setError('');
              setInfo('');
            }}
          >
            Business owner
          </button>
        </div>
        <h2 id="login-heading">
          {recover
            ? 'Reset your password.'
            : register
              ? selectedMode === 'admin'
                ? 'Create your business workspace.'
                : 'Make room for what matters.'
              : selectedMode === 'admin'
                ? 'Your operations workspace.'
                : 'Welcome to BookFlow.'}
        </h2>
        <p className="bf-muted">
          {selectedMode === 'admin'
            ? 'Create your business, publish your own resources and manage reservations.'
            : 'Sign in to hold a time, confirm a booking and join a waitlist.'}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            setInfo('');
            try {
              if (recover) {
                await request('/account/reset-request', 'POST', { email, kind: selectedMode });
                setInfo('If that account exists, check its email for a reset link.');
                return;
              }
              const result = await request<{
                token?: string;
                user?: User;
                verificationRequired?: boolean;
              }>(
                selectedMode === 'admin'
                  ? register
                    ? '/admin/register'
                    : '/admin/session'
                  : register
                    ? '/register'
                    : '/session',
                'POST',
                {
                  email,
                  password,
                  ...(register
                    ? { name, ...(selectedMode === 'admin' ? { businessName, businessType } : {}) }
                    : {}),
                },
              );
              if (result.verificationRequired) {
                setRegister(false);
                setInfo('Check your email for a verification link, then sign in.');
                return;
              }
              if (!result.token || !result.user)
                throw new Error('The account response was incomplete.');
              const otherKind = selectedMode === 'admin' ? 'customer' : 'admin';
              if (session(otherKind === 'admin'))
                await request(otherKind === 'admin' ? '/admin/logout' : '/logout', 'POST').catch(
                  () => {},
                );
              localStorage.removeItem(otherKind === 'admin' ? adminKey : customerKey);
              localStorage.setItem(
                selectedMode === 'admin' ? adminKey : customerKey,
                JSON.stringify({ token: result.token, user: result.user }),
              );
              done(result.user, selectedMode === 'admin');
              if (selectedMode === 'admin') navigate('/settings');
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {register && !recover && (
            <>
              {selectedMode === 'admin' && (
                <>
                  <label>
                    Business name
                    <input
                      required
                      minLength={2}
                      maxLength={100}
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      placeholder="e.g. Downtown studio"
                    />
                  </label>
                  <label>
                    What type of business do you own?
                    <input
                      required
                      minLength={2}
                      maxLength={80}
                      value={businessType}
                      onChange={(e) => setBusinessType(e.target.value)}
                      placeholder="e.g. Salon, clinic, sports turf"
                      list="bookflow-business-types"
                    />
                  </label>
                  <datalist id="bookflow-business-types">
                    <option value="Salon" />
                    <option value="Clinic" />
                    <option value="Sports turf" />
                    <option value="Studio" />
                    <option value="Education" />
                    <option value="Other" />
                  </datalist>
                </>
              )}
              <label>
                Your name
                <input
                  autoFocus
                  required
                  minLength={2}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            </>
          )}
          <label>
            Email address
            <input
              autoFocus={!register}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
          {!recover && (
            <label>
              Password
              <input
                type="password"
                autoComplete={register ? 'new-password' : 'current-password'}
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
            </label>
          )}
          <ErrorMessage message={error} />
          {info && (
            <p className="bf-input-hint" role="status">
              {info}
            </p>
          )}
          <button className="bf-button primary full" disabled={busy}>
            {busy
              ? 'Please wait…'
              : recover
                ? 'Send reset link'
                : register
                  ? 'Create account'
                  : 'Sign in'}
            <Icon name="arrow" size={18} />
          </button>
        </form>
        {!register && !recover && workspace.demoMode && (
          <button
            className="bf-demo-button"
            onClick={() => {
              setEmail(
                selectedMode === 'admin' ? 'admin@bookflow.local' : 'customer@bookflow.local',
              );
              setPassword(selectedMode === 'admin' ? 'admin123' : 'customer123');
            }}
          >
            Fill demo {selectedMode === 'admin' ? 'business' : 'customer'} credentials
          </button>
        )}
        {!register && !recover && (
          <button
            className="bf-text-button"
            onClick={() => {
              setRecover(true);
              setError('');
              setInfo('');
            }}
          >
            Forgot password?
          </button>
        )}
        {!register && !recover && (
          <button
            className="bf-text-button"
            onClick={async () => {
              try {
                await request('/account/verify-request', 'POST', { email, kind: selectedMode });
                setInfo('If verification is needed, check that email for a link.');
              } catch (e: any) {
                setError(e.message);
              }
            }}
          >
            Resend verification email
          </button>
        )}
        {recover && (
          <button
            className="bf-text-button"
            onClick={() => {
              setRecover(false);
              setInfo('');
            }}
          >
            Back to sign in
          </button>
        )}
        {!recover && (
          <p className="bf-login-switch">
            {register ? 'Already have an account?' : 'New here?'}{' '}
            <button
              onClick={() => {
                setRegister(!register);
                setError('');
                setInfo('');
              }}
            >
              {register ? 'Sign in' : 'Create an account'}
            </button>
          </p>
        )}
      </section>
    </div>
  );
}
