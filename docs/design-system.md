# Cashflow Allseeing — Design System v0.1

*Status: draft, 2026-11-08. Describes the app as built; values are taken from the code, not aspirations.
Rules come from `CLAUDE.md`; where this file and `CLAUDE.md` disagree, `CLAUDE.md` wins until this file is
updated. The last section lists what is missing.*

**Where things live**

| What | Source |
|---|---|
| Colour, type and surface tokens | `src/app.css` (`:root`) |
| Cell colour presets | `src/lib/styles.ts` |
| Grid sizes, zoom steps | `src/lib/store.svelte.ts`, `src/lib/model.ts`, `src/lib/grid.ts` |
| Commands, shortcuts, menu layouts | `src/lib/commands.ts` |
| Icons | `src/components/Icon.svelte` |
| Everything else | component `<style>` blocks in `src/components/` |

---

## 1. Principles

1. **Apple HIG is the default** (macOS and iPadOS). We deviate only where our design is better for this app,
   and every deviation is written down (§10).
2. **Three ways in, same result.** Every command works with mouse + keyboard, keyboard alone, and touch alone.
   No hover-only controls; nothing requires right-click or a modifier key.
3. **Behave like Numbers.** Selection, editing, shortcuts and table handling follow Numbers unless there is a
   reason not to.
4. **Edit in place.** Double-click (or tap again) to edit text where it is shown, not in a dialog.
5. **The canvas is the document.** Chrome stays thin: one top row, one sheet row, an optional inspector.

## 2. Input model

| | Pointer (mouse / trackpad) | Touch (iPad) |
|---|---|---|
| Select cell / table | Click | Tap |
| After selecting | — | Edit menu appears above the selection |
| Edit a cell | Double-click, Enter, or start typing | Tap the selected cell again |
| Extend selection | Drag, Shift+click, Shift+arrows | Drag starting on a selected cell |
| Add a range | ⌘+click | — |
| Context menu | Right-click | Long-press (550 ms), or ••• in the edit menu |
| Rename table / column | Double-click title / header | Edit menu → Rename, or the Inspector |
| Zoom | Pinch (trackpad), ⌘> / ⌘<, toolbar | Pinch, toolbar |
| Dismiss a menu | Click outside, Esc | Tap elsewhere (the tap still goes through) |

