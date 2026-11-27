import { Plugin, client } from '@duplicis/core'
import { getChatSystem, registerCommand } from '@duplicis/plugin-chat-system'
import { createBindings } from './bindings'
import { BankVaultMemoryController } from './controller'
import { emptyMemory, readMemory } from './memory'
import type { CharacterMemory } from './memory'
import { VaultView } from './view.svelte'
import Icon from './components/Icon.svelte'
import Menu from './components/Menu.svelte'
import './vault.css'
import { ui } from './translations'

export class BankVaultMemoryPlugin extends Plugin {
  static override name = '@duplicis/plugin-bank-vault-memory'
  static override icon = { component: Icon }
  static override menu = { component: Menu }
  readonly view = new VaultView()
  private characterIndex = this.config('characters', 'text', { default: '[]', hidden: true })
  private exited = false
  private controller?: BankVaultMemoryController
  private records = new Map<string, ReturnType<BankVaultMemoryPlugin['binding']>>()
  private writes: Promise<unknown> = Promise.resolve()
  readonly bind = createBindings(this)

  private binding(player: string) {
    return this.config(`memory:${player.toLowerCase()}`, 'text', { default: '', hidden: true })
  }

  private record(player: string) {
    const key = player.toLowerCase()
    let binding = this.records.get(key)
    if (!binding) {
      binding = this.binding(player)
      this.records.set(key, binding)
    }
    return binding
  }

  private async load(player: string): Promise<CharacterMemory> {
    await this.writes
    const saved = await this.record(player).get()
    const memory = saved ? (readMemory(saved) ?? emptyMemory()) : emptyMemory()
    if (!this.exited) this.view.remember(player, memory)
    return memory
  }

  private save(player: string, memory: CharacterMemory): void {
    this.view.remember(player, memory)
    const binding = this.record(player)
    const serialized = JSON.stringify(memory)
    // Serialize commits so a slow earlier write cannot replace a newer record.
    this.writes = this.writes
      .then(() => binding.set(serialized))
      .catch(() => {
        client.pluginUtils.forPlugin(this).report('Could not save bank and vault memory')
        getChatSystem()?.notify('Could not save bank and vault memory to the database.')
      })
  }

  override async onLoad() {
    const utils = client.pluginUtils.forPlugin(this)
    const css = document.createElement('link')
    css.rel = 'stylesheet'
    css.href = new URL(['vault', 'css'].join('.'), import.meta.url).href
    document.head.append(css)
    utils.own(() => css.remove())
    try {
      const names: unknown = JSON.parse(await this.characterIndex.get())
      if (Array.isArray(names))
        this.view.characters = [
          ...new Set(
            names
              .filter((name): name is string => typeof name === 'string' && !!name.trim())
              .map((name) => name.toLowerCase()),
          ),
        ].sort()
    } catch {
      /* An invalid index must not prevent loading individual memories. */
    }
    await Promise.all(
      this.view.characters.map((player) =>
        this.load(player).catch(() => utils.report(`Could not load vault memory for ${player}`)),
      ),
    )
    const characterChanged = (player: string) => {
      if (this.exited) return
      this.view.current = player.toLowerCase()
      if (!player || this.view.characters.includes(player.toLowerCase())) return
      this.view.characters = [...this.view.characters, player.toLowerCase()].sort()
      const serialized = JSON.stringify(this.view.characters)
      this.writes = this.writes
        .then(() => this.characterIndex.set(serialized))
        .catch(() => utils.report('Could not save vault character list'))
    }
    characterChanged(utils.session.getSnapshot().playerName)
    utils.own(utils.session.observe((session) => characterChanged(session.playerName)))
    const showSidebar = (visible: boolean) => client.sidebar.setIconVisible(this, visible)
    showSidebar(await this.bind.showSidebar.get())
    this.bind.showSidebar.on('changed', showSidebar)
    utils.own(() => client.sidebar.setIconVisible(this, true))
    const [autoGather, showBankBalance, vaultPattern, guildPattern] = await Promise.all([
      this.bind.autoGather.get(),
      this.bind.showBankBalance.get(),
      this.bind.vaultPattern.get(),
      this.bind.guildPattern.get(),
    ])
    const controller = (this.controller = new BankVaultMemoryController(
      utils,
      getChatSystem,
      registerCommand,
      (player) => this.load(player),
      (player, memory) => this.save(player, memory),
    ))
    controller.setAutoGather(autoGather)
    controller.setShowBankBalance(showBankBalance)
    const updatePattern = (kind: 'vault' | 'gvault', pattern: string) => {
      if (!controller.setCommandPattern(kind, pattern)) {
        client.sidebar.toast({ type: 'error', title: i18n.t.invalid_pattern() })
      }
    }
    updatePattern('vault', vaultPattern)
    updatePattern('gvault', guildPattern)
    this.bind.autoGather.on('changed', (enabled: boolean) => controller.setAutoGather(enabled))
    this.bind.showBankBalance.on('changed', (enabled: boolean) =>
      controller.setShowBankBalance(enabled),
    )
    this.bind.vaultPattern.on('changed', (pattern: string) => updatePattern('vault', pattern))
    this.bind.guildPattern.on('changed', (pattern: string) => updatePattern('gvault', pattern))
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !utils.helpers.isEditableTarget(event, document.activeElement))
        controller.dismiss()
    }
    window.addEventListener('keydown', dismiss, true)
    utils.own(() => window.removeEventListener('keydown', dismiss, true))
    utils.own(() => controller.dispose())
  }

  override async onExit() {
    this.exited = true
    this.controller?.dispose()
    this.controller = undefined
    await this.writes
  }
}

export const i18n = BankVaultMemoryPlugin.translations({
  en: {
    ui: ui.en,
    invalid_pattern: 'Invalid vault command prefix regex. The last valid pattern is still active.',
    display_name: 'vault memory',
    description:
      'Remember bank gold and vault inventories. Use vaultmemory or gvaultmemory followed by items, gold, lastUpdate, or a category.',
  },
  es: {
    ui: ui.es,
    invalid_pattern: 'Regex de prefijo de bóveda inválida. El último patrón válido sigue activo.',
    display_name: 'Memoria del banco y la bóveda',
    description:
      'Recuerda el oro del banco e inventarios. Usa vaultmemory o gvaultmemory con items, gold, lastUpdate o una categoría.',
  },
  'pt-BR': {
    ui: ui['pt-BR'],
    invalid_pattern: 'Regex do prefixo do cofre inválida. O último padrão válido continua ativo.',
    display_name: 'Memória do banco e do cofre',
    description:
      'Lembra o ouro do banco e inventários. Use vaultmemory ou gvaultmemory com items, gold, lastUpdate ou uma categoria.',
  },
})

export default BankVaultMemoryPlugin
