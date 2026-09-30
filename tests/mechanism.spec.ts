/** Scaling mechanism: the opt-in, the engine probe, and the published attribute. */
import { describe, expect, it } from 'vitest'
import {
  MECHANISM_ATTRIBUTE, MECHANISM_KEY, isGecko, probeScaleMechanism, readMechanismSetting,
} from '../src/client/mechanism.ts'
import type { MechanismStore } from '../src/client/mechanism.ts'

describe('scaling mechanism probe', () => {
  it('defaults to transform on Gecko and zoom elsewhere', () => {
    expect(probeScaleMechanism(geckoWindow())).toBe('transform')
    expect(probeScaleMechanism(chromeWindow())).toBe('zoom')
    // A window that cannot answer the probe is not Gecko: keep the safe arm.
    expect(probeScaleMechanism(undefined)).toBe('zoom')
  })

  it('selects transform when the stored key asks for it', () => {
    expect(probeScaleMechanism(chromeWindow('transform'))).toBe('transform')
    expect(probeScaleMechanism(geckoWindow('transform'))).toBe('transform')
  })

  it('keeps the engine probe when the stored value is `auto`', () => {
    expect(probeScaleMechanism(geckoWindow('auto'))).toBe('transform')
    expect(probeScaleMechanism(chromeWindow('auto'))).toBe('zoom')
  })

  it('explicitly pins zoom even on Gecko', () => {
    expect(probeScaleMechanism(geckoWindow('zoom'))).toBe('zoom')
  })

  it('falls back to the engine probe for an unknown, empty, or unreadable key', () => {
    expect(readMechanismSetting(storeOf('nonsense'))).toBeUndefined()
    expect(readMechanismSetting(storeOf(''))).toBeUndefined()
    expect(readMechanismSetting(undefined)).toBeUndefined()
    expect(readMechanismSetting({ getItem: () => { throw new Error('denied') } })).toBeUndefined()
    expect(probeScaleMechanism(geckoWindow('nonsense'))).toBe('transform')
    expect(probeScaleMechanism(chromeWindow('nonsense'))).toBe('zoom')
  })

  it('lets the caller override the decision', () => {
    expect(probeScaleMechanism(geckoWindow('transform'), 'zoom')).toBe('zoom')
    expect(probeScaleMechanism(chromeWindow(), 'transform')).toBe('transform')
  })

  it('publishes the attribute and key the rest of the plugin shares', () => {
    expect(MECHANISM_ATTRIBUTE).toBe('data-pane-scaling-mechanism')
    expect(MECHANISM_KEY).toBe('dsh.plugin-scaling.mechanism')
  })
})

describe('gecko detection', () => {
  it('recognizes the prefixed capability probe', () => {
    expect(isGecko(geckoWindow())).toBe(true)
    expect(isGecko(undefined)).toBe(false)
  })

  it('keeps the user agent as a fallback signal', () => {
    const firefox = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:141.0) Gecko/20100101 Firefox/141.0'
    expect(isGecko(windowWith({ userAgent: firefox, supports: () => false }))).toBe(true)
    expect(isGecko(chromeWindow())).toBe(false)
  })
})

/** A store answering one key. */
function storeOf(value: string): MechanismStore {
  return { getItem: key => (key === MECHANISM_KEY ? value : null) }
}

/** A window whose `CSS.supports` reports Gecko-only properties. */
function geckoWindow(mechanism?: string): Window {
  return windowWith({ supports: property => property === '-moz-appearance', mechanism })
}

/** A Blink-like window. */
function chromeWindow(mechanism?: string): Window {
  return windowWith({ supports: () => false, mechanism })
}

/** The slice of `Window` the probe reads, faked per case. */
function windowWith(facts: {
  supports: (property: string, value: string) => boolean
  userAgent?: string
  mechanism?: string
}): Window {
  return {
    CSS: { supports: facts.supports },
    navigator: { userAgent: facts.userAgent ?? 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' },
    localStorage: storeOf(facts.mechanism ?? ''),
  } as unknown as Window
}
