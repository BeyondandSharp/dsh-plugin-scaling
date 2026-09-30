/**
 * Pane-scaling engine: pane marking, zoom variables, gestures, keyboard access,
 * one-time self-calibration, and a teardown that leaves no trace.
 *
 * Every handle is registered with the disposer at creation time, so a failure
 * halfway through activation still unwinds completely.
 */
import { createBadge } from './badge.ts'
import {
  FIXED_ATTRIBUTE, FILL_ATTRIBUTE, calibrate, clearFixedOverlays, domProbeEnvironment, fillPaneAttribute,
  fillWidthVariable, syncFixedOverlays,
} from './calibration.ts'
import type { FillMode, FixedMode, ProbeEnvironment } from './calibration.ts'
import { copyFor } from './copy.ts'
import { createGestureState, installGestures } from './gestures.ts'
import { MECHANISM_ATTRIBUTE, probeScaleMechanism } from './mechanism.ts'
import type { ScaleMechanism } from './mechanism.ts'
import { installShortcuts } from './shortcuts.ts'
import {
  DEFAULT_STEP, clampStep, localStorageOf, readZoom, stepToZoom, writeZoom,
} from './storage.ts'
import type { ZoomSteps } from './storage.ts'
import {
  COLUMN_PANES, SLOT_ATTRIBUTE, SLOT_IDS, TOOLBAR_SELECTOR, TRANSFORM_ATTRIBUTE, asSlotId, boxedDescendant,
  clearTargetMarks, inlinePixelWidth, isExcludedSurface, isPaneStructureChange, paneOfSlot, resolvePaneTargets,
  scaledElementFor, slotForTarget, syncTargetMarks,
} from './targets.ts'
import type { PaneId, SlotId } from './targets.ts'

/** Body attribute marking the plugin as active; scopes every static rule. */
export const ACTIVE_ATTRIBUTE = 'data-dsh-plugin-scaling'

/** Inline zoom factor for one slot, read by the slot rules. */
export const zoomVariable = (slot: SlotId): string => `--pane-scaling-${slot}`

/** Numeric reverse zoom for the slot's fixed overlays. */
export const counterVariable = (slot: SlotId): string => `--pane-scaling-counter-${slot}`

/** Measured slot origin x, used by the contained-mode translate. */
export const originXVariable = (slot: SlotId): string => `--pane-scaling-origin-x-${slot}`

/** Measured slot origin y, used by the contained-mode translate. */
export const originYVariable = (slot: SlotId): string => `--pane-scaling-origin-y-${slot}`

/** Test seams; production callers pass nothing. */
export interface InstallOptions {
  /** Overrides the CSS `zoom` capability probe. */
  supportsZoom?: boolean
  /** Overrides the scaling-mechanism probe (`zoom` or `transform`). */
  mechanism?: ScaleMechanism
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

