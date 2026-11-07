# CLAUDE.md

Cash-flow tracker/forecast web app. Numbers-like UI: top sheet tabs, free-placed (grid-snapped) tables,
months as columns. Single editor (the owner) on Mac + iPad; others will get view-only links (phase 3).

## Commands
- `npm test` (vitest, tests/), `npm run check` (svelte-check), `npm run build`

## Layout
- `src/lib/months.ts` — 'YYYY-MM' month keys; visible window = current month → Dec next year
- `src/lib/compute.ts` — net cash flow and running balance (counts hidden months from openingMonth)
- `src/lib/files.ts` — files: `FileStore` interface (async; phase 3 adds a Cloudflare version),
  `LocalFileStore` over localStorage with per-file `rev` for conflict checks, snapshot format
- `src/lib/model.ts` — Workbook/Sheet/Table/Row types, starter data, `normalizeWorkbook` for loading
- `src/lib/grid.ts` — table cell coordinates: r = body rows then footer rows; c = 0 label, 1.. months
- `src/lib/store.svelte.ts` — single app state (Svelte 5 runes): selection, editing, undo (snapshots), paste, persistence
- `src/components/` — App (hash routing `#/` list, `#/f/<id>` editor; keyboard + clipboard), Home (file list), ConflictBanner, SheetTabs, Toolbar, Canvas (cell editor), TableView, Inspector, StatusBar

## Conventions
- Every user-visible data change goes through `app.change(fn)` so it is undoable and saved.
- Saves pass the `rev` they started from; a mismatch means another window saved first → conflict, never a silent overwrite.
- Outflows are negative numbers. Amounts are stored per month on the row; months outside the window are kept.
- The cell editor is one persistent `<input>` focused synchronously inside the input event
  (needed for the iPad keyboard to appear). Ignore Enter while an IME is composing.
- Keep dependencies minimal; prefer small in-house code over UI/grid libraries.
