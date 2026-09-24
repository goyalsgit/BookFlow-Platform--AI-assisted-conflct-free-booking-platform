import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useFlow } from './context';
import { request, tomorrow, dateInZone, dayLabel } from './api';
import type { QueueEntry } from './types';
import { Icon, Status, ErrorMessage, Empty } from './ui';
export default function Waitlist() {
  const { resources, user, signIn, toast, workspace } = useFlow(),
    [params] = useSearchParams();
  const [resourceId, setResource] = useState(Number(params.get('resource')) || 0),
    [serviceId, setService] = useState(Number(params.get('service')) || 0),
    [date, setDate] = useState(params.get('date') || tomorrow(workspace.timezone)),
    [earliestTime, setEarliest] = useState(params.get('time') || '17:00'),
    [latestTime, setLatest] = useState('21:00'),
    [entries, setEntries] = useState<QueueEntry[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const resource = resources.find((r) => r.id === resourceId);
  useEffect(() => {
    if (resources.length && !resourceId) setResource(resources[0].id);
  }, [resources]);
  useEffect(() => {
    setService(resource?.services[0]?.id ?? 0);
  }, [resourceId, resources]);
  const refresh = () => {
    if (user)
      request<QueueEntry[]>('/requests')
        .then(setEntries)
        .catch((e) => setError(e.message));
  };
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  }, [user]);
  return (
    <>
      <div className="bf-page-heading">
        <div>
          <div className="bf-eyebrow">GOOD THINGS OPEN UP</div>
          <h1>
            Stay in the running<span>.</span>
          </h1>
          <p>If a matching session becomes available, we’ll give you a little time to claim it.</p>
        </div>
        <span className="bf-pill">
          <Icon name="list" size={16} />
          First eligible, first offered
        </span>
      </div>
      <div className="bf-planner-layout">
        <section className="bf-panel bf-preferences">
          <div className="bf-panel-title">
            <Icon name="list" />
            <div>
              <h2>Join the waitlist</h2>
              <p>Tell us which start times suit you.</p>
            </div>
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!user) {
                signIn();
                return;
              }
              setBusy(true);
              setError('');
              try {
                const entry = await request<QueueEntry>('/requests', 'POST', {
                  resourceId,
                  serviceId,
                  date,
                  earliestTime,
                  latestTime,
                });
                toast(
                  entry.status === 'offered'
                    ? 'A matching time was available. Confirm your offer in My bookings.'
                    : 'You’re on the waitlist. Watch your inbox for an offer.',
                );
                refresh();
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Resource
              <select value={resourceId} onChange={(e) => setResource(Number(e.target.value))}>
                {resources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Session
              <select value={serviceId} onChange={(e) => setService(Number(e.target.value))}>
                {resource?.services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.duration_min} min
                  </option>
                ))}
              </select>
            </label>
            <label>
              Date
              <input
                type="date"
                required
                min={dateInZone(new Date(), resources.find(r=>r.id===resourceId)?.timezone??workspace.timezone)}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <div className="bf-form-row">
              <label>
                Earliest start
                <input
                  type="time"
                  required
                  value={earliestTime}
                  onChange={(e) => setEarliest(e.target.value)}
                />
              </label>
              <label>
                Latest start
                <input
                  type="time"
                  required
                  min={earliestTime}
                  value={latestTime}
                  onChange={(e) => setLatest(e.target.value)}
                />
              </label>
            </div>
            <ErrorMessage message={error} />
            <button className="bf-button primary full" disabled={busy || !serviceId}>
              Join waitlist
              <Icon name="arrow" size={17} />
            </button>
          </form>
          <div className="bf-policy-note">
            <Icon name="shield" size={18} />
            <p>
              An offer is an exclusive five-minute hold. Confirm it in My bookings before it
              expires.
            </p>
          </div>
        </section>
        <section>
          <div className="bf-section-heading">
            <div>
              <h2>Your requests</h2>
              <p>We match your resource, session, date and start-time window.</p>
            </div>
          </div>
          {!user ? (
            <Empty title="Sign in to follow your requests">
              <button className="bf-button secondary" onClick={() => signIn()}>
                Sign in
              </button>
            </Empty>
          ) : entries.length ? (
            <div className="bf-queue-list">
              {entries.map((e) => (
                <article className="bf-panel bf-queue-card" key={e.id}>
                  <div>
                    <Status value={e.status} />
                    <h3>{e.resource_name}</h3>
                    <p>
                      {dayLabel(e.date.slice(0, 10))} · {e.earliest_time.slice(0, 5)}–
                      {e.latest_time.slice(0, 5)} IST
                    </p>
                  </div>
                  {e.status === 'offered' ? (
                    <Link className="bf-button primary" to="/bookings">
                      View held offer
                      <Icon name="arrow" size={16} />
                    </Link>
                  ) : e.status === 'waiting' ? (
                    <button
                      className="bf-text-button danger"
                      onClick={async () => {
                        try {
                          await request('/requests/' + e.id, 'DELETE');
                          refresh();
                          toast('Waitlist request withdrawn.');
                        } catch (err: any) {
                          setError(err.message);
                        }
                      }}
                    >
                      Withdraw
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <Empty title="No waiting around. Yet." icon="list">
              <p>
                Your waitlist requests will appear here. Join when your preferred time is
                unavailable.
              </p>
            </Empty>
          )}
          <div className="bf-explainer">
            <h3>A fair chance at the next opening.</h3>
            <ol>
              <li>
                <span>1</span>
                <div>
                  <strong>We check compatibility</strong>
                  <p>The available slot must fit your resource, session and time window.</p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>The oldest matching request goes first</strong>
                  <p>Eligible requests are considered in the order they joined.</p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>You get five minutes to decide</strong>
                  <p>
                    Confirm your held offer. If it expires, the next eligible request gets a chance.
                  </p>
                </div>
              </li>
            </ol>
          </div>
        </section>
      </div>
    </>
  );
}
