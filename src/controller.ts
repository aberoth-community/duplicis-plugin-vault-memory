import { GameConstants as C } from '@duplicis/core'
import type {
  ChatCommand,
  ChatSystemApi,
  Disposer,
  PluginUtilsScope,
  TextEvent,
  UtilitySession,
} from '@duplicis/types'
import { emptyMemory, parseInventory, recall, vaultKind, withHistory } from './memory'
import type { CharacterMemory, VaultKind, VaultMemory } from './memory'

export const RESPONSE_TIMEOUT_MS = 5000
export const CATEGORY_REQUEST_DELAY_MS = 200
export const DEFAULT_VAULT_PATTERN = 'vaultmemory|vaultmem|vm'
export const DEFAULT_GUILD_PATTERN = 'gvaultmemory|gvaultmem|gvm'
const REQUEST_PAUSE_MS = 0 // Original reqPauseLen; applied at every sixth overview position.
interface Scan {
  kind: VaultKind
  pending: boolean
  category?: string
  remaining: string[]
  seen: Set<string>
  draft?: VaultMemory
  placeholder?: string
  categoryPosition?: number
}

export class BankVaultMemoryController {
  private sessionId = -1
  private player = ''
  private generation = 0
  private revision = 0
  private storageReady = false
  private memory = emptyMemory()
  private loaded: Promise<void> = Promise.resolve()
  private scan?: Scan
  private interruptedScan = false
  private timeout?: ReturnType<typeof setTimeout>
  private delay?: ReturnType<typeof setTimeout>
  private hint?: Disposer
  private cleanups: Disposer[] = []
  private closed = false
  private autoGather = true
  private showBankBalance = true
  private commands = new Map<VaultKind, Disposer>()

  constructor(
    private readonly utils: PluginUtilsScope,
    private readonly getChat: () => ChatSystemApi | undefined,
    private readonly register: (command: ChatCommand) => Disposer,
    private readonly load: (player: string) => Promise<CharacterMemory>,
    private readonly save: (player: string, memory: CharacterMemory) => void,
  ) {
    const sessionChanged = (session: UtilitySession) => {
      if (session.id !== this.sessionId || session.playerName !== this.player) {
        this.reset()
        this.sessionId = session.id
        this.player = session.playerName
        this.memory = emptyMemory()
        this.storageReady = false
        const generation = this.generation
        this.loaded = this.player
          ? this.load(this.player)
              .then((memory) => {
                if (generation === this.generation) {
                  this.memory = memory
                  this.storageReady = true
                }
              })
              .catch(() => {
                if (generation === this.generation)
                  this.utils.report('Could not load bank and vault memory')
              })
          : Promise.resolve()
      }
      if (!session.inputReady || !session.textReady) this.stop()
    }
    sessionChanged(utils.session.getSnapshot())
    this.cleanups.push(utils.session.observe(sessionChanged))
    this.cleanups.push(
      utils.text.transform(
        (event) => {
          if (
            !this.native(event) ||
            !this.ready() ||
            !this.scan ||
            event.raw.id !== C.TextId.Hint ||
            event.command.text !== event.raw.text
          )
            return
          const placeholder = event.raw.text
            ? this.scanHint(this.scan, event.raw.text)
            : this.scan.placeholder
          if (!placeholder) return
          // Like casts, replace the native menu and line layout before its first draw.
          return {
            ...event.command,
            text: placeholder,
            offset: this.utils.helpers.countLines(placeholder) + 1,
          }
        },
        { priority: 200 },
      ),
    )
    this.cleanups.push(
      utils.text.transform(
        (event) => {
          if (
            !this.showBankBalance ||
            !this.native(event) ||
            event.raw.id !== C.TextId.BottomMessage
          )
            return
          if (/\bBank: \d+\s*$/.test(event.raw.text ?? '')) return
          return {
            ...event.command,
            text: `${event.command.text ?? ''}     Bank: ${this.memory.bank?.gold ?? '----'}`,
          }
        },
        { priority: 150 },
      ),
    )
    this.cleanups.push(utils.text.observe((event) => this.observe(event), 'rendered'))
    this.setCommandPattern('vault', DEFAULT_VAULT_PATTERN)
    this.setCommandPattern('gvault', DEFAULT_GUILD_PATTERN)
  }

  setAutoGather(enabled: boolean): void {
    this.autoGather = enabled
    if (!enabled) this.stop()
  }

  setShowBankBalance(enabled: boolean): void {
    this.showBankBalance = enabled
  }

