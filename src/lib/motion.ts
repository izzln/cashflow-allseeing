/**
 * Motion helpers (Stories Web App: States → Motion). Entrances are CSS animations (app.css);
 * dismissals fade out over --motion-fast with Svelte `out:` transitions. A dismissing element
 * takes no pointer events, so a click during the fade acts on what is underneath at once.
 */

/** Exit easing, cubic-bezier(0.4, 0, 1, 1), close enough as an ease-in. */
const easeIn = (t: number) => t * t * t;

export function reducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** `out:fadeOut` — menus, popovers, the edit menu, the status bubble and dialogs. */
export function fadeOut(_node: Element) {
  return { duration: 100, easing: easeIn, css: (t: number) => `opacity:${t};pointer-events:none` };
}

/**
 * Fill Window / Restore: zoom an element from a previous screen rectangle to where it is now
 * (--motion-panel). `scale` is the zoom of the element's own coordinate space.
 * Reduce Motion: a crossfade instead.
 */
export function zoomFrom(el: HTMLElement, from: DOMRect, scale = 1): Animation | null {
  const to = el.getBoundingClientRect();
  if (!to.width || !to.height) return null;
  const opts: KeyframeAnimationOptions = { duration: 250, easing: 'cubic-bezier(0.2, 0, 0, 1)' };
  if (reducedMotion()) return el.animate([{ opacity: 0 }, { opacity: 1 }], opts);
  const dx = (from.left - to.left) / scale;
  const dy = (from.top - to.top) / scale;
  const sx = from.width / to.width;
  const sy = from.height / to.height;
  return el.animate(
    [
      { transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
      { transformOrigin: '0 0', transform: 'none' },
    ],
    opts,
  );
}
