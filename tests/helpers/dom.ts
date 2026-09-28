/** Shared jsdom fixtures: the host's three-column shell with optional decoration. */
import { PANE_IDS } from '../../src/client/targets.ts'

/** Fixture variations exercised by the specs. */
export interface ShellOptions {
  /** Insert a skin-style decorative node ahead of the real content root. */
  skin?: boolean
  /** Omit the right column, as when the right bar is closed. */
  withoutRight?: boolean
  /** Include a second, unselected dock cell in the same column. */
  secondDockPane?: boolean
  /** Split the right dock into both of its columns (`right` + `right-1`). */
  splitRight?: boolean
  /** Put an xterm screen inside the right dock pane. */
  withTerminal?: boolean
}

/** Query a required element, throwing with the selector when absent. */
export function element<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector)
  if (found === null) throw new Error(`fixture element not found: ${selector}`)
  return found
}

/** Every element the plugin marked, grouped by pane. */
export function marked(root: ParentNode): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const pane of PANE_IDS) {
    out[pane] = [...root.querySelectorAll(`[data-pane-scaling-target='${pane}']`)].map(node => node.className)
  }
  return out
}

function decoration(doc: Document, className: string): HTMLDivElement {
  const node = doc.createElement('div')
  node.className = className
  return node
}

function dockCell(doc: Document, options: { selected: boolean, column?: number, terminal?: boolean }): HTMLDivElement {
  const cell = doc.createElement('div')
  cell.className = 'dk_tabCell'
  cell.setAttribute('data-dockkit-host', 'dock')
  if (options.column !== undefined) cell.setAttribute('data-dockkit-column', String(options.column))
  if (!options.selected) cell.hidden = true
  const section = doc.createElement('section')
  section.className = 'dk_tabHost dk_pane'
  section.tabIndex = -1
  if (options.column !== undefined) section.setAttribute('data-dockkit-column', String(options.column))
  if (options.selected) section.setAttribute('data-dockkit-pane', `pane-${String(options.column ?? 0)}`)
  const header = doc.createElement('div')
  header.className = 'dk_tabHostHeader'
  const body = doc.createElement('div')
  body.className = 'dk_paneBody'
  if (options.terminal === true) {
    const terminal = doc.createElement('div')
    terminal.className = 'xterm'
    body.append(terminal)
  }
  section.append(header, body)
  cell.append(section)
  return cell
}

/**
 * Replace the document body with a shell shaped like the host's AppFrame:
 * three grid columns, `display: contents` slot seams, and a docked right pane.
 * @param doc - the jsdom document.
 * @param options - fixture variations.
 * @returns the frame element.
 */
export function buildShell(doc: Document, options: ShellOptions = {}): HTMLElement {
  doc.body.innerHTML = ''
  const frame = doc.createElement('div')
  frame.className = 'frame'

  const sidebarCol = doc.createElement('div')
  sidebarCol.className = 'af_sidebarCol'
  if (options.skin === true) sidebarCol.append(decoration(doc, 'sk_ornament'))
  const sidebarSlot = doc.createElement('div')
  sidebarSlot.setAttribute('data-slot', 'sidebar')
  sidebarSlot.style.display = 'contents'
  const sidebarRoot = doc.createElement('div')
  sidebarRoot.className = 'sb_root'
  const search = doc.createElement('input')
  search.setAttribute('data-slot', 'sidebar.settings')
  sidebarRoot.append(search)
  sidebarSlot.append(sidebarRoot)
  if (options.skin === true) {
    // `maid-atelier` prepends its mascot and corner art into this same seam,
    // ahead of the real root: the fixture keeps that ordering.
    sidebarSlot.prepend(decoration(doc, 'sk_sidebarMascot'))
    sidebarSlot.prepend(decoration(doc, 'sk_sidebarCorners'))
  }
  sidebarCol.append(sidebarSlot)

  const centerCol = doc.createElement('div')
  centerCol.className = 'af_centerCol'
  const conversationRoot = doc.createElement('div')
  conversationRoot.className = 'cv_root'
  const scroll = doc.createElement('div')
  scroll.setAttribute('data-conversation-scroll', '')
  const composer = doc.createElement('textarea')
  scroll.append(composer)
  conversationRoot.append(scroll)
  if (options.skin === true) {
    // `maid-atelier` prepends the character stage into the column itself,
    // outside the slot seam, and appends its chrome next to it.
    const stage = decoration(doc, 'sk_chatStage')
    stage.setAttribute('data-skin-chrome', 'chat-stage')
    const chrome = decoration(doc, 'sk_chatChrome')
    chrome.setAttribute('data-skin-chrome', 'chat-chrome')
    centerCol.append(stage, chrome)
  }
  centerCol.append(conversationRoot)

  frame.append(sidebarCol, centerCol)

  if (options.withoutRight !== true) {
    const rightbarCol = doc.createElement('div')
    rightbarCol.className = 'af_rightbarCol'
    const panel = doc.createElement('div')
    panel.className = 'sr_panel'
    panel.style.width = '320px'
    const panelBody = doc.createElement('div')
    panelBody.className = 'sr_panelBody'
    const tabLayout = doc.createElement('div')
    tabLayout.className = 'dk_tabLayout'
    if (options.splitRight === true) {
      tabLayout.append(dockCell(doc, { selected: true, column: 0 }))
      tabLayout.append(dockCell(doc, { selected: true, column: 1 }))
      const divider = doc.createElement('div')
      divider.className = 'dk_divider'
      divider.setAttribute('data-dockkit-divider', 'split:0')
      tabLayout.append(divider)
    } else {
      tabLayout.append(dockCell(doc, {
        selected: true,
        column: 0,
        ...(options.withTerminal === true ? { terminal: true } : {}),
      }))
    }
    if (options.secondDockPane === true) tabLayout.append(dockCell(doc, { selected: false, column: 0 }))
    const floatCell = doc.createElement('div')
    floatCell.className = 'dk_tabCell dk_floatingCell'
    floatCell.setAttribute('data-dockkit-host', 'float')
    const floatSection = doc.createElement('section')
    floatSection.className = 'dk_tabHost dk_float'
    floatSection.setAttribute('data-dockkit-float', 'pane-f')
    floatSection.style.position = 'fixed'
    floatCell.append(floatSection)
    tabLayout.append(floatCell)
    panelBody.append(tabLayout)
    panel.append(panelBody)
    rightbarCol.append(panel)
    frame.append(rightbarCol)
  }

  doc.body.append(frame)
  return frame
}
