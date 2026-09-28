/** Engine assembly, gestures end to end, calibration wiring, and teardown. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FILL_ATTRIBUTE, FIXED_ATTRIBUTE, fillPaneAttribute, fillWidthVariable } from '../src/client/calibration.ts'
import type { ProbeEnvironment, RectLike } from '../src/client/calibration.ts'
import {
  ACTIVE_ATTRIBUTE, counterVariable, installPaneScaling, originXVariable, originYVariable, zoomVariable,
} from '../src/client/scaling.ts'
import type { InstallOptions } from '../src/client/scaling.ts'
import { STORE_KEY, decodeZoom } from '../src/client/storage.ts'
import { TARGET_ATTRIBUTE } from '../src/client/targets.ts'
import type { HostShortcutCommand, HostShortcutService } from '../src/client/host.ts'
import { buildShell, element } from './helpers/dom.ts'

/** An installed engine plus its schedule queue and diagnostic sinks. */
interface Harness {
  dispose(): void
  flush(): void
  warn: ReturnType<typeof vi.fn>
  report: ReturnType<typeof vi.fn>
}

/** Build the shell (unless one is already in place) and activate the engine. */
function activate(options: Partial<InstallOptions> = {}, prepare?: () => void): Harness {
  if (document.querySelector('.frame') === null) buildShell(document)
  prepare?.()
  const queue: Array<() => void> = []
  const warn = vi.fn()
  const report = vi.fn()
  const dispose = installPaneScaling(document.body, {}, {
    supportsZoom: true,
    schedule: callback => { queue.push(callback) },
    warn,
    report,
    ...options,
  })
  return {
    dispose,
    flush: () => { for (const callback of queue.splice(0)) callback() },
    warn,
    report,
  }
}

/** Dispatch Ctrl+wheel and report whether the plugin cancelled it. */
function wheel(target: Element, deltaY = -100): boolean {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY })
  target.dispatchEvent(event)
  return event.defaultPrevented
}

/** Press Ctrl+<code> on the window. */
function press(code: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ctrlKey: true, code }))
}

/** Read one inline variable. */
function style(name: string): string {
  return document.documentElement.style.getPropertyValue(name)
}

/** Every mark currently in the document. */
function marks(): Element[] {
  return [...document.querySelectorAll(`[${TARGET_ATTRIBUTE}]`)]
}

/** A scripted probe environment for the pane it is handed. */
function scriptedProbe(
  root: HTMLElement,
  column: HTMLElement,
  script: { rootRect: RectLike, compensated: RectLike, scaled: RectLike, countered: RectLike, columnRect: RectLike },
): ProbeEnvironment {
  let compensated = false
  const probes = new Set<HTMLElement>()
  return {
    create: () => {
      const node = document.createElement('div')
      probes.add(node)
      return node
    },
    attach: (parent, probe) => { parent.append(probe) },
    detach: probe => { probe.remove() },
    rect: (element) => {
      if (probes.has(element as HTMLElement)) {
        return (element as HTMLElement).style.getPropertyValue('zoom') === '' ? script.scaled : script.countered
      }
      if (element === column) return script.columnRect
      if (element === root) return compensated ? script.compensated : script.rootRect
      return { x: 0, y: 0, width: 0, height: 0 }
    },
    readStyle: (element, property) => element.style.getPropertyValue(property),
    setStyle: (element, property, value) => {
      if (element === root && property === 'width') compensated = value !== ''
      if (value === '') element.style.removeProperty(property)
      else element.style.setProperty(property, value)
    },
  }
}

let harness: Harness | undefined

beforeEach(() => {
  localStorage.clear()
  document.documentElement.lang = 'zh-CN'
})

afterEach(() => {
  harness?.dispose()
  harness = undefined
  vi.restoreAllMocks()
  vi.useRealTimers()
  localStorage.clear()
  document.documentElement.removeAttribute('style')
  document.documentElement.lang = ''
  document.body.innerHTML = ''
})

