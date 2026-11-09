export type VaultKind = 'vault' | 'gvault'
export interface VaultMemory {
  lastUpdate: number
  gold: string
  items: string
  categories: Record<string, string>
}
export interface CharacterMemory {
  version: 1
  bank?: { gold: string; lastUpdate: number }
  vault?: VaultMemory
  gvault?: VaultMemory
}
export const emptyMemory = (): CharacterMemory => ({ version: 1 })
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** Validate persisted character data. */
export function readMemory(source: string): CharacterMemory | undefined {
  try {
    const value: unknown = JSON.parse(source)
    if (!record(value) || value.version !== 1) return
    const result = emptyMemory()
    if (record(value.bank) && /^\d+$/.test(String(value.bank.gold))) {
      result.bank = {
        gold: String(value.bank.gold),
        lastUpdate: Number(value.bank.lastUpdate) || 0,
      }
    }
    for (const kind of ['vault', 'gvault'] as const) {
      const vault = value[kind]
      if (!record(vault) || typeof vault.items !== 'string' || !vault.items) continue
      if (!Number.isFinite(Number(vault.lastUpdate)) || Number(vault.lastUpdate) <= 0) continue
      if (!/^\d+$/.test(String(vault.gold))) continue
      const categories: Record<string, string> = Object.create(null)
      const entries = record(vault.categories) ? vault.categories : {}
      for (const [key, text] of Object.entries(entries)) {
        if (['lastUpdate', 'gold', 'items'].includes(key)) continue
        if (typeof text === 'string' && text && /^[\w ()'-]+$/.test(key)) categories[key] = text
      }
      result[kind] = {
        lastUpdate: Number(vault.lastUpdate),
        gold: String(vault.gold),
        items: vault.items,
        categories,
      }
    }
    return result
  } catch {
    return
  }
}

export function vaultKind(text: string): VaultKind | undefined {
  if (/^Your guild vault contains\b/.test(text)) return 'gvault'
  if (/^Your vault contains\b/.test(text)) return 'vault'
}

/** Counts stay strings so large gold balances are never rounded. */
export function parseInventory(text: string) {
  if (!vaultKind(text)) return
  const entries = [
    ...text.matchAll(
      /(\d[\d,]*)\s+([a-z][a-z '-]*(?:\(\d+\))?)(?=\s*(?:,\s*|\band\s+|\n|[.:;]|\(max\b|$))/gi,
    ),
  ].map((match) => ({ count: match[1].replaceAll(',', ''), name: match[2].trim() }))
  if (!entries.length && !/contains\s+(?:nothing|no items|0 items)\b/.test(text)) return
  const categories = entries
    .filter(({ name }) => !/^(?:gold|items?)$/i.test(name))
    .map(({ name }) => name)
  if (new Set(categories).size !== categories.length) return
  // A positive item total with no categories is incomplete, not an empty vault.
  if (
    !categories.length &&
    entries.some(({ name, count }) => /^items?$/i.test(name) && /[1-9]/.test(count))
  )
    return
  return { gold: entries.find(({ name }) => name === 'gold')?.count ?? '0', categories }
}

export function recall(memory: CharacterMemory, kind: VaultKind, query: string): string {
  const vault = memory[kind]
  const label = kind === 'vault' ? 'vault' : 'guild vault'
  if (!vault) return `No ${label} memory yet. Visit your ${label} to take inventory.`
  const names = ['items', 'gold', 'lastUpdate', ...Object.keys(vault.categories)]
  const needle = query.trim().toLowerCase()
  const matches = (name: string) => [name.toLowerCase(), `${name.toLowerCase()}s`]
  const key =
    names.find((name) => matches(name).includes(needle)) ??
    names.find((name) => matches(name).some((candidate) => candidate.includes(needle)))
  if (!key) return 'Item category not found in vault memory. Visit your vault to update it.'
  if (key === 'lastUpdate')
    return `You last took inventory of your ${label} on:\n${new Date(vault.lastUpdate).toLocaleString()}`
  if (key === 'gold') return `You recall that your ${label} contains ${vault.gold} gold`
  const text = key === 'items' ? vault.items : vault.categories[key]
  return `You recall that ${text.charAt(0).toLowerCase()}${text.slice(1)}`
}
