'use client'

import {useEffect, useMemo, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {CloseIcon} from './CloseIcon'
import {ElevationChart} from './ElevationChart'
import {FlightAltitudeChart} from './FlightAltitudeChart'
import {ReplayControls} from './ReplayControls'
import {PhotoShape} from './shapes'
import {FLIGHT_PATH_COLOR} from '@/lib/flight-color'
import {formatFeet, type RouteScrubPoint} from '@/lib/elevation'
import {formatMiles} from '@/lib/geo'
import type {FlightSeriesSample} from '@/lib/flight-log'
import type {ReplayController} from '@/lib/flyover/replay-controller'
import {flightReplayTrack, routeReplayTrack} from '@/lib/flyover/replay-track'
import {trackMiles} from '@/lib/track-mileage'
import type {SanityImageSource} from '@sanity/image-url'
import {infoCardCoverImage, infoCardLightboxImage, sanityImageAlt, urlFor} from '@/lib/sanity/image'
import {lineCoordinates, type MapData, type SelectedItem} from '@/lib/sanity/types'
import {formatDurationSeconds} from '@/lib/format-duration'
import {formatMapDate} from '@/lib/format-map-date'
import {
  dominantFlightModePill,
  formatSpeedMph,
  maxSpeedMphFromSeries,
} from '@/lib/flight-display'
import {trackColor} from '@/lib/track-color'
import {photoLink} from '@/lib/photo-link'

type Props = {
  data: MapData
  selected: SelectedItem
  onClose: () => void
  onFlightScrub?: (sample: FlightSeriesSample | null) => void
  onRouteScrub?: (point: RouteScrubPoint | null) => void
  onOpenPhoto?: (id: string) => void
  /** A photo's route or flight chip was tapped: open it (flies the map there). */
  onOpenItem?: (item: SelectedItem) => void
  /** The replay of this flight or route (loaded here once its path is known). */
  replay?: ReplayController
  /** Starts the replay (the map also switches 3D on). */
  onPlay?: () => void
  /** `panel`: shown inside the sidebar or the sheet (no floating-card frame or close button; the panel has a back control). */
  variant?: 'card' | 'panel'
}

type LinkedPhoto = {_id: string; title?: string; photo?: {asset?: {_ref: string}}}

type CardModel = {
  title: string
  eyebrow: string
  stats: string[]
  body: string | null
  image: SanityImageSource | null
  imageAlt: string
  accent: string
  /** Show the little photo symbol beside the label. */
  isPhoto: boolean
  dashed: boolean
}

function activityLabel(activity: string) {
  if (activity === 'bike') return 'Bike'
  if (activity === 'hike') return 'Hike'
  return 'Track'
}

function cardModel(data: MapData, selected: SelectedItem): CardModel | null {
  if (selected.kind === 'flight') {
    const flight = data.flights.find((item) => item._id === selected.id)
    if (!flight) return null
    const when = formatMapDate(flight.startedAt) ?? undefined
    const miles =
      flight.distanceMeters != null && flight.distanceMeters > 0
        ? formatMiles(flight.distanceMeters / 1609.344)
        : null
    const duration = formatDurationSeconds(flight.durationSeconds) ?? undefined
    const maxHt =
      flight.maxHeightMeters != null ? formatFeet(flight.maxHeightMeters * 3.28084) : null
    const stats = [when, flight.place, duration, miles, maxHt ? `${maxHt} max` : null, flight.aircraft]
      .filter((item): item is string => Boolean(item))
    return {
      title: flight.title,
      eyebrow: 'Flight',
      stats,
      body: null,
      image: null,
      imageAlt: flight.title,
      accent: FLIGHT_PATH_COLOR,
      isPhoto: false,
      dashed: false,
    }
  }

  if (selected.kind === 'track') {
    const track = data.tracks.find((item) => item._id === selected.id)
    if (!track) return null
    const when = formatMapDate(track.startedAt) ?? undefined
    const miles = trackMiles(track)
    const stats = [when, miles ? formatMiles(miles) : null].filter((item): item is string =>
      Boolean(item),
    )
    return {
      title: track.title,
      eyebrow: activityLabel(track.activity),
      stats,
      body: null,
      image: track.photo?.asset ? track.photo : null,
      imageAlt: sanityImageAlt(track.photo, track.title),
      accent: trackColor(track.activity),
      isPhoto: false,
      dashed: track.activity === 'hike',
    }
  }

  const pin = data.pins.find((item) => item._id === selected.id)
  if (!pin) return null
  const when = formatMapDate(pin.at) ?? undefined
  return {
    title: pin.title,
    eyebrow: pin.isDrone ? 'Aerial' : 'Photo',
    stats: when ? [when] : [],
    body: pin.note ?? null,
    image: pin.photo?.asset ? pin.photo : null,
    imageAlt: sanityImageAlt(pin.photo, pin.title),
    accent: '#111',
    isPhoto: true,
    dashed: false,
  }
}

function Lightbox({
  image,
  alt,
  onClose,
}: {
  image: SanityImageSource
  alt: string
  onClose: () => void
}) {
  const {src, srcSet, sizes} = infoCardLightboxImage(image)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return createPortal(
    <div
      role="dialog"
      aria-label={alt}
      onClick={onClose}
      className="tv-lightbox fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        srcSet={srcSet}
        sizes={sizes}
        alt={alt}
        className="max-h-full max-w-full rounded-lg object-contain"
      />
      <button
        type="button"
        aria-label="Close photo"
        onClick={onClose}
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md transition hover:bg-white/25"
      >
        <CloseIcon className="h-[18px] w-[18px]" />
      </button>
    </div>,
    document.body,
  )
}

function PointerColor({light}: {light: boolean}) {
  const ref = useRef<HTMLSpanElement | null>(null)
  useEffect(() => {
    ref.current?.closest<HTMLElement>('.tv-popup')?.style.setProperty('--tip', light ? '#ffffff' : '#0c0c0c')
  }, [light])
  return <span ref={ref} hidden />
}

/** "Flight · name" / "Route · name" under a photo: tap to open what it was taken during or along. */
function LinkedItemChip({data, selected, onOpenItem, className = ''}: {data: MapData; selected: SelectedItem; onOpenItem?: (item: SelectedItem) => void; className?: string}) {
  const link = selected.kind === 'pin' && onOpenItem ? photoLink(data, selected.id) : null
  if (!link) return null
  return (
    <button
      type="button"
      onClick={() => onOpenItem?.(link.target)}
      data-testid="linked-item-chip"
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full bg-black/[0.06] px-3 py-1 text-[12px] font-medium text-black/75 active:scale-95 ${className}`}
    >
      <span className="shrink-0 text-black/45">{link.kind === 'flight' ? 'Flight' : 'Route'}</span>
      <span className="truncate">{link.title}</span>
      <span aria-hidden className="shrink-0 text-black/45">›</span>
    </button>
  )
}

/** Map-anchored popup for a selected photo pin (not the bottom strip). */
export function PhotoMapPopupCard({data, selected, onClose, onOpenItem}: Props) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (expanded) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, expanded])

  const card = cardModel(data, selected)
  if (!card || selected.kind !== 'pin') return null

  const cover = card.image ? infoCardCoverImage(card.image) : null
  const untitled = card.title.trim() === ''
  const headline = untitled ? (card.stats[0] ?? '') : card.title
  const chips = untitled ? card.stats.slice(1) : card.stats
  const linked = selected.kind === 'pin' && onOpenItem ? photoLink(data, selected.id) : null
  const hasDetails = chips.length > 0 || Boolean(card.body) || Boolean(linked)
  const hasCaption = Boolean(headline) || Boolean(card.eyebrow)

  const share = async () => {
    const url = new URL('/map', window.location.origin)
    url.searchParams.set('photo', selected.id)
    try {
      if (navigator.share) {
        await navigator.share({title: card.title, url: url.toString()})
        return
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return
    }
    try {
      await navigator.clipboard.writeText(url.toString())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard blocked */
    }
  }

  const frame =
    'tv-card w-[min(340px,calc(100vw-24px))] max-h-[var(--card-max,520px)] overflow-y-auto overflow-x-hidden rounded-[22px] bg-white shadow-[0_24px_64px_rgba(0,0,0,0.3)] ring-1 ring-black/5'

  return (
    <article className={frame}>
      <PointerColor light={hasDetails} />
      <div className="relative aspect-[4/3] overflow-hidden bg-neutral-200">
        {cover ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-label="View photo full size"
            className="block h-full w-full cursor-zoom-in"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cover.src}
              srcSet={cover.srcSet}
              sizes={cover.sizes}
              alt={card.imageAlt}
              className="h-full w-full object-cover"
            />
          </button>
        ) : (
          <div className="absolute inset-0" style={{background: `linear-gradient(160deg, ${card.accent} 0%, #1a1a1a 78%)`}}>
            <PhotoShape className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 text-white/40" />
          </div>
        )}
        {hasCaption ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/75 via-black/30 to-transparent" />
        ) : null}
        <button
          type="button"
          onClick={share}
          aria-label="Share link"
          className="absolute left-3 top-3 flex h-9 items-center gap-1.5 rounded-full bg-black/35 px-3 text-[12px] font-semibold text-white backdrop-blur-md active:scale-95"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 3v12M12 3l-4 4M12 3l4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
          </svg>
          {copied ? 'Copied' : 'Share'}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-md active:scale-95"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 p-4 text-white">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/75">
            {card.isPhoto ? <PhotoShape className="h-3.5 w-3.5 text-white" /> : null}
            {card.eyebrow}
          </p>
          {headline ? (
            <h2 className="mt-1 text-[22px] font-bold leading-[1.1] tracking-tight [text-shadow:0_1px_12px_rgba(0,0,0,0.35)]">
              {headline}
            </h2>
          ) : null}
        </div>
      </div>
      {hasDetails ? (
        <div className="px-4 pb-4 pt-3.5">
          {linked ? <LinkedItemChip data={data} selected={selected} onOpenItem={onOpenItem} className={chips.length > 0 || card.body ? 'mb-2' : ''} /> : null}
          {chips.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {chips.map((stat) => (
                <span key={stat} className="rounded-full bg-black/[0.06] px-3 py-1 text-[12px] font-medium text-black/70">
                  {stat}
                </span>
              ))}
            </div>
          ) : null}
          {card.body ? (
            <p className={`${chips.length ? 'mt-3' : ''} text-[14px] leading-relaxed text-black/70`}>{card.body}</p>
          ) : null}
        </div>
      ) : null}
      {expanded && card.image ? <Lightbox image={card.image} alt={card.imageAlt} onClose={() => setExpanded(false)} /> : null}
    </article>
  )
}

