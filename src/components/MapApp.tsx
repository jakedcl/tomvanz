'use client'

import {useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react'
import dynamic from 'next/dynamic'
import {InfoCard} from './InfoCard'
import {MapPanel} from './MapPanel'
import {ThreeDButton} from './ThreeDButton'
import {MapSearch, MapSearchInput} from './MapSearch'
import {PileStrip} from './PileStrip'
import {ReplayController} from '@/lib/flyover/replay-controller'
import {trackMiles} from '@/lib/track-mileage'
import type {SheetHeights, SheetLevel} from '@/lib/sheet-snap'
import {
  applyMapFilters,
  emptyMapFilters,
  filterOptions,
  normalizeMapFilters,
  resultList,
  samePills,
  visibleOnMap,
  type MapFilterState,
  type ResultItem,
} from '@/lib/map-filters'
import type {BunchMember} from '@/lib/map-bunch'
import type {MapData, SelectedItem} from '@/lib/sanity/types'

const MapCanvas = dynamic(() => import('./MapCanvas').then((mod) => mod.MapCanvas), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-[14px] text-black/50">
      Loading map
    </div>
  ),
})

type Props = {
  data: MapData
  /** Set when the page was opened from a shared link. */
  initialSelected?: SelectedItem | null
  /** The map data couldn't be loaded from Sanity (the map still opens, empty). */
  loadFailed?: boolean
}

