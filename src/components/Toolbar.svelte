<script lang="ts">
  import { app, ZOOM_STEPS } from '../lib/store.svelte';
  import { commands, isEnabled, labelOf, run, shortcutText } from '../lib/commands';
  import { STYLES } from '../lib/styles';
  import Icon, { type IconName } from './Icon.svelte';

  /** Toolbar buttons run commands; tooltips show the command and its shortcut. */
  const tip = (id: string, extra = '') => {
    const c = commands[id];
    const keys = shortcutText(c.keys);
    return `${labelOf(c)}${extra}${keys ? ` (${keys})` : ''}`;
  };
  const on = (id: string) => isEnabled(commands[id]);

  type Item = { id: string; icon: IconName; label: string };
  const INSERT: Item[] = [
    { id: 'insert.cashflow', icon: 'cashflow', label: 'Cashflow' },
    { id: 'insert.dataTable', icon: 'table', label: 'Table' },
  ];
  const LINES: Item[] = [
    { id: 'insert.rowAbove', icon: 'rowAbove', label: 'Row Above' },
    { id: 'insert.rowBelow', icon: 'rowBelow', label: 'Row Below' },
    { id: 'insert.colBefore', icon: 'colBefore', label: 'Col. Before' },
    { id: 'insert.colAfter', icon: 'colAfter', label: 'Col. After' },
    { id: 'table.deleteRows', icon: 'deleteRow', label: 'Delete Row' },
    { id: 'table.deleteColumns', icon: 'deleteCol', label: 'Delete Col.' },
  ];

  let colorOpen = $state(false);
  let zoomOpen = $state(false);
  const pct = $derived(`${Math.round(app.zoom * 100)}%`);
</script>

<div class="toolbar" role="toolbar" aria-label="Toolbar">
  {#if !app.readonly}
    <div class="group" role="group" aria-label="Insert">
      {#each INSERT as it (it.id)}
        <button class="tool" onclick={() => run(it.id)} disabled={!on(it.id)} title={tip(it.id, it.id === 'insert.cashflow' ? ': month-by-month cash flow' : ': rows with typed columns')}>
          <Icon name={it.icon} /><span class="lbl">{it.label}</span>
        </button>
      {/each}
    </div>
    <div class="group" role="group" aria-label="Rows and columns">
      {#each LINES as it (it.id)}
        <button class="tool" onclick={() => run(it.id)} disabled={!on(it.id)} title={tip(it.id)}>
          <Icon name={it.icon} /><span class="lbl">{it.label}</span>
        </button>
      {/each}
    </div>
    <div class="group pop-wrap" role="group" aria-label="Format">
      <button class="tool" disabled={!app.selection} aria-haspopup="true" aria-expanded={colorOpen}
        onclick={() => (colorOpen = !colorOpen)} title="Cell fill and text color">
        <Icon name="color" /><span class="lbl">Color</span>
      </button>
      {#if colorOpen}
        <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
        <div class="backdrop" onclick={() => (colorOpen = false)}></div>
        <div class="pop colors" role="dialog" aria-label="Cell colors">
          {#each STYLES as s (s.id)}
            <button class="swatch" style="background:{s.bg};color:{s.fg}" title={s.name}
              onclick={() => { app.applyStyle(s.id); colorOpen = false; }}>
              Aa<span>{s.id === 'none' ? 'No Fill' : s.name}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
  <div class="group" role="group" aria-label="View">
    <button class="tool" onclick={() => run('table.maximize')} disabled={!on('table.maximize')} title={tip('table.maximize')}>
      <Icon name={app.maximizedId ? 'restore' : 'fill'} /><span class="lbl">{app.maximizedId ? 'Restore' : 'Fill Window'}</span>
    </button>
    <div class="zoom pop-wrap">
      <button class="tool small" onclick={() => run('view.zoomOut')} disabled={!on('view.zoomOut')} title={tip('view.zoomOut')} aria-label="Zoom out"><Icon name="zoomOut" /></button>
      <button class="pct" onclick={() => (zoomOpen = !zoomOpen)} disabled={!!app.maximizedId} aria-haspopup="menu" aria-expanded={zoomOpen} title="Zoom">{pct}</button>
      <button class="tool small" onclick={() => run('view.zoomIn')} disabled={!on('view.zoomIn')} title={tip('view.zoomIn')} aria-label="Zoom in"><Icon name="zoomIn" /></button>
      {#if zoomOpen}
        <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
        <div class="backdrop" onclick={() => (zoomOpen = false)}></div>
        <div class="pop zooms" role="menu">
          {#each ZOOM_STEPS as z (z)}
            <button role="menuitem" class:on={Math.abs(app.zoom - z) < 0.001} onclick={() => { app.setZoom(z); zoomOpen = false; }}>{Math.round(z * 100)}%</button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
  <div class="group right">
    <button class="tool" onclick={() => run('view.inspector')} class:active={app.showInspector} aria-pressed={app.showInspector} title={tip('view.inspector')}>
      <Icon name="inspector" /><span class="lbl">Inspector</span>
    </button>
  </div>
</div>

<style>
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 6px;
    align-items: center;
    padding: 4px 10px;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
    flex-shrink: 0;
    position: relative;
    z-index: 2550;
  }
  .group {
    display: flex;
    gap: 2px;
    align-items: center;
    padding-right: 6px;
    margin-right: 2px;
    border-right: 1px solid var(--line);
  }
  .group.right {
    margin-left: auto;
    border-right: none;
    padding-right: 0;
  }
  .tool {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    border: none;
    background: transparent;
    border-radius: 7px;
    padding: 3px 6px;
    min-width: 44px;
    min-height: 44px;
    color: var(--text);
  }
  .tool:hover:not(:disabled),
  .tool.active {
    background: var(--accent-soft);
  }
  .tool.active {
    color: var(--accent);
  }
  .tool.small {
    min-width: 36px;
  }
  .lbl {
    font-size: 10px;
    color: var(--muted);
    white-space: nowrap;
  }
  /* Labels only when there is room, as macOS toolbars do. */
  @media (max-width: 1180px) {
    .lbl {
      display: none;
    }
  }
  .zoom {
    display: flex;
    align-items: center;
  }
  .pct {
    border: 1px solid var(--line);
    background: var(--panel);
    min-width: 58px;
    min-height: 30px;
    font-variant-numeric: tabular-nums;
  }
  .pop-wrap {
    position: relative;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 1;
  }
  .pop {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 2;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
    padding: 8px;
  }
  .colors {
    display: grid;
    grid-template-columns: repeat(3, 96px);
    gap: 6px;
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
  .zooms button {
    border: none;
    background: none;
    min-height: 32px;
    text-align: left;
    padding: 0 10px;
    font-variant-numeric: tabular-nums;
  }
  @media (pointer: coarse) {
    .zooms button {
      min-height: 44px;
    }
  }
  .zooms button:hover {
    background: var(--accent);
    color: #fff;
  }
  .zooms button.on {
    font-weight: 700;
  }
</style>
