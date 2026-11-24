import {describe, expect, it} from 'vitest'

import {formatDurationSeconds} from './format-duration'

describe('formatDurationSeconds', () => {
  it('rounds total seconds consistently', () => {
    expect(formatDurationSeconds(320.4)).toBe('5m 20s')
    expect(formatDurationSeconds(320.6)).toBe('5m 21s')
    expect(formatDurationSeconds(321)).toBe('5m 21s')
  })
})