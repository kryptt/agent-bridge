import { describe, it, expect } from 'vitest'
import { clampPollMinutes } from '../inbox.js'

describe('clampPollMinutes', () => {
  it('clamps to [1, 15] and passes through valid values', () => {
    expect(clampPollMinutes(0.5)).toBe(1)
    expect(clampPollMinutes(1)).toBe(1)
    expect(clampPollMinutes(15)).toBe(15)
    expect(clampPollMinutes(5)).toBe(5)
    expect(clampPollMinutes(30)).toBe(15)
  })
})