  /** Prefixes get a shared category suffix; captures inside a custom prefix are allowed. */
  setCommandPattern(kind: VaultKind, source: string): boolean {
    if (this.closed || !this.utils.active) return false
    let pattern: RegExp
    try {
      pattern = new RegExp(`^(?:${source})(?:\\s+(.+))?$`, 'i')
      if (!source.trim() || pattern.test('')) return false
    } catch {
      return false
    }
    this.commands.get(kind)?.()
    this.commands.set(
      kind,
      this.register({
        id: `vault-memory-${kind}`,
        owner: this.utils.owner,
        name: kind === 'vault' ? 'vaultmemory' : 'gvaultmemory',
        listed: true,
        pattern,
        execute: ({ match }) => {
          this.stop()
          const generation = this.generation
          const revision = this.revision
          void this.loaded.then(() => {
            if (
              !this.ready() ||
              !this.storageReady ||
              generation !== this.generation ||
              revision !== this.revision
            )
              return
            this.hint?.()
            this.hint = this.getChat()?.showHint(
              recall(this.memory, kind, match.at(-1) ?? 'items'),
              { dismissServerMenu: true },
            )
          })
        },
      }),
    )
    return true
  }

  private native(event: TextEvent): boolean {
    return (
      event.source === 'native' &&
      event.windowId === C.SubwindowId.MainCanvas &&
      event.raw.type === C.TextCommand.New &&
      event.sessionId === this.sessionId
    )
  }

  private ready(): boolean {
    const session = this.utils.session.getSnapshot()
    return (
      !this.closed &&
      this.utils.active &&
      !!this.player &&
      session.id === this.sessionId &&
      session.playerName === this.player &&
      session.inputReady &&
      session.textReady &&
      !!this.getChat() &&
      this.getChat()!.getSnapshot().mode !== 'serverPrompt'
    )
  }

  private observe(event: TextEvent): void {
    if (!this.native(event)) return
    const text = event.raw.text ?? ''
    if (!this.ready()) {
      this.stop()
      return
    }
    if (event.raw.id === C.TextId.ClearAll) {
      // Zoning clears the screen before the bank status confirms a vault exit.
      const interrupted = !!this.scan || this.interruptedScan
      this.stop()
      this.interruptedScan = interrupted
      return
    }
    if (event.raw.id === C.TextId.Hint && text && !this.scan) {
      this.revision++
      this.interruptedScan = false
    }
    if (event.raw.id === C.TextId.BottomMessage) {
      const gold = text.match(/\bBank: (\d+)\s*$/)?.[1]
      if (gold !== undefined) {
        const aborted = !!this.scan || this.interruptedScan
        this.stop()
        if (aborted) this.showAbortedHint()
        const generation = this.generation
        void this.loaded.then(() => {
          if (generation !== this.generation || this.closed || !this.storageReady) return
          this.memory = { ...this.memory, bank: { gold, lastUpdate: Date.now() } }
          this.save(this.player, this.memory)
        })
      }
    } else if (event.raw.id === C.TextId.Notification) {
      const entry =
        text === 'Gomald escorts you to your private vault.'
          ? 'vault'
          : text === 'Gomald escorts you to your guild vault.'
            ? 'gvault'
            : undefined
      if (entry) {
        this.stop()
        if (!this.autoGather) return
        const scan: Scan = { kind: entry, pending: false, remaining: [], seen: new Set() }
        this.scan = scan
        void this.loaded.then(() => this.request(scan))
      } else if (text === 'You must be in your vault to take inventory.') {
        const aborted = !!this.scan || this.interruptedScan
        this.stop()
        if (aborted) this.showAbortedHint()
      }
    } else if (event.raw.id === C.TextId.Hint && text && this.scan) {
      const scan = this.scan
      const placeholder = this.scanHint(scan, text)
      if (!placeholder || event.command.text !== placeholder) {
        this.stop()
        return
      }
      if (!scan.pending) return
      if (scan.seen.has(text)) return
      if (scan.category) {
        scan.draft!.categories[scan.category] = text
        scan.categoryPosition!++
      } else {
        const inventory = parseInventory(text)
        if (!inventory) {
          this.stop()
          return
        }
        scan.draft = {
          gold: inventory.gold,
          items: text,
          categories: Object.create(null),
          lastUpdate: 0,
        }
        scan.remaining = inventory.categories
        scan.categoryPosition = /\d[\d,]* gold\b/.test(text) ? 2 : 1
      }
      scan.placeholder = placeholder
      scan.seen.add(text)
      scan.pending = false
      this.clearTimeout()
      scan.category = scan.remaining.shift()
      // Input and local output must happen after the native drawing stack completes.
      queueMicrotask(() => {
        if (this.scan !== scan) return
        if (!this.ready()) {
          this.stop()
          return
        }
        if (scan.category) this.scheduleCategory(scan)
        else {
          const draft = scan.draft!
          draft.lastUpdate = Date.now()
          this.memory = { ...this.memory, [scan.kind]: withHistory(this.memory[scan.kind], draft) }
          this.stop()
          this.save(this.player, this.memory)
          this.hint?.()
          this.hint = this.getChat()?.showHint('Vault Memory Updated.', { dismissServerMenu: true })
        }
      })
    }
  }

