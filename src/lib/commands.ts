import { app } from './store.svelte';
import { readSpreadsheet } from './import/xlsx';
import { COLUMN_TYPE_LABELS } from './ledger';
import type { ColumnType } from './model';
import { STYLES } from './styles';

/**
 * Every user command, in one place. The menu bar, context menus, the touch
 * edit menu, the toolbar and keyboard shortcuts all run these, so each action
 * works the same with mouse, keyboard or touch.
 */

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

/** A key combination. `mod` is ⌘ on Apple devices and Ctrl elsewhere. */
export interface Keys {
  key: string;
  mod?: boolean;
  alt?: boolean;
  shift?: boolean;
  ctrl?: boolean;
}

export interface Command {
  id: string;
  label: string | (() => string);
  keys?: Keys;
  /** Handled by the browser's own copy/cut/paste events; the menu only shows the shortcut. */
  native?: boolean;
  enabled?: () => boolean;
  checked?: () => boolean;
  run: () => void | Promise<void>;
}

const KEY_GLYPH: Record<string, string> = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backspace: '⌫', Delete: '⌦', Enter: '↩', Escape: 'esc',
};

/** Shortcut text the way HIG shows it: ⌃⌥⇧⌘ order on Apple devices. */
export function shortcutText(k: Keys | undefined): string {
  if (!k) return '';
  const key = KEY_GLYPH[k.key] ?? k.key.toUpperCase();
  if (isMac) return `${k.ctrl ? '⌃' : ''}${k.alt ? '⌥' : ''}${k.shift ? '⇧' : ''}${k.mod ? '⌘' : ''}${key}`;
  return [k.ctrl && 'Ctrl', k.mod && 'Ctrl', k.alt && 'Alt', k.shift && 'Shift', key].filter(Boolean).join('+');
}

function matches(k: Keys, e: KeyboardEvent): boolean {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  return (
    e.key.toLowerCase() === k.key.toLowerCase() &&
    !!k.mod === mod &&
    !!k.alt === e.altKey &&
    !!k.shift === e.shiftKey &&
    (!isMac || !!k.ctrl === e.ctrlKey)
  );
}

// ---------- helpers ----------

const hasFile = () => !!app.file;
const editable = () => !!app.file && !app.readonly;
const hasSel = () => !!app.selection;
const focusTable = () => app.table(app.selection?.tableId ?? app.focusTableId);
const tableSelectedOnly = () => !app.selection && !!app.focusTableId;
const ledgerFocused = () => focusTable()?.kind === 'ledger';

async function writeClipboard(): Promise<boolean> {
  const data = app.copyData();
  if (!data) return false;
  try {
    if ('ClipboardItem' in window) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([data.text], { type: 'text/plain' }),
          'text/html': new Blob([data.html], { type: 'text/html' }),
        }),
      ]);
    } else {
      await navigator.clipboard.writeText(data.text);
    }
    return true;
  } catch {
    app.flashNotice(`Copy was blocked by the browser. Use ${shortcutText({ key: 'c', mod: true })} instead.`);
    return false;
  }
}

/** Copy the whole selected table (when the table itself, not cells, is selected). */
function selectWholeTable() {
  if (!app.selection && app.focusTableId) {
    const t = app.table(app.focusTableId);
    if (t) {
      app.select(t.id, { r: 0, c: 0 });
      app.selectAll();
    }
  }
}

export function pickImportFile(ledgerId: string) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,.tsv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const sheets = (await readSpreadsheet(file.name, new Uint8Array(await file.arrayBuffer()))).filter((s) => s.rows.length);
      if (!sheets.length) throw new Error('The file has no data.');
      app.importing = { ledgerId, fileName: file.name, sheets };
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };
  input.click();
}

// ---------- the commands ----------

