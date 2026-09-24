import { useState, useEffect } from 'react';
import { useFlow } from './context';
import { request, session, dayLabel, timeLabel } from './api';
import { Icon, Status, Empty, Loading, ErrorMessage } from './ui';
type Ops = {
  metrics: {
    total: number;
    confirmed: number;
    held: number;
    cancelled: number;
    completed: number;
    no_show: number;
    average_lead_hours: number;
  };
  bookings: {
    id: number;
    code: string;
    starts_at: string;
    ends_at: string;
    status: string;
    resource_name: string;
    customer_name: string;
    service_name: string;
  }[];
  queue: {
    id: number;
    status: string;
    resource_name: string;
    customer_name: string;
    date: string;
  }[];
  auditTrail: {
    id: number;
    event: string;
    actor: string;
    detail: string;
    created_at: string;
    code: string;
  }[];
  utilization: { id: number; name: string; booked_hours: number; scheduled_hours: number }[];
};
export default function Operations() {
  const { admin, signIn, resources, toast, workspace } = useFlow();
  const [data, setData] = useState<Ops | null>(null),
    [error, setError] = useState(''),
    [tab, setTab] = useState('bookings'),
    [status, setStatus] = useState('all'),
    [search, setSearch] = useState(''),
    [loading, setLoading] = useState(true);
  const load = () => {
    if (!admin) {
      setLoading(false);
      return;
    }
    request<Ops>('/admin/operations')
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [admin]);
  async function exportCsv() {
    try {
      const res = await fetch('/api/flow/admin/export', {
        headers: { Authorization: `Bearer ${session(true)?.token}` },
      });
      if (!res.ok) throw new Error('Export failed. Please sign in again.');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = 'bookflow-bookings.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message);
    }
  }
  if (!admin)
    return (
      <Empty title="A clearer view of your business." icon="chart">
        <p>Sign in as an administrator to view allocation, demand and booking activity.</p>
        <button className="bf-button primary" onClick={() => signIn(true)}>
          Administrator sign in
        </button>
      </Empty>
    );
  return (
    <>
      <div className="bf-page-heading">
        <div>
          <div className="bf-eyebrow">THE BIGGER PICTURE</div>
          <h1>
            Keep your business flowing<span>.</span>
          </h1>
          <p>Reservations, demand and the decisions behind them. All in one workspace.</p>
        </div>
        <button className="bf-button secondary" onClick={() => void exportCsv()}>
          <Icon name="download" size={17} />
          Export bookings
        </button>
      </div>
      <ErrorMessage message={error} />
      {loading ? (
        <Loading />
      ) : (
        data && (
          <>
            <div className="bf-ops-stats">
              {[
                ['Confirmed sessions', data.metrics.confirmed, 'calendar'],
                ['Active holds', data.metrics.held, 'clock'],
                [
                  'Waiting requests',
                  data.queue.filter((q) => q.status === 'waiting').length,
                  'list',
                ],
                ['Average lead time', `${data.metrics.average_lead_hours}h`, 'chart'],
              ].map(([label, value, icon]) => (
                <div className="bf-panel bf-ops-stat" key={label}>
                  <div>
                    <span>{label}</span>
                    <Icon name={String(icon)} size={18} />
                  </div>
                  <strong>{value}</strong>
                  <small>
                    {label === 'Average lead time'
                      ? 'Confirmed & completed reservations'
                      : 'Current workspace activity'}
                  </small>
                </div>
              ))}
            </div>
            <div className="bf-ops-middle">
              <section className="bf-panel bf-utilization">
                <div className="bf-section-heading">
                  <div>
                    <h2>Resource commitment</h2>
                    <p>Booked hours in the next 7 days / weekly scheduled hours</p>
                  </div>
                  <span className="bf-pill">7 days</span>
                </div>
                {data.utilization.map((u) => (
                  <div className="bf-util-row" key={u.id}>
                    <div>
                      <span>{u.name}</span>
                      <small>
                        {u.booked_hours.toFixed(1)} / {u.scheduled_hours.toFixed(0)}h
                      </small>
                    </div>
                    <div className="bf-util-track">
                      <span
                        style={{
                          width: `${Math.min(100, u.scheduled_hours ? (u.booked_hours / u.scheduled_hours) * 100 : 0)}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
                <p className="bf-input-hint">
                  Indicative schedule commitment. Breaks and dated time off are not subtracted from
                  this denominator.
                </p>
              </section>
              <section className="bf-panel bf-outcomes">
                <h2>Reservation outcomes</h2>
                <p className="bf-muted">Across this workspace’s history</p>
                <div className="bf-outcome-circle">
                  <strong>{data.metrics.total}</strong>
                  <span>Total reservations</span>
                </div>
                {[
                  ['Completed', data.metrics.completed, 'completed'],
                  ['Cancelled', data.metrics.cancelled, 'cancelled'],
                  ['No-show', data.metrics.no_show, 'no_show'],
                ].map(([label, value, key]) => (
                  <div className="bf-outcome-row" key={key}>
                    <Status value={String(key)} />
                    <strong>{value}</strong>
                  </div>
                ))}
              </section>
            </div>
            <div className="bf-filter-tabs">
              {['bookings', 'waitlist', 'audit', 'resources'].map((t) => (
                <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
                  {t === 'audit' ? 'Audit trail' : t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
              <button className="bf-refresh" onClick={load}>
                <Icon name="refresh" size={16} />
                Refresh
              </button>
            </div>
            {tab === 'bookings' && (
              <section className="bf-panel bf-table-panel">
                <div className="bf-table-toolbar">
                  <label className="bf-search">
                    <Icon name="search" size={16} />
                    <input
                      aria-label="Search bookings"
                      placeholder="Search by name or reference…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <select
                    aria-label="Filter booking status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    <option value="all">All statuses</option>
                    {['held', 'confirmed', 'completed', 'cancelled', 'expired', 'no_show'].map(
                      (s) => (
                        <option key={s}>{s}</option>
                      ),
                    )}
                  </select>
                </div>
                <div className="bf-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Booking</th>
                        <th>Resource / customer</th>
                        <th>Session</th>
                        <th>Status</th>
                        <th>Outcome</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.bookings
                        .filter(
                          (b) =>
                            (status === 'all' || b.status === status) &&
                            `${b.resource_name} ${b.customer_name} ${b.code}`
                              .toLowerCase()
                              .includes(search.toLowerCase()),
                        )
                        .map((b) => (
                          <tr key={b.id}>
                            <td>
                              <strong>{b.code}</strong>
                              <small>{b.service_name}</small>
                            </td>
                            <td>
                              <strong>{b.resource_name}</strong>
                              <small>{b.customer_name}</small>
                            </td>
                            <td>
                              {dayLabel(b.starts_at,workspace.timezone)}
                              <small>
                                {timeLabel(b.starts_at,workspace.timezone)}–{timeLabel(b.ends_at,workspace.timezone)}
                              </small>
                            </td>
                            <td>
                              <Status value={b.status} />
                            </td>
                            <td>
                              {b.status === 'confirmed' && Date.parse(b.ends_at) < Date.now() ? (
                                <select
                                  aria-label={`Record outcome for ${b.code}`}
                                  defaultValue=""
                                  onChange={async (e) => {
                                    try {
                                      await request('/admin/bookings/' + b.id, 'PATCH', {
                                        status: e.target.value,
                                      });
                                      load();
                                      toast('Session outcome recorded.');
                                    } catch (e: any) {
                                      setError(e.message);
                                    }
                                  }}
                                >
                                  <option value="" disabled>
                                    Record outcome
                                  </option>
                                  <option value="completed">Completed</option>
                                  <option value="no_show">No-show</option>
                                </select>
                              ) : (
                                <span className="bf-muted">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            {tab === 'waitlist' && (
              <section className="bf-panel bf-table-panel">
                <div className="bf-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Customer</th>
                        <th>Resource</th>
                        <th>Requested date</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.queue.map((q) => (
                        <tr key={q.id}>
                          <td>{q.customer_name}</td>
                          <td>{q.resource_name}</td>
                          <td>{dayLabel(q.date.slice(0, 10))}</td>
                          <td>
                            <Status value={q.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!data.queue.length && <Empty title="No waitlist demand yet" icon="list" />}
                </div>
              </section>
            )}
            {tab === 'audit' && (
              <section className="bf-panel bf-audit-list">
                {data.auditTrail.map((e) => (
                  <article key={e.id}>
                    <span className="bf-audit-dot" />
                    <div>
                      <strong>
                        {e.code} · {e.event}
                      </strong>
                      <p>{e.detail}</p>
                      <small>
                        {dayLabel(e.created_at,workspace.timezone)} · {timeLabel(e.created_at,workspace.timezone)} · {e.actor}
                      </small>
                    </div>
                  </article>
                ))}
              </section>
            )}
            {tab === 'resources' && (
              <section className="bf-panel bf-resource-ops">
                <h2>Resource operating windows</h2>
                <p className="bf-muted">
                  Edit resources and weekly hours in Business setup. Add dated time off below;
                  overlapping active reservations are rejected.
                </p>
                {resources.map((r) => (
                  <ResourceTimeOff
                    key={r.id}
                    id={r.id}
                    name={r.name}
                    schedules={r.schedules}
                    timezone={r.timezone}
                    done={() => toast('Time off added. Availability is updated.')}
                  />
                ))}
              </section>
            )}
          </>
        )
      )}
    </>
  );
}
function ResourceTimeOff({
  id,
  name,
  schedules,
  timezone,
  done,
}: {
  id: number;
  name: string;
  timezone:string;
  schedules: { weekday: number; start_time: string; end_time: string }[];
  done: () => void;
}) {
  const [open, setOpen] = useState(false),
    [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [reason, setReason] = useState(''),
    [error, setError] = useState('');
  return (
    <div className="bf-resource-op">
      <div>
        <strong>{name}</strong>
        <small>
          {schedules?.length ?? 0} weekly windows · {schedules?.[0]?.start_time.slice(0, 5)}–
          {schedules?.[0]?.end_time.slice(0, 5)} {timezone}
        </small>
      </div>
      <button className="bf-button secondary" onClick={() => setOpen(!open)}>
        Block time
        <Icon name="plus" size={15} />
      </button>
      {open && (
        <form
          className="bf-block-form"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await request(`/admin/resources/${id}/time-off`, 'POST', {
                startLocal: start,
                endLocal: end,
                reason,
              });
              done();
              setOpen(false);
            } catch (e: any) {
              setError(e.message);
            }
          }}
        >
          <label>
            Start ({timezone})
            <input
              type="datetime-local"
              required
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            End ({timezone})
            <input
              type="datetime-local"
              min={start}
              required
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
          <label>
            Reason
            <input
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Maintenance, holiday…"
            />
          </label>
          <ErrorMessage message={error} />
          <button className="bf-button primary">Save time off</button>
        </form>
      )}
    </div>
  );
}
