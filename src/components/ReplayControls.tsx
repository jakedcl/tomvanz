'use client'

import {useCallback, useEffect, useState, useSyncExternalStore} from 'react'
import {REPLAY_SPEEDS} from '@/lib/flyover/replay-track'
import type {ReplayController, ReplayFrame} from '@/lib/flyover/replay-controller'

/** The replay's state, for the controls (it changes when you press something, not every frame). */
export function useReplayState(replay: ReplayController) {
  const subscribe = useCallback((callback: () => void) => replay.subscribeState(callback), [replay])
  const getState = useCallback(() => replay.getState(), [replay])
  return useSyncExternalStore(subscribe, getState, getState)
}

/**
 * Where the replay is, for a chart's cursor: null until the marker is on the map. Updated a few times a second
 * while playing (a chart doesn't need every frame) and straight away when you drag along it.
 */
export function useReplayCursor(replay: ReplayController | undefined, fps = 30): ReplayFrame | null {
  const [frame, setFrame] = useState<ReplayFrame | null>(null)
  useEffect(() => {
    if (!replay) return
    let last = 0
    const apply = (next: ReplayFrame | null) => setFrame(next?.visible ? next : null)
    apply(replay.getFrame())
    return replay.subscribeFrames((next) => {
      const now = performance.now()
      if (next.playing && now - last < 1000 / fps) return
      last = now
      apply(next)
    })
  }, [replay, fps])
  return frame
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <rect x="6" y="5" width="4" height="14" rx="1.2" />
      <rect x="14" y="5" width="4" height="14" rx="1.2" />
    </svg>
  )
}

function RecenterIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    </svg>
  )
}

type Props = {
  replay: ReplayController
  /** Starts playing (and turns 3D on first, since the flyover needs the terrain). */
  onPlay: () => void
}

/** Play or pause, the speed, and (when you've moved the camera yourself) a way to put it back on the marker. */
export function ReplayControls({replay, onPlay}: Props) {
  const state = useReplayState(replay)
  if (!state.hasTrack) return null
  const noun = state.kind === 'flight' ? 'flight' : 'route'
  const showRecenter = state.visible && !state.following && !state.reducedMotion

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 pb-2" role="group" aria-label={`Replay this ${noun}`}>
      <button
        type="button"
        onClick={() => (state.playing ? replay.pause() : onPlay())}
        aria-label={state.playing ? 'Pause replay' : `Play ${noun} replay`}
        className="flex h-9 items-center gap-1.5 rounded-full bg-black px-3.5 text-[13px] font-semibold text-white"
      >
        {state.playing ? <PauseIcon /> : <PlayIcon />}
        {state.playing ? 'Pause' : 'Replay'}
      </button>
      <div className="flex h-9 items-center rounded-full bg-black/[0.06] p-0.5" role="group" aria-label="Replay speed">
        {REPLAY_SPEEDS.map((speed) => (
          <button
            key={speed}
            type="button"
            onClick={() => replay.setSpeed(speed)}
            aria-pressed={state.speed === speed}
            aria-label={`${speed} times speed`}
            className={`h-8 min-w-9 rounded-full px-2.5 text-[12px] font-semibold ${
              state.speed === speed ? 'bg-white text-black shadow-sm' : 'text-black/55'
            }`}
          >
            {speed}×
          </button>
        ))}
      </div>
      {showRecenter ? (
        <button
          type="button"
          onClick={() => replay.recenter()}
          aria-label="Re-center the camera on the marker"
          className="flex h-9 items-center gap-1.5 rounded-full bg-black/[0.06] px-3 text-[12px] font-semibold text-black/75"
        >
          <RecenterIcon />
          Re-center
        </button>
      ) : null}
    </div>
  )
}
