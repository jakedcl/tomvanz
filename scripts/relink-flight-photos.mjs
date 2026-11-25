#!/usr/bin/env node --experimental-strip-types
/**
 * Re-run flight ↔ photo time-window linking for photos that have no flight reference yet.
 *
 *   node --experimental-strip-types scripts/relink-flight-photos.mjs
 *   SANITY_TOMVANZ_WRITE_TOKEN=… node --experimental-strip-types scripts/relink-flight-photos.mjs --apply
 *
 * Dry run is the default (no --apply). Never prints tokens.
 */

import {createClient} from '@sanity/client'
import {planPhotoLinks} from '../src/lib/flight-photo-link.ts'

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? 'lee2r8sa'
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production'
const apiVersion = '2026-01-01'
const apply = process.argv.includes('--apply')
const writeToken =
  process.env.SANITY_TOMVANZ_WRITE_TOKEN ??
  process.env.SANITY_API_WRITE_TOKEN ??
  process.env.SANITY_AUTH_TOKEN

const FLIGHTS_QUERY = `*[_type == "flight" && defined(startedAt) && defined(durationSeconds) && !(_id in path("drafts.**"))]{
  _id,
  title,
  startedAt,
  endedAt,
  durationSeconds,
  aircraft,
  displayCoordinates
} | order(startedAt desc)`

const CANDIDATES_QUERY = `*[_type == "photo" && !defined(flight)]{
  _id,
  takenAt,
  drone,
  cameraMake,
  cameraModel,
  "fileName": image.asset->originalFilename,
  "exifDateTimeOriginal": image.asset->metadata.exif.DateTimeOriginal,
  "lat": location.lat,
  "lng": location.lng,
  "hasFlightRef": defined(flight),
  "hasRouteRef": defined(route)
}`

function parseTrackCoords(json) {
  try {
    const raw = JSON.parse(json || '[]')
    if (!Array.isArray(raw)) return undefined
    return raw
      .map((p) => (Array.isArray(p) && p.length >= 2 ? [Number(p[0]), Number(p[1])] : null))
      .filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]))
  } catch {
    return undefined
  }
}

async function main() {
  if (!writeToken && apply) {
    console.error('Set SANITY_TOMVANZ_WRITE_TOKEN (or SANITY_API_WRITE_TOKEN) to apply patches.')
    process.exit(1)
  }

  const client = createClient({
    projectId,
    dataset,
    apiVersion,
    useCdn: !writeToken,
    token: writeToken,
  })

  const flights = await client.fetch(FLIGHTS_QUERY)
  if (flights.length === 0) {
    console.log('No published flights with start time and duration.')
    return
  }

  console.log(`${apply ? 'Applying' : 'Dry run'}: ${flights.length} flight(s) on ${dataset}.`)

  const candidates = await client.fetch(CANDIDATES_QUERY)
  let totalLinkAttempts = 0
  const unlinkedLabels = new Set()

  for (const flight of flights) {
    const {linkIds, unlinkedLabels: flightUnlinked} = planPhotoLinks(candidates, {
      _id: flight._id,
      startedAt: flight.startedAt,
      endedAt: flight.endedAt,
      durationSeconds: flight.durationSeconds,
      aircraft: flight.aircraft,
      trackCoords: parseTrackCoords(flight.displayCoordinates),
    })
    if (!apply) {
      if (linkIds.length || flightUnlinked.length) {
        console.log(
          `  ${flight.title || flight._id}: would link ${linkIds.length} photo(s)` +
            (flightUnlinked.length
              ? `; ${flightUnlinked.length} drone photo(s) still without time this pass`
              : ''),
        )
      }
      totalLinkAttempts += linkIds.length
      for (const label of flightUnlinked) unlinkedLabels.add(label)
      continue
    }

    await Promise.all(
      linkIds.map((id) =>
        client.patch(id).set({flight: {_type: 'reference', _ref: flight._id}}).commit(),
      ),
    )
    if (linkIds.length || flightUnlinked.length) {
      console.log(
        `  ${flight.title || flight._id}: linked ${linkIds.length} photo(s)` +
          (flightUnlinked.length ? `; could not time: ${flightUnlinked.join(', ')}` : ''),
      )
    }
    for (const label of flightUnlinked) unlinkedLabels.add(label)
  }

  if (!apply) {
    console.log(`Would attempt up to ${totalLinkAttempts} new link(s) across flights (per-flight plan).`)
    if (unlinkedLabels.size) {
      console.log(`${unlinkedLabels.size} unique drone photo(s) still lack a usable timestamp.`)
    }
    console.log('Pass --apply to write patches.')
  } else if (unlinkedLabels.size) {
    console.log(`${unlinkedLabels.size} unique drone photo(s) still lack a usable timestamp.`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})