export function InfoCard({data, selected, onClose, onFlightScrub, onRouteScrub, onOpenPhoto, onOpenItem, replay, onPlay, variant = 'card'}: Props) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [linkedPhotos, setLinkedPhotos] = useState<LinkedPhoto[]>([])
  // Which flight the series belongs to, so a slow load can never show one flight's log on another.
  const [seriesState, setSeriesState] = useState<{id: string; series: FlightSeriesSample[]} | null>(null)
  const flightSeries = seriesState?.id === selected.id ? seriesState.series : null
  const track = selected.kind === 'track' ? data.tracks.find((item) => item._id === selected.id) : undefined
  const flight = selected.kind === 'flight' ? data.flights.find((item) => item._id === selected.id) : undefined
  const routeCoords = useMemo(() => (track ? lineCoordinates(track.route) : null), [track])
  const card = cardModel(data, selected)

  // Give the replay this flight's or route's path once it's known, and take it back when the card goes away.
  const trackActivity = track?.activity
  useEffect(() => {
    if (!replay) return
    if (selected.kind === 'track' && routeCoords) replay.load(routeReplayTrack(routeCoords, trackActivity))
    else if (selected.kind === 'flight' && flightSeries) replay.load(flightReplayTrack(flightSeries))
    else replay.load(null)
    return () => replay.load(null)
  }, [replay, selected.kind, routeCoords, trackActivity, flightSeries])

  useEffect(() => {
    if (selected.kind !== 'flight' && selected.kind !== 'track') return
    const path =
      selected.kind === 'flight'
        ? `/api/flight/${encodeURIComponent(selected.id)}`
        : `/api/track/${encodeURIComponent(selected.id)}`
    let cancelled = false
    fetch(path)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((payload: {photos?: LinkedPhoto[]; series?: string | null}) => {
        if (cancelled) return
        setLinkedPhotos(payload.photos ?? [])
        if (selected.kind === 'flight') {
          if (payload.series) {
            try {
              setSeriesState({id: selected.id, series: JSON.parse(payload.series) as FlightSeriesSample[]})
            } catch {
              setSeriesState({id: selected.id, series: []})
            }
          } else {
            setSeriesState({id: selected.id, series: []})
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLinkedPhotos([])
          if (selected.kind === 'flight') setSeriesState({id: selected.id, series: []})
        }
      })
    return () => {
      cancelled = true
    }
  }, [selected.id, selected.kind])

  useEffect(() => {
    if (expanded) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, expanded])

  if (!card) return null

  const cover = card.image ? infoCardCoverImage(card.image) : null

  const share = async () => {
    const url = new URL('/map', window.location.origin)
    const key = selected.kind === 'pin' ? 'photo' : selected.kind === 'flight' ? 'flight' : 'track'
    url.searchParams.set(key, selected.id)
    try {
      if (navigator.share) {
        await navigator.share({title: card.title, url: url.toString()})
        return
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return
    }
    try {
      await navigator.clipboard.writeText(url.toString())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard blocked: nothing more we can do */
    }
  }

  const frame =
    variant === 'panel'
      ? 'w-full overflow-x-hidden bg-white'
      : 'tv-card tv-sheet w-full overflow-x-hidden rounded-t-[18px] bg-white shadow-[0_-6px_28px_rgba(0,0,0,0.18)] ring-1 ring-black/5 md:rounded-[18px] md:shadow-[0_16px_48px_rgba(0,0,0,0.22)]'

  const untitled = card.title.trim() === ''
  const headline = untitled ? (card.stats[0] ?? '') : card.title
  const baseChips = untitled ? card.stats.slice(1) : card.stats
  const hasRoute = Boolean(routeCoords && routeCoords.length >= 2)
  const isFlight = selected.kind === 'flight' && Boolean(flight)
  const topSpeed =
    isFlight && flightSeries && flightSeries.length > 0 ? maxSpeedMphFromSeries(flightSeries) : null
  const modePill =
    isFlight && flightSeries && flightSeries.length > 0 ? dominantFlightModePill(flightSeries) : null
  const detailLine = baseChips.join(' · ')
  const linkedForSelection =
    selected.kind === 'flight' || selected.kind === 'track' ? linkedPhotos : []
  const thumbSrc = cover
    ? cover.src
    : null

  return (
    <article className={frame}>
      <div className="flex gap-3 p-3">
        <StripThumb accent={card.accent} dashed={card.dashed} hasCover={Boolean(thumbSrc)} onOpen={() => setExpanded(true)}>
          {thumbSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbSrc} alt={card.imageAlt} className="h-full w-full object-cover" />
          ) : null}
        </StripThumb>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-black/45">
                {card.isPhoto ? <PhotoShape className="h-3 w-3" /> : null}
                {card.eyebrow}
              </p>
              {headline ? (
                <h2 className="mt-0.5 truncate text-[17px] font-bold leading-tight tracking-tight text-black">
                  {headline}
                </h2>
              ) : null}
              {detailLine ? (
                <p className="mt-1 text-[12px] leading-snug text-black/60 [overflow-wrap:anywhere]">{detailLine}</p>
              ) : null}
              <LinkedItemChip data={data} selected={selected} onOpenItem={onOpenItem} className="mt-1.5" />
              {isFlight && (topSpeed != null || modePill) ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {topSpeed != null ? (
                    <span className="shrink-0 rounded-full bg-black/[0.06] px-2.5 py-0.5 text-[11px] font-medium text-black/70">
                      {formatSpeedMph(topSpeed)}
                    </span>
                  ) : null}
                  {modePill ? (
                    <span className="shrink-0 rounded-full bg-black/[0.06] px-2.5 py-0.5 text-[11px] font-medium text-black/70">
                      {modePill}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {card.body ? (
                <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-black/65">{card.body}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={share}
                aria-label="Share link"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.06] text-black/70 active:scale-95"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M12 3v12M12 3l-4 4M12 3l4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
                </svg>
              </button>
              {variant === 'card' ? (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.06] text-black/70 active:scale-95"
                >
                  <CloseIcon className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {linkedForSelection.length > 0 ? (
        <div className="flex gap-1.5 overflow-x-auto px-3 pb-2">
          {linkedForSelection.map((item) => {
            const thumb = item.photo?.asset ? urlFor(item.photo).width(120).height(90).fit('crop').url() : null
            return (
              <button
                key={item._id}
                type="button"
                onClick={() => onOpenPhoto?.(item._id)}
                className="h-12 w-14 shrink-0 overflow-hidden rounded-md ring-1 ring-black/10"
                aria-label={item.title?.trim() || 'Linked photo'}
              >
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full items-center justify-center bg-neutral-200 text-[9px] text-black/50">Photo</span>
                )}
              </button>
            )
          })}
        </div>
      ) : null}
      {replay && onPlay ? <ReplayControls replay={replay} onPlay={onPlay} /> : null}
      {hasRoute && routeCoords ? (
        <div className="px-3 pb-2">
          <ElevationChart compact coords={routeCoords} color={card.accent} onScrub={onRouteScrub} replay={replay} />
        </div>
      ) : null}
      {isFlight && flight && onFlightScrub ? (
        <div className="px-3 pb-2.5">
          <FlightAltitudeChart
            key={flight._id}
            flightId={flight._id}
            durationSeconds={flight.durationSeconds}
            onScrub={onFlightScrub}
            series={flightSeries}
            replay={replay}
          />
        </div>
      ) : null}

      {expanded && card.image ? (
        <Lightbox image={card.image} alt={card.imageAlt} onClose={() => setExpanded(false)} />
      ) : null}
      {copied ? <p className="sr-only" role="status">Link copied</p> : null}
    </article>
  )
}

function StripThumb({
  accent,
  dashed,
  hasCover,
  children,
  onOpen,
}: {
  accent: string
  dashed: boolean
  hasCover: boolean
  children?: React.ReactNode
  onOpen?: () => void
}) {
  const inner = (
    <StripThumbArt accent={accent} dashed={dashed}>
      {children}
    </StripThumbArt>
  )
  if (hasCover && onOpen) {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label="View photo full size"
        className="h-[72px] w-[72px] shrink-0 overflow-hidden rounded-xl bg-neutral-200 ring-1 ring-black/10"
      >
        {inner}
      </button>
    )
  }
  return (
    <div className="h-[72px] w-[72px] shrink-0 overflow-hidden rounded-xl ring-1 ring-black/10" aria-hidden>
      {inner}
    </div>
  )
}

function StripThumbArt({
  accent,
  dashed,
  children,
}: {
  accent: string
  dashed: boolean
  children?: React.ReactNode
}) {
  if (children) return children
  return (
    <div className="h-full w-full" style={{background: `linear-gradient(160deg, ${accent} 0%, #1a1a1a 78%)`}}>
      <svg viewBox="0 0 72 72" className="h-full w-full opacity-35" aria-hidden>
        <path
          d="M6 48 C22 18, 34 52, 44 26 S58 16, 66 38"
          fill="none"
          stroke="white"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={dashed ? '5 4' : undefined}
        />
      </svg>
    </div>
  )
}
