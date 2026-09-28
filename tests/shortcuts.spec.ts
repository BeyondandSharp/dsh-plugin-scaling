/** Shortcut integration: host registration, web fallback, and teardown. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { COMMAND_IDS, installShortcuts } from '../src/client/shortcuts.ts'
import type { HostShortcutCommand, HostShortcutService } from '../src/client/host.ts'
import { copyFor } from '../src/client/copy.ts'
import type { PaneId } from '../src/client/targets.ts'

/** Recorded step calls. */
type Step = [PaneId, 1 | -1 | 0]

/** A stub service that records registrations. */
function service(runtime: 'desktop' | 'web', failOn?: string): {
  stub: HostShortcutService
  registered: HostShortcutCommand[]
  disposed: string[]
} {
  const registered: HostShortcutCommand[] = []
  const disposed: string[] = []
  const stub: HostShortcutService = {
    runtime,
    platform: 'linux',
    register(command) {
      if (command.id === failOn) throw new Error('Duplicate shortcut command')
      registered.push(command)
      return () => { disposed.push(command.id) }
    },
  }
  return { stub, registered, disposed }
}

/** A context object good enough for the host command contract. */
function ctxFor(stub: HostShortcutService): { get(name: string): unknown } {
  return { get: name => (name === 'shortcuts' ? stub : undefined) }
}

/** Install with recording stubs. */
function install(options: { runtime?: 'desktop' | 'web', failOn?: string, noService?: boolean } = {}): {
  steps: Step[]
  target: { pane: PaneId | null }
  install: ReturnType<typeof installShortcuts>
  warn: ReturnType<typeof vi.fn>
  registered: HostShortcutCommand[]
  disposed: string[]
} {
  const steps: Step[] = []
  const target: { pane: PaneId | null } = { pane: 'center' }
  const { stub, registered, disposed } = service(options.runtime ?? 'desktop', options.failOn)
  const warn = vi.fn()
  const handle = installShortcuts(
    document,
    options.noService === true ? {} : ctxFor(stub),
    { paneFor: () => target.pane, step: (pane, direction) => steps.push([pane, direction]) },
    warn,
    copyFor(document),
  )
  return { steps, target, install: handle, warn, registered, disposed }
}