const list: Command[] = [
  // File
  { id: 'file.list', label: 'All Files', keys: { key: 'o', mod: true, shift: true }, enabled: hasFile, run: () => void (location.hash = '#/') },
  { id: 'file.rename', label: 'Rename File…', enabled: editable, run: () => app.startRenameFile() },
  { id: 'file.snapshot', label: 'Take Snapshot…', enabled: editable, run: () => {
    const label = prompt('Snapshot name', `Snapshot ${new Date().toLocaleDateString()}`);
    if (label !== null) app.takeSnapshot(label);
  } },
  { id: 'file.download', label: 'Download a Copy', keys: { key: 's', mod: true, shift: true }, enabled: hasFile, run: () => app.downloadFile() },

  // Edit
  { id: 'edit.undo', label: 'Undo', keys: { key: 'z', mod: true }, enabled: () => app.canUndo, run: () => app.undo() },
  { id: 'edit.redo', label: 'Redo', keys: { key: 'z', mod: true, shift: true }, enabled: () => app.canRedo, run: () => app.redo() },
  { id: 'edit.cut', label: 'Cut', keys: { key: 'x', mod: true }, native: true, enabled: () => editable() && (hasSel() || tableSelectedOnly()), run: async () => {
    if (tableSelectedOnly()) {
      const id = app.focusTableId!;
      selectWholeTable();
      if (await writeClipboard()) app.deleteTable(id);
      return;
    }
    if (await writeClipboard()) app.clearSelected();
  } },
  { id: 'edit.copy', label: 'Copy', keys: { key: 'c', mod: true }, native: true, enabled: () => hasSel() || tableSelectedOnly(), run: async () => {
    selectWholeTable();
    await writeClipboard();
  } },
  { id: 'edit.paste', label: 'Paste', keys: { key: 'v', mod: true }, native: true, enabled: () => editable() && hasSel(), run: async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) app.paste(text);
    } catch {
      app.flashNotice(`Paste was blocked by the browser. Use ${shortcutText({ key: 'v', mod: true })} instead.`);
    }
  } },
  { id: 'edit.delete', label: () => (tableSelectedOnly() ? 'Delete Table' : 'Delete'), keys: { key: 'Backspace' }, enabled: () => editable() && (hasSel() || tableSelectedOnly()), run: () => {
    if (tableSelectedOnly()) app.deleteTable(app.focusTableId!);
    else app.clearSelected();
  } },
  { id: 'edit.selectAll', label: 'Select All', keys: { key: 'a', mod: true }, enabled: () => !!focusTable(), run: () => app.selectAll() },

  // Insert
  { id: 'insert.table', label: 'Table', enabled: editable, run: () => app.addTable('cashflow') },
  { id: 'insert.ledger', label: 'Ledger', enabled: editable, run: () => app.addTable('ledger') },
  { id: 'insert.rowAbove', label: 'Row Above', keys: { key: 'ArrowUp', alt: true }, enabled: () => editable() && !!focusTable(), run: () => app.insertRow('above') },
  { id: 'insert.rowBelow', label: 'Row Below', keys: { key: 'ArrowDown', alt: true }, enabled: () => editable() && !!focusTable(), run: () => app.insertRow('below') },
  { id: 'insert.colBefore', label: 'Column Before', keys: { key: 'ArrowLeft', alt: true }, enabled: () => editable() && ledgerFocused(), run: () => app.insertColumnAt('before') },
  { id: 'insert.colAfter', label: 'Column After', keys: { key: 'ArrowRight', alt: true }, enabled: () => editable() && ledgerFocused(), run: () => app.insertColumnAt('after') },
  { id: 'insert.footer', label: 'Footer Formula Row', enabled: () => editable() && focusTable()?.kind === 'cashflow', run: () => app.addFooter(focusTable()!.id) },

  // Table
  { id: 'table.rename', label: 'Rename Table', enabled: () => editable() && !!focusTable(), run: () => void (app.renamingTableId = focusTable()!.id) },
  { id: 'table.maximize', label: () => (app.maximizedId ? 'Restore Table Size' : 'Fill Window with Table'), enabled: () => !!focusTable() || !!app.maximizedId, run: () => app.toggleMaximize() },
  { id: 'table.deleteRows', label: 'Delete Rows', keys: { key: 'Backspace', mod: true, alt: true }, enabled: () => editable() && hasSel(), run: () => app.deleteSelectedRows() },
  { id: 'table.deleteColumns', label: 'Delete Columns', enabled: () => editable() && hasSel() && ledgerFocused(), run: () => app.deleteSelectedColumns() },
  { id: 'table.moveUp', label: 'Move Row Up', enabled: () => editable() && hasSel(), run: () => app.moveSelectedRow(-1) },
  { id: 'table.moveDown', label: 'Move Row Down', enabled: () => editable() && hasSel(), run: () => app.moveSelectedRow(1) },
  { id: 'table.renameColumn', label: 'Rename Column', enabled: () => editable() && ledgerFocused() && hasSel(), run: () => {
    const t = focusTable();
    if (t?.kind === 'ledger' && app.selection) app.renamingColumn = { tableId: t.id, colId: t.columns[app.selection.anchor.c].id };
  } },
  { id: 'table.sortAsc', label: 'Sort Ascending', enabled: () => editable() && ledgerFocused(), run: () => {
    const t = focusTable();
    if (t?.kind === 'ledger') app.sortLedger(t.id, t.columns[app.selection?.anchor.c ?? 0]?.id);
  } },
  { id: 'table.sortDesc', label: 'Sort Descending', enabled: () => editable() && ledgerFocused(), run: () => {
    const t = focusTable();
    if (t?.kind === 'ledger') app.sortLedger(t.id, t.columns[app.selection?.anchor.c ?? 0]?.id, true);
  } },
  { id: 'table.import', label: 'Import CSV or Excel…', enabled: () => editable() && ledgerFocused(), run: () => pickImportFile(focusTable()!.id) },
  { id: 'table.delete', label: 'Delete Table', enabled: () => editable() && !!focusTable(), run: () => app.deleteTable(focusTable()!.id) },

  // Format
  ...STYLES.map<Command>((st) => ({
    id: `format.color.${st.id}`,
    label: st.id === 'none' ? 'No Fill' : st.name,
    enabled: () => editable() && hasSel(),
    run: () => app.applyStyle(st.id),
  })),
  ...(Object.keys(COLUMN_TYPE_LABELS) as ColumnType[]).map<Command>((type) => ({
    id: `format.type.${type}`,
    label: COLUMN_TYPE_LABELS[type],
    enabled: () => editable() && ledgerFocused() && hasSel(),
    checked: () => {
      const t = focusTable();
      return t?.kind === 'ledger' && t.columns[app.selection?.anchor.c ?? -1]?.type === type;
    },
    run: () => {
      const t = focusTable();
      const col = t?.kind === 'ledger' ? t.columns[app.selection?.anchor.c ?? -1] : undefined;
      if (t && col) app.setColumnType(t.id, col.id, type);
    },
  })),

  // View
  { id: 'view.inspector', label: 'Inspector', keys: { key: 'i', mod: true, alt: true }, checked: () => app.showInspector, run: () => void (app.showInspector = !app.showInspector) },
];

