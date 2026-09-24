import { useEffect, useId, useState } from 'react';
import { request } from './api';
import { osmEmbedUrl } from './maps';

type Place = { label: string; lat: number; lon: number };

export default function PlaceInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const listId = useId();
  const inputId = useId();
  const [places, setPlaces] = useState<Place[]>([]);
  const [selected, setSelected] = useState<Place | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const preview = selected ?? places[0];

  useEffect(() => {
    if (selected && selected.label !== value) setSelected(null);
  }, [value, selected]);

  useEffect(() => {
    if (value.trim().length < 3 || selected?.label === value) {
      setPlaces([]);
      setLoading(false);
      return;
    }
    let current = true;
    setLoading(true);
    setPlaces([]);
    setError('');
    const timer = setTimeout(() => {
      request<Place[]>(`/admin/place-suggestions?q=${encodeURIComponent(value.trim())}`)
        .then((results) => { if (current) setPlaces(results); })
        .catch(() => { if (current) { setPlaces([]); setError('Suggestions unavailable. You can still enter an address manually.'); } })
        .finally(() => { if (current) setLoading(false); });
    }, 450);
    return () => { current = false; clearTimeout(timer); };
  }, [value, selected?.label]);

  return <div className="bf-place-input">
    <label htmlFor={inputId}>{label}</label>
    <input
      id={inputId}
      maxLength={300}
      value={value}
      onChange={(event) => { setSelected(null); onChange(event.target.value); }}
      placeholder="Search for a building, street or landmark"
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={places.length > 0}
      aria-controls={listId}
    />
    {loading && <small role="status">Finding places…</small>}
    {error && <small role="status">{error}</small>}
    {!loading && places.length > 0 && <div className="bf-place-suggestions" id={listId} role="listbox" aria-label="Suggested places">
      {places.map((place) => <button key={`${place.lat}:${place.lon}`} type="button" role="option" aria-selected={selected?.label === place.label} onClick={() => {
        setSelected(place);
        setPlaces([]);
        setError('');
        onChange(place.label);
      }}>{place.label}</button>)}
    </div>}
    {preview && <div className="bf-place-preview">
      <iframe title={`Map of ${preview.label}`} src={osmEmbedUrl(preview.lat, preview.lon)} loading="lazy" />
      <small>{selected ? 'Selected place' : 'Preview of the first suggestion. Choose the correct place above.'} · Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a></small>
    </div>}
  </div>;
}
