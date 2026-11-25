#!/usr/bin/env node --experimental-strip-types
/**
 * Backfill photo metadata from original assets and propose flight/route links.
 *
 *   node --experimental-strip-types scripts/backfill-photo-metadata.mjs
 *   SANITY_TOMVANZ_WRITE_TOKEN=… node --experimental-strip-types scripts/backfill-photo-metadata.mjs --apply
 *
 * Dry run is the default. Never prints tokens.
 */

import {createClient} from '@sanity/client'

import {effectiveDrone} from '../src/lib/drone.ts'
import {parseDisplayCoordinates, planSinglePhotoLinks} from '../src/lib/photo-auto-link.ts'
import {readPhotoMetaWithAltitude} from '../src/lib/photo-exif.ts'

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? 'lee2r8sa'
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production'
const apiVersion = '2026-01-01'
const apply = process.argv.includes('--apply')
const writeToken =
  process.env.SANITY_TOMVANZ_WRITE_TOKEN ??
  process.env.SANITY_API_WRITE_TOKEN ??
  process.env.SANITY_AUTH_TOKEN

const PHOTOS_QUERY = `*[_type == "photo" && defined(image.asset) && !(_id in path("drafts.**"))] | order(_id asc) {
  _id,
  title,
  takenAt,
  cameraMake,
  cameraModel,
  altitudeMeters,
  drone,
  "fileName": image.asset->originalFilename,
  "assetUrl": image.asset->url,
  "lat": location.lat,
  "lng": location.lng,
  "flightId": flight._ref,
  "routeId": route._ref,
  "flightTitle": flight->title,
  "routeTitle": route->title
}`

const FLIGHTS_QUERY = `*[_type == "flight" && defined(startedAt) && defined(durationSeconds) && !(_id in path("drafts.**"))]{
  _id,
  title,
  startedAt,
  endedAt,
  durationSeconds,
  aircraft,
  displayCoordinates
}`

const ROUTES_QUERY = `*[_type == "track" && defined(route.coordinates) && !(_id in path("drafts.**"))]{
  _id,
  title,
  startedAt,
  endedAt,
  "coordinates": route.coordinates
}`

const etFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

function formatEt(iso) {
  if (!iso) return '—'
  try {
    return `${etFormatter.format(new Date(iso))} ET`
  } catch {
    return '—'
  }
}

function currentLink(row) {
  if (row.flightId) return `flight:${row.flightTitle || row.flightId}`
  if (row.routeId) return `route:${row.routeTitle || row.routeId}`
  return '—'
}

function proposedLabel(plan, flights, routes) {
  if (plan.flightId) {
    const f = flights.find((item) => item._id === plan.flightId)
    return `flight:${f?.title || plan.flightId}`
  }
  if (plan.routeId) {
    const r = routes.find((item) => item._id === plan.routeId)
    return `route:${r?.title || plan.routeId}`
  }
  if (plan.linkReview) return 'review'
  return '—'
}

function verdict(row, plan, metaChanged) {
  if (row.flightId || row.routeId) {
    const matches =
      (plan.flightId && plan.flightId === row.flightId) ||
      (plan.routeId && plan.routeId === row.routeId)
    if (matches && !metaChanged) return 'agree'
    return 'skip-manual'
  }
  if (plan.linkReview) return 'review'
  if (plan.flightId || plan.routeId || metaChanged) return metaChanged && !plan.flightId && !plan.routeId ? 'metadata' : 'propose'
  return 'agree'
}

function routeFromDoc(doc) {
  let coordinates = []
  try {
    const raw = JSON.parse(doc.coordinates)
    if (Array.isArray(raw)) {
      coordinates = raw
        .map((p) => (Array.isArray(p) && p.length >= 2 ? [Number(p[0]), Number(p[1])] : null))
        .filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    }
  } catch {
    return null
  }
  if (coordinates.length < 2) return null
  return {_id: doc._id, startedAt: doc.startedAt, endedAt: doc.endedAt, coordinates}
}

