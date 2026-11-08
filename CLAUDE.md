# CLAUDE.md

Cash-flow tracker/forecast web app. Numbers-like UI: top sheet tabs, free-placed (grid-snapped) tables,
months as columns. Single editor (the owner) on Mac + iPad; others will get view-only links (last phase).

## Names
A **Cashflow** is the special month-by-month table (`CashflowTable`, `kind: 'cashflow'`). A **Table** is rows with
typed columns (`DataTable`, `kind: 'table'`; its rows are `entries`). `Table` in code means either kind.
There are no saved files to stay compatible with yet, so formats can still change freely.

## UI rules (apply to every change)
- Apple's Human Interface Guidelines (macOS and iPadOS) are the default:
  https://developer.apple.com/design/human-interface-guidelines. Deviate only where our design is better for
  this app, and record the deviation below.
- Every command must work with mouse + keyboard, with the keyboard alone, and with touch alone
  (no hover-only controls, no right-click or modifier keys required, touch targets ≥ 44 pt).
- Pointer vs touch behaves like Numbers: a click on a table or cell only selects it; a tap selects it and
  shows the edit menu (Cut, Copy, Paste, Delete…). Right-click (or long-press) opens the context menu.
  Tapping elsewhere dismisses the edit menu and the tap still goes through.
- Use Numbers' keyboard shortcuts where Numbers has one (⌥↑/⌥↓ insert row above/below, ⌥←/⌥→ insert column
  before/after, …), and show shortcuts in menus. All commands live in `src/lib/commands.ts`.
- Edit in place (double-click / tap again) rather than in modal prompts.
- Layout: one top row — ‹ Files, file name (File menu) + save status, then the toolbar on the right;
  sheet tabs on the row below.
- Toolbar: icons grouped by purpose; related settings (cell fill + text colour) are one control that opens
  a popover. As the window narrows: labels go first, then items move into a » overflow menu in
  `OVERFLOW_ORDER` (least used first); the Inspector button always stays.

### Deliberate deviations from HIG
- No in-page menu bar: a web page can't use the real macOS / iPadOS menu bar, and a fake one duplicates
  the toolbar. File commands live in a menu on the file name (like a document title menu); everything
  else is in the toolbar, context menus and the edit menu.
- No Undo/Redo or Copy/Paste toolbar buttons: they are on the keyboard (⌘Z, ⇧⌘Z, ⌘C, ⌘V) and in the
  context/edit menus, so touch-only use still has them.
- Esc never leaves the filled (maximized) table view; only its Restore button does.
- Corner triangles in cells are reserved for comments (planned). Data links use the ⇄ symbol.

## Commands
- `npm test` (vitest, tests/), `npm run check` (svelte-check + worker tsc), `npm run build`
- `npm run dev:server` — Worker + local D1 on :8787 (secrets in `.dev.vars`, gitignored); `npm run deploy`

## Layout
- `src/lib/months.ts` — 'YYYY-MM' month keys; visible window = current month → Dec next year
- `src/lib/evaluate.ts` — `Evaluator`: every computed cell (manual / ledger source / formula rows, net cash flow,
  balance carried from openingMonth incl. hidden months, footer formulas); memoized, cycle-safe, errors as `{err}`
- `src/lib/formula.ts` — formula tokenizer/parser/evaluator (`[Row]`, `[Table].[Row]`, PREV, SUM…; full-width input)
- `src/lib/dates.ts`, `src/lib/import/` — date parsing, CSV (GBK fallback), minimal .xlsx reader, column mapping
- `src/lib/columns.ts` — table column types (date/number/text/checkbox/files): parse, display, convert, filters
- `src/lib/commands.ts` — every command (id, label, shortcut, enabled, run) + context / edit menu layouts
- `src/lib/attachments.ts` — attachment bytes: server (`/api/files/:id/attachments`, D1 chunks) or IndexedDB
- `src/lib/sync.ts` — `SyncLoop`: per-file timer, one window via Web Locks
- `src/lib/remote.ts` — `RemoteFileStore` (fetch `/api`, BroadcastChannel + 15 s polling for `watch`);
  `src/lib/session.svelte.ts` picks local vs remote at startup (`/api/session`), sign-in, local→server upload
