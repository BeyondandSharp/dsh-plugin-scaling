/**
 * Scaling mechanism: which CSS property actually scales a pane.
 *
 * `zoom` is the default and the cheapest mechanism: one declaration scales
 * layout, paint and hit-testing together, and the frozen sidebar width, the
 * drag handles and the fixed-overlay calibration were all written around it.
 *
 * Gecko implements `zoom` as a layout-time scale that is *not* applied to the
 * `border-image` nine-piece geometry (verified on Firefox 132 and 141; Blink
 * 131 and 140 scale it correctly): inside a zoomed pane every `border-image`
 * is laid out from its unzoomed border box, so the trailing edge region
 * absorbs the difference and is stretched. A skin ribbon drawn from symmetric
 * artwork therefore renders with a correct leading cap and a stretched
 * trailing cap — the same asset at two different scales on the left and right
 * of the sidebar, and the composer's nine-piece frame breaking apart.
 * `transform: scale()` scales the painted result and renders that geometry
 * correctly on both engines, so Gecko defaults to it.
 *
 * What a transform must not cover is a pane's own toolbar. The engine stamps
 * the arm on the element a pane really scales (`scaledElementFor`), which for
 * a pane that also holds its toolbar — the conversation header — is the
 * content below that toolbar. A transform over the toolbar itself (identity or
 * not) re-anchors its `position: fixed` chrome and hid the header's corner
 * controls in a real Gecko session; the host documents the same hazard for
 * that column. The stored key still forces either mechanism:
 *
 * ```js
 * localStorage['dsh.plugin-scaling.mechanism'] = 'zoom' | 'transform' | 'auto'
 * ```
 */

/** How a pane's content root is scaled. */
export type ScaleMechanism = 'zoom' | 'transform'

/** Stored values, including the engine probe. */
export type MechanismSetting = ScaleMechanism | 'auto'

/** Body attribute carrying the mechanism the engine selected. */
export const MECHANISM_ATTRIBUTE = 'data-pane-scaling-mechanism'

/** Storage key holding the opt-in: `zoom`, `transform`, or `auto`. */
export const MECHANISM_KEY = 'dsh.plugin-scaling.mechanism'

/** The storage slice this module needs. */
export interface MechanismStore {
  getItem(key: string): string | null
}

/** Gecko-only feature probe; false everywhere else (including jsdom). */
const GECKO_FEATURE: readonly [property: string, value: string] = ['-moz-appearance', 'none']

/** Fallback signal for a Gecko build that drops the prefixed property. */
const GECKO_USER_AGENT = /(?:^|\W)Firefox\/\d/u

/** The slice of `Window` the probe reads; kept structural so tests can fake it. */
interface ProbeHost {
  readonly CSS?: { supports(property: string, value: string): boolean }
  readonly navigator?: { readonly userAgent?: string }
}

/** Whether this engine is Gecko, whose `zoom` skips `border-image` geometry. */
export function isGecko(view: Window | undefined): boolean {
  const host = view as unknown as ProbeHost | undefined
  const css = host?.CSS
  if (css !== undefined && typeof css.supports === 'function' && css.supports(...GECKO_FEATURE)) return true
  return GECKO_USER_AGENT.test(host?.navigator?.userAgent ?? '')
}

/**
 * Read the stored opt-in.
 * @param store - the plugin's storage, or undefined when unavailable.
 * @returns the stored setting, or undefined when absent or unrecognized.
 */
export function readMechanismSetting(store: MechanismStore | undefined): MechanismSetting | undefined {
  if (store === undefined) return undefined
  try {
    const raw = store.getItem(MECHANISM_KEY)?.trim().toLowerCase()
    return raw === 'zoom' || raw === 'transform' || raw === 'auto' ? raw : undefined
  } catch (_error) {
    return undefined
  }
}

/**
 * Pick the mechanism this engine can render correctly.
 *
 * Runs once, at activation, before any pane is scaled: the stylesheet is
 * gated on {@link MECHANISM_ATTRIBUTE}, so the decision has to be on `body`
 * before the first zoom value reaches a pane.
 * @param view - the product window; a window without `CSS.supports` keeps `zoom`.
 * @param override - test seam; production callers pass nothing.
 * @returns `transform` on Gecko, `zoom` everywhere else, unless the stored key
 * forces one of them.
 */
export function probeScaleMechanism(view: Window | undefined, override?: ScaleMechanism): ScaleMechanism {
  if (override !== undefined) return override
  const setting = readMechanismSetting(storageOf(view))
  if (setting === 'transform') return 'transform'
  if (setting === 'zoom') return 'zoom'
  return isGecko(view) ? 'transform' : 'zoom'
}

/** The window's `localStorage`, or undefined when the accessor throws. */
function storageOf(view: Window | undefined): MechanismStore | undefined {
  if (view === undefined) return undefined
  try {
    return view.localStorage ?? undefined
  } catch (_error) {
    return undefined
  }
}
