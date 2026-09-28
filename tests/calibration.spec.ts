/** Self-calibration classifiers, the probe routine, and fixed-overlay marking. */
import { afterEach, describe, expect, it } from 'vitest'
import {
  FIXED_ATTRIBUTE, FILL_ATTRIBUTE, calibrate, classifyFillProbe, classifyFixedProbe, clearFixedOverlays,
  domProbeEnvironment, syncFixedOverlays,
} from '../src/client/calibration.ts'
import type { ProbeEnvironment, RectLike } from '../src/client/calibration.ts'
import { FIXED_OVERLAY_ATTRIBUTE } from '../src/client/targets.ts'

/** A rect literal with sensible defaults. */
function rect(partial: Partial<RectLike>): RectLike {
  return { x: 0, y: 0, width: 0, height: 0, ...partial }
}

/** Scripted measurements plus an attach/detach log. */
function fakeEnv(
  script: {
    column: RectLike
    root: RectLike
    compensated: RectLike
    scaled: RectLike
    countered: RectLike
  },
  root: HTMLElement,
  column: HTMLElement,
): { env: ProbeEnvironment, attached: HTMLElement[], detached: HTMLElement[] } {
  const attached: HTMLElement[] = []
  const detached: HTMLElement[] = []
  let widthCompensated = false
  return {
    attached,
    detached,
    env: {
      create: () => document.createElement('div'),
      attach: (parent, probe) => { parent.append(probe); attached.push(probe) },
      detach: (probe) => { probe.remove(); detached.push(probe) },
      rect: (element) => {
        if (attached.includes(element as HTMLElement)) {
          const probe = element as HTMLElement
          return probe.style.getPropertyValue('zoom') === '' ? script.scaled : script.countered
        }
        if (element === column) return script.column
        if (element === root) return widthCompensated ? script.compensated : script.root
        return rect({})
      },
      readStyle: (element, property) => element.style.getPropertyValue(property),
      setStyle: (element, property, value) => {
        if (element === root && property === 'width') widthCompensated = value !== ''
        if (value === '') element.style.removeProperty(property)
        else element.style.setProperty(property, value)
      },
    },
  }
}

