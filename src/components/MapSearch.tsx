'use client'

import {useState} from 'react'
import {CloseIcon} from './CloseIcon'
import {PhotoShape} from './shapes'
import {sanityImageAlt, urlFor} from '@/lib/sanity/image'
import {formatMiles} from '@/lib/geo'
import {FLIGHT_PATH_COLOR} from '@/lib/flight-color'
import {trackColor} from '@/lib/track-color'
import {
  activeFilterCount,
  emptyMapFilters,
  flightType,
  type MapFilterState,
  type ResultItem,
  type TypeOption,
} from '@/lib/map-filters'
import {formatMapDate} from '@/lib/format-map-date'

type FilterGroups = {
  groups: TypeOption[]
  routeKinds: TypeOption[]
  aircraftChips: TypeOption[]
  hasDrone: boolean
}

type Props = {
  state: MapFilterState
  onChange: (next: MapFilterState) => void
  filterGroups: FilterGroups
  results: ResultItem[]
  total: number
  onPick: (item: ResultItem) => void
}

export function MapSearch({state, onChange, filterGroups, results, total, onPick}: Props) {
  const {groups, routeKinds, aircraftChips, hasDrone} = filterGroups
  const showRouteKinds =
    routeKinds.length > 0 &&
    (state.types.includes('track:all') || routeKinds.some((option) => state.types.includes(option.value)))
  const showAircraft =
    aircraftChips.length > 0 &&
    (state.types.includes(flightType()) ||
      state.types.includes('flight:all') ||
      aircraftChips.some((option) => state.types.includes(option.value)))
  const [open, setOpen] = useState(false)
  const count = activeFilterCount(state)

  const toggleType = (value: string) =>
    onChange({
      ...state,
      types: state.types.includes(value) ? state.types.filter((t) => t !== value) : [...state.types, value],
    })

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

          <div className="space-y-2.5 px-4 pb-3">
            {groups.length > 0 || hasDrone ? (
              <Chips>
                {hasDrone ? (
                  <Chip active={state.drone} onClick={() => onChange({...state, drone: !state.drone})}>
                    Aerial
                  </Chip>
                ) : null}
                {groups.map((option) => (
                  <Chip
                    key={option.value}
                    active={state.types.includes(option.value)}
                    onClick={() => toggleType(option.value)}
                  >
                    {option.label}
                  </Chip>
                ))}
                {showRouteKinds
                  ? routeKinds.map((option) => (
                      <Chip
                        key={option.value}
                        active={state.types.includes(option.value)}
                        onClick={() => toggleType(option.value)}
                      >
                        {option.label}
                      </Chip>
                    ))
                  : null}
                {showAircraft
                  ? aircraftChips.map((option) => (
                      <Chip
                        key={option.value}
                        active={state.types.includes(option.value)}
                        onClick={() => toggleType(option.value)}
                      >
                        {option.label}
                      </Chip>
                    ))
                  : null}
              </Chips>
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <span />
              {count > 0 ? (
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

function Chips({children}: {children: React.ReactNode}) {
  return <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{children}</div>
}

function Chip({active, onClick, children}: {active: boolean; onClick: () => void; children: React.ReactNode}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium ${
        active ? 'bg-black text-white' : 'bg-black/[0.06] text-black/70'
      }`}
    >
      {children}
    </button>
  )
}