function flightFromDoc(doc) {
  return {
    _id: doc._id,
    startedAt: doc.startedAt,
    endedAt: doc.endedAt,
    durationSeconds: doc.durationSeconds,
    aircraft: doc.aircraft,
    trackCoords: parseDisplayCoordinates(doc.displayCoordinates),
  }
}

function metaPatch(row, meta) {
  const patch = {}
  const drone = effectiveDrone(meta.drone ?? row.drone, row.fileName)
  if (meta.cameraMake && meta.cameraMake !== row.cameraMake) patch.cameraMake = meta.cameraMake
  if (meta.cameraModel && meta.cameraModel !== row.cameraModel) patch.cameraModel = meta.cameraModel
  if (meta.takenAt && meta.takenAt !== row.takenAt) patch.takenAt = meta.takenAt
  if (meta.altitudeMeters != null && meta.altitudeMeters !== row.altitudeMeters) {
    patch.altitudeMeters = meta.altitudeMeters
  }
  if (drone && row.drone !== true) patch.drone = true
  return patch
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
    useCdn: false,
    token: writeToken,
  })

  const [photos, flightsRaw, routesRaw] = await Promise.all([
    client.fetch(PHOTOS_QUERY),
    client.fetch(FLIGHTS_QUERY),
    client.fetch(ROUTES_QUERY),
  ])

  const flights = flightsRaw.map(flightFromDoc)
  const routes = routesRaw.map(routeFromDoc).filter(Boolean)

  console.log(`${apply ? 'Applying' : 'Dry run'}: ${photos.length} photo(s) on ${dataset}.`)
  console.log('id\ttitle\tmodel\ttime ET\tcurrent\tproposed\tverdict')

  let applyCount = 0

  for (const row of photos) {
    let meta = {}
    if (row.assetUrl) {
      try {
        const res = await fetch(row.assetUrl)
        if (res.ok) {
          const buf = new Uint8Array(await res.arrayBuffer())
          meta = await readPhotoMetaWithAltitude(buf, row.fileName)
        }
      } catch {
        // skip download/parse errors
      }
    }

    const lat = row.lat ?? meta.lat
    const lng = row.lng ?? meta.lng
    const takenAt = row.takenAt || meta.takenAt
    const model = meta.cameraModel || row.cameraModel || '—'

    const candidate = {
      _id: row._id,
      takenAt,
      fileName: row.fileName,
      lat,
      lng,
      cameraMake: meta.cameraMake || row.cameraMake,
      cameraModel: meta.cameraModel || row.cameraModel,
      drone: effectiveDrone(row.drone, row.fileName),
      hasFlightRef: Boolean(row.flightId),
      hasRouteRef: Boolean(row.routeId),
    }

    const plan =
      row.flightId || row.routeId
        ? {}
        : planSinglePhotoLinks(candidate, flights, routes)

    const patch = metaPatch(row, meta)
    const metaChanged = Object.keys(patch).length > 0

    if (!row.flightId && plan.flightId) patch.flight = {_type: 'reference', _ref: plan.flightId}
    if (!row.routeId && plan.routeId) patch.route = {_type: 'reference', _ref: plan.routeId}
    if (plan.linkReview) patch.linkReview = plan.linkReview

    const v = verdict(row, plan, metaChanged)
    const proposed = proposedLabel(plan, flights, routes)
    const title = (row.title || '').replace(/\t/g, ' ')
    console.log(
      `${row._id}\t${title || '—'}\t${model}\t${formatEt(takenAt)}\t${currentLink(row)}\t${proposed}\t${v}`,
    )

    if (!apply || v === 'skip-manual') continue
    if (Object.keys(patch).length === 0) continue

    await client.patch(row._id).set(patch).commit()
    applyCount += 1
  }

  if (!apply) {
    console.log('Run with --apply after reviewing the dry-run output.')
  } else {
    console.log(`Patched ${applyCount} photo(s).`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})