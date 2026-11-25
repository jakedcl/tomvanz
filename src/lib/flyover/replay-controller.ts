import {
  defaultReplaySpeed,
  sampleReplay,
  timeAtDistance,
  type ReplaySample,
  type ReplaySpeed,
  type ReplayTrack,
} from './replay-track'

/** What the controls need to know: changes rarely (not every frame). */
export type ReplayState = {
  /** A path is loaded and can be replayed. */
  hasTrack: boolean
  kind: 'flight' | 'route' | null
  playing: boolean
  speed: ReplaySpeed
  /** The marker is on the map (once played or scrubbed). */
  visible: boolean
  /** The camera is following the marker. */
  following: boolean
  /** The person turned motion down, so the camera never follows by itself. */
  reducedMotion: boolean
  durationSeconds: number
}

/** One tick of the replay, many times a second while playing. */
export type ReplayFrame = ReplaySample & {
  playing: boolean
  visible: boolean
  kind: 'flight' | 'route'
  /** Where the path starts, so a flight's height can be measured from the ground there. */
  start: {lng: number; lat: number}
  speed: ReplaySpeed
}

type Deps = {
  now?: () => number
  raf?: (callback: () => void) => number
  caf?: (id: number) => void
}

const IDLE_STATE: ReplayState = {
  hasTrack: false,
  kind: null,
  playing: false,
  speed: 1,
  visible: false,
  following: true,
  reducedMotion: false,
  durationSeconds: 0,
}

/**
 * The replay of one path: a clock, a speed, a position, and who is watching. It knows nothing about the map or
 * React. The map draws the marker and moves the camera from its frames; the panel shows its controls from its
 * state. Dragging the elevation or altitude profile calls the `seek` methods, which pause it.
 */
export class ReplayController {
  private track: ReplayTrack | null = null
  private t = 0
  private state: ReplayState = IDLE_STATE
  private frameListeners = new Set<(frame: ReplayFrame) => void>()
  private stateListeners = new Set<() => void>()
  private endedListeners = new Set<() => void>()
  private rafId: number | null = null
  private lastNow = 0
  private holdUntil = 0
  private readonly now: () => number
  private readonly raf: (callback: () => void) => number
  private readonly caf: (id: number) => void

  constructor(deps: Deps = {}) {
    this.now = deps.now ?? (() => performance.now())
    this.raf = deps.raf ?? ((callback) => requestAnimationFrame(callback))
    this.caf = deps.caf ?? ((id) => cancelAnimationFrame(id))
  }

  getState(): ReplayState {
    return this.state
  }

  getTrack(): ReplayTrack | null {
    return this.track
  }

  /** The current position, or null with no path loaded. */
  getFrame(): ReplayFrame | null {
    if (!this.track) return null
    return {
      ...sampleReplay(this.track, this.t),
      playing: this.state.playing,
      visible: this.state.visible,
      kind: this.track.kind,
      start: this.track.start,
      speed: this.state.speed,
    }
  }

  subscribeFrames(listener: (frame: ReplayFrame) => void): () => void {
    this.frameListeners.add(listener)
    return () => void this.frameListeners.delete(listener)
  }

  subscribeState(listener: () => void): () => void {
    this.stateListeners.add(listener)
    return () => void this.stateListeners.delete(listener)
  }

  /** Called when a replay plays all the way to its end (not when it's paused, scrubbed, closed or reloaded). */
  subscribeEnded(listener: () => void): () => void {
    this.endedListeners.add(listener)
    return () => void this.endedListeners.delete(listener)
  }

  /** Loads a new path (or none). Everything starts over, paused, at the speed that suits its length. */
  load(track: ReplayTrack | null) {
    this.stopLoop()
    this.track = track
    this.t = 0
    this.setState(
      track
        ? {
            ...IDLE_STATE,
            hasTrack: true,
            kind: track.kind,
            speed: defaultReplaySpeed(track.durationSeconds),
            durationSeconds: track.durationSeconds,
            reducedMotion: this.state.reducedMotion,
          }
        : {...IDLE_STATE, reducedMotion: this.state.reducedMotion},
    )
    this.emitFrame()
  }