Touch timings: long-press **550 ms**; taps within **400 ms** of a context menu opening are ignored (the
browser's follow-up "ghost" click); a drag starts after **5 px** (tabs) or **4 px** (table title).

## 3. Layout

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ ‹ Files   File name ▾  Saved                 [toolbar … »]       [Inspector]  │  top row, 52 px
├───────────────────────────────────────────────────────────────────────────────┤
│ [Sheet 1 ‹ › ×] [Sheet 2] [+ Sheet]                                          │  sheet tabs
├──────────────────────────────────────────────────────────┬────────────────────┤
│  canvas (dotted, 20 px grid; scrolls; zoom 25–400 %)     │ Inspector  290 px  │
│    ┌ Title ─────────────── Cashflow ⤢ ┐                  │ (toggle)           │
│    │ grid …                           │                  │                    │
└──────────────────────────────────────────────────────────┴────────────────────┘
                                                     status bubble, bottom right
```

- **Top row:** back link, file name (opens the File menu) and save status, then the toolbar, right-aligned.
- **Toolbar overflow:** labels are dropped first; then tools move into **»** in `OVERFLOW_ORDER` (least used
  first). The Inspector button never moves.
- **Canvas:** tables are positioned freely and snap to a **20 px** grid. A **40 px** margin surrounds the
  zoomed canvas so row/column tabs always have room.
- **Fill Window:** one table fills the canvas area. Header rows and the first column stay pinned; the zoom
  controls are disabled.
- **File list (`#/`):** a centred column, max **920 px** wide.

## 4. Tokens

### 4.1 Colour — core (`src/app.css`)

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--bg` | `#f5f6f8` | Canvas and page background | — |
| `--panel` | `#ffffff` | Bars, tables, popovers, inspector | — |
| `--line` | `#d9dde3` | Cell borders, dividers, input borders | 1.36 : 1 on panel |
| `--line-strong` | `#b8bfc8` | Rule above footer rows, checkbox outline | — |
| `--text` | `#1f2328` | Body text | 15.8 : 1 on panel |
| `--muted` | `#6a737d` | Secondary text, labels, column headers | 4.82 : 1 on panel, **4.29 : 1 on `--head`** |
| `--accent` | `#2f6fde` | Links, selection outline, primary buttons, active states | 4.72 : 1 (both ways with white) |
| `--accent-soft` | `rgba(47,111,222,.12)` | Selected cells, pressed toolbar items, focus halo | — |
| `--neg` | `#c4322b` | Negative numbers, errors, destructive actions | 5.47 : 1 on panel |
| `--head` | `#f0f2f5` | Header rows, chips | — |
| `--foot` | `#f7f8fa` | Footer (total) rows | — |
| `--head-col` | `#f6f7f9` | Header column (first column) | — |

### 4.2 Colour — semantic values still hard-coded in components

These work today but aren't tokens yet (see Gaps).

| Meaning | Value | Where | Contrast on white |
|---|---|---|---|
| From a table (⇄ rows, linked cells) | `#1d63c7` | CashflowGrid | 5.74 : 1 |
| Formula (ƒ rows, footer formulas) | `#6941c6` | CashflowGrid | 6.62 : 1 |
| Negative in a linked or formula cell | `#b8336a` | CashflowGrid | 5.65 : 1 |
| Typed over a linked row (✎) | `#b54708` | CashflowGrid | 5.43 : 1 |
| Snapshot / read-only badge | `#7a4a00` on `#fff4e5` | FileMenu | 6.88 : 1 |
| Info banner (upload) | `#eef4ff` bg, `#c9dafc` border | Home | — |
| Touch edit menu | white on `#2b2b2d` | PopupMenus | 14.1 : 1 |
| Modal scrim | `rgba(15,23,42,.35–.40)` | ImportDialog, Login | — |
| Canvas dots | `#d4d8de` on `--bg` | Canvas | 1.32 : 1 (decorative) |

### 4.3 Cell colour presets (`src/lib/styles.ts`)

One control sets fill and text colour together.

| Preset | Fill | Text | Contrast |
|---|---|---|---|
| Default | `#ffffff` | `#1f2328` | 15.8 |
| Gray | `#eef0f3` | `#343a40` | 10.1 |
| Red | `#fdecec` | `#b42318` | 5.76 |
| Orange | `#fff1e0` | `#b54708` | 4.89 |
| Yellow | `#fef7d1` | `#7a5600` | 6.15 |
| Green | `#e7f6ec` | `#18794e` | 4.84 |
| Blue | `#e8f1fd` | `#175cd3` | 5.25 |
| Purple | `#f1ecfd` | `#6941c6` | 5.72 |
| Dark | `#1f2937` | `#ffffff` | 14.7 |

All pass WCAG AA for normal text (≥ 4.5 : 1). In a styled cell, negative numbers use the preset's text
colour, not `--neg`.

### 4.4 Typography

- **Font stack:** `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB',
  'Microsoft YaHei', sans-serif`. This gives SF on Apple devices and PingFang for Chinese.
- **Base size:** 13 px, matching the macOS body size.
- **Numbers:** `font-variant-numeric: tabular-nums` in grids, totals and zoom percentages.

| Size | Role |
|---|---|
| 22 px | File list title |
| 20 px | Sign-in title |
| 17 px | Dialog title |
| 16 px | Password field (stops iOS zooming into the field) |
| 15 px | File names in the file list |
| 13 px | Body, grid cells, menus |
| 12 px | Secondary text, hints, shortcut hints, file meta, inspector section headings (uppercase, +0.04em) |
| 11 px | Formula code, small badges, cell markers |
| 10 px | Toolbar labels, tab letters/numbers (shrinks with zoom; hidden below 9 px) |

Weights in use: 400 body, 500 labels, 600 titles/headers/totals, 700 Balance row and swatches.

### 4.5 Sizes and spacing

| Item | Value |
|---|---|
| Canvas grid snap | 20 px (`GRID`) |
| Grid row height | 28 px (`ROW_H`) |
| Table title bar | 32 px (`TITLE_H`) |
| Cashflow label column | 200 px (`LABEL_W`) |
| Cashflow month column | 100 px (`COL_W`) |
| Data table columns | date 112 · number 120 · text 160 (Note 240) · checkbox 90 · files 190 |
| Cell padding | 0 × 8 px |
| Minimum touch target | 44 px (toolbar items, edit menu, menu rows on touch, File menu rows on touch) |
| Row tab thickness | 20 px (pointer) / 30 px (touch), fixed at every zoom |
| Column tab thickness | 15 px (pointer) / 23 px (touch) |
| Toolbar group divider | 1 px + 8 px margin |
| Inspector width | 290 px |
| Popover widths | File menu 340 · files 340 · overflow 260 · import dialog 760 max |

There is no spacing scale yet. Gaps of 2, 4, 6, 8, 10, 12, 14 and 16 px all occur.

### 4.6 Shape and elevation

- **Radius:** 4 px (tabs, chips, small inputs) · 6 px (buttons, inputs) · 7–8 px (toolbar items, tables) ·
  10 px (menus, banners, status) · 12 px (popovers, dialogs, cards).
- **Shadows:**

  | Level | Shadow | Used for |
  |---|---|---|
  | 1 | `0 1px 3px /.06` | Tables |
  | 2 | `0 2px 8px /.15` | Cell editor |
  | 3 | `0 4px 16px /.12` | Status bubble |
  | 4 | `0 10px 30px /.18` | Menus and popovers |
  | 5 | `0 20px 50px /.25` | Dialogs |

  The touch edit menu uses `0 6px 20px /.25`. A focused table gets a 2 px `--accent-soft` halo plus an
  accent border.
- **Materials:** menus are 98 % white with a 20 px backdrop blur (the closest web equivalent of HIG menu
  material).

### 4.7 Layers (z-index)

| z | Layer |
|---|---|
| 1–4 | Within a table: pinned headers in Fill Window, row/column tabs, drag markers |
| 1000 | Cell editor |
| 2000 | Status bubble |
| 2500–2600 | Top row, File menu, toolbar popovers |
| 2700–2800 | Files popover |
| 2900–2950 | Context menu, touch edit menu |
| 3000 | Import dialog, drag ghost |
| 4000 | Sign-in overlay |

### 4.8 Zoom

Range 25–400 %. Steps: 25, 50, 75, 100, 125, 150, 200, 300, 400 %. Pinch zooms continuously. Zoom is
remembered per file on each device.

## 5. Iconography

- **Custom line icons** (`Icon.svelte`): 24 × 24 grid, 1.6 px stroke, round caps and joins, drawn in
  `currentColor`. Set: `cashflow`, `table`, `rowAbove`, `rowBelow`, `colBefore`, `colAfter`, `deleteRow`,
  `deleteCol`, `color`, `fill`, `restore`, `zoomIn`, `zoomOut`, `inspector`, `chevron`, `camera`, `download`,
  `pencil`, `folder`, `plus`, `more`.
- **Not SF Symbols:** their licence covers apps on Apple platforms, not websites.
- **Text glyphs used as symbols:**

  | Glyph | Meaning |
  |---|---|
  | ⇄ | Data comes from a table |
  | ƒ | Formula |
  | ✎ | Number typed over a linked row |
  | ✓ | Checkbox count |
  | 📎 | Attachment |
  | ‹ › | Back, move sheet |
  | × | Remove / delete |
  | ⤢ ⤡ | Fill window / restore |
  | ⠿ | Drag handle |

## 6. Components

| Component | Notes |
|---|---|
| **Top bar** | Back link, File menu trigger (name ▾ + save status: Saved / Saving… / Offline · will retry / Sign in to save / Not saved), toolbar. Snapshot windows show a "Snapshot: … · read-only" badge instead of the status. |
| **File menu** | Popover from the file name. Rename (inline field), Download a Copy, Snapshots section (Take Snapshot with an inline field, then the list: open beside the live file, delete), All Files. |
| **Toolbar** | Grouped as Insert · Rows & columns · Color · View (Fill Window, Zoom − % +) · Inspector. Each item is a command; the tooltip shows the command and its shortcut. Measured overflow into ». |
| **Sheet tabs** | Selected tab gets the accent tint. Click the active tab to rename it in place. The active tab shows ‹ › × buttons. |
| **Table frame** | Title bar (drag handle, name, "Cashflow" badge for cashflows, ⤢). Double-click the title to rename. Focus = accent border + halo. |
| **Cashflow grid** | Two header rows (year, centred month). First column is the header column. Footers: Net cash flow, Balance (bold), then custom formula rows (italic, ƒ). |
| **Data table grid** | One header row (double-click to rename). Typed cells: checkbox box (18 px, accent when ticked), file chips. Total row: number sums, "n ✓" counts, "Total · n" label. |
| **Row/column tabs** | Shown on the focused table, on an unscaled overlay. Numbers 1…n, letters A…. Selected = accent fill. Drag shows a 3 px accent insertion line or a dashed "New table" ghost. |
| **Cell editor** | One input laid over the cell: 2 px accent border, level-2 shadow; right-aligned for numbers. |
| **Context menu** | Vertical menu: title-case labels, ✓ for checked items, shortcut on the right, ▸ for submenus, separators. Rows are 28 px (44 px on touch). |
| **Edit menu (touch)** | Dark pill (`#2b2b2d`) above the selection, 44 px buttons, ••• opens the context menu. No backdrop. |
| **Popovers** | Colour palette (3-column swatch grid showing "Aa"), zoom presets, files list, overflow. White, radius 12, level-4 shadow. |
| **Inspector** | Uppercase section headings (File / Cashflow / Table / Row / Cell / Column / Footer row / Tips), labelled fields, segmented controls (Manual · From table · Formula; From row · Manual · Table total), the source picker with filters. |
| **Dialogs** | Import dialog only: scrim, white card, title + file name, mapping grid, preview table, action row (secondary left, Cancel + primary right). |
| **Status bubble** | Bottom-right. Sum / Average / Count for the selection, or a notice: info (text colour) or error (`--neg`). Disappears after 3.5 s. |
| **File list** | Card list (name, edited time, actions), upload banner, note. |
| **Sign-in** | Centred card, also used as an overlay when a session ends mid-edit. |

## 7. Interaction patterns

- **Selection:** cells, ranges, multiple ranges (⌘), whole rows/columns (tabs). The anchor cell has a
  2 px accent outline; the range is `--accent-soft`.
- **Whole-line selection:** arrow keys move it a line at a time; Shift extends it. The edit menu and context
  menu then offer row/column commands (Delete Row, Insert Above/Below…).
- **Selecting a table** (click its title): Delete, ⌘C and ⌘X act on the whole table.
- **Drag and drop:** table title moves the table (snapped). Tabs reorder rows/columns; dropping on the
  canvas creates a new table (⌥ copies). Files can be dropped onto a files cell or the files popover.
- **Live updates:** other windows' edits merge in automatically. Undo affects only this window's changes.
- **Destructive actions:** from the keyboard and menus, deleting rows, columns or tables runs immediately
  and is undoable. The Inspector's Delete buttons, and deleting a sheet, a file or a snapshot, ask first
  with a browser confirm (inconsistent; see G2).

**Keyboard map** (⌘ means Ctrl on non-Apple devices):

| Keys | Command |
|---|---|
| ⌘Z / ⇧⌘Z | Undo / Redo |
| ⌘X ⌘C ⌘V | Cut / Copy / Paste (Excel and Numbers compatible) |
| ⌘A | Select all |
| ⌫ / Delete | Clear contents, or delete the selected table |
| ⌥⌘⌫ | Delete rows |
| ⌥↑ / ⌥↓ | Insert row above / below |
| ⌥← / ⌥→ | Insert column before / after (tables) |
| ⌘> / ⌘< | Zoom in / out |
| ⌥⌘I | Inspector |
| ⇧⌘S | Download a copy |
| ⇧⌘O | All files |
| Enter, F2, typing | Edit cell |
| Tab / Enter | Commit and move |
| Space | Toggle checkbox cells |
| Esc | Close menu → close popover → clear selection → unfocus table (never leaves Fill Window) |

## 8. Data display

- **Numbers:** en-US grouping, up to 2 decimals, no currency symbol. Outflows are negative and shown in
  `--neg`.
- **Dates:** stored and shown as `YYYY-MM-DD`. Typed input accepts many forms (2026/11/7, 2026年11月7日, 11/7…).
- **Markers:**

  | Marker | Meaning |
  |---|---|
  | ⇄ | The row or cell takes its value from a table (blue text) |
  | ƒ | Formula (purple) |
  | ✎ | Number typed over a linked row (amber) |
  | `#ERR` | Formula or source error; the reason is in the tooltip and the Inspector |
  | Corner triangle | Reserved for comments |

- **Empty vs zero:** empty cells are blank; calculated rows show `0`.

## 9. Content and voice

- Commands and menu items use **Title Case** ("Delete Row", "Download a Copy"). Hints and notices use
  sentence case.
- "…" marks commands that ask for more input (Rename…, Take Snapshot…).
- Names: **Cashflow** (month-by-month) and **Table** (typed columns). "Ledger" is not used.
- Notices are short, plain and say what happened ("Attached 2 files.", "Not a number: "abc"").

## 10. Deliberate deviations from HIG

1. No in-page menu bar: a web page can't use the real one. File commands live on the file name; everything
   else is in the toolbar and the context and edit menus.
2. No Undo/Redo or Copy/Paste toolbar buttons: they are on the keyboard and in the context and edit menus.
3. Esc never leaves the Fill Window view; only Restore does.
4. Corner triangles are reserved for comments; data links use ⇄.
5. Custom icons instead of SF Symbols, for licensing reasons.

---

## 11. Gaps

Severity: **High** = breaks a rule above or blocks real use; **Medium** = inconsistency or missing spec that
will cost rework; **Low** = polish.

### High

| # | Gap | Evidence | Suggested fix |
|---|---|---|---|
| G1 | **No dark mode.** HIG expects apps to follow the system appearance. | No `prefers-color-scheme` anywhere; every colour is light-only, including cell presets and hard-coded semantic colours. | Move every colour into tokens (G6) and add a dark set. Give each cell preset a dark pair. |
| G2 | **Modal browser prompts remain**, against "edit in place" and HIG alerts. | `prompt`/`confirm`/`alert` in Home (6), SheetTabs, Inspector, FileMenu, commands (2): new file name, rename/duplicate/delete in the file list, delete sheet/snapshot/table confirms, import errors. | New file: create "Untitled" and rename inline. Deletes: undoable or an in-app confirmation popover. Errors: notices or an in-app alert component. |
| G3 | **Touch targets under 44 pt.** | Table title bar 32 px (the only drag handle for a table); sheet-tab ‹ › × 26 px; Inspector inputs, selects and buttons 30–32 px; file-popover icons 36 px; row tabs below ~50 % zoom (e.g. 30 × 7 px at 25 %); column tabs 23 px tall. | Taller title bar or a larger handle on touch; 44 px controls in the Inspector and tabs under `pointer: coarse`. At low zoom, pick the nearest row on tap. |
| G4 | **The grid is invisible to assistive technology.** | Plain `<table>` with no `role="grid"`, `aria-selected`, `aria-rowindex`/`colindex` or active-descendant; selection changes aren't announced; the cell editor has no label tied to the cell. | Add ARIA grid semantics, `aria-activedescendant` on the anchor, and a live region for selection and edits. |
| G5 | **Contrast failures.** | `--muted` on `--head` is **4.29 : 1** (column headers at 12–13 px; needs 4.5). `--line` is **1.36 : 1**, used for input borders (WCAG 1.4.11 needs 3 : 1 for control boundaries). 10 px toolbar labels are small. | Darker `--muted`, e.g. `#5b636c` (5.43 : 1 on `--head`, 6.09 on white); a separate `--control-border` ≥ 3 : 1, e.g. `#868e96` (3.32 : 1); labels at 11 px minimum. |

### Medium

| # | Gap | Evidence | Suggested fix |
|---|---|---|---|
| G6 | **Semantic colours aren't tokens.** | Table 4.2 (source blue, formula purple, amber, edit-menu ink, banners, scrim) hard-coded in components. | Add tokens `--link-source`, `--formula`, `--override`, `--neg-linked`, `--badge-*`, `--scrim`, `--menu-dark`. |
| G7 | **No type scale or Dynamic Type.** | 9 ad hoc sizes (10–22 px); everything is 13 px on iPad, where HIG body is 17 pt; no user text-size setting. | Define a scale of roughly 6 steps mapped to HIG text styles; base 13 px on pointer devices and larger under `pointer: coarse`; consider a text-size preference. |
| G8 | **No spacing, radius or elevation scales.** | 8+ spacing values, 7 radii (4–12 px), 8 shadow variants. | 4-pt spacing scale; 3 radii (6/8/12); 4 elevation levels as tokens. |
| G9 | **No motion spec.** | No transitions or animations at all; menus and popovers appear instantly. | Short (150–200 ms) fades/scales for menus and popovers, a drag-drop settle, and `prefers-reduced-motion` handling. |
| G10 | **Focus styling is inconsistent.** | `:focus-visible` is styled only in menus; the toolbar, tabs, tables and inspector use browser defaults; the toolbar has no roving tabindex and the edit menu isn't reachable by keyboard. | One focus ring token (2 px `--accent`, 2 px offset) everywhere; a toolbar keyboard model (Tab into the toolbar, arrows between items). |
| G11 | **English only.** | The owner works in Chinese; all UI text is English; numbers are en-US; date display is ISO only. | An i18n string table (zh-Hans + en), locale-aware number and date formats, and a choice of month header style (Nov / 11月). |
| G12 | **Number formatting is fixed.** | Up to 2 decimals, no currency, no thousands/decimal options, no per-column or per-row format. | Number formats (decimals, currency ¥/$, accounting negatives, thousands/万 units) as a cell format next to the colours. |
| G13 | **Glyphs instead of icons for meaning.** | ⇄ ƒ ✎ ✓ 📎 ‹ › × ⤢ ⠿ render differently across fonts; 📎 is an emoji. | Draw them as `Icon` paths for consistency; keep text equivalents for screen readers. |
| G14 | **Cell styling is preset-only.** | Nine fixed fill/text pairs; no bold, italic, alignment or borders. | Extend the Color popover into a Format popover: text style, alignment, number format. |
| G15 | **Dark edit menu vs light UI.** | The touch edit menu is the only dark surface. | Keep it (it matches iPadOS), but define it as a token pair so dark mode inverts it consistently. |

### Low

| # | Gap | Evidence | Suggested fix |
|---|---|---|---|
| G16 | **Empty and loading states.** | The app shows nothing while loading; empty sheets show only the dotted canvas; empty tables have no hint. | A loading indicator; empty-state hints ("Add a cashflow or a table from the toolbar"). |
| G17 | **Inspector Tips are static prose.** | A long tips list repeats this document and can go stale. | Replace with contextual hints per section, plus a link to help. |
| G18 | **No component catalogue or visual tests.** | This document only; components are verified by ad-hoc browser scripts. | A small gallery page of each component in each state, and screenshot tests in CI. |
| G19 | **Comments are not designed.** | Corner triangles are reserved but there is no spec for the comment popover, author or time, or resolved state. | Spec before building. |
| G20 | **View-only (shared) mode is not designed.** | Planned last phase; read-only snapshot styling exists but not a shared-viewer chrome. | Define what viewers see: no toolbar edit groups, a "View only" badge, no Inspector editing. |
| G21 | **Print / PDF export styles.** | None. | Print stylesheet: one table per page, headers repeated. |

*Contrast figures in §4 were computed with the WCAG 2.x relative-luminance formula from the hex values in
the code; colours with alpha were not measured.*
