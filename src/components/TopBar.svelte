<script lang="ts">
  import FileMenu from './FileMenu.svelte';
  import SheetTabs from './SheetTabs.svelte';
</script>

<!-- First row: back to all files, the file (menu + status), then its sheets. -->
<header class="topbar">
  <a class="back" href="#/" title="All files">‹ Files</a>
  <FileMenu />
  <span class="sep"></span>
  <SheetTabs />
</header>

<style>
  .topbar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 12px;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
    flex-shrink: 0;
    min-height: 44px;
    position: relative;
    z-index: 2600;
  }
  .back {
    color: var(--accent);
    text-decoration: none;
    white-space: nowrap;
    padding: 6px 6px;
  }
  .sep {
    width: 1px;
    align-self: stretch;
    background: var(--line);
    margin: 4px 6px;
  }
</style>
