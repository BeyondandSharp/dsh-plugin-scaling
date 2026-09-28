/** Pane target resolution and the incremental mark lease. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FIXED_OVERLAY_ATTRIBUTE, TARGET_ATTRIBUTE, clearTargetMarks, hasInlinePixelWidth, isExcludedSurface,
  paneOfNode, resolvePaneTargets, syncTargetMarks,
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

  it('ignores a skin-style decoration node placed first in the column', () => {
    buildShell(document, { skin: true })
    const targets = resolvePaneTargets(document)
    expect(targets.find(target => target.pane === 'left')?.element.className).toBe('sb_root')
    expect(document.querySelector('.sk_ornament')?.hasAttribute(TARGET_ATTRIBUTE)).toBe(false)
  })

  it('marks only the visible dock compartment and never the panel with the inline width', () => {
    buildShell(document, { secondDockPane: true })
    const targets = resolvePaneTargets(document)
    const rightTargets = targets.filter(target => target.pane === 'right')
    expect(rightTargets).toHaveLength(1)
    expect(rightTargets[0]?.element.tagName).toBe('SECTION')
    expect(rightTargets[0]?.element.className).toContain('dk_pane')
    expect(element(document, '.sr_panel').hasAttribute(TARGET_ATTRIBUTE)).toBe(false)
    expect(document.querySelector('[data-dockkit-float]')?.hasAttribute(TARGET_ATTRIBUTE)).toBe(false)
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

describe('hasInlinePixelWidth', () => {
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
})

describe('paneOfNode / isExcludedSurface', () => {
  it('finds the enclosing pane from a nested node', () => {
    buildShell(document)
    sync(document)
    expect(paneOfNode(element(document, '[data-conversation-scroll] textarea'))).toBe('center')
    expect(paneOfNode(document.body)).toBeNull()
    expect(paneOfNode(null)).toBeNull()
  })

  it('excludes the host zoom surfaces, the terminal, and floating panels', () => {
    buildShell(document)
    sync(document)
    const scroll = element(document, '[data-conversation-scroll]')
    scroll.setAttribute('data-document-zoom-scrollport', '')
    expect(isExcludedSurface(scroll)).toBe(true)
    expect(isExcludedSurface(element(document, '[data-dockkit-float]'))).toBe(true)
    expect(isExcludedSurface(element(document, '.cv_root'))).toBe(false)
    expect(isExcludedSurface(null)).toBe(false)
  })
})
