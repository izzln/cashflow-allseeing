<script lang="ts">
  import FileMenu from './FileMenu.svelte';
  import Toolbar from './Toolbar.svelte';
</script>

<!-- One row: back to all files, the file (menu + save status), then the toolbar on the right. -->
<header class="topbar">
  <a class="back" href="#/" title="All files">‹ Files</a>
  <FileMenu />
  <Toolbar />
</header>

<style>
  .topbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 10px;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
    flex-shrink: 0;
    min-height: 52px;
    position: relative;
    z-index: 2600;
  }
  .back {
    color: var(--accent);
    text-decoration: none;
    white-space: nowrap;
    padding: 6px 6px;
    flex-shrink: 0;
  }
</style>
