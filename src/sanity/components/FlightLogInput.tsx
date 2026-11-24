'use client'

import {useRef, useState} from 'react'
import {Button, Card, Flex, Spinner, Stack, Text} from '@sanity/ui'
import {PatchEvent, set, unset, useClient, useFormValue, type ObjectInputProps} from 'sanity'
import {isShortFlightDuration} from '@/lib/bulk-upload'
import {linkPhotosToFlightDocument} from '@/lib/link-flight-photos'
import {flightStudioPatchFromParse, postParseFlight} from '@/lib/parse-flight-api'

type FileValue = {
  asset?: {_ref: string}
}

function draftId(documentId: string): string {
  return documentId.startsWith('drafts.') ? documentId : `drafts.${documentId}`
}

export function FlightLogInput(props: ObjectInputProps) {
  const {value, readOnly} = props
  const fileValue = value as FileValue | undefined
  const client = useClient({apiVersion: '2026-01-01'})
  const documentId = useFormValue(['_id']) as string | undefined
  const durationSeconds = useFormValue(['durationSeconds']) as number | undefined
  const displayCoordinates = useFormValue(['displayCoordinates']) as string | undefined
  const [message, setMessage] = useState<'idle' | 'ok' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [linkedNote, setLinkedNote] = useState<string | null>(null)
  const [parsedDuration, setParsedDuration] = useState<number | undefined>(undefined)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const hasFile = Boolean(fileValue?.asset?._ref)
  const hasParse = Boolean(displayCoordinates?.trim())
  const shortFlight = isShortFlightDuration(durationSeconds ?? parsedDuration)

  async function onFile(file: File) {
    setError(null)
    setLinkedNote(null)
    setBusy(true)
    try {
      const token = client.config().token
      if (!token) throw new Error('Sign in to Studio to parse flight logs.')

      const parsed = await postParseFlight(file, token)
      const asset = await client.assets.upload('file', file, {filename: file.name})
      props.onChange(
        PatchEvent.from(
          set({
            _type: 'file',
            asset: {_type: 'reference', _ref: asset._id},
          }),
        ),
      )
      if (documentId) {
        const id = draftId(documentId)
        const fields = flightStudioPatchFromParse(parsed, file.name)
        await client.patch(id).set(fields).commit()

        if (parsed.startedAt) {
          const {unlinkedLabels} = await linkPhotosToFlightDocument(
            client,
            id,
            parsed.startedAt,
            parsed.durationSeconds,
          )
          if (unlinkedLabels.length > 0) {
            setLinkedNote(
              `Linked photos from this flight. Could not match: ${unlinkedLabels.join(', ')}.`,
            )
          } else {
            setLinkedNote('Linked matching drone photos to this flight.')
          }
        }
      }
      setParsedDuration(parsed.durationSeconds)
      setMessage('ok')
    } catch (caught) {
      setMessage('error')
      setError(caught instanceof Error ? caught.message : 'Couldn’t read that flight log. Try another file.')
    } finally {
      setBusy(false)
    }
  }

  function clearDerivedFields() {
    if (!documentId) return
    const id = draftId(documentId)
    void client
      .patch(id)
      .unset([
        'displayCoordinates',
        'series',
        'durationSeconds',
        'distanceMeters',
        'maxHeightMeters',
        'aircraft',
        'startedAt',
        'place',
        'home',
        'videoSegments',
        'sourceFilename',
      ])
      .commit()
  }

  return (
    <Stack gap={3}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,text/plain"
        hidden
        disabled={readOnly || busy}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void onFile(file)
          event.target.value = ''
        }}
      />
      <Flex gap={2} align="center">
        <Button
          text={hasFile ? 'Replace log' : 'Upload DJI log'}
          mode="ghost"
          disabled={readOnly || busy}
          onClick={() => fileInputRef.current?.click()}
        />
        {busy ? <Spinner /> : null}
        {hasFile ? (
          <Button
            text="Remove"
            tone="critical"
            mode="bleed"
            disabled={readOnly || busy}
            onClick={() => {
              props.onChange(PatchEvent.from(unset()))
              clearDerivedFields()
              setMessage('idle')
              setLinkedNote(null)
              setParsedDuration(undefined)
            }}
          />
        ) : null}
        {hasFile ? (
          <Text size={1} muted>
            Log attached
          </Text>
        ) : null}
      </Flex>
      {shortFlight ? (
        <Card padding={3} radius={2} tone="caution">
          <Text size={1}>Short flight (under 1 min)</Text>
        </Card>
      ) : null}
      {message === 'ok' ? (
        <Card padding={3} radius={2} tone="positive">
          <Text size={1}>Got the flight. Title and stats are filled in — publish to put it on the map.</Text>
        </Card>
      ) : hasFile && !hasParse ? (
        <Card padding={3} radius={2} tone="caution">
          <Text size={1}>File is attached, but it isn’t parsed. Click Replace log and pick the file again.</Text>
        </Card>
      ) : null}
      {linkedNote ? (
        <Text size={1} muted>
          {linkedNote}
        </Text>
      ) : null}
      {message === 'error' ? (
        <Card padding={3} radius={2} tone="critical">
          <Text size={1}>{error}</Text>
        </Card>
      ) : null}
    </Stack>
  )
}