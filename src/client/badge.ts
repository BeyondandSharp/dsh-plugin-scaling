/** Transient percentage badge: the plugin's only visible surface. */
import type { PluginCopy } from './copy.ts'
import type { SlotId } from './targets.ts'

/** Attribute identifying the badge element. */
export const BADGE_ATTRIBUTE = 'data-pane-scaling-badge'

/** Attribute gating the badge's visible styles. */
export const BADGE_VISIBLE_ATTRIBUTE = 'data-pane-scaling-badge-visible'

/** How long the badge stays visible after a change. */
export const BADGE_VISIBLE_MS = 1200

/** The badge handle owned by the engine. */
export interface Badge {
  /** Show the current slot's percentage; the first call also adds the reset hint. */
  show(slot: SlotId, zoom: number): void
  /** Remove the element and any pending timer. */
  dispose(): void
}

/**
 * Create the lazily-mounted badge.
 * @param doc - the product document (the badge lives on `body`, outside every pane).
 * @param copy - localized strings.
 * @returns the badge handle.
 */
export function createBadge(doc: Document, copy: PluginCopy): Badge {
  let element: HTMLDivElement | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let hinted = false

  const ensure = (): HTMLDivElement => {
    if (element !== undefined) return element
    element = doc.createElement('div')
    element.setAttribute(BADGE_ATTRIBUTE, '')
    element.setAttribute('role', 'status')
    element.setAttribute('aria-live', 'polite')
    doc.body.append(element)
    return element
  }

  const hide = (): void => {
    timer = undefined
    element?.removeAttribute(BADGE_VISIBLE_ATTRIBUTE)
  }

  return {
    show(slot, zoom) {
      const node = ensure()
      const text = `${copy.slot(slot)} ${copy.percent(zoom)}`
      node.textContent = hinted ? text : `${text} · ${copy.resetHint}`
      hinted = true
      node.setAttribute(BADGE_VISIBLE_ATTRIBUTE, '')
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(hide, BADGE_VISIBLE_MS)
    },
    dispose() {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      element?.remove()
      element = undefined
    },
  }
}
