<script lang="ts" module>
  /** Line icons on a 24×24 grid, drawn with the current text colour. */
  export const ICONS = {
    cashflow: 'M3.5 5.5h17v13h-17z M3.5 9.5h17 M7 16l3.5-3 2.5 2 4-4.5',
    table: 'M3.5 5.5h17v13h-17z M3.5 9.5h17 M3.5 14h17 M9.5 5.5v13 M15 5.5v13',
    rowAbove: 'M4.5 12.5h15v7h-15z M4.5 16h15 M12 3.5v6 M9 6.5h6',
    rowBelow: 'M4.5 4.5h15v7h-15z M4.5 8h15 M12 14.5v6 M9 17.5h6',
    colBefore: 'M12.5 4.5h7v15h-7z M16 4.5v15 M3.5 12h6 M6.5 9v6',
    colAfter: 'M4.5 4.5h7v15h-7z M8 4.5v15 M14.5 12h6 M17.5 9v6',
    deleteRow: 'M3.5 8.5h11v7h-11z M17 9.5l4 4 M21 9.5l-4 4',
    deleteCol: 'M8.5 3.5h7v11h-7z M10 17l4 4 M14 17l-4 4',
    color: 'M12 3.5c-3 4.2-5.5 7.2-5.5 10.2a5.5 5.5 0 0 0 11 0c0-3-2.5-6-5.5-10.2z',
    fill: 'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5',
    restore: 'M9 4v5H4 M15 4v5h5 M9 20v-5H4 M15 20v-5h5',
    zoomIn: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13z M15.5 15.5L20 20 M10.5 7.5v6 M7.5 10.5h6',
    zoomOut: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13z M15.5 15.5L20 20 M7.5 10.5h6',
    inspector: 'M3.5 5.5h17v13h-17z M14.5 5.5v13 M16.5 9h2 M16.5 12h2',
    chevron: 'M7 10l5 5 5-5',
    camera: 'M4 8.5h3l1.5-2h7l1.5 2h3v10H4z M12 10.5a3 3 0 1 0 0 6a3 3 0 1 0 0-6z',
    download: 'M12 4v11 M7.5 10.5L12 15l4.5-4.5 M5 19.5h14',
    pencil: 'M4.5 19.5l1-4 10-10 3 3-10 10z M13.5 7.5l3 3',
    folder: 'M3.5 6.5h6l2 2h9v10h-17z',
    plus: 'M12 5v14 M5 12h14',
  } as const;
  export type IconName = keyof typeof ICONS;
</script>

<script lang="ts">
  let { name, size = 20 }: { name: IconName; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d={ICONS[name]} />
</svg>
