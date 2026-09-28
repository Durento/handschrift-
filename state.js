// Gemeinsamer App-Zustand und Persistenz
import { store } from './store.js';
import { debounce, loadImage } from './util.js';
import { detectLines } from './paper.js';

export const DEFAULT_SETTINGS = {
  // Papier
  paperMode: 'lined',        // lined | photo | sheet
  paperColor: '#ffffff',
  lineColor: '#c8ccd4',
  lineSpacing: 9,            // mm
  lineEvery: 1,              // auf jede / jede 2. Linie schreiben
  marginTop: 20, marginBottom: 15, marginLeft: 22, marginRight: 12,
  marginLineLeft: true, marginLineRight: false,
  photoShift: 0,             // Feinkorrektur der erkannten Linien (mm)
  showGuides: true,          // erkannte Linien / Textfeld-Linien in der Vorschau
  box: { x: 0.1, y: 0.35, w: 0.8, h: 0.4 },
  // Schrift
  fontSize: 85,              // % der maximal passenden Größe
  slant: 0,                  // Grad
  wordSpacing: 0.55,         // × Schriftgröße
  letterSpacing: 0.06,       // × Schriftgröße
  strokeWidth: 0.5,          // mm
  thinning: 0.5,             // Einfluss des Stiftdrucks
  inkColor: '#1b3a8c',
  randomness: 50,            // %
  seed: 1,
  hyphenMode: 'normal',      // min | normal | max
  // Erfassung
  penOnly: true,
};

export const state = {
  glyphs: new Map(),         // key -> { key, variants: [{ strokes, created }] }
  settings: { ...DEFAULT_SETTINGS },
  extraChars: [],
  text: '',
  backgrounds: { photo: null, sheet: null }, // { img, blob, detect? }
};

export const bus = new EventTarget();
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
export const on = (type, fn) => bus.addEventListener(type, e => fn(e.detail));

export async function loadState() {
  const [glyphs, settings, extra, text] = await Promise.all([
    store.allGlyphs(), store.get('settings'), store.get('extraChars'), store.get('text'),
  ]);
  state.glyphs = new Map((glyphs || []).map(g => [g.key, g]));
  state.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  state.extraChars = extra || [];
  state.text = text ?? '';
  for (const kind of ['photo', 'sheet']) {
    const blob = await store.get('bg-' + kind);
    if (blob) {
      try { await setBackground(kind, blob, false); } catch { /* Bild defekt */ }
    }
  }
}

export const saveSettings = debounce(() => store.set('settings', state.settings), 400);
export const saveText = debounce(() => store.set('text', state.text), 500);

export async function saveGlyph(key) {
  const rec = state.glyphs.get(key);
  if (!rec || !rec.variants.length) {
    state.glyphs.delete(key);
    await store.deleteGlyph(key);
  } else {
    await store.putGlyph(rec);
  }
  emit('glyphs');
}

export async function setBackground(kind, blob, persist = true) {
  const img = await loadImage(blob);
  const bg = { img, blob };
  if (kind === 'photo') bg.detect = detectLines(img);
  state.backgrounds[kind] = bg;
  if (persist) await store.set('bg-' + kind, blob);
  return bg;
}

export async function removeBackground(kind) {
  state.backgrounds[kind] = null;
  await store.del('bg-' + kind);
}

/** Rundet Strichdaten für kompakte Speicherung. */
export function compactStrokes(strokes) {
  const r3 = v => Math.round(v * 1000) / 1000;
  return strokes.map(s => s.map(p => [r3(p[0]), r3(p[1]), Math.round(p[2] * 100) / 100, Math.round(p[3])]));
}
