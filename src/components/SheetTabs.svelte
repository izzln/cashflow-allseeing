<script lang="ts">
  import { tick } from 'svelte';
  import { app } from '../lib/store.svelte';

  /**
   * Sheet tabs. Click selects; clicking the active tab again (or double-click) renames it in place.
   * Drag a tab to reorder (mouse, or press-and-drag on touch); right-click or long-press opens the
   * sheet menu (Rename, Duplicate, Move Left/Right, Delete). Tabs are not Tab stops (Stories: Tabs).
   */
  let draft = $state('');
  let inputEl = $state<HTMLInputElement | null>(null);
  let navEl = $state<HTMLElement | null>(null);
  const renaming = $derived(app.renamingSheetId);

  $effect(() => {
    const id = app.renamingSheetId;
    if (!id) return;
    draft = app.wb.sheets.find((s) => s.id === id)?.name ?? '';
    tick().then(() => {
      inputEl?.focus();
      inputEl?.select();
    });
  });

  function startRename(id: string) {
    if (!app.readonly) app.renamingSheetId = id;
  }

  function finish(save: boolean) {
    if (save && renaming) app.renameSheet(renaming, draft);
    app.renamingSheetId = null;
  }

  function openMenu(id: string, x: number, y: number) {
    if (app.activeSheetId !== id) app.setSheet(id);
    app.menu = { kind: 'context', target: 'sheet', tableId: '', x, y };
  }

  // ----- drag to reorder -----
  let drag = $state<{ id: string; x0: number; moved: boolean; to: number; marker: number; pointer: string } | null>(null);
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let pressedMenu = false;

  function tabs(): HTMLElement[] {
    return [...(navEl?.querySelectorAll<HTMLElement>('.tab[data-sheet]') ?? [])];
  }

  function down(e: PointerEvent, id: string) {
    if (e.button === 2 || renaming === id) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { id, x0: e.clientX, moved: false, to: -1, marker: 0, pointer: e.pointerType };
    pressedMenu = false;
    if (e.pointerType === 'touch') {
      const { clientX, clientY } = e;
      pressTimer = setTimeout(() => {
        if (drag && !drag.moved) {
          pressedMenu = true;
          openMenu(id, clientX, clientY);
        }
      }, 550);
    }
  }

  function move(e: PointerEvent) {
    if (!drag || app.readonly) return;
    if (!drag.moved && Math.abs(e.clientX - drag.x0) < 5) return;
    if (pressTimer) clearTimeout(pressTimer);
    drag.moved = true;
    const list = tabs();
    const box = navEl!.getBoundingClientRect();
    let to = list.length;
    for (const [i, el] of list.entries()) {
      const r = el.getBoundingClientRect();
      if (e.clientX < r.left + r.width / 2) {
        to = i;
        break;
      }
    }
    drag.to = to;
    const ref = list[Math.min(to, list.length - 1)].getBoundingClientRect();
    drag.marker = (to < list.length ? ref.left : ref.right) - box.left + navEl!.scrollLeft - 2;
  }

  function up() {
    if (pressTimer) clearTimeout(pressTimer);
    const d = drag;
    drag = null;
    if (!d || pressedMenu) return;
    if (d.moved) {
      if (d.to >= 0) app.moveSheetTo(d.id, d.to);
    } else if (app.activeSheetId === d.id) {
      startRename(d.id);
    } else {
      app.setSheet(d.id);
    }
  }

  // The active tab stays in view when the row scrolls sideways (Stories: Responsive layout).
  $effect(() => {
    const id = app.activeSheetId;
    void app.width;
    navEl?.querySelector<HTMLElement>(`.tab[data-sheet="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
</script>

<nav class="tabs" bind:this={navEl} aria-label="Sheets">
  {#each app.wb.sheets as s (s.id)}
    <div class="tab" data-sheet={s.id} class:active={s.id === app.activeSheetId} class:dragging={drag?.moved && drag.id === s.id}>
      {#if renaming === s.id}
        <input
          bind:this={inputEl}
          bind:value={draft}
          aria-label="Sheet name"
          onblur={() => finish(true)}
          onkeydown={(e) => {
            if (e.isComposing || e.keyCode === 229) return;
            if (e.key === 'Enter') finish(true);
            if (e.key === 'Escape') finish(false);
          }}
        />
      {:else}
        <button
          class="name"
          role="tab"
          aria-selected={s.id === app.activeSheetId}
          title={app.readonly ? s.name : 'Drag to move · click again to rename · right-click for more'}
          onpointerdown={(e) => down(e, s.id)}
          onpointermove={move}
          onpointerup={up}
          onpointercancel={() => {
            if (pressTimer) clearTimeout(pressTimer);
            drag = null;
          }}
          ondblclick={() => startRename(s.id)}
          oncontextmenu={(e) => {
            e.preventDefault();
            drag = null;
            openMenu(s.id, e.clientX, e.clientY);
          }}
          tabindex="-1"
        >{s.name}</button>
      {/if}
    </div>
  {/each}
  {#if drag?.moved && drag.to >= 0}<span class="marker" style="left:{drag.marker}px"></span>{/if}
  {#if !app.readonly}
    <button class="add" onclick={() => app.addSheet()} title="Add sheet">+ Sheet</button>
  {/if}
</nav>

<style>
  .tabs {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    overflow-x: auto;
    padding: 4px 12px;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
    flex-shrink: 0;
  }
  .tab {
    display: flex;
    align-items: center;
    border-radius: var(--radius-8);
    padding: 2px;
  }
  .tab.active {
    background: var(--accent-soft);
  }
  .tab button {
    border: none;
    background: transparent;
    white-space: nowrap;
  }
  .tab.active .name {
    color: var(--accent);
    font-weight: 600;
  }
  .tab input {
    width: 140px;
    padding: 4px 6px;
    border: 1px solid var(--accent);
    border-radius: var(--radius-6);
  }
  .add {
    white-space: nowrap;
    color: var(--muted);
  }
  .tab .name {
    touch-action: none;
    cursor: default;
    user-select: none;
    -webkit-user-select: none;
  }
  .tab.dragging {
    opacity: 0.5;
  }
  .marker {
    position: absolute;
    top: 6px;
    bottom: 6px;
    width: 3px;
    border-radius: 2px;
    background: var(--accent);
    pointer-events: none;
  }
</style>
