/**
 * Pane identity, DOM resolution, and the incremental mark lease.
 *
 * The three grid columns are never scaled themselves: each carries an inline
 * width (and the center track is `minmax(...)`), so zooming a column would
 * resize the track and push its neighbours around. Every target here is a
 * content root *inside* a column.
 */

/** The three independently scalable panes, in DOM order. */
export const PANE_IDS = ['left', 'center', 'right'] as const

/** One scalable pane. */
export type PaneId = (typeof PANE_IDS)[number]

/**
 * One independently scaled slot. The left sidebar and the centre window are one
 * slot each; the right sidebar's dock can be split into two columns
 * (`ui-dockkit` renders at most two), and each column is its own slot. Column 0
 * keeps the plain pane name so existing stored values stay valid.
 */
export type SlotId = PaneId | `right-${number}`

/**
 * Every slot the plugin tracks. `ui-dockkit` renders at most two right-sidebar
 * columns (`TabLayout` throws for any other docked shape), so the list is fixed;
 * `right-1` simply has no root while the right sidebar is unsplit.
 */
export const SLOT_IDS = ['left', 'center', 'right', 'right-1'] as const

/** Attribute stamped on each resolved pane content root. */
export const TARGET_ATTRIBUTE = 'data-pane-scaling-target'

/** Attribute stamped on each resolved slot root (a pane, or one right column). */
export const SLOT_ATTRIBUTE = 'data-pane-scaling-slot'

/** Marks an in-pane `position: fixed` overlay that needs counter-scaling. */
export const FIXED_OVERLAY_ATTRIBUTE = 'data-pane-scaling-fixed-overlay'

/** Attribute `ui-dockkit` puts on each docked compartment and its section. */
const DOCK_COLUMN_ATTRIBUTE = 'data-dockkit-column'

/**
 * Slot name for one pane column. Column 0 is the pane itself, later columns get
 * a suffix (`right-1`), so the default state needs no migration.
 * @param pane - the owning pane.
 * @param column - zero-based column index inside that pane.
 * @returns the slot id.
 */
export function slotId(pane: PaneId, column: number): SlotId {
  return column <= 0 ? pane : `${pane}-${column}`
}

/**
 * The pane a slot belongs to.
 * @param slot - a slot id.
 * @returns the owning pane, for engine-level (per-pane) decisions.
 */
export function paneOfSlot(slot: SlotId): PaneId {
  return slot.startsWith('right') ? 'right' : slot as PaneId
}

/**
 * CSS-module class names keep their local name (`[hash]_sidebarCol`), so a
 * class-substring selector is stable across hashes; the shell's own e2e tests
 * rely on the same convention.
 */
const COLUMN_SELECTORS: Readonly<Record<PaneId, string>> = {
  left: "[class*='sidebarCol']",
  center: "[class*='centerCol']",
  right: "[class*='rightbarCol']",
}

/**
 * Slot-tree anchors, most specific first; the first present one wins.
 *
 * For the sidebar these are *content* anchors inside the real root, not the
 * `[data-slot='sidebar']` seam itself: skins prepend their own chrome into that
 * seam (`maid-atelier` prepends a mascot and corner art), so a seam-only anchor
 * would let a decoration win the descent. The seam selector stays as the last
 * resort.
 */
const ANCHORS: Readonly<Record<'left' | 'center', readonly string[]>> = {
  left: [
    "[data-slot='sidebar.settings']",
    "[data-slot='sidebar.panellist']",
    "[role='tree']",
    "[class*='newSession']",
    "[data-slot='sidebar']",
  ],
  center: ['[data-conversation-scroll]'],
}

/** Docked right-sidebar compartments; `hidden` cells are unselected panes. */
const DOCK_PANE_SELECTOR = "[data-dockkit-host='dock']:not([hidden]) > section"
const DOCK_PANE_FALLBACK = "[data-sidebar-right-panel] [data-dockkit-pane]"

/** Subtrees that own their own Ctrl+wheel gesture and are never a target. */
const EXCLUDED_SELECTOR = '.xterm, [data-dockkit-float]'

/** Terminal screens keep their own wheel handling and never reflow for zoom. */
const TERMINAL_SELECTOR = '.xterm'

/** One resolved pane content root. */
export interface PaneTarget {
  readonly pane: PaneId
  /** The independently scaled slot this root belongs to. */
  readonly slot: SlotId
  readonly element: HTMLElement
}

