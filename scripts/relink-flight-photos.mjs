#!/usr/bin/env node --experimental-strip-types
/**
 * Re-run flight ↔ photo time-window linking for photos that have no flight reference yet.
 *
 *   node --experimental-strip-types scripts/relink-flight-photos.mjs --dry-run
 *   SANITY_TOMVANZ_WRITE_TOKEN=… node --experimental-strip-types scripts/relink-flight-photos.mjs --apply
 *
 * Dry run is the default (no --apply). Never prints tokens.
 */

import {createClient} from '@sanity/client'
import {linkPhotosToFlightDocument} from '../src/lib/link-flight-photos.ts'

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
  durationSeconds
} | order(startedAt desc)`

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

  let totalLinked = 0
  let totalUnlinkedLabels = 0

  for (const flight of flights) {
    if (!apply) {
      const {planPhotoLinks} = await import('../src/lib/flight-photo-link.ts')
      const candidates = await client.fetch(
        `*[_type == "photo" && !defined(flight)]{
          _id,
          takenAt,
          "fileName": image.asset->originalFilename,
          "exifDateTimeOriginal": image.asset->metadata.exif.DateTimeOriginal
        }`,
      )
      const {linkIds, unlinkedLabels} = planPhotoLinks(
        candidates,
        flight.startedAt,
        flight.durationSeconds,
      )
      if (linkIds.length || unlinkedLabels.length) {
        console.log(
          `  ${flight.title || flight._id}: would link ${linkIds.length} photo(s)` +
            (unlinkedLabels.length ? `; ${unlinkedLabels.length} drone photo(s) still without time` : ''),
        )
      }
      totalLinked += linkIds.length
      totalUnlinkedLabels += unlinkedLabels.length
      continue
    }

    const {unlinkedLabels} = await linkPhotosToFlightDocument(
      client,
      flight._id,
      flight.startedAt,
      flight.durationSeconds,
    )
    const linkedThisPass = await client.fetch(
      `count(*[_type == "photo" && references($id)])`,
      {id: flight._id},
    )
    console.log(
      `  ${flight.title || flight._id}: ${linkedThisPass} photo(s) reference this flight` +
        (unlinkedLabels.length ? `; could not time: ${unlinkedLabels.join(', ')}` : ''),
    )
    totalUnlinkedLabels += unlinkedLabels.length
  }

  if (!apply) {
    console.log(`Would attempt up to ${totalLinked} new link(s) across flights (per-flight plan).`)
    if (totalUnlinkedLabels) {
      console.log(`${totalUnlinkedLabels} drone file name(s) still lack a usable timestamp.`)
    }
    console.log('Pass --apply to write patches.')
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})