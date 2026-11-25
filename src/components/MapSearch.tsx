'use client'

import {useEffect, useRef, useState} from 'react'
import {CloseIcon} from './CloseIcon'
import {PhotoShape} from './shapes'
import {sanityImageAlt, urlFor} from '@/lib/sanity/image'
import {formatMiles} from '@/lib/geo'
import {FLIGHT_PATH_COLOR} from '@/lib/flight-color'
import {trackColor} from '@/lib/track-color'
import {
  activeFilterCount,
  emptyMapFilters,
  pillBlockedBy,
  toggleAircraft,
  toggleGroup,
  toggleKind,
  type FilterOptions,
  type MapFilterState,
  type PhotoKind,
  type ResultItem,
  type RouteKind,
} from '@/lib/map-filters'
import {formatMapDate} from '@/lib/format-map-date'

type Props = {
  state: MapFilterState
  onChange: (next: MapFilterState) => void
  filterGroups: FilterOptions
  results: ResultItem[]
  total: number
  onPick: (item: ResultItem) => void
}

export function MapSearch({state, onChange, filterGroups, results, total, onPick}: Props) {
  const [open, setOpen] = useState(false)
  const count = activeFilterCount(state)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="absolute left-3 top-3 z-10 flex h-[44px] items-center gap-2 rounded-full bg-white/90 px-4 text-[13px] font-semibold text-black shadow-sm ring-1 ring-black/10 md:left-4 md:top-4"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
          <circle cx="11" cy="11" r="6.5" />
          <path d="M16 16l4.5 4.5" />
        </svg>
        Search
        {count > 0 ? (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-black px-1.5 text-[11px] text-white">
            {count}
          </span>
        ) : null}
      </button>

      {open ? (
        <section
          aria-label="Search and filter the map"
          className="tv-card tv-sheet absolute inset-x-0 bottom-0 z-30 flex h-[72vh] flex-col overflow-hidden rounded-t-[28px] bg-white shadow-[0_-12px_48px_rgba(0,0,0,0.25)] md:inset-x-auto md:bottom-4 md:left-4 md:top-[68px] md:h-auto md:w-[360px] md:rounded-2xl md:shadow-[0_16px_48px_rgba(0,0,0,0.25)]"
        >
          <div className="flex items-center gap-2 px-4 pb-2 pt-4">
            <input
              type="search"
              value={state.query}
              onChange={(event) => onChange({...state, query: event.target.value})}
              placeholder="Search photos, routes, and flights"
              aria-label="Search"
              className="h-11 min-w-0 flex-1 rounded-full bg-black/[0.06] px-4 text-[15px] outline-none placeholder:text-black/40 focus:bg-black/[0.09]"
            />
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close search"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/[0.06]"
            >
              <CloseIcon className="h-[18px] w-[18px]" />
            </button>
          </div>

          <div className="space-y-2 px-4 pb-3">
            <PillRow state={state} options={filterGroups} onChange={onChange} />
            <div className="flex items-center justify-between gap-2 pt-0.5">
              <span />
              {count > 0 || state.query.trim() ? (
                <button
                  type="button"
                  onClick={() => onChange(emptyMapFilters)}
                  className="text-[12px] font-semibold text-black/60 underline underline-offset-2"
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>

          <p className="px-4 pb-1.5 text-[12px] text-black/45">
            {results.length === total ? `${total} on the map` : `${results.length} of ${total}`}
          </p>
          <ul className="min-h-0 flex-1 overflow-y-auto border-t border-black/5 pb-[env(safe-area-inset-bottom)]">
            {results.length === 0 ? (
              <li className="px-4 py-8 text-center text-[14px] text-black/50">Nothing matches that.</li>
            ) : (
              results.map((item) => {
                const date = formatMapDate(item.date)
                const meta = [item.label, date, item.miles ? formatMiles(item.miles) : null].filter(Boolean).join(' · ')
                return (
                  <li key={`${item.kind}-${item.id}`}>
                    <button
                      type="button"
                      onClick={() => onPick(item)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-black/[0.04] active:bg-black/[0.07]"
                    >
                      <ResultThumb item={item} />
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] font-semibold">{item.title}</span>
                        <span className="block truncate text-[12px] text-black/50">{meta}</span>
                      </span>
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        </section>
      ) : null}
    </>
  )
}

/** A photo's thumbnail, or an icon tile when there's no picture (a route's line, or the photo's pin shape). */
function ResultThumb({item}: {item: ResultItem}) {
  if (item.photo?.asset) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={urlFor(item.photo).width(112).height(112).fit('crop').url()}
        alt={sanityImageAlt(item.photo, item.title)}
        className="h-11 w-11 shrink-0 rounded-lg object-cover"
      />
    )
  }
  if (item.kind === 'flight') {
    return (
      <div
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
        style={{background: `linear-gradient(160deg, ${FLIGHT_PATH_COLOR} 0%, #1a1a1a 85%)`}}
        aria-hidden
      >
        <svg viewBox="0 0 44 44" className="h-full w-full">
          <path
            d="M8 28 C16 12, 22 34, 28 20 S36 10, 38 16"
            fill="none"
            stroke="white"
            strokeOpacity="0.9"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
        </svg>
      </div>
    )
  }
  if (item.kind === 'track') {
    const color = trackColor(item.activity ?? 'other')
    return (
      <div
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
        style={{background: `linear-gradient(160deg, ${color} 0%, #1a1a1a 85%)`}}
        aria-hidden
      >
        <svg viewBox="0 0 44 44" className="h-full w-full">
          <path
            d="M9 31 C13 14, 20 36, 25 22 S33 12, 35 14"
            fill="none"
            stroke="white"
            strokeOpacity="0.9"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeDasharray={item.activity === 'hike' ? '5 4' : undefined}
          />
          <circle cx="9" cy="31" r="3" fill="white" />
          <circle cx="35" cy="14" r="3" fill="white" />
        </svg>
      </div>
    )
  }
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-neutral-800 text-white" aria-hidden>
      <PhotoShape className="h-5 w-5" />
    </div>
  )
}

/**
 * One row of pills. A sub-pill appears right after the pill it belongs to (Aerial and Ground after Photos; bike,
 * hike, other and flights after Routes; drone models after Flights), pushing the rest to the right. A pill from
 * the other world than the one chosen is greyed out and can't be pressed. If the row is wider than the panel
 * it scrolls sideways, with a soft fade at an edge that has more.
 */
function PillRow({
  state,
  options,
  onChange,
}: {
  state: MapFilterState
  options: FilterOptions
  onChange: (next: MapFilterState) => void
}) {
  const scroller = useRef<HTMLDivElement | null>(null)
  const [edges, setEdges] = useState({left: false, right: false})

  const measure = () => {
    const el = scroller.current
    if (!el) return
    const left = el.scrollLeft > 4
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4
    setEdges((current) => (current.left === left && current.right === right ? current : {left, right}))
  }

  // Re-measure when the pills or the panel change size.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    if (el.firstElementChild) observer.observe(el.firstElementChild)
    return () => observer.disconnect()
  }, [])

  // A mouse wheel scrolls the row sideways (the row never scrolls up and down anyway).
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      event.preventDefault()
      el.scrollLeft += event.deltaY
    }
    el.addEventListener('wheel', onWheel, {passive: false})
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // When a group opens, bring it (and its new pills) into view.
  const hasFlights = state.routes && state.routeKinds.includes('flights')
  useEffect(() => {
    const open = [state.photos && 'photos', state.routes && 'routes', hasFlights && 'flights'].filter(Boolean)
    const last = open[open.length - 1]
    if (!last) return
    scroller.current
      ?.querySelector(`[data-group="${last}"]`)
      ?.scrollIntoView({behavior: 'smooth', inline: 'nearest', block: 'nearest'})
  }, [state.photos, state.routes, hasFlights])

  const fade = `linear-gradient(to right, ${edges.left ? 'transparent, black 28px' : 'black, black'}, ${
    edges.right ? 'black calc(100% - 28px), transparent' : 'black, black'
  })`

  const subPill = (kind: PhotoKind | RouteKind, label: string) => {
    const chosen = ((state.photoKinds as string[]).includes(kind) || (state.routeKinds as string[]).includes(kind))
    const blockedBy = chosen ? null : pillBlockedBy(state, kind)
    return (
      <Chip
        key={kind}
        sub
        active={chosen}
        disabled={blockedBy !== null}
        title={blockedBy ? `Not available with ${blockedBy}` : undefined}
        onClick={() => onChange(toggleKind(state, kind))}
      >
        {label}
      </Chip>
    )
  }

  return (
    <div
      ref={scroller}
      onScroll={measure}
      className="-mx-4 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{maskImage: fade, WebkitMaskImage: fade}}
    >
      <div className="flex w-max items-center gap-1.5">
        {options.hasPhotos ? (
          <div data-group="photos" className="flex items-center gap-1.5">
            <Chip active={state.photos} onClick={() => onChange(toggleGroup(state, 'photos'))}>
              Photos
            </Chip>
            {state.photos ? options.photoKinds.map((pill) => subPill(pill.kind, pill.label)) : null}
          </div>
        ) : null}
        {options.hasRoutes ? (
          <div data-group="routes" className="flex items-center gap-1.5">
            <Chip active={state.routes} onClick={() => onChange(toggleGroup(state, 'routes'))}>
              Routes
            </Chip>
            {state.routes
              ? options.routeKinds.map((pill) =>
                  pill.kind === 'flights' ? (
                    <div key="flights" data-group="flights" className="flex items-center gap-1.5">
                      {subPill(pill.kind, pill.label)}
                      {hasFlights
                        ? options.aircraft.map((model) => (
                            <Chip
                              key={model.value}
                              sub
                              active={state.aircraft.includes(model.value)}
                              onClick={() => onChange(toggleAircraft(state, model.value))}
                            >
                              {model.label}
                            </Chip>
                          ))
                        : null}
                    </div>
                  ) : (
                    subPill(pill.kind, pill.label)
                  ),
                )
              : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
  sub = false,
  disabled = false,
  title,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  /** A sub-pill: a little smaller, outlined when off. */
  sub?: boolean
  disabled?: boolean
  title?: string
}) {
  const look = active
    ? 'bg-black text-white'
    : sub
      ? 'bg-white text-black/70 ring-1 ring-inset ring-black/15'
      : 'bg-black/[0.06] text-black/70'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      disabled={disabled}
      title={title}
      className={`shrink-0 whitespace-nowrap rounded-full font-medium ${
        sub ? 'px-2.5 py-1 text-[12px]' : 'px-3 py-1.5 text-[13px]'
      } ${look} ${disabled ? 'cursor-not-allowed opacity-35' : ''}`}
    >
      {children}
    </button>
  )
}
