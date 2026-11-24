/** Client helper for `POST /api/reverse-geocode` (Studio bearer token). */
export async function postReverseGeocodePlace(
  lat: number,
  lng: number,
  bearerToken: string,
): Promise<string | undefined> {
  const res = await fetch('/api/reverse-geocode', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({lat, lng}),
  })
  const data = (await res.json()) as {place?: string; error?: string}
  if (!res.ok) throw new Error(data.error ?? 'Could not look up that place.')
  return data.place
}