- `worker/` — Cloudflare Worker: `/api` routes (files, snapshots, month-end, login), `auth.ts` (signed cookie);
  schema in `migrations/`. The Worker never parses workbook JSON (free-plan CPU limit); it stores it as text.
  It also serves the built app, embedded by `scripts/embed-assets.mjs` into `worker/static.generated.ts`
  (generated, gitignored) with a strict CSP. Deploy: `npm run deploy` (needs CLOUDFLARE_API_TOKEN)
- `src/lib/files.ts` — files: `FileStore` interface (async; phase 3 adds a Cloudflare version),
  `LocalFileStore` over localStorage, per-file `rev`, in-file snapshots (manual + month-end), export format
- `src/lib/merge.ts` — 3-way JSON merge (objects by key, id'd arrays by id); used for multi-window edits and undo
- `src/lib/model.ts` — Workbook/Sheet/Table types: `Table = CashflowTable | DataTable` (by `kind`); data tables have
  typed `columns` and `entries[].cells`; `RowSource` (monthly sums) / `CellSource` (one column total) with `filters`
  and the source table's `tableId`; `normalizeWorkbook` validates loaded JSON
- `src/lib/grid.ts` — `GridModel` per table kind (rows/cols/value/raw/editable/set); selection, editing, paste,
  copy, styles and undo work through it. Cash: r = body rows, 2 fixed footers, custom footers; c = 0 label, 1.. months.
  Data table: r = entries, then Total; c = the table's columns
- `src/lib/store.svelte.ts` — single app state (Svelte 5 runes): selection, editing, undo (snapshots), paste, persistence
- `src/components/` — App (hash routing `#/` list, `#/f/<id>` editor, `#/f/<id>/s/<sid>` read-only snapshot; keyboard + clipboard),
  Home (file list), TopBar (back, FileMenu, Toolbar with measured overflow), SheetTabs row, Icon, MenuList / PopupMenus (context + touch
  edit menu), Canvas (zoom: scaled content + unscaled overlay holding TableTabs; cell editor; filled view), TableFrame
  (title, drag, pointer/touch selection) with CashflowGrid / TableGrid, Inspector + SourcePicker, ImportDialog,
  FilesPopover, StatusBar

## Conventions
- Every user-visible data change goes through `app.change(fn)` so it is undoable and saved; `save()` bumps
  `app.version`, which rebuilds `app.ev` (the Evaluator). Don't read computed values from anywhere else.
- All storage goes through `fileStore` (switchable: `LocalFileStore` or `RemoteFileStore`); change notices via `fileStore.watch`.
- Saves pass the `rev` they started from; a mismatch means another window saved first → load, `merge3(base, mine, theirs)`, retry.
  Storage events from other windows are merged the same way. Undo = `merge3(after, before, current)`, so it reverts only this window's change.
- Month-end rule: before the first save of a new month (and on open), freeze the stored content as last month's snapshot.
- Read-only (snapshot) windows: `app.readonly`; `change()` and editing refuse to run.
- Selection and the open cell editor are remapped by row id when content is replaced.
- Zoom (`app.zoom`, 0.25–4): table positions and the cell editor are in unzoomed canvas pixels; convert pointer
  deltas and drop points with `/ app.zoom`. Row/column tabs are measured in screen pixels on the overlay.
- Outflows are negative numbers. Amounts are stored per month on the row; months outside the window are kept.
  On a source row, `values` are manual overrides. Formula rows count toward net cash flow; footer formulas don't.
- The cell editor is one persistent `<input>` focused synchronously inside the input event
  (needed for the iPad keyboard to appear). Ignore Enter while an IME is composing.
- Keep dependencies minimal; prefer small in-house code over UI/grid libraries.
