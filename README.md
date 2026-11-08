# Cashflow Allseeing

A browser-based cash-flow tracker and forecast for company operations, laid out like Apple Numbers:
sheets as tabs along the top, several tables per sheet placed on a canvas, months as columns.

## Status

Two kinds of table sit on each sheet's canvas:
- **Cashflow** — months as columns (current month → December next year). Rows are typed numbers,
  formulas, or numbers taken from a table. Footer rows: Net cash flow, Balance (carried forward from
  an opening balance, counting months that have scrolled out of view), plus custom formula rows.
- **Table** — rows with typed columns: Date, Number, Text, Checkbox, Files. Typed in, pasted, or
  imported from CSV / Excel (.xlsx; UTF-8 or GBK CSV; Chinese and English headers recognised).

**Taking numbers from a table**
- A cashflow row's first cell → *From table*: each month = the amount column's total for rows dated
  in that month, with filters (text is any of / contains, checkbox ticked / not) and sign flip. ⇄
- A single month cell → *From row* (follows the row), *Manual* (typed; ✎ when it overrides a linked
  row) or *Table total* (one column's total over all matching rows, any date; ⇄)
- Formulas: `[Row]`, `[Table].[Row]`, `[Net cash flow]`, `[Balance]`, `PREV([x], n)`, `SUM MIN MAX
  ABS ROUND IF`; Chinese full-width input works. Errors show as `#ERR` with the reason

**Interface (Apple HIG by default; deviations listed in CLAUDE.md)**
- Top row: ‹ Files · file name (menu: Rename, Download a Copy, Take Snapshot, snapshots, All Files) and
  save status · sheet tabs. Second row: icon toolbar — Cashflow, Table · rows and columns · Color
  (fill + text sets) · Fill Window, Zoom · Inspector
- Mouse: click selects; double-click edits a cell, renames a table (title) or a column (header);
  right-click menus on cells, titles and row/column tabs. Touch: tap selects and shows the edit menu
  (Cut, Copy, Paste, Delete…, ••• for more); tap again to edit; long-press for the full menu
- Row/column tabs on the selected table: select whole rows/columns (Shift extends; arrow keys move the
  selection a row/column at a time), drag to reorder, drop on the canvas for a new table (⌥ copies)
- Numbers shortcuts: ⌥↑/⌥↓ row above/below, ⌥←/⌥→ column before/after, ⌥⌘⌫ delete rows,
  ⌘> / ⌘< zoom, ⌘Z / ⇧⌘Z, ⌥⌘I inspector, ⇧⌘S download, ⇧⌘O all files
- Zoom 25 %–400 % (toolbar, ⌘> / ⌘<, pinch on trackpad or iPad). Row/column tabs stay full size
- Fill Window shows one table across the workspace with header rows and first column pinned

**Files, sync and server**
- Each file holds its sheets, tables and snapshots; any number of windows can edit the same file and
  edits merge. Snapshots: automatic at month-end, or taken by hand; open read-only beside the live file
- Cloudflare Worker + D1 (APAC): sign-in with one password, same files on every device, offline retry
- Files cells: attachments up to 25 MB each, stored in D1

**Next**
- Feishu and Huoban connectors, pulled into tables on the sync timer (default every 15 min)
- Comments on cells (corner triangle)
- View-only share links

## Sync design

- Sync settings live in the file: which source feeds which row, field mapping, filter, interval.
  Secrets (Feishu/Huoban app keys) never go in the file, so a downloaded file can't leak them; the
  file names a connection, and its keys stay on the server
- While a file is open it syncs on open and then every N minutes. Only one window per file runs the
  loop (Web Locks); its results are a normal edit, so other windows update the same way
- Live sources: in-app ledger tables (always current), Feishu and Huoban (through the Cloudflare
  Worker, phase 3–4). CSV/Excel is a manual re-import: a browser can't re-read a file on disk by itself

## Data storage without the server

When the app runs without the Worker, files live in the browser's local storage on each device.
Safari may clear site data for sites you haven't visited in 7 days unless the app is added to the
Home Screen, and browser storage is small (about 5 MB per site in Safari).
