/**
 * Pointer gestures: Ctrl+wheel over a pane, plus the last-pointer pane cache
 * the keyboard path falls back to.
 *
 * The wheel listener is installed on `window` in the capture phase and must stay
 * non-passive so a hit can `preventDefault()`; Chromium treats non-passive
 * window listeners as blocking, so the handler's first lines are the two
 * cheapest possible tests and everything else happens after the hit check.
 */
import { isExcludedSurface, slotForTarget } from './targets.ts'
import type { SlotId } from './targets.ts'

/** Wheel units that add up to one 5% step. */
export const UNITS_PER_STEP = 100

/** Wheel units are dropped after this much idle time. */
export const WHEEL_IDLE_MS = 200

/** Callbacks the engine provides. */
export interface GestureHost {
  /** Apply one step to a slot: 1 zooms in, -1 out, 0 resets to 100%. */
  step(slot: SlotId, direction: 1 | -1 | 0): void
}

/** Mutable gesture state shared with the keyboard path. */
export interface GestureState {
  /** Slot of the last pointer interaction; null until the first one. */
  pointerSlot: SlotId | null
}

/**
 * Create the initial gesture state.
 * @returns a state with no remembered pointer pane.
 */
export function createGestureState(): GestureState {
  return { pointerSlot: null }
}

/** Normalize a wheel delta to "up is positive" device-independent units. */
function normalizeDelta(event: WheelEvent): number {
  const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1
  return -event.deltaY * factor
}

/**
 * Install the wheel and pointerdown listeners.
 * @param doc - the product document.
 * @param host - step sink.
 * @param state - pointer cache shared with the keyboard path.
 * @returns the disposer removing both listeners and any pending idle timer.
 */
export function installGestures(doc: Document, host: GestureHost, state: GestureState): () => void {
  const view = doc.defaultView
  if (view === null) return () => {}
  let residual = 0
  let lastSlot: SlotId | null = null
  let idle: ReturnType<typeof setTimeout> | undefined

  const clearResidual = (): void => {
    residual = 0
    lastSlot = null
    idle = undefined
  }

  const onWheel = (event: WheelEvent): void => {
    if (!event.ctrlKey && !event.metaKey) return
    const target = event.target instanceof Element ? event.target : null
    if (target === null || isExcludedSurface(target)) return
    // Skin chrome parked at column level is outside the marked root but still
    // belongs to the pane under the pointer: scale that pane — never the page.
    // A split right sidebar resolves to the column's own slot.
    const slot = slotForTarget(target, state.pointerSlot)
    if (slot === null) return
    event.preventDefault()
    state.pointerSlot = slot
    if (lastSlot !== slot) residual = 0
    lastSlot = slot
    residual += normalizeDelta(event)
    if (idle !== undefined) clearTimeout(idle)
    idle = setTimeout(clearResidual, WHEEL_IDLE_MS)
    const steps = Math.trunc(residual / UNITS_PER_STEP)
    if (steps === 0) return
    residual -= steps * UNITS_PER_STEP
    const direction: 1 | -1 = steps > 0 ? 1 : -1
    for (let index = 0; index < Math.abs(steps); index += 1) host.step(slot, direction)
  }

  const onPointerDown = (event: Event): void => {
    const target = event.target instanceof Element ? event.target : null
    if (target === null) return
    const slot = slotForTarget(target, state.pointerSlot)
    if (slot !== null) state.pointerSlot = slot
  }

  view.addEventListener('wheel', onWheel, { capture: true, passive: false })
  view.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true })
  return () => {
    if (idle !== undefined) clearTimeout(idle)
    idle = undefined
    view.removeEventListener('wheel', onWheel, { capture: true })
    view.removeEventListener('pointerdown', onPointerDown, { capture: true })
  }
}