export const commands: Record<string, Command> = Object.fromEntries(list.map((c) => [c.id, c]));

export function labelOf(c: Command): string {
  return typeof c.label === 'function' ? c.label() : c.label;
}

export function isEnabled(c: Command): boolean {
  return !c.enabled || c.enabled();
}

/** Run a command by id if it is enabled. Returns whether it ran. */
export function run(id: string): boolean {
  const c = commands[id];
  if (!c || !isEnabled(c)) return false;
  app.menu = null;
  void c.run();
  return true;
}

/** The command a key press triggers (browser-handled clipboard keys excluded). */
export function commandForKey(e: KeyboardEvent): Command | undefined {
  return list.find((c) => c.keys && !c.native && matches(c.keys, e));
}

// ---------- menus ----------

export type MenuItem = string | '-' | { title: string; items: MenuItem[] };

export const MENU_BAR: { title: string; items: MenuItem[] }[] = [
  { title: 'File', items: ['file.list', '-', 'file.rename', 'file.snapshot', 'file.download'] },
  { title: 'Edit', items: ['edit.undo', 'edit.redo', '-', 'edit.cut', 'edit.copy', 'edit.paste', 'edit.delete', '-', 'edit.selectAll'] },
  { title: 'Insert', items: ['insert.table', 'insert.ledger', '-', 'insert.rowAbove', 'insert.rowBelow', 'insert.colBefore', 'insert.colAfter', '-', 'insert.footer'] },
  {
    title: 'Table',
    items: ['table.rename', 'table.maximize', '-', 'table.deleteRows', 'table.deleteColumns', 'table.moveUp', 'table.moveDown', '-',
      'table.renameColumn', 'table.sortAsc', 'table.sortDesc', 'table.import', '-', 'table.delete'],
  },
  {
    title: 'Format',
    items: [
      { title: 'Cell Color', items: STYLES.map((s) => `format.color.${s.id}`) },
      { title: 'Column Format', items: (Object.keys(COLUMN_TYPE_LABELS) as ColumnType[]).map((t) => `format.type.${t}`) },
    ],
  },
  { title: 'View', items: ['view.inspector', 'table.maximize'] },
];

/** Right-click / long-press menu for cells. */
export function contextItems(target: 'cells' | 'table' | 'column'): MenuItem[] {
  if (target === 'table') return ['edit.copy', 'edit.cut', '-', 'table.rename', 'table.maximize', '-', 'table.delete'];
  if (target === 'column') {
    return ['table.renameColumn', { title: 'Column Format', items: (Object.keys(COLUMN_TYPE_LABELS) as ColumnType[]).map((t) => `format.type.${t}`) },
      '-', 'insert.colBefore', 'insert.colAfter', '-', 'table.sortAsc', 'table.sortDesc', '-', 'table.deleteColumns'];
  }
  const ledger = ledgerFocused();
  return [
    'edit.cut', 'edit.copy', 'edit.paste', 'edit.delete', '-',
    'insert.rowAbove', 'insert.rowBelow',
    ...(ledger ? ['insert.colBefore', 'insert.colAfter'] : []),
    '-', 'table.deleteRows', ...(ledger ? ['table.deleteColumns'] : []),
    '-', { title: 'Cell Color', items: STYLES.map((s) => `format.color.${s.id}`) },
  ];
}

/** The short edit menu shown above a selection after a tap (touch). */
export function editMenuItems(target: 'cells' | 'table' | 'column'): string[] {
  if (target === 'table') return ['edit.copy', 'edit.cut', 'table.rename', 'table.maximize', 'table.delete'];
  return ['edit.cut', 'edit.copy', 'edit.paste', 'edit.delete', 'insert.rowAbove', 'insert.rowBelow'];
}
