import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'jsdom',
    pool: 'forks',
    // Style sheets are asserted as source text by tests/css-contract.spec.ts;
    // the engine modules never import CSS, so nothing needs Vitest's CSS pipeline.
    css: false,
  },
})
