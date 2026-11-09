import { cp, lstat, mkdir, readFile, unlink, symlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const candidates = [resolve(root, '../types'), resolve(root, '../duplicis/packages/types')]
const source = resolve(
  process.argv[2] ??
    candidates.find((path) => existsSync(resolve(path, 'package.json'))) ??
    candidates[0],
)
const manifest = JSON.parse(await readFile(resolve(source, 'package.json'), 'utf8'))
if (
  manifest.name !== '@duplicis/types' ||
  !manifest.exports['./plugin-utils'] ||
  !existsSync(resolve(source, 'src/client/ui.d.ts'))
)
  throw new Error('Choose the updated public @duplicis/types checkout with the plugin utility API')

// Use a copy of public declarations so neither private source nor a mutable pnpm store is linked.
const snapshot = resolve(root, '.local/types')
await mkdir(snapshot, { recursive: true })
await cp(resolve(source, 'src'), resolve(snapshot, 'src'), { recursive: true })
await cp(resolve(source, 'package.json'), resolve(snapshot, 'package.json'))
const target = resolve(root, 'node_modules/@duplicis/types')
const installed = await lstat(target).catch((error) => {
  if (error.code !== 'ENOENT') throw error
})
if (installed) {
  if (!installed.isSymbolicLink())
    throw new Error('Expected pnpm to install @duplicis/types as a symlink')
  await unlink(target)
}
await mkdir(dirname(target), { recursive: true })
await symlink(snapshot, target, process.platform === 'win32' ? 'junction' : 'dir')
console.log(`Using public declaration snapshot from ${source}`)