/** A root with a column parent, attached so computed styles resolve. */
function pane(): { root: HTMLElement, column: HTMLElement } {
  const column = document.createElement('div')
  const root = document.createElement('div')
  column.append(root)
  document.body.append(column)
  return { root, column }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('classifyFillProbe', () => {
  it('reports fluid when the root already fills its column', () => {
    expect(classifyFillProbe({
      column: rect({ width: 960 }),
      root: rect({ width: 960 }),
      compensated: rect({ width: 640 }),
    })).toBe('fluid')
  })

  it('reports compensated when the inline width is the closer box', () => {
    expect(classifyFillProbe({
      column: rect({ width: 960 }),
      root: rect({ width: 1440 }),
      compensated: rect({ width: 960 }),
    })).toBe('compensated')
  })

  it('reports fluid when no layout is available', () => {
    expect(classifyFillProbe({
      column: rect({}),
      root: rect({}),
      compensated: rect({}),
    })).toBe('fluid')
  })

  it('keeps fluid when neither box is closer to the column', () => {
    expect(classifyFillProbe({
      column: rect({ width: 960 }),
      root: rect({ width: 1100 }),
      compensated: rect({ width: 820 }),
    })).toBe('fluid')
  })

  it('prefers the compensation as soon as it measurably helps', () => {
    expect(classifyFillProbe({
      column: rect({ width: 960 }),
      root: rect({ width: 1200 }),
      compensated: rect({ width: 1080 }),
    })).toBe('compensated')
  })
})

describe('classifyFixedProbe', () => {
  const root = rect({ x: 900, y: 80, width: 960, height: 600 })

  it('reports native when fixed boxes keep their own size', () => {
    expect(classifyFixedProbe({
      zoom: 1.5,
      scaled: rect({ x: 20, y: 20, width: 10, height: 10 }),
      countered: rect({ x: 20, y: 20, width: 10, height: 10 }),
      root,
    })).toBe('native')
  })

  it('reports scaled when only the size grows and the viewport anchor holds', () => {
    expect(classifyFixedProbe({
      zoom: 1.5,
      scaled: rect({ x: 20, y: 20, width: 15, height: 15 }),
      countered: rect({ x: 20, y: 20, width: 10, height: 10 }),
      root,
    })).toBe('scaled')
  })

  it('reports contained when the zoomed ancestor becomes the containing block', () => {
    expect(classifyFixedProbe({
      zoom: 1.5,
      scaled: rect({ x: 930, y: 110, width: 15, height: 15 }),
      countered: rect({ x: 930, y: 110, width: 10, height: 10 }),
      root,
    })).toBe('contained')
  })

  it('reports native when the counter-zoom cannot restore the size', () => {
    expect(classifyFixedProbe({
      zoom: 1.5,
      scaled: rect({ x: 930, y: 110, width: 15, height: 15 }),
      countered: rect({ x: 930, y: 110, width: 15, height: 15 }),
      root,
    })).toBe('native')
  })

  it('reports native without a usable layout or zoom', () => {
    expect(classifyFixedProbe({
      zoom: 1.5,
      scaled: rect({ x: 930, y: 110, width: 15 }),
      countered: rect({ x: 930, y: 110, width: 10 }),
      root: rect({}),
    })).toBe('native')
    expect(classifyFixedProbe({
      zoom: 0,
      scaled: rect({ x: 930, y: 110, width: 15 }),
      countered: rect({ x: 930, y: 110, width: 10 }),
      root,
    })).toBe('native')
  })
})

describe('calibrate', () => {
  it('decides both branches, restores inline styles, and removes the probe', () => {
    const { root, column } = pane()
    const { env, attached, detached } = fakeEnv({
      column: rect({ width: 960 }),
      root: rect({ width: 960 }),
      compensated: rect({ width: 640 }),
      scaled: rect({ x: 20, y: 20, width: 10, height: 10 }),
      countered: rect({ x: 20, y: 20, width: 10, height: 10 }),
    }, root, column)
    const result = calibrate(root, 1.5, env)
    expect(result.fill).toBe('fluid')
    expect(result.fixed).toBe('native')
    expect(attached).toHaveLength(1)
    expect(detached).toEqual(attached)
    expect(attached[0]?.isConnected).toBe(false)
    expect(root.style.getPropertyValue('width')).toBe('')
    expect(result.payload).toMatchObject({ zoom: 1.5, fill: 'fluid', fixed: 'native' })
  })

  it('preserves a pre-existing inline width on the root', () => {
    const { root, column } = pane()
    root.style.setProperty('width', '50%')
    const { env } = fakeEnv({
      column: rect({ width: 960 }),
      root: rect({ width: 960 }),
      compensated: rect({ width: 640 }),
      scaled: rect({ x: 20, y: 20, width: 10, height: 10 }),
      countered: rect({ x: 20, y: 20, width: 10, height: 10 }),
    }, root, column)
    calibrate(root, 1.5, env)
    expect(root.style.getPropertyValue('width')).toBe('50%')
  })

  it('uses the nearest boxed ancestor across a display:contents seam', () => {
    const column = document.createElement('div')
    const seam = document.createElement('div')
    seam.style.display = 'contents'
    const root = document.createElement('div')
    seam.append(root)
    column.append(seam)
    document.body.append(column)
    const { env } = fakeEnv({
      column: rect({ width: 960 }),
      root: rect({ width: 1440 }),
      compensated: rect({ width: 960 }),
      scaled: rect({ x: 20, y: 20, width: 10, height: 10 }),
      countered: rect({ x: 20, y: 20, width: 10, height: 10 }),
    }, root, column)
    expect(calibrate(root, 1.5, env).fill).toBe('compensated')
  })

  it('reports the compensated and scaled branches with the measured origin', () => {
    const { root, column } = pane()
    const { env } = fakeEnv({
      column: rect({ width: 960 }),
      root: rect({ x: 900, y: 80, width: 1440, height: 600 }),
      compensated: rect({ x: 900, y: 80, width: 960, height: 600 }),
      scaled: rect({ x: 20, y: 20, width: 15, height: 15 }),
      countered: rect({ x: 20, y: 20, width: 10, height: 10 }),
    }, root, column)
    const result = calibrate(root, 1.5, env)
    expect(result.fill).toBe('compensated')
    expect(result.fixed).toBe('scaled')
    expect(result.origin).toEqual({ x: 900, y: 80 })
  })

  it('reports contained with the origin the translate rule needs', () => {
    const { root, column } = pane()
    const { env } = fakeEnv({
      column: rect({ width: 960 }),
      root: rect({ x: 900, y: 80, width: 960, height: 600 }),
      compensated: rect({ x: 900, y: 80, width: 640, height: 400 }),
      scaled: rect({ x: 930, y: 110, width: 15, height: 15 }),
      countered: rect({ x: 930, y: 110, width: 10, height: 10 }),
    }, root, column)
    const result = calibrate(root, 1.5, env)
    expect(result.fixed).toBe('contained')
    expect(result.origin).toEqual({ x: 900, y: 80 })
    expect(result.payload).toHaveProperty('scaled')
  })

  it('lands on the no-compensation defaults when nothing can be measured', () => {
    const { root, column } = pane()
    const { env } = fakeEnv({
      column: rect({}),
      root: rect({}),
      compensated: rect({}),
      scaled: rect({}),
      countered: rect({}),
    }, root, column)
    const result = calibrate(root, 1.25, env)
    expect(result.fill).toBe('fluid')
    expect(result.fixed).toBe('native')
  })

  it('exposes the real-DOM environment through the same interface', () => {
    const { root, column } = pane()
    document.body.append(column)
    const env = domProbeEnvironment(document)
    expect(env.readStyle(root, 'width')).toBe('')
    env.setStyle(root, 'width', '12px')
    expect(env.readStyle(root, 'width')).toBe('12px')
    env.setStyle(root, 'width', '')
    expect(env.readStyle(root, 'width')).toBe('')
    expect(() => { env.rect(root) }).not.toThrow()
  })
})

describe('syncFixedOverlays', () => {
  it('marks only elements that really compute to position: fixed', () => {
    const root = document.createElement('div')
    const tooltip = document.createElement('div')
    tooltip.setAttribute('role', 'tooltip')
    tooltip.style.position = 'fixed'
    const toggle = document.createElement('button')
    toggle.className = 'sb_toggleButton'
    const newSession = document.createElement('button')
    newSession.className = 'sb_newSessionRail'
    newSession.style.position = 'fixed'
    const nested = document.createElement('div')
    nested.setAttribute('role', 'tooltip')
    nested.style.position = 'fixed'
    toggle.append(nested)
    root.append(tooltip, toggle, newSession)
    document.body.append(root)

    const owned = syncFixedOverlays(new Set(), [root], document.defaultView)
    expect([...owned]).toEqual([tooltip, nested, newSession])
    expect(tooltip.hasAttribute(FIXED_OVERLAY_ATTRIBUTE)).toBe(true)
    expect(toggle.hasAttribute(FIXED_OVERLAY_ATTRIBUTE)).toBe(false)
  })

  it('drops marks whose overlay disappeared', () => {
    const root = document.createElement('div')
    const tooltip = document.createElement('div')
    tooltip.setAttribute('role', 'tooltip')
    tooltip.style.position = 'fixed'
    root.append(tooltip)
    document.body.append(root)
    const owned = syncFixedOverlays(new Set(), [root], document.defaultView)
    expect(owned.size).toBe(1)
    tooltip.remove()
    const next = syncFixedOverlays(owned, [root], document.defaultView)
    expect(next.size).toBe(0)
    expect(tooltip.hasAttribute(FIXED_OVERLAY_ATTRIBUTE)).toBe(false)
    clearFixedOverlays(next)
    expect(next.size).toBe(0)
  })

  it('clears every mark it holds', () => {
    const root = document.createElement('div')
    const tooltip = document.createElement('div')
    tooltip.setAttribute('role', 'tooltip')
    tooltip.style.position = 'fixed'
    root.append(tooltip)
    const owned = syncFixedOverlays(new Set(), [root], document.defaultView)
    clearFixedOverlays(owned)
    expect(tooltip.hasAttribute(FIXED_OVERLAY_ATTRIBUTE)).toBe(false)
  })
})

describe('attribute names', () => {
  it('are stable and distinct', () => {
    expect(FILL_ATTRIBUTE).toBe('data-pane-scaling-fill')
    expect(FIXED_ATTRIBUTE).toBe('data-pane-scaling-fixed')
  })
})
