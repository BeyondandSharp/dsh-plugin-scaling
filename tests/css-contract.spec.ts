/** Stylesheet contract: scoping, gated compensations, and no skin coupling. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** Vitest runs from the package root; the jsdom environment has no file URLs. */
const css = readFileSync('src/client/scaling.module.css', 'utf8')
const entry = readFileSync('src/client/index.ts', 'utf8')

/** Every selector list in the sheet, with comments stripped. */
function selectorLists(source: string): string[] {
  return [...source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)]
    .map(match => (match[1] ?? '').replace(/\s+/g, ' ').trim())
    .filter(selector => selector !== '' && !selector.startsWith('@'))
}

/** Split a selector list on top-level commas only (`:is(a, b)` keeps its comma). */
function splitTopLevel(list: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of list) {
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  parts.push(current)
  return parts.map(part => part.trim()).filter(part => part !== '')
}

/** Every rule and its declarations, comments stripped. */
function ruleBlocks(source: string): Array<{ selector: string, body: string }> {
  return [...source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(match => ({
      selector: (match[1] ?? '').replace(/\s+/g, ' ').trim(),
      body: (match[2] ?? '').replace(/\s+/g, ' ').trim(),
    }))
    .filter(rule => rule.selector !== '' && !rule.selector.startsWith('@'))
}

describe('scoping', () => {
  it('scopes every rule to the activation attribute', () => {
    const lists = selectorLists(css)
    expect(lists.length).toBeGreaterThan(5)
    for (const list of lists) {
      for (const selector of splitTopLevel(list)) {
        expect(selector.startsWith('body[data-dsh-plugin-scaling]')).toBe(true)
      }
    }
  })

  it('is imported by the browser entry', () => {
    expect(entry).toContain("import './scaling.module.css'")
  })
})

describe('zoom rules', () => {
  it('declares one rule per slot with its own variable', () => {
    for (const slot of ['left', 'center', 'right', 'right-1', 'preview']) {
      expect(css).toContain(`[data-pane-scaling-slot='${slot}']`)
      expect(css).toContain(`zoom: var(--pane-scaling-${slot})`)
      expect(css).toContain(`--pane-scaling-counter: var(--pane-scaling-counter-${slot})`)
    }
    // Slots, not panes, carry the zoom: two right columns must not share one rule.
    expect(ruleBlocks(css).filter(rule => rule.body.includes('--pane-scaling-own: var(--pane-scaling-'))).toHaveLength(5)
  })

  it('gates the fill compensation on the calibrated attribute', () => {
    expect(css).toContain("[data-pane-scaling-fill='compensated']")
    expect(css).toContain('width: calc(100% / var(--pane-scaling-own))')
    expect(css).toContain('height: calc(100% / var(--pane-scaling-own))')
  })

  it('gates the engine fill compensation and keeps it free of !important', () => {
    const global = ruleBlocks(css).filter(rule => rule.body.includes('calc(100% / var(--pane-scaling-own))'))
    expect(global.map(rule => rule.selector)).toEqual([
      "body[data-dsh-plugin-scaling][data-pane-scaling-mechanism='transform'] [data-pane-scaling-transformed]",
      "body[data-dsh-plugin-scaling][data-pane-scaling-fill='compensated'] [data-pane-scaling-target]",
    ])
    for (const rule of global) expect(rule.body).not.toContain('!important')
  })

  it('follows the host frozen width per pane and outranks it with !important', () => {
    for (const pane of ['left', 'center', 'right']) {
      expect(css).toContain(`[data-pane-scaling-fill-${pane}='compensated'] [data-pane-scaling-target='${pane}']`)
      expect(css).toContain(`width: var(--pane-scaling-fill-width-${pane}) !important`)
    }
    // The only !important declarations in the sheet are those frozen-width
    // compensations: they exist to beat the pane root's inline px width.
    const withImportant = ruleBlocks(css).filter(rule => rule.body.includes('!important'))
    expect(withImportant).toHaveLength(3)
    for (const rule of withImportant) {
      expect(rule.selector).toContain('data-pane-scaling-fill-')
      expect(rule.body).toContain('var(--pane-scaling-fill-width-')
    }
  })

  it('gates the fixed-overlay compensation on the calibrated attribute', () => {
    expect(css).toContain("[data-pane-scaling-fixed='scaled']")
    expect(css).toContain("[data-pane-scaling-fixed='contained']")
    expect(css).toContain('zoom: var(--pane-scaling-counter)')
    expect(css).toContain('translate: calc(-1 * var(--pane-scaling-origin-x)) calc(-1 * var(--pane-scaling-origin-y))')
  })

  it('keeps the conversation header at its own scale', () => {
    const rules = ruleBlocks(css).filter(rule => rule.selector.includes("[data-slot='conversation.header']"))
    expect(rules).toHaveLength(1)
    const rule = rules[0]
    expect(rule?.selector)
      .toBe("body[data-dsh-plugin-scaling]:not([data-pane-scaling-mechanism='transform']) [data-pane-scaling-slot] [data-slot='conversation.header']")
    expect(rule?.body).toContain('zoom: var(--pane-scaling-counter)')
    expect(rule?.body).not.toContain('!important')
  })

  it('cancels the slot zoom under the transform arm', () => {
    const cancel = ruleBlocks(css)
      .filter(rule => rule.selector.includes("[data-pane-scaling-slot]") && rule.body.replace(/;$/, '') === 'zoom: 1')
    expect(cancel).toHaveLength(1)
    expect(cancel[0]?.selector)
      .toBe("body[data-dsh-plugin-scaling][data-pane-scaling-mechanism='transform'] [data-pane-scaling-slot]")
  })

  it('gates the transform arm on the mechanism attribute and neutralizes zoom', () => {
    const arm = ruleBlocks(css).filter(rule => rule.body.includes('transform: scale(var(--pane-scaling-own))'))
    expect(arm).toHaveLength(1)
    // Stamped per root by the engine, and only while that pane is really
    // scaled: `scale(1)` would still add a containing block and a stacking
    // context, which hid the conversation header's corner controls.
    expect(arm[0]?.selector)
      .toBe("body[data-dsh-plugin-scaling][data-pane-scaling-mechanism='transform'] [data-pane-scaling-transformed]")
    const body = arm[0]?.body ?? ''
    // `zoom` must be cancelled: the slot rules above still declare it, and the
    // two mechanisms would otherwise compound.
    expect(body).toContain('zoom: 1')
    expect(body).toContain('transform-origin: top left')
    // A transform does not participate in layout, so the compensation is
    // unconditional in this arm — the calibrated fill gate only widens it.
    expect(body).toContain('width: calc(100% / var(--pane-scaling-own))')
    // A toolbar kept at 1:1 inside the same flow keeps its own height too.
    expect(body).toContain('height: calc((100% - var(--pane-scaling-toolbar, 0px)) / var(--pane-scaling-own))')
    // The shrunken box has to survive the flex algorithm: the right dock's
    // section is `flex: 1 1 auto` and grew straight back to the cell, which
    // pushed its top-row controls outside the clipped column.
    expect(body).toContain('flex: 0 0 auto')
    expect(body).not.toContain('!important')
  })

  it('only counter-scales tooltips and measured fixed overlays', () => {
    const compensationRules = selectorLists(css).filter(list => list.includes("[data-pane-scaling-fixed='"))
    expect(compensationRules.length).toBeGreaterThan(0)
    for (const list of compensationRules) {
      expect(list).toContain("[role='tooltip']")
      expect(list).toContain('[data-pane-scaling-fixed-overlay]')
    }
  })

  it('never leaves an un-gated declaration behind', () => {
    for (const rule of ruleBlocks(css)) {
      expect(rule.selector.startsWith('body[data-dsh-plugin-scaling]')).toBe(true)
    }
  })
})

describe('badge', () => {
  it('is body-level, non-interactive, and below the host menu layer', () => {
    expect(css).toContain('[data-pane-scaling-badge]')
    expect(css).toContain('position: fixed')
    expect(css).toContain('z-index: 900')
    expect(css).toContain('pointer-events: none')
    expect(css).toContain('opacity: 0')
    expect(css).toContain('[data-pane-scaling-badge-visible]')
  })

  it('reads host design tokens with fallbacks', () => {
    for (const token of [
      '--dsw-alias-bg-layer-2',
      '--dsw-alias-border-l2',
      '--dsw-alias-label-primary',
      '--dsw-radius-lg',
      '--dsw-elevation-panel',
    ]) {
      expect(css).toContain(`var(${token},`)
    }
  })
})

describe('skin independence', () => {
  it('never references a skin attribute, skin token, or host font axis', () => {
    for (const forbidden of [
      'data-dsh-maid-atelier',
      'data-dsh-orca-link',
      '--maid-',
      '--dsh-content-font-size',
      'data-skin',
    ]) {
      expect(css).not.toContain(forbidden)
    }
    // Only the plugin's own data attributes and column-free targeting appear.
    expect(css).not.toMatch(/\[class[*^$]?=/)
  })

  it('loads no external resource', () => {
    expect(css).not.toContain('@import')
    expect(css).not.toContain('url(')
  })
})