describe('activation', () => {
  it('marks the three panes and publishes 100% for each', () => {
    harness = activate()
    expect(document.body.hasAttribute(ACTIVE_ATTRIBUTE)).toBe(true)
    expect(marks()).toHaveLength(3)
    expect(style(zoomVariable('left'))).toBe('1')
    expect(style(zoomVariable('center'))).toBe('1')
    expect(style(zoomVariable('right'))).toBe('1')
    expect(style(counterVariable('left'))).toBe('1')
    expect(document.body.getAttribute(FILL_ATTRIBUTE)).toBe('fluid')
    expect(document.body.getAttribute(FIXED_ATTRIBUTE)).toBe('native')
    expect(document.querySelector('[data-pane-scaling-badge]')).toBeNull()
  })

  it('never marks the panel that carries the inline track width', () => {
    harness = activate()
    expect(element(document, '.sr_panel').hasAttribute(TARGET_ATTRIBUTE)).toBe(false)
    expect(element(document, '.af_rightbarCol').hasAttribute(TARGET_ATTRIBUTE)).toBe(false)
  })

  it('restores a stored state', () => {
    localStorage.setItem(STORE_KEY, '{"left":0.85,"center":1,"right":1.5}')
    harness = activate()
    expect(style(zoomVariable('left'))).toBe('0.85')
    expect(style(zoomVariable('right'))).toBe('1.5')
    expect(style(counterVariable('right'))).toBe('0.666667')
  })

  it('stays completely inactive without CSS zoom support', () => {
    harness = activate({ supportsZoom: false })
    expect(harness.warn).toHaveBeenCalledTimes(1)
    expect(document.body.hasAttribute(ACTIVE_ATTRIBUTE)).toBe(false)
    expect(marks()).toEqual([])
    expect(style(zoomVariable('left'))).toBe('')
    expect(wheel(element(document, '.cv_root'))).toBe(false)
  })
})

describe('wheel scaling end to end', () => {
  it('scales only the pane under the pointer, persists it, and shows the badge', () => {
    vi.useFakeTimers()
    harness = activate()
    expect(wheel(element(document, '.cv_root'))).toBe(true)
    expect(style(zoomVariable('center'))).toBe('1.05')
    expect(style(zoomVariable('left'))).toBe('1')
    expect(decodeZoom(localStorage.getItem(STORE_KEY)).center).toBe(21)
    const badge = document.querySelector('[data-pane-scaling-badge]')
    expect(badge?.textContent).toContain('中栏 105%')
    expect(badge?.hasAttribute('data-pane-scaling-badge-visible')).toBe(true)
    vi.advanceTimersByTime(1200)
    expect(badge?.hasAttribute('data-pane-scaling-badge-visible')).toBe(false)
  })

  it('clamps at 150% and 75% without redundant writes', () => {
    harness = activate()
    const pane = element(document, '.sb_root')
    for (let index = 0; index < 12; index += 1) wheel(pane)
    expect(style(zoomVariable('left'))).toBe('1.5')
    const spy = vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty')
    wheel(pane)
    expect(style(zoomVariable('left'))).toBe('1.5')
    expect(spy.mock.calls.filter(([name]) => String(name).startsWith('--pane-scaling'))).toHaveLength(0)
    for (let index = 0; index < 20; index += 1) wheel(pane, 100)
    expect(style(zoomVariable('left'))).toBe('0.75')
  })

  it('scales each split right column on its own and keeps both values', () => {
    vi.useFakeTimers()
    harness = activate({}, () => { buildShell(document, { splitRight: true }) })
    const first = element(document, "[data-dockkit-column='0'] > section")
    const second = element(document, "[data-dockkit-column='1'] > section")
    expect(style(zoomVariable('right'))).toBe('1')
    expect(style(zoomVariable('right-1'))).toBe('1')
    expect(wheel(second)).toBe(true)
    expect(style(zoomVariable('right-1'))).toBe('1.05')
    expect(style(zoomVariable('right'))).toBe('1')
    expect(style(counterVariable('right-1'))).toBe('0.952381')
    expect(document.querySelector('[data-pane-scaling-badge]')?.textContent).toContain('右栏 2 105%')
    expect(wheel(first, 100)).toBe(true)
    expect(style(zoomVariable('right'))).toBe('0.95')
    expect(style(zoomVariable('right-1'))).toBe('1.05')
    expect(decodeZoom(localStorage.getItem(STORE_KEY))).toMatchObject({ right: 19, 'right-1': 21 })
    // The keyboard acts on the slot that holds focus.
    second.tabIndex = 0
    second.focus()
    press('Digit0')
    expect(style(zoomVariable('right-1'))).toBe('1')
    expect(style(zoomVariable('right'))).toBe('0.95')
  })

  it('lets the host zoom surfaces through untouched', () => {
    harness = activate()
    const scrollport = element(document, '[data-conversation-scroll]')
    scrollport.setAttribute('data-document-zoom-scrollport', '')
    expect(wheel(scrollport)).toBe(false)
    expect(style(zoomVariable('center'))).toBe('1')
    expect(localStorage.getItem(STORE_KEY)).toBeNull()
  })

  it('leaves the terminal and floating panels to their owners', () => {
    harness = activate({}, () => { buildShell(document, { withTerminal: true, secondDockPane: true }) })
    expect(wheel(element(document, '.xterm'))).toBe(false)
    expect(wheel(element(document, '[data-dockkit-float]'))).toBe(false)
    expect(style(zoomVariable('right'))).toBe('1')
    expect(marks()).toHaveLength(2)
  })
})

