/**
 * Runtime self-calibration: the browser decides the compensation branches, so the
 * plugin never guesses engine behaviour.
 *
 * Two questions are measured in-page, once, while the pane is already zoomed:
 *  - fill: does the content root keep filling its column, or does its own box
 *    grow with the zoom (then `width: calc(100% / zoom)` restores it)?
 *  - fixed: are in-pane `position: fixed` descendants untouched (`native`),
 *    size-scaled only (`scaled`), or also re-anchored to the zoomed ancestor
 *    (`contained`, which additionally needs an origin translate)?
 *
 * Classifiers are pure functions over measurements; the surrounding routine only
 * inserts and removes a hidden probe. jsdom reports zero-size rects, which lands
 * on `fluid` + `native`: exactly the "no compensation" default.
 */
import { FIXED_OVERLAY_ATTRIBUTE, hasLayoutBox } from './targets.ts'

/** Body attribute carrying the fill branch. */
export const FILL_ATTRIBUTE = 'data-pane-scaling-fill'

/** Body attribute carrying the fixed-positioning branch. */
export const FIXED_ATTRIBUTE = 'data-pane-scaling-fixed'

/**
 * Per-pane fill gate forced by an explicit inline px width on that pane's root.
 * It is an element property, not an engine one, so it is written per pane and
 * only when it applies.
 * @param subject - the pane whose root carries the px width.
 * @returns the body attribute name.
 */
export const fillPaneAttribute = (subject: string): string => `data-pane-scaling-fill-${subject}`

/** Content root grows with the zoom and needs a width compensation. */
export type FillMode = 'fluid' | 'compensated'

/** How `position: fixed` descendants inside a zoomed pane behave. */
export type FixedMode = 'native' | 'scaled' | 'contained'

