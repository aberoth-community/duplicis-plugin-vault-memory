export type VaultKind = 'vault' | 'gvault'
export interface VaultMemory {
  lastUpdate: number
  gold: string
  items: string
  categories: Record<string, string>
  history?: Record<string, QuantitySeries>
}
export interface QuantitySeries {
  label: string
  category: string
  points: { time: number; value: string }[]
  delta?: string
  scanDelta?: string
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
        history: readHistory(vault.history),
      }
    }
    return result
  } catch {
    return
  }
}

function readHistory(value: unknown): Record<string, QuantitySeries> | undefined {
  if (!record(value)) return
  const result: Record<string, QuantitySeries> = Object.create(null)
  for (const [key, series] of Object.entries(value)) {
    if (
      !record(series) ||
      typeof series.label !== 'string' ||
      typeof series.category !== 'string' ||
      !Array.isArray(series.points)
    )
      continue
    const points = series.points.filter(
      (point) =>
        record(point) &&
        Number.isFinite(point.time) &&
        Number(point.time) > 0 &&
        typeof point.value === 'string' &&
        /^\d+$/.test(point.value),
    ) as QuantitySeries['points']
    if (
      !points.length ||
      points.some((point, index) => index > 0 && point.time < points[index - 1].time)
    )
      continue
    result[key] = {
      label: series.label,
      category: series.category,
      points,
      delta:
        typeof series.delta === 'string' && /^-?\d+$/.test(series.delta) ? series.delta : undefined,
      scanDelta:
        typeof series.scanDelta === 'string' && /^-?\d+$/.test(series.scanDelta)
          ? series.scanDelta
          : undefined,
    }
  }
  return result
}

export type PlotRange = 'day' | 'week' | 'month' | 'threeMonths'

export function plotStart(time: number, range: PlotRange): number {
  if (range === 'day') return time - 24 * 60 * 60 * 1000
  if (range === 'week') return time - 7 * 24 * 60 * 60 * 1000
  const date = new Date(time)
  const day = date.getDate()
  date.setDate(1)
  date.setMonth(date.getMonth() - (range === 'month' ? 1 : 3))
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  date.setDate(Math.min(day, lastDay))
  return date.getTime()
}

export const threeMonthsAgo = (time: number): number => plotStart(time, 'threeMonths')

/** Parse overview categories and individual entries while retaining exact integer quantities. */
export function quantityEntries(text: string) {
  return [
    ...text.matchAll(
      /(\d[\d,]*)\s+([a-z][a-z '-]*(?:\(\d+\))?)(?=\s*(?:,\s*|\band\s+|\n|[.:;]|\(max\b|$))/gi,
    ),
  ].map((match) => ({ value: match[1].replaceAll(',', ''), label: match[2].trim() }))
}

/** Category responses may put the item list after a colon or on the next line. */
export function categoryItems(text: string) {
  const detail = text.match(/^Your (?:guild )?vault contains[^\n:]*[:\n]\s*([\s\S]*)$/)?.[1]
  if (!detail) return []
  return detail.split(/\r?\n|,\s+(?=\d[\d,]*\s)|\s+and\s+(?=\d[\d,]*\s)/).flatMap((line) => {
    const match = line.trim().match(/^(\d[\d,]*)\s+(.+?)[.;]?$/)
    return match ? [{ value: match[1].replaceAll(',', ''), label: match[2].trim() }] : []
  })
}

function quantities(vault: VaultMemory) {
  const result = new Map<string, { label: string; category: string; value: string }>()
  for (const entry of quantityEntries(vault.items)) {
    if (/^(gold|items?)$/i.test(entry.label)) continue
    result.set(`category:${entry.label.toLowerCase()}`, { ...entry, category: '' })
  }
  for (const [category, text] of Object.entries(vault.categories)) {
    for (const entry of categoryItems(text)) {
      const key = `item:${category.toLowerCase()}:${entry.label.toLowerCase()}`
      const previous = result.get(key)
      result.set(key, {
        ...entry,
        category,
        value: (BigInt(previous?.value ?? '0') + BigInt(entry.value)).toString(),
      })
    }
  }
  return result
}

/** Server item names can switch between "short sword" and "short swords". */
export function sameName(left: string, right: string): boolean {
  const variants = (name: string) => {
    const [noun, ...suffix] = name.toLowerCase().split(/(?= of | \(\d+\)$)/)
    return [noun, `${noun}s`, `${noun}es`, noun.replace(/y$/, 'ies')].map(
      (word) => word + suffix.join(''),
    )
  }
  return (
    variants(left).includes(right.toLowerCase()) || variants(right).includes(left.toLowerCase())
  )
}

/** Only call for a completed scan. Unchanged observations move the last point forward. */
export function withHistory(previous: VaultMemory | undefined, next: VaultMemory): VaultMemory {
  const history: Record<string, QuantitySeries> = structuredClone(
    previous?.history ?? Object.create(null),
  )
  if (previous) {
    for (const [key, entry] of quantities(previous))
      history[key] ??= {
        label: entry.label,
        category: entry.category,
        points: [{ time: previous.lastUpdate, value: entry.value }],
      }
  }
  const current = quantities(next)
  for (const [key, entry] of [...current]) {
    if (history[key]) continue
    const existing = Object.keys(history).find(
      (candidate) =>
        candidate.split(':')[0] === key.split(':')[0] &&
        sameName(history[candidate].category, entry.category) &&
        sameName(history[candidate].label, entry.label),
    )
    if (existing) {
      current.delete(key)
      current.set(existing, entry)
    }
  }
  const cutoff = threeMonthsAgo(next.lastUpdate)
  for (const key of new Set([...Object.keys(history), ...current.keys()])) {
    const entry = current.get(key)
    const series = history[key] ?? { label: entry!.label, category: entry!.category, points: [] }
    if (entry) {
      series.label = entry.label
      series.category = entry.category
    }
    if (!series.points.length && previous)
      series.points.push({ time: previous.lastUpdate, value: '0' })
    const value = entry?.value ?? '0'
    const last = series.points.at(-1)
    if (last && next.lastUpdate < last.time) continue
    series.scanDelta = last ? (BigInt(value) - BigInt(last.value)).toString() : undefined
    if (last?.value === value) last.time = next.lastUpdate
    else {
      if (last) series.delta = (BigInt(value) - BigInt(last.value)).toString()
      series.points.push({ time: next.lastUpdate, value })
    }
    // Keep one boundary observation to establish the value at the start of the plot.
    const first = series.points.findIndex((point) => point.time >= cutoff)
    series.points =
      first < 0 ? series.points.slice(-1) : series.points.slice(Math.max(0, first - 1))
    history[key] = series
  }
  return { ...next, history }
}

export function freshness(time: number, now: number, locale = 'en'): string {
  const minutes = Math.max(0, Math.floor((now - time) / 60000))
  if (locale !== 'en') {
    const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    if (minutes < 60) return format.format(-minutes, 'minute')
    if (minutes < 1440) return format.format(-Math.floor(minutes / 60), 'hour')
    return format.format(-Math.floor(minutes / 1440), 'day')
  }
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`
  return `${Math.floor(minutes / 1440)}d ago`
}

export function vaultKind(text: string): VaultKind | undefined {
  if (/^Your guild vault contains\b/.test(text)) return 'gvault'
  if (/^Your vault contains\b/.test(text)) return 'vault'
}

/** Counts stay strings so large gold balances are never rounded. */
export function parseInventory(text: string) {
  if (!vaultKind(text)) return
  const entries = quantityEntries(text).map(({ value, label }) => ({ count: value, name: label }))
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
