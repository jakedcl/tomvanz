'use client'

import {useCallback, useDeferredValue, useEffect, useMemo, useRef, useState} from 'react'
import dynamic from 'next/dynamic'
import {DetailsPanel} from './MapPanel'
import {MapSheet} from './MapSheet'
import {MapSidebar} from './MapSidebar'
import {FilterPills, ResultsList, SearchBar} from './MapSearch'
import {ThreeDButton} from './ThreeDButton'
import {PileStrip} from './PileStrip'
import type {SnapName} from '@/lib/sheet-snap'
import {useMediaQuery} from '@/lib/use-media-query'
import {ReplayController} from '@/lib/flyover/replay-controller'
import {trackMiles} from '@/lib/track-mileage'
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
  // Wide screens get a sidebar beside the map; narrow ones get a bottom sheet over it.
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const [snap, setSnap] = useState<SnapName>(initialSelected ? 'half' : 'peek')
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
  const [panelHeight, setPanelHeight] = useState(0)
  const onPanelHeight = useCallback((height: number) => setPanelHeight(height), [])
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
  // On a phone, choosing something raises the sheet to show it.
  const select = useCallback((item: SelectedItem | null) => {
    setPileMembers(null)
    setSelected(item)
    if (item) setSnap('half')
  }, [])

  const openPile = useCallback((members: BunchMember[]) => {
    setSelected(null)
    setSnap('peek')
    setPileIndex(0)
    setPileMembers(members)
  }, [])

  // Moving the map by hand lowers the sheet so the map is clear.
  const lowerSheet = useCallback(() => setSnap('peek'), [])
  // Tapping into the search box raises a lowered sheet so the results are in view.
  const raiseSheetForSearch = useCallback(() => setSnap((current) => (current === 'peek' ? 'half' : current)), [])

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

  const pickResult = useCallback(
    (item: ResultItem) => {
      select(
        item.kind === 'pin'
          ? {kind: 'pin', id: item.id}
          : item.kind === 'flight'
            ? {kind: 'flight', id: item.id, fly: true}
            : {kind: 'track', id: item.id, fly: true},
      )
    },
    [select],
  )

  const total = allData.tracks.length + allData.flights.length + allData.pins.length
  const matching = data.tracks.length + data.flights.length + data.pins.length

  const selectedStillVisible = useMemo(() => {
    if (!selected) return false
    if (selected.kind === 'track') return data.tracks.some((item) => item._id === selected.id)
    if (selected.kind === 'flight') return data.flights.some((item) => item._id === selected.id)
    return data.pins.some((item) => item._id === selected.id)
  }, [selected, data])

  const card = selectedStillVisible ? selected : null

  // What the panel shows: the selected item's details, or the pills and the results list.
  const details = card ? (
    <DetailsPanel
      data={data}
      selected={card}
      onBack={() => select(null)}
      replay={replay}
      // Dragging along a profile moves the replay marker there (and pauses it).
      onFlightScrub={(sample) => {
        if (sample) replay.seekSeconds(sample.t - (replay.getTrack()?.sourceT0 ?? 0))
      }}
      onRouteScrub={(point) => {
        if (point) replay.seekFraction(point.fraction)
      }}
      // The flyover needs the terrain on, so playing switches 3D on (no how-to hint: they're watching).
      onPlay={() => {
        if (!threeD) startThreeDFromGesture()
        replay.play()
      }}
      onOpenPhoto={(id) => select({kind: 'pin', id})}
    />
  ) : null
  // A stack of items at one spot (the "1 of 6" strip): the panel lists just those, with the current one marked.
  const pileResults = useMemo(() => {
    if (!pileMembers || pileMembers.length < 2) return null
    return pileMembers.flatMap((member) =>
      resultList(
        {
          ...data,
          pins: data.pins.filter((item) => member.kind === 'pin' && item._id === member.id),
          tracks: data.tracks.filter((item) => member.kind === 'track' && item._id === member.id),
          flights: data.flights.filter((item) => member.kind === 'flight' && item._id === member.id),
        },
        (track) => trackMiles(track),
      ),
    )
  }, [pileMembers, data])
  const currentPileMember = pileMembers?.[pileIndex]
  const listBody =
    pileResults && pileResults.length > 1 ? (
      <>
        <div className="flex items-center justify-between px-4 pb-2 pt-1">
          <p className="text-[14px] font-semibold">Stacked here</p>
          <button
            type="button"
            onClick={() => select(null)}
            className="text-[12px] font-semibold text-black/60 underline underline-offset-2"
          >
            Show all
          </button>
        </div>
        <ResultsList
          results={pileResults}
          total={pileResults.length}
          onPick={pickResult}
          countLabel={`${pileIndex + 1} of ${pileResults.length}`}
          activeKey={currentPileMember ? `${currentPileMember.kind}-${currentPileMember.id}` : undefined}
        />
      </>
    ) : (
      <>
        <FilterPills state={mapFilters} onChange={setMapFilters} filterGroups={options} />
        <ResultsList results={results} total={total} onPick={pickResult} />
      </>
    )

  return (
    <div
      className="relative flex h-full w-full overflow-hidden overscroll-none bg-[#e8e8e8]"
      data-strip={pileMembers && pileMembers.length > 1 && !card ? 'true' : 'false'}
      data-detail-open={card ? 'true' : 'false'}
    >
      {isDesktop ? (
        <MapSidebar header={card ? null : <SearchBar state={mapFilters} onChange={setMapFilters} />}>
          {details ?? listBody}
        </MapSidebar>
      ) : null}
      <div className="relative min-h-0 min-w-0 flex-1">
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
            // On a phone the sheet covers the bottom of the map; keep what's selected clear of it.
            panelHeight={!isDesktop && card ? panelHeight : 0}
            replay={replay}
            onRequestThreeD={changeThreeD}
            onUserPan={lowerSheet}
          />
        )}
        {!mapFailed ? <ThreeDButton threeD={threeD} onChange={changeThreeD} /> : null}
        {!mapFailed && loadFailed ? (
          <p
            role="status"
            className="absolute inset-x-3 top-[68px] z-10 mx-auto w-fit max-w-[360px] rounded-2xl bg-white/95 px-4 py-2.5 text-center text-[13px] leading-snug text-black/75 shadow-md"
          >
            Couldn’t load the latest map data right now. Try reloading in a minute.
          </p>
        ) : null}
        {!mapFailed && !loadFailed && total === 0 ? (
          <p className="pointer-events-none absolute left-4 top-4 z-10 rounded-full bg-white/85 px-3 py-1.5 text-[13px] text-black/60 shadow-sm">
            Nothing mapped yet.
          </p>
        ) : null}
        {!mapFailed && !loadFailed && total > 0 && matching === 0 ? (
          <p className="pointer-events-none absolute left-4 top-4 z-10 rounded-full bg-white/85 px-3 py-1.5 text-[13px] text-black/60 shadow-sm">
            Nothing matches your filters.
          </p>
        ) : null}
        {hint ? (
          <div
            role="status"
            className="tv-hint pointer-events-none absolute inset-x-0 bottom-[calc(100px+env(safe-area-inset-bottom))] z-10 flex justify-center px-14 md:bottom-16"
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
            bottomOffset={isDesktop ? 0 : panelHeight}
          />
        ) : null}
      </div>
      {!isDesktop ? (
        <MapSheet
          snap={snap}
          onSnapChange={setSnap}
          onHeightChange={onPanelHeight}
          header={<SearchBar state={mapFilters} onChange={setMapFilters} onFocus={raiseSheetForSearch} />}
        >
          {details ?? listBody}
        </MapSheet>
      ) : null}
    </div>
  )
}