  play() {
    if (!this.track) return
    if (this.t >= this.track.durationSeconds - 0.05) this.t = 0
    this.holdUntil = 0
    this.setState({...this.state, playing: true, visible: true, following: !this.state.reducedMotion})
    this.lastNow = this.now()
    this.startLoop()
    this.emitFrame()
  }

  /**
   * Keeps the clock still for a moment even though it is playing (frames still go out). The camera uses it to
   * fly in to the start before the marker sets off.
   */
  hold(milliseconds: number) {
    this.holdUntil = milliseconds > 0 ? this.now() + milliseconds : 0
  }

  pause() {
    this.holdUntil = 0
    if (!this.state.playing) return
    this.stopLoop()
    this.setState({...this.state, playing: false})
    this.emitFrame()
  }

  toggle() {
    if (this.state.playing) this.pause()
    else this.play()
  }

  setSpeed(speed: ReplaySpeed) {
    if (speed === this.state.speed) return
    this.setState({...this.state, speed})
  }

  /** Jump to a time (seconds from the start). Pauses, and shows the marker. */
  seekSeconds(seconds: number) {
    if (!this.track) return
    this.stopLoop()
    this.t = Math.min(this.track.durationSeconds, Math.max(0, seconds))
    this.setState({...this.state, playing: false, visible: true})
    this.emitFrame()
  }

  seekFraction(fraction: number) {
    if (!this.track) return
    this.seekSeconds(Math.min(1, Math.max(0, fraction)) * this.track.durationSeconds)
  }

  seekMeters(meters: number) {
    if (!this.track) return
    this.seekSeconds(timeAtDistance(this.track, meters))
  }

  /** The person moved the camera themselves: stop following until they ask. */
  releaseCamera() {
    if (!this.state.following) return
    this.setState({...this.state, following: false})
  }

  /** The "re-center" button. */
  recenter() {
    if (this.state.reducedMotion || this.state.following) return
    this.setState({...this.state, following: true})
    this.emitFrame()
  }

  setReducedMotion(reduced: boolean) {
    if (reduced === this.state.reducedMotion) return
    this.setState({...this.state, reducedMotion: reduced, following: reduced ? false : this.state.following})
  }

  /** Takes the marker off the map and pauses, but keeps the path. */
  hide() {
    this.stopLoop()
    this.t = 0
    this.setState({...this.state, playing: false, visible: false, following: !this.state.reducedMotion})
    this.emitFrame()
  }

  dispose() {
    this.stopLoop()
    this.frameListeners.clear()
    this.stateListeners.clear()
    this.endedListeners.clear()
  }

  private setState(next: ReplayState) {
    const changed = (Object.keys(next) as (keyof ReplayState)[]).some((key) => next[key] !== this.state[key])
    this.state = next
    if (changed) for (const listener of [...this.stateListeners]) listener()
  }

  private emitFrame() {
    const frame = this.getFrame()
    if (!frame) return
    for (const listener of [...this.frameListeners]) listener(frame)
  }

  private startLoop() {
    if (this.rafId !== null) return
    const tick = () => {
      this.rafId = null
      if (!this.track || !this.state.playing) return
      const now = this.now()
      if (now < this.holdUntil) {
        this.lastNow = now
        this.emitFrame()
        this.rafId = this.raf(tick)
        return
      }
      // A slow frame or a background tab shouldn't make it leap: take at most a quarter second.
      const elapsed = Math.min(0.25, Math.max(0, (now - this.lastNow) / 1000))
      this.lastNow = now
      this.t += elapsed * this.state.speed
      if (this.t >= this.track.durationSeconds) {
        this.t = this.track.durationSeconds
        this.setState({...this.state, playing: false})
        this.emitFrame()
        for (const listener of [...this.endedListeners]) listener()
        return
      }
      this.emitFrame()
      this.rafId = this.raf(tick)
    }
    this.rafId = this.raf(tick)
  }

  private stopLoop() {
    this.holdUntil = 0
    if (this.rafId !== null) this.caf(this.rafId)
    this.rafId = null
  }
}
