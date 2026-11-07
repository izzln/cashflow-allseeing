# Cashflow Allseeing

A browser-based cash-flow tracker and forecast for company operations, laid out like Apple Numbers:
sheets as tabs along the top, several tables per sheet placed on a canvas, months as columns.

## Status

**Phase 1 — editor core (done)**
- Sheets as top tabs (add, rename by clicking the active tab, reorder, delete)
- Multiple tables per sheet, dragged by the title bar and snapped to a 20 px grid
- Two header rows (year, month). The window runs from the current month to December of next year;
  past months drop off the view, but their data is kept and still counts toward the balance
- Footer rows: **Net cash flow** (sum of all rows) and **Balance** (opening balance + cash flow carried forward)
- Outflows are negative numbers
- Multi-cell selection (drag, Shift, ⌘/Ctrl) with Sum / Average / Count at bottom right
- Cell color presets
- Copy/paste with Excel and Numbers (tab-separated text; pasting past the last row adds rows)
- Undo/redo and autosave
- Works with mouse and keyboard (Mac) and touch (iPad)

**Files**
- The app opens on a file list: create, open, rename, duplicate, download, import, delete
- A file holds everything for one piece of work: sheets, tables, snapshots (and, from phase 2,
  its data-source and sync settings)
- Each window shows one file in its address (`#/f/<id>`), so windows can hold different files —
  or the **same file side by side**: every window can edit, and edits appear in the others within
  a moment. Edits to different cells merge; if two windows change the same cell at once, the
  later save wins. Undo in a window reverses only that window's own changes
- **Snapshots** are frozen copies kept inside the file:
  - taken automatically at each month-end (the content as it stood when the month ended)
  - taken manually any time (Snapshots → Take snapshot now)
  - opened read-only in their own window (`#/f/<id>/s/<snapshotId>`), showing the months as they
    were at the time, so you can compare them with the live file; "Save as new file" makes an
    editable copy
- **Download** saves the whole file, snapshots included (`<name> YYYY-MM-DD.json`).
  **Import file** always creates a new file and never overwrites one

**Phase 2 — ledgers, imports, sources, formulas (done)**
- **Ledger tables** (+ Ledger): a list of dated amounts with Date, Amount, Category, Note. Type
  dates in any common form (2026-11-07, 2026/11/7, 2026年11月7日, 11/7). Paste a block onto the
  Total row to append entries
- **Import CSV / Excel** into a ledger: `.csv` (UTF-8 or GBK), `.tsv`, `.xlsx`. Columns are guessed
  from Chinese or English headers (交易日期, 金额, 借方/贷方, 收入/支出, 类别, 摘要…); separate money-in
  and money-out columns are supported; preview before importing; replace or append. The mapping
  is saved in the ledger, so re-importing a new export is one step. Old `.xls` and `.numbers`
  files need saving as `.xlsx` or `.csv` first
- **Rows from a ledger** ("From ledger" in the panel): each month shows the sum of the ledger's
  entries in that month, filtered by categories and/or note text, optionally sign-flipped. Typing
  in a cell overrides that month (orange corner); clearing it goes back to the ledger
- **Formula rows** count toward net cash flow, e.g. `[Sales] * -6%`.
  **Footer formula rows** sit below Balance and don't count, e.g. `[Balance] / ABS([Payroll])`.
  References: `[Row]`, `[Table].[Row]` (any sheet), `[Net cash flow]` / `[Balance]` (footers only;
  also 净现金流 / 余额). Functions: `SUM MIN MAX ABS ROUND IF PREV` (`PREV([Sales], 2)` = two months
  back, for payment lags). Chinese full-width input (【】（）×－％) works. Errors show as `#ERR`
  with the reason in the panel; circular references are caught
- **Sync setting** per file (default every 15 minutes). One window per file runs the timer. It has
  nothing to pull until the Feishu/Huoban connectors exist (phase 4)

**Next**
- Phase 3: Cloudflare backend (Workers + D1), files synced between devices, login for editing;
  the `FileStore` interface in `src/lib/files.ts` gets a server-backed implementation
- Phase 4: Feishu and Huoban connectors, pulled into ledgers on the sync timer
- Last: view-only share links

## Development

```sh
npm install
npm run dev      # local dev server
npm test         # unit tests
npm run check    # type check
npm run build    # production build in dist/
```

Stack: Vite + TypeScript + Svelte 5. No UI or spreadsheet libraries.

## Sync design

- Sync settings live in the file: which source feeds which row, field mapping, filter, interval.
  Secrets (Feishu/Huoban app keys) never go in the file, so a downloaded file can't leak them; the
  file names a connection, and its keys stay on the server
- While a file is open it syncs on open and then every N minutes. Only one window per file runs the
  loop (Web Locks); its results are a normal edit, so other windows update the same way
- Live sources: in-app ledger tables (always current), Feishu and Huoban (through the Cloudflare
  Worker, phase 3–4). CSV/Excel is a manual re-import: a browser can't re-read a file on disk by itself

## Data storage (until phase 3)

Files live in the browser's local storage on each device and do not sync between devices yet.
Safari may clear site data for sites you haven't visited in 7 days unless the app is added to the
Home Screen, so download your files regularly until phase 3 adds a server copy. Browser storage is
small (about 5 MB per site in Safari), and each snapshot is a full copy, so this is a stopgap.
