/** Badge and command copy, resolved from the document language. */
import type { PaneId } from './targets.ts'

/** All user-visible strings the browser half needs. */
export interface PluginCopy {
  /** Display name of one pane ("左栏" / "Left"). */
  pane(pane: PaneId): string
  /** Percent label for a zoom factor ("105%"). */
  percent(zoom: number): string
  /** One-time hint appended to the first badge. */
  resetHint: string
  /** Localized labels for the three host shortcut commands. */
  commands: {
    in: string
    out: string
    reset: string
    alias: string
  }
}

const ZH: PluginCopy = {
  pane: pane => ({ left: '左栏', center: '中栏', right: '右栏' })[pane],
  percent: zoom => `${String(Math.round(zoom * 100))}%`,
  resetHint: 'Ctrl+0 复位',
  commands: { in: '放当前栏', out: '缩当前栏', reset: '当前栏复位到 100%', alias: '缩放' },
}

const EN: PluginCopy = {
  pane: pane => ({ left: 'Left', center: 'Center', right: 'Right' })[pane],
  percent: zoom => `${String(Math.round(zoom * 100))}%`,
  resetHint: 'Ctrl+0 resets',
  commands: { in: 'Zoom the current pane in', out: 'Zoom the current pane out', reset: 'Reset the current pane to 100%', alias: 'pane zoom' },
}

/**
 * Pick the dictionary from `<html lang>`; no host locale service is consulted so
 * the plugin stays usable in any shell and under any skin.
 * @param doc - the product document.
 * @returns the resolved copy.
 */
export function copyFor(doc: Document): PluginCopy {
  const lang = (doc.documentElement.lang ?? '').trim().toLowerCase()
  return lang.startsWith('zh') ? ZH : EN
}
