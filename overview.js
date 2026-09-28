// Übersicht aller Zeichen, eigene Zusatzzeichen, Backup (Export/Import)
import { state, emit, on, saveSettings } from './state.js';
import { store } from './store.js';
import { GROUPS, MAX_VARIANTS } from './charset.js';
import { drawVariantFit } from './ink.js';
import { $, el, dialog, toast, offerFiles, pickFile } from './util.js';

let openChar = () => {};

export function initOverview(onOpenChar) {
  openChar = onOpenChar;
  $('#ov-export').onclick = exportData;
  $('#ov-import').onclick = importData;
  $('#ov-add').onclick = addExtraChar;
  $('#ov-clear').onclick = clearAll;
  on('glyphs', () => { if (!$('#view-overview').hidden) render(); });
}

export function render() {
  const groups = [...GROUPS];
  if (state.extraChars.length) groups.push({ id: 'extra', title: 'Eigene Zeichen', chars: state.extraChars });
  let total = 0, done = 0, variants = 0;
  const root = $('#ov-grid');
  root.replaceChildren();
  for (const g of groups) {
    const grid = el('div', { class: 'tiles' });
    let gDone = 0;
    for (const ch of g.chars) {
      const vs = state.glyphs.get(ch)?.variants || [];
      total++;
      if (vs.length) { done++; gDone++; variants += vs.length; }
      const c = el('canvas', { width: 128, height: 128 });
      if (vs.length) drawVariantFit(c.getContext('2d'), vs[0], 8, 8, 112, 112, '#1d2a55', 4.5);
      grid.append(el('button', { class: 'tile' + (vs.length ? '' : ' missing'), onclick: () => openChar(ch), 'aria-label': `${ch} ${vs.length ? vs.length + ' Varianten' : 'fehlt'}` },
        vs.length ? c : el('span', { class: 'tile-placeholder' }, ch),
        el('span', { class: 'tile-label' }, ch),
        el('span', { class: 'dots' }, Array.from({ length: MAX_VARIANTS }, (_, i) => el('i', { class: i < vs.length ? 'on' : '' })))));
    }
    root.append(el('section', { class: 'ov-group' },
      el('h3', {}, g.title, el('small', {}, ` ${gDone}/${g.chars.length}`)), grid));
  }
  $('#ov-stats').textContent = `${done} von ${total} Zeichen erfasst · ${variants} Varianten insgesamt`;
  $('#ov-progress').style.width = (total ? (done / total) * 100 : 0) + '%';
}

async function exportData() {
  const data = {
    format: 'handschrift-app',
    version: 1,
    exported: new Date().toISOString(),
    extraChars: state.extraChars,
    settings: state.settings,
    text: state.text,
    glyphs: [...state.glyphs.values()],
  };
  const date = new Date().toISOString().slice(0, 10);
  const file = new File([JSON.stringify(data)], `handschrift-backup-${date}.json`, { type: 'application/json' });
  await offerFiles([file], 'Backup erstellt');
}

async function importData() {
  const file = await pickFile('application/json,.json');
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
    if (data.format !== 'handschrift-app' || !Array.isArray(data.glyphs)) throw new Error('Format');
  } catch {
    await dialog({ title: 'Import fehlgeschlagen', text: 'Die Datei ist kein gültiges Backup dieser App.' });
    return;
  }
  const mode = await dialog({
    title: 'Backup importieren',
    text: `${data.glyphs.length} Zeichen gefunden. Sollen die vorhandenen Daten ersetzt oder ergänzt werden? Beim Ergänzen werden gleiche Zeichen aus dem Backup übernommen.`,
    buttons: [{ label: 'Ersetzen', value: 'replace', danger: true }, { label: 'Ergänzen', value: 'merge', primary: true }, { label: 'Abbrechen', value: null }],
  });
  if (!mode) return;
  if (mode === 'replace') { await store.clearGlyphs(); state.glyphs.clear(); }
  for (const g of data.glyphs) {
    if (!g || typeof g.key !== 'string' || !Array.isArray(g.variants)) continue;
    const rec = { key: g.key, variants: g.variants.filter(v => Array.isArray(v.strokes)).slice(0, MAX_VARIANTS) };
    state.glyphs.set(rec.key, rec);
    await store.putGlyph(rec);
  }
  if (Array.isArray(data.extraChars)) {
    state.extraChars = mode === 'replace' ? data.extraChars : [...new Set([...state.extraChars, ...data.extraChars])];
    await store.set('extraChars', state.extraChars);
  }
  if (mode === 'replace' && data.settings) {
    Object.assign(state.settings, data.settings);
    saveSettings();
    emit('settings');
  }
  emit('glyphs');
  render();
  toast('Import abgeschlossen');
}

async function addExtraChar() {
  const input = $('#ov-extra');
  const chars = Array.from(input.value.trim()).filter(c => c.trim());
  if (!chars.length) return toast('Zeichen eingeben, z. B. & @ €');
  const all = new Set(GROUPS.flatMap(g => g.chars));
  const add = chars.filter(c => !all.has(c) && !state.extraChars.includes(c));
  state.extraChars.push(...add);
  await store.set('extraChars', state.extraChars);
  input.value = '';
  render();
  toast(add.length ? `Hinzugefügt: ${add.join(' ')}` : 'Diese Zeichen gibt es schon');
}

async function clearAll() {
  const ok = await dialog({
    title: 'Alle Handschrift-Daten löschen?',
    text: 'Alle erfassten Zeichen werden von diesem Gerät gelöscht. Erstelle vorher ein Backup, falls du sie noch brauchst.',
    buttons: [{ label: 'Alles löschen', value: true, danger: true }, { label: 'Abbrechen', value: false, primary: true }],
  });
  if (!ok) return;
  await store.clearGlyphs();
  state.glyphs.clear();
  emit('glyphs');
  render();
}
