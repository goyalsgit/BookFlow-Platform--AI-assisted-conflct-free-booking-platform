import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useFlow } from './context';
import { request, dayLabel, timeLabel, dateInZone, tomorrow } from './api';
import type { Booking } from './types';
import { Icon, Status, Empty, ErrorMessage, Loading, typeIcon } from './ui';
import { mapsDirectionsUrl } from './maps';
export function HoldTimer({ expires }: { expires: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.ceil((Date.parse(expires) - now) / 1000));
  return (
    <span className="bf-hold-timer">
      <Icon name="clock" size={15} />
      {seconds
        ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} left to confirm`
        : 'Hold expired'}
    </span>
  );
}
export default function Bookings() {
  const { user, signIn, toast } = useFlow();
  const [bookings, setBookings] = useState<Booking[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [filter, setFilter] = useState('upcoming'),
    [busy, setBusy] = useState(0),
    [move, setMove] = useState<Booking | null>(null),
    [cancel, setCancel] = useState<Booking | null>(null);
  const refresh = () => {
    if (!user) {
      setLoading(false);
      return;
    }
    request<Booking[]>('/bookings')
      .then(setBookings)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [user]);
  async function act(b: Booking, action: string, start?: string) {
    setBusy(b.id);
    setError('');
    try {
      await request(`/bookings/${b.code}/${action}`, 'POST', {
        version: b.version,
        ...(start ? { start } : {}),
      });
      toast(
        action === 'confirm'
          ? 'You’re all set. Your booking is confirmed.'
          : action === 'cancel'
            ? 'Booking released. Matching waitlist requests will be considered.'
            : 'Your booking has moved.',
      );
      setMove(null);
      setCancel(null);
      refresh();
    } catch (e: any) {
      setError(e.message);
      refresh();
    } finally {
      setBusy(0);
    }
  }
  if (!user)
    return (
      <Empty title="Your plans, all in one place">
        <p>Sign in to view reservations and confirm your held slots.</p>
        <button className="bf-button primary" onClick={() => signIn()}>
          Sign in
        </button>
      </Empty>
    );
  const shown = bookings.filter(
    (b) =>
      filter === 'all' ||
      (filter === 'upcoming' &&
        ['held', 'confirmed'].includes(b.status) &&
        Date.parse(b.ends_at) > Date.now()) ||
      (filter === 'past' &&
        (!['held', 'confirmed'].includes(b.status) || Date.parse(b.ends_at) <= Date.now())),
  );
  return (
    <>
      <div className="bf-page-heading">
        <div>
          <div className="bf-eyebrow">YOUR TIME, IN ONE PLACE</div>
          <h1>
            A calendar with room for you<span>.</span>
          </h1>
          <p>Confirm a hold, adjust your plans, or free up a little space for someone else.</p>
        </div>
        <Link to="/planner" className="bf-button primary">
          <Icon name="plus" size={18} />
          Find a time
        </Link>
      </div>
      <div className="bf-filter-tabs">
        {[
          ['upcoming', 'Upcoming'],
          ['past', 'Past & closed'],
          ['all', 'All bookings'],
        ].map(([key, label]) => (
          <button
            key={key}
            className={filter === key ? 'active' : ''}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
        <button className="bf-refresh" onClick={refresh}>
          <Icon name="refresh" size={16} />
          Refresh
        </button>
      </div>
      <ErrorMessage message={error} />
      {loading ? (
        <Loading />
      ) : shown.length ? (
        <div className="bf-booking-list">
          {shown.map((b) => (
            <article className="bf-booking-card" key={b.id}>
              <div className="bf-booking-card-main">
                <span className={'bf-booking-icon ' + b.business_type}>
                  <Icon name={typeIcon(b.business_type)} size={28} />
                </span>
                <div className="bf-booking-info">
                  <div className="bf-booking-label">
                    <span>{b.code}</span>
                    <Status value={b.status} />
                  </div>
                  <h3>{b.resource_name}</h3>
                  <p>
                    {b.service_name} · {b.location_name}
                  </p>
                  {mapsDirectionsUrl(b.location_name, b.location_address) && <a className="bf-directions-link" href={mapsDirectionsUrl(b.location_name, b.location_address)!} target="_blank" rel="noopener noreferrer"><Icon name="pin" size={14} /> Get directions</a>}
                  <div className="bf-booking-time">
                    <span>
                      <Icon name="calendar" size={16} />
                      {dayLabel(b.starts_at, b.timezone)}
                    </span>
                    <span>
                      <Icon name="clock" size={16} />
                      {timeLabel(b.starts_at, b.timezone)}–{timeLabel(b.ends_at, b.timezone)}
                    </span>
                  </div>
                </div>
                <div className="bf-booking-actions">
                  {b.status === 'held' && b.expires_at && (
                    <>
                      <HoldTimer expires={b.expires_at} />
                      <button
                        className="bf-button primary"
                        disabled={busy === b.id || Date.parse(b.expires_at) <= Date.now()}
                        onClick={() => void act(b, 'confirm')}
                      >
                        Confirm booking
                        <Icon name="check" size={17} />
                      </button>
                    </>
                  )}
                  {b.status === 'confirmed' && Date.parse(b.starts_at) > Date.now() && (
                    <button
                      className="bf-button secondary"
                      onClick={() => setMove(b)}
                      disabled={!!busy}
                    >
                      Reschedule
                      <Icon name="calendar" size={16} />
                    </button>
                  )}
                  {['held', 'confirmed'].includes(b.status) &&
                    Date.parse(b.starts_at) > Date.now() && (
                      <button className="bf-text-button danger" onClick={() => setCancel(b)}>
                        {b.status === 'held' ? 'Release hold' : 'Cancel booking'}
                      </button>
                    )}
                </div>
              </div>
              <details className="bf-timeline">
                <summary>
                  Booking timeline <span>{b.events.length} events</span>
                </summary>
                <ol>
                  {b.events.map((e) => (
                    <li key={e.id}>
                      <i />
                      <div>
                        <strong>{e.event.replaceAll('_', ' ')}</strong>
                        <p>{e.detail}</p>
                        <small>
                          {dayLabel(e.created_at,b.timezone)} · {timeLabel(e.created_at,b.timezone)} · {e.actor}
                        </small>
                      </div>
                    </li>
                  ))}
                </ol>
              </details>
            </article>
          ))}
        </div>
      ) : (
        <Empty title="A little room in your calendar">
          <p>No bookings in this view. Find a time that works for you.</p>
          <Link to="/planner" className="bf-button primary">
            Explore available times
          </Link>
        </Empty>
      )}
      {move && (
        <Reschedule
          booking={move}
          close={() => setMove(null)}
          save={(start) => void act(move, 'reschedule', start)}
          busy={busy === move.id}
          error={error}
        />
      )}{' '}
      {cancel && (
        <div className="bf-modal-backdrop">
          <section
            className="bf-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-heading"
          >
            <h2 id="cancel-heading">Release this reservation?</h2>
            <p className="bf-muted">
              {cancel.resource_name} · {dayLabel(cancel.starts_at,cancel.timezone)} · {timeLabel(cancel.starts_at,cancel.timezone)}
            </p>
            <p>
              Your time will become available to other customers. Confirmed bookings follow the
              business cancellation cutoff.
            </p>
            <ErrorMessage message={error} />
            <div className="bf-modal-actions">
              <button className="bf-button secondary" onClick={() => setCancel(null)}>
                Keep it
              </button>
              <button
                className="bf-button danger-button"
                disabled={!!busy}
                onClick={() => void act(cancel, 'cancel')}
              >
                Release reservation
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
function Reschedule({
  booking,
  close,
  save,
  busy,
  error,
}: {
  booking: Booking;
  close: () => void;
  save: (start: string) => void;
  busy: boolean;
  error: string;
}) {
  const [date, setDate] = useState(tomorrow(booking.timezone)),
    [slots, setSlots] = useState<{ start: string; end: string }[]>([]),
    [loading, setLoading] = useState(true),
    [problem, setProblem] = useState(''),
    [selected, setSelected] = useState('');
  useEffect(() => {
    setLoading(true);
    setSelected('');
    request<{ slots: typeof slots }>(
      `/resources/${booking.provider_id}/slots?serviceId=${booking.service_id}&date=${date}`,
    )
      .then((d) => setSlots(d.slots))
      .catch((e) => setProblem(e.message))
      .finally(() => setLoading(false));
  }, [date]);
  return (
    <div className="bf-modal-backdrop">
      <section
        className="bf-modal wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-heading"
      >
        <button className="bf-modal-close" aria-label="Close reschedule" onClick={close}>
          <Icon name="close" />
        </button>
        <h2 id="move-heading">Make room for a new plan.</h2>
        <p className="bf-muted">
          Your original reservation stays protected until the new time is secured.
        </p>
        <label>
          New date
          <input
            type="date"
            min={dateInZone(new Date(),booking.timezone)}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        {loading ? (
          <Loading />
        ) : (
          <div className="bf-slot-grid">
            {slots.map((s) => (
              <button
                className={selected === s.start ? 'selected' : ''}
                key={s.start}
                onClick={() => setSelected(s.start)}
              >
                {timeLabel(s.start, booking.timezone)}
              </button>
            ))}
            {!slots.length && <p>No available times. Try another date.</p>}
          </div>
        )}
        <ErrorMessage message={error || problem} />
        <div className="bf-modal-actions">
          <button className="bf-button secondary" onClick={close}>
            Keep original time
          </button>
          <button
            className="bf-button primary"
            disabled={!selected || busy}
            onClick={() => save(selected)}
          >
            {busy ? 'Moving booking…' : 'Confirm new time'}
          </button>
        </div>
      </section>
    </div>
  );
}
