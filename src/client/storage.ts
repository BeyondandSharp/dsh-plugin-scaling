/** Zoom persistence: one integer percent per slot, validated and clamped. */
import type { SlotId } from './targets.ts'

/** localStorage key owned by this plugin. */
export const STORE_KEY = 'dsh.plugin-scaling.v1'

/** 1%. */
export const MIN_STEP = 1

/** 500%. */
export const MAX_STEP = 500

/** 100%. */
export const DEFAULT_STEP = 100

/** A step index *is* a percentage, so every value in the range is reachable. */
const STEPS_PER_UNIT = 100

/** One integer percent per slot. */
export type ZoomSteps = Record<SlotId, number>

/** The storage slice this module needs; `undefined` degrades to memory only. */
export interface ZoomStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * Clamp and round a step index into the supported range.
 * @param value - candidate step index.
 * @returns an integer step in [MIN_STEP, MAX_STEP]; non-finite input yields 100%.
 */
export function clampStep(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_STEP
  return Math.min(MAX_STEP, Math.max(MIN_STEP, Math.round(value)))
}

/**
 * Convert a step index into the CSS `zoom` factor. `105 / 100` stringifies to
 * exactly `"1.05"`, so repeated same-value writes stay detectable.
 * @param step - integer percent.
 * @returns the zoom factor as a number.
 */
export function stepToZoom(step: number): number {
  return clampStep(step) / STEPS_PER_UNIT
}

/**
 * Convert a zoom factor into a clamped step index.
 * @param zoom - zoom factor in CSS `zoom` units.
 * @returns the nearest supported step index.
 */
export function zoomToStep(zoom: number): number {
  return clampStep(zoom * STEPS_PER_UNIT)
}

/**
 * A fresh 100% state: the three panes and the floating preview plus the right
 * sidebar's second dock column, which `ui-dockkit` can split out and which is
 * otherwise unused.
 * @returns the default step per slot.
 */
export function defaultSteps(): ZoomSteps {
  return {
    left: DEFAULT_STEP, center: DEFAULT_STEP, right: DEFAULT_STEP, 'right-1': DEFAULT_STEP,
    preview: DEFAULT_STEP,
  }
}

/**
 * Decode a stored document, falling back per slot on any malformed field.
 * Invalid JSON, a non-object root, missing slots, non-numbers, and
 * out-of-range values all degrade to 100% or a clamped step. Unknown keys are
 * ignored, so a newer document stays readable.
 * @param raw - the stored string, or null.
 * @returns decoded steps.
 */
export function decodeZoom(raw: string | null): ZoomSteps {
  const steps = defaultSteps()
  if (raw === null) return steps
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (_error) {
    return steps
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return steps
  const record = parsed as Record<string, unknown>
  for (const slot of Object.keys(steps) as SlotId[]) {
    const value = record[slot]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    steps[slot] = zoomToStep(value)
  }
  return steps
}

/**
 * Encode the state as zoom factors with a fixed key order, so the stored
 * document matches the documented schema (`{"left":1.05,...}`) and equal
 * states produce equal strings. `right-1` is always written: it is the second
 * right-dock column's value, applied whenever that column exists. So is
 * `preview`, the changed-files diff hover card's own value.
 * @param steps - the current state.
 * @returns the stored document.
 */
export function encodeZoom(steps: ZoomSteps): string {
  return JSON.stringify({
    left: stepToZoom(steps.left),
    center: stepToZoom(steps.center),
    right: stepToZoom(steps.right),
    'right-1': stepToZoom(steps['right-1']),
    preview: stepToZoom(steps.preview),
  })
}

/**
 * Read the stored state; a hostile or disabled `localStorage` yields defaults.
 * @param store - the storage implementation, or undefined when unavailable.
 * @returns decoded steps (never throws).
 */
export function readZoom(store: ZoomStore | undefined): ZoomSteps {
  if (store === undefined) return defaultSteps()
  try {
    return decodeZoom(store.getItem(STORE_KEY))
  } catch (_error) {
    return defaultSteps()
  }
}

/**
 * Persist the state; a failing write is ignored so the session stays usable.
 * @param store - the storage implementation, or undefined when unavailable.
 * @param steps - the current state.
 */
export function writeZoom(store: ZoomStore | undefined, steps: ZoomSteps): void {
  if (store === undefined) return
  try {
    store.setItem(STORE_KEY, encodeZoom(steps))
  } catch (_error) {
    // Quota or privacy-mode failures degrade to a memory-only session.
  }
}

/**
 * The browser's `localStorage`, or undefined when the accessor itself throws
 * (sandboxed iframes) — the caller then keeps state in memory.
 * @param window - the product window.
 * @returns a usable store, or undefined.
 */
export function localStorageOf(window: Window | undefined): ZoomStore | undefined {
  if (window === undefined) return undefined
  try {
    return window.localStorage ?? undefined
  } catch (_error) {
    return undefined
  }
}
