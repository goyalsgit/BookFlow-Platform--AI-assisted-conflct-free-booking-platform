import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { request, session, customerKey, adminKey, authChangedEvent } from './api';
import type { Resource, User } from './types';
import { Icon, ErrorMessage } from './ui';
type Workspace = { demoMode?:boolean; assistantProvider?:string; id: number; name: string; timezone: string; cancellation_cutoff_min: number };
type Context = {
  workspace: Workspace;
  resources: Resource[];
  loading: boolean;
  error: string;
  user: User | null;
  admin: User | null;
  signIn: (admin?: boolean) => void;
  logout: () => void;
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
    Promise.all([request<Workspace>('/workspace'),request<Resource[]>('/resources')])
      .then(([workspace,resources])=>{setWorkspace(workspace);setResources(resources);})
      .catch(e=>setError(e.message)).finally(()=>setLoading(false));
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
        logout: () => {
          localStorage.removeItem(customerKey);
          localStorage.removeItem(adminKey);
          setUser(null);
          setAdmin(null);
          refresh();
        },
        updateCustomer: (next) => {
          const current = session();
          if (current) localStorage.setItem(customerKey, JSON.stringify({ ...current, user: next }));
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
            if (business) setAdmin(u);
            else setUser(u);
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
  const {workspace}=useFlow();
  const navigate = useNavigate();
  const [selectedMode, setSelectedMode] = useState(mode);
  const [register, setRegister] = useState(false),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [name, setName] = useState(''),
    [businessName, setBusinessName] = useState(''),
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
          <button type="button" className={selectedMode === 'customer' ? 'active' : ''} onClick={() => { setSelectedMode('customer'); setRegister(false); setError(''); }}>Book a slot</button>
          <button type="button" className={selectedMode === 'admin' ? 'active' : ''} onClick={() => { setSelectedMode('admin'); setRegister(false); setError(''); }}>Publish slots</button>
        </div>
        <h2 id="login-heading">
          {register
            ? selectedMode === 'admin' ? 'Create your business workspace.' : 'Make room for what matters.'
            : selectedMode === 'admin'
              ? 'Your operations workspace.'
              : 'Welcome to BookFlow.'}
        </h2>
        <p className="bf-muted">
          {selectedMode === 'admin'
            ? 'Sign in to publish available times and manage reservations.'
            : 'Sign in to hold a time, confirm a booking and join a waitlist.'}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              const result = await request<{ token: string; user: User }>(
                selectedMode === 'admin'
                  ? register ? '/admin/register' : '/admin/session'
                  : register ? '/register' : '/session',
                'POST',
                { email, password, ...(register ? { name, ...(selectedMode === 'admin' ? { businessName } : {}) } : {}) },
              );
              localStorage.setItem(
                selectedMode === 'admin' ? adminKey : customerKey,
                JSON.stringify(result),
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
          {register && (
            <>
            {selectedMode === 'admin' && <label>Business name<input required minLength={2} maxLength={100} value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. Downtown studio" /></label>}
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
          <ErrorMessage message={error} />
          <button className="bf-button primary full" disabled={busy}>
            {busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}
            <Icon name="arrow" size={18} />
          </button>
        </form>
        {!register && workspace.demoMode && (
          <button
            className="bf-demo-button"
            onClick={() => {
              setEmail(selectedMode === 'admin' ? 'admin@bookflow.local' : 'customer@bookflow.local');
              setPassword(selectedMode === 'admin' ? 'admin123' : 'customer123');
            }}
          >
            Fill demo {selectedMode === 'admin' ? 'business' : 'customer'} credentials
          </button>
        )}
        {(
          <p className="bf-login-switch">
            {register ? 'Already have an account?' : 'New here?'}{' '}
            <button
              onClick={() => {
                setRegister(!register);
                setError('');
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
