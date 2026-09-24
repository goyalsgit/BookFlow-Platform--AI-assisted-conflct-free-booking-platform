import { NavLink, Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import { useFlow } from './context';
import { Icon } from './ui';
const links = [
  ['/', 'grid', 'Overview'],
  ['/planner', 'spark', 'Find a time'],
  ['/chat', 'spark', 'Chat assistant'],
  ['/bookings', 'calendar', 'My bookings'],
  ['/waitlist', 'list', 'Waitlist'],
  ['/inbox', 'bell', 'Inbox'],
];
export default function Shell() {
  const { user, admin, signIn, logout, workspace } = useFlow(),
    location = useLocation();
  const navigate = useNavigate();
  const signOut = () => { logout(); navigate('/'); };
  const title =
    links.find((l) => l[0] === location.pathname)?.[2] ??
    (location.pathname === '/settings' ? 'Business setup' : location.pathname === '/profile' ? 'My profile' : 'Operations');
  return (
    <div className="bf">
      <aside className="bf-sidebar">
        <Link to="/" className="bf-brand">
          <span className="bf-brand-icon">
            <Icon name="grid" size={22} />
          </span>
          bookflow<span className="bf-brand-dot">.</span>
        </Link>
        <div className="bf-workspace">
          <span className="bf-workspace-avatar">{workspace.name[0]}</span>
          <div>
            <strong>{workspace.name}</strong>
            <small>Resource workspace</small>
          </div>
          <span className="bf-workspace-chevron">⌄</span>
        </div>
        <div className="bf-nav-label">WORKSPACE</div>
        <nav>
          {links.map(([path, icon, label]) => (
            <NavLink key={path} to={path} end={path === '/'}>
              <Icon name={icon} />
              <span>{label}</span>
              {path === '/planner' && <span className="bf-nav-new">SMART</span>}
            </NavLink>
          ))}
        </nav>
        {user && <nav><NavLink to="/profile"><Icon name="grid" /><span>My profile</span></NavLink></nav>}
        <div className="bf-nav-label bf-management">MANAGEMENT</div>
        <nav>
          <NavLink to="/operations">
            <Icon name="chart" />
            <span>Operations</span>
          </NavLink>
        </nav>
        <nav>
          <NavLink to="/settings">
            <Icon name="grid" />
            <span>Business setup</span>
          </NavLink>
        </nav>
        <div className="bf-sidebar-bottom">
          <div className="bf-sidebar-note">
            <span>
              <Icon name="shield" size={19} />
              Your time, protected.
            </span>
            <p>
              One resource. One reservation.
              <br />
              Room for everything that matters.
            </p>
          </div>
          {user ? <Link className="bf-profile" to="/profile"><span className="bf-avatar">{user.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><span><strong>{user.name}</strong><small>View customer profile</small></span><Icon name="arrow" size={18} /></Link> : <button className="bf-profile" onClick={() => (admin ? signOut() : signIn())}>
            <span className="bf-avatar">
              {admin
                ? admin.name
                    .split(' ')
                    .map((p) => p[0])
                    .join('')
                    .slice(0, 2)
                : 'G'}
            </span>
            <span>
              <strong>{admin?.name ?? 'Guest workspace'}</strong>
              <small>{admin ? 'Sign out' : 'Sign in to book'}</small>
            </span>
            <Icon name={admin ? 'logout' : 'arrow'} size={18} />
          </button>}
        </div>
      </aside>
      <div className="bf-main">
        <header className="bf-topbar">
          <div className="bf-breadcrumb">
            Workspace <span>/</span> <strong>{title}</strong>
          </div>
          <div className="bf-top-actions">
            <span className="bf-timezone">
              <i />
              {workspace.timezone}
            </span>
            <Link className="bf-icon-button" to="/inbox" aria-label="Open notifications">
              <Icon name="bell" />
            </Link>
            {user ? <Link className="bf-avatar small" to="/profile" aria-label="My profile">{user.name[0]}</Link> : admin ? <Link className="bf-avatar small" to="/settings" aria-label="Business setup">{admin.name[0]}</Link> : <button className="bf-avatar small" onClick={() => signIn()} aria-label="Sign in">G</button>}
            {(user || admin) && <button className="bf-top-signout" onClick={signOut}><Icon name="logout" size={16} /><span>Sign out</span></button>}
          </div>
        </header>
        <main className="bf-content">
          <Outlet key={`${user?.id ?? 'guest'}:${admin?.id ?? 'guest'}`} />
        </main>
        <footer className="bf-footer">
          <span>BookFlow · Shared resources, thoughtfully scheduled.</span>
          <div className="bf-mobile-admin">
            <Link to="/operations">Operations</Link>
            <Link to="/settings">Business setup</Link>
          </div>
          <span>{workspace.name} · Resource workspace</span>
        </footer>
      </div>
    </div>
  );
}