  private showAbortedHint(): void {
    this.interruptedScan = true
    const generation = this.generation
    const revision = this.revision
    // Never render or send Escape from inside the native drawing callback.
    queueMicrotask(() => {
      if (
        !this.interruptedScan ||
        generation !== this.generation ||
        revision !== this.revision ||
        !this.ready()
      )
        return
      this.interruptedScan = false
      this.hint?.()
      this.hint = this.getChat()?.showHint('Exited Vault\nVault Memory Update Aborted!', {
        dismissServerMenu: true,
      })
    })
  }

  /** Pure projection used by both the pre-draw transform and response observer. */
  private scanHint(scan: Scan, text: string): string | undefined {
    if (vaultKind(text) !== scan.kind) return
    if (scan.seen.has(text)) return scan.placeholder
    if (!scan.pending) return
    let completed = 0
    let total: number
    if (scan.category) {
      // The protocol has no request IDs: require the requested category in the reply.
      const category = scan.category
        .replace(/\s*\(\d+\)$/, '')
        .toLowerCase()
        .replace(/s$/, '')
      if (!text.toLowerCase().includes(category)) return
      completed = Object.keys(scan.draft!.categories).length + 1
      total = completed + scan.remaining.length
    } else {
      const inventory = parseInventory(text)
      if (!inventory) return
      total = inventory.categories.length
    }
    return completed === total
      ? 'Vault Memory Updated.'
      : `Updating Vault Memory: ${completed} of ${total}`
  }

  private scheduleCategory(scan: Scan): void {
    const schedule = () => {
      if (this.scan !== scan) return
      this.delay = setTimeout(() => {
        this.delay = undefined
        this.request(scan)
      }, CATEGORY_REQUEST_DELAY_MS)
    }
    // Preserve the original extra zero-length pause before every sixth position.
    if (scan.categoryPosition! % 6 === 0 && Object.keys(scan.draft!.categories).length > 0)
      this.delay = setTimeout(schedule, REQUEST_PAUSE_MS)
    else schedule()
  }

  private request(scan: Scan): void {
    if (this.scan !== scan || scan.pending) return
    if (!this.ready() || !this.storageReady) {
      this.stop()
      return
    }
    scan.pending = true
    // The response deadline begins when the delayed request is actually dispatched.
    this.timeout = setTimeout(() => {
      if (this.scan !== scan) return
      this.stop()
      if (this.ready())
        this.getChat()?.notify('Vault memory update timed out. The previous memory was kept.')
    }, RESPONSE_TIMEOUT_MS)
    const request = scan.category ? `vaultinventory ${scan.category}` : 'vaultinventory'
    if (this.utils.input.sendBufferedText(request).status !== 'ok') {
      this.stop()
      this.getChat()?.notify('Could not request vault inventory. The previous memory was kept.')
    }
  }

  private clearTimeout(): void {
    if (this.timeout) clearTimeout(this.timeout)
    this.timeout = undefined
  }

  private stop(): void {
    this.revision++
    this.clearTimeout()
    if (this.delay !== undefined) clearTimeout(this.delay)
    this.delay = undefined
    this.scan = undefined
    this.interruptedScan = false
  }

  /** Called before the normal input path sends the user's Escape. */
  dismiss(): void {
    this.stop()
  }

  private reset(): void {
    this.generation++
    this.stop()
    const hint = this.hint
    this.hint = undefined
    if (hint) queueMicrotask(hint)
  }

  dispose(): void {
    this.closed = true
    this.reset()
    for (const command of this.commands.values()) command()
    this.commands.clear()
    for (const cleanup of this.cleanups.splice(0)) cleanup()
  }
}
