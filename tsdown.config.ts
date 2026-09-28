import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clientBundle } from './build/tsdown.client.ts'

const root = fileURLToPath(new URL('.', import.meta.url))
const entryPath = (entry: unknown): string => resolve(root, String(entry)).replaceAll('\\', '/')
const bundle = clientBundle(
  '@beyondandsharp/dsh-plugin-scaling',
  ['src/index.ts'],
  { portableCssModuleIds: true },
)

// The vendored preset lives in ./build, so Rolldown would otherwise anchor its
// relative entries at that directory; rebase every entry onto this package root.
export default ({ env }: { env?: Record<string, unknown> }) => bundle({ env }).map(config => ({
  ...config,
  entry: Array.isArray(config.entry)
    ? config.entry.map(entryPath)
    : typeof config.entry === 'object' && config.entry !== null
      ? Object.fromEntries(Object.entries(config.entry).map(([key, entry]) => [key, entryPath(entry)]))
      : config.entry,
}))
