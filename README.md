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
- Undo/redo, autosave in the browser, JSON backup/restore
- Works with mouse and keyboard (Mac) and touch (iPad)

**Next**
- Phase 2: ledger tables (date, amount, category, note), CSV/Excel import, row data sources with filters, formula rows
- Phase 3: backend, sync between devices, view-only share links, hosting
- Phase 4: Feishu and Huoban connectors with scheduled sync

## Development

```sh
npm install
npm run dev      # local dev server
npm test         # unit tests
npm run check    # type check
npm run build    # production build in dist/
```

Stack: Vite + TypeScript + Svelte 5. No UI or spreadsheet libraries.

## Data storage (phase 1)

Data lives in the browser's local storage on each device. It does not sync between devices yet.
Safari may clear site data for sites you haven't visited in 7 days unless the app is added to the
Home Screen, so use **Backup** regularly until phase 3 adds a server copy.