describe('keyboard', () => {
  it('steps the pane that holds focus and resets it with Ctrl+0', () => {
    harness = activate()
    const search = element<HTMLInputElement>(document, '.sb_root input')
    search.focus()
    press('Equal')
    expect(style(zoomVariable('left'))).toBe('1.05')
    press('Minus')
    expect(style(zoomVariable('left'))).toBe('1')
    press('Equal')
    press('Digit0')
    expect(style(zoomVariable('left'))).toBe('1')
  })

  it('falls back to the last pointer pane and then to the center pane', () => {
    harness = activate()
    press('Equal')
    expect(style(zoomVariable('center'))).toBe('1.05')
    element(document, '.sb_root').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    press('Equal')
    expect(style(zoomVariable('left'))).toBe('1.05')
  })

  it('uses the host shortcut service when it can own the keys', () => {
    const registered: HostShortcutCommand[] = []
    const service: HostShortcutService = {
      runtime: 'desktop',
      platform: 'linux',
      register: (command) => { registered.push(command); return () => {} },
    }
    buildShell(document)
    const queue: Array<() => void> = []
    const dispose = installPaneScaling(
      document.body,
      { get: name => (name === 'shortcuts' ? service : undefined) },
      {
        supportsZoom: true,
        schedule: callback => { queue.push(callback) },
        warn: vi.fn(),
        report: vi.fn(),
      },
    )
    harness = {
      dispose,
      flush: () => { for (const callback of queue.splice(0)) callback() },
      warn: vi.fn(),
      report: vi.fn(),
    }
    expect(registered.map(command => command.id))
      .toEqual(['pane-scaling.in', 'pane-scaling.out', 'pane-scaling.reset'])
    // The host owns the keys, so the private listener must not be installed.
    press('Equal')
    expect(style(zoomVariable('center'))).toBe('1')
    const resolution = registered[0]?.resolve({ region: 'page', modal: null, target: element(document, '.cv_root') })
    if (resolution?.status === 'handled') resolution.run()
    expect(style(zoomVariable('center'))).toBe('1.05')
  })
})

