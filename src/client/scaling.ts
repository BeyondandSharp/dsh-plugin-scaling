/**
 * Pane-scaling engine: pane marking, zoom variables, gestures, keyboard access,
 * one-time self-calibration, and a teardown that leaves no trace.
 *
 * Every handle is registered with the disposer at creation time, so a failure
 * halfway through activation still unwinds completely.
 */
import { createBadge } from './badge.ts'
import {
  FIXED_ATTRIBUTE, FILL_ATTRIBUTE, calibrate, clearFixedOverlays, domProbeEnvironment, syncFixedOverlays,
} from './calibration.ts'
import type { FillMode, FixedMode, ProbeEnvironment } from './calibration.ts'
import { copyFor } from './copy.ts'
import { createGestureState, installGestures } from './gestures.ts'
import { installShortcuts } from './shortcuts.ts'
import {
  DEFAULT_STEP, clampStep, localStorageOf, readZoom, stepToZoom, writeZoom,
} from './storage.ts'
import type { ZoomSteps } from './storage.ts'
import {
  PANE_IDS, clearTargetMarks, isExcludedSurface, isPaneStructureChange, paneOfNode,
  resolvePaneTargets, syncTargetMarks,
} from './targets.ts'
import type { PaneId } from './targets.ts'

/** Body attribute marking the plugin as active; scopes every static rule. */
export const ACTIVE_ATTRIBUTE = 'data-dsh-plugin-scaling'

/** Inline zoom factor for one pane, read by the pane rules. */
export const zoomVariable = (pane: PaneId): string => `--pane-scaling-${pane}`

/** Numeric reverse zoom for the pane's fixed overlays. */
export const counterVariable = (pane: PaneId): string => `--pane-scaling-counter-${pane}`

/** Measured pane origin x, used by the contained-mode translate. */
export const originXVariable = (pane: PaneId): string => `--pane-scaling-origin-x-${pane}`

/** Measured pane origin y, used by the contained-mode translate. */
export const originYVariable = (pane: PaneId): string => `--pane-scaling-origin-y-${pane}`

/** Test seams; production callers pass nothing. */
export interface InstallOptions {
  /** Overrides the CSS `zoom` capability probe. */
  supportsZoom?: boolean
  /** Replaces the real-DOM probe environment (tests). */
  probe?: ProbeEnvironment
  /** Replaces the rAF coalescer (tests run it manually). */
  schedule?: (callback: () => void) => void
  /** Diagnostic sink for failures. */
  warn?: (message: string, error?: unknown) => void
  /** Sink for the one-time calibration payload. */
  report?: (message: string, payload: unknown) => void
}

/** Reverse zoom, rounded so repeated writes are byte-identical. */
function counterOf(zoom: number): string {
  return String(Number((1 / zoom).toFixed(6)))
}

/**
 * Install the engine.
 * @param target - the element the plugin mounts on (the host passes `document.body`).
 * @param ctx - the plugin's cordis context, read for the optional `shortcuts` service.
 * @param options - test seams and diagnostic overrides.
 * @returns the disposer; calling it restores the document exactly.
 */
