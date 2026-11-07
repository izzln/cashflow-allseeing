export interface StylePreset {
  id: string;
  name: string;
  bg: string;
  fg: string;
}

/** Cell color combinations. 'none' clears the style. */
export const STYLES: StylePreset[] = [
  { id: 'none', name: 'Default', bg: '#ffffff', fg: '#1f2328' },
  { id: 'gray', name: 'Gray', bg: '#eef0f3', fg: '#343a40' },
  { id: 'red', name: 'Red', bg: '#fdecec', fg: '#b42318' },
  { id: 'orange', name: 'Orange', bg: '#fff1e0', fg: '#b54708' },
  { id: 'yellow', name: 'Yellow', bg: '#fef7d1', fg: '#7a5600' },
  { id: 'green', name: 'Green', bg: '#e7f6ec', fg: '#18794e' },
  { id: 'blue', name: 'Blue', bg: '#e8f1fd', fg: '#175cd3' },
  { id: 'purple', name: 'Purple', bg: '#f1ecfd', fg: '#6941c6' },
  { id: 'dark', name: 'Dark', bg: '#1f2937', fg: '#ffffff' },
];

export const STYLE_BY_ID: Record<string, StylePreset> = Object.fromEntries(
  STYLES.map((s) => [s.id, s]),
);