/** Element nodes only; avoids cross-realm `instanceof` checks. */
function asElement(node: Element | null): Element | undefined {
  return node !== null && node.nodeType === 1 ? node : undefined
}

/** Read the used `display` value, tolerating a missing `getComputedStyle`. */
function displayOf(element: Element): string {
  const inline = (element as HTMLElement).style?.display
  if (inline === 'contents') return 'contents'
  const computed = element.ownerDocument.defaultView?.getComputedStyle(element).display
  return computed ?? inline ?? ''
}

/**
 * A slot seam is `display: contents`: it has no box, so it cannot be a zoom
 * target and must be stepped through.
 * @param element - candidate node.
 * @returns whether the node lays out a box of its own.
 */
export function hasLayoutBox(element: Element): boolean {
  const display = displayOf(element)
  return display !== 'contents' && display !== 'none' && display !== ''
}

/**
 * The element's own inline width when it is an explicit px length.
 *
 * The left sidebar root freezes its expanded width inline
 * (`SidebarRoot.tsx`: `style={{ width }}`) so the collapse slide does not
 * reflow its content. An explicit px width is scaled by `zoom` under every
 * engine's semantics — unlike a percentage or `auto` width — so such a root
 * always needs its width compensation, and the compensation has to follow that
 * frozen value (not the column's box) to keep the host's own layout intent.
 * @param element - candidate zoom target.
 * @returns the width in px, or undefined when the inline width is absent or not px.
 */
export function inlinePixelWidth(element: Element): number | undefined {
  const width = (element as HTMLElement).style?.getPropertyValue('width').trim() ?? ''
  if (!/^\d+(?:\.\d+)?px$/u.test(width)) return undefined
  const value = Number.parseFloat(width)
  return Number.isFinite(value) ? value : undefined
}

/**
 * Whether the element carries an explicit inline width in px.
 * @param element - candidate zoom target.
 * @returns true for `width: <number>px` in the element's own inline style.
 */
export function hasInlinePixelWidth(element: Element): boolean {
  return inlinePixelWidth(element) !== undefined
}

/**
 * Descend through `display: contents` seams to the boxed element that still
 * contains the anchor. Following the anchor's own path (instead of the first
 * boxed child) is what keeps skin chrome out: skins prepend their decorations
 * into the same seam as the real root, so "first child" would mark a mascot.
 * @param element - start node (usually a column's direct child).
 * @param anchor - the matched anchor inside that subtree.
 * @returns the boxed element containing the anchor, or undefined when absent.
 */
function boxedAncestorOfAnchor(element: Element, anchor: Element): Element | undefined {
  let current: Element | undefined = element
  while (current !== undefined && !hasLayoutBox(current)) {
    const next = [...current.children].find(child => child.contains(anchor))
    current = next ?? asElement(current.firstElementChild)
  }
  return current
}

/**
 * Climb from an anchor to the anchor's ancestor that is a direct child of the column.
 * @param column - one of the three grid columns.
 * @param anchor - matched anchor inside the column.
 * @returns the column's own child on the anchor's path, excluding the column itself.
 */
function climbToColumnChild(column: Element, anchor: Element): Element | undefined {
  let current: Element = anchor
  while (current.parentElement !== null && current.parentElement !== column) current = current.parentElement
  if (current === column || current.parentElement !== column) return undefined
  return current
}

/** Resolve one left/center pane through its anchors. */
function resolveAnchored(column: Element, anchors: readonly string[]): HTMLElement | undefined {
  for (const selector of anchors) {
    const anchor = asElement(column.querySelector(selector))
    if (anchor === undefined) continue
    if (anchor.closest(EXCLUDED_SELECTOR) !== null) continue
    const seated = climbToColumnChild(column, anchor)
    if (seated === undefined) continue
    const boxed = boxedAncestorOfAnchor(seated, anchor)
    if (boxed === undefined || !(boxed instanceof (boxed.ownerDocument.defaultView?.HTMLElement ?? HTMLElement))) continue
    return boxed
  }
  return undefined
}

/**
 * Resolve the visible docked compartments of the right column, each with the
 * split column it occupies. Floating cells are siblings of the dock cells, so
 * they are excluded by construction, and the column's own `.panel` (which
 * carries an inline width) is never returned.
 * @param column - the right grid column.
 * @returns one entry per visible docked compartment, in DOM order.
 */
