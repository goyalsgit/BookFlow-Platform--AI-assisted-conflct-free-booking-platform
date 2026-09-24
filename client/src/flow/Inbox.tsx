import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useFlow } from './context';
import { request, dayLabel, timeLabel } from './api';
import type { Notice } from './types';
import { Icon, Empty, ErrorMessage, Loading } from './ui';
type InboxNotice = Notice & { audience: 'customer' | 'admin' };
export default function Inbox() {
  const { user, admin, signIn } = useFlow();
  const [items, setItems] = useState<InboxNotice[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!user && !admin) {
      setItems([]);
      setLoading(false);
      return;
    }
    const load = () => {
      const sources: Promise<InboxNotice[]>[] = [];
      if (user) sources.push(request<Notice[]>('/notifications').then((notices) =>
        notices.map((notice) => ({ ...notice, audience: 'customer' as const }))));
      if (admin) sources.push(request<Notice[]>('/admin/notifications').then((notices) =>
        notices.map((notice) => ({ ...notice, audience: 'admin' as const }))));
      Promise.all(sources)
        .then((groups) => {
          setItems(groups.flat().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)));
          setError('');
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    };
    setLoading(true);
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => clearInterval(timer);
  }, [user?.id, admin?.id]);
  return (
    <>
      <div className="bf-page-heading">
        <div>
          <div className="bf-eyebrow">IN THE LOOP</div>
          <h1>
            A little update for you<span>.</span>
          </h1>
          <p>{admin && !user ? 'Recent booking activity across your business.' : 'Booking confirmations, changes and the openings you’ve been waiting for.'}</p>
        </div>
      </div>
      <ErrorMessage message={error} />
      {!user && !admin ? (
        <Empty title="Your updates are waiting" icon="bell">
          <button className="bf-button primary" onClick={() => signIn()}>
            Sign in
          </button>
        </Empty>
      ) : loading ? (
        <Loading />
      ) : items.length ? (
        <div className="bf-inbox-list">
          {items.map((n) => (
            <article className="bf-panel bf-notice" key={`${n.audience}:${n.id}`}>
              <span className="bf-summary-icon green">
                <Icon name={n.title.includes('held') ? 'clock' : 'bell'} />
              </span>
              <div>
                <h3>{n.title}</h3>
                <p>{n.message}</p>
                <small>
                  {dayLabel(n.created_at)} · {timeLabel(n.created_at)}
                </small>
              </div>
              <Link to={n.audience === 'admin' ? '/operations' : '/bookings'} aria-label={n.audience === 'admin' ? 'View operations' : 'View bookings'}>
                <Icon name="arrow" />
              </Link>
            </article>
          ))}
        </div>
      ) : (
        <Empty title="All quiet for now" icon="bell">
          <p>{admin && !user ? 'Booking activity will appear here when customers hold or change a time.' : 'Updates will appear here when a booking changes or a waitlist offer arrives.'}</p>
        </Empty>
      )}
    </>
  );
}
