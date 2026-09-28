/** Badge lifecycle, localization, and the one-time reset hint. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BADGE_ATTRIBUTE, BADGE_VISIBLE_ATTRIBUTE, BADGE_VISIBLE_MS, createBadge } from '../src/client/badge.ts'
import { copyFor } from '../src/client/copy.ts'

/** The single badge element, or null. */
function badge(): HTMLElement | null {
  return document.querySelector(`[${BADGE_ATTRIBUTE}]`)
}

describe('badge', () => {
  beforeEach(() => {
    document.documentElement.lang = 'zh-CN'
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.querySelectorAll(`[${BADGE_ATTRIBUTE}]`).forEach(node => node.remove())
    document.documentElement.lang = ''
  })

  it('mounts on body with status semantics and localized copy', () => {
    const handle = createBadge(document, copyFor(document))
    handle.show('left', 1.05)
    const node = badge()
    expect(node).not.toBeNull()
    expect(node?.parentElement).toBe(document.body)
    expect(node?.getAttribute('role')).toBe('status')
    expect(node?.getAttribute('aria-live')).toBe('polite')
    expect(node?.textContent).toContain('左栏')
    expect(node?.textContent).toContain('105%')
    handle.dispose()
  })

  it('follows <html lang>', () => {
    document.documentElement.lang = 'en'
    const handle = createBadge(document, copyFor(document))
    handle.show('right', 1.5)
    expect(badge()?.textContent).toContain('Right')
    expect(badge()?.textContent).toContain('150%')
    handle.dispose()
  })

  it('labels the split right columns apart', () => {
    document.documentElement.lang = 'en'
    const handle = createBadge(document, copyFor(document))
    handle.show('right', 1.05)
    expect(badge()?.textContent).toContain('Right 105%')
    expect(badge()?.textContent).not.toContain('Right 2')
    handle.show('right-1', 1.05)
    expect(badge()?.textContent).toContain('Right 2 105%')
    handle.dispose()
    document.documentElement.lang = 'zh-CN'
    const zh = createBadge(document, copyFor(document))
    zh.show('right-1', 0.75)
    expect(badge()?.textContent).toContain('右栏 2 75%')
    zh.dispose()
  })

  it('adds the reset hint only on the first show', () => {
    const handle = createBadge(document, copyFor(document))
    handle.show('center', 1)
    expect(badge()?.textContent).toContain('Ctrl+0 复位')
    handle.show('center', 1.05)
    expect(badge()?.textContent).not.toContain('Ctrl+0 复位')
    handle.dispose()
  })

  it('hides after the visible window and removes itself on dispose', () => {
    const handle = createBadge(document, copyFor(document))
    handle.show('left', 1.1)
    expect(badge()?.hasAttribute(BADGE_VISIBLE_ATTRIBUTE)).toBe(true)
    vi.advanceTimersByTime(BADGE_VISIBLE_MS - 1)
    expect(badge()?.hasAttribute(BADGE_VISIBLE_ATTRIBUTE)).toBe(true)
    vi.advanceTimersByTime(1)
    expect(badge()?.hasAttribute(BADGE_VISIBLE_ATTRIBUTE)).toBe(false)
    expect(badge()).not.toBeNull()
    handle.dispose()
    expect(badge()).toBeNull()
  })

  it('restarts the visible window on a repeated show', () => {
    const handle = createBadge(document, copyFor(document))
    handle.show('left', 1.05)
    vi.advanceTimersByTime(BADGE_VISIBLE_MS - 10)
    handle.show('left', 1.1)
    vi.advanceTimersByTime(BADGE_VISIBLE_MS - 10)
    expect(badge()?.hasAttribute(BADGE_VISIBLE_ATTRIBUTE)).toBe(true)
    vi.advanceTimersByTime(10)
    expect(badge()?.hasAttribute(BADGE_VISIBLE_ATTRIBUTE)).toBe(false)
    handle.dispose()
  })

  it('cancels a pending hide on dispose', () => {
    const handle = createBadge(document, copyFor(document))
    handle.show('left', 1.05)
    handle.dispose()
    vi.advanceTimersByTime(BADGE_VISIBLE_MS * 2)
    expect(badge()).toBeNull()
  })
})
