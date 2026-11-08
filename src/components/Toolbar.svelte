<script lang="ts">
  import { app, ZOOM_STEPS } from '../lib/store.svelte';
  import { commands, isEnabled, labelOf, run, shortcutText } from '../lib/commands';
  import { STYLES } from '../lib/styles';
  import Icon, { type IconName } from './Icon.svelte';
  import { fadeOut } from '../lib/motion';

  /**
   * The toolbar sits at the right of the top row. As the window narrows it first drops
   * the labels under the icons, then moves items into a » overflow menu, least used
   * first (HIG: toolbars). The Inspector button always stays.
   */
  type Item = {
    key: string;
    kind: 'button' | 'color' | 'zoom';
    cmd?: string;
    icon: IconName;
    label: string;
    group: string;
    /** Shown in read-only snapshot windows too. */
    view?: boolean;
    pinned?: boolean;
    title?: string;
  };

  const ITEMS: Item[] = [
    { key: 'cashflow', kind: 'button', cmd: 'insert.cashflow', icon: 'cashflow', label: 'Cashflow', group: 'insert', title: 'Insert a cashflow: month-by-month cash flow' },
    { key: 'table', kind: 'button', cmd: 'insert.table', icon: 'table', label: 'Table', group: 'insert', title: 'Insert a table: rows with typed columns' },
    { key: 'rowAbove', kind: 'button', cmd: 'insert.rowAbove', icon: 'rowAbove', label: 'Row Above', group: 'lines' },
    { key: 'rowBelow', kind: 'button', cmd: 'insert.rowBelow', icon: 'rowBelow', label: 'Row Below', group: 'lines' },
    { key: 'colBefore', kind: 'button', cmd: 'insert.colBefore', icon: 'colBefore', label: 'Col. Before', group: 'lines' },
    { key: 'colAfter', kind: 'button', cmd: 'insert.colAfter', icon: 'colAfter', label: 'Col. After', group: 'lines' },
    { key: 'deleteRow', kind: 'button', cmd: 'table.deleteRows', icon: 'deleteRow', label: 'Delete Row', group: 'lines' },
    { key: 'deleteCol', kind: 'button', cmd: 'table.deleteColumns', icon: 'deleteCol', label: 'Delete Col.', group: 'lines' },
    { key: 'color', kind: 'color', icon: 'color', label: 'Format', group: 'format', title: 'Cell format: text alignment and color' },
    { key: 'fill', kind: 'button', cmd: 'table.maximize', icon: 'fill', label: 'Fill Window', group: 'view', view: true },
    { key: 'zoom', kind: 'zoom', icon: 'zoomIn', label: 'Zoom', group: 'view', view: true },
    { key: 'inspector', kind: 'button', cmd: 'view.inspector', icon: 'inspector', label: 'Inspector', group: 'panel', view: true, pinned: true },
  ];
  /** First to move into the overflow menu when space runs out. */
  const OVERFLOW_ORDER = ['deleteCol', 'colAfter', 'colBefore', 'deleteRow', 'rowBelow', 'rowAbove', 'fill', 'color', 'zoom', 'table', 'cashflow'];
  const SEP = 9; // group divider incl. margins
  const MORE = 36; // the » button (touch-target)

  const items = $derived(ITEMS.filter((it) => !app.readonly || it.view));

  // Natural widths, measured from an invisible copy of the toolbar (with and without labels).
  let wide = $state<Record<string, number>>({});
  let narrow = $state<Record<string, number>>({});
  let avail = $state(0);

  function width(list: Item[], w: Record<string, number>, more: boolean): number {
    let sum = 0;
    let groups = 0;
    let last = '';
    for (const it of list) {
      sum += w[it.key] ?? 36;
      if (it.group !== last) groups++;
      last = it.group;
    }
    return sum + Math.max(0, groups - 1) * SEP + (more ? MORE + SEP : 0);
  }

  const layout = $derived.by(() => {
    if (!avail) return { labels: true, shown: items, hidden: [] as Item[] };
    if (width(items, wide, false) <= avail) return { labels: true, shown: items, hidden: [] as Item[] };
    if (width(items, narrow, false) <= avail) return { labels: false, shown: items, hidden: [] as Item[] };
    let shown = [...items];
    const hidden: Item[] = [];
    for (const key of OVERFLOW_ORDER) {
      const i = shown.findIndex((it) => it.key === key);
      if (i < 0) continue;
      hidden.unshift(shown[i]);
      shown.splice(i, 1);
      if (width(shown, narrow, true) <= avail) break;
    }
    // Keep the overflow menu in toolbar order.
    hidden.sort((a, b) => ITEMS.indexOf(a) - ITEMS.indexOf(b));
    return { labels: false, shown, hidden };
  });

  const tip = (it: Item) => {
    if (!it.cmd) return it.title ?? it.label;
    const c = commands[it.cmd];
    const keys = shortcutText(c.keys);
    return `${it.title ?? labelOf(c)}${keys ? ` (${keys})` : ''}`;
  };
  const on = (it: Item) => (it.cmd ? isEnabled(commands[it.cmd]) : it.kind === 'color' ? !!app.selection && !app.readonly : !app.maximizedId);
  const ALIGNS = [
    { a: 'left', icon: 'alignLeft', cmd: 'format.align.left' },
    { a: 'center', icon: 'alignCenter', cmd: 'format.align.center' },
    { a: 'right', icon: 'alignRight', cmd: 'format.align.right' },
  ] as const;
  const iconOf = (it: Item): IconName => (it.key === 'fill' && app.maximizedId ? 'restore' : it.icon);
  const labelFor = (it: Item) => (it.key === 'fill' && app.maximizedId ? 'Restore' : it.label);
  const isGroupStart = (list: Item[], i: number) => i > 0 && list[i].group !== list[i - 1].group;

  let colorOpen = $state(false);
  let zoomOpen = $state(false);
  let moreOpen = $state(false);
  let moreColors = $state(false);
  const pct = $derived(`${Math.round(app.zoom * 100)}%`);

  function closeAll() {
    colorOpen = zoomOpen = moreOpen = moreColors = false;
  }

  // Esc closes an open popover first (Stories: Esc closes menu → popover → selection → focus).
  $effect(() => {
    if (!(colorOpen || zoomOpen || moreOpen)) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || app.menu) return;
      e.stopPropagation();
      closeAll();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
</script>

{#snippet formatBody()}
  <div class="section">Text</div>
  <div class="aligns" role="group" aria-label="Text alignment">
    {#each ALIGNS as al (al.a)}
      <button class:on={app.currentAlign() === al.a} aria-pressed={app.currentAlign() === al.a} disabled={!app.canAlign()}
        title={`${labelOf(commands[al.cmd])} (${shortcutText(commands[al.cmd].keys)})`} aria-label={labelOf(commands[al.cmd])}
        onclick={() => run(al.cmd)}><Icon name={al.icon} /></button>
    {/each}
  </div>
  {#if !app.canAlign()}<p class="note">Alignment applies to text and date cells.</p>{/if}
  <div class="section">Color</div>
  <div class="colors">
    {#each STYLES as s (s.id)}
      <button class="swatch" style="background:{s.bg};color:{s.fg}" title={s.name} onclick={() => { app.applyStyle(s.id); closeAll(); }}>
        Aa<span>{s.id === 'none' ? 'No Fill' : s.name}</span>
      </button>
    {/each}
  </div>
{/snippet}

{#snippet tool(it: Item, labels: boolean, measuring = false)}
  {#if it.kind === 'zoom'}
    <div class="zoom" class:pop-wrap={!measuring}>
      <button class="tool small" onclick={() => run('view.zoomOut')} disabled={!isEnabled(commands['view.zoomOut'])}
        title={`Zoom Out (${shortcutText(commands['view.zoomOut'].keys)})`} aria-label="Zoom out"><Icon name="zoomOut" /></button>
      <button class="pct" onclick={() => { const o = !zoomOpen; closeAll(); zoomOpen = o; }} disabled={!!app.maximizedId}
        aria-haspopup="menu" aria-expanded={zoomOpen} title="Zoom">{pct}</button>
      <button class="tool small" onclick={() => run('view.zoomIn')} disabled={!isEnabled(commands['view.zoomIn'])}
        title={`Zoom In (${shortcutText(commands['view.zoomIn'].keys)})`} aria-label="Zoom in"><Icon name="zoomIn" /></button>
      {#if zoomOpen && !measuring}
        <div class="pop zooms anim-pop sheet-compact" role="menu" out:fadeOut>
          {#each ZOOM_STEPS as z (z)}
            <button role="menuitem" class:on={Math.abs(app.zoom - z) < 0.001} onclick={() => { app.setZoom(z); closeAll(); }}>{Math.round(z * 100)}%</button>
          {/each}
        </div>
      {/if}
    </div>
  {:else if it.kind === 'color'}
    <div class:pop-wrap={!measuring}>
      <button class="tool" disabled={!on(it)} aria-haspopup="true" aria-expanded={colorOpen}
        onclick={() => { const o = !colorOpen; closeAll(); colorOpen = o; }} title={tip(it)}>
        <Icon name="color" />{#if labels}<span class="lbl">{it.label}</span>{/if}
      </button>
      {#if colorOpen && !measuring}
        <div class="pop format anim-pop sheet-compact" role="dialog" aria-label="Cell format" out:fadeOut>
          {@render formatBody()}
        </div>
      {/if}
    </div>
  {:else}
    <button class="tool" class:active={it.key === 'inspector' && app.showInspector}
      aria-pressed={it.key === 'inspector' ? app.showInspector : undefined}
      onclick={() => it.cmd && run(it.cmd)} disabled={!on(it)} title={tip(it)}>
      <Icon name={iconOf(it)} />{#if labels}<span class="lbl">{labelFor(it)}</span>{/if}
    </button>
  {/if}
{/snippet}

<div class="toolbar" role="toolbar" aria-label="Toolbar" bind:clientWidth={avail}>
  {#if colorOpen || zoomOpen || moreOpen}
    <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
    <div class="backdrop" onclick={closeAll}></div>
  {/if}
  {#each layout.shown as it, i (it.key)}
    {#if it.pinned && layout.hidden.length}
      {#if i > 0}<span class="sep"></span>{/if}
      <div class="pop-wrap">
        <button class="tool" onclick={() => { const o = !moreOpen; closeAll(); moreOpen = o; }} aria-haspopup="menu" aria-expanded={moreOpen}
          title="More tools" aria-label="More tools"><Icon name="more" /></button>
        {#if moreOpen}
          <div class="pop more right anim-pop sheet-compact" role="menu" aria-label="More tools" out:fadeOut>
            {#each layout.hidden as h (h.key)}
              {#if h.kind === 'zoom'}
                <div class="zoomrow">
                  <button role="menuitem" onclick={() => run('view.zoomOut')} disabled={!isEnabled(commands['view.zoomOut'])}><Icon name="zoomOut" /></button>
                  <span>{pct}</span>
                  <button role="menuitem" onclick={() => run('view.zoomIn')} disabled={!isEnabled(commands['view.zoomIn'])}><Icon name="zoomIn" /></button>
                  <button role="menuitem" onclick={() => run('view.actualSize')} disabled={!isEnabled(commands['view.actualSize'])}>100%</button>
                </div>
              {:else if h.kind === 'color'}
                <button role="menuitem" disabled={!on(h)} onclick={() => (moreColors = !moreColors)}><Icon name="color" /> Format ▸</button>
                {#if moreColors}
                  <div class="inline">{@render formatBody()}</div>
                {/if}
              {:else}
                <button role="menuitem" disabled={!on(h)} onclick={() => { if (h.cmd) run(h.cmd); closeAll(); }}>
                  <Icon name={iconOf(h)} /> {labelFor(h)} <span class="keys">{h.cmd ? shortcutText(commands[h.cmd].keys) : ''}</span>
                </button>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
      <span class="sep"></span>
    {:else if isGroupStart(layout.shown, i)}<span class="sep"></span>{/if}
    {@render tool(it, layout.labels)}
  {/each}

  <!-- Invisible copy used only to measure each item's natural width. -->
  <div class="measure" aria-hidden="true" inert>
    {#each items as it (it.key)}
      <span bind:clientWidth={wide[it.key]}>{@render tool(it, true, true)}</span>
      <span bind:clientWidth={narrow[it.key]}>{@render tool(it, false, true)}</span>
    {/each}
  </div>
</div>

<style>
  .toolbar {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0;
    position: relative;
  }
  .measure {
    position: absolute;
    visibility: hidden;
    pointer-events: none;
    top: 0;
    left: 0;
    display: flex;
    white-space: nowrap;
  }
  .measure > span {
    display: inline-flex;
  }
  .sep {
    width: 1px;
    align-self: stretch;
    background: var(--line);
    margin: 6px 4px;
    flex-shrink: 0;
  }
  .tool {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    border: none;
    background: transparent;
    border-radius: var(--radius-7);
    padding: 3px 6px;
    min-width: var(--touch-target);
    min-height: var(--touch-target);
    color: var(--text);
    flex-shrink: 0;
  }
  .tool:hover:not(:disabled),
  .tool.active,
  .tool[aria-expanded='true'] {
    background: var(--accent-soft);
  }
  .tool.active {
    color: var(--accent);
  }
  .tool.small {
    min-width: var(--touch-target);
  }
  .lbl {
    font-size: 10px;
    color: var(--muted);
    white-space: nowrap;
  }
  .zoom {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }
  .pct {
    border: 1px solid var(--line);
    background: var(--panel);
    min-width: 58px;
    min-height: var(--control-h);
    font-variant-numeric: tabular-nums;
  }
  .pop-wrap {
    position: relative;
    flex-shrink: 0;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 1;
  }
  /* The toolbar sits at the right edge, so its popovers align to their trigger's right edge. */
  .pop {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 2;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius-12);
    box-shadow: var(--shadow-menu);
    padding: 8px;
  }
  .pop.right {
    left: auto;
    right: 0;
  }
  .colors {
    display: grid;
    grid-template-columns: repeat(3, 96px);
    gap: 6px;
  }
  .inline {
    padding: 4px 6px 6px;
  }
  .inline .colors {
    grid-template-columns: repeat(3, 1fr);
  }
  .section {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    padding: 2px 2px 6px;
  }
  .aligns {
    display: flex;
    gap: 4px;
    margin-bottom: 10px;
  }
  .aligns button {
    flex: 1;
    min-height: var(--control-h);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .aligns button.on {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent);
  }
  .note {
    margin: -4px 2px 10px;
    color: var(--muted);
    font-size: 12px;
  }
  .swatch {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-height: 52px;
    border: 1px solid var(--line);
    font-weight: 700;
  }
  .swatch span {
    font-size: 10px;
    font-weight: 500;
  }
  .zooms {
    display: flex;
    flex-direction: column;
    min-width: 96px;
    padding: 4px;
  }
  .zooms button,
  .more > button {
    display: flex;
    align-items: center;
    gap: 8px;
    border: none;
    background: none;
    min-height: var(--row-h);
    text-align: left;
    padding: 0 10px;
    width: 100%;
    font-variant-numeric: tabular-nums;
  }
  @media (pointer: coarse) {
    .zooms button,
    .more > button {
      min-height: var(--touch-target);
    }
  }
  .zooms button:hover,
  .zooms button:active,
  .more > button:hover:not(:disabled),
  .more > button:active:not(:disabled) {
    background: var(--accent);
    color: var(--on-accent);
  }
  .zooms button.on {
    font-weight: 700;
  }
  .more {
    width: var(--overflow-w);
    padding: 6px;
  }
  .keys {
    margin-left: auto;
    color: var(--muted);
    font-size: 12px;
  }
  .zoomrow {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
  }
  .zoomrow button {
    min-width: var(--touch-target);
    min-height: var(--touch-target);
  }
  .zoomrow span {
    min-width: 48px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
</style>
