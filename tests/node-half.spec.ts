/**
 * Node-half contract: cordis only accepts a function, a class, or an object with
 * an `apply`, so a module exporting `name` alone is reported by the host as
 * `failed to import` with no further detail. This spec keeps that trap closed.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as nodeHalf from '../src/index.ts'

describe('node half', () => {
  it('exports the cordis plugin id and an apply', () => {
    expect(nodeHalf.name).toBe('ui-plugin-scaling')
    expect(typeof nodeHalf.apply).toBe('function')
  })

  it('is accepted by cordis as a plugin', () => {
    const ctx = new Context()
    expect(() => { ctx.plugin(nodeHalf) }).not.toThrow()
    expect(() => { nodeHalf.apply() }).not.toThrow()
  })

  it('documents the rejection this shape avoids', () => {
    const ctx = new Context()
    expect(() => { ctx.plugin({ name: 'ui-plugin-scaling' } as never) }).toThrow(/invalid plugin/)
  })
})
