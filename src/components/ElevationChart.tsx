'use client'

import {useCallback, useEffect, useRef, useState} from 'react'
import {formatFeet, routeElevation, type ElevationProfile, type RouteScrubPoint} from '@/lib/elevation'
import type {ReplayController} from '@/lib/flyover/replay-controller'
import {useReplayCursor} from './ReplayControls'

type Props = {
  coords: [number, number][]
  color: string
  compact?: boolean
  onScrub?: (point: RouteScrubPoint | null) => void
  /** The replay of this route: its position is drawn as a cursor on the profile. */
  replay?: ReplayController
}

const W = 300

/** Elevation profile and climb for a route, computed in the browser from terrain tiles. */
export function ElevationChart({coords, color, compact = false, onScrub, replay}: Props) {
  const replayFrame = useReplayCursor(replay)
  const H = compact ? 40 : 64
  const [state, setState] = useState<{profile: ElevationProfile | null; done: boolean}>({
    profile: null,
    done: false,
  })
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  useEffect(() => {
    let cancelled = false
    routeElevation(coords)
      .then((profile) => !cancelled && setState({profile, done: true}))
      .catch(() => !cancelled && setState({profile: null, done: true}))
    return () => {
      cancelled = true
    }
  }, [coords])

  useEffect(() => () => onScrub?.(null), [onScrub])

  const pick = useCallback(
    (clientX: number) => {
      const profile = state.profile
      if (!profile?.lnglats.length || !svgRef.current) return
      const total = profile.miles[profile.miles.length - 1] || 1
      const rect = svgRef.current.getBoundingClientRect()
      const x = ((clientX - rect.left) / rect.width) * W
      const targetMiles = (x / W) * total
      let index = 0
      let bestDist = Math.abs(profile.miles[0]! - targetMiles)
      for (let i = 1; i < profile.miles.length; i += 1) {
        const d = Math.abs(profile.miles[i]! - targetMiles)
        if (d < bestDist) {
          index = i
          bestDist = d
        }
      }
      setActiveIndex(index)
      const [lng, lat] = profile.lnglats[index]!
      onScrub?.({lng, lat, miles: profile.miles[index]!, feet: profile.feet[index]!, fraction: profile.miles[index]! / total})
    },
    [onScrub, state.profile],
  )

  if (state.done && !state.profile) return null

  if (!state.profile) {
    return (
      <div
        className={`${compact ? 'h-[58px]' : 'mt-3 h-[88px]'} animate-pulse rounded-lg bg-black/[0.05]`}
        aria-hidden
      />
    )
  }

  const {feet, miles, minFeet, maxFeet, gainFeet, lossFeet} = state.profile
  const span = Math.max(1, maxFeet - minFeet)
  const total = miles[miles.length - 1] || 1
  const points = feet.map((f, i) => {
    const x = (miles[i]! / total) * W
    const y = H - 4 - ((f - minFeet) / span) * (H - 12)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const line = points.join(' ')
  const area = `0,${H} ${line} ${W},${H}`
  // The pointer wins while it's on the chart; otherwise the cursor shows where the replay is.
  const scrubX = activeIndex != null ? (miles[activeIndex]! / total) * W : replayFrame ? replayFrame.fraction * W : null

  return (
    <div className={compact ? 'pt-0.5' : 'mt-3'}>
      <div className={`flex flex-wrap gap-1 ${compact ? 'pb-1' : 'gap-1.5 pb-2'}`}>
        <Stat compact={compact} label="Climb" value={`↑ ${formatFeet(gainFeet)}`} />
        <Stat compact={compact} label="Descent" value={`↓ ${formatFeet(lossFeet)}`} />
        <Stat compact={compact} label="High point" value={formatFeet(maxFeet)} />
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className={`${compact ? 'h-10' : 'h-16'} w-full overflow-visible ${onScrub ? 'cursor-crosshair touch-none' : ''}`}
        role="img"
        aria-label={`Elevation from ${formatFeet(minFeet)} to ${formatFeet(maxFeet)}`}
        onPointerDown={
          onScrub
            ? (e) => {
                e.currentTarget.setPointerCapture(e.pointerId)
                pick(e.clientX)
              }
            : undefined
        }
        onPointerMove={onScrub ? (e) => pick(e.clientX) : undefined}
        onPointerUp={
          onScrub
            ? (e) => {
                e.currentTarget.releasePointerCapture(e.pointerId)
              }
            : undefined
        }
        onPointerLeave={
          onScrub
            ? (e) => {
                if (e.pointerType === 'touch') return
                setActiveIndex(null)
                onScrub(null)
              }
            : undefined
        }
      >
        <polygon points={area} fill={color} opacity="0.16" />
        <polyline points={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {scrubX != null ? (
          <line
            x1={scrubX}
            x2={scrubX}
            y1={0}
            y2={H}
            stroke="#000"
            strokeOpacity={0.15}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>
      {!compact ? (
        <p className="mt-1 text-[11px] text-black/40">Elevation is estimated from terrain data.</p>
      ) : null}
    </div>
  )
}

function Stat({label, value, compact}: {label: string; value: string; compact?: boolean}) {
  return (
    <span
      className={`rounded-full bg-black/[0.06] font-medium text-black/70 ${
        compact ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-[12px]'
      }`}
      title={label}
    >
      {value}
    </span>
  )
}