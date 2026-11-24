'use client'

import {useCallback, useEffect, useRef, useState} from 'react'
import {Badge, Box, Button, Card, Flex, Spinner, Stack, Text, TextInput} from '@sanity/ui'
import {useClient} from 'sanity'
import {useRouter} from 'sanity/router'
import {
  ACTIVITIES,
  flightFromUpload,
  guessActivity,
  isFlightLogFile,
  isGpxFile,
  isPhotoFile,
  photoFromUpload,
  plausibleTime,
  readPhotoMeta,
  routeFromUpload,
  runPool,
  titleFromFileName,
  type Activity,
  type PhotoMeta,
} from '../../lib/bulk-upload'
import {photoLinkWindow} from '../../lib/flight-photo-link'
import {lineLengthMeters} from '../../lib/simplify-route'
import {readGpx} from '../lib/parseGpx'

/** The little the uploader needs from the Studio's connection to Sanity. */
export type UploaderClient = {
  uploadImage: (file: File) => Promise<{_id: string}>
  uploadFile: (file: File) => Promise<{_id: string}>
  /** The id of a photo already using this image, if any. */
  findByAsset: (assetId: string) => Promise<string | null>
  /** The id of a route already using this GPX file, if any. */
  findRouteByAsset: (assetId: string) => Promise<string | null>
  findFlightByAsset: (assetId: string) => Promise<string | null>
  createPhoto: (doc: ReturnType<typeof photoFromUpload>) => Promise<{_id: string}>
  createRoute: (doc: ReturnType<typeof routeFromUpload>) => Promise<{_id: string}>
  createFlight: (doc: ReturnType<typeof flightFromUpload>) => Promise<{_id: string}>
  linkPhotosToFlight: (flightId: string, startedAt: string, durationSeconds: number) => Promise<void>
  linkPhotoToFlights: (photoId: string, takenAt: string) => Promise<void>
  parseFlightLog: (assetId: string, sourceFilename: string) => Promise<ParseFlightPayload>
}

type ParseFlightPayload = {
  defaultTitle: string
  startedAt?: string
  place?: string
  durationSeconds: number
  distanceMeters: number
  maxHeightMeters: number
  aircraft: string
  displayCoordinates: string
  series: string
  videoSegments: {startSeconds: number; endSeconds: number}[]
  home?: {lat: number; lng: number}
  noMap?: boolean
}

type Status =
  | 'reading'
  | 'ready'
  | 'waiting'
  | 'uploading'
  | 'done'
  | 'no-location'
  | 'no-gps'
  | 'duplicate'
  | 'skipped'
  | 'error'

type Row = {
  id: number
  name: string
  kind: 'photo' | 'route' | 'flight'
  status: Status
  note?: string
  docId?: string
  fileAssetId?: string
  /** Photos: a small picture of the file, so the right title goes on the right photo. */
  preview?: string
  /** Photos: what was read from the file (GPS, date taken). */
  meta?: PhotoMeta
  /** Routes: the line and start time read from the GPX. */
  route?: {coordinates: [number, number][]; startedAt?: string}
  /** Routes: bike, hike or other. Left empty when the file doesn't say, so it's chosen on purpose. */
  activity?: Activity
  title: string
  flightParse?: ParseFlightPayload
}

const CONCURRENCY = 3
const METERS_PER_MILE = 1609.344

const STATUS_LABEL: Record<Status, string> = {
  reading: 'Reading',
  ready: 'Ready',
  waiting: 'Waiting',
  uploading: 'Uploading',
  done: 'On the map',
  'no-location': 'Needs a location',
  'no-gps': 'No GPS track',
  duplicate: 'Already uploaded',
  skipped: 'Skipped',
  error: 'Failed',
}

const STATUS_TONE: Record<Status, 'default' | 'positive' | 'caution' | 'critical' | 'primary'> = {
  reading: 'default',
  ready: 'primary',
  waiting: 'default',
  uploading: 'primary',
  done: 'positive',
  'no-location': 'caution',
  'no-gps': 'caution',
  duplicate: 'default',
  skipped: 'default',
  error: 'critical',
}

/** Rows whose details can still be changed or that can still be taken off the list. */
const editable = (row: Row) => row.status === 'ready' || row.status === 'error'

