#!/usr/bin/env node --experimental-strip-types
/**
 * Backfill camera / takenAt / altitude on published photos from image asset EXIF metadata.
 *
 *   node --experimental-strip-types scripts/backfill-photo-metadata.mjs
 *   SANITY_TOMVANZ_WRITE_TOKEN=… node --experimental-strip-types scripts/backfill-photo-metadata.mjs --apply
 *
 * Dry run is the default. Never prints tokens.
 */

import {createClient} from '@sanity/client'
import {isDroneFileName} from '../src/lib/drone.ts'
import {takenAtFromExifDateTime} from '../src/lib/photo-taken-at.ts'

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? 'lee2r8sa'
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production'
const apiVersion = '2026-01-01'
const apply = process.argv.includes('--apply')
const writeToken =
  process.env.SANITY_TOMVANZ_WRITE_TOKEN ??
  process.env.SANITY_API_WRITE_TOKEN ??
  process.env.SANITY_AUTH_TOKEN

const QUERY = `*[_type == "photo" && defined(image.asset) && !(_id in path("drafts.**"))] | order(_updatedAt desc) {
  _id,
  title,
  takenAt,
  cameraMake,
  cameraModel,
  altitudeMeters,
  drone,
  "fileName": image.asset->originalFilename,
  "exif": image.asset->metadata.exif,
  "loc": image.asset->metadata.location
}`

function exifString(exif, key) {
  const value = exif?.[key]
  return typeof value === 'string' ? value.trim() : undefined
}

function altFromExif(exif, fileName) {
  if (!isDroneFileName(fileName)) return undefined
  const raw = exif?.GPSAltitude
  const ref = exif?.GPSAltitudeRef
  const value = Number(raw)
  if (!Number.isFinite(value)) return undefined
  const belowSea = ref === 1 || ref === '1'
  return Math.round((belowSea ? -value : value) * 10) / 10
}

function planPatch(doc) {
  const exif = doc.exif ?? {}
  const fileName = doc.fileName
  const patch = {}
  const make = exifString(exif, 'Make')
  const model = exifString(exif, 'Model')
  const takenFromExif = takenAtFromExifDateTime(exifString(exif, 'DateTimeOriginal'))
  const alt = altFromExif(exif, fileName)
  const drone = doc.drone === true || isDroneFileName(fileName)

  if (make && make !== doc.cameraMake) patch.cameraMake = make
  if (model && model !== doc.cameraModel) patch.cameraModel = model
  if (takenFromExif && takenFromExif !== doc.takenAt) patch.takenAt = takenFromExif
  if (drone && alt != null && alt !== doc.altitudeMeters) patch.altitudeMeters = alt
  if (drone && doc.drone !== true) patch.drone = true

  return patch
}

function table(rows) {
  const header = ['Photo', 'File', 'Fields to set']
  const lines = [header.join('\t')]
  for (const row of rows) {
    lines.push([row.title || row._id, row.fileName || '—', row.fields].join('\t'))
  }
  return lines.join('\n')
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

  const docs = await client.fetch(QUERY)
  const planned = docs
    .map((doc) => {
      const patch = planPatch(doc)
      const keys = Object.keys(patch)
      if (keys.length === 0) return null
      return {
        _id: doc._id,
        title: doc.title,
        fileName: doc.fileName,
        patch,
        fields: keys.join(', '),
      }
    })
    .filter(Boolean)

  console.log(`${apply ? 'Applying' : 'Dry run'}: ${planned.length} of ${docs.length} photo(s) on ${dataset}.`)
  console.log(table(planned.slice(0, 200)))
  if (planned.length > 200) console.log(`… and ${planned.length - 200} more`)

  if (!apply) {
    console.log('Pass --apply to write patches.')
    return
  }

  for (const row of planned) {
    await client.patch(row._id).set(row.patch).commit()
  }
  console.log(`Patched ${planned.length} photo(s).`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
