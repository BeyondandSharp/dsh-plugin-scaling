/** Badge and command copy, resolved from the document language. */
import { paneOfSlot } from './targets.ts'
import type { SlotId } from './targets.ts'

/** All user-visible strings the browser half needs. */
export interface PluginCopy {
  /** Display name of one slot ("左栏" / "右栏 2" / "Left"). */
  slot(slot: SlotId): string
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

/** Column suffix of a slot: `right-1` is the right sidebar's second dock column. */
function columnSuffix(slot: SlotId): string {
  const match = /^right-(\d+)$/u.exec(slot)
  return match === null ? '' : match[1] ?? ''
}

const ZH_NAMES = { left: '左栏', center: '中栏', right: '右栏' } as const
const EN_NAMES = { left: 'Left', center: 'Center', right: 'Right' } as const

const ZH: PluginCopy = {
  slot: slot => {
    const suffix = columnSuffix(slot)
    return `${ZH_NAMES[paneOfSlot(slot)]}${suffix === '' ? '' : ` ${String(Number(suffix) + 1)}`}`
  },
  percent: zoom => `${String(Math.round(zoom * 100))}%`,
  resetHint: 'Ctrl+0 复位',
  commands: { in: '放当前栏', out: '缩当前栏', reset: '当前栏复位到 100%', alias: '缩放' },
}

const EN: PluginCopy = {
  slot: slot => {
    const suffix = columnSuffix(slot)
    return `${EN_NAMES[paneOfSlot(slot)]}${suffix === '' ? '' : ` ${String(Number(suffix) + 1)}`}`
  },
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
