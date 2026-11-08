<script lang="ts">
  import { tick } from 'svelte';
  import MenuList from './MenuList.svelte';
  import { commands, isEnabled, labelOf, run, shortcutText, type MenuItem } from '../lib/commands';

  /**
   * A command menu (Stories: ContextMenu). Rows react to pointer and touch only: they highlight
   * under the pointer or finger; there is no arrow-key navigation. Esc closes (App handles it).
   * `inPlace` (compact width): a submenu replaces this list, with a row to go back.
   */
  let { items, onclose, inPlace = false }: { items: MenuItem[]; onclose: () => void; inPlace?: boolean } = $props();
  let openSub = $state<number | null>(null);
  /** A flyout that would leave the window opens to the left instead. */
  let flipSub = $state(false);
  let listEl = $state<HTMLElement | null>(null);

  function pick(id: string) {
    if (run(id)) onclose();
  }

  async function open(i: number) {
    openSub = i;
    flipSub = false;
    if (inPlace) return;
    await tick();
    const fly = listEl?.querySelector<HTMLElement>(':scope > li.sub > .flyout');
    if (fly && fly.getBoundingClientRect().right > window.innerWidth - 8) flipSub = true;
  }

  const sub = $derived(openSub !== null && inPlace ? items[openSub] : null);
</script>

{#if sub && typeof sub === 'object'}
  <ul class="menu" role="menu">
    <li role="none">
      <button role="menuitem" class="back" onclick={() => (openSub = null)}>
        <span class="check">‹</span><span class="label">{sub.title}</span>
      </button>
    </li>
    <li class="sep" role="separator"></li>
    <li role="none" class="nested"><MenuList items={sub.items} {onclose} inPlace /></li>
  </ul>
{:else}
  <ul class="menu" role="menu" bind:this={listEl}>
    {#each items as item, i (i)}
      {#if item === '-'}
        <li class="sep" role="separator"></li>
      {:else if typeof item === 'string'}
        {@const c = commands[item]}
        {#if c}
          <li role="none">
            <button role="menuitem" disabled={!isEnabled(c)} onclick={() => pick(item)} onpointerenter={() => (openSub = null)}>
              <span class="check">{c.checked?.() ? '✓' : ''}</span>
              <span class="label">{labelOf(c)}</span>
              <span class="keys">{shortcutText(c.keys)}</span>
            </button>
          </li>
        {/if}
      {:else}
        <li role="none" class="sub">
          <button role="menuitem" aria-haspopup="menu" aria-expanded={openSub === i}
            onclick={() => open(i)}
            onpointerenter={(e) => e.pointerType === 'mouse' && openSub !== i && open(i)}>
            <span class="check"></span>
            <span class="label">{item.title}</span>
            <span class="keys">▸</span>
          </button>
          {#if openSub === i && !inPlace}
            <div class="flyout" class:left={flipSub}><MenuList items={item.items} {onclose} /></div>
          {/if}
        </li>
      {/if}
    {/each}
  </ul>
{/if}

<style>
  .menu {
    list-style: none;
    margin: 0;
    padding: 5px;
    min-width: var(--menu-min-w);
    background: var(--menu-bg);
    border: 1px solid var(--line);
    border-radius: var(--radius-10);
    box-shadow: var(--shadow-menu);
    -webkit-backdrop-filter: blur(20px);
    backdrop-filter: blur(20px);
  }
  /* A submenu shown in place: its own list without a second card around it. */
  .nested :global(.menu) {
    padding: 0;
    border: none;
    box-shadow: none;
    background: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
  li {
    position: relative;
  }
  button {
    display: flex;
    align-items: center;
    width: 100%;
    border: none;
    background: none;
    border-radius: var(--radius-5);
    padding: 4px 8px;
    min-height: var(--row-h);
    text-align: left;
    gap: 6px;
    cursor: default;
  }
  @media (pointer: coarse) {
    button {
      min-height: var(--touch-target);
    }
  }
  button:not(:disabled):hover,
  button:not(:disabled):active,
  button[aria-expanded='true'] {
    background: var(--accent);
    color: var(--on-accent);
    outline: none;
  }
  button:not(:disabled):hover .keys,
  button:not(:disabled):active .keys,
  button[aria-expanded='true'] .keys {
    color: var(--on-accent-muted);
  }
  .check {
    width: 14px;
    flex-shrink: 0;
  }
  .label {
    flex: 1;
    white-space: nowrap;
  }
  .back .label {
    font-weight: 600;
  }
  .keys {
    color: var(--muted);
    font-size: 12px;
    white-space: nowrap;
    margin-left: 16px;
  }
  .sep {
    height: 1px;
    background: var(--line);
    margin: 4px 6px;
  }
  .flyout {
    position: absolute;
    left: calc(100% - 4px);
    top: -5px;
    z-index: 1;
  }
  .flyout.left {
    left: auto;
    right: calc(100% - 4px);
  }
</style>
