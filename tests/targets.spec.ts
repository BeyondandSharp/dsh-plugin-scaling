/** Pane target resolution and the incremental mark lease. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FIXED_OVERLAY_ATTRIBUTE, SLOT_ATTRIBUTE, TARGET_ATTRIBUTE, clearTargetMarks, hasInlinePixelWidth,
  inlinePixelWidth, isExcludedSurface, paneOfColumn, paneOfNode, resolvePaneTargets, slotForTarget,
  syncTargetMarks,
} from '../src/client/targets.ts'
import { buildShell, element } from './helpers/dom.ts'

/** Sync once from an empty lease. */
function sync(doc: Document): Map<HTMLElement, string> {
  return syncTargetMarks(new Map(), resolvePaneTargets(doc)) as unknown as Map<HTMLElement, string>
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('resolvePaneTargets', () => {
  it('climbs past the display:contents slot seam to the real content root', () => {
    buildShell(document)
    const targets = resolvePaneTargets(document)
    const left = targets.find(target => target.pane === 'left')
    expect(left?.element.className).toBe('sb_root')
    expect(left?.element.getAttribute('data-slot')).toBeNull()
    expect(targets.find(target => target.pane === 'center')?.element.className).toBe('cv_root')
  })

  it('ignores skin chrome prepended into the seam and into the column', () => {
    buildShell(document, { skin: true })
    const targets = resolvePaneTargets(document)
    expect(targets.find(target => target.pane === 'left')?.element.className).toBe('sb_root')
    expect(targets.find(target => target.pane === 'center')?.element.className).toBe('cv_root')
    for (const chrome of ['.sk_ornament', '.sk_sidebarMascot', '.sk_sidebarCorners', '.sk_chatStage', '.sk_chatChrome']) {
      expect(document.querySelector(chrome)?.hasAttribute(TARGET_ATTRIBUTE)).toBe(false)
    }
  })

  it('marks only the visible dock compartment and never the panel with the inline width', () => {
    buildShell(document, { secondDockPane: true })
    const targets = resolvePaneTargets(document)
    const rightTargets = targets.filter(target => target.pane === 'right')
    expect(rightTargets).toHaveLength(1)
    expect(rightTargets[0]?.element.tagName).toBe('SECTION')
    expect(rightTargets[0]?.element.className).toContain('dk_pane')
    expect(rightTargets[0]?.slot).toBe('right')
    expect(element(document, '.sr_panel').hasAttribute(TARGET_ATTRIBUTE)).toBe(false)
    expect(document.querySelector('[data-dockkit-float]')?.hasAttribute(TARGET_ATTRIBUTE)).toBe(false)
  })

  it('gives each split right column its own slot', () => {
    buildShell(document, { splitRight: true })
    const targets = resolvePaneTargets(document)
    const slots = targets.map(target => target.slot)
    expect(slots).toEqual(['left', 'center', 'right', 'right-1'])
    const owned = syncTargetMarks(new Map(), targets)
    expect(owned.size).toBe(4)
    for (const target of targets) {
      expect(target.element.getAttribute(TARGET_ATTRIBUTE)).toBe(target.pane)
      expect(target.element.getAttribute(SLOT_ATTRIBUTE)).toBe(target.slot)
    }
    // The split divider is chrome, not a target.
    expect(element(document, '.dk_divider').hasAttribute(TARGET_ATTRIBUTE)).toBe(false)
  })

  it('keeps the split slot labels when one column is a terminal', () => {
    buildShell(document, { splitRight: true })
    element(document, "[data-dockkit-column='1'] > section .dk_paneBody").append(
      Object.assign(document.createElement('div'), { className: 'xterm' }),
    )
    const slots = resolvePaneTargets(document).map(target => target.slot)
    expect(slots).toEqual(['left', 'center', 'right'])
  })

  it('follows a column move back to the pane slots', () => {
    buildShell(document, { splitRight: true })
    const owned = syncTargetMarks(new Map(), resolvePaneTargets(document))
    const second = element(document, "[data-dockkit-column='1'] > section")
    second.setAttribute('data-dockkit-column', '0')
    const next = syncTargetMarks(owned, resolvePaneTargets(document))
    expect(next.size).toBe(4)
    expect(second.getAttribute(SLOT_ATTRIBUTE)).toBe('right')
  })

  it('skips a dock compartment that hosts a terminal', () => {
    buildShell(document, { withTerminal: true })
    expect(resolvePaneTargets(document).filter(target => target.pane === 'right')).toHaveLength(0)
  })

  it('resolves left and center without a right column at all', () => {
    buildShell(document, { withoutRight: true })
    const targets = resolvePaneTargets(document)
    expect(targets.map(target => target.pane)).toEqual(['left', 'center'])
  })

  it('resolves the official shell without any skin attributes', () => {
    buildShell(document)
    expect([...document.querySelectorAll('[data-dsh-maid-atelier]')]).toHaveLength(0)
    const owned = sync(document)
    expect(owned.size).toBe(3)
    expect([...owned.values()].sort()).toEqual(['center', 'left', 'right'])
  })

  it('returns nothing for an empty document', () => {
    document.body.innerHTML = ''
    expect(resolvePaneTargets(document)).toEqual([])
  })
})

describe('syncTargetMarks', () => {
  it('writes once and leaves unchanged marks alone', () => {
    buildShell(document)
    const owned = sync(document)
    const spy = vi.spyOn(Element.prototype, 'setAttribute')
    const again = syncTargetMarks(owned, resolvePaneTargets(document))
    expect(again.size).toBe(owned.size)
    expect(spy.mock.calls.filter(([, name]) => name === TARGET_ATTRIBUTE)).toHaveLength(0)
  })

  it('drops the mark when a pane disappears and keeps the others', () => {
    buildShell(document)
    const owned = syncTargetMarks(new Map(), resolvePaneTargets(document))
    const leftRoot = element(document, '.sb_root')
    element(document, '.af_centerCol').remove()
    const next = syncTargetMarks(owned, resolvePaneTargets(document))
    expect(next.has(leftRoot)).toBe(true)
    expect(document.querySelector('[data-pane-scaling-target="center"]')).toBeNull()
  })

  it('leaves a foreign attribute value alone and does not claim ownership', () => {
    buildShell(document)
    const root = element(document, '.sb_root')
    root.setAttribute(TARGET_ATTRIBUTE, 'foreign')
    const owned = syncTargetMarks(new Map(), resolvePaneTargets(document))
    expect(root.getAttribute(TARGET_ATTRIBUTE)).toBe('foreign')
    expect(owned.has(root)).toBe(false)
    expect(owned.size).toBe(2)
  })

  it('clears every mark it holds without touching foreign ones', () => {
    buildShell(document)
    const owned = syncTargetMarks(new Map(), resolvePaneTargets(document))
    const foreign = element(document, '.cv_root')
    foreign.setAttribute(FIXED_OVERLAY_ATTRIBUTE, '')
    clearTargetMarks(owned)
    expect(document.querySelectorAll(`[${TARGET_ATTRIBUTE}]`)).toHaveLength(0)
    expect(foreign.hasAttribute(FIXED_OVERLAY_ATTRIBUTE)).toBe(true)
  })
})

describe('hasInlinePixelWidth / inlinePixelWidth', () => {
  /** Apply an inline width and report the predicate. */
  const detects = (value: string): boolean => {
    const element = document.createElement('div')
    if (value !== '') element.style.width = value
    return hasInlinePixelWidth(element)
  }

  it('detects the frozen px width the left sidebar keeps', () => {
    expect(detects('320px')).toBe(true)
    expect(detects('320.5px')).toBe(true)
    expect(detects('100%')).toBe(false)
    expect(detects('auto')).toBe(false)
    expect(detects('calc(100% / 1.5)')).toBe(false)
    expect(detects('2rem')).toBe(false)
    expect(detects('')).toBe(false)
  })

  it('reads the frozen value the compensation has to follow', () => {
    const element = document.createElement('div')
    element.style.width = '320.5px'
    expect(inlinePixelWidth(element)).toBe(320.5)
    element.style.width = '480px'
    expect(inlinePixelWidth(element)).toBe(480)
    element.style.width = '100%'
    expect(inlinePixelWidth(element)).toBeUndefined()
  })
})

describe('floating preview resolution', () => {
  it('resolves the portalled hover card as its own slot', () => {
    buildShell(document, { withPreview: true })
    sync(document)
    const card = element(document, '.hc_card')
    expect(card.getAttribute(TARGET_ATTRIBUTE)).toBe('preview')
    expect(card.getAttribute('data-pane-scaling-slot')).toBe('preview')
    // The card, not the diff content inside it: a zoom on the inner box would
    // overflow the card's own background.
    expect(element(document, '[data-changes-hover-preview]').hasAttribute(TARGET_ATTRIBUTE)).toBe(false)
  })

  it('attributes a gesture inside the card to the preview slot', () => {
    buildShell(document, { withPreview: true })
    sync(document)
    expect(slotForTarget(element(document, '.hc_line'), null)).toBe('preview')
    // A portalled card sits outside every column, so the column fallback misses.
    expect(paneOfColumn(element(document, '.hc_line'))).toBeNull()
  })

  it('stays out of the way when no preview is mounted', () => {
    buildShell(document)
    sync(document)
    expect(document.querySelector("[data-pane-scaling-target='preview']")).toBeNull()
  })
})

describe('paneOfNode / isExcludedSurface', () => {
  it('finds the enclosing pane from a nested node', () => {
    buildShell(document)
    sync(document)
    expect(paneOfNode(element(document, '[data-conversation-scroll] textarea'))).toBe('center')
    expect(paneOfNode(document.body)).toBeNull()
    expect(paneOfNode(null)).toBeNull()
  })

  it('excludes the host zoom surfaces, the terminal, floating panels, and the pane toolbar', () => {
    buildShell(document)
    sync(document)
    const scroll = element(document, '[data-conversation-scroll]')
    scroll.setAttribute('data-document-zoom-scrollport', '')
    expect(isExcludedSurface(scroll)).toBe(true)
    expect(isExcludedSurface(element(document, '[data-dockkit-float]'))).toBe(true)
    // The conversation header keeps the pane's chrome out of the pane's scale,
    // so its gestures belong to the browser's global zoom.
    expect(isExcludedSurface(element(document, "[data-slot='conversation.header'] button"))).toBe(true)
    expect(isExcludedSurface(element(document, '.cv_root'))).toBe(false)
    expect(isExcludedSurface(null)).toBe(false)
  })
})

describe('slotForTarget', () => {
  it('prefers the marked root, then the column, then the last right column', () => {
    buildShell(document, { splitRight: true })
    sync(document)
    expect(slotForTarget(element(document, "[data-dockkit-column='1'] > section"), null)).toBe('right-1')
    expect(slotForTarget(element(document, '.cv_root'), null)).toBe('center')
    // Column chrome carries no mark: the pane is clear, the column is not.
    expect(slotForTarget(element(document, '.dk_divider'), null)).toBe('right')
    expect(slotForTarget(element(document, '.dk_divider'), 'right-1')).toBe('right-1')
    expect(slotForTarget(element(document, '.dk_divider'), 'left')).toBe('right')
  })

  it('stays out of portalled surfaces', () => {
    buildShell(document)
    sync(document)
    const portal = document.createElement('div')
    portal.setAttribute('role', 'dialog')
    document.body.append(portal)
    expect(slotForTarget(portal, 'right-1')).toBeNull()
    expect(slotForTarget(null, 'right-1')).toBeNull()
  })
})

describe('paneOfColumn', () => {
  it('resolves skin chrome parked at column level, outside the marked root', () => {
    buildShell(document, { skin: true })
    sync(document)
    for (const chrome of ['.sk_sidebarMascot', '.sk_sidebarCorners', '.sk_ornament']) {
      expect(paneOfNode(element(document, chrome))).toBeNull()
      expect(paneOfColumn(element(document, chrome))).toBe('left')
    }
    expect(paneOfColumn(element(document, '.sk_chatStage'))).toBe('center')
    expect(paneOfColumn(element(document, '.sk_chatChrome'))).toBe('center')
    expect(paneOfColumn(element(document, '[data-dockkit-host="dock"]'))).toBe('right')
  })

  it('stays out of portalled surfaces and the frame itself', () => {
    buildShell(document)
    const portal = document.createElement('div')
    portal.setAttribute('role', 'dialog')
    document.body.append(portal)
    expect(paneOfColumn(portal)).toBeNull()
    expect(paneOfColumn(document.body)).toBeNull()
    expect(paneOfColumn(null)).toBeNull()
  })
})
