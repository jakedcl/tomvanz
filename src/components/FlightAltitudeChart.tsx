'use client'

import {useCallback, useEffect, useRef, useState} from 'react'

import type {FlightSeriesSample} from '@/lib/flight-log'
import {formatFeet} from '@/lib/elevation'

type Props = {
  flightId: string
  onScrub: (sample: FlightSeriesSample | null) => void
}

const W = 300
const H = 72

function metersToFeet(m: number) {
  return m * 3.28084
}

export function FlightAltitudeChart({flightId, onScrub}: Props) {
  const [samples, setSamples] = useState<FlightSeriesSample[] | null>(null)
  const [done, setDone] = useState(false)
  const [active, setActive] = useState<FlightSeriesSample | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/flight/${encodeURIComponent(flightId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: {series: string | null}) => {
        if (cancelled) return
        const parsed = data.series ? (JSON.parse(data.series) as FlightSeriesSample[]) : []
        setSamples(parsed)
        setDone(true)
      })
      .catch(() => !cancelled && setDone(true))
    return () => {
      cancelled = true
      onScrub(null)
    }
  }, [flightId, onScrub])

  const pick = useCallback(
    (clientX: number) => {
      if (!samples?.length || !svgRef.current) return
      const rect = svgRef.current.getBoundingClientRect()
      const x = ((clientX - rect.left) / rect.width) * W
      const tMax = samples[samples.length - 1]!.t || 1
      const targetT = (x / W) * tMax
      let best = samples[0]!
      let bestDist = Math.abs(best.t - targetT)
      for (const s of samples) {
        const d = Math.abs(s.t - targetT)
        if (d < bestDist) {
          best = s
          bestDist = d
        }
      }
      setActive(best)
      onScrub(best)
    },
    [samples, onScrub],
  )

  if (!done) {
    return <div className="mt-3 h-[120px] animate-pulse rounded-xl bg-black/[0.05]" aria-hidden />
  }
  if (!samples?.length) return null

  const tMax = samples[samples.length - 1]!.t || 1
  const heights = samples.map((s) => s.height)
  const minH = Math.min(...heights)
  const maxH = Math.max(...heights)
  const span = Math.max(1, maxH - minH)

  const points = samples.map((s) => {
    const x = (s.t / tMax) * W
    const y = H - 4 - ((s.height - minH) / span) * (H - 12)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const line = points.join(' ')

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60)
    const s = Math.round(sec % 60)
    return m > 0 ? `${m}m ${s}s` : `${s}s`
  }

  return (
    <div className="mt-3">
      {active ? (
        <MotionReadout sample={active} formatDuration={formatDuration} />
      ) : (
        <p className="pb-2 text-[11px] text-black/45">Drag across the chart to scrub the flight path.</p>
      )}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-[72px] w-full cursor-crosshair touch-none"
        role="img"
        aria-label="Flight altitude over time"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          pick(e.clientX)
        }}
        onPointerMove={(e) => {
          if (e.buttons === 0 && e.pressure === 0) return
          pick(e.clientX)
        }}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId)
        }}
        onPointerLeave={() => {
          setActive(null)
          onScrub(null)
        }}
      >
        <polyline points={line} fill="none" stroke="#d97706" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {active ? (
          <line
            x1={(active.t / tMax) * W}
            x2={(active.t / tMax) * W}
            y1={0}
            y2={H}
            stroke="#000"
            strokeOpacity={0.15}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>
      <p className="mt-1 text-[11px] text-black/40">
        {formatFeet(metersToFeet(minH))} – {formatFeet(metersToFeet(maxH))} · {formatDuration(tMax)}
      </p>
    </div>
  )
}

function MotionReadout({
  sample,
  formatDuration,
}: {
  sample: FlightSeriesSample
  formatDuration: (s: number) => string
}) {
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      <Chip label="Height" value={formatFeet(metersToFeet(sample.height))} />
      <Chip label="Speed" value={`${(sample.speed * 2.237).toFixed(1)} mph`} />
      <Chip label="Battery" value={`${Math.round(sample.battery)}%`} />
      {sample.mode ? <Chip label="Mode" value={sample.mode} /> : null}
      <Chip label="Time" value={formatDuration(sample.t)} />
    </div>
  )
}

function Chip({label, value}: {label: string; value: string}) {
  return (
    <span className="rounded-full bg-black/[0.06] px-3 py-1 text-[12px] font-medium text-black/70" title={label}>
      {value}
    </span>
  )
}