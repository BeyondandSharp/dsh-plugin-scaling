/** Ctrl+wheel and pointer tracking: accumulation, pass-through, and teardown. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UNITS_PER_STEP, WHEEL_IDLE_MS, createGestureState, installGestures } from '../src/client/gestures.ts'
import type { GestureState } from '../src/client/gestures.ts'
import { resolvePaneTargets, syncTargetMarks } from '../src/client/targets.ts'
import type { PaneId } from '../src/client/targets.ts'
import { buildShell, element } from './helpers/dom.ts'
import type { ShellOptions } from './helpers/dom.ts'

/** One recorded step call. */
type Step = [PaneId, 1 | -1 | 0]

/** A wheel event that bubbles and can be cancelled, like the host's. */
function wheel(target: EventTarget, init: WheelEventInit): boolean {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event.defaultPrevented
}

/** Build a shell, mark it, install gestures, and expose the recorded steps. */
function setup(options: ShellOptions = {}): { steps: Step[], state: GestureState, dispose: () => void } {
  buildShell(document, { secondDockPane: true, ...options })
  syncTargetMarks(new Map(), resolvePaneTargets(document))
  const steps: Step[] = []
  const state = createGestureState()
  const dispose = installGestures(document, { step: (pane, direction) => steps.push([pane, direction]) }, state)
  return { steps, state, dispose }
}

let harness: ReturnType<typeof setup>

beforeEach(() => {
  harness = setup()
})