describe('calibration wiring', () => {
  it('follows the frozen px width of a pane root instead of the column box', () => {
    harness = activate({}, () => { element(document, '.sb_root').style.width = '320px' })
    expect(document.body.getAttribute(fillPaneAttribute('left'))).toBe('compensated')
    expect(document.body.getAttribute(fillPaneAttribute('center'))).toBeNull()
    expect(document.body.getAttribute(fillPaneAttribute('right'))).toBeNull()
    // At 100% the compensation is the frozen value itself.
    expect(style(fillWidthVariable('left'))).toBe('320px')
    // Zooming in keeps the rendered width at the frozen value: 320 / 1.05.
    wheel(element(document, '.sb_root'))
    expect(style(zoomVariable('left'))).toBe('1.05')
    expect(style(fillWidthVariable('left'))).toBe('304.762px')
    // Zooming out follows too: 320 / 0.75 at the low end.
    for (let index = 0; index < 6; index += 1) wheel(element(document, '.sb_root'), 100)
    expect(style(zoomVariable('left'))).toBe('0.75')
    expect(style(fillWidthVariable('left'))).toBe(`${String(Number((320 / 0.75).toFixed(3)))}px`)
    // A host re-render that drops the frozen width releases the pane again.
    element(document, '.sb_root').style.removeProperty('width')
    wheel(element(document, '.cv_root'))
    expect(document.body.getAttribute(fillPaneAttribute('left'))).toBeNull()
    expect(style(fillWidthVariable('left'))).toBe('')
    harness.dispose()
    harness = undefined
    expect(document.body.getAttribute(fillPaneAttribute('left'))).toBeNull()
  })

  it('follows a sidebar resize drag without waiting for a zoom step', async () => {
    harness = activate({}, () => { element(document, '.sb_root').style.width = '320px' })
    const left = element(document, '.sb_root')
    // What dragging the sidebar handle does: the host rewrites the frozen width.
    left.style.width = '400px'
    await new Promise(resolve => { setTimeout(resolve, 0) })
    harness.flush()
    expect(style(fillWidthVariable('left'))).toBe('400px')
    // A collapse that drops the inline width releases the gate again.
    left.style.removeProperty('width')
    await new Promise(resolve => { setTimeout(resolve, 0) })
    harness.flush()
    expect(document.body.getAttribute(fillPaneAttribute('left'))).toBeNull()
    expect(style(fillWidthVariable('left'))).toBe('')
  })

  it('switches both body gates to the measured branches', () => {
    buildShell(document)
    const root = element(document, '.sb_root')
    const column = element(document, '.af_sidebarCol')
    const probe = scriptedProbe(root, column, {
      columnRect: { x: 0, y: 0, width: 320, height: 800 },
      rootRect: { x: 0, y: 0, width: 480, height: 800 },
      compensated: { x: 0, y: 0, width: 320, height: 800 },
      scaled: { x: 20, y: 20, width: 15, height: 15 },
      countered: { x: 20, y: 20, width: 10, height: 10 },
    })
    harness = activate({ probe })
    expect(wheel(root)).toBe(true)
    expect(document.body.getAttribute(FILL_ATTRIBUTE)).toBe('compensated')
    expect(document.body.getAttribute(FIXED_ATTRIBUTE)).toBe('scaled')
    expect(harness.report).toHaveBeenCalledTimes(1)
  })

  it('publishes origin variables only in contained mode', () => {
    buildShell(document)
    const root = element(document, '.sb_root')
    const column = element(document, '.af_sidebarCol')
    const probe = scriptedProbe(root, column, {
      columnRect: { x: 0, y: 0, width: 320, height: 800 },
      rootRect: { x: 0, y: 0, width: 320, height: 800 },
      compensated: { x: 0, y: 0, width: 213, height: 533 },
      scaled: { x: 40, y: 60, width: 15, height: 15 },
      countered: { x: 40, y: 60, width: 10, height: 10 },
    })
    harness = activate({ probe })
    expect(style(originXVariable('left'))).toBe('')
    wheel(root)
    expect(document.body.getAttribute(FIXED_ATTRIBUTE)).toBe('contained')
    expect(style(originXVariable('left'))).toBe('0px')
    expect(style(originYVariable('left'))).toBe('0px')
  })

  it('calibrates only once', () => {
    buildShell(document)
    const root = element(document, '.sb_root')
    const column = element(document, '.af_sidebarCol')
    const probe = scriptedProbe(root, column, {
      columnRect: { x: 0, y: 0, width: 320, height: 800 },
      rootRect: { x: 0, y: 0, width: 320, height: 800 },
      compensated: { x: 0, y: 0, width: 213, height: 533 },
      scaled: { x: 20, y: 20, width: 15, height: 15 },
      countered: { x: 20, y: 20, width: 10, height: 10 },
    })
    harness = activate({ probe })
    wheel(root)
    wheel(root)
    wheel(element(document, '.cv_root'))
    expect(harness.report).toHaveBeenCalledTimes(1)
  })

  it('keeps working when the probe throws', () => {
    const probe: ProbeEnvironment = {
      create: () => { throw new Error('no layout') },
      attach: () => {},
      detach: () => {},
      rect: () => ({ x: 0, y: 0, width: 0, height: 0 }),
      readStyle: () => '',
      setStyle: () => {},
    }
    harness = activate({ probe })
    expect(wheel(element(document, '.cv_root'))).toBe(true)
    expect(style(zoomVariable('center'))).toBe('1.05')
    expect(harness.warn).toHaveBeenCalled()
    expect(document.body.getAttribute(FIXED_ATTRIBUTE)).toBe('native')
  })
})

