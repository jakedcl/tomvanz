'use client'

import {useEffect, useRef} from 'react'
import {CloseIcon} from './CloseIcon'
import {sanityImageAlt, urlFor} from '@/lib/sanity/image'
import {FLIGHT_PATH_COLOR} from '@/lib/flight-color'
import {formatMapDate} from '@/lib/format-map-date'
import {trackColor} from '@/lib/track-color'
import type {BunchMember} from '@/lib/map-bunch'
import type {MapData} from '@/lib/sanity/types'

type Props = {
  data: MapData
  members: BunchMember[]
  index: number
  onIndexChange: (index: number) => void
  onOpen: (member: BunchMember) => void
  onClose: () => void
}

function memberTitle(data: MapData, member: BunchMember): string {
  if (member.kind === 'pin') {
    const pin = data.pins.find((p) => p._id === member.id)
    return pin?.title?.trim() || formatMapDate(pin?.at ?? undefined) || 'Photo'
  }
  if (member.kind === 'track') {
    const track = data.tracks.find((t) => t._id === member.id)
    return track?.title?.trim() || 'Route'
  }
  const flight = data.flights.find((f) => f._id === member.id)
  return flight?.title?.trim() || 'Flight'
}

/**
 * Swipeable cards for photos, routes, and flights stacked at the same place on the map.
 */
export function PileStrip({data, members, index, onIndexChange, onOpen, onClose}: Props) {
  const scroller = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    onIndexChange(index)
  }, [index, onIndexChange, members])

  const onScroll = () => {
    const node = scroller.current
    if (!node) return
    const first = node.firstElementChild as HTMLElement | null
    if (!first) return
    const step = first.offsetWidth + 12
    const next = Math.min(members.length - 1, Math.max(0, Math.round(node.scrollLeft / step)))
    if (next !== index) onIndexChange(next)
  }

  return (
    <div className="tv-strip pointer-events-none absolute inset-x-0 bottom-[calc(16px+env(safe-area-inset-bottom))] z-20 md:bottom-6 md:left-1/2 md:right-auto md:w-[640px] md:-translate-x-1/2">
      <div className="mb-2 flex justify-center">
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close stack (${index + 1} of ${members.length})`}
          className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-black/80 py-1.5 pl-3.5 pr-3 text-[12px] font-semibold text-white shadow-lg backdrop-blur-md"
        >
          <span>
            {index + 1} of {members.length}
          </span>
          <CloseIcon className="h-3.5 w-3.5 opacity-80" />
        </button>
      </div>
      <div
        ref={scroller}
        onScroll={onScroll}
        className="pointer-events-auto flex snap-x snap-mandatory gap-3 overflow-x-auto px-[calc(50%-110px)] pb-2 [mask-image:linear-gradient(to_right,transparent,black_24px,black_calc(100%-24px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {members.map((member, i) => (
          <PileCard
            key={`${member.kind}-${member.id}`}
            data={data}
            member={member}
            active={i === index}
            onOpen={() => onOpen(member)}
          />
        ))}
      </div>
    </div>
  )
}

function PileCard({
  data,
  member,
  active,
  onOpen,
}: {
  data: MapData
  member: BunchMember
  active: boolean
  onOpen: () => void
}) {
  const title = memberTitle(data, member)
  if (member.kind === 'pin') {
    const pin = data.pins.find((p) => p._id === member.id)
    if (!pin) return null
    const date = formatMapDate(pin.at ?? undefined)
    const caption = pin.title?.trim() || date
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${title}`}
        className={cardClass(active)}
      >
        {pin.photo?.asset ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={urlFor(pin.photo).width(480).height(330).fit('crop').url()}
            alt={sanityImageAlt(pin.photo, title)}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : null}
        {caption ? (
          <CardCaption primary={caption} secondary={pin.title?.trim() ? (date ?? undefined) : undefined} />
        ) : null}
      </button>
    )
  }
  if (member.kind === 'track') {
    const track = data.tracks.find((t) => t._id === member.id)
    const color = trackColor(track?.activity ?? 'other')
    return (
      <button type="button" onClick={onOpen} aria-label={`Open ${title}`} className={cardClass(active)}>
        <RouteArt color={color} dashed={track?.activity === 'hike'} />
        <CardCaption primary={title} secondary={formatMapDate(track?.startedAt) ?? undefined} />
      </button>
    )
  }
  return (
    <button type="button" onClick={onOpen} aria-label={`Open ${title}`} className={cardClass(active)}>
      <RouteArt color={FLIGHT_PATH_COLOR} dashed={false} />
      <CardCaption
        primary={title}
        secondary={formatMapDate(data.flights.find((f) => f._id === member.id)?.startedAt) ?? undefined}
      />
    </button>
  )
}

function cardClass(active: boolean) {
  return `relative h-[150px] w-[220px] shrink-0 snap-center overflow-hidden rounded-2xl bg-neutral-800 text-left shadow-[0_10px_30px_rgba(0,0,0,0.35)] ring-1 ring-white/20 transition-transform duration-200 active:scale-[0.98] ${
    active ? 'scale-100' : 'scale-[0.93] opacity-90'
  }`
}

function CardCaption({primary, secondary}: {primary: string; secondary?: string}) {
  return (
    <>
      <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/75 via-black/30 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-3 text-white">
        <p className="truncate text-[15px] font-bold leading-tight tracking-tight [text-shadow:0_1px_8px_rgba(0,0,0,0.4)]">
          {primary}
        </p>
        {secondary ? <p className="mt-0.5 text-[11px] text-white/75">{secondary}</p> : null}
      </div>
    </>
  )
}

function RouteArt({color, dashed}: {color: string; dashed: boolean}) {
  return (
    <div className="absolute inset-0" style={{background: `linear-gradient(160deg, ${color} 0%, #1a1a1a 78%)`}}>
      <svg viewBox="0 0 220 150" className="h-full w-full opacity-35" aria-hidden>
        <path
          d="M14 108 C48 38, 86 122, 118 58 S176 28, 206 72"
          fill="none"
          stroke="white"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={dashed ? '10 8' : undefined}
        />
      </svg>
    </div>
  )
}