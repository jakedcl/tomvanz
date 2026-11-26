'use client'

import {useCallback, useEffect, useRef, useState} from 'react'

import type {FlightSeriesSample} from '@/lib/flight-log'
import {formatDurationSeconds} from '@/lib/format-duration'
import {formatFeet} from '@/lib/elevation'
import type {ReplayController} from '@/lib/flyover/replay-controller'
import {useReplayCursor} from './ReplayControls'

type Props = {
  flightId: string
  /** Document duration — chart footer matches the card chip. */
  durationSeconds?: number
  onScrub: (sample: FlightSeriesSample | null) => void
  /** When the parent already fetched series, skip a second request. */
  series?: FlightSeriesSample[] | null
  /** The replay of this flight: its position is drawn as a cursor, and its moment fills the readout. */
  replay?: ReplayController
}

const W = 300
const H = 72

function metersToFeet(m: number) {
  return m * 3.28084
}

export function FlightAltitudeChart({flightId, durationSeconds, onScrub, series, replay}: Props) {
  const replayFrame = useReplayCursor(replay)
  const [fetched, setFetched] = useState<FlightSeriesSample[] | null>(null)
  const [done, setDone] = useState(series !== undefined)
  const samples = series !== undefined ? series : fetched
  const [active, setActive] = useState<FlightSeriesSample | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  useEffect(() => {
    if (series !== undefined) return
    let cancelled = false
    fetch(`/api/flight/${encodeURIComponent(flightId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: {series: string | null}) => {
        if (cancelled) return
        const parsed = data.series ? (JSON.parse(data.series) as FlightSeriesSample[]) : []
        setFetched(parsed)
        setDone(true)
      })
      .catch(() => !cancelled && setDone(true))
    return () => {
      cancelled = true
      onScrub(null)
    }
  }, [flightId, onScrub, series])

  const pick = useCallback(
    (clientX: number) => {
      if (!samples?.length || !svgRef.current) return
      const times = samples.map((s) => s.t)
      const tMin = Math.min(...times)
      const tSpan = Math.max(1, Math.max(...times) - tMin)
      const rect = svgRef.current.getBoundingClientRect()
      const x = ((clientX - rect.left) / rect.width) * W
      const targetT = tMin + (x / W) * tSpan
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
    return <div className="h-[52px] animate-pulse rounded-lg bg-black/[0.05]" aria-hidden />
  }
  if (!samples?.length) return null

  const times = samples.map((s) => s.t)
  const tMin = Math.min(...times)
  const tSpan = Math.max(1, Math.max(...times) - tMin)
  const heights = samples.map((s) => s.height)
  const chartMinH = 0
  const chartMaxH = Math.max(chartMinH, ...heights)
  const span = Math.max(1, chartMaxH - chartMinH)

  const points = samples.map((s) => {
    const x = ((s.t - tMin) / tSpan) * W
    const y = H - 4 - ((Math.max(chartMinH, s.height) - chartMinH) / span) * (H - 12)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const line = points.join(' ')

  const formatElapsed = (sec: number) => formatDurationSeconds(sec) ?? `${Math.round(sec)}s`
  const footerDuration =
    formatDurationSeconds(durationSeconds ?? tSpan) ?? formatElapsed(tSpan)

  // The pointer wins while it's on the chart; otherwise the replay's moment is shown.
  const replayT = replayFrame ? tMin + replayFrame.t : null
  const shown = active ?? (replayT != null ? nearestSample(samples, replayT) : null)
  const cursorT = active ? active.t : replayT

  return (
    <div>
      {shown ? (
        <MotionReadout sample={shown} elapsedSeconds={shown.t - tMin} formatDuration={formatElapsed} />
      ) : null}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-[52px] w-full cursor-crosshair touch-none"
        role="img"
        aria-label="Flight altitude over time"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          pick(e.clientX)
        }}
        onPointerMove={(e) => pick(e.clientX)}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId)
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'touch') return
          setActive(null)
          onScrub(null)
        }}
      >
        <polyline points={line} fill="none" stroke="#d97706" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {cursorT != null ? (
          <line
            x1={((cursorT - tMin) / tSpan) * W}
            x2={((cursorT - tMin) / tSpan) * W}
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
        {formatFeet(metersToFeet(chartMinH))} – {formatFeet(metersToFeet(chartMaxH))} · {footerDuration}
      </p>
    </div>
  )
}

function nearestSample(samples: FlightSeriesSample[], t: number): FlightSeriesSample {
  let best = samples[0]!
  let bestDist = Math.abs(best.t - t)
  for (const s of samples) {
    const d = Math.abs(s.t - t)
    if (d < bestDist) {
      best = s
      bestDist = d
    }
  }
  return best
}

function MotionReadout({
  sample,
  elapsedSeconds,
  formatDuration,
}: {
  sample: FlightSeriesSample
  elapsedSeconds: number
  formatDuration: (s: number) => string
}) {
  return (
    <div className="mb-2 flex flex-nowrap gap-1 overflow-hidden">
      <Chip label="Height" value={formatFeet(metersToFeet(sample.height))} />
      <Chip label="Speed" value={`${(sample.speed * 2.237).toFixed(1)} mph`} />
      <Chip label="Battery" value={`${Math.round(sample.battery)}%`} />
      {sample.mode ? <Chip label="Mode" value={sample.mode} /> : null}
      <Chip label="Time" value={formatDuration(elapsedSeconds)} />
    </div>
  )
}

function Chip({label, value}: {label: string; value: string}) {
  return (
    <span className="min-w-0 shrink-0 truncate rounded-full bg-black/[0.06] px-2.5 py-1 text-[12px] font-medium tabular-nums text-black/70 last:shrink" title={label}>
      {value}
    </span>
  )
}