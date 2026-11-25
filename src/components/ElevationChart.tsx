'use client'

import {useEffect, useState} from 'react'
import {formatFeet, routeElevation, type ElevationProfile} from '@/lib/elevation'

type Props = {
  coords: [number, number][]
  color: string
  compact?: boolean
}

const W = 300

/** Elevation profile and climb for a route, computed in the browser from terrain tiles. */
export function ElevationChart({coords, color, compact = false}: Props) {
  const H = compact ? 40 : 64
  const [state, setState] = useState<{profile: ElevationProfile | null; done: boolean}>({
    profile: null,
    done: false,
  })

  useEffect(() => {
    let cancelled = false
    routeElevation(coords)
      .then((profile) => !cancelled && setState({profile, done: true}))
      .catch(() => !cancelled && setState({profile: null, done: true}))
    return () => {
      cancelled = true
    }
  }, [coords])

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

  return (
    <div className={compact ? 'pt-0.5' : 'mt-3'}>
      <div className={`flex flex-wrap gap-1 ${compact ? 'pb-1' : 'gap-1.5 pb-2'}`}>
        <Stat compact={compact} label="Climb" value={`↑ ${formatFeet(gainFeet)}`} />
        <Stat compact={compact} label="Descent" value={`↓ ${formatFeet(lossFeet)}`} />
        <Stat compact={compact} label="High point" value={formatFeet(maxFeet)} />
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className={`${compact ? 'h-10' : 'h-16'} w-full overflow-visible`}
        role="img"
        aria-label={`Elevation from ${formatFeet(minFeet)} to ${formatFeet(maxFeet)}`}
      >
        <polygon points={area} fill={color} opacity="0.16" />
        <polyline points={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
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
