<script lang="ts">
  import { onMount } from 'svelte'
  import { SettingPlugin } from '@duplicis/plugin-settings'
  import { i18n, type BankVaultMemoryPlugin } from '../plugin'
  import { freshness, sameName, withHistory, type PlotRange, type VaultKind } from '../memory'
  import History from './History.svelte'
  let { plugin }: { plugin: BankVaultMemoryPlugin } = $props()
  let selected = $state('')
  let kind: VaultKind = $state('vault')
  let metric = $state('')
  let range: PlotRange = $state('week')
  let now = $state(Date.now())
  const player = $derived(selected || plugin.view.current)
  const memory = $derived(plugin.view.memories[player])
  const vault = $derived(memory?.[kind])
  const history = $derived(
    vault?.history ?? (vault ? withHistory(undefined, vault).history : undefined) ?? {},
  )
  const categories = $derived(
    Object.entries(history).filter(([key]) => key.startsWith('category:')),
  )
  const series = $derived(history[metric])
  $effect(() => {
    if (!history[metric])
      metric =
        Object.keys(history).find((key) => key.startsWith('item:')) ?? Object.keys(history)[0] ?? ''
  })
  onMount(() => {
    const timer = setInterval(() => (now = Date.now()), 30000)
    return () => clearInterval(timer)
  })
  const delta = (value?: string) =>
    value === undefined ? '—' : BigInt(value) > 0n ? `+${value}` : value
</script>

<div class="vault-memory" data-game-input="ignore">
  <header>
    <h2>{i18n.t.ui.title()}</h2>
    <button
      class="btn"
      type="button"
      aria-label={i18n.t.ui.settings()}
      title={i18n.t.ui.settings()}
      onmousedown={(event) => event.preventDefault()}
      onclick={() => SettingPlugin.openMenu(plugin.constructor as typeof BankVaultMemoryPlugin)}
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        aria-hidden="true"
        ><path
          d="m9.5 3-.6 2.3-1.6.9L5 5.6 2.5 9.9l1.7 1.7v1.8l-1.7 1.7L5 19.4l2.3-.6 1.6.9.6 2.3h5l.6-2.3 1.6-.9 2.3.6 2.5-4.3-1.7-1.7v-1.8l1.7-1.7L19 5.6l-2.3.6-1.6-.9-.6-2.3z"
        /><circle cx="12" cy="12.5" r="3" /></svg
      >
    </button>
  </header>
  <label
    >{i18n.t.ui.character()}
    <select class="select" bind:value={selected}>
      <option value=""
        >{i18n.t.ui.current()}{plugin.view.current ? ` (${plugin.view.current})` : ''}</option
      >
      {#each plugin.view.characters as character}<option value={character}>{character}</option
        >{/each}
    </select>
  </label>
  <label
    >{i18n.t.ui.storage()}
    <select class="select" bind:value={kind}
      ><option value="vault">{i18n.t.ui.private()}</option><option value="gvault"
        >{i18n.t.ui.guild()}</option
      ></select
    >
  </label>
  {#if memory?.bank}
    <p title={new Date(memory.bank.lastUpdate).toLocaleString()}>
      {i18n.t.ui.bank()}: {memory.bank.gold}
      {i18n.t.ui.gold()} · {i18n.t.ui.observed()}
      {freshness(memory.bank.lastUpdate, now, i18n.t.ui.language())}
    </p>
  {/if}
  {#if vault}
    <p class="vault-freshness" title={new Date(vault.lastUpdate).toLocaleString()}>
      {i18n.t.ui.last_scan()}
      {freshness(vault.lastUpdate, now, i18n.t.ui.language())}
    </p>
    <p>{i18n.t.ui.vault_gold()}: {vault.gold}</p>
    <p class="vault-note">
      {i18n.t.ui.changes()}
    </p>
    <div class="vault-categories">
      {#each categories as [key, category]}
        {@const items = Object.entries(history).filter(
          ([itemKey, item]) =>
            itemKey.startsWith('item:') && sameName(item.category, category.label),
        )}
        <details>
          <summary
            ><span>{category.label}</span><span>{category.points.at(-1)?.value ?? '0'}</span><span
              class="vault-delta"
              data-sign={category.delta?.startsWith('-') ? 'loss' : 'gain'}
              >{delta(category.delta)}</span
            ></summary
          >
          {#if items.length}
            <ul class="vault-items">
              {#each items as [itemKey, item]}
                <li data-item={itemKey}>
                  <span>{item.points.at(-1)?.value ?? '0'} {item.label}</span>
                  {#if item.scanDelta && BigInt(item.scanDelta) !== 0n}
                    <span
                      class="vault-delta"
                      data-sign={item.scanDelta.startsWith('-') ? 'loss' : 'gain'}
                      >{delta(item.scanDelta)}</span
                    >
                  {/if}
                </li>
              {/each}
            </ul>
          {:else}
            <pre>{vault.categories[category.label] ?? i18n.t.ui.removed()}</pre>
          {/if}
          <button class="btn" type="button" onclick={() => (metric = key)}
            >{i18n.t.ui.plot_category()}</button
          >
        </details>
      {/each}
    </div>
    {#if !categories.length}<p>{i18n.t.ui.empty()}</p>{/if}
    {#if Object.keys(history).length}
      <label
        >{i18n.t.ui.plot()}
        <select class="select" bind:value={metric}>
          {#each Object.entries(history) as [key, entry]}<option value={key}
              >{entry.category ? entry.category : i18n.t.ui.category()} / {entry.label}</option
            >{/each}
        </select>
      </label>
      <label
        >{i18n.t.ui.time_range()}
        <select class="select" bind:value={range}>
          {#each ['day', 'week', 'month', 'threeMonths'] as option}
            <option value={option}>{i18n.t.ui.ranges[option as PlotRange]()}</option>
          {/each}
        </select>
      </label>
      {#if series}<History {series} {now} {range} />{/if}
      <p class="vault-note">
        {i18n.t.ui.history_note()}
      </p>
    {/if}
  {:else}
    <p>
      {i18n.t.ui.no_memory()}
    </p>
  {/if}
</div>
