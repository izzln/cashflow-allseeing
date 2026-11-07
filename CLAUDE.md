# CLAUDE.md

Cash-flow tracker/forecast web app. Numbers-like UI: top sheet tabs, free-placed (grid-snapped) tables,
months as columns. Single editor (the owner) on Mac + iPad; others will get view-only links (phase 3).

## Commands
- `npm test` (vitest, tests/), `npm run check` (svelte-check), `npm run build`

## Layout
- `src/lib/months.ts` — 'YYYY-MM' month keys; visible window = current month → Dec next year
- `src/lib/compute.ts` — net cash flow and running balance (counts hidden months from openingMonth)
- `src/lib/files.ts` — files: `FileStore` interface (async; phase 3 adds a Cloudflare version),
  `LocalFileStore` over localStorage, per-file `rev`, in-file snapshots (manual + month-end), export format
- `src/lib/merge.ts` — 3-way JSON merge (objects by key, id'd arrays by id); used for multi-window edits and undo
- `src/lib/model.ts` — Workbook/Sheet/Table/Row types, starter data, `normalizeWorkbook` for loading
- `src/lib/grid.ts` — table cell coordinates: r = body rows then footer rows; c = 0 label, 1.. months
- `src/lib/store.svelte.ts` — single app state (Svelte 5 runes): selection, editing, undo (snapshots), paste, persistence
- `src/components/` — App (hash routing `#/` list, `#/f/<id>` editor, `#/f/<id>/s/<sid>` read-only snapshot; keyboard + clipboard), Home (file list), SnapshotsMenu, SheetTabs, Toolbar, Canvas (cell editor), TableView, Inspector, StatusBar

## Conventions
- Every user-visible data change goes through `app.change(fn)` so it is undoable and saved.
- Saves pass the `rev` they started from; a mismatch means another window saved first → load, `merge3(base, mine, theirs)`, retry.
  Storage events from other windows are merged the same way. Undo = `merge3(after, before, current)`, so it reverts only this window's change.
- Month-end rule: before the first save of a new month (and on open), freeze the stored content as last month's snapshot.
- Read-only (snapshot) windows: `app.readonly`; `change()` and editing refuse to run.
- Selection and the open cell editor are remapped by row id when content is replaced.
- Outflows are negative numbers. Amounts are stored per month on the row; months outside the window are kept.
- The cell editor is one persistent `<input>` focused synchronously inside the input event
  (needed for the iPad keyboard to appear). Ignore Enter while an IME is composing.
- Keep dependencies minimal; prefer small in-house code over UI/grid libraries.
