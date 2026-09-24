/** Google Maps URL action; no API key is required for directions links. */
export function mapsDirectionsUrl(locationName: string, address: string): string | null {
  const destination = [locationName.trim(), address.trim()].filter(Boolean).join(', ');
  if (!address.trim()) return null;
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('destination', destination);
  return url.toString();
}

export function osmEmbedUrl(lat: number, lon: number): string {
  const url = new URL('https://www.openstreetmap.org/export/embed.html');
  url.searchParams.set('bbox', [lon - 0.006, lat - 0.004, lon + 0.006, lat + 0.004].join(','));
  url.searchParams.set('layer', 'mapnik');
  url.searchParams.set('marker', `${lat},${lon}`);
  return url.toString();
}
