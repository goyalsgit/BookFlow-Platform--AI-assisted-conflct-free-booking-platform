import { useEffect, useState } from 'react';
import { useFlow } from './context';
import { request, dayLabel, timeLabel } from './api';
import { ErrorMessage, Icon } from './ui';

type SeatRow = { label: string; count: number; blocked: number[] };
type PublisherResource = {
  id: number;
  name: string;
  active: boolean;
  services: { id: number; name: string; duration_min: number; active: boolean }[];
};
type PublisherSettings = { organization: { timezone: string }; resources: PublisherResource[] };
type Pool = {
  id: number;
  resource_id: number;
  service_id: number;
  resource_name: string;
  service_name: string;
  location_name: string;
  timezone: string;
  starts_at: string;
  request_deadline: string;
  confirmation_hours: number;
  rows: SeatRow[];
  waiting_groups: number;
  confirmed_groups: number;
};
type Entry = {
  id: number;
  pool_id: number;
  resource_name: string;
  service_name: string;
  timezone: string;
  starts_at: string;
  party_size: number;
  status: string;
  assigned_seats: string[] | null;
  offer_expires_at: string | null;
};
function parseRows(value: string): SeatRow[] {
  const rows = value
    .split(/[;\n]+/)
    .map((v) => v.trim())
    .filter(Boolean)
    .map((text) => {
      const parts = text.split(':');
      if (parts.length < 2 || parts.length > 3 || !/^[A-Za-z][A-Za-z0-9]{0,7}$/.test(parts[0]))
        throw new Error('Use rows such as A:10 or B:8:3,6');
      const count = Number(parts[1]);
      const blocked = parts[2] ? parts[2].split(',').map(Number) : [];
      if (
        !Number.isInteger(count) ||
        count < 1 ||
        count > 30 ||
        blocked.some((n) => !Number.isInteger(n) || n < 1 || n > count) ||
        new Set(blocked).size !== blocked.length
      )
        throw new Error('Check row sizes and blocked seat numbers');
      return { label: parts[0], count, blocked };
    });
  if (
    !rows.length ||
    rows.length > 8 ||
    new Set(rows.map((r) => r.label.toUpperCase())).size !== rows.length
  )
    throw new Error('Enter 1–8 rows with different labels');
  return rows;
}
function makeGrid(rowCount: number, columnCount: number, previous: SeatRow[]): SeatRow[] {
  return Array.from({ length: rowCount }, (_, index) => ({
    label: String.fromCharCode(65 + index),
    count: columnCount,
    blocked: (previous[index]?.blocked ?? []).filter((seat) => seat <= columnCount),
  }));
}
function nowInZone(timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}`;
}
export default function SeatPools() {
  const { user, admin, signIn, toast } = useFlow();
  const [pools, setPools] = useState<Pool[]>([]),
    [mine, setMine] = useState<Entry[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [publisherResources, setPublisherResources] = useState<PublisherResource[]>([]),
    [publisherTimezone, setPublisherTimezone] = useState('Asia/Kolkata'),
    [publisherLoading, setPublisherLoading] = useState(false);
  const [resourceId, setResourceId] = useState(0),
    [serviceId, setServiceId] = useState(0),
    [startLocal, setStartLocal] = useState(''),
    [deadlineLocal, setDeadlineLocal] = useState(''),
    [confirmationHours, setConfirmationHours] = useState(4),
    [rowsText, setRowsText] = useState('A:10'),
    [groupSizes, setGroupSizes] = useState<Record<number, number>>({});
  const [layoutMode, setLayoutMode] = useState<'grid' | 'text'>('grid'),
    [gridRows, setGridRows] = useState<SeatRow[]>(makeGrid(3, 8, []));
  const selected = publisherResources.find((r) => r.id === resourceId);
  const availableSeats = gridRows.reduce((sum, row) => sum + row.count - row.blocked.length, 0);
  const nowLocal = nowInZone(publisherTimezone);
  const dateError =
    startLocal && startLocal <= nowLocal
      ? 'Choose a future session start.'
      : deadlineLocal && deadlineLocal <= nowLocal
        ? 'Choose a future request deadline.'
        : startLocal && deadlineLocal && deadlineLocal >= startLocal
          ? 'The request deadline must be before the session starts.'
          : '';
  const reload = async () => {
    const [next, entries] = await Promise.all([
      request<Pool[]>('/seat-pools'),
      user ? request<Entry[]>('/seat-pool-requests') : Promise.resolve([]),
    ]);
    setPools(next);
    setMine(entries);
  };
  useEffect(() => {
    void reload().catch((e) => setError(e.message));
  }, [user?.id]);
  useEffect(() => {
    let current = true;
    setPublisherResources([]);
    setResourceId(0);
    setServiceId(0);
    if (!admin) return;
    setPublisherLoading(true);
    void request<PublisherSettings>('/admin/settings')
      .then((data) => {
        if (!current) return;
        setPublisherResources(data.resources);
        setPublisherTimezone(data.organization.timezone);
      })
      .catch((e) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setPublisherLoading(false);
      });
    return () => {
      current = false;
    };
  }, [admin?.id]);
  async function act(task: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError('');
    try {
      await task();
      await reload();
      toast(message);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="bf-page-heading">
        <div>
          <div className="bf-eyebrow">PUBLISHED SEATING</div>
          <h1>
            Seat pools<span>.</span>
          </h1>
          <p>
            Publish adjacent seats, collect group requests, then allocate after the deadline with
            minimum empty gaps.
          </p>
        </div>
      </div>
      <ErrorMessage message={error} />
      {admin && (
        <section className="bf-panel bf-seat-pool-form">
          <h2>Publish an optimized seat pool</h2>
          <p>
            For ordinary bookings, customers can still choose a resource in Find a time. A seat pool
            reserves this resource for its published session.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (dateError) {
                setError(dateError);
                return;
              }
              void act(async () => {
                const rows = layoutMode === 'grid' ? gridRows : parseRows(rowsText);
                await request('/admin/seat-pools', 'POST', {
                  resourceId,
                  serviceId,
                  startLocal,
                  deadlineLocal,
                  confirmationHours,
                  rows,
                });
              }, 'Seat pool published.');
            }}
          >
            <div className="bf-form-row">
              <label>
                Resource
                <select
                  required
                  value={resourceId}
                  disabled={publisherLoading}
                  onChange={(e) => {
                    setResourceId(Number(e.target.value));
                    setServiceId(0);
                  }}
                >
                  <option value={0}>Choose your resource</option>
                  {publisherResources
                    .filter((r) => r.active)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Session
                <select
                  required
                  value={serviceId}
                  onChange={(e) => setServiceId(Number(e.target.value))}
                >
                  <option value={0}>Choose session</option>
                  {selected?.services
                    .filter((s) => s.active)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {s.duration_min} min
                      </option>
                    ))}
                </select>
              </label>
            </div>
            {!publisherLoading && !publisherResources.some((r) => r.active) && (
              <p className="bf-input-hint">
                No active resources belong to this publisher. Add or activate one in Settings before
                publishing a seat pool.
              </p>
            )}
            <div className="bf-form-row">
              <label>
                Session starts (business local time)
                <input
                  required
                  type="datetime-local"
                  min={nowLocal}
                  value={startLocal}
                  onChange={(e) => setStartLocal(e.target.value)}
                />
              </label>
              <label>
                Request deadline (business local time)
                <input
                  required
                  type="datetime-local"
                  min={nowLocal}
                  max={startLocal || undefined}
                  value={deadlineLocal}
                  onChange={(e) => setDeadlineLocal(e.target.value)}
                />
              </label>
            </div>
            <p className="bf-input-hint" role={dateError ? 'alert' : undefined}>
              {dateError ||
                `Use ${publisherTimezone} time. The deadline must be in the future and earlier than the session start.`}
            </p>
            <div className="bf-form-row">
              <label>
                Hours to confirm an offer
                <input
                  required
                  type="number"
                  min={1}
                  max={48}
                  value={confirmationHours}
                  onChange={(e) => setConfirmationHours(Number(e.target.value))}
                />
              </label>
            </div>
            <fieldset className="bf-seat-layout">
              <legend>Seat layout</legend>
              <div className="bf-settings-actions">
                <label>
                  <input
                    type="radio"
                    name="seat-layout-mode"
                    checked={layoutMode === 'grid'}
                    onChange={() => setLayoutMode('grid')}
                  />{' '}
                  Grid builder
                </label>
                <label>
                  <input
                    type="radio"
                    name="seat-layout-mode"
                    checked={layoutMode === 'text'}
                    onChange={() => setLayoutMode('text')}
                  />{' '}
                  Enter rows as text
                </label>
              </div>
              {layoutMode === 'grid' ? (
                <>
                  <div className="bf-form-row">
                    <label>
                      Number of rows
                      <input
                        required
                        type="number"
                        min={1}
                        max={8}
                        value={gridRows.length}
                        onChange={(e) => {
                          const count = Number(e.target.value);
                          if (Number.isInteger(count) && count >= 1 && count <= 8)
                            setGridRows(makeGrid(count, gridRows[0].count, gridRows));
                        }}
                      />
                    </label>
                    <label>
                      Seats per row (columns)
                      <input
                        required
                        type="number"
                        min={1}
                        max={30}
                        value={gridRows[0].count}
                        onChange={(e) => {
                          const count = Number(e.target.value);
                          if (Number.isInteger(count) && count >= 1 && count <= 30)
                            setGridRows(makeGrid(gridRows.length, count, gridRows));
                        }}
                      />
                    </label>
                  </div>
                  <p className="bf-input-hint">
                    Select a seat to mark it unavailable. Each group receives adjacent seats in one
                    row. Up to 80 available seats per pool.
                  </p>
                  <div className="bf-seat-grid" aria-label="Seat layout preview">
                    {gridRows.map((row, rowIndex) => (
                      <div className="bf-seat-grid-row" key={row.label}>
                        <span className="bf-seat-row-label">Row {row.label}</span>
                        <div className="bf-seat-grid-seats">
                          {Array.from({ length: row.count }, (_, index) => {
                            const number = index + 1,
                              blocked = row.blocked.includes(number);
                            return (
                              <button
                                key={number}
                                type="button"
                                className={`bf-seat-cell${blocked ? ' is-blocked' : ''}`}
                                aria-label={`${row.label}${number}: ${blocked ? 'unavailable' : 'available'}`}
                                aria-pressed={blocked}
                                title={`${row.label}${number} · ${blocked ? 'unavailable' : 'available'}`}
                                onClick={() =>
                                  setGridRows((current) =>
                                    current.map((item, i) =>
                                      i === rowIndex
                                        ? {
                                            ...item,
                                            blocked: blocked
                                              ? item.blocked.filter((n) => n !== number)
                                              : [...item.blocked, number].sort((a, b) => a - b),
                                          }
                                        : item,
                                    ),
                                  )
                                }
                              >
                                {number}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="bf-input-hint">
                    {availableSeats} seats available
                    {availableSeats > 80
                      ? ' · reduce the grid or block seats to stay within the 80-seat limit'
                      : ''}
                  </p>
                </>
              ) : (
                <>
                  <label>
                    Rows and seats
                    <textarea
                      required
                      value={rowsText}
                      onChange={(e) => setRowsText(e.target.value)}
                      placeholder="A:10; B:8:3,6"
                    />
                  </label>
                  <p className="bf-input-hint">
                    Example: A:10; B:8:3,6 means ten seats in row A and eight in B, with B3 and B6
                    unavailable.
                  </p>
                </>
              )}
            </fieldset>
            <button
              className="bf-button primary"
              aria-busy={busy}
              disabled={
                busy ||
                !resourceId ||
                !serviceId ||
                !!dateError ||
                (layoutMode === 'grid' && (availableSeats < 1 || availableSeats > 80))
              }
            >
              {busy ? 'Publishing…' : 'Publish seat pool'}
            </button>
            {!busy && dateError && (
              <p className="bf-input-hint" role="alert">
                Publishing is unavailable: {dateError}
              </p>
            )}
          </form>
        </section>
      )}
      {mine.length > 0 && (
        <section className="bf-panel">
          <h2>My group requests</h2>
          <div className="bf-seat-pool-list">
            {mine.map((entry) => (
              <article key={entry.id} className="bf-seat-pool-card">
                <strong>
                  {entry.resource_name} · {entry.service_name}
                </strong>
                <p>
                  {dayLabel(entry.starts_at, entry.timezone)} at{' '}
                  {timeLabel(entry.starts_at, entry.timezone)} · Group of {entry.party_size}
                </p>
                <p>
                  Status: <strong>{entry.status}</strong>
                  {entry.assigned_seats?.length
                    ? ` · Seats ${entry.assigned_seats.join(', ')}`
                    : ''}
                </p>
                {entry.status === 'offered' && (
                  <p>
                    Confirm by {timeLabel(entry.offer_expires_at!, entry.timezone)} on{' '}
                    {dayLabel(entry.offer_expires_at!, entry.timezone)}.
                  </p>
                )}
                <div className="bf-settings-actions">
                  {entry.status === 'offered' && (
                    <button
                      className="bf-button primary"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          () => request(`/seat-pool-requests/${entry.id}/confirm`, 'POST'),
                          'Seats confirmed.',
                        )
                      }
                    >
                      Confirm seats
                    </button>
                  )}
                  {['waiting', 'offered', 'confirmed'].includes(entry.status) && (
                    <button
                      className="bf-button secondary"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          () => request(`/seat-pool-requests/${entry.id}/cancel`, 'POST'),
                          'Request cancelled.',
                        )
                      }
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      <section className="bf-panel">
        <h2>Published seat pools</h2>
        {!pools.length && <p>No upcoming seat pools have been published.</p>}
        <div className="bf-seat-pool-list">
          {pools.map((p) => {
            const existing = mine.find(
              (e) => e.pool_id === p.id && ['waiting', 'offered', 'confirmed'].includes(e.status),
            );
            const open = Date.parse(p.request_deadline) > Date.now();
            return (
              <article key={p.id} className="bf-seat-pool-card">
                <strong>
                  {p.resource_name} · {p.service_name}
                </strong>
                <p>
                  {p.location_name} · {dayLabel(p.starts_at, p.timezone)} at{' '}
                  {timeLabel(p.starts_at, p.timezone)}
                </p>
                <p>
                  {p.rows
                    .map((r) => `${r.label}: ${r.count - r.blocked.length} available`)
                    .join(' · ')}
                </p>
                <p>
                  Requests close {dayLabel(p.request_deadline, p.timezone)} at{' '}
                  {timeLabel(p.request_deadline, p.timezone)}. Offers allow up to{' '}
                  {p.confirmation_hours} hours to confirm.
                </p>
                <p>
                  {p.waiting_groups} waiting groups · {p.confirmed_groups} confirmed
                </p>
                {existing ? (
                  <p>
                    Your group of {existing.party_size} is {existing.status}.
                  </p>
                ) : open ? (
                  <div className="bf-settings-actions">
                    <label>
                      Group size
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={groupSizes[p.id] ?? 1}
                        onChange={(e) =>
                          setGroupSizes({ ...groupSizes, [p.id]: Number(e.target.value) })
                        }
                      />
                    </label>
                    <button
                      className="bf-button primary"
                      disabled={busy}
                      onClick={() =>
                        user
                          ? void act(
                              () =>
                                request(`/seat-pools/${p.id}/requests`, 'POST', {
                                  partySize: groupSizes[p.id] ?? 1,
                                }),
                              'Group request joined.',
                            )
                          : signIn()
                      }
                    >
                      Request adjacent seats
                      <Icon name="arrow" size={16} />
                    </button>
                  </div>
                ) : (
                  <p>Request deadline passed. Allocation is being processed.</p>
                )}
                {publisherResources.some((r) => r.id === p.resource_id) && !open && (
                  <button
                    className="bf-button secondary"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () => request(`/admin/seat-pools/${p.id}/allocate`, 'POST'),
                        'Allocation checked.',
                      )
                    }
                  >
                    Run allocation
                  </button>
                )}
                {publisherResources.some((r) => r.id === p.resource_id) && (
                  <button
                    className="bf-text-button"
                    disabled={busy || p.confirmed_groups > 0}
                    onClick={() => {
                      if (
                        window.confirm(
                          'Withdraw this seat pool and cancel all waiting requests and offers?',
                        )
                      )
                        void act(
                          () => request(`/admin/seat-pools/${p.id}`, 'DELETE'),
                          'Seat pool withdrawn.',
                        );
                    }}
                  >
                    Withdraw pool
                  </button>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}