/** The subset of a DOM rect the classifiers use. */
export interface RectLike {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** The fixed probe's viewport offset, in px. */
export const PROBE_MARGIN_PX = 20

/** The fixed probe's own size, in px. */
export const PROBE_SIZE_PX = 10

/** Absolute geometry tolerance, in px. */
export const TOLERANCE_PX = 1

/** Relative geometry tolerance. */
export const TOLERANCE_RATIO = 0.02

/** Candidate in-pane fixed overlays: the host tooltip plus desktop-shell chrome. */
const OVERLAY_CANDIDATES = "[role='tooltip'], [class*='toggle'], [class*='newSession']"

/** Compare two lengths with an absolute floor and a relative allowance. */
function near(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= Math.max(TOLERANCE_PX, Math.abs(expected) * TOLERANCE_RATIO)
}

/** Fill-axis measurements. */
export interface FillProbeSample {
  readonly column: RectLike
  readonly root: RectLike
  /** The root's rect after an inline `width: calc(100% / zoom)` was applied. */
  readonly compensated: RectLike
}

/**
 * Decide the fill branch by trying the compensation and keeping the closer box.
 * @param sample - measured geometry.
 * @returns `compensated` when the inline width moves the root closer to its column.
 */
export function classifyFillProbe(sample: FillProbeSample): FillMode {
  if (!(sample.column.width > 0)) return 'fluid'
  const plain = Math.abs(sample.root.width - sample.column.width)
  const compensated = Math.abs(sample.compensated.width - sample.column.width)
  return compensated < plain - TOLERANCE_PX ? 'compensated' : 'fluid'
}

/** Fixed-positioning measurements. */
export interface FixedProbeSample {
  /** Zoom applied to the pane root when the probe was measured. */
  readonly zoom: number
  /** Probe rect inside the zoomed root, before compensation. */
  readonly scaled: RectLike
  /** Probe rect after an inline `zoom: 1 / zoom` was applied. */
  readonly countered: RectLike
  /** The marked root's rect at that zoom. */
  readonly root: RectLike
}

/**
 * Classify how fixed descendants behave inside the zoomed pane.
 * @param sample - measured geometry.
 * @returns the compensation branch; unusable measurements mean `native`.
 */
export function classifyFixedProbe(sample: FixedProbeSample): FixedMode {
  if (!(sample.zoom > 0) || !(sample.root.width > 0)) return 'native'
  // Untouched: a fixed box stays its own size.
  if (near(sample.scaled.width, PROBE_SIZE_PX)) return 'native'
  // If the counter-zoom cannot restore the size, no compensation rule can help.
  if (!near(sample.countered.width, PROBE_SIZE_PX)) return 'native'
  // Size-scaled but still anchored to the viewport.
  if (near(sample.scaled.x, PROBE_MARGIN_PX) && near(sample.scaled.y, PROBE_MARGIN_PX)) return 'scaled'
  return 'contained'
}

/** DOM operations `calibrate` needs; injectable so the routine stays testable. */
export interface ProbeEnvironment {
  create(tag: 'div'): HTMLElement
  attach(parent: HTMLElement, probe: HTMLElement): void
  detach(probe: HTMLElement): void
  rect(element: Element): RectLike
  readStyle(element: HTMLElement, property: string): string
  setStyle(element: HTMLElement, property: string, value: string): void
}

/**
 * The real-DOM probe environment.
 * @param doc - the product document.
 * @returns an environment that creates real, invisible probe nodes.
 */
export function domProbeEnvironment(doc: Document): ProbeEnvironment {
  return {
    create: tag => doc.createElement(tag),
    attach: (parent, probe) => { parent.append(probe) },
    detach: probe => { probe.remove() },
    rect: (element) => {
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    },
    readStyle: (element, property) => element.style.getPropertyValue(property),
    setStyle: (element, property, value) => {
      if (value === '') element.style.removeProperty(property)
      else element.style.setProperty(property, value)
    },
  }
}

/** What the engine publishes after a calibration run. */
export interface CalibrationResult {
  readonly fill: FillMode
  readonly fixed: FixedMode
  /** Origin values for contained mode, measured at the current zoom. */
  readonly origin: { readonly x: number, readonly y: number }
  /** Raw measurements, logged once so a wrong compensation can be corrected from data. */
  readonly payload: Readonly<Record<string, unknown>>
}

/** Nearest ancestor with a real layout box; slot seams (`display: contents`) are skipped. */
function boxedAncestor(element: Element): HTMLElement | undefined {
  let current = element.parentElement
  while (current !== null) {
    if (hasLayoutBox(current)) return current
    current = current.parentElement
  }
  return undefined
}

/**
 * Measure both branches inside an already-zoomed pane root.
 * @param root - the marked pane content root.
 * @param zoom - the zoom currently applied to `root`.
 * @param env - probe environment (real DOM by default).
 * @returns the decided branches, the origin values, and the raw measurements.
 */
export function calibrate(root: HTMLElement, zoom: number, env: ProbeEnvironment): CalibrationResult {
  // The root's parent may be a `display: contents` slot seam, which has no box to
  // compare against; the reference box is the nearest real ancestor.
  const column = boxedAncestor(root) ?? root
  const columnRect = env.rect(column)
  const rootRect = env.rect(root)
  const previousWidth = env.readStyle(root, 'width')
  let compensatedRect: RectLike = rootRect
  try {
    env.setStyle(root, 'width', `calc(100% / ${zoom})`)
    compensatedRect = env.rect(root)
  } finally {
    env.setStyle(root, 'width', previousWidth)
  }
  const fill = classifyFillProbe({ column: columnRect, root: rootRect, compensated: compensatedRect })

  const probe = env.create('div')
  env.setStyle(probe, 'position', 'fixed')
  env.setStyle(probe, 'left', `${PROBE_MARGIN_PX}px`)
  env.setStyle(probe, 'top', `${PROBE_MARGIN_PX}px`)
  env.setStyle(probe, 'width', `${PROBE_SIZE_PX}px`)
  env.setStyle(probe, 'height', `${PROBE_SIZE_PX}px`)
  env.setStyle(probe, 'visibility', 'hidden')
  env.setStyle(probe, 'pointer-events', 'none')
  env.attach(root, probe)
  let scaled: RectLike
  let countered: RectLike
  try {
    scaled = env.rect(probe)
    env.setStyle(probe, 'zoom', String(1 / zoom))
    countered = env.rect(probe)
  } finally {
    env.detach(probe)
  }
  const measuredRoot = env.rect(root)
  const fixed = classifyFixedProbe({ zoom, scaled, countered, root: measuredRoot })

  return {
    fill,
    fixed,
    origin: { x: measuredRoot.x, y: measuredRoot.y },
    payload: { zoom, column: columnRect, root: measuredRoot, compensated: compensatedRect, scaled, countered, fill, fixed },
  }
}

/**
 * Re-apply the in-pane fixed-overlay marks. Only elements that really compute to
 * `position: fixed` are marked, so class-name candidates that happen to be
 * ordinary flow buttons are never counter-scaled.
 * @param owned - marks written by the previous call.
 * @param roots - the marked pane roots to scan.
 * @param view - the window used for computed styles.
 * @returns the marks now held.
 */
export function syncFixedOverlays(
  owned: ReadonlySet<HTMLElement>,
  roots: readonly HTMLElement[],
  view: Window | undefined,
): Set<HTMLElement> {
  const next = new Set<HTMLElement>()
  for (const root of roots) {
    for (const candidate of root.querySelectorAll(OVERLAY_CANDIDATES)) {
      if (!(candidate instanceof HTMLElement)) continue
      const position = view?.getComputedStyle(candidate).position ?? candidate.style.position
      if (position !== 'fixed') continue
      if (!candidate.hasAttribute(FIXED_OVERLAY_ATTRIBUTE)) candidate.setAttribute(FIXED_OVERLAY_ATTRIBUTE, '')
      next.add(candidate)
    }
  }
  for (const element of owned) {
    if (next.has(element)) continue
    if (element.getAttribute(FIXED_OVERLAY_ATTRIBUTE) === '') element.removeAttribute(FIXED_OVERLAY_ATTRIBUTE)
  }
  return next
}

/**
 * Drop every fixed-overlay mark this owner holds.
 * @param owned - marks written by the previous call.
 */
export function clearFixedOverlays(owned: ReadonlySet<HTMLElement>): void {
  for (const element of owned) {
    if (element.getAttribute(FIXED_OVERLAY_ATTRIBUTE) === '') element.removeAttribute(FIXED_OVERLAY_ATTRIBUTE)
  }
}
