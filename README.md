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

**Next**
- Phase 2: ledger tables (date, amount, category, note), CSV/Excel import, row data sources with
  filters, formula rows; per-file sync settings and the sync loop (see below)
- Phase 3: Cloudflare backend (Workers + D1), files synced between devices, login for editing;
  the `FileStore` interface in `src/lib/files.ts` gets a server-backed implementation
- Phase 4: Feishu and Huoban connectors with scheduled sync
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

## Sync design (phases 2–4)

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
