<script lang="ts">
  import { app } from '../lib/store.svelte';
  import FileMenu from './FileMenu.svelte';
  import Toolbar from './Toolbar.svelte';
</script>

<!-- One row: back to all files, the file (menu + save status), then the toolbar on the right. -->
<header class="topbar">
  <!-- Compact width: ‹ only (Stories: Responsive layout). -->
  <a class="back" href="#/" title="All files" aria-label="All files">{app.sizeClass === 'compact' ? '‹' : '‹ Files'}</a>
  <FileMenu />
  <Toolbar />
</header>

<style>
  .topbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 10px;
    padding-left: max(10px, env(safe-area-inset-left));
    padding-right: max(10px, env(safe-area-inset-right));
    background: var(--panel);
    border-bottom: 1px solid var(--line);
    flex-shrink: 0;
    min-height: var(--topbar-h);
    position: relative;
    z-index: var(--z-topbar);
  }
  .back {
    color: var(--accent);
    text-decoration: none;
    white-space: nowrap;
    padding: 6px 6px;
    flex-shrink: 0;
    min-width: var(--touch-target);
    min-height: var(--touch-target);
    display: flex;
    align-items: center;
  }
</style>
