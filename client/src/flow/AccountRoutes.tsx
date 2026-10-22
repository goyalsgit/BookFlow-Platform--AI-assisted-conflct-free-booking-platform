import { Link, Outlet } from 'react-router-dom';
import { useFlow } from './context';
import { Empty } from './ui';

/** One shared entry point for pages that need a customer or owner session. */
export default function AccountRoutes({ allowOwner = false }: { allowOwner?: boolean }) {
  const { user, admin, signIn } = useFlow();

  if (user || (allowOwner && admin)) return <Outlet />;

  return (
    <Empty title={admin ? 'This page belongs to a customer account' : 'Sign in to your account'}>
      <p>
        {admin
          ? 'You are signed in as a business owner. Use your workspace to manage customer reservations.'
          : 'Sign in once to access your bookings, waitlist, profile, and notifications.'}
      </p>
      {admin && (
        <Link className="bf-button secondary" to="/operations">
          Open business workspace
        </Link>
      )}
      <button className="bf-button primary" onClick={() => signIn()}>
        {admin ? 'Switch to a customer account' : 'Sign in'}
      </button>
    </Empty>
  );
}
