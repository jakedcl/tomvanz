'use client'

import {useCallback, useDeferredValue, useEffect, useMemo, useRef, useState} from 'react'
import dynamic from 'next/dynamic'
import {InfoCard} from './InfoCard'
import {MapDetailPanel} from './MapDetailPanel'
import {ThreeDButton} from './ThreeDButton'
import {MapSearch} from './MapSearch'
import {PileStrip} from './PileStrip'
import type {FlightSeriesSample} from '@/lib/flight-log'
import {trackMiles} from '@/lib/track-mileage'
import {
  applyMapFilters,
  emptyMapFilters,
  filterOptions,
  resultList,
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
  const [searchKey, setSearchKey] = useState(0)
  const [mapFilters, setMapFilters] = useState<MapFilterState>(emptyMapFilters)
  // The map follows typing a beat later, so it doesn't re-fit on every keystroke.
  const deferredFilters = useDeferredValue(mapFilters)
  const data = useMemo(() => applyMapFilters(allData, deferredFilters), [allData, deferredFilters])
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
  const flightScrubRef = useRef<((sample: FlightSeriesSample | null) => void) | null>(null)
  const onPanelHeight = useCallback((height: number) => setPanelHeight(height), [])
  const registerFlightScrub = useCallback((handler: (sample: FlightSeriesSample | null) => void) => {
    flightScrubRef.current = handler
  }, [])

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
  }, [])

  const openPile = useCallback((members: BunchMember[]) => {
    setSelected(null)
    setPileIndex(0)
    setPileMembers(members)
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
    setPileMembers(null)
    setSelected(
      item.kind === 'pin'
        ? {kind: 'pin', id: item.id}
        : item.kind === 'flight'
          ? {kind: 'flight', id: item.id, fly: true}
          : {kind: 'track', id: item.id, fly: true},
    )
    // Close the results list so it isn't covering the card; the filters stay applied.
    setSearchKey((key) => key + 1)
  }, [])

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
      className="relative h-full w-full overflow-hidden bg-[#e8e8e8]"
      data-strip={pileMembers && pileMembers.length > 1 && !card ? 'true' : 'false'}
      data-detail-open={card ? 'true' : 'false'}
      style={card ? ({['--detail-panel-height' as string]: `${panelHeight}px`}) : undefined}
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
          panelHeight={card ? panelHeight : 0}
          onRegisterFlightScrub={registerFlightScrub}
        />
      )}
      {!mapFailed ? (
        <MapSearch
          key={searchKey}
          state={mapFilters}
          onChange={setMapFilters}
          filterGroups={options}
          results={results}
          total={allData.pins.length + allData.tracks.length + allData.flights.length}
          onPick={pickResult}
        />
      ) : null}
      {!mapFailed ? (
        <ThreeDButton threeD={threeD} onChange={changeThreeD} />
      ) : null}
      {!mapFailed && loadFailed ? (
        <p
          role="status"
          className="absolute inset-x-3 top-[68px] z-10 mx-auto w-fit max-w-[360px] rounded-2xl bg-white/95 px-4 py-2.5 text-center text-[13px] leading-snug text-black/75 shadow-md"
        >
          Couldn’t load the latest map data right now. Try reloading in a minute.
        </p>
      ) : null}
      {!mapFailed && !loadFailed && total === 0 ? (
        <p className="pointer-events-none absolute left-4 top-[68px] z-10 rounded-full bg-white/85 px-3 py-1.5 text-[13px] text-black/60 shadow-sm">
          Nothing mapped yet.
        </p>
      ) : null}
      {!mapFailed && !loadFailed && total > 0 && matching === 0 ? (
        <p className="pointer-events-none absolute left-4 top-[68px] z-10 rounded-full bg-white/85 px-3 py-1.5 text-[13px] text-black/60 shadow-sm">
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
      {card && data ? (
        <MapDetailPanel onHeightChange={onPanelHeight}>
          <InfoCard
            data={data}
            selected={card}
            onClose={() => select(null)}
            onFlightScrub={(sample) => flightScrubRef.current?.(sample)}
            onOpenPhoto={(id) => select({kind: 'pin', id})}
          />
        </MapDetailPanel>
      ) : null}
    </div>
  )
}
