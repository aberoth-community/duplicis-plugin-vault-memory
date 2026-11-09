import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const clientRoot = process.env.DUPLICIS_CLIENT_ROOT
if (!clientRoot) throw new Error('Run this suite with pnpm test:integration')

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
