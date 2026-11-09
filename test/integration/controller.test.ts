import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GameConstants as C } from '@duplicis/core'
import { gameFixture } from '@duplicis/test/game'
import { ChatController } from '@duplicis/test/chat-controller'
import { CommandRegistry } from '@duplicis/test/chat-commands'
import {
  BankVaultMemoryController,
  CATEGORY_REQUEST_DELAY_MS,
  RESPONSE_TIMEOUT_MS,
} from '../../src/controller'
import { emptyMemory } from '../../src/memory'
import type { CharacterMemory } from '../../src/memory'

const summary = 'Your vault contains 100 gold and 4 items (max 500):\n2 swords and 2 scrolls.'
const swords = 'Your vault contains 2 swords:\n1 short sword and 1 long sword.'
const scrolls = 'Your vault contains 2 scrolls:\n2 scrolls of healing.'
const cleanups: (() => void)[] = []
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.useRealTimers()
})
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}
const nextCategory = async () => {
  await flush()
  await vi.advanceTimersByTimeAsync(CATEGORY_REQUEST_DELAY_MS)
}

function fixture(initial = emptyMemory(), load?: (player: string) => Promise<CharacterMemory>) {
  const f = gameFixture()
  const registry = new CommandRegistry()
  const chat = new ChatController(f.scope, registry)
  const saved: { player: string; memory: CharacterMemory }[] = []
  const scope = f.utils.createScope({ name: 'memory', profileId: 1, report: () => {} })
  const controller = new BankVaultMemoryController(
    scope,
    () => chat,
    (command) => registry.register(command, scope),
    load ?? (async (player) => (player === 'Tester' ? initial : emptyMemory())),
    (player, memory) => saved.push({ player, memory: structuredClone(memory) }),
  )
  cleanups.push(() => {
    controller.dispose()
    chat.dispose()
    scope.dispose()
    f.scope.dispose()
  })
  const hint = (text: string) => f.native(text, C.TextId.Hint)
  const enter = (guild = false) =>
    f.native(`Gomald escorts you to your ${guild ? 'guild' : 'private'} vault.`)
  const requests = () => {
    const result: string[] = []
    let text = ''
    for (const [code, action] of f.keys) {
      if (action === C.KeyAction.BufferSpeech) text += String.fromCharCode(code)
      if (action === C.KeyAction.Special && code === C.SpecialAction.SpeakBuffer) {
        result.push(text)
        text = ''
      }
    }
    return result
  }
  return { ...f, scope, chat, controller, saved, hint, enter, requests }
}