describe('structure changes', () => {
  it('re-resolves marks after the right column disappears and comes back', async () => {
    harness = activate()
    expect(marks()).toHaveLength(3)
    element(document, '.af_rightbarCol').remove()
    await new Promise(resolve => { setTimeout(resolve, 0) })
    harness.flush()
    expect(marks()).toHaveLength(2)
    expect(document.querySelector(`[${TARGET_ATTRIBUTE}='right']`)).toBeNull()
    buildShell(document)
    await new Promise(resolve => { setTimeout(resolve, 0) })
    harness.flush()
    expect(marks()).toHaveLength(3)
  })

  it('ignores deep content churn', async () => {
    harness = activate()
    const spy = vi.spyOn(Element.prototype, 'setAttribute')
    const scroll = element(document, '[data-conversation-scroll]')
    for (let index = 0; index < 20; index += 1) scroll.append(document.createElement('span'))
    await new Promise(resolve => { setTimeout(resolve, 0) })
    harness.flush()
    expect(spy.mock.calls.filter(([, name]) => name === TARGET_ATTRIBUTE)).toHaveLength(0)
  })
})

describe('teardown', () => {
  it('leaves nothing behind and stops handling gestures', () => {
    vi.useFakeTimers()
    harness = activate()
    wheel(element(document, '.cv_root'))
    expect(document.querySelector('[data-pane-scaling-badge]')).not.toBeNull()
    harness.dispose()
    harness = undefined
    expect(document.body.hasAttribute(ACTIVE_ATTRIBUTE)).toBe(false)
    expect(document.body.getAttribute(FILL_ATTRIBUTE)).toBeNull()
    expect(document.body.getAttribute(FIXED_ATTRIBUTE)).toBeNull()
    expect(marks()).toEqual([])
    expect(style(zoomVariable('center'))).toBe('')
    expect(style(counterVariable('center'))).toBe('')
    expect(document.querySelector('[data-pane-scaling-badge]')).toBeNull()
    expect(wheel(element(document, '.cv_root'))).toBe(false)
    expect(style(zoomVariable('center'))).toBe('')
  })

  it('restores a variable value that was already inline', () => {
    document.documentElement.style.setProperty(zoomVariable('left'), '0.9')
    harness = activate()
    expect(style(zoomVariable('left'))).toBe('1')
    harness.dispose()
    harness = undefined
    expect(style(zoomVariable('left'))).toBe('0.9')
  })

  it('unwinds a partial activation when a later step fails', () => {
    const throwing = (): never => { throw new Error('no window') }
    const queue: Array<() => void> = []
    const warn = vi.fn()
    buildShell(document)
    const dispose = installPaneScaling(document.body, {
      get: () => { throw new Error('service blew up') },
    }, {
      supportsZoom: true,
      schedule: callback => { queue.push(callback) },
      warn,
      report: vi.fn(),
      probe: {
        create: throwing, attach: throwing, detach: throwing, rect: throwing, readStyle: throwing, setStyle: throwing,
      },
    })
    expect(document.body.hasAttribute(ACTIVE_ATTRIBUTE)).toBe(true)
    dispose()
    expect(marks()).toEqual([])
    expect(document.body.hasAttribute(ACTIVE_ATTRIBUTE)).toBe(false)
  })
})
