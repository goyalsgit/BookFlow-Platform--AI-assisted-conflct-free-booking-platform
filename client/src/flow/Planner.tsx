import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useFlow } from './context';
import { request, tomorrow, dateInZone, dayLabel, timeLabel } from './api';
import type { Candidate, Booking } from './types';
import { Icon, ErrorMessage, Empty, typeIcon, Loading } from './ui';
export default function Planner() {
  const { resources, loading, user, signIn, toast, workspace } = useFlow(),
    navigate = useNavigate(),
    [params] = useSearchParams();
  const [resourceId, setResource] = useState(Number(params.get('resource')) || 0),
    [serviceId, setService] = useState(Number(params.get('service'))||0),
    [date, setDate] = useState(params.get('date')||tomorrow(workspace.timezone)),
    [time, setTime] = useState(params.get('time')||'18:00'),
    [flexDays, setFlex] = useState(1),
    [alternatives, setAlternatives] = useState(true);
  const [results, setResults] = useState<{
      candidates: Candidate[];
      verifiedAt: string;
      totalCandidates: number;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [holding, setHolding] = useState(''),
    [error, setError] = useState(''),
    [text, setText] = useState(''),
    [assistantMessage, setAssistantMessage] = useState(''),
    [searchVersion, setSearchVersion] = useState(0);
  const resource = resources.find((r) => r.id === resourceId),
    service = resource?.services.find((s) => s.id === serviceId);
  useEffect(() => {
    if (resources.length && !resources.some((r) => r.id === resourceId))
      setResource(resources[0].id);
  }, [resources]);
  useEffect(() => {
    setService(current=>resource?.services.some(s=>s.id===current)?current:resource?.services[0]?.id??0);
  }, [resourceId, resources]);
  useEffect(() => {
    setResults(null);
    setError('');
  }, [resourceId, serviceId, date, time, flexDays, alternatives]);
  async function search() {
    if (!resource || !service) return;
    setBusy(true);
    setError('');
    try {
      const response = await request<typeof results>('/recommendations', 'POST', {
        resourceId,
        serviceId,
        date,
        time,
        flexDays,
        allowOtherResources: alternatives,
      });
      setResults(response);
      setSearchVersion((v) => v + 1);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function createHold(c: Candidate) {
    if (!user) {
      signIn();
      return;
    }
    setHolding(c.start + c.resourceId);
    setError('');
    try {
      await request<Booking>('/holds', 'POST', {
        resourceId: c.resourceId,
        serviceId: c.serviceId,
        start: c.start,
      });
      toast('Your time is held for five minutes. Confirm it in My bookings.');
      navigate('/bookings');
    } catch (e: any) {
      setError(e.message);
      setResults(null);
    } finally {
      setHolding('');
    }
  }
  if (loading) return <Loading />;
  return (
    <>
      <div className="bf-page-heading">
        <div>
          <div className="bf-eyebrow">A GOOD FIT, WITHOUT THE GUESSWORK</div>
          <h1>
            Let’s find your time<span>.</span>
          </h1>
          <p>Your preferences, a few thoughtful alternatives, and a little time to decide.</p>
        </div>
        <span className="bf-pill">
          <Icon name="shield" size={16} /> Live availability
        </span>
      </div>
      <div className="bf-planner-layout">
        <aside>
          <section className="bf-panel bf-preferences">
            <div className="bf-panel-title">
              <span className="bf-step">1</span>
              <div>
                <h2>What works for you?</h2>
                <p>Start with your ideal plan.</p>
              </div>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void search();
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
              <div className="bf-form-row">
                <label>
                  Preferred date
                  <input
                    type="date"
                    required
                    min={dateInZone(new Date(), resource?.timezone??workspace.timezone)}
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
                <label>
                  Preferred time
                  <input
                    type="time"
                    required
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                  />
                </label>
              </div>
              <div className="bf-form-divider" />
              <label>
                How flexible is your date?
                <select value={flexDays} onChange={(e) => setFlex(Number(e.target.value))}>
                  <option value={0}>This day only</option>
                  <option value={1}>Up to 1 day later</option>
                  <option value={2}>Up to 2 days later</option>
                  <option value={3}>Up to 3 days later</option>
                </select>
              </label>
              <label className="bf-checkbox">
                <input
                  type="checkbox"
                  checked={alternatives}
                  onChange={(e) => setAlternatives(e.target.checked)}
                />
                <span>
                  Include similar resources
                  <small>Same session and duration, within your business.</small>
                </span>
              </label>
              <button className="bf-button primary full" disabled={busy || !service}>
                {busy ? 'Checking availability…' : 'Find my best options'}
                <Icon name="arrow" size={18} />
              </button>
              <p className="bf-input-hint">
                <Icon name="clock" size={13} /> All times are in{' '}
                {resource?.timezone ?? 'Asia/Kolkata'}.
              </p>
            </form>
          </section>
          <section className="bf-assistant"><h3>Prefer a conversation?</h3><p>Describe your plan to the assistant, then review the suggested filters.</p><button className="bf-button secondary full" onClick={()=>navigate('/chat')}>Open chat assistant<Icon name="spark" size={16}/></button></section>
        </aside>
        <section className="bf-results">
          <div className="bf-panel-title">
            <span className="bf-step">2</span>
            <div>
              <h2>Your best options</h2>
              <p>Choose one. We’ll hold it while you confirm.</p>
            </div>
          </div>
          <ErrorMessage message={error} />
          {busy ? (
            <Loading />
          ) : results ? (
            <>
              <div className="bf-results-meta">
                <span>
                  <i />
                  {results.candidates.length} closest matches
                </span>
                <small>
                  Checked {timeLabel(results.verifiedAt)} · {results.totalCandidates} available
                  options
                </small>
              </div>
              {results.candidates.map((c, i) => (
                <article
                  key={`${searchVersion}-${c.resourceId}-${c.start}`}
                  className={'bf-candidate ' + (i === 0 ? 'best' : '')}
                >
                  <div className="bf-candidate-top">
                    <span className={'bf-candidate-label ' + (i === 0 ? 'best' : '')}>
                      {i === 0 ? (
                        <>
                          <Icon name="spark" size={14} />
                          BEST FIT
                        </>
                      ) : (
                        `OPTION ${i + 1}`
                      )}
                    </span>
                    <span className="bf-score">
                      {Math.round(c.score * 100)}
                      <small>% match</small>
                    </span>
                  </div>
                  <div className="bf-candidate-main">
                    <span className="bf-candidate-icon">
                      <Icon name={typeIcon(resource?.business_type ?? '')} size={26} />
                    </span>
                    <div>
                      <h3>{c.resourceName}</h3>
                      <p>
                        {c.serviceName} · {c.location}
                      </p>
                    </div>
                  </div>
                  <div className="bf-candidate-time">
                    <span>
                      <Icon name="calendar" size={17} />
                      {dayLabel(c.start, c.timezone)}
                    </span>
                    <span>
                      <Icon name="clock" size={17} />
                      {timeLabel(c.start, c.timezone)} – {timeLabel(c.end, c.timezone)}
                    </span>
                  </div>
                  <div className="bf-candidate-reason">
                    <Icon name="check" size={15} />
                    {c.reason}
                  </div>
                  <details className="bf-score-detail">
                    <summary>Why this match?</summary>
                    <div>
                      {Object.entries(c.components).map(([k, v]) => (
                        <span key={k}>
                          {
                            (
                              {
                                timeCloseness: 'Time proximity · 45%',
                                dateCloseness: 'Date proximity · 25%',
                                preferredResourceMatch: 'Chosen resource · 15%',
                                locationMatch: 'Same location · 10%',
                                lowerDemandBonus: 'Lower demand · 5%',
                              } as Record<string, string>
                            )[k]
                          }
                          <strong>{Math.round(v * 100)}%</strong>
                        </span>
                      ))}
                    </div>
                    <p>
                      The match score reflects your preferences, not a guarantee. Availability is
                      checked again when you hold.
                    </p>
                  </details>
                  <button
                    className={'bf-button ' + (i === 0 ? 'primary' : 'secondary')}
                    disabled={!!holding}
                    onClick={() => void createHold(c)}
                  >
                    {holding === c.start + c.resourceId ? 'Securing your hold…' : 'Hold this time'}
                    <Icon name="arrow" size={17} />
                  </button>
                </article>
              ))}
              {!results.candidates.length && (
                <Empty title="A little too busy right now" icon="calendar">
                  <p>
                    No available sessions fit these preferences. Try a different date, or join the
                    waitlist.
                  </p>
                  <button
                    className="bf-button primary"
                    onClick={() =>
                      navigate(
                        `/waitlist?resource=${resourceId}&service=${serviceId}&date=${date}&time=${time}`,
                      )
                    }
                  >
                    Join the waitlist
                  </button>
                </Empty>
              )}
            </>
          ) : (
            <div className="bf-planner-intro">
              <div className="bf-intro-illustration">
                <Icon name="calendar" size={58} />
                <span>
                  <Icon name="spark" size={22} />
                </span>
              </div>
              <h2>Your next good plan starts here.</h2>
              <p>
                Choose a resource and your preferred time.
                <br />
                We’ll compare available sessions and explain the closest fits.
              </p>
              <div className="bf-how-steps">
                <div>
                  <span>01</span>
                  <strong>Find your fit</strong>
                  <small>Ranked around your preferences</small>
                </div>
                <div>
                  <span>02</span>
                  <strong>Take a breath</strong>
                  <small>A five-minute exclusive hold</small>
                </div>
                <div>
                  <span>03</span>
                  <strong>Make it official</strong>
                  <small>Confirm when you’re ready</small>
                </div>
              </div>
            </div>
          )}
          {service && (
            <div className="bf-policy-note">
              <Icon name="shield" size={19} />
              <div>
                <strong>A little space between sessions.</strong>
                <p>
                  {service.buffer_before_min + service.buffer_min > 0
                    ? `${service.buffer_before_min} minutes of preparation and ${service.buffer_min} minutes of cleanup are reserved around this session.`
                    : 'This session allows back-to-back reservations.'}{' '}
                  Your hold expires automatically if you don’t confirm.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
