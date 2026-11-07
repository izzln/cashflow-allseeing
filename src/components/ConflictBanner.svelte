<script lang="ts">
  import { app } from '../lib/store.svelte';

  function keepMine() {
    if (confirm("Overwrite the other window's changes with this window's version?")) {
      app.resolveConflict('mine');
    }
  }
</script>

{#if app.saveState === 'conflict'}
  <div class="banner" role="alert">
    <span>This file was changed in another window. Edits here are not being saved.</span>
    <button onclick={() => app.resolveConflict('theirs')}>Load the other version</button>
    <button class="danger" onclick={keepMine}>Keep this version</button>
  </div>
{/if}

<style>
  .banner {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    padding: 8px 12px;
    background: #fff4e5;
    border-bottom: 1px solid #f3c98b;
    color: #7a4a00;
  }
</style>
