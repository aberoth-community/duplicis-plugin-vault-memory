import { resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const pluginRoot = fileURLToPath(new URL('.', import.meta.url))
const candidates = [resolve(pluginRoot, '../..'), resolve(pluginRoot, '../duplicis')]
const defaultClient = candidates.find((path) =>
  existsSync(resolve(path, 'apps/client/package.json')),
)
const clientRoot = resolve(process.env.DUPLICIS_CLIENT_ROOT ?? defaultClient ?? candidates[0])
const manifest = resolve(clientRoot, 'apps/client/package.json')
if (
  !existsSync(manifest) ||
  JSON.parse(readFileSync(manifest, 'utf8')).name !== '@duplicis/client' ||
  !existsSync(resolve(clientRoot, 'test/unit/game.ts'))
)
  throw new Error('Set DUPLICIS_CLIENT_ROOT to a compatible Duplicis checkout with test fixtures.')

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@duplicis\/core$/, replacement: resolve(clientRoot, 'test/unit/core.ts') },
      { find: '@duplicis/test/game', replacement: resolve(clientRoot, 'test/unit/game.ts') },
      {
        find: '@duplicis/test/chat-controller',
        replacement: resolve(clientRoot, 'packages/plugin-chat-system/src/controller.ts'),
      },
      {
        find: '@duplicis/test/chat-commands',
        replacement: resolve(clientRoot, 'packages/plugin-chat-system/src/commands.ts'),
      },
    ],
  },
  test: { include: ['test/integration/**/*.test.ts'] },
})