export function installPaneScaling(target: HTMLElement, ctx: unknown, options: InstallOptions = {}): () => void {
  const doc = target.ownerDocument
  const view = doc.defaultView ?? undefined
  const warn = options.warn ?? ((message: string, error?: unknown) => { console.warn(message, error) })
  const report = options.report ?? ((message: string, payload: unknown) => { console.info(message, payload) })
  const supported = options.supportsZoom
    ?? (typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('zoom', '1.2'))
  if (!supported) {
    warn('pane scaling: this engine does not support CSS zoom, so the plugin stays inactive')
    return () => {}
  }

  const disposers: Array<() => void> = []
  const undo: Array<() => void> = []
  const sweepStyles = (element: HTMLElement, names: readonly string[]): void => {
    const previous = names.map(name => element.style.getPropertyValue(name))
    undo.push(() => {
      names.forEach((name, index) => {
        const value = previous[index] ?? ''
        if (value === '') element.style.removeProperty(name)
        else element.style.setProperty(name, value)
      })
    })
  }
  const setStyle = (element: HTMLElement, name: string, value: string): void => {
    if (element.style.getPropertyValue(name) === value) return
    element.style.setProperty(name, value)
  }
  const setAttribute = (element: Element, name: string, value: string): void => {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value)
  }

  const html = doc.documentElement
  const zoomNames = PANE_IDS.map(pane => zoomVariable(pane))
  const counterNames = PANE_IDS.map(pane => counterVariable(pane))
  const originNames = [
    ...PANE_IDS.map(pane => originXVariable(pane)),
    ...PANE_IDS.map(pane => originYVariable(pane)),
  ]
  sweepStyles(html, [...zoomNames, ...counterNames, ...originNames])

  const store = localStorageOf(view)
  const steps: ZoomSteps = readZoom(store)
  const apply = (pane: PaneId, step: number): void => {
    const zoom = stepToZoom(step)
    setStyle(html, zoomVariable(pane), String(zoom))
    setStyle(html, counterVariable(pane), counterOf(zoom))
  }
  for (const pane of PANE_IDS) apply(pane, steps[pane])

  setAttribute(target, ACTIVE_ATTRIBUTE, '')
  undo.push(() => {
    if (target.getAttribute(ACTIVE_ATTRIBUTE) === '') target.removeAttribute(ACTIVE_ATTRIBUTE)
  })

  let fill: FillMode = 'fluid'
  let fixed: FixedMode = 'native'
  let calibrated = false
  setAttribute(target, FILL_ATTRIBUTE, fill)
  setAttribute(target, FIXED_ATTRIBUTE, fixed)
  undo.push(() => {
    target.removeAttribute(FILL_ATTRIBUTE)
    target.removeAttribute(FIXED_ATTRIBUTE)
  })

  let marks = new Map<HTMLElement, PaneId>()
  let overlays = new Set<HTMLElement>()

  const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => { scheduleSync() })
  const observer = typeof MutationObserver === 'undefined'
    ? undefined
    : new MutationObserver((records) => { if (isPaneStructureChange(records)) scheduleSync() })

  const refreshOrigins = (): void => {
    if (fixed !== 'contained') return
    for (const [element, pane] of marks) {
      const rect = element.getBoundingClientRect()
      setStyle(html, originXVariable(pane), `${rect.x}px`)
      setStyle(html, originYVariable(pane), `${rect.y}px`)
    }
  }

  const observeRoots = (): void => {
    resizeObserver?.disconnect()
    for (const element of marks.keys()) resizeObserver?.observe(element)
  }

  const sync = (): void => {
    marks = syncTargetMarks(marks, resolvePaneTargets(doc))
    overlays = fixed === 'native'
      ? overlays
      : syncFixedOverlays(overlays, [...marks.keys()], view)
    observeRoots()
  }

  const schedule = options.schedule ?? ((callback: () => void) => {
    if (view?.requestAnimationFrame !== undefined) view.requestAnimationFrame(() => { callback() })
    else setTimeout(callback, 0)
  })
  let scheduled = false
  const scheduleSync = (): void => {
    if (scheduled) return
    scheduled = true
    schedule(() => {
      scheduled = false
      sync()
      if (fixed === 'contained') refreshOrigins()
    })
  }

  observer?.observe(target, { childList: true, subtree: true })
  view?.addEventListener('resize', scheduleSync)
  disposers.push(() => {
    observer?.disconnect()
    resizeObserver?.disconnect()
    view?.removeEventListener('resize', scheduleSync)
  })

  const runCalibration = (pane: PaneId): void => {
    const root = [...marks].find(([, value]) => value === pane)?.[0]
    if (root === undefined) return
    try {
      const result = calibrate(root, stepToZoom(steps[pane]), options.probe ?? domProbeEnvironment(doc))
      fill = result.fill
      fixed = result.fixed
      calibrated = true
      setAttribute(target, FILL_ATTRIBUTE, fill)
      setAttribute(target, FIXED_ATTRIBUTE, fixed)
      sync()
      if (fixed === 'contained') refreshOrigins()
      report('pane scaling: calibration result', result.payload)
    } catch (error) {
      calibrated = true
      warn('pane scaling: calibration failed, continuing without compensation', error)
    }
  }

  const badge = createBadge(doc, copyFor(doc))
  disposers.push(() => { badge.dispose() })

  const step = (pane: PaneId, direction: 1 | -1 | 0): void => {
    const next = clampTarget(steps[pane], direction)
    if (next === steps[pane]) return
    steps[pane] = next
    apply(pane, next)
    writeZoom(store, steps)
    badge.show(pane, stepToZoom(next))
    if (!calibrated && next !== DEFAULT_STEP) runCalibration(pane)
    if (fixed === 'contained') refreshOrigins()
  }

  const gestureState = createGestureState()
  disposers.push(installGestures(doc, { step }, gestureState))

  const shortcuts = installShortcuts(doc, ctx, {
    paneFor: (node) => {
      if (isExcludedSurface(node)) return null
      return paneOfNode(node) ?? gestureState.pointerPane ?? 'center'
    },
    step,
  }, warn)
  disposers.push(() => { shortcuts.dispose() })

  sync()

  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose()
    clearTargetMarks(marks)
    marks.clear()
    clearFixedOverlays(overlays)
    overlays.clear()
    for (const restore of undo.splice(0).reverse()) restore()
  }
}

/** Clamp one step of movement; 0 always means "back to 100%". */
function clampTarget(current: number, direction: 1 | -1 | 0): number {
  return direction === 0 ? DEFAULT_STEP : clampStep(current + direction)
}
