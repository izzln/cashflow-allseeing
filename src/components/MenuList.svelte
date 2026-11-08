<script lang="ts">
  import MenuList from './MenuList.svelte';
  import { commands, isEnabled, labelOf, run, shortcutText, type MenuItem } from '../lib/commands';

  let { items, onclose }: { items: MenuItem[]; onclose: () => void } = $props();
  let openSub = $state<number | null>(null);
  let listEl = $state<HTMLElement | null>(null);

  function pick(id: string) {
    if (run(id)) onclose();
  }

  // Up/down move between items; right opens a submenu; Escape closes.
  function onKey(e: KeyboardEvent) {
    const buttons = [...(listEl?.querySelectorAll<HTMLButtonElement>(':scope > li > button:not(:disabled)') ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const n = buttons.length;
      buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onclose();
    }
  }

  export function focusFirst() {
    listEl?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<ul class="menu" role="menu" bind:this={listEl} onkeydown={onKey}>
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
          onclick={() => (openSub = i)}
          onpointerenter={(e) => e.pointerType === 'mouse' && (openSub = i)}
          onkeydown={(e) => e.key === 'ArrowRight' && (openSub = i)}>
          <span class="check"></span>
          <span class="label">{item.title}</span>
          <span class="keys">▸</span>
        </button>
        {#if openSub === i}
          <div class="flyout"><MenuList items={item.items} {onclose} /></div>
        {/if}
      </li>
    {/if}
  {/each}
</ul>

<style>
  .menu {
    list-style: none;
    margin: 0;
    padding: 5px;
    min-width: 220px;
    background: rgba(255, 255, 255, 0.98);
    border: 1px solid var(--line);
    border-radius: 10px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
    -webkit-backdrop-filter: blur(20px);
    backdrop-filter: blur(20px);
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
    border-radius: 5px;
    padding: 4px 8px;
    min-height: 28px;
    text-align: left;
    gap: 6px;
  }
  @media (pointer: coarse) {
    button {
      min-height: 44px;
    }
  }
  button:not(:disabled):hover,
  button:not(:disabled):focus-visible,
  button[aria-expanded='true'] {
    background: var(--accent);
    color: #fff;
    outline: none;
  }
  button:not(:disabled):hover .keys,
  button:not(:disabled):focus-visible .keys {
    color: rgba(255, 255, 255, 0.85);
  }
  .check {
    width: 14px;
    flex-shrink: 0;
  }
  .label {
    flex: 1;
    white-space: nowrap;
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
</style>
