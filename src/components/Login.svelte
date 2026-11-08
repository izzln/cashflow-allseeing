<script lang="ts">
  import { session } from '../lib/session.svelte';

  let { onsignedin, overlay = false }: { onsignedin: () => void; overlay?: boolean } = $props();
  let password = $state('');
  let error = $state('');
  let busy = $state(false);

  async function submit(e: Event) {
    e.preventDefault();
    busy = true;
    error = (await session.login(password)) ?? '';
    busy = false;
    if (!error) {
      password = '';
      onsignedin();
    }
  }
</script>

<div class="wrap" class:overlay>
  <form class="card" onsubmit={submit}>
    <h1>Cashflow</h1>
    {#if !session.configured}
      <p class="msg">
        No password is set yet. In the Cloudflare dashboard, open the <b>cashflow-allseeing</b> Worker →
        Settings → Variables and Secrets, add a <b>Secret</b> named <code>EDITOR_PASSWORD</code> (at least 8
        characters), deploy, then reload this page.
      </p>
    {:else}
      <p class="msg">{overlay ? 'Your session ended. Sign in to keep saving; your changes are kept.' : 'Sign in to open your files.'}</p>
      <!-- svelte-ignore a11y_autofocus -->
      <input type="password" bind:value={password} placeholder="Password" autocomplete="current-password" autofocus />
      {#if error}<p class="error">{error}</p>{/if}
      <button class="primary" disabled={busy || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
    {/if}
  </form>
</div>

<style>
  .wrap {
    height: 100%;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: calc(80px + env(safe-area-inset-top)) 16px 16px;
  }
  .overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-overlay);
    background: var(--scrim-strong);
  }
  .card {
    width: min(380px, 100%);
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius-12);
    padding: 22px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-shadow: var(--shadow-menu);
  }
  h1 {
    font-size: 20px;
    margin: 0;
  }
  .msg {
    margin: 0;
    color: var(--muted);
    line-height: 1.5;
  }
  input {
    border: 1px solid var(--line);
    border-radius: var(--radius-8);
    padding: 10px 12px;
    font-size: 16px;
  }
  .error {
    color: var(--neg);
    margin: 0;
  }
  .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
    min-height: 40px;
  }
  code {
    background: var(--head);
    padding: 1px 4px;
    border-radius: var(--radius-4);
  }
</style>
