/**
 * Keyboard access: the host `shortcuts` service when it can own the keys, and a
 * private capture listener otherwise.
 *
 * The host validates every declared default for all six shell/platform profiles
 * and rejects `Ctrl+Equal` under `web:*` as `unsupported-browser` — and its
 * physical-code whitelist has no `Numpad*` codes at all — so the web shell has
 * to use the private path, and the two paths must never run together (the host
 * dispatches keydown in the bubble phase, a second handler would step twice).
 */
import { copyFor } from './copy.ts'
import { readShortcutService } from './host.ts'
import type { HostShortcutCommand } from './host.ts'
import type { PluginCopy } from './copy.ts'
import { isExcludedSurface } from './targets.ts'
import type { PaneId } from './targets.ts'

/** Command ids; they satisfy the host's `commandPattern` and are user-editable. */
export const COMMAND_IDS = {
  in: 'pane-scaling.in',
  out: 'pane-scaling.out',
  reset: 'pane-scaling.reset',
} as const

/** Which code maps to which zoom direction. */
const DIRECTION_BY_CODE: Readonly<Record<string, 1 | -1 | 0>> = {
  Equal: 1,
  NumpadAdd: 1,
  Minus: -1,
  NumpadSubtract: -1,
  Digit0: 0,
  Numpad0: 0,
}

/** Engine hooks the keyboard path needs. */
export interface ShortcutTargets {
  /** Resolve the pane a keyboard gesture acts on, or null when it must be left alone. */
  paneFor(target: Element | null): PaneId | null
  /** Apply one step to a pane. */
  step(pane: PaneId, direction: 1 | -1 | 0): void
}

/** The installed keyboard path. */
export interface ShortcutInstall {
  /** `host` when the service owns the keys, `private` when the built-in listener does. */
  readonly mode: 'host' | 'private'
  dispose(): void
}

/** Zoom direction for a physical key code, or undefined when unrelated. */
function directionOfCode(code: string): 1 | -1 | 0 | undefined {
  return Object.hasOwn(DIRECTION_BY_CODE, code) ? DIRECTION_BY_CODE[code] : undefined
}

/** Build the three host command definitions (desktop profiles only). */
function commands(copy: PluginCopy, targets: ShortcutTargets): HostShortcutCommand[] {
  const make = (
    id: string,
    label: string,
    alias: string,
    code: string,
    direction: 1 | -1 | 0,
  ): HostShortcutCommand => {
    const binding = { code, modifiers: ['primary'] }
    return {
      id,
      label: () => label,
      aliases: [alias, copy.commands.alias],
      defaults: {
        'desktop:macos': binding,
        'desktop:windows': binding,
        'desktop:linux': binding,
      },
      regions: ['page', 'editable'],
      modals: [],
      resolve: (context) => {
        const pane = targets.paneFor(context.target)
        if (pane === null) return { status: 'pass' }
        return { status: 'handled', run: () => { targets.step(pane, direction) } }
      },
    }
  }
  return [
    make(COMMAND_IDS.in, copy.commands.in, 'zoom in', 'Equal', 1),
    make(COMMAND_IDS.out, copy.commands.out, 'zoom out', 'Minus', -1),
    make(COMMAND_IDS.reset, copy.commands.reset, 'reset zoom', 'Digit0', 0),
  ]
}

/**
 * Install keyboard access.
 * @param doc - the product document.
 * @param ctx - the plugin's cordis context (read for the optional service).
 * @param targets - pane resolution and stepping.
 * @param warn - one-time diagnostic sink.
 * @param copyOverride - localized copy override (tests only).
 * @returns the install handle; `dispose` releases whichever path was taken.
 */
export function installShortcuts(
  doc: Document,
  ctx: unknown,
  targets: ShortcutTargets,
  warn: (message: string, error?: unknown) => void = (message, error) => { console.warn(message, error) },
  copyOverride?: PluginCopy,
): ShortcutInstall {
  const copy = copyOverride ?? copyFor(doc)
  const service = readShortcutService(ctx)

  if (service !== undefined && service.runtime === 'desktop') {
    const disposers: Array<() => void> = []
    try {
      for (const command of commands(copy, targets)) {
        disposers.push(service.register(command))
      }
      return {
        mode: 'host',
        dispose: () => { for (const dispose of disposers.splice(0)) dispose() },
      }
    } catch (error) {
      for (const dispose of disposers.splice(0)) dispose()
      warn('pane scaling: the host rejected the shortcut registration; falling back to built-in keys', error)
    }
  } else if (service !== undefined) {
    warn('pane scaling: the web shell cannot bind Ctrl+±/0 through the shortcut service (browser-reserved); built-in keys are used and stay fixed')
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.altKey) return
    if (!event.ctrlKey && !event.metaKey) return
    const direction = directionOfCode(event.code)
    if (direction === undefined) return
    const target = doc.activeElement
    if (isExcludedSurface(target)) return
    const pane = targets.paneFor(target)
    if (pane === null) return
    event.preventDefault()
    // Match the host's semantics: held keys do not repeat the action.
    if (event.repeat) return
    targets.step(pane, direction)
  }

  const view = doc.defaultView
  view?.addEventListener('keydown', onKeyDown, true)
  return {
    mode: 'private',
    dispose: () => { view?.removeEventListener('keydown', onKeyDown, true) },
  }
}
