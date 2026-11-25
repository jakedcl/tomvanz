import {easeToward} from './camera-follow'

/**
 * Smooths a reading that jumps around from frame to frame: the ground height under a moving marker changes by a few
 * meters as map tiles refine, and by hundreds when a terrain tile finally loads (it reads as sea level until then).
 * Everything glides; only `reset()` (the replay jumped somewhere else) makes the next reading go straight through.
 */
export class LowPass {
  private value: number | null = null

  constructor(private readonly tauSeconds = 0.2) {}

  next(target: number, dtSeconds: number): number {
    this.value = this.value === null ? target : easeToward(this.value, target, dtSeconds, this.tauSeconds)
    return this.value
  }

  reset() {
    this.value = null
  }
}
