import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const clientRoot = process.env.DUPLICIS_CLIENT_ROOT
if (!clientRoot) throw new Error('Run this test with pnpm test:e2e')
const { test, expect, useFixtureElectron } = await import(
  pathToFileURL(resolve(clientRoot, 'test/e2e/src/helpers/electron.ts')).href
)
const pluginRoot = fileURLToPath(new URL('../..', import.meta.url))

const electron = useFixtureElectron({ externalPlugins: [pluginRoot] })
const name = '@duplicis/plugin-bank-vault-memory'
test.beforeAll(electron.waitApp)

test('loads the distribution as an external plugin with its existing identity', async () => {
  const listing = await electron.window.evaluate(async (name) => {
    const { client } = await import('@duplicis/core')
    const wrapper = client.loader.$plugins[name]
    return { builtin: wrapper.builtin, active: wrapper.status.active, main: wrapper.listing.main }
  }, name)
  expect(listing).toMatchObject({ builtin: false, active: true })
  expect(listing.main).toMatch(/^duplicis:\/\/fs\/.*\/dist\/index\.js$/)
})

async function native(text: string, id = 3) {
  await electron.window.evaluate(
    ({ text, id }) => {
      app!.game.Bb[0]!.DQ(id, 8, text, 0, 0, 0, 0, false)
    },
    { text, id },
  )
}

async function recall(text: string) {
  expect(
    await electron.window.evaluate(async (text) => {
      return (await import('@duplicis/plugin-chat-system')).getChatSystem()!.send(text).status
    }, text),
  ).toBe('consumed')
  await native('')
  return electron.window.evaluate(() => app!.game.Bb[0]!.DA![3]?.H1)
}

test('remembers native bank/vault data in SQLite across reloads and isolates profiles', async () => {
  await electron.window.evaluate(async () => {
    const { client } = await import('@duplicis/core')
    await client.reload('', '', 'bank-vault-test')
    window.__gameFixture.keys = []
  })
  await native('Health: 100 Bank: 1234', 2)
  await native('Gomald escorts you to your private vault.', 65001)
  await expect
    .poll(() =>
      electron.window.evaluate(() =>
        window.__gameFixture.keys
          .filter(([, action]) => action === 12)
          .map(([code]) => String.fromCharCode(code))
          .join(''),
      ),
    )
    .toBe('vaultinventory')
  await native('Your vault contains 100 gold and 2 items (max 500):\n2 swords.')
  expect(await electron.window.evaluate(() => app!.game.Bb[0]!.DA![3]?.H1)).toBe(
    'Updating Vault Memory: 0 of 1',
  )
  await expect
    .poll(() =>
      electron.window.evaluate(() =>
        window.__gameFixture.keys
          .filter(([, action]) => action === 12)
          .map(([code]) => String.fromCharCode(code))
          .join(''),
      ),
    )
    .toBe('vaultinventoryvaultinventory swords')
  await native('Your vault contains 2 swords:\n2 short swords.')
  expect(await electron.window.evaluate(() => app!.game.Bb[0]!.DA![3]?.H1)).toBe(
    'Vault Memory Updated.',
  )
  expect(
    await electron.window.evaluate(() =>
      window.__gameFixture.draws.some(
        ({ id, text }) => id === 3 && text?.startsWith('Your vault contains'),
      ),
    ),
  ).toBe(false)
  await native('')
  await electron.window.evaluate(async () => {
    const { client } = await import('@duplicis/core')
    await client.reload('', '', 'bank-vault-test')
    window.__gameFixture.keys = []
  })
  expect(await recall('vaultmemory swords')).toContain('2 short swords')
  await native('Health: 90', 2)
  expect(await electron.window.evaluate(() => app!.game.Bb[0]!.DA![2]?.H1)).toContain('Bank: 1234')
  expect(
    await electron.window.evaluate(async (name) => {
      const { client } = await import('@duplicis/core')
      const wrapper = client.loader.$plugins[name]
      const saved = await wrapper.bindings['memory:tester'].get()
      return {
        data: JSON.parse(saved as string),
        hidden: wrapper.bindings['memory:tester'].options.hidden,
        patches: wrapper.patch.length,
      }
    }, name),
  ).toMatchObject({
    data: { version: 1, bank: { gold: '1234' }, vault: { gold: '100' } },
    hidden: true,
    patches: 0,
  })
  await electron.window.evaluate(async () => {
    const { client } = await import('@duplicis/core')
    await client.reload('', '', 'bank-vault-other')
  })
  expect(await recall('vaultmemory')).toContain('No vault memory')
})

