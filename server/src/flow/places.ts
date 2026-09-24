export type PlaceSuggestion = { label: string; lat: number; lon: number };

type PhotonFeature = {
  properties?: Record<string, unknown>;
  geometry?: { coordinates?: unknown };
};

export function parsePlaces(data: unknown): PlaceSuggestion[] {
  if (!data || typeof data !== 'object' || !Array.isArray((data as { features?: unknown }).features)) return [];
  const suggestions: PlaceSuggestion[] = [];
  for (const feature of (data as { features: PhotonFeature[] }).features) {
    const coordinates = feature.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
    const [lon, lat] = coordinates;
    if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const p = feature.properties ?? {};
    const parts = [
      p.name,
      [p.housenumber, p.street].filter(Boolean).join(' '),
      p.district,
      p.city,
      p.state,
      p.country,
    ].filter((part): part is string => typeof part === 'string' && !!part.trim());
    const label = [...new Set(parts)].join(', ').slice(0, 300);
    if (label && !suggestions.some((item) => item.label === label)) suggestions.push({ label, lat, lon });
  }
  return suggestions;
}

export async function suggestPlaces(query: string): Promise<PlaceSuggestion[]> {
  const url = new URL(process.env.PHOTON_URL ?? 'https://photon.komoot.io/api/');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '5');
  url.searchParams.set('lang', 'en');
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw Object.assign(new Error('Place suggestions are temporarily unavailable'), { status: 502 });
  return parsePlaces(await response.json());
}
