import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useFlow } from './context';
import { request, labels, typeLabel, dayLabel, timeLabel } from './api';
import type { Booking } from './types';
import { Icon, typeIcon, Loading, ErrorMessage } from './ui';
import { mapsDirectionsUrl } from './maps';
export default function Overview() {
  const { resources, loading, error, user, workspace } = useFlow();
  const [type, setType] = useState('all'),
    [query, setQuery] = useState(''),
    [bookings, setBookings] = useState<Booking[]>([]);
  useEffect(() => {
    if (user)
      request<Booking[]>('/bookings')
        .then(setBookings)
        .catch(() => {});
    else setBookings([]);
  }, [user]);
  const filtered = resources.filter(
    (r) =>
      (type === 'all' || r.business_type === type) &&
      `${r.name} ${r.title} ${r.location_name}`.toLowerCase().includes(query.toLowerCase()),
  );
  const next = bookings
    .filter((b) => b.status === 'confirmed' && Date.parse(b.starts_at) > Date.now())
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
  return (
    <>
      <div className="bf-page-heading">
        <div>
          <div className="bf-eyebrow">A LITTLE LESS BACK-AND-FORTH</div>
          <h1>
            Make space for your next thing<span>.</span>
          </h1>
          <p>People, spaces and equipment. The right resource, at the right time.</p>
        </div>
        <Link className="bf-button primary" to="/planner">
          <Icon name="plus" size={18} />
          Find a time
        </Link>
      </div>
      <section className="bf-overview-hero">
        <div className="bf-hero-copy">
          <div className="bf-hero-tag">
            <span /> BETTER TOGETHER, BETTER SCHEDULED
          </div>
          <h2>
            Your plans deserve
            <br />a little breathing room.
          </h2>
          <p>
            Tell us what works for you. We’ll find the closest fit,
            <br className="bf-desktop-break" /> keep it on hold, and let you make it official.
          </p>
          <Link to="/planner" className="bf-button hero">
            Find my best fit
            <Icon name="arrow" size={18} />
          </Link>
          <div className="bf-hero-proof">
            <Icon name="shield" size={16} /> Protected holds <span>·</span> Thoughtful alternatives{' '}
            <span>·</span> No overlaps
          </div>
        </div>
        <div className="bf-hero-art" aria-hidden="true">
          <div className="bf-orbit one" />
          <div className="bf-orbit two" />
          <div className="bf-art-chip top">
            <span className="bf-art-green">
              <Icon name="check" size={15} />
            </span>
            The right time, found.
          </div>
          <div className="bf-art-calendar">
            <div className="bf-art-cal-head">
              <span>YOUR NEXT SESSION</span>
              <Icon name="calendar" size={18} />
            </div>
            <div className="bf-art-date">
              A little room
              <br />
              for possibility.
            </div>
            <div className="bf-art-days">
              {['M', 'T', 'W', 'T', 'F'].map((d, i) => (
                <span key={i} className={i === 3 ? 'selected' : ''}>
                  {d}
                  <strong>{i + 21}</strong>
                </span>
              ))}
            </div>
            <div className="bf-art-slot">
              <span />
              <div>
                <strong>Your preferred time</strong>
                <small>Held just for you</small>
              </div>
              <Icon name="check" size={16} />
            </div>
          </div>
          <div className="bf-art-chip bottom">
            <Icon name="clock" size={17} /> Time to decide. Space to breathe.
          </div>
        </div>
      </section>
      <section className="bf-summary-grid">
        <div className="bf-summary">
          <span className="bf-summary-icon green">
            <Icon name="grid" />
          </span>
          <div>
            <strong>{resources.length.toString().padStart(2, '0')}</strong>
            <span>Shared resources</span>
          </div>
          <small>One connected workspace</small>
        </div>
        <div className="bf-summary">
          <span className="bf-summary-icon blue">
            <Icon name="pin" />
          </span>
          <div>
            <strong>
              {new Set(resources.map((r) => r.location_name)).size.toString().padStart(2, '0')}
            </strong>
            <span>Business locations</span>
          </div>
          <small>Find something nearby</small>
        </div>
        <div className="bf-summary">
          <span className="bf-summary-icon sand">
            <Icon name="clock" />
          </span>
          <div>
            <strong>
              5 <em>min</em>
            </strong>
            <span>Time to confirm</span>
          </div>
          <small>Your slot stays protected</small>
        </div>
      </section>
      <div className="bf-section-heading">
        <div>
          <h2>Find your space</h2>
          <p>Appointments, sessions and shared equipment, all in one place.</p>
        </div>
        <label className="bf-search">
          <Icon name="search" size={18} />
          <input
            aria-label="Search resources"
            placeholder="Search resources…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span>⌕</span>
        </label>
      </div>
      <div className="bf-filter-tabs">
        <button className={type === 'all' ? 'active' : ''} onClick={() => setType('all')}>
          All resources <span>{resources.length}</span>
        </button>
        {[...new Set(resources.map((r) => r.business_type))]
          .map((key) => [key, typeLabel(key)])
          .map(([key, label]) => (
            <button key={key} className={type === key ? 'active' : ''} onClick={() => setType(key)}>
              <Icon name={typeIcon(key)} size={16} />
              {label}
            </button>
          ))}
      </div>
      <ErrorMessage message={error} />
      {loading ? (
        <Loading />
      ) : (
        <div className="bf-resource-grid">
          {filtered.map((r) => (
            <article className="bf-resource-card" key={r.id}>
              <div className={'bf-resource-visual ' + r.business_type}>
                <div className="bf-resource-pattern" />
                <span className="bf-resource-category">
                  {labels[r.business_type] ?? r.business_type}
                </span>
                <div className="bf-resource-symbol">
                  <Icon name={typeIcon(r.business_type)} size={52} />
                </div>
                <span className="bf-visual-caption">
                  {workspace.name.toUpperCase()} / {r.location_name.toUpperCase()}
                </span>
              </div>
              <div className="bf-resource-body">
                <div className="bf-resource-title">
                  <h3>{r.name}</h3>
                  <span className="bf-active-dot" title="Resource active" />
                </div>
                <p className="bf-resource-subtitle">{r.title}</p>
                <div className="bf-resource-meta">
                  <span>
                    <Icon name="pin" size={14} />
                    {r.location_name}
                  </span>
                  <span>
                    <Icon name="clock" size={14} />
                    {Math.min(...r.services.map((s) => s.duration_min))}–
                    {Math.max(...r.services.map((s) => s.duration_min))} min
                  </span>
                </div>
                {mapsDirectionsUrl(r.location_name, r.location_address) && <a className="bf-directions-link" href={mapsDirectionsUrl(r.location_name, r.location_address)!} target="_blank" rel="noopener noreferrer"><Icon name="pin" size={14} /> Directions to {r.location_name}</a>}
                <div className="bf-resource-bottom">
                  <span>
                    {r.services.every((s) => !s.price_cents)
                      ? 'No session fee'
                      : `From ₹${Math.min(...r.services.map((s) => s.price_cents)) / 100}`}
                    <small> / session</small>
                  </span>
                  <Link to={'/planner?resource=' + r.id}>
                    Find a time
                    <Icon name="arrow" size={16} />
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {!loading && !filtered.length && (
        <div className="bf-empty">
          No resources match your search. Try another name or category.
        </div>
      )}
      <section className="bf-bottom-strip">
        <div>
          <span className="bf-summary-icon green">
            <Icon name={next ? 'calendar' : 'list'} />
          </span>
          <div>
            <h3>{next ? 'Next on your calendar' : 'Full calendar? Stay in the running.'}</h3>
            <p>
              {next
                ? `${next.resource_name} · ${dayLabel(next.starts_at,next.timezone)} · ${timeLabel(next.starts_at,next.timezone)}`
                : 'Join a waitlist. When a matching time opens up, we’ll hold it for you.'}
            </p>
          </div>
        </div>
        <Link to={next ? '/bookings' : '/waitlist'}>
          {next ? 'View booking' : 'Explore the waitlist'}
          <Icon name="arrow" size={18} />
        </Link>
      </section>
    </>
  );
}