/**
 * Resolve the visible docked compartments of the right column, each with the
 * split column it occupies. Floating cells are siblings of the dock cells, so
 * they are excluded by construction, and the column's own `.panel` (which
 * carries an inline width) is never returned.
 * @param column - the right grid column.
 * @returns one entry per visible docked compartment, in DOM order.
 */
function resolveDockedSections(column: Element): Array<{ slot: SlotId, element: HTMLElement }> {
  const docked = [...column.querySelectorAll(DOCK_PANE_SELECTOR)]
  const candidates = docked.length > 0 ? docked : [...column.querySelectorAll(DOCK_PANE_FALLBACK)]
  const resolved: Array<{ slot: SlotId, element: HTMLElement }> = []
  let order = 0
  for (const candidate of candidates) {
    if (!hasLayoutBox(candidate)) continue
    if (candidate.closest(EXCLUDED_SELECTOR) !== null) continue
    if (candidate.matches(TERMINAL_SELECTOR) || candidate.querySelector(TERMINAL_SELECTOR) !== null) {
      order += 1
      continue
    }
    const view = candidate.ownerDocument.defaultView
    if (!(candidate instanceof (view?.HTMLElement ?? HTMLElement))) continue
    const declared = Number.parseInt(candidate.getAttribute(DOCK_COLUMN_ATTRIBUTE) ?? '', 10)
    const columnIndex = Number.isFinite(declared) ? declared : order
    order += 1
    resolved.push({ slot: slotId('right', columnIndex), element: candidate as HTMLElement })
  }
  return resolved
}

/**
 * Resolve every pane content root currently present. Read-only: the caller owns
 * marking. Missing columns (collapsed sidebar, closed right bar) are simply absent.
 * @param doc - the product document.
 * @returns the resolved targets, in pane order.
 */
export function resolvePaneTargets(doc: Document): PaneTarget[] {
  const targets: PaneTarget[] = []
  for (const pane of PANE_IDS) {
    const column = asElement(doc.querySelector(COLUMN_SELECTORS[pane]))
    if (column === undefined) continue
    if (pane === 'right') {
      for (const docked of resolveDockedSections(column)) targets.push({ ...docked, pane })
      continue
    }
    const element = resolveAnchored(column, ANCHORS[pane])
    if (element !== undefined) targets.push({ pane, slot: pane, element })
  }
  return targets
}

/**
 * Apply the desired marks as a difference, leaving foreign attribute values alone.
 * Same-value marks are not rewritten, and an attribute is only cleared or taken
 * over while it carries the value this owner previously wrote (lease semantics
 * for co-existing owners).
 * @param owned - the marks written by the previous sync.
 * @param desired - the freshly resolved targets.
 * @returns the marks this owner now holds.
 */
export function syncTargetMarks(
  owned: ReadonlyMap<HTMLElement, PaneId>,
  desired: readonly PaneTarget[],
): Map<HTMLElement, PaneId> {
  const desiredMap = new Map<HTMLElement, PaneId>()
  for (const { pane, element } of desired) desiredMap.set(element, pane)

  for (const [element, pane] of owned) {
    if (desiredMap.get(element) === pane) continue
    if (element.getAttribute(TARGET_ATTRIBUTE) === pane) element.removeAttribute(TARGET_ATTRIBUTE)
    element.removeAttribute(SLOT_ATTRIBUTE)
  }

  const claimed = new Map<HTMLElement, PaneId>()
  for (const { pane, slot, element } of desired) {
    const current = element.getAttribute(TARGET_ATTRIBUTE)
    if (current !== pane && current !== null && current !== owned.get(element)) continue
    if (current !== pane) element.setAttribute(TARGET_ATTRIBUTE, pane)
    if (element.getAttribute(SLOT_ATTRIBUTE) !== slot) element.setAttribute(SLOT_ATTRIBUTE, slot)
    claimed.set(element, pane)
  }
  return claimed
}

/**
 * Clear every mark this owner holds.
 * @param owned - the marks written by the previous sync.
 */
export function clearTargetMarks(owned: ReadonlyMap<HTMLElement, PaneId>): void {
  for (const [element, pane] of owned) {
    if (element.getAttribute(TARGET_ATTRIBUTE) === pane) element.removeAttribute(TARGET_ATTRIBUTE)
    element.removeAttribute(SLOT_ATTRIBUTE)
  }
}

/**
 * Whether a mutation batch can change pane resolution. Deliberately narrow:
 * chat output appends thousands of nodes into the center pane's subtree, and a
 * full re-resolve per append would be wasted work.
 * @param records - the observer's pending records.
 * @returns true when a column, slot seam, scroll root, or dock host appeared, left, or changed.
 */
