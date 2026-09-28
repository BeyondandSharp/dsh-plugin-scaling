/**
 * Minimal structural types for the host `shortcuts` service.
 *
 * Kept local on purpose: the client bundle's purity gate rejects value imports
 * of host packages, and the service is duck-typed at runtime anyway (the plugin
 * must keep working when the service is absent).
 */

/** Input owner resolved before an application command. */
export type HostShortcutRegion = 'page' | 'editable' | 'terminal'

/** Synchronous DOM context handed to `resolve`. */
export interface HostShortcutContext {
  readonly region: HostShortcutRegion
  readonly modal: string | null
  /** The original input element, or null when no document target is available. */
  readonly target: Element | null
}

/** A resolved action, or a pass so another owner can handle the keys. */
export type HostShortcutResolution =
  | { status: 'handled', run(): void }
  | { status: 'blocked', reason: string }
  | { status: 'pass' }

/** One physical key plus its abstract modifiers. */
export interface HostShortcutBinding {
  readonly code: string
  readonly modifiers: readonly string[]
}

/** Command shape accepted by `Shortcuts.register`. */
export interface HostShortcutCommand {
  readonly id: string
  readonly label: () => string
  readonly aliases: readonly string[]
  /** Only `desktop:*` profiles are declared: the web shell rejects Ctrl+±/0. */
  readonly defaults: Readonly<Record<string, HostShortcutBinding>>
  readonly regions: readonly HostShortcutRegion[]
  readonly modals: readonly string[]
  resolve(context: HostShortcutContext): HostShortcutResolution
}

/** The slice of the host service this plugin consumes. */
export interface HostShortcutService {
  readonly runtime?: 'desktop' | 'web'
  readonly platform?: 'macos' | 'windows' | 'linux'
  register(command: HostShortcutCommand): () => void
}

/**
 * Duck-type `ctx.get('shortcuts')` without importing a host package.
 * @param ctx - the plugin's cordis context (unknown on purpose).
 * @returns the service when it looks usable, otherwise undefined.
 */
export function readShortcutService(ctx: unknown): HostShortcutService | undefined {
  const get = (ctx as { get?: unknown } | null | undefined)?.get
  if (typeof get !== 'function') return undefined
  let service: unknown
  try {
    service = (get as (name: string) => unknown).call(ctx, 'shortcuts')
  } catch (_error) {
    return undefined
  }
  if (typeof service !== 'object' || service === null) return undefined
  const candidate = service as Partial<HostShortcutService>
  if (typeof candidate.register !== 'function') return undefined
  return candidate as HostShortcutService
}