/** What a route still needs before it can be uploaded (photos need nothing). */
function missingDetails(row: Row): string | undefined {
  if (!editable(row)) return undefined
  if (row.kind === 'route') {
    if (!row.title.trim()) return 'Add a title.'
    if (!row.activity) return 'Pick bike, hike or other.'
  }
  if (row.kind === 'flight' && !row.title.trim()) return 'Add a title.'
  return undefined
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

function flightSummary(parse: ParseFlightPayload) {
  const miles = parse.distanceMeters / METERS_PER_MILE
  const parts = [
    parse.aircraft,
    parse.place,
    parse.durationSeconds ? `${Math.round(parse.durationSeconds / 60)} min` : null,
    miles > 0 ? `${miles.toFixed(1)} mi` : null,
  ].filter(Boolean)
  if (parse.startedAt) {
    parts.unshift(
      new Date(parse.startedAt).toLocaleDateString(undefined, {year: 'numeric', month: 'short', day: 'numeric'}),
    )
  }
  return parts.join(' · ')
}

function routeSummary(route: NonNullable<Row['route']>) {
  const miles = lineLengthMeters(route.coordinates) / METERS_PER_MILE
  const parts = [`${miles.toFixed(1)} mi`]
  if (route.startedAt) {
    parts.push(new Date(route.startedAt).toLocaleDateString(undefined, {year: 'numeric', month: 'short', day: 'numeric'}))
  }
  return parts.join(' · ')
}

const FlightIcon = () => (
  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 14l4-2 9-7 2 2-7 9-2 4-3-1 2-3-3 1z" />
  </svg>
)

const RouteIcon = () => (
  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="6" cy="18" r="2" />
    <circle cx="18" cy="6" r="2" />
    <path d="M8 18h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h6" />
  </svg>
)

/** The Studio tool: hands the screen the Studio's own Sanity connection. */
export function BulkUploadTool() {
  const client = useClient({apiVersion: '2026-01-01'})
  const router = useRouter()
  const uploader: UploaderClient = {
    uploadImage: (file) => client.assets.upload('image', file, {filename: file.name}),
    uploadFile: (file) => client.assets.upload('file', file, {filename: file.name}),
    findByAsset: (assetId) =>
      client.fetch<string | null>(
        `*[_type == "photo" && image.asset._ref == $id][0]._id`,
        {id: assetId},
      ),
    findRouteByAsset: (assetId) =>
      client.fetch<string | null>(
        `*[_type == "track" && file.asset._ref == $id][0]._id`,
        {id: assetId},
      ),
    findFlightByAsset: (assetId) =>
      client.fetch<string | null>(`*[_type == "flight" && log.asset._ref == $id][0]._id`, {id: assetId}),
    createPhoto: (doc) => client.create(doc),
    createRoute: (doc) => client.create(doc),
    createFlight: (doc) => client.create(doc),
    linkPhotosToFlight: async (flightId, startedAt, durationSeconds) => {
      const {start, end} = photoLinkWindow(startedAt, durationSeconds)
      const ids = await client.fetch<string[]>(
        `*[_type == "photo" && defined(takenAt) && takenAt >= $start && takenAt <= $end && !defined(flight)]._id`,
        {start, end},
      )
      await Promise.all(
        ids.map((id) =>
          client.patch(id).set({flight: {_type: 'reference', _ref: flightId}}).commit(),
        ),
      )
    },
    parseFlightLog: async (assetId, sourceFilename) => {
      const token = client.config().token
      if (!token) throw new Error('Sign in to Studio to parse flight logs.')
      const res = await fetch('/api/parse-flight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({assetId, sourceFilename}),
      })
      const data = (await res.json()) as ParseFlightPayload & {error?: string}
      if (!res.ok) throw new Error(data.error ?? 'Could not parse that flight log.')
      return data
    },
    linkPhotoToFlights: async (photoId, takenAt) => {
      const flights = await client.fetch<{_id: string; startedAt: string; durationSeconds: number}[]>(
        `*[_type == "flight" && defined(startedAt) && defined(durationSeconds)]{
          _id, startedAt, durationSeconds
        }`,
      )
      const taken = new Date(takenAt).getTime()
      for (const f of flights) {
        const {start, end} = photoLinkWindow(f.startedAt, f.durationSeconds)
        const startMs = new Date(start).getTime()
        const endMs = new Date(end).getTime()
        if (taken >= startMs && taken <= endMs) {
          await client.patch(photoId).set({flight: {_type: 'reference', _ref: f._id}}).commit()
          return
        }
      }
    },
  }
  return (
    <BulkUploadView
      uploader={uploader}
      openDocument={(id, type) => router.navigateIntent('edit', {id, type})}
    />
  )
}