test('live disable cancels a scan and unregisters local commands', async () => {
  await electron.window.evaluate(async () => {
    const { client } = await import('@duplicis/core')
    await client.reload('', '', 'bank-vault-disable')
    window.__gameFixture.keys = []
  })
  await native('Gomald escorts you to your private vault.', 65001)
  await electron.window.evaluate(async (name) => {
    const { client } = await import('@duplicis/core')
    await client.loader.$plugins[name].setEnabled(false)
    window.__gameFixture.keys = []
  }, name)
  await native('Your vault contains 100 gold and 2 items (max 500):\n2 swords.')
  expect(await electron.window.evaluate(() => window.__gameFixture.keys)).toEqual([])
  expect(
    await electron.window.evaluate(
      async () =>
        (await import('@duplicis/plugin-chat-system')).getChatSystem()!.send('vaultmemory').status,
    ),
  ).toBe('sent')
  await electron.window.evaluate(async (name) => {
    const { client } = await import('@duplicis/core')
    await client.loader.$plugins[name].setEnabled(true)
  }, name)
  expect(await recall('vaultmemory')).toContain('No vault memory')
})

test('entry scanning and command prefix settings apply live and persist per profile', async () => {
  const defaults = await electron.window.evaluate(async (name) => {
    const { client } = await import('@duplicis/core')
    await client.reload('', '', 'bank-vault-settings')
    const { bindings } = client.loader.$plugins[name]
    return Promise.all([
      bindings.gather_on_entry.get(),
      bindings.vault_command_pattern.get(),
      bindings.guild_vault_command_pattern.get(),
    ])
  }, name)
  expect(defaults).toEqual([true, 'vaultmemory|vaultmem|vm', 'gvaultmemory|gvaultmem|gvm'])
  for (const prefix of ['vaultmemory', 'vaultmem', 'vm'])
    expect(await recall(`${prefix} gold`)).toContain('No vault memory')
  for (const prefix of ['gvaultmemory', 'gvaultmem', 'gvm'])
    expect(await recall(`${prefix} gold`)).toContain('No guild vault memory')
  await electron.window.evaluate(async (name) => {
    const { client } = await import('@duplicis/core')
    const { bindings } = client.loader.$plugins[name]
    await bindings.gather_on_entry.set(false)
    await bindings.vault_command_pattern.set('stash|storage')
    await bindings.guild_vault_command_pattern.set('guild stash')
    window.__gameFixture.keys = []
  }, name)
  await native('Gomald escorts you to your private vault.', 65001)
  await native('Gomald escorts you to your guild vault.', 65001)
  expect(await electron.window.evaluate(() => window.__gameFixture.keys)).toEqual([])
  expect(await recall('STASH gold')).toContain('No vault memory')
  expect(await recall('guild stash gold')).toContain('No guild vault memory')
  await electron.window.evaluate(async () => {
    await (await import('@duplicis/core')).client.reload('', '', 'bank-vault-settings')
    window.__gameFixture.keys = []
  })
  await native('Gomald escorts you to your private vault.', 65001)
  expect(await electron.window.evaluate(() => window.__gameFixture.keys)).toEqual([])
  expect(await recall('storage items')).toContain('No vault memory')
  expect(await recall('guild stash items')).toContain('No guild vault memory')
  await electron.window.evaluate(async () => {
    await (await import('@duplicis/core')).client.reload('', '', 'bank-vault-default-settings')
  })
  expect(await recall('vm')).toContain('No vault memory')
  expect(await recall('gvm')).toContain('No guild vault memory')
  expect(
    await electron.window.evaluate(async (name) => {
      return (await import('@duplicis/core')).client.loader.$plugins[
        name
      ].bindings.gather_on_entry.get()
    }, name),
  ).toBe(true)
})