/** Dispatch a keydown on the window and report whether it was cancelled. */
function key(init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

afterEach(() => {
  document.documentElement.lang = ''
  document.body.innerHTML = ''
})

describe('host integration (desktop runtime)', () => {
  it('registers the three commands with desktop-only, browser-legal defaults', () => {
    const harness = install({ runtime: 'desktop' })
    expect(harness.install.mode).toBe('host')
    expect(harness.registered.map(command => command.id)).toEqual([
      COMMAND_IDS.in, COMMAND_IDS.out, COMMAND_IDS.reset,
    ])
    for (const command of harness.registered) {
      expect(command.regions).toEqual(['page', 'editable'])
      expect(command.modals).toEqual([])
      expect(Object.keys(command.defaults).sort()).toEqual([
        'desktop:linux', 'desktop:macos', 'desktop:windows',
      ])
      for (const binding of Object.values(command.defaults)) {
        expect(binding.modifiers).toEqual(['primary'])
        // The host's code whitelist has no Numpad codes: declaring one throws.
        expect(['Equal', 'Minus', 'Digit0']).toContain(binding.code)
      }
      expect(command.label().length).toBeGreaterThan(0)
      expect(command.aliases).toContain('pane zoom')
    }
    expect(harness.registered.map(command => Object.values(command.defaults)[0]?.code))
      .toEqual(['Equal', 'Minus', 'Digit0'])
    harness.install.dispose()
  })

  it('resolves the command target to a pane and steps it exactly once per run', () => {
    const harness = install({ runtime: 'desktop' })
    const increase = harness.registered[0]
    const context = { region: 'page' as const, modal: null, target: document.body }
    const resolution = increase?.resolve(context)
    expect(resolution).toEqual({ status: 'handled', run: expect.any(Function) })
    expect(harness.steps).toEqual([])
    if (resolution?.status === 'handled') resolution.run()
    expect(harness.steps).toEqual([['center', 1]])
    harness.target.pane = 'right'
    const decrease = harness.registered[1]
    const out = decrease?.resolve(context)
    if (out?.status === 'handled') out.run()
    expect(harness.steps).toEqual([['center', 1], ['right', -1]])
    harness.install.dispose()
  })

  it('passes when no pane can be resolved', () => {
    const harness = install({ runtime: 'desktop' })
    harness.target.pane = null
    expect(harness.registered[0]?.resolve({ region: 'page', modal: null, target: null }))
      .toEqual({ status: 'pass' })
    harness.install.dispose()
  })

  it('never installs the private listener alongside the host path', () => {
    const harness = install({ runtime: 'desktop' })
    expect(key({ code: 'Equal', ctrlKey: true })).toBe(false)
    expect(harness.steps).toEqual([])
    harness.install.dispose()
  })

  it('releases the host registrations on dispose', () => {
    const harness = install({ runtime: 'desktop' })
    harness.install.dispose()
    expect(harness.disposed).toEqual([COMMAND_IDS.in, COMMAND_IDS.out, COMMAND_IDS.reset])
  })
})

describe('private fallback', () => {
  it('uses the built-in listener on the web runtime and explains why', () => {
    const harness = install({ runtime: 'web' })
    expect(harness.install.mode).toBe('private')
    expect(harness.registered).toEqual([])
    expect(harness.warn).toHaveBeenCalledTimes(1)
    expect(String(harness.warn.mock.calls[0]?.[0])).toContain('web shell')
    expect(key({ code: 'Equal', ctrlKey: true })).toBe(true)
    expect(harness.steps).toEqual([['center', 1]])
    harness.install.dispose()
  })

  it('falls back when the service is absent, without warning', () => {
    const harness = install({ noService: true })
    expect(harness.install.mode).toBe('private')
    expect(harness.warn).not.toHaveBeenCalled()
    expect(key({ code: 'Minus', ctrlKey: true })).toBe(true)
    expect(harness.steps).toEqual([['center', -1]])
    harness.install.dispose()
  })

  it('rolls a partial registration back and falls back when the host rejects a command', () => {
    const harness = install({ runtime: 'desktop', failOn: COMMAND_IDS.out })
    expect(harness.install.mode).toBe('private')
    expect(harness.disposed).toEqual([COMMAND_IDS.in])
    expect(harness.warn).toHaveBeenCalledTimes(1)
    expect(key({ code: 'Digit0', ctrlKey: true })).toBe(true)
    expect(harness.steps).toEqual([['center', 0]])
    harness.install.dispose()
  })

  it('accepts every supported modifier and key variant', () => {
    const harness = install({ runtime: 'web' })
    expect(key({ code: 'Equal', ctrlKey: true })).toBe(true)
    expect(key({ code: 'Equal', metaKey: true })).toBe(true)
    expect(key({ code: 'Equal', ctrlKey: true, shiftKey: true })).toBe(true)
    expect(key({ code: 'NumpadAdd', ctrlKey: true })).toBe(true)
    expect(key({ code: 'Minus', ctrlKey: true })).toBe(true)
    expect(key({ code: 'NumpadSubtract', ctrlKey: true })).toBe(true)
    expect(key({ code: 'Digit0', ctrlKey: true })).toBe(true)
    expect(key({ code: 'Numpad0', ctrlKey: true })).toBe(true)
    expect(harness.steps).toEqual([
      ['center', 1], ['center', 1], ['center', 1], ['center', 1],
      ['center', -1], ['center', -1], ['center', 0], ['center', 0],
    ])
    harness.install.dispose()
  })

  it('ignores unbound, alt-modified, and already-handled input', () => {
    const harness = install({ runtime: 'web' })
    expect(key({ code: 'Equal' })).toBe(false)
    expect(key({ code: 'Equal', ctrlKey: true, altKey: true })).toBe(false)
    expect(key({ code: 'KeyB', ctrlKey: true })).toBe(false)
    expect(key({ code: 'Equal', ctrlKey: true, metaKey: true, altKey: true })).toBe(false)
    const handled = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ctrlKey: true, code: 'Equal' })
    handled.preventDefault()
    window.dispatchEvent(handled)
    expect(harness.steps).toEqual([])
    harness.install.dispose()
  })

  it('cancels a held key without repeating the step', () => {
    const harness = install({ runtime: 'web' })
    expect(key({ code: 'Equal', ctrlKey: true, repeat: true })).toBe(true)
    expect(harness.steps).toEqual([])
    harness.install.dispose()
  })

  it('stops handling keys after dispose', () => {
    const harness = install({ runtime: 'web' })
    harness.install.dispose()
    expect(key({ code: 'Equal', ctrlKey: true })).toBe(false)
    expect(harness.steps).toEqual([])
  })

  it('leaves the terminal to its own owner while it holds focus', () => {
    const harness = install({ runtime: 'web' })
    const terminal = document.createElement('div')
    terminal.className = 'xterm'
    terminal.tabIndex = 0
    document.body.append(terminal)
    terminal.focus()
    expect(document.activeElement).toBe(terminal)
    expect(key({ code: 'Equal', ctrlKey: true })).toBe(false)
    expect(harness.steps).toEqual([])
    harness.install.dispose()
  })
})