/**
 * Drop in a pile of photos and GPX routes, fill in what's asked (a title if you want one for photos;
 * a title and bike/hike/other for routes), take off any you don't want, then press one button.
 * Nothing is sent to Sanity until that button. Photos are placed from their own GPS data and dated from
 * when they were taken; routes are dated from their start time. Drone photos are spotted from their
 * DJI file names by the site.
 */
export function BulkUploadView({
  uploader,
  openDocument,
}: {
  uploader: UploaderClient
  openDocument: (docId: string, type: 'photo' | 'track' | 'flight') => void
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [running, setRunning] = useState(false)
  const [dragging, setDragging] = useState(false)
  const nextId = useRef(1)
  const filesById = useRef(new Map<number, File>())
  const picker = useRef<HTMLInputElement | null>(null)
  const previewsById = useRef(new Map<number, string>())
  // The latest rows, for the upload to read what was typed since the last render.
  const rowsRef = useRef<Row[]>([])
  rowsRef.current = rows

  // Give back the preview pictures when the tool closes.
  useEffect(() => {
    const files = filesById.current
    const previews = previewsById.current
    return () => {
      for (const url of previews.values()) URL.revokeObjectURL(url)
      previews.clear()
      files.clear()
    }
  }, [])

  const patchRow = useCallback((id: number, patch: Partial<Row>) => {
    setRows((current) => current.map((row) => (row.id === id ? {...row, ...patch} : row)))
  }, [])

  const forget = useCallback((ids: number[]) => {
    for (const id of ids) {
      const url = previewsById.current.get(id)
      if (url) URL.revokeObjectURL(url)
      previewsById.current.delete(id)
      filesById.current.delete(id)
    }
  }, [])

  const processOne = useCallback(
    async (id: number) => {
      const file = filesById.current.get(id)
      const row = rowsRef.current.find((item) => item.id === id)
      if (!file || !row) return
      patchRow(id, {status: 'uploading', note: undefined})
      try {
        if (row.kind === 'flight') {
          if (!row.flightParse || !row.fileAssetId || !row.title.trim()) {
            throw new Error('This flight is missing details.')
          }
          const existing = await uploader.findFlightByAsset(row.fileAssetId)
          if (existing) {
            patchRow(id, {status: 'duplicate', docId: existing, note: 'Already on the map.'})
            return
          }
          const doc = await uploader.createFlight(
            flightFromUpload(row.fileAssetId, {
              ...row.flightParse,
              hasGps: !row.flightParse.noMap,
              title: row.title,
              sourceFilename: row.name,
            }),
          )
          if (row.flightParse.startedAt && row.flightParse.durationSeconds) {
            await uploader.linkPhotosToFlight(doc._id, row.flightParse.startedAt, row.flightParse.durationSeconds)
          }
          if (row.flightParse.noMap) {
            patchRow(id, {
              status: 'no-gps',
              docId: doc._id,
              note: 'Saved, but it has no GPS and will not show on the map.',
            })
          } else {
            patchRow(id, {status: 'done', docId: doc._id})
          }
          return
        }

        if (row.kind === 'route') {
          if (!row.route || !row.activity || !row.title.trim()) throw new Error('This route is missing details.')
          const asset = await uploader.uploadFile(file)
          // The same GPX uploaded twice gives back the same file: don't make a second route for it.
          const existing = await uploader.findRouteByAsset(asset._id)
          if (existing) {
            patchRow(id, {status: 'duplicate', docId: existing, note: 'Already on the map.'})
            return
          }
          const doc = await uploader.createRoute(
            routeFromUpload(asset._id, {
              title: row.title,
              activity: row.activity,
              coordinates: row.route.coordinates,
              startedAt: row.route.startedAt,
            }),
          )
          patchRow(id, {status: 'done', docId: doc._id})
          return
        }

        const meta = row.meta ?? {}
        const asset = await uploader.uploadImage(file)

        // Uploading the same photo twice gives back the same asset: don't make a second photo for it.
        const existing = await uploader.findByAsset(asset._id)
        if (existing) {
          patchRow(id, {status: 'duplicate', docId: existing, note: 'Already on the map.'})
          return
        }

        const doc = await uploader.createPhoto(photoFromUpload(asset._id, meta, row.title))
        if (meta.takenAt) {
          await uploader.linkPhotoToFlights(doc._id, meta.takenAt)
        }
        if (meta.lat == null) {
          patchRow(id, {
            status: 'no-location',
            docId: doc._id,
            note: 'No GPS in this photo. Open it and drop a pin, or it won’t show on the map.',
          })
        } else {
          patchRow(id, {status: 'done', docId: doc._id})
        }
      } catch (error) {
        patchRow(id, {status: 'error', note: error instanceof Error ? error.message : 'Upload failed.'})
      }
    },
    [uploader, patchRow],
  )

  const uploadIds = useCallback(
    async (ids: number[]) => {
      setRunning(true)
      setRows((current) => current.map((row) => (ids.includes(row.id) ? {...row, status: 'waiting', note: undefined} : row)))
      await runPool(ids, CONCURRENCY, processOne)
      setRunning(false)
    },
    [processOne],
  )

  const addFiles = useCallback(
    (list: FileList | File[]) => {
      const added: Row[] = []
      const photos: {id: number; file: File}[] = []
      const routes: {id: number; file: File}[] = []
      const flights: {id: number; file: File}[] = []
      for (const file of Array.from(list)) {
        const id = nextId.current++
        if (isGpxFile(file)) {
          filesById.current.set(id, file)
          added.push({id, name: file.name, kind: 'route', status: 'reading', title: ''})
          routes.push({id, file})
        } else if (isFlightLogFile(file)) {
          filesById.current.set(id, file)
          added.push({id, name: file.name, kind: 'flight', status: 'reading', title: ''})
          flights.push({id, file})
        } else if (isPhotoFile(file)) {
          filesById.current.set(id, file)
          const preview = URL.createObjectURL(file)
          previewsById.current.set(id, preview)
          added.push({id, name: file.name, kind: 'photo', status: 'reading', preview, title: ''})
          photos.push({id, file})
        } else {
          added.push({
            id,
            name: file.name,
            kind: 'photo',
            status: 'skipped',
            note: 'Not a photo, GPX route, or DJI flight log.',
            title: '',
          })
        }
      }
      setRows((current) => [...current, ...added])

      // Reading the file happens here, before anything is uploaded, so anything missing shows up early.
      for (const {id, file} of photos) {
        void readPhotoMeta(file).then((meta) => {
          patchRow(id, {
            status: 'ready',
            meta,
            note: meta.lat == null ? 'No GPS in this photo. You’ll need to drop a pin after uploading.' : undefined,
          })
        })
      }
      for (const {id, file} of flights) {
        void (async () => {
          try {
            const asset = await uploader.uploadFile(file)
            const duplicate = await uploader.findFlightByAsset(asset._id)
            if (duplicate) {
              patchRow(id, {status: 'duplicate', docId: duplicate, note: 'Already on the map.', fileAssetId: asset._id})
              return
            }
            const parsed = await uploader.parseFlightLog(asset._id, file.name)
            patchRow(id, {
              status: 'ready',
              fileAssetId: asset._id,
              flightParse: parsed,
              title: parsed.defaultTitle,
              note: [
                flightSummary(parsed),
                parsed.noMap ? 'No GPS in this log — it will not appear on the map.' : undefined,
              ]
                .filter(Boolean)
                .join(' '),
            })
          } catch (error: unknown) {
            forget([id])
            patchRow(id, {
              status: 'error',
              note: error instanceof Error ? error.message : 'Could not read that flight log.',
            })
          }
        })()
      }
      for (const {id, file} of routes) {
        void file
          .text()
          .then((text) => {
            const gpx = readGpx(text)
            const route = {
              coordinates: gpx.coordinates,
              startedAt: plausibleTime(gpx.time ? new Date(gpx.time) : null),
            }
            patchRow(id, {
              status: 'ready',
              route,
              activity: guessActivity(gpx.type),
              title: gpx.name ?? titleFromFileName(file.name),
              note: routeSummary(route),
            })
          })
          .catch((error: unknown) => {
            forget([id])
            patchRow(id, {
              status: 'skipped',
              note: error instanceof Error ? error.message : 'Couldn’t read that GPX.',
            })
          })
      }
    },
    [patchRow, forget],
  )

  const counts = rows.reduce(
    (acc, row) => ({...acc, [row.status]: (acc[row.status] ?? 0) + 1}),
    {} as Partial<Record<Status, number>>,
  )
  const ready = rows.filter((row) => row.status === 'ready')
  const complete = ready.filter((row) => !missingDetails(row))
  const incomplete = ready.length - complete.length
  const reading = rows.some((row) => row.status === 'reading')
  const failed = rows.filter((row) => row.status === 'error').map((row) => row.id)
  const sent = rows.filter((row) => ['done', 'no-location', 'duplicate', 'error'].includes(row.status)).length
  const inFlight = rows.filter((row) => row.status === 'waiting' || row.status === 'uploading').length
  const photoCount = complete.filter((row) => row.kind === 'photo').length
  const routeCount = complete.filter((row) => row.kind === 'route').length
  const flightCount = complete.filter((row) => row.kind === 'flight').length
  const uploadLabel =
    complete.length === 0
      ? 'Upload'
      : `Upload ${[
          photoCount ? plural(photoCount, 'photo') : '',
          routeCount ? plural(routeCount, 'route') : '',
          flightCount ? plural(flightCount, 'flight') : '',
        ]
          .filter(Boolean)
          .join(' and ')}`

  return (
    <Box padding={4} style={{maxWidth: 760, margin: '0 auto'}}>
      <Stack gap={4}>
        <Stack gap={2}>
          <Text size={3} weight="bold">
            Bulk upload
          </Text>
          <Text size={1} muted>
            Drop in photos, GPX routes, and DJI flight logs (`FlightRecord_*.txt`). Give photos a title if you like;
            routes need a title and bike, hike or other; flights need a title (pre-filled when possible). Remove any you
            don’t want, then press Upload.
          </Text>
        </Stack>

        <Card
          padding={5}
          radius={3}
          tone={dragging ? 'primary' : 'default'}
          border
          style={{borderStyle: 'dashed', textAlign: 'center', cursor: 'pointer'}}
          onDragOver={(event: React.DragEvent) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event: React.DragEvent) => {
            event.preventDefault()
            setDragging(false)
            if (event.dataTransfer.files.length > 0) addFiles(event.dataTransfer.files)
          }}
          onClick={() => picker.current?.click()}
        >
          <Stack gap={3}>
            <Text size={2} weight="medium">
              Drop photos, routes, and flight logs here
            </Text>
            <Text size={1} muted>
              or click to choose them
            </Text>
          </Stack>
          <input
            ref={picker}
            type="file"
            accept="image/*,.gpx,application/gpx+xml,.txt,text/plain"
            multiple
            hidden
            onChange={(event) => {
              if (event.target.files && event.target.files.length > 0) addFiles(event.target.files)
              event.target.value = ''
            }}
          />
        </Card>

        {rows.length > 0 ? (
          <Stack gap={3}>
            <Flex align="center" justify="space-between" gap={3} wrap="wrap">
              <Flex align="center" gap={2}>
                {running || reading ? <Spinner muted /> : null}
                <Text size={1} muted>
                  {running ? `${sent} of ${sent + inFlight} uploaded` : `${complete.length} ready to upload`}
                  {!running && incomplete ? ` · ${incomplete} need details` : ''}
                  {counts['no-location'] ? ` · ${counts['no-location']} need a location` : ''}
                  {counts.duplicate ? ` · ${counts.duplicate} already uploaded` : ''}
                  {counts.error ? ` · ${counts.error} failed` : ''}
                </Text>
              </Flex>
              <Flex gap={2}>
                {failed.length > 0 && !running ? (
                  <Button text="Retry failed" mode="ghost" tone="critical" fontSize={1} onClick={() => void uploadIds(failed)} />
                ) : null}
                {!running ? (
                  <Button
                    text="Clear list"
                    mode="bleed"
                    fontSize={1}
                    onClick={() => {
                      forget(rows.map((row) => row.id))
                      setRows([])
                    }}
                  />
                ) : null}
                <Button
                  text={uploadLabel}
                  tone="positive"
                  fontSize={1}
                  disabled={running || reading || incomplete > 0 || complete.length === 0}
                  onClick={() => void uploadIds(complete.map((row) => row.id))}
                />
              </Flex>
            </Flex>

            <Card border radius={2} overflow="hidden">
              <Stack>
                {rows.map((row, index) => {
                  const missing = missingDetails(row)
                  const badge: Status | 'needs-details' = row.status === 'ready' && missing ? 'needs-details' : row.status
                  return (
                    <Card key={row.id} padding={3} borderTop={index > 0} tone="default">
                      <Flex align="center" gap={3}>
                        {row.kind === 'flight' ? (
                          <Flex
                            align="center"
                            justify="center"
                            aria-hidden
                            style={{width: 56, height: 56, borderRadius: 3, flexShrink: 0, background: 'rgba(217,119,6,0.15)'}}
                          >
                            <FlightIcon />
                          </Flex>
                        ) : row.kind === 'route' ? (
                          <Flex
                            align="center"
                            justify="center"
                            aria-hidden
                            style={{width: 56, height: 56, borderRadius: 3, flexShrink: 0, background: 'rgba(128,128,128,0.15)'}}
                          >
                            <RouteIcon />
                          </Flex>
                        ) : row.preview ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={row.preview}
                            alt=""
                            style={{width: 56, height: 56, objectFit: 'cover', borderRadius: 3, flexShrink: 0}}
                          />
                        ) : null}
                        <Stack gap={2} style={{minWidth: 0, flex: 1}}>
                          <Text size={1} muted textOverflow="ellipsis">
                            {row.name}
                          </Text>
                          {editable(row) ? (
                            <TextInput
                              fontSize={1}
                              padding={2}
                              placeholder={row.kind === 'photo' ? 'Title (optional)' : 'Title'}
                              aria-label={`Title for ${row.name}`}
                              value={row.title}
                              onChange={(event) => patchRow(row.id, {title: event.currentTarget.value})}
                            />
                          ) : row.title ? (
                            <Text size={1} weight="medium" textOverflow="ellipsis">
                              {row.title}
                            </Text>
                          ) : null}
                          {row.kind === 'route' && row.route && editable(row) ? (
                            <Flex gap={1} role="group" aria-label={`Activity for ${row.name}`}>
                              {ACTIVITIES.map((activity) => (
                                <Button
                                  key={activity.value}
                                  text={activity.label}
                                  fontSize={1}
                                  padding={2}
                                  mode={row.activity === activity.value ? 'default' : 'ghost'}
                                  tone={row.activity === activity.value ? 'primary' : 'default'}
                                  aria-pressed={row.activity === activity.value}
                                  onClick={() => patchRow(row.id, {activity: activity.value})}
                                />
                              ))}
                            </Flex>
                          ) : null}
                          {row.note || missing ? (
                            <Text size={1} muted>
                              {[row.note, missing].filter(Boolean).join(' ')}
                            </Text>
                          ) : null}
                        </Stack>
                        <Flex align="center" gap={2} style={{flexShrink: 0}}>
                          {editable(row) ? (
                            <Button
                              text="Remove"
                              mode="bleed"
                              tone="critical"
                              fontSize={1}
                              padding={2}
                              onClick={() => {
                                forget([row.id])
                                setRows((current) => current.filter((item) => item.id !== row.id))
                              }}
                            />
                          ) : null}
                          {row.docId &&
                          (row.status === 'no-location' || row.status === 'no-gps' || row.status === 'duplicate') ? (
                            <Button
                              text="Open"
                              mode="ghost"
                              fontSize={1}
                              padding={2}
                              onClick={() =>
                                openDocument(
                                  row.docId!,
                                  row.kind === 'route' ? 'track' : row.kind === 'flight' ? 'flight' : 'photo',
                                )
                              }
                            />
                          ) : null}
                          <Badge tone={badge === 'needs-details' ? 'caution' : STATUS_TONE[badge]} fontSize={0}>
                            {badge === 'needs-details' ? 'Needs details' : STATUS_LABEL[badge]}
                          </Badge>
                        </Flex>
                      </Flex>
                    </Card>
                  )
                })}
              </Stack>
            </Card>
          </Stack>
        ) : null}
      </Stack>
    </Box>
  )
}
