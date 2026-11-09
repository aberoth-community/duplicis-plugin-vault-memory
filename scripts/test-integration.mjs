import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
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
) {
  console.error('Set DUPLICIS_CLIENT_ROOT to a compatible Duplicis checkout with test fixtures.')
  process.exit(1)
}
const pnpmCli = process.env.npm_execpath
if (!pnpmCli) throw new Error('Run this suite via pnpm test:integration')
const result = spawnSync(
  process.execPath,
  [
    pnpmCli,
    'exec',
    'vitest',
    'run',
    '--config',
    'vitest.integration.config.ts',
    ...process.argv.slice(2),
  ],
  {
    cwd: pluginRoot,
    env: { ...process.env, DUPLICIS_CLIENT_ROOT: clientRoot },
    stdio: 'inherit',
  },
)
if (result.error) throw result.error
process.exit(result.status ?? 1)
