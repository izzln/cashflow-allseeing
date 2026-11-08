<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { commands, contextItems, editMenuItems, isEnabled, labelOf, run } from '../lib/commands';
  import MenuList from './MenuList.svelte';
  import { fadeOut } from '../lib/motion';

  const menu = $derived(app.menu);
  let w = $state(0);
  let h = $state(0);

  const compact = $derived(app.sizeClass === 'compact');

  // Keep menus inside the window (Stories: ContextMenu flips and shifts; compact scrolls).
  const pos = $derived.by(() => {
    if (!menu || typeof window === 'undefined') return '';
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (menu.kind === 'context') {
      const mw = w || 240;
      const mh = h || 300;
      // Flip to the other side of the pointer when there's no room, then shift to fit.
      let x = menu.x + mw > W - 8 && menu.x - mw >= 8 ? menu.x - mw : menu.x;
      let y = menu.y + mh > H - 8 && menu.y - mh >= 8 ? menu.y - mh : menu.y;
      x = Math.max(8, Math.min(x, W - mw - 8));
      y = Math.max(8, Math.min(y, H - mh - 8));
      return `left:${x}px;top:${y}px`;
    }
    // The edit menu sits centred above the selection, or below it near the top of the screen,
    // 16px from the window's sides.
    const x = Math.min(Math.max(16, menu.x - (w || 300) / 2), Math.max(16, W - (w || 300) - 16));
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

  // The touch edit menu has no backdrop: a tap anywhere else closes it and still does
  // what it was aimed at (e.g. a toolbar button), as on iPadOS.
  $effect(() => {
    if (app.menu?.kind !== 'edit') return;
    const onDown = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest?.('.edit')) return;
      app.menuClosedAt = e.timeStamp;
      close();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  });
</script>

{#if menu}
  {#if menu.kind === 'context'}
    <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
    <div class="backdrop" onclick={backdropClick} oncontextmenu={(e) => { e.preventDefault(); close(); }}></div>
    <div class="ctx" class:compact style={pos} bind:clientWidth={w} bind:clientHeight={h} out:fadeOut>
      <MenuList items={contextItems(menu.target)} onclose={close} inPlace={compact} />
    </div>
  {:else if editItems.length}
    <div class="edit anim-edit" style={pos} role="menu" aria-label="Edit menu" bind:clientWidth={w} bind:clientHeight={h} out:fadeOut>
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
    z-index: calc(var(--z-popup) - 50);
  }
  .ctx {
    position: fixed;
    z-index: var(--z-popup);
  }
  /* Compact: the menu scrolls within the window (its submenus open in place). */
  .ctx.compact {
    max-height: calc(100dvh - 16px);
    overflow-y: auto;
    border-radius: var(--radius-10);
  }
  /* iOS-style edit menu: a dark pill of commands. */
  .edit {
    position: fixed;
    z-index: var(--z-popup);
    display: flex;
    background: var(--menu-dark);
    border-radius: var(--radius-10);
    box-shadow: var(--shadow-edit-menu);
    overflow: hidden;
    max-width: calc(100vw - 32px);
    overflow-x: auto;
  }
  .edit button {
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--menu-dark-ink);
    min-height: var(--touch-target);
    padding: 0 14px;
    white-space: nowrap;
    border-right: 1px solid var(--menu-dark-divider);
  }
  .edit button:last-child {
    border-right: none;
  }
  .edit button:active {
    background: var(--menu-dark-divider);
  }
</style>