test('bank balance display setting persists while native balances continue to be saved', async () => {
  const initial = await electron.window.evaluate(async (name) => {
    const { client } = await import('@duplicis/core')
    await client.reload('', '', 'bank-display-settings')
    return client.loader.$plugins[name].bindings.show_bank_balance.get()
  }, name)
  expect(initial).toBe(true)
  await native('Health: 100 Bank: 123', 2)
  await native('Health: 90', 2)
  await expect
    .poll(() => electron.window.evaluate(() => app!.game.Bb[0]!.DA![2]?.H1))
    .toContain('Bank: 123')
  await electron.window.evaluate(async (name) => {
    const { client } = await import('@duplicis/core')
    await client.loader.$plugins[name].bindings.show_bank_balance.set(false)
  }, name)
  await native('Health: 80', 2)
  expect(await electron.window.evaluate(() => app!.game.Bb[0]!.DA![2]?.H1)).toBe('Health: 80')
  await native('Health: 80 Bank: 456', 2)
  expect(await electron.window.evaluate(() => app!.game.Bb[0]!.DA![2]?.H1)).toBe(
    'Health: 80 Bank: 456',
  )
  await electron.window.evaluate(async () => {
    await (await import('@duplicis/core')).client.reload('', '', 'bank-display-settings')
  })
  expect(
    await electron.window.evaluate(async (name) => {
      return (await import('@duplicis/core')).client.loader.$plugins[
        name
      ].bindings.show_bank_balance.get()
    }, name),
  ).toBe(false)
  await native('Health: 70', 2)
  expect(await electron.window.evaluate(() => app!.game.Bb[0]!.DA![2]?.H1)).toBe('Health: 70')
  await electron.window.evaluate(async (name) => {
    const { client } = await import('@duplicis/core')
    await client.loader.$plugins[name].bindings.show_bank_balance.set(true)
  }, name)
  await native('Health: 60', 2)
  await expect
    .poll(() => electron.window.evaluate(() => app!.game.Bb[0]!.DA![2]?.H1))
    .toContain('Bank: 456')
  await electron.window.evaluate(async () => {
    await (await import('@duplicis/core')).client.reload('', '', 'bank-display-other')
  })
  expect(
    await electron.window.evaluate(async (name) => {
      return (await import('@duplicis/core')).client.loader.$plugins[
        name
      ].bindings.show_bank_balance.get()
    }, name),
  ).toBe(true)
})

test('leaving the vault during gathering replaces progress with the abort hint', async () => {
  await electron.window.evaluate(async () => {
    await (await import('@duplicis/core')).client.reload('', '', 'bank-vault-abort')
    window.__gameFixture.keys = []
  })
  await native('Gomald escorts you to your private vault.', 65001)
  await native('Your vault contains 100 gold and 2 items (max 500):\n2 swords.')
  await electron.window.evaluate(() => {
    const root = app!.game.Bb[0]!
    root.DQ(0, 8, '', 0, 0, 0, 0, false)
    root.DQ(2, 8, 'Health: 100 Bank: 123', 0, 0, 0, 0, false)
    root.DQ(65001, 8, 'You must be in your vault to take inventory.', 0, 0, 0, 0, false)
  })
  await native('')
  expect(await electron.window.evaluate(() => app!.game.Bb[0]!.DA![3]?.H1)).toBe(
    'Exited Vault\nVault Memory Update Aborted!',
  )
  expect(
    await electron.window.evaluate(() =>
      window.__gameFixture.keys
        .filter(([, action]) => action === 12)
        .map(([code]) => String.fromCharCode(code))
        .join(''),
    ),
  ).toBe('vaultinventory')
})
