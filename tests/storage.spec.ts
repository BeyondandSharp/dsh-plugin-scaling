/** Zoom persistence: decoding, clamping, and hostile-storage tolerance. */
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_STEP, MIN_STEP, MAX_STEP, STORE_KEY, clampStep, decodeZoom, defaultSteps, encodeZoom,
  readZoom, stepToZoom, writeZoom, zoomToStep,
} from '../src/client/storage.ts'
import type { ZoomStore } from '../src/client/storage.ts'

/** A store whose reads and writes can be made to throw. */
function store(initial?: string): ZoomStore & { value: string | null } {
  return {
    value: initial ?? null,
    getItem(key: string) {
      expect(key).toBe(STORE_KEY)
      return this.value
    },
    setItem(key: string, value: string) {
      expect(key).toBe(STORE_KEY)
      this.value = value
    },
  }
}

describe('step scale', () => {
  it('anchors 100% at step 20 and stringifies exactly', () => {
    expect(DEFAULT_STEP).toBe(20)
    expect(stepToZoom(DEFAULT_STEP)).toBe(1)
    expect(String(stepToZoom(21))).toBe('1.05')
    expect(String(stepToZoom(15))).toBe('0.75')
    expect(String(stepToZoom(30))).toBe('1.5')
  })

  it('uses 5% steps across 75%–150%', () => {
    expect(MIN_STEP).toBe(15)
    expect(MAX_STEP).toBe(30)
    for (let step = MIN_STEP; step <= MAX_STEP; step += 1) {
      expect(zoomToStep(stepToZoom(step))).toBe(step)
    }
  })

  it('clamps and rejects non-finite values', () => {
    expect(clampStep(99)).toBe(MAX_STEP)
    expect(clampStep(-99)).toBe(MIN_STEP)
    expect(clampStep(Number.NaN)).toBe(DEFAULT_STEP)
    expect(clampStep(Number.POSITIVE_INFINITY)).toBe(DEFAULT_STEP)
    expect(clampStep(20.4)).toBe(20)
  })
})

describe('decodeZoom', () => {
  it('defaults when nothing is stored', () => {
    expect(decodeZoom(null)).toEqual(defaultSteps())
  })

  it('round-trips a stored document', () => {
    const steps = { left: 15, center: 21, right: 30 }
    expect(decodeZoom(encodeZoom(steps))).toEqual(steps)
  })

  it('pins the documented stored schema (zoom factors, not steps)', () => {
    expect(encodeZoom({ left: 21, center: 20, right: 15 })).toBe('{"left":1.05,"center":1,"right":0.75}')
  })

  it('ignores corrupt JSON, wrong shapes, and per-pane junk', () => {
    expect(decodeZoom('{')).toEqual(defaultSteps())
    expect(decodeZoom('null')).toEqual(defaultSteps())
    expect(decodeZoom('[1,2,3]')).toEqual(defaultSteps())
    expect(decodeZoom('{"left":"1.5","center":true}')).toEqual(defaultSteps())
    expect(decodeZoom('{"left":1.05}')).toEqual({ left: 21, center: 20, right: 20 })
  })

  it('clamps out-of-range stored values', () => {
    expect(decodeZoom('{"left":0.1,"center":5,"right":1.5}')).toEqual({ left: 15, center: 30, right: 30 })
    expect(decodeZoom('{"left":null}')).toEqual(defaultSteps())
  })
})

describe('readZoom / writeZoom', () => {
  it('round-trips through a store', () => {
    const target = store()
    const steps = { left: 17, center: 20, right: 25 }
    writeZoom(target, steps)
    expect(target.value).toBe('{"left":0.85,"center":1,"right":1.25}')
    expect(readZoom(target)).toEqual(steps)
  })

  it('degrades to defaults without a store', () => {
    expect(readZoom(undefined)).toEqual(defaultSteps())
    expect(() => { writeZoom(undefined, defaultSteps()) }).not.toThrow()
  })

  it('survives a throwing localStorage', () => {
    const throwing: ZoomStore = {
      getItem: vi.fn(() => { throw new Error('denied') }),
      setItem: vi.fn(() => { throw new Error('quota') }),
    }
    expect(readZoom(throwing)).toEqual(defaultSteps())
    expect(() => { writeZoom(throwing, defaultSteps()) }).not.toThrow()
  })
})
