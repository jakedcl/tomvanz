'use client'

import {useCallback, useEffect, useRef, useState} from 'react'
import {Badge, Box, Button, Card, Flex, Spinner, Stack, Text, TextInput} from '@sanity/ui'
import {useClient} from 'sanity'
import {useRouter} from 'sanity/router'
import {isPhotoFile, photoFromUpload, readPhotoMeta, runPool, type PhotoMeta} from '../../lib/bulk-upload'

/** The little the uploader needs from the Studio's connection to Sanity. */
export type UploaderClient = {
  uploadImage: (file: File) => Promise<{_id: string}>
  /** The id of a photo already using this image, if any. */
  findByAsset: (assetId: string) => Promise<string | null>
  createPhoto: (doc: ReturnType<typeof photoFromUpload>) => Promise<{_id: string}>
}

type Status = 'reading' | 'ready' | 'waiting' | 'uploading' | 'done' | 'no-location' | 'duplicate' | 'skipped' | 'error'

type Row = {
  id: number
  name: string
  status: Status
  note?: string
  docId?: string
  /** A small picture of the file, so the right title goes on the right photo. */
  preview?: string
  /** What was read from the file (GPS, date taken). */
  meta?: PhotoMeta
  title: string
}

const CONCURRENCY = 3

const STATUS_LABEL: Record<Status, string> = {
  reading: 'Reading',
  ready: 'Ready',
  waiting: 'Waiting',
  uploading: 'Uploading',
  done: 'On the map',
  'no-location': 'Needs a location',
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
  duplicate: 'default',
  skipped: 'default',
  error: 'critical',
}

/** Rows whose title can still be changed or that can still be taken off the list. */
const editable = (row: Row) => row.status === 'ready' || row.status === 'error'

/** The Studio tool: hands the screen the Studio's own Sanity connection. */
export function BulkUploadTool() {
  const client = useClient({apiVersion: '2026-01-01'})
  const router = useRouter()
  const uploader: UploaderClient = {
    uploadImage: (file) => client.assets.upload('image', file, {filename: file.name}),
    findByAsset: (assetId) =>
      client.fetch<string | null>(
        `*[_type == "photo" && image.asset._ref == $id][0]._id`,
        {id: assetId},
      ),
    createPhoto: (doc) => client.create(doc),
  }
  return <BulkUploadView uploader={uploader} openDocument={(id) => router.navigateIntent('edit', {id, type: 'photo'})} />
}

/**
 * Drop in a pile of photos, give each a title (or take it off the list), then press one button:
 * each becomes a Photo, placed from its own GPS data and dated from when it was taken.
 * Nothing is sent to Sanity until that button. Drone photos are spotted from their DJI file names by the site.
 */
export function BulkUploadView({
  uploader,
  openDocument,
}: {
  uploader: UploaderClient
  openDocument: (docId: string) => void
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [running, setRunning] = useState(false)
  const [dragging, setDragging] = useState(false)
  const nextId = useRef(1)
  const filesById = useRef(new Map<number, File>())
  const picker = useRef<HTMLInputElement | null>(null)
  const previewsById = useRef(new Map<number, string>())
  // The latest rows, for the upload to read titles typed since the last render.
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
        const meta = row.meta ?? {}
        const asset = await uploader.uploadImage(file)

        // Uploading the same photo twice gives back the same asset: don't make a second photo for it.
        const existing = await uploader.findByAsset(asset._id)
        if (existing) {
          patchRow(id, {status: 'duplicate', docId: existing, note: 'Already on the map.'})
          return
        }

        const doc = await uploader.createPhoto(photoFromUpload(asset._id, meta, row.title))
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
      const toRead: {id: number; file: File}[] = []
      for (const file of Array.from(list)) {
        const id = nextId.current++
        if (!isPhotoFile(file)) {
          added.push({id, name: file.name, status: 'skipped', note: 'Not a photo.', title: ''})
          continue
        }
        filesById.current.set(id, file)
        const preview = URL.createObjectURL(file)
        previewsById.current.set(id, preview)
        added.push({id, name: file.name, status: 'reading', preview, title: ''})
        toRead.push({id, file})
      }
      setRows((current) => [...current, ...added])
      // Reading the file's GPS and date happens here, before anything is uploaded, so a missing location shows up early.
      for (const {id, file} of toRead) {
        void readPhotoMeta(file).then((meta) => {
          patchRow(id, {
            status: 'ready',
            meta,
            note: meta.lat == null ? 'No GPS in this photo. You’ll need to drop a pin after uploading.' : undefined,
          })
        })
      }
    },
    [patchRow],
  )

  const counts = rows.reduce(
    (acc, row) => ({...acc, [row.status]: (acc[row.status] ?? 0) + 1}),
    {} as Partial<Record<Status, number>>,
  )
  const ready = rows.filter((row) => row.status === 'ready')
  const reading = rows.some((row) => row.status === 'reading')
  const failed = rows.filter((row) => row.status === 'error').map((row) => row.id)
  const sent = rows.filter((row) => ['done', 'no-location', 'duplicate', 'error'].includes(row.status)).length
  const inFlight = rows.filter((row) => row.status === 'waiting' || row.status === 'uploading').length

  return (
    <Box padding={4} style={{maxWidth: 760, margin: '0 auto'}}>
      <Stack gap={4}>
        <Stack gap={2}>
          <Text size={3} weight="bold">
            Bulk upload
          </Text>
          <Text size={1} muted>
            Drop in as many photos as you like, give each a title if you want one, remove any you don’t, then press
            Upload. Each is placed from the GPS in the photo and dated from when it was taken. Drone photos are spotted
            automatically from their file names.
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
              Drop photos here
            </Text>
            <Text size={1} muted>
              or click to choose them
            </Text>
          </Stack>
          <input
            ref={picker}
            type="file"
            accept="image/*"
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
                  {running
                    ? `${sent} of ${sent + inFlight} uploaded`
                    : `${ready.length} ready to upload`}
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
                  text={ready.length === 1 ? 'Upload 1 photo' : `Upload ${ready.length} photos`}
                  tone="positive"
                  fontSize={1}
                  disabled={running || reading || ready.length === 0}
                  onClick={() => void uploadIds(ready.map((row) => row.id))}
                />
              </Flex>
            </Flex>

            <Card border radius={2} overflow="hidden">
              <Stack>
                {rows.map((row, index) => (
                  <Card key={row.id} padding={3} borderTop={index > 0} tone="default">
                    <Flex align="center" gap={3}>
                      {row.preview ? (
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
                            placeholder="Title (optional)"
                            aria-label={`Title for ${row.name}`}
                            value={row.title}
                            onChange={(event) => patchRow(row.id, {title: event.currentTarget.value})}
                          />
                        ) : row.title ? (
                          <Text size={1} weight="medium" textOverflow="ellipsis">
                            {row.title}
                          </Text>
                        ) : null}
                        {row.note ? (
                          <Text size={1} muted>
                            {row.note}
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
                        {row.docId && (row.status === 'no-location' || row.status === 'duplicate') ? (
                          <Button
                            text="Open"
                            mode="ghost"
                            fontSize={1}
                            padding={2}
                            onClick={() => openDocument(row.docId!)}
                          />
                        ) : null}
                        <Badge tone={STATUS_TONE[row.status]} fontSize={0}>
                          {STATUS_LABEL[row.status]}
                        </Badge>
                      </Flex>
                    </Flex>
                  </Card>
                ))}
              </Stack>
            </Card>
          </Stack>
        ) : null}
      </Stack>
    </Box>
  )
}
