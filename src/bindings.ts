import type { Duplicis } from '@duplicis/types'
import { DEFAULT_GUILD_PATTERN, DEFAULT_VAULT_PATTERN } from './controller'

export const createBindings = (plugin: Duplicis.Plugin) => ({
  showSidebar: plugin.config('show_sidebar', 'bool', {
    default: true,
    i18n: {
      en: {
        display_name: 'Show vault sidebar',
        description:
          'Show the vault memory sidebar. Memory gathering and recall commands continue when hidden.',
      },
      es: {
        display_name: 'Mostrar panel de bóveda',
        description:
          'Muestra el panel de memoria. La recopilación y los comandos siguen activos al ocultarlo.',
      },
      'pt-BR': {
        display_name: 'Mostrar painel do cofre',
        description: 'Mostra o painel de memória. A coleta e os comandos continuam quando oculto.',
      },
    },
  }),
  showBankBalance: plugin.config('show_bank_balance', 'bool', {
    default: true,
    i18n: {
      en: {
        display_name: 'Show bank balance outside the bank',
        description:
          'Show the last remembered bank balance in the status bar when the bank does not provide it.',
      },
      es: {
        display_name: 'Mostrar saldo fuera del banco',
        description:
          'Muestra el último saldo recordado en la barra de estado cuando el banco no lo proporciona.',
      },
      'pt-BR': {
        display_name: 'Mostrar saldo fora do banco',
        description:
          'Mostra o último saldo registrado na barra de estado quando o banco não o fornece.',
      },
    },
  }),
  autoGather: plugin.config('gather_on_entry', 'bool', {
    default: true,
    i18n: {
      en: {
        display_name: 'Gather memory on entry',
        description:
          'Automatically update memory when entering your private or guild vault. Disabling cancels an active scan and keeps saved memories.',
      },
      es: {
        display_name: 'Recopilar al entrar',
        description:
          'Actualiza la memoria al entrar en tu bóveda privada o de gremio. Desactivar cancela el escaneo y conserva la memoria guardada.',
      },
      'pt-BR': {
        display_name: 'Coletar ao entrar',
        description:
          'Atualiza a memória ao entrar no cofre privado ou da guilda. Desativar cancela a coleta e mantém a memória salva.',
      },
    },
  }),
  vaultPattern: plugin.config('vault_command_pattern', 'text', {
    default: DEFAULT_VAULT_PATTERN,
    i18n: {
      en: {
        display_name: 'Vault command prefix regex',
        description: `Case-insensitive prefix. Default: ${DEFAULT_VAULT_PATTERN}. An optional item category is supported automatically.`,
      },
      es: {
        display_name: 'Regex del prefijo de bóveda',
        description: `Prefijo sin distinguir mayúsculas. Predeterminado: ${DEFAULT_VAULT_PATTERN}. La categoría es opcional.`,
      },
      'pt-BR': {
        display_name: 'Regex do prefixo do cofre',
        description: `Prefixo sem distinguir maiúsculas. Padrão: ${DEFAULT_VAULT_PATTERN}. A categoria é opcional.`,
      },
    },
  }),
  guildPattern: plugin.config('guild_vault_command_pattern', 'text', {
    default: DEFAULT_GUILD_PATTERN,
    i18n: {
      en: {
        display_name: 'Guild vault command prefix regex',
        description: `Case-insensitive prefix. Default: ${DEFAULT_GUILD_PATTERN}. An optional item category is supported automatically.`,
      },
      es: {
        display_name: 'Regex del prefijo de bóveda de gremio',
        description: `Prefijo sin distinguir mayúsculas. Predeterminado: ${DEFAULT_GUILD_PATTERN}. La categoría es opcional.`,
      },
      'pt-BR': {
        display_name: 'Regex do prefixo do cofre da guilda',
        description: `Prefixo sem distinguir maiúsculas. Padrão: ${DEFAULT_GUILD_PATTERN}. A categoria é opcional.`,
      },
    },
  }),
})
