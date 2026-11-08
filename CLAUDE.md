# CLAUDE.md

Cash-flow tracker/forecast web app: sheets of free-placed (grid-snapped) tables on a canvas, months as columns.
Single editor (the owner) on Mac + iPad; others will get view-only links (last phase).

## Names
A **Cashflow** is the special month-by-month table (`CashflowTable`, `kind: 'cashflow'`). A **Table** is rows with
typed columns (`DataTable`, `kind: 'table'`; its rows are `entries`). `Table` in code means either kind.
There are no saved files to stay compatible with yet, so formats can still change freely.

## Design system: Stories Web App
All UI rules, tokens, components, HIG deviations and known gaps come from the **Stories Web App** design system:
https://claude.ai/artifact/MP8LwEVe4W4Ffw9RFyb7ij (a private Design System artifact; read it with the Artifact tool,
`action: "read"` with `path`). Before UI work read `project/README.md`, `project/tokens.json` and the
`project/components/<Name>/README.md` of each component you touch. **Where this file or the code disagrees with it,
Stories Web App wins.** Don't copy its rules here; this file only adds what is specific to this app.

### App-specific UI (not in the design system)
- **Accent override (owner's decision):** the accent is green like Numbers — `--accent: #1b7a43`,
  `--accent-soft: rgba(27,122,67,.12)` (white on it 5.37:1; on its soft tint 4.55:1). Every other token is Stories'.
  Tokens live in `src/app.css`; components use `var(--…)`, never raw values.
- Commands are defined once in `src/lib/commands.ts`; the toolbar's overflow order is `OVERFLOW_ORDER` in
  `src/components/Toolbar.svelte`.
- Cashflow markers: ⇄ from a table (`#1d63c7`), ƒ formula (`#6941c6`), negative in a linked/formula cell (`#b8336a`),
  ✎ number typed over a linked row (`#b54708`), `#ERR` for a formula/source error (reason in tooltip and Inspector).
- **Touch selection (owner's decision, like Numbers; Stories' Input model says a tap also shows the EditMenu):**
  the first tap on a cell, row/column tab or table title only selects; a tap on the selection shows or hides the
  EditMenu; a double-tap edits. `app.menuClosedAt` lets the tap that closed the menu not reopen it.
- Cashflow grid: label column 200px, month columns 100px, two header rows (year, month; centred).
  Header-row text is always centred in both kinds of table (owner's decision), whatever the column type.
- Canvas: tables snap to a 20px grid; a 40px margin surrounds the zoomed canvas. Zoom 25–400 %
  (steps 25, 50, 75, 100, 125, 150, 200, 300, 400). Row/column tabs live on an unscaled overlay with a fixed
  thickness (rows 20px / 30px touch, columns 15px / 23px touch).
- Fill Window (one table fills the canvas, headers and first column pinned): Esc never leaves it; only Restore does.
  Each sheet remembers its filled table, per file across closing it (localStorage, like zoom and the active
  sheet). Fill / Restore zooms the card from its old rectangle (`app.fillFrom`, `zoomFrom` in `src/lib/motion.ts`). Columns are fitted to the width (`fitColumns` in `src/lib/grid.ts`):
  text, files and row labels wrap and give up width first; numbers, dates and checkboxes never wrap.
  Row/column tabs are pinned in a gutter left of and above the scrolling body (`TableTabs` with `pinned`): they
  follow its scroll, hide under the pinned headers, and drags only reorder (no drag-out), scrolling near an edge.
- Text alignment (Left / Center / Right) applies to text, date and row-label cells only, per cell
  (`aligns`, keyed like `styles`); ⌘{ ⌘| ⌘}, the Format popover, the Align submenu and the Inspector.
- Deletes are undoable and show a notice with Undo. Files (Home) and snapshots (File menu, which also shows Undo
  in place) are removed for good only when the notice expires or the page/file closes.
- Clipboard: copy writes TSV plus HTML whose cells carry `data-cf-s` / `data-cf-a` (tint, alignment), so a paste
  into this app restores them (`formatsFromHTML`; the Clipboard-API paste matches this window's last copy).
  Safari needs `beforecopy/beforecut/beforepaste` cancelled (App) to fire clipboard events for a grid
  selection; menu Copy runs `execCommand('copy')` first, then the async Clipboard API.
- Size class: `app.sizeClass` from the measured container width (`app.width`); CSS uses `max-width: 599px`.

## Commands
- `npm test` (vitest, tests/), `npm run check` (svelte-check + worker tsc), `npm run build`
- `npm run dev:server` — Worker + local D1 on :8787 (secrets in `.dev.vars`, gitignored); `npm run deploy`

## Layout
- `src/lib/months.ts` — 'YYYY-MM' month keys; visible window = current month → Dec next year
- `src/lib/evaluate.ts` — `Evaluator`: every computed cell (manual / table source / formula rows, net cash flow,
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
- `src/lib/files.ts` — files: `FileStore` interface (async; `RemoteFileStore` is the server version),
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
- The cell editor is one persistent `<input>` laid over the cell (the design system's focus/IME rules apply).
- Keep dependencies minimal; prefer small in-house code over UI/grid libraries.
