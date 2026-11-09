import { describe, expect, it } from 'vitest'
import { parseInventory, readMemory, recall } from './memory'

const summary = 'Your vault contains 100 gold and 4 items (max 500):\n2 swords and 2 scrolls.'
const swords = 'Your vault contains 2 swords:\n1 short sword and 1 long sword.'

describe('memory parsing', () => {
  it('parses totals, category counts, capacity, comma-separated gold, and parentheses', () => {
    expect(parseInventory(summary)).toEqual({ gold: '100', categories: ['swords', 'scrolls'] })
    expect(
      parseInventory(
        'Your guild vault contains 1,234 gold and 4 items (max 500):\n2 magic scrolls (10) and 2 swords.',
      ),
    ).toEqual({ gold: '1234', categories: ['magic scrolls (10)', 'swords'] })
    expect(parseInventory('Your vault contains 5 items.')).toBeUndefined()
  })

  it('validates persisted records', () => {
    const memory = readMemory(
      JSON.stringify({
        version: 1,
        bank: { gold: '23', lastUpdate: 1 },
        vault: { gold: '100', lastUpdate: 123, items: summary, categories: { swords } },
      }),
    )!
    expect(memory.vault?.categories).toEqual({ swords })
    expect(readMemory(JSON.stringify(memory))).toEqual(memory)
    expect(readMemory('invalid')).toBeUndefined()
    expect(readMemory('{"version":99}')).toBeUndefined()
    expect(recall(memory, 'vault', 'sword')).toContain('2 swords')
    expect(recall(memory, 'vault', '[')).toContain('not found')
    expect(recall(memory, 'gvault', 'gold')).toContain('No guild vault memory')
  })
})
