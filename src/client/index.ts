/** Browser half: wires the engine to the plugin's effect lifecycle. */
import type { Context } from '@deepseek-ai/cordis'
import './scaling.module.css'
import { installPaneScaling } from './scaling.ts'

/**
 * The browser half declares no service dependency on purpose: `shortcuts` is read
 * optionally so the private keydown fallback stays reachable.
 */
export const inject: string[] = []

/**
 * Activate the pane-scaling engine for as long as the plugin is enabled.
 * @param ctx - plugin-owned client context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => installPaneScaling(document.body, ctx), 'ui-plugin-scaling: pane scaling')
}