export function isPaneStructureChange(records: readonly MutationRecord[]): boolean {
  for (const record of records) {
    if (record.target.nodeType === 1) {
      const element = record.target as Element
      if (element === element.ownerDocument.body || element.matches(STRUCTURE_SELECTOR)) return true
    }
    for (const node of [...record.addedNodes, ...record.removedNodes]) {
      if (node.nodeType !== 1) continue
      const element = node as Element
      if (element.matches(STRUCTURE_SELECTOR) || element.querySelector(STRUCTURE_SELECTOR) !== null) return true
    }
  }
  return false
}

/** Structural elements whose appearance or removal invalidates resolution. */
const STRUCTURE_SELECTOR = "[class*='sidebarCol'], [class*='centerCol'], [class*='rightbarCol'], [data-slot='sidebar'], [data-conversation-scroll], [data-dockkit-host]"

/** Whether a string is a slot this plugin owns. */
function isSlotId(value: string | null): value is SlotId {
  return value !== null && /^(left|center|right|right-\d+)$/u.test(value)
}

/**
 * Slot of the nearest marked root, including a split right-sidebar column.
 * @param node - an event target or the active element.
 * @returns the slot whose marked root encloses the node, or null.
 */
export function slotOfNode(node: Element | null): SlotId | null {
  if (node === null) return null
  const marked = node.closest(`[${SLOT_ATTRIBUTE}]`)
  if (marked !== null) {
    const value = marked.getAttribute(SLOT_ATTRIBUTE)
    if (isSlotId(value)) return value
  }
  const pane = paneOfNode(node)
  return pane
}

/**
 * Slot a gesture on a node belongs to: the marked root's own slot when the
 * pointer is inside one, otherwise the enclosing column, so skin chrome parked
 * at column level still targets its pane. A right-dock column that carries no
 * mark (the split divider, column chrome) falls back to the last right slot the
 * pointer used, then to the first column.
 * @param node - an event target or the active element.
 * @param lastPointerSlot - the slot of the previous pointer interaction.
 * @returns the slot to scale, or null when the gesture belongs to the page.
 */
export function slotForTarget(node: Element | null, lastPointerSlot: SlotId | null): SlotId | null {
  const marked = slotOfNode(node)
  if (marked !== null) return marked
  const pane = paneOfColumn(node)
  if (pane === null) return null
  if (pane !== 'right') return pane
  return lastPointerSlot !== null && lastPointerSlot.startsWith('right') ? lastPointerSlot : 'right'
}

/**
 * Pane whose grid column contains a node.
 *
 * Skins park their own chrome inside a column but outside the marked root
 * (`maid-atelier` prepends a character stage into `.centerCol` and a mascot into
 * the sidebar seam). A gesture over that chrome still belongs to the pane the
 * user sees under the pointer, so it must scale the pane — never fall through to
 * the browser's page zoom. Portalled popups are unaffected: they live under
 * `document.body`, outside every column.
 * @param node - an event target or the active element.
 * @returns the enclosing pane, or null outside all three columns.
 */
export function paneOfColumn(node: Element | null): PaneId | null {
  if (node === null) return null
  for (const pane of PANE_IDS) {
    if (node.closest(COLUMN_SELECTORS[pane]) !== null) return pane
  }
  return null
}

/**
 * Nearest marked pane ancestor of a node, skipping excluded subtrees.
 * @param node - an event target or the active element.
 * @returns the pane whose target encloses the node, or null.
 */
export function paneOfNode(node: Element | null): PaneId | null {
  if (node === null) return null
  const marked = node.closest(`[${TARGET_ATTRIBUTE}]`)
  if (marked === null) return null
  const value = marked.getAttribute(TARGET_ATTRIBUTE)
  return value === 'left' || value === 'center' || value === 'right' ? value : null
}

/**
 * Whether a node sits in a surface that owns Ctrl+wheel itself (document
 * preview, terminal) or in a floating panel.
 * @param node - an event target or the active element.
 * @returns whether the plugin must leave the gesture alone.
 */
export function isExcludedSurface(node: Element | null): boolean {
  if (node === null) return false
  return node.closest(`[data-document-zoom-surface], [data-document-zoom-frame], [data-document-zoom-scrollport], ${EXCLUDED_SELECTOR}`) !== null
}