afterEach(() => {
  harness.dispose()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('wheel over a pane', () => {
  it('scales only the pane under the pointer and cancels the browser default', () => {
    const prevented = wheel(element(document, '.cv_root'), { ctrlKey: true, deltaY: -UNITS_PER_STEP })
    expect(prevented).toBe(true)
    expect(harness.steps).toEqual([['center', 1]])
    expect(harness.state.pointerPane).toBe('center')
  })

  it('walks through the panes independently', () => {
    wheel(element(document, '.sb_root'), { ctrlKey: true, deltaY: -100 })
    wheel(element(document, '[data-dockkit-host="dock"] > section'), { ctrlKey: true, deltaY: -100 })
    wheel(element(document, '.cv_root'), { ctrlKey: true, deltaY: 100 })
    expect(harness.steps).toEqual([['left', 1], ['right', 1], ['center', -1]])
  })

  it('accepts the macOS meta modifier', () => {
    wheel(element(document, '.sb_root'), { metaKey: true, deltaY: -100 })
    expect(harness.steps).toEqual([['left', 1]])
  })

  it('does nothing without a primary modifier, and never cancels it', () => {
    const prevented = wheel(element(document, '.cv_root'), { deltaY: -100 })
    expect(prevented).toBe(false)
    expect(harness.steps).toEqual([])
  })

  it('ignores the shift-only and alt-only variants', () => {
    wheel(element(document, '.cv_root'), { shiftKey: true, deltaY: -100 })
    wheel(element(document, '.cv_root'), { altKey: true, deltaY: -100 })
    expect(harness.steps).toEqual([])
  })
})

describe('skin chrome at column level', () => {
  beforeEach(() => {
    harness.dispose()
    harness = setup({ skin: true })
  })

  it('scales the owning pane instead of falling through to the browser page zoom', () => {
    const ctrl = { ctrlKey: true, deltaY: -UNITS_PER_STEP }
    for (const chrome of ['.sk_sidebarMascot', '.sk_sidebarCorners', '.sk_ornament']) {
      expect(wheel(element(document, chrome), ctrl)).toBe(true)
    }
    expect(harness.steps).toEqual([['left', 1], ['left', 1], ['left', 1]])
    expect(harness.state.pointerPane).toBe('left')
    expect(wheel(element(document, '.sk_chatStage'), ctrl)).toBe(true)
    expect(harness.steps.at(-1)).toEqual(['center', 1])
    expect(wheel(element(document, '.sk_chatChrome'), ctrl)).toBe(true)
    expect(harness.steps.at(-1)).toEqual(['center', 1])
  })

  it('still passes through a portalled popup outside every column', () => {
    const portal = document.createElement('div')
    portal.setAttribute('role', 'dialog')
    document.body.append(portal)
    expect(wheel(portal, { ctrlKey: true, deltaY: -UNITS_PER_STEP })).toBe(false)
    expect(harness.steps).toEqual([])
  })
})

describe('pass-through surfaces', () => {
  it('leaves the host document-preview surface alone', () => {
    const scrollport = element(document, '[data-conversation-scroll]')
    scrollport.setAttribute('data-document-zoom-scrollport', '')
    const prevented = wheel(scrollport, { ctrlKey: true, deltaY: -100 })
    expect(prevented).toBe(false)
    expect(harness.steps).toEqual([])
  })

  it('leaves the terminal alone', () => {
    buildShell(document, { withTerminal: true })
    syncTargetMarks(new Map(), resolvePaneTargets(document))
    const prevented = wheel(element(document, '.xterm'), { ctrlKey: true, deltaY: -100 })
    expect(prevented).toBe(false)
    expect(harness.steps).toEqual([])
  })

  it('leaves floating panels alone', () => {
    const prevented = wheel(element(document, '[data-dockkit-float]'), { ctrlKey: true, deltaY: -100 })
    expect(prevented).toBe(false)
    expect(harness.steps).toEqual([])
  })

  it('leaves anything outside a pane alone', () => {
    const prevented = wheel(document.body, { ctrlKey: true, deltaY: -100 })
    expect(prevented).toBe(false)
    expect(harness.steps).toEqual([])
  })
})

describe('accumulation', () => {
  it('accumulates wheel units until a full step is reached', () => {
    wheel(element(document, '.cv_root'), { ctrlKey: true, deltaY: -40 })
    wheel(element(document, '.cv_root'), { ctrlKey: true, deltaY: -40 })
    expect(harness.steps).toEqual([])
    wheel(element(document, '.cv_root'), { ctrlKey: true, deltaY: -40 })
    expect(harness.steps).toEqual([['center', 1]])
    wheel(element(document, '.cv_root'), { ctrlKey: true, deltaY: -40 })
    expect(harness.steps).toEqual([['center', 1]])
    wheel(element(document, '.cv_root'), { ctrlKey: true, deltaY: -80 })
    expect(harness.steps).toEqual([['center', 1], ['center', 1]])
  })

  it('emits one step per full 100 units of a single event', () => {
    wheel(element(document, '.cv_root'), { ctrlKey: true, deltaY: -250 })
    expect(harness.steps).toEqual([['center', 1], ['center', 1]])
  })

  it('normalizes line and page deltas', () => {
    wheel(element(document, '.cv_root'), { ctrlKey: true, deltaY: -7, deltaMode: 1 })
    expect(harness.steps).toEqual([['center', 1]])
    harness.steps.length = 0
    wheel(element(document, '.cv_root'), { ctrlKey: true, deltaY: -1, deltaMode: 2 })
    wheel(element(document, '.cv_root'), { ctrlKey: true, deltaY: -1, deltaMode: 2 })
    expect(harness.steps).toEqual([['center', 1], ['center', 1]])
  })

  it('drops the residual after the idle window', () => {
    vi.useFakeTimers()
    wheel(element(document, '.cv_root'), { ctrlKey: true, deltaY: -60 })
    vi.advanceTimersByTime(WHEEL_IDLE_MS)
    wheel(element(document, '.cv_root'), { ctrlKey: true, deltaY: -60 })
    expect(harness.steps).toEqual([])
  })

  it('drops the residual when the gesture moves to another pane', () => {
    wheel(element(document, '.cv_root'), { ctrlKey: true, deltaY: -60 })
    wheel(element(document, '.sb_root'), { ctrlKey: true, deltaY: -60 })
    expect(harness.steps).toEqual([])
  })
})

describe('pointer cache and teardown', () => {
  it('remembers the last pointer pane on pointerdown', () => {
    expect(harness.state.pointerPane).toBeNull()
    element(document, '.sb_root').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(harness.state.pointerPane).toBe('left')
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(harness.state.pointerPane).toBe('left')
  })

  it('stops handling every gesture after dispose', () => {
    harness.dispose()
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 })
    element(document, '.cv_root').dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(harness.steps).toEqual([])
  })
})