describe('bank and vault memory server protocol', () => {
  it('delays category requests 200 ms and replaces native responses before drawing', async () => {
    const f = fixture()
    f.enter()
    await flush()
    expect(f.requests()).toEqual(['vaultinventory'])
    const before = f.draws.length
    f.hint(summary)
    expect(f.draws.slice(before).map((command) => command.text)).toEqual([
      'Updating Vault Memory: 0 of 2',
    ])
    expect(f.draws.at(-1)?.offset).toBe(2)
    expect(f.requests()).toEqual(['vaultinventory'])
    expect(f.saved).toEqual([])
    await flush()
    await vi.advanceTimersByTimeAsync(CATEGORY_REQUEST_DELAY_MS - 1)
    expect(f.requests()).toEqual(['vaultinventory'])
    await vi.advanceTimersByTimeAsync(1)
    expect(f.requests()).toEqual(['vaultinventory', 'vaultinventory swords'])
    f.hint('') // normal server clears between requests
    expect(f.root.DA?.[C.TextId.Hint]?.H1).toBe('Updating Vault Memory: 0 of 2')
    f.hint(summary) // duplicate root reply must not become a category's content
    await flush()
    expect(f.requests()).toHaveLength(2)
    f.hint(swords)
    expect(f.draws.at(-1)?.text).toBe('Updating Vault Memory: 1 of 2')
    await nextCategory()
    expect(f.requests()).toEqual([
      'vaultinventory',
      'vaultinventory swords',
      'vaultinventory scrolls',
    ])
    expect(f.saved).toEqual([])
    f.hint(scrolls)
    expect(f.draws.at(-1)?.text).toBe('Vault Memory Updated.')
    await flush()
    expect(f.saved).toHaveLength(1)
    expect(f.saved[0].memory.vault).toMatchObject({
      gold: '100',
      items: summary,
      categories: { swords, scrolls },
    })
    expect(f.saved[0].memory.vault!.lastUpdate).toBeGreaterThan(0)
    expect(f.keys.slice(-2)).toEqual([
      [C.KeyCode.Escape, C.KeyAction.Pressed],
      [C.KeyCode.Escape, C.KeyAction.Released],
    ])
    f.hint('')
    expect(f.root.DA?.[C.TextId.Hint]?.H1).toBe('Vault Memory Updated.')
    expect(f.errors).toEqual([])
    expect(
      f.draws
        .slice(before)
        .some((command) => [summary, swords, scrolls].includes(command.text ?? '')),
    ).toBe(false)
  })

  it('keeps private and guild data separate and handles gold-only/empty vaults', async () => {
    const f = fixture()
    f.enter()
    await flush()
    f.hint('Your vault contains 50 gold.')
    await flush()
    f.enter(true)
    await flush()
    f.hint('Your guild vault contains nothing.')
    await flush()
    expect(f.requests()).toEqual(['vaultinventory', 'vaultinventory'])
    expect(f.saved.at(-1)?.memory.vault?.gold).toBe('50')
    expect(f.saved.at(-1)?.memory.gvault?.gold).toBe('0')
  })

  it('retains the original pacing through the sixth overview position', async () => {
    const f = fixture()
    const categories = ['swords', 'scrolls', 'rings', 'shields', 'potions', 'boots']
    f.enter()
    await flush()
    f.hint(
      `Your vault contains 10 gold and 6 items (max 500):\n${categories.map((category) => `1 ${category}`).join(' and ')}.`,
    )
    for (let index = 0; index < categories.length; index++) {
      await nextCategory()
      expect(f.requests().at(-1)).toBe(`vaultinventory ${categories[index]}`)
      f.hint(`Your vault contains 1 ${categories[index]}:\nAn item.`)
    }
    await flush()
    expect(f.saved).toHaveLength(1)
    expect(f.requests()).toHaveLength(7)
  })

  it('cancels queued requests on Escape, zoning, another menu, and disposal', async () => {
    for (const cancel of [
      (f: ReturnType<typeof fixture>) => f.controller.dismiss(),
      (f: ReturnType<typeof fixture>) => f.native('', C.TextId.ClearAll),
      (f: ReturnType<typeof fixture>) => f.hint('Another server menu'),
      (f: ReturnType<typeof fixture>) => f.controller.dispose(),
    ]) {
      const f = fixture()
      f.enter()
      await flush()
      f.hint(summary)
      cancel(f)
      await flush()
      await vi.advanceTimersByTimeAsync(CATEGORY_REQUEST_DELAY_MS * 2)
      f.hint(swords)
      await flush()
      expect(f.requests()).toEqual(['vaultinventory'])
      expect(f.saved).toEqual([])
    }
  })

  it('stops without retrying on timeout, bad transport, malformed menus, and wrong-vault replies', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.enter()
    await flush()
    vi.advanceTimersByTime(RESPONSE_TIMEOUT_MS)
    f.hint(summary)
    await flush()
    expect(f.requests()).toEqual(['vaultinventory'])
    expect(f.saved).toEqual([])
    f.enter()
    await flush()
    f.hint('Your vault contains unreadable contents.')
    expect(f.draws.at(-1)?.text).toBe('Your vault contains unreadable contents.')
    await flush()
    f.enter()
    await flush()
    f.hint('Your guild vault contains 10 gold.')
    expect(f.draws.at(-1)?.text).toBe('Your guild vault contains 10 gold.')
    await flush()
    expect(f.saved).toEqual([])
    f.failInput()
    f.enter()
    await flush()
    vi.advanceTimersByTime(RESPONSE_TIMEOUT_MS * 2)
    expect(f.requests()).toHaveLength(3)
  })

  it('uses only native root-window events and never replays work after a session change', async () => {
    const f = fixture()
    f.scope.text.display({
      id: C.TextId.Notification,
      text: 'Gomald escorts you to your private vault.',
    })
    f.native('Gomald escorts you to your private vault.', C.TextId.Notification, {}, f.addWindow(1))
    await flush()
    expect(f.requests()).toEqual([])
    f.enter()
    await flush()
    f.hint(summary)
    f.utils.detach(f.game)
    f.utils.attach(f.game)
    f.utils.addWindow(f.root)
    f.utils.refresh(f.game)
    await flush()
    await vi.advanceTimersByTimeAsync(CATEGORY_REQUEST_DELAY_MS * 2)
    expect(f.requests()).toEqual(['vaultinventory'])
    expect(f.saved).toEqual([])
  })

  it('does not send requests into a server prompt or after a bank/exit response', async () => {
    const f = fixture()
    f.enter()
    await flush()
    f.hint(summary)
    f.native('What is your new password?')
    await flush()
    expect(f.requests()).toEqual(['vaultinventory'])
    expect(f.saved).toEqual([])
    const other = fixture()
    other.enter()
    await flush()
    other.hint(summary)
    other.native('Health: 100 Bank: 456', C.TextId.BottomMessage)
    await flush()
    expect(other.requests()).toEqual(['vaultinventory'])
    expect(other.saved[0].memory.bank?.gold).toBe('456')
    expect(other.saved[0].memory.vault).toBeUndefined()
  })

  it.each([false, true])(
    'shows the abort hint after leaving a vault, including screen clears (guild: %s)',
    async (guild) => {
      for (const clearScreen of [false, true]) {
        const previous = { gold: '50', lastUpdate: 1, items: summary, categories: { swords } }
        const f = fixture({ version: 1, [guild ? 'gvault' : 'vault']: previous })
        f.enter(guild)
        await flush()
        f.hint(guild ? summary.replace('Your vault', 'Your guild vault') : summary)
        await flush()
        if (clearScreen) f.native('', C.TextId.ClearAll)
        const before = f.draws.length
        f.native('Health: 100 Bank: 456', C.TextId.BottomMessage)
        // Duplicate status refreshes must still produce exactly one abort hint.
        f.native('Health: 90 Bank: 456', C.TextId.BottomMessage)
        f.native('You must be in your vault to take inventory.')
        await flush()
        f.hint('')
        expect(f.root.DA?.[C.TextId.Hint]?.H1).toBe('Exited Vault\nVault Memory Update Aborted!')
        expect(
          f.draws
            .slice(before)
            .filter((command) => command.text === 'Exited Vault\nVault Memory Update Aborted!'),
        ).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(RESPONSE_TIMEOUT_MS * 2)
        expect(f.requests()).toEqual(['vaultinventory'])
        expect(f.saved.at(-1)?.memory[guild ? 'gvault' : 'vault']).toEqual(previous)
        expect(f.saved.at(-1)?.memory.bank?.gold).toBe('456')
        expect(f.errors).toEqual([])
      }
    },
  )

  it('does not show a stale abort hint after cancellation or over a newer menu', async () => {
    const f = fixture()
    f.enter()
    await flush()
    f.hint(summary)
    f.controller.dismiss()
    f.native('Health: 100 Bank: 12', C.TextId.BottomMessage)
    await flush()
    expect(f.draws.some((command) => command.text?.includes('Aborted'))).toBe(false)
    f.enter()
    await flush()
    f.hint(summary)
    f.native('', C.TextId.ClearAll)
    f.native('Health: 100 Bank: 12', C.TextId.BottomMessage)
    f.hint('Another server menu')
    await flush()
    expect(f.root.DA?.[C.TextId.Hint]?.H1).toBe('Another server menu')
    expect(f.draws.some((command) => command.text?.includes('Aborted'))).toBe(false)
  })

  it('loads per character, displays remembered bank balances, and consumes all recall aliases locally', async () => {
    const memory: CharacterMemory = {
      version: 1,
      bank: { gold: '9007199254740993', lastUpdate: 1 },
      vault: { gold: '100', lastUpdate: 1, items: summary, categories: { swords, scrolls } },
    }
    const f = fixture(memory)
    await flush()
    f.native('Health: 100', C.TextId.BottomMessage)
    expect(f.draws.at(-1)?.text).toBe('Health: 100     Bank: 9007199254740993')
    for (const alias of [
      'vaultmemory swords',
      'VAULTMEM sword',
      'gvaultmemory items',
      'gvaultmem gold',
      'vm swords',
      'GVM gold',
      'vaultmemory lastUpdate',
      'vaultmemory missing',
    ]) {
      expect(f.chat.send(alias).status).toBe('consumed')
      await flush()
      f.hint('')
    }
    expect(f.requests()).toEqual([])
    expect(f.chat.send('vaultmemoryx').status).toBe('sent')
    f.game.playerName = 'Other'
    f.utils.refresh(f.game)
    await flush()
    f.chat.send('vaultmemory')
    await flush()
    f.hint('')
    expect(f.root.DA?.[C.TextId.Hint]?.H1).toContain('No vault memory')
    expect(f.saved).toEqual([])
  })

  it('disables entry scans for both vaults, keeps recall and bank memory, and cancels delayed requests', async () => {
    const f = fixture({
      version: 1,
      vault: { gold: '100', lastUpdate: 1, items: summary, categories: { swords } },
    })
    f.controller.setAutoGather(false)
    f.enter()
    f.enter(true)
    await flush()
    expect(f.requests()).toEqual([])
    expect(f.chat.send('vm gold').status).toBe('consumed')
    await flush()
    f.hint('')
    expect(f.root.DA?.[C.TextId.Hint]?.H1).toContain('contains 100 gold')
    f.native('Health: 100 Bank: 12', C.TextId.BottomMessage)
    await flush()
    expect(f.saved.at(-1)?.memory.bank?.gold).toBe('12')
    f.controller.setAutoGather(true)
    f.enter()
    await flush()
    f.hint(summary)
    await flush()
    f.controller.setAutoGather(false)
    await nextCategory()
    expect(f.requests()).toEqual(['vaultinventory'])
    expect(f.saved.at(-1)?.memory.vault?.gold).toBe('100')
  })

  it('toggles remembered bank display while continuing to collect native bank balances', async () => {
    const f = fixture({ version: 1, bank: { gold: '10', lastUpdate: 1 } })
    await flush()
    f.native('Health: 100', C.TextId.BottomMessage)
    expect(f.draws.at(-1)?.text).toBe('Health: 100     Bank: 10')
    f.controller.setShowBankBalance(false)
    f.native('Health: 90', C.TextId.BottomMessage)
    expect(f.draws.at(-1)?.text).toBe('Health: 90')
    f.native('Health: 90 Bank: 55', C.TextId.BottomMessage)
    await flush()
    expect(f.draws.at(-1)?.text).toBe('Health: 90 Bank: 55')
    expect(f.saved.at(-1)?.memory.bank?.gold).toBe('55')
    f.controller.setShowBankBalance(true)
    f.native('Health: 80', C.TextId.BottomMessage)
    expect(f.draws.at(-1)?.text).toBe('Health: 80     Bank: 55')
  })

  it('changes private and guild prefix regexes independently and preserves category arguments', async () => {
    const f = fixture({
      version: 1,
      vault: { gold: '100', lastUpdate: 1, items: summary, categories: { swords } },
      gvault: { gold: '200', lastUpdate: 1, items: summary, categories: { swords } },
    })
    await flush()
    for (const alias of ['vaultmemory', 'vaultmem', 'vm']) {
      expect(f.chat.send(`${alias} gold`).status).toBe('consumed')
      await flush()
      f.hint('')
      expect(f.root.DA?.[C.TextId.Hint]?.H1).toContain('vault contains 100 gold')
    }
    for (const alias of ['gvaultmemory', 'gvaultmem', 'gvm']) {
      expect(f.chat.send(`${alias} gold`).status).toBe('consumed')
      await flush()
      f.hint('')
      expect(f.root.DA?.[C.TextId.Hint]?.H1).toContain('guild vault contains 200 gold')
    }
    expect(f.controller.setCommandPattern('vault', 'my (stash|vault)')).toBe(true)
    expect(f.controller.setCommandPattern('gvault', 'guild stash')).toBe(true)
    expect(f.chat.send('MY STASH gold').status).toBe('consumed')
    await flush()
    f.hint('')
    expect(f.root.DA?.[C.TextId.Hint]?.H1).toContain('vault contains 100 gold')
    expect(f.chat.send('guild stash gold').status).toBe('consumed')
    await flush()
    f.hint('')
    expect(f.root.DA?.[C.TextId.Hint]?.H1).toContain('guild vault contains 200 gold')
    expect(f.chat.send('vm gold').status).toBe('sent')
    expect(f.chat.send('gvm gold').status).toBe('sent')
    for (const pattern of ['[', '', '.*'])
      expect(f.controller.setCommandPattern('vault', pattern)).toBe(false)
    expect(f.chat.send('my vault swords').status).toBe('consumed')
    await flush()
    f.hint('')
    expect(f.root.DA?.[C.TextId.Hint]?.H1).toContain('short sword')
    f.controller.dispose()
    expect(f.chat.send('my stash').status).toBe('sent')
  })

  it('waits for database reads, keeps bank updates, and cancels recall while loading', async () => {
    let resolve!: (memory: CharacterMemory) => void
    const f = fixture(
      emptyMemory(),
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    f.native('Health: 100 Bank: 12', C.TextId.BottomMessage)
    f.chat.send('vaultmemory')
    f.controller.dismiss()
    resolve(emptyMemory())
    await flush()
    expect(f.saved[0].memory.bank?.gold).toBe('12')
    expect(f.keys).toEqual([])
    const failed = fixture(emptyMemory(), async () => {
      throw new Error('database unavailable')
    })
    failed.enter()
    failed.native('Health: 100 Bank: 99', C.TextId.BottomMessage)
    await flush()
    expect(failed.requests()).toEqual([])
    expect(failed.saved).toEqual([])
  })

  it('preserves a composed draft while scanning and receiving server notifications', async () => {
    const f = fixture()
    const key = (name: string) =>
      f.chat.keyDown({
        key: name,
        keyCode: name === 'Enter' ? 13 : name.toUpperCase().charCodeAt(0),
        preventDefault: () => {},
      } as KeyboardEvent)
    key('Enter')
    for (const char of 'draft') key(char)
    f.enter()
    await flush()
    f.hint(summary)
    await nextCategory()
    f.native('You finish taking inventory of your vault.')
    f.hint(swords)
    await nextCategory()
    f.hint(scrolls)
    await flush()
    expect(f.chat.getSnapshot()).toMatchObject({ mode: 'composing', draft: 'draft' })
    expect(f.saved).toHaveLength(1)
    expect(f.requests()).toEqual([
      'vaultinventory',
      'vaultinventory swords',
      'vaultinventory scrolls',
    ])
  })
})