  /*
   * Pick the scaling mechanism before anything else: the stylesheet gates its
   * `zoom` and `transform` arms on this attribute, so the body has to carry it
   * before the first zoom value reaches a pane. Engines whose `zoom` does not
   * scale `border-image` geometry get `transform: scale()` instead, which is
   * what keeps symmetric skin chrome (a `border-image` ribbon) at one scale.
   */
  const mechanism = probeScaleMechanism(view, options.mechanism)

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
  const clearStyle = (element: HTMLElement, name: string): void => {
    if (element.style.getPropertyValue(name) !== '') element.style.removeProperty(name)
  }
  const setAttribute = (element: Element, name: string, value: string): void => {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value)
  }

  const html = doc.documentElement
  const zoomNames = SLOT_IDS.map(slot => zoomVariable(slot))
  const counterNames = SLOT_IDS.map(slot => counterVariable(slot))
  const originNames = [
    ...SLOT_IDS.map(slot => originXVariable(slot)),
    ...SLOT_IDS.map(slot => originYVariable(slot)),
  ]
  const fillWidthNames = COLUMN_PANES.map(pane => fillWidthVariable(pane))
  sweepStyles(html, [...zoomNames, ...counterNames, ...originNames, ...fillWidthNames])

  const store = localStorageOf(view)
  const steps: ZoomSteps = readZoom(store)
  const apply = (slot: SlotId, step: number): void => {
    const zoom = stepToZoom(step)
    setStyle(html, zoomVariable(slot), String(zoom))
    setStyle(html, counterVariable(slot), counterOf(zoom))
  }
  for (const slot of SLOT_IDS) apply(slot, steps[slot])

  setAttribute(target, ACTIVE_ATTRIBUTE, '')
  undo.push(() => {
    if (target.getAttribute(ACTIVE_ATTRIBUTE) === '') target.removeAttribute(ACTIVE_ATTRIBUTE)
  })

  setAttribute(target, MECHANISM_ATTRIBUTE, mechanism)
  undo.push(() => {
    if (target.getAttribute(MECHANISM_ATTRIBUTE) === mechanism) target.removeAttribute(MECHANISM_ATTRIBUTE)
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

  /** Slot of a marked root, as stamped by the last {@link sync}. */
  const slotOfMarked = (element: Element): SlotId | null => asSlotId(element.getAttribute(SLOT_ATTRIBUTE))

  /**
   * Compensate the width of a pane whose root carries an explicit inline px
   * width (the left sidebar freezes its expanded width that way, and the value
   * is the host's own layout intent — it can differ from the column box during
   * the collapse slide). A px width is scaled by `zoom` under every engine's
   * semantics, so this is an element fact rather than the engine-wide `fill`
   * verdict the probe measures: the compensation follows the frozen value
   * (`frozen / zoom`) instead of a percentage of the containing block.
   */
  const forcedFill = new Set<PaneId>()
  const refreshForcedFill = (): void => {
    for (const pane of COLUMN_PANES) {
      const root = [...marks].find(([, value]) => value === pane)?.[0]
      const frozen = root === undefined ? undefined : inlinePixelWidth(root)
      const name = fillPaneAttribute(pane)
      if (frozen === undefined) {
        forcedFill.delete(pane)
        if (target.getAttribute(name) !== null) target.removeAttribute(name)
        clearStyle(html, fillWidthVariable(pane))
        continue
      }
      forcedFill.add(pane)
      setAttribute(target, name, 'compensated')
      setStyle(html, fillWidthVariable(pane), `${Number((frozen / stepToZoom(steps[pane])).toFixed(3))}px`)
    }
  }
  undo.push(() => {
    for (const pane of COLUMN_PANES) target.removeAttribute(fillPaneAttribute(pane))
  })

  const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => { scheduleSync() })
  const observer = typeof MutationObserver === 'undefined'
    ? undefined
    : new MutationObserver((records) => { if (isPaneStructureChange(records)) scheduleSync() })
  /**
   * Watches only the marked roots' inline styles. The sidebar rewrite of its
   * frozen width — a resize drag, the collapse slide, a layout restore — is an
   * attribute change, not a childList one, and the compensation has to follow
   * it live. Scoped to the three roots so the rest of the document's style
   * churn never reaches this callback.
   */
  const rootStyleObserver = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(() => { scheduleSync() })

  const refreshOrigins = (): void => {
    if (fixed !== 'contained') return
    for (const element of marks.keys()) {
      const slot = slotOfMarked(element)
      if (slot === null) continue
      const rect = element.getBoundingClientRect()
      setStyle(html, originXVariable(slot), `${rect.x}px`)
      setStyle(html, originYVariable(slot), `${rect.y}px`)
    }
  }

  const observeRoots = (): void => {
    resizeObserver?.disconnect()
    rootStyleObserver?.disconnect()
    for (const element of marks.keys()) {
      resizeObserver?.observe(element)
      rootStyleObserver?.observe(element, { attributes: true, attributeFilter: ['style'] })
    }
  }

  /**
   * Slots that always keep the `zoom` arm.
   *
   * A diff preview scales the content *inside* the host's card, and the card has
   * to grow to hold it: `zoom` scales the element's layout box, `transform` only
   * its painted output, which would let the diff spill out of the card's frame.
   */
  const ZOOM_ONLY_SLOTS: ReadonlySet<SlotId> = new Set<SlotId>(['preview'])

  /** The elements the transform arm currently stamped, for an exact cleanup. */
  let stamped = new Set<HTMLElement>()

  /** Inline variable holding the toolbar height a pane keeps at 1:1. */
  const toolbarVariable = (slot: SlotId): string => `--pane-scaling-toolbar-${slot}`

  /**
   * Publish the height each pane's toolbar keeps for itself. The transform arm
   * lays the scaled content out in `1 / zoom` of its box, but a toolbar that
   * stays at 1:1 inside the same flow keeps its own height: without this the
   * content box would run exactly one toolbar taller than the pane.
   *
   * Each variable is written once per refresh with its final value: a
   * placeholder write followed by the measured one would invalidate the whole
   * document's style twice, and the host's scroll/viewport observers pay for
   * every one of those.
   */
  const refreshToolbarHeights = (): void => {
    const heights = new Map<SlotId, number>()
    for (const [element] of marks) {
      const slot = slotOfMarked(element)
      if (slot === null) continue
      const toolbar = boxedDescendant(element.querySelector(TOOLBAR_SELECTOR))
      heights.set(slot, toolbar?.offsetHeight ?? 0)
    }
    for (const slot of SLOT_IDS) setStyle(html, toolbarVariable(slot), `${heights.get(slot) ?? 0}px`)
  }

  /**
   * Stamp the transform arm on the element each pane really scales, and only
   * while that pane is scaled at all.
   *
   * A pane whose root also holds its toolbar (the conversation header) is
   * stamped one level down, on the content below that toolbar
   * ({@link scaledElementFor}): the header then stays structurally outside the
   * transform — it keeps its own scale and its own containing block — while the
   * composer's `border-image` frame and the rest of the pane's chrome are
   * painted by the transform, which is the whole point of this arm.
   *
   * The identity case matters too: `transform: scale(1)` buys nothing and
   * costs a containing block plus a stacking context, which a real Gecko
   * session showed hiding the conversation header's corner controls at 100%.
   * Panes sitting at 100% therefore keep the untouched `zoom` arm — a no-op at
   * 1 anyway.
   */
  const refreshTransformMarks = (): void => {
    const next = new Set<HTMLElement>()
    for (const [element] of marks) {
      const slot = slotOfMarked(element)
      const armed = mechanism === 'transform'
        && slot !== null
        && steps[slot] !== DEFAULT_STEP
        && !ZOOM_ONLY_SLOTS.has(slot)
      if (!armed) continue
      const target = scaledElementFor(element)
      next.add(target)
      setAttribute(target, TRANSFORM_ATTRIBUTE, '')
    }
    for (const element of stamped) {
      if (!next.has(element) && element.getAttribute(TRANSFORM_ATTRIBUTE) === '') element.removeAttribute(TRANSFORM_ATTRIBUTE)
    }
    stamped = next
  }

  /** Whether a floating file preview is mounted and marked right now. */
  const previewMounted = (): boolean => [...marks.values()].includes('preview')

  /**
   * Drop a preview card's scale when it closes.
   *
   * The card is transient — it unmounts the moment the pointer leaves — so the
   * next card must open at 100% (and a stored value must not carry the previous
   * card's size into the next hover). Panes keep their value: they do not go
   * away, and their zoom is a preference rather than a transient reading aid.
   */
  const resetPreview = (): void => {
    steps.preview = DEFAULT_STEP
    apply('preview', DEFAULT_STEP)
    writeZoom(store, steps)
  }

  const sync = (): void => {
    const hadPreview = previewMounted()
    marks = syncTargetMarks(marks, resolvePaneTargets(doc))
    if (hadPreview && !previewMounted()) resetPreview()
    overlays = fixed === 'native'
      ? overlays
      : syncFixedOverlays(overlays, [...marks.keys()], view)
    refreshForcedFill()
    refreshToolbarHeights()
    refreshTransformMarks()
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
    rootStyleObserver?.disconnect()
    view?.removeEventListener('resize', scheduleSync)
  })

  /**
   * Whether a slot owns a grid-column pane rather than a floating surface.
   *
   * The one-time probe reads the host's own zoom surfaces and publishes the
   * engine-wide `fill`/`fixed` modes, and the frozen-width gate follows a host
   * inline width. Both are facts about a pane column: pointed at a hover card
   * they would publish a transient card's verdict for every pane.
   * @param slot - a slot id.
   * @returns whether the slot is a column pane.
   */
  const isColumnSlot = (slot: SlotId): boolean =>
    (COLUMN_PANES as readonly string[]).includes(paneOfSlot(slot))

  const runCalibration = (slot: SlotId): void => {
    if (!isColumnSlot(slot)) return
    const root = [...marks.keys()].find(element => slotOfMarked(element) === slot)
    if (root === undefined) return
    try {
      const result = calibrate(root, stepToZoom(steps[slot]), options.probe ?? domProbeEnvironment(doc))
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

  const step = (slot: SlotId, direction: 1 | -1 | 0): void => {
    const next = clampTarget(steps[slot], direction)
    if (next === steps[slot]) return
    steps[slot] = next
    apply(slot, next)
    // The host can (re)write its frozen inline width on any render, so the
    // forced gate is re-evaluated on every change instead of only on structure.
    refreshForcedFill()
    refreshToolbarHeights()
    refreshTransformMarks()
    writeZoom(store, steps)
    badge.show(slot, stepToZoom(next))
    if (!calibrated && next !== DEFAULT_STEP) runCalibration(slot)
    if (fixed === 'contained') refreshOrigins()
  }

  const gestureState = createGestureState()
  disposers.push(installGestures(doc, { step }, gestureState))

  const shortcuts = installShortcuts(doc, ctx, {
    slotFor: (node) => {
      if (isExcludedSurface(node)) return null
      const slot = slotForTarget(node, gestureState.pointerSlot)
      // A command with no pane under it still acts on the last used slot, then
      // on the centre pane, matching the documented focus fallback order.
      return slot ?? gestureState.pointerSlot ?? 'center'
    },
    step,
  }, warn)
  disposers.push(() => { shortcuts.dispose() })

  sync()

  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose()
    for (const element of stamped) {
      if (element.getAttribute(TRANSFORM_ATTRIBUTE) === '') element.removeAttribute(TRANSFORM_ATTRIBUTE)
    }
    stamped.clear()
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
