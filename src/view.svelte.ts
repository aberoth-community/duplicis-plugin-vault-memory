import type { CharacterMemory } from './memory'

export class VaultView {
  current = $state('')
  characters: string[] = $state.raw([])
  memories: Record<string, CharacterMemory> = $state.raw({})

  remember(player: string, memory: CharacterMemory) {
    this.memories = { ...this.memories, [player.toLowerCase()]: memory }
  }
}
