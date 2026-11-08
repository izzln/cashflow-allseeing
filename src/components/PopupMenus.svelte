<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { commands, contextItems, editMenuItems, isEnabled, labelOf, run } from '../lib/commands';
  import MenuList from './MenuList.svelte';

  const menu = $derived(app.menu);
  let w = $state(0);
  let h = $state(0);

  // Keep menus on screen.
  const pos = $derived.by(() => {
    if (!menu || typeof window === 'undefined') return '';
    if (menu.kind === 'context') {
      const x = Math.min(menu.x, window.innerWidth - (w || 240) - 8);
      const y = Math.min(menu.y, window.innerHeight - (h || 300) - 8);
      return `left:${Math.max(8, x)}px;top:${Math.max(8, y)}px`;
    }
    // The edit menu sits centred above the selection, or below it near the top of the screen.
    const x = Math.min(Math.max(8, menu.x - (w || 300) / 2), window.innerWidth - (w || 300) - 8);
    const above = menu.y - (h || 44) - 10;
    return `left:${x}px;top:${above < 60 ? menu.y + 40 : above}px`;
  });

  const editItems = $derived(menu?.kind === 'edit' ? editMenuItems(menu.target).filter((id) => commands[id] && isEnabled(commands[id])) : []);
  const close = () => (app.menu = null);

  // After a tap the browser sends a click to whatever is now under the finger — the
  // backdrop of the menu that tap just opened. Ignore clicks that arrive right away.
  let openedAt = 0;
  $effect(() => {
    if (app.menu) openedAt = performance.now();
  });
  function backdropClick() {
    if (performance.now() - openedAt > 400) close();
  }
</script>

{#if menu}
  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
  <div class="backdrop" class:clear={menu.kind === 'edit'} onclick={backdropClick} oncontextmenu={(e) => { e.preventDefault(); close(); }}></div>
  {#if menu.kind === 'context'}
    <div class="ctx" style={pos} bind:clientWidth={w} bind:clientHeight={h}>
      <MenuList items={contextItems(menu.target)} onclose={close} />
    </div>
  {:else if editItems.length}
    <div class="edit" style={pos} role="menu" aria-label="Edit menu" bind:clientWidth={w} bind:clientHeight={h}>
      {#each editItems as id (id)}
        <button role="menuitem" onclick={() => run(id)}>{labelOf(commands[id])}</button>
      {/each}
      <button role="menuitem" class="more" aria-label="More" onclick={() => app.menu && (app.menu = { ...app.menu, kind: 'context' })}>•••</button>
    </div>
  {/if}
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 2900;
  }
  .ctx {
    position: fixed;
    z-index: 2950;
  }
  /* iOS-style edit menu: a dark pill of commands. */
  .edit {
    position: fixed;
    z-index: 2950;
    display: flex;
    background: #2b2b2d;
    border-radius: 10px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
    overflow: hidden;
    max-width: calc(100vw - 16px);
    overflow-x: auto;
  }
  .edit button {
    border: none;
    border-radius: 0;
    background: transparent;
    color: #fff;
    min-height: 44px;
    padding: 0 14px;
    white-space: nowrap;
    border-right: 1px solid rgba(255, 255, 255, 0.15);
  }
  .edit button:last-child {
    border-right: none;
  }
  .edit button:active {
    background: rgba(255, 255, 255, 0.15);
  }
</style>
