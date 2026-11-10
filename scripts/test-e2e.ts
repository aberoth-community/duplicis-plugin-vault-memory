import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const candidates = [resolve(pluginRoot, '../..'), resolve(pluginRoot, '../duplicis')]
const defaultClient = candidates.find((path) =>
  existsSync(resolve(path, 'apps/client/package.json')),
)
const clientRoot = resolve(process.env.DUPLICIS_CLIENT_ROOT ?? defaultClient ?? candidates[0])
const clientPackage = resolve(clientRoot, 'apps/client/package.json')
const harness = resolve(clientRoot, 'test/e2e/src/helpers/electron.ts')
const playwright = resolve(clientRoot, 'test/e2e/node_modules/@playwright/test/package.json')
const pnpmCli = process.env.npm_execpath

if (!existsSync(clientPackage) || !existsSync(harness)) {
  console.error(`Duplicis client checkout with the Electron test harness not found: ${clientRoot}`)
  console.error('Set DUPLICIS_CLIENT_ROOT to a compatible Duplicis checkout.')
  process.exit(1)
}
if (JSON.parse(readFileSync(clientPackage, 'utf8')).name !== '@duplicis/client') {
  console.error(`Not a Duplicis client checkout: ${clientRoot}`)
  process.exit(1)
}
if (!existsSync(playwright)) {
  console.error(`Client test dependencies are missing. Run pnpm install in ${clientRoot} first.`)
  process.exit(1)
}
if (!pnpmCli) {
  console.error('Run this script via pnpm test:e2e so it can use the pinned pnpm CLI.')
  process.exit(1)
}

const env: NodeJS.ProcessEnv = { ...process.env, DUPLICIS_CLIENT_ROOT: clientRoot }
// vite-node sets development mode before this script runs; builds need Vite's normal default.
if (env.NODE_ENV === 'development') delete env.NODE_ENV
const run = (cwd: string, args: string[]) => {
  const result = spawnSync(process.execPath, [pnpmCli, ...args], { cwd, env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// Build both sides so stale output cannot make the test exercise an old plugin or client.
run(pluginRoot, ['run', 'build'])
run(clientRoot, ['-C', 'apps/client', 'run', 'build'])
run(clientRoot, [
  '-C',
  'test/e2e',
  'exec',
  'playwright',
  'test',
  '--config',
  resolve(pluginRoot, 'playwright.config.ts'),
  ...process.argv.slice(2).filter((arg) => arg !== '--'),
])