export function MapApp({data: allData, initialSelected = null, loadFailed = false}: Props) {
  const [selected, setSelected] = useState<SelectedItem | null>(initialSelected)
  const collapsed = useSyncExternalStore(subscribeSidebar, readSidebar, () => false)
  const [sheetLevel, setSheetLevel] = useState<SheetLevel>(initialSelected ? 'half' : 'peek')
  const [sheet, setSheet] = useState<SheetHeights>({peek: 0, half: 0, full: 0})
  const resultsRef = useRef<HTMLUListElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const onSheetHeights = useCallback((next: SheetHeights) => {
    setSheet((current) =>
      current.peek === next.peek && current.half === next.half && current.full === next.full ? current : next,
    )
  }, [])
  // The pills and the search text are kept apart: only the pills decide what the map shows, and a pills object that
  // hasn't changed keeps the same identity however much is typed, so typing never redraws the map.
  const [pills, setPills] = useState<MapFilterState>(emptyMapFilters)
  const [query, setQuery] = useState('')
  const mapFilters = useMemo(() => ({...pills, query}), [pills, query])
  const setMapFilters = useCallback((next: MapFilterState) => {
    const normalized = normalizeMapFilters(next)
    setQuery(normalized.query)
    setPills((current) => (samePills(current, normalized) ? current : {...normalized, query: ''}))
  }, [])
  // The map follows the pills a beat later, so it doesn't re-fit while they are being changed.
  const deferredPills = useDeferredValue(pills)
  const data = useMemo(() => visibleOnMap(allData, deferredPills), [allData, deferredPills])
  const options = useMemo(() => filterOptions(allData), [allData])
  const results = useMemo(
    () => resultList(applyMapFilters(allData, mapFilters), (track) => trackMiles(track)),
    [allData, mapFilters],
  )
  const [pileMembers, setPileMembers] = useState<BunchMember[] | null>(null)
  const [pileIndex, setPileIndex] = useState(0)
  const [mapFailed, setMapFailed] = useState(false)
  const [threeD, setThreeD] = useState(false)
  const [hint, setHint] = useState<'touch' | 'mouse' | null>(null)
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The replay of the open flight or route. The panel's controls and charts drive it; the map draws it.
  const [replay] = useState(() => new ReplayController())
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => replay.setReducedMotion(query.matches)
    update()
    query.addEventListener('change', update)
    return () => {
      query.removeEventListener('change', update)
      replay.load(null)
    }
  }, [replay])

  useEffect(() => () => {
    if (hintTimer.current) clearTimeout(hintTimer.current)
  }, [])

  const changeThreeD = (next: boolean) => {
    setThreeD(next)
    if (hintTimer.current) clearTimeout(hintTimer.current)
    if (!next) {
      setHint(null)
      return
    }
    setHint(window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse')
    hintTimer.current = setTimeout(() => setHint(null), 5000)
  }

  // Tilting the map by hand turns 3D on. No how-to hint: they clearly know how to move around.
  const startThreeDFromGesture = useCallback(() => setThreeD(true), [])

  // Any new selection (or a tap on empty map) closes the pile strip.
  const select = useCallback((item: SelectedItem | null) => {
    setPileMembers(null)
    setSelected(item)
    if (item) {
      if (!window.matchMedia('(max-width: 767px)').matches && readSidebar()) writeSidebar(false)
      setSheetLevel('half')
    }
  }, [])

  const closeDetails = useCallback(() => {
    select(null)
    const target = returnFocus.current
    returnFocus.current = null
    if (target) requestAnimationFrame(() => target.focus({preventScroll: true}))
  }, [select])

  const lowerSheetOnPan = useCallback(() => setSheetLevel('peek'), [])

  const openPile = useCallback((members: BunchMember[]) => {
    setSelected(null)
    setPileIndex(0)
    setPileMembers(members)
    setSheetLevel('peek')
  }, [])

  // Keep the address bar pointing at whatever is open, so the link can be shared.
  useEffect(() => {
    const url = new URL(window.location.href)
    url.searchParams.delete('photo')
    url.searchParams.delete('track')
    url.searchParams.delete('flight')
    if (selected) {
      const key = selected.kind === 'pin' ? 'photo' : selected.kind === 'flight' ? 'flight' : 'track'
      url.searchParams.set(key, selected.id)
    }
    window.history.replaceState(window.history.state, '', url)
  }, [selected])

  const pickResult = useCallback((item: ResultItem) => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    select(
      item.kind === 'pin'
        ? {kind: 'pin', id: item.id}
        : item.kind === 'flight'
          ? {kind: 'flight', id: item.id, fly: true}
          : {kind: 'track', id: item.id, fly: true},
    )
    requestAnimationFrame(() => backRef.current?.focus({preventScroll: true}))
  }, [select])

  const total = allData.tracks.length + allData.flights.length + allData.pins.length
  const matching = data.tracks.length + data.flights.length + data.pins.length

  const selectedStillVisible = useMemo(() => {
    if (!selected) return false
    if (selected.kind === 'track') return data.tracks.some((item) => item._id === selected.id)
    if (selected.kind === 'flight') return data.flights.some((item) => item._id === selected.id)
    return data.pins.some((item) => item._id === selected.id)
  }, [selected, data])

  const card = selectedStillVisible ? selected : null

  return (
    <div
      className="map-workspace relative h-full w-full overflow-hidden bg-[#e8e8e8]"
      data-collapsed={collapsed}
      data-sheet={sheetLevel}
    >
      {!mapFailed ? (
        <MapPanel
          collapsed={collapsed}
          onToggleCollapsed={() => writeSidebar(!collapsed)}
          level={sheetLevel}
          onLevel={setSheetLevel}
          onHeights={onSheetHeights}
          resultsRef={resultsRef}
          header={
            <MapSearchInput
              query={query}
              onChange={(text) => {
                setQuery(text)
                if (card) select(null)
              }}
              onFocus={() => setSheetLevel((current) => current === 'peek' ? 'half' : current)}
            />
          }
        >
          {loadFailed ? (
            <p role="status" className="px-4 py-2 text-[13px] leading-snug text-black/75">
              Couldn’t load the latest map data right now. Try reloading in a minute.
            </p>
          ) : null}
          <div className="map-panel-results" hidden={!!card}>
            <MapSearch
              state={mapFilters}
              onChange={setMapFilters}
              filterGroups={options}
              results={results}
              total={total}
              onPick={pickResult}
              listRef={resultsRef}
            />
          </div>
          {card ? (
            <>
              <div className="border-b border-black/10 px-4 pb-2">
                <button
                  ref={backRef}
                  type="button"
                  onClick={closeDetails}
                  className="inline-flex min-h-9 items-center gap-2 rounded-lg px-2 text-[13px] font-semibold text-black/75 hover:bg-black/5"
                >
                  <span aria-hidden>←</span>
                  Back to results
                </button>
              </div>
              <div className="map-panel-scroll">
                <InfoCard
                  key={`${card.kind}-${card.id}`}
                  data={data}
                  selected={card}
                  onClose={closeDetails}
                  replay={card.kind === 'pin' ? undefined : replay}
                  // The charts keep driving the same replay marker and camera.
                  onFlightScrub={(sample) => {
                    if (sample) replay.seekSeconds(sample.t - (replay.getTrack()?.sourceT0 ?? 0))
                  }}
                  onRouteScrub={(point) => {
                    if (point) replay.seekFraction(point.fraction)
                  }}
                  onPlay={() => {
                    if (!threeD) startThreeDFromGesture()
                    replay.play()
                  }}
                  onOpenPhoto={(id) => select({kind: 'pin', id})}
                />
              </div>
            </>
          ) : null}
        </MapPanel>
      ) : null}
      <div
        className="map-viewport relative min-w-0 flex-1 overflow-hidden"
        data-strip={pileMembers && pileMembers.length > 1 && !card ? 'true' : 'false'}
      >
        {mapFailed ? (
          <div className="flex h-full items-center justify-center text-[14px] text-black/70">
            Couldn’t load the map.
          </div>
        ) : (
          <MapCanvas
            data={data}
            threeD={threeD}
            onThreeDGesture={startThreeDFromGesture}
            selected={card}
            highlightId={
              pileMembers?.[pileIndex]?.kind === 'pin' ? pileMembers[pileIndex]!.id : null
            }
            onSelect={select}
            onPile={openPile}
            pileMembers={pileMembers}
            onMapError={() => setMapFailed(true)}
            panelHeight={card ? sheet.half : sheet.peek}
            onPanStart={lowerSheetOnPan}
            replay={replay}
            onRequestThreeD={changeThreeD}
          />
        )}
        {!mapFailed ? <ThreeDButton threeD={threeD} onChange={changeThreeD} /> : null}
        {!mapFailed && !loadFailed && total === 0 ? (
          <p className="pointer-events-none absolute left-4 top-4 z-10 rounded-full bg-white/85 px-3 py-1.5 text-[13px] text-black/60 shadow-sm">
            Nothing mapped yet.
          </p>
        ) : null}
        {!mapFailed && !loadFailed && total > 0 && matching === 0 ? (
          <p className="pointer-events-none absolute left-4 top-4 z-10 rounded-full bg-white/85 px-3 py-1.5 text-[13px] text-black/60 shadow-sm">
            Nothing matches your search.
          </p>
        ) : null}
        {hint ? (
          <div
            role="status"
            className="tv-hint pointer-events-none absolute inset-x-0 bottom-[92px] z-10 flex justify-center px-14 md:bottom-16"
          >
            <p className="max-w-[340px] rounded-2xl bg-black/80 px-4 py-2.5 text-center text-[13px] leading-snug text-white shadow-lg backdrop-blur-md">
              {hint === 'touch'
                ? 'Drag with two fingers up or down to tilt, twist to rotate, pinch to zoom.'
                : 'Right-click and drag (or Ctrl + drag) to tilt and rotate. Scroll to zoom.'}
            </p>
          </div>
        ) : null}
        {pileMembers && pileMembers.length > 1 && !card ? (
          <PileStrip
            data={data}
            members={pileMembers}
            index={pileIndex}
            onIndexChange={setPileIndex}
            onOpen={(member) =>
              select(
                member.kind === 'pin'
                  ? {kind: 'pin', id: member.id}
                  : member.kind === 'flight'
                    ? {kind: 'flight', id: member.id, fly: true}
                    : {kind: 'track', id: member.id, fly: true},
              )
            }
            onClose={() => select(null)}
          />
        ) : null}
      </div>
    </div>
  )
}

const sidebarKey = 'tomvanz-map-sidebar'
const sidebarChange = 'tomvanz-map-sidebar-change'
let sidebarFallback = false

function readSidebar() {
  try {
    return window.sessionStorage.getItem(sidebarKey) === 'collapsed'
  } catch {
    return sidebarFallback
  }
}

function writeSidebar(collapsed: boolean) {
  sidebarFallback = collapsed
  try {
    window.sessionStorage.setItem(sidebarKey, collapsed ? 'collapsed' : 'open')
  } catch {
    // The control still works when session storage is unavailable.
  }
  window.dispatchEvent(new Event(sidebarChange))
}

function subscribeSidebar(listener: () => void) {
  window.addEventListener(sidebarChange, listener)
  return () => window.removeEventListener(sidebarChange, listener)
}
