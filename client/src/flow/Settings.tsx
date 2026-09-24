import { useEffect, useState } from 'react';
import { useFlow } from './context';
import { request, typeLabel,dayLabel,timeLabel } from './api';
import { Icon, Empty, ErrorMessage, Loading } from './ui';
import { mapsDirectionsUrl } from './maps';
import PlaceInput from './PlaceInput';
type Window = { weekday: number; start: string; end: string };
type SettingsData = {
  organization: { name: string; timezone: string; cancellation_cutoff_min: number };
  locations: { id: number; name: string; address: string }[];
  resources: {
    id: number;
    name: string;
    business_type: string;
    active: boolean;
    location_name: string;
    location_id:number;
    bio:string;
    services:Session[];
    timeOff:{id:number;starts_at:string;ends_at:string;reason:string}[];
    schedule: Window[];
  }[];
};
type Session={id:number;name:string;duration_min:number;buffer_before_min:number;buffer_min:number;price_cents:number;active:boolean};
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export default function Settings() {
  const { admin, signIn, toast, refresh } = useFlow();
  const [data, setData] = useState<SettingsData | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(''),
    [timezone, setTimezone] = useState('Asia/Kolkata'),
    [cutoff, setCutoff] = useState(60),
    [tab, setTab] = useState('business'),
    [editing, setEditing] = useState<number | null>(null),
    [windows, setWindows] = useState<Window[]>([]),
    [locationName, setLocationName] = useState(''),
    [locationAddress, setLocationAddress] = useState('');
  const load = () =>
    request<SettingsData>('/admin/settings')
      .then((d) => {
        setData(d);
        setName(d.organization.name);
        setTimezone(d.organization.timezone);
        setCutoff(d.organization.cancellation_cutoff_min);
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    if (admin) void load();
  }, [admin]);
  async function save(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError('');
    try {
      await fn();
      toast(message);
      await load();
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!admin)
    return (
      <Empty title="Built around your business." icon="grid">
        <p>Customize your workspace, create any resource type and set your own working hours.</p>
        <button className="bf-button primary" onClick={() => signIn(true)}>
          Administrator sign in
        </button>
      </Empty>
    );
  return (
    <>
      <div className="bf-page-heading">
        <div>
          <div className="bf-eyebrow">YOUR BUSINESS, YOUR WAY</div>
          <h1>
            A workspace that fits<span>.</span>
          </h1>
          <p>
            People, spaces, equipment or something entirely different. You define what’s bookable.
          </p>
        </div>
      </div>
      <div className="bf-filter-tabs">
        {[
          ['business', 'Business details'],
          ['resources', 'Resources & hours'],
          ['new', 'Add a resource'],
        ].map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? 'active' : ''}
            onClick={() => {
              setTab(key);
              setError('');
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <ErrorMessage message={error} />
      {!data ? (
        <Loading />
      ) : tab === 'business' ? (
        <div className="bf-settings-grid">
          <section className="bf-panel bf-settings-panel">
            <h2>Business details</h2>
            <p>Your business name appears throughout your workspace.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save(
                  () =>
                    request('/admin/settings', 'PUT', {
                      name,
                      timezone,
                      cancellationCutoffMinutes: cutoff,
                    }),
                  'Business details updated.',
                );
              }}
            >
              <label>
                Business name
                <input
                  required
                  minLength={2}
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                Business timezone
                <input
                  required
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="Asia/Kolkata"
                  list="timezones"
                />
                <datalist id="timezones">
                  {[
                    'Asia/Kolkata',
                    'Europe/London',
                    'America/New_York',
                    'America/Los_Angeles',
                    'Australia/Sydney',
                    'UTC',
                  ].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </datalist>
              </label>
              <label>
                Cancellation cutoff (minutes before session)
                <input
                  type="number"
                  min={0}
                  max={10080}
                  required
                  value={cutoff}
                  onChange={(e) => setCutoff(Number(e.target.value))}
                />
              </label>
              <p className="bf-input-hint">
                Existing future reservations must be resolved before changing timezone. Their booked
                instants are never silently shifted.
              </p>
              <button className="bf-button primary" disabled={busy}>
                Save business details
                <Icon name="check" size={16} />
              </button>
            </form>
          </section>
          <section className="bf-panel bf-settings-panel">
            <h2>Your locations</h2>
            <p>A shop, studio, office, branch or virtual space.</p>
            <div className="bf-location-list">
              {data.locations.map((l) => (
                <div key={l.id}>
                  <Icon name="pin" size={18} />
                  <div>
                    <strong>{l.name}</strong>
                    <small>{l.address || 'No address added — edit this location to enable customer directions'}</small>
                    {mapsDirectionsUrl(l.name, l.address) && <a className="bf-directions-link" href={mapsDirectionsUrl(l.name, l.address)!} target="_blank" rel="noopener noreferrer">Preview directions</a>}
                    <LocationEditor location={l} busy={busy} save={save}/>
                  </div>
                </div>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save(
                  () => request('/admin/locations', 'POST', { name: locationName, address: locationAddress }),
                  'Location created.',
                );
                setLocationName('');
                setLocationAddress('');
              }}
            >
              <label>
                New location
                <input
                  required
                  minLength={2}
                  value={locationName}
                  onChange={(e) => setLocationName(e.target.value)}
                  placeholder="e.g. Downtown studio"
                />
              </label>
              <PlaceInput label="Street address for directions" value={locationAddress} onChange={setLocationAddress} />
              <button className="bf-button secondary" disabled={busy}>
                <Icon name="plus" size={16} />
                Add location
              </button>
            </form>
          </section>
        </div>
      ) : tab === 'new' ? (
        <ResourceForm
          locations={data.locations}
          busy={busy}
          submit={(input) =>
            save(
              () => request('/admin/resources', 'POST', input),
              'Resource created. It is now available to customers.',
            )
          }
        />
      ) : (
        <div className="bf-panel bf-settings-panel">
          <div className="bf-section-heading">
            <div>
              <h2>Bookable resources</h2>
              <p>
                Each resource has exclusive capacity. Add separate resources for separate staff or
                equipment.
              </p>
            </div>
            <button className="bf-button primary" onClick={() => setTab('new')}>
              <Icon name="plus" size={16} />
              Add resource
            </button>
          </div>
          {data.resources.map((r) => (
            <div key={r.id} className="bf-settings-resource">
              <div>
                <strong>{r.name}</strong>
                <small>
                  {typeLabel(r.business_type)} · {r.location_name} ·{' '}
                  {r.active ? 'Active' : 'Inactive'}
                </small>
              </div>
              <div className="bf-settings-actions">
                <button
                  className="bf-button secondary"
                  onClick={() => {
                    setEditing(editing === r.id ? null : r.id);
                    setWindows(r.schedule);
                  }}
                >
                  Edit hours
                </button>
                <button
                  className="bf-text-button"
                  disabled={busy}
                  onClick={() =>
                    void save(
                      () => request('/admin/resources/' + r.id, 'PATCH', { active: !r.active }),
                      r.active ? 'Resource paused for new bookings.' : 'Resource activated.',
                    )
                  }
                >
                  {r.active ? 'Pause' : 'Activate'}
                </button>
              </div>
              <details className="bf-resource-editor"><summary>Edit details, services & time off</summary>
                <ResourceDetails key={JSON.stringify([r.name,r.business_type,r.bio,r.location_id])} resource={r} locations={data.locations} busy={busy} save={save}/>
                <h3>Bookable sessions</h3>
                {r.services.map(session=><SessionEditor key={JSON.stringify(session)} resourceId={r.id} session={session} busy={busy} save={save}/>)}
                <details><summary>Add a session</summary><SessionEditor resourceId={r.id} busy={busy} save={save}/></details>
                <h3>Upcoming time off</h3>
                {!r.timeOff.length&&<p>No upcoming time off. Add a block in Operations.</p>}
                {r.timeOff.map(t=><div className="bf-timeoff-row" key={t.id}><span>{dayLabel(t.starts_at,data.organization.timezone)} {timeLabel(t.starts_at,data.organization.timezone)} – {dayLabel(t.ends_at,data.organization.timezone)} {timeLabel(t.ends_at,data.organization.timezone)} · {t.reason}</span><button className="bf-button secondary" disabled={busy} onClick={()=>void save(()=>request(`/admin/resources/${r.id}/time-off/${t.id}`,'DELETE'),'Time off removed.')}>Remove block</button></div>)}
              </details>
              {editing === r.id && (
                <form
                  className="bf-hours-editor"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save(
                      () => request(`/admin/resources/${r.id}/schedule`, 'PUT', windows),
                      'Weekly hours updated.',
                    );
                  }}
                >
                  <ScheduleEditor value={windows} change={setWindows} />
                  <p className="bf-input-hint">
                    Changes that would exclude an existing reservation are rejected. Existing
                    recurring breaks still apply.
                  </p>
                  <button className="bf-button primary" disabled={busy}>
                    Save weekly hours
                  </button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
function ScheduleEditor({ value, change }: { value: Window[]; change: (v: Window[]) => void }) {
  return (
    <div className="bf-schedule-editor">
      {weekdays.map((day, index) => {
        const windows = value.filter((w) => w.weekday === index);
        return (
          <div key={day} className="bf-schedule-day">
            <label className="bf-checkbox">
              <input
                type="checkbox"
                checked={windows.length > 0}
                onChange={(e) =>
                  change(
                    e.target.checked
                      ? [...value, { weekday: index, start: '09:00', end: '18:00' }]
                      : value.filter((w) => w.weekday !== index),
                  )
                }
              />
              {day}
            </label>
            {windows.length ? (
              <div className="bf-schedule-windows">
                {windows.map((w, i) => (
                  <div key={i}>
                    <input
                      aria-label={`${day} opening ${i + 1}`}
                      type="time"
                      required
                      value={w.start}
                      onChange={(e) =>
                        change(value.map((x) => (x === w ? { ...x, start: e.target.value } : x)))
                      }
                    />
                    <span>to</span>
                    <input
                      aria-label={`${day} closing ${i + 1}`}
                      type="time"
                      required
                      min={w.start}
                      value={w.end}
                      onChange={(e) =>
                        change(value.map((x) => (x === w ? { ...x, end: e.target.value } : x)))
                      }
                    />
                    {windows.length > 1 && (
                      <button
                        type="button"
                        aria-label={`Remove ${day} window ${i + 1}`}
                        onClick={() => change(value.filter((x) => x !== w))}
                      >
                        <Icon name="close" size={14} />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  className="bf-text-button"
                  onClick={() =>
                    change([...value, { weekday: index, start: '19:00', end: '21:00' }])
                  }
                >
                  + Add another window
                </button>
              </div>
            ) : (
              <small>Closed</small>
            )}
          </div>
        );
      })}
    </div>
  );
}
function ResourceForm({
  locations,
  busy,
  submit,
}: {
  locations: SettingsData['locations'];
  busy: boolean;
  submit: (input: unknown) => Promise<void>;
}) {
  const [name, setName] = useState(''),
    [type, setType] = useState(''),
    [description, setDescription] = useState(''),
    [locationId, setLocation] = useState(locations[0]?.id ?? 0),
    [serviceName, setService] = useState(''),
    [durationMinutes, setDuration] = useState(60),
    [bufferBefore, setBefore] = useState(0),
    [bufferAfter, setAfter] = useState(0),
    [price, setPrice] = useState(0),
    [schedule, setSchedule] = useState<Window[]>(
      [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '09:00', end: '18:00' })),
    );
  return (
    <form
      className="bf-settings-grid"
      onSubmit={(e) => {
        e.preventDefault();
        void submit({
          name,
          type,
          description,
          locationId,
          serviceName,
          durationMinutes,
          bufferBefore,
          bufferAfter,
          priceCents: Math.round(price * 100),
          slotStep: 15,
          schedule,
        });
      }}
    >
      <section className="bf-panel bf-settings-panel">
        <h2>What can customers book?</h2>
        <p>Use your own categories. There is no fixed industry list.</p>
        <div className="bf-settings-fields">
          <label>
            Resource name
            <input
              required
              minLength={2}
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sewing machine 01"
            />
          </label>
          <label>
            Resource type
            <input
              required
              minLength={2}
              maxLength={50}
              pattern="[a-z][a-z0-9_]*"
              value={type}
              onChange={(e) => setType(e.target.value.toLowerCase().replaceAll(' ', '_'))}
              placeholder="e.g. sewing_machine"
              list="resource-types"
            />
            <datalist id="resource-types">
              {[
                'consultant',
                'workstation',
                'camera',
                'vehicle',
                'studio',
                'meeting_room',
                'sports_court',
                'lab_instrument',
              ].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </datalist>
            <small className="bf-input-hint">
              Similar resources with matching session names and durations can be suggested as
              alternatives.
            </small>
          </label>
          <label>
            Location
            <select value={locationId} onChange={(e) => setLocation(Number(e.target.value))}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Description
            <textarea
              maxLength={1000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What should customers know?"
            />
          </label>
          <div className="bf-form-divider" />
          <h3>First bookable session</h3>
          <label>
            Session name
            <input
              required
              minLength={2}
              value={serviceName}
              onChange={(e) => setService(e.target.value)}
              placeholder="e.g. Equipment rental"
            />
          </label>
          <div className="bf-form-row">
            <label>
              Duration (minutes)
              <input
                type="number"
                min={5}
                max={480}
                required
                value={durationMinutes}
                onChange={(e) => setDuration(Number(e.target.value))}
              />
            </label>
            <label>
              Price label (₹)
              <input
                type="number"
                min={0}
                step="0.01"
                required
                value={price}
                onChange={(e) => setPrice(Number(e.target.value))}
              />
            </label>
          </div>
          <div className="bf-form-row">
            <label>
              Preparation (minutes)
              <input
                type="number"
                min={0}
                max={120}
                required
                value={bufferBefore}
                onChange={(e) => setBefore(Number(e.target.value))}
              />
            </label>
            <label>
              Cleanup (minutes)
              <input
                type="number"
                min={0}
                max={120}
                required
                value={bufferAfter}
                onChange={(e) => setAfter(Number(e.target.value))}
              />
            </label>
          </div>
          <p className="bf-input-hint">
            Prices are informational. BookFlow does not collect payments.
          </p>
        </div>
      </section>
      <section className="bf-panel bf-settings-panel">
        <h2>When is it available?</h2>
        <p>Hours follow your business timezone. Split a day into windows to leave a break.</p>
        <ScheduleEditor value={schedule} change={setSchedule} />
        <button className="bf-button primary full" disabled={busy || !locationId}>
          Create resource
          <Icon name="plus" size={17} />
        </button>
        <div className="bf-policy-note">
          <Icon name="shield" size={18} />
          <p>
            Preparation and cleanup must fit inside these working windows. Each resource is
            allocated exclusively to one customer at a time.
          </p>
        </div>
      </section>
    </form>
  );
}

type Save=(fn:()=>Promise<unknown>,message:string)=>Promise<void>;
function SessionEditor({resourceId,session,busy,save}:{resourceId:number;session?:Session;busy:boolean;save:Save}){
 const [name,setName]=useState(session?.name??''),[duration,setDuration]=useState(session?.duration_min??60),[before,setBefore]=useState(session?.buffer_before_min??0),[after,setAfter]=useState(session?.buffer_min??0),[price,setPrice]=useState((session?.price_cents??0)/100),[active,setActive]=useState(session?.active??true);
 return <form className="bf-session-editor" onSubmit={e=>{e.preventDefault();void save(()=>request(`/admin/resources/${resourceId}/services${session?'/'+session.id:''}`,session?'PUT':'POST',{name,durationMinutes:duration,bufferBefore:before,bufferAfter:after,priceCents:Math.round(price*100),active}),session?'Session updated.':'Session added.');}}>
 <label>Session name<input required minLength={2} maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></label>
 <div className="bf-form-row"><label>Duration (minutes)<input required type="number" min={5} max={480} value={duration} onChange={e=>setDuration(Number(e.target.value))}/></label><label>Price (₹)<input required type="number" min={0} max={1000000} step="0.01" value={price} onChange={e=>setPrice(Number(e.target.value))}/></label></div>
 <div className="bf-form-row"><label>Preparation (minutes)<input required type="number" min={0} max={120} value={before} onChange={e=>setBefore(Number(e.target.value))}/></label><label>Cleanup (minutes)<input required type="number" min={0} max={120} value={after} onChange={e=>setAfter(Number(e.target.value))}/></label></div>
 <label className="bf-checkbox"><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/>Available for new bookings</label>
 <p className="bf-input-hint">Existing reservations keep their price. Timing changes and pausing require resolving active reservations and waitlist requests first.</p>
 <button className="bf-button secondary" disabled={busy}>{session?'Save session':'Add session'}</button></form>;
}
function ResourceDetails({resource,locations,busy,save}:{resource:SettingsData['resources'][number];locations:SettingsData['locations'];busy:boolean;save:Save}){
 const [name,setName]=useState(resource.name),[type,setType]=useState(resource.business_type),[description,setDescription]=useState(resource.bio),[locationId,setLocation]=useState(resource.location_id);
 return <form className="bf-session-editor" onSubmit={e=>{e.preventDefault();void save(()=>request('/admin/resources/'+resource.id,'PUT',{name,type,description,locationId}),'Resource details updated.');}}><h3>Resource details</h3><label>Name<input required minLength={2} maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></label><label>Type<input required pattern="[a-z][a-z0-9_]*" minLength={2} maxLength={50} value={type} onChange={e=>setType(e.target.value)}/></label><label>Description<textarea maxLength={1000} value={description} onChange={e=>setDescription(e.target.value)}/></label><label>Location<select value={locationId} onChange={e=>setLocation(Number(e.target.value))}>{locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label><button className="bf-button secondary" disabled={busy}>Save resource</button></form>;
}
function LocationEditor({location,busy,save}:{location:SettingsData['locations'][number];busy:boolean;save:Save}){
 const [name,setName]=useState(location.name),[address,setAddress]=useState(location.address);
 return <details><summary>Edit location</summary><form className="bf-session-editor" onSubmit={e=>{e.preventDefault();void save(()=>request('/admin/locations/'+location.id,'PUT',{name,address}),'Location updated.');}}><label>Name<input required minLength={2} maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></label><PlaceInput label="Address" value={address} onChange={setAddress} /><button className="bf-button secondary" disabled={busy}>Save location</button></form></details>;
}
