// Teil 2: Text in der eigenen Handschrift ausgeben
import { state, on, saveSettings, saveText, setBackground, removeBackground, DEFAULT_SETTINGS } from './state.js';
import { store } from './store.js';
import { layoutText } from './layout.js';
import { buildTemplate } from './paper.js';
import { drawPage, renderToCanvas } from './render.js';
import { pdfBackend, buildPdf } from './pdf.js';
import { allChars } from './charset.js';
import { $, el, debounce, dialog, toast, busy, offerFiles, pickFile, clamp } from './util.js';

const EXPORT_DPI = 300;
const INKS = [['#1b3a8c', 'Königsblau'], ['#0f1f45', 'Dunkelblau'], ['#222222', 'Schwarz'], ['#b3261e', 'Rot'], ['#1e6b3a', 'Grün'], ['#5b2a86', 'Lila']];
const PAPERS = [['#ffffff', 'Weiß'], ['#fbf7ea', 'Creme'], ['#f3efe2', 'Recycling'], ['#eef3f9', 'Hellblau']];

const isMode = m => s => s.paperMode === m;
const notMode = m => s => s.paperMode !== m;

/** Einstellungen als Schema – daraus wird das Formular gebaut. */
const SCHEMA = [
  { title: 'Papier', items: [
    { key: 'paperMode', type: 'segment', label: 'Papier', options: [['lined', 'Liniert A4'], ['photo', 'Foto Linienpapier'], ['sheet', 'Bild + Textfeld']] },
    { type: 'bg', kind: 'photo', show: isMode('photo') },
    { type: 'bg', kind: 'sheet', show: isMode('sheet') },
    { key: 'paperColor', type: 'swatch', label: 'Papierfarbe', options: PAPERS, show: isMode('lined') },
    { key: 'lineColor', type: 'color', label: 'Linienfarbe', show: isMode('lined') },
    { key: 'lineSpacing', type: 'range', label: 'Linienabstand', min: 5, max: 16, step: 0.5, unit: ' mm', show: notMode('photo') },
    { key: 'lineEvery', type: 'segment', label: 'Zeilenabstand', options: [[1, 'Jede Linie'], [2, 'Jede 2. Linie']] },
    { key: 'photoShift', type: 'range', label: 'Linien verschieben', min: -4, max: 4, step: 0.1, unit: ' mm', show: isMode('photo') },
    { key: 'showGuides', type: 'check', label: 'Hilfslinien in Vorschau', show: notMode('lined') },
    { key: 'marginTop', type: 'range', label: 'Rand oben', min: 0, max: 50, step: 1, unit: ' mm', show: isMode('lined') },
    { key: 'marginBottom', type: 'range', label: 'Rand unten', min: 0, max: 50, step: 1, unit: ' mm', show: isMode('lined') },
    { key: 'marginLeft', type: 'range', label: 'Rand links', min: 0, max: 50, step: 1, unit: ' mm', show: notMode('sheet') },
    { key: 'marginRight', type: 'range', label: 'Rand rechts', min: 0, max: 50, step: 1, unit: ' mm', show: notMode('sheet') },
    { key: 'marginLineLeft', type: 'check', label: 'Randlinie links', show: isMode('lined') },
    { key: 'marginLineRight', type: 'check', label: 'Randlinie rechts', show: isMode('lined') },
  ] },
  { title: 'Schrift', items: [
    { key: 'fontSize', type: 'range', label: 'Schriftgröße', min: 40, max: 110, step: 1, unit: ' %' },
    { key: 'slant', type: 'range', label: 'Neigung', min: -20, max: 25, step: 1, unit: '°' },
    { key: 'wordSpacing', type: 'range', label: 'Wortabstand', min: 0.2, max: 1.5, step: 0.05 },
    { key: 'letterSpacing', type: 'range', label: 'Buchstabenabstand', min: -0.2, max: 0.5, step: 0.01 },
    { key: 'strokeWidth', type: 'range', label: 'Strichdicke', min: 0.2, max: 1.4, step: 0.05, unit: ' mm' },
    { key: 'thinning', type: 'range', label: 'Druckeinfluss', min: 0, max: 0.9, step: 0.05 },
    { key: 'inkColor', type: 'swatch', label: 'Tintenfarbe', options: INKS, custom: true },
  ] },
  { title: 'Natürlichkeit', items: [
    { key: 'randomness', type: 'range', label: 'Zufälligkeit', min: 0, max: 100, step: 1, unit: ' %' },
    { type: 'button', label: '🎲 Neu würfeln', action: () => { state.settings.seed = (Math.random() * 1e9) | 0; changed(); } },
    { key: 'hyphenMode', type: 'segment', label: 'Silbentrennung', options: [['min', 'Nur lange Wörter'], ['normal', 'Normal'], ['max', 'Häufig']] },
    { type: 'button', label: 'Einstellungen zurücksetzen', action: resetSettings },
  ] },
];

let layout = null, tpl = null;
let pageCards = [];
let io = null;
let openChar = () => {};

export function initWrite(onOpenChar) {
  openChar = onOpenChar;
  const ta = $('#w-text');
  ta.value = state.text;
  ta.addEventListener('input', () => { state.text = ta.value; saveText(); relayoutSoon(); });
  $('#w-png-all').onclick = exportAllPng;
  $('#w-pdf').onclick = exportPdf;
  $('#w-settings-toggle').onclick = () => document.body.classList.toggle('settings-open');
  io = new IntersectionObserver(onVisibility, { root: $('#w-preview'), rootMargin: '600px 0px' });
  buildSettings();
  on('glyphs', () => relayoutSoon());
  on('settings', () => { buildSettings(); relayoutSoon(); });
  window.addEventListener('resize', debounce(() => { if (!$('#view-write').hidden) markAllDirty(); }, 250));
}

export function onShowWrite() {
  relayout();
}

function changed() {
  saveSettings();
  relayoutSoon();
}

async function resetSettings() {
  const ok = await dialog({ title: 'Einstellungen zurücksetzen?', buttons: [{ label: 'Zurücksetzen', value: true, danger: true }, { label: 'Abbrechen', value: false, primary: true }] });
  if (!ok) return;
  Object.assign(state.settings, { ...DEFAULT_SETTINGS, penOnly: state.settings.penOnly, box: { ...DEFAULT_SETTINGS.box } });
  saveSettings();
  buildSettings();
  relayout();
}

// ---------- Einstellungsformular ----------

function buildSettings() {
  const root = $('#w-settings');
  root.replaceChildren();
  const s = state.settings;
  for (const group of SCHEMA) {
    const sec = el('details', { class: 'set-group', open: true }, el('summary', {}, group.title));
    for (const it of group.items) {
      if (it.show && !it.show(s)) continue;
      sec.append(control(it));
    }
    root.append(sec);
  }
}

function control(it) {
  const s = state.settings;
  const set = (v, rebuild = false) => { s[it.key] = v; changed(); if (rebuild) buildSettings(); };
  switch (it.type) {
    case 'range': {
      const out = el('output', {}, fmt(s[it.key], it));
      const input = el('input', { type: 'range', min: it.min, max: it.max, step: it.step, value: s[it.key] });
      input.addEventListener('input', () => { out.textContent = fmt(+input.value, it); set(+input.value); });
      return el('label', { class: 'row' }, el('span', { class: 'row-label' }, it.label, out), input);
    }
    case 'segment':
      return el('div', { class: 'row' }, el('span', { class: 'row-label' }, it.label),
        el('div', { class: 'segment' }, it.options.map(([v, label]) =>
          el('button', { class: String(s[it.key]) === String(v) ? 'on' : '', onclick: () => set(v, true) }, label))));
    case 'check': {
      const input = el('input', { type: 'checkbox', checked: !!s[it.key] });
      input.addEventListener('change', () => set(input.checked));
      return el('label', { class: 'row check' }, input, el('span', {}, it.label));
    }
    case 'color': {
      const input = el('input', { type: 'color', value: s[it.key] });
      input.addEventListener('input', () => set(input.value));
      return el('label', { class: 'row inline' }, el('span', { class: 'row-label' }, it.label), input);
    }
    case 'swatch': {
      const wrap = el('div', { class: 'swatches' }, it.options.map(([v, label]) =>
        el('button', { class: 'swatch' + (s[it.key] === v ? ' on' : ''), style: `--c:${v}`, title: label, 'aria-label': label, onclick: () => set(v, true) })));
      if (it.custom) {
        const input = el('input', { type: 'color', value: s[it.key], 'aria-label': 'Eigene Farbe' });
        input.addEventListener('input', () => { s[it.key] = input.value; changed(); });
        wrap.append(input);
      }
      return el('div', { class: 'row' }, el('span', { class: 'row-label' }, it.label), wrap);
    }
    case 'button':
      return el('button', { class: 'btn wide', onclick: it.action }, it.label);
    case 'bg':
      return bgControl(it.kind);
  }
  return '';
}

function fmt(v, it) {
  const d = it.step < 0.1 ? 2 : it.step < 1 ? 1 : 0;
  return Number(v).toFixed(d).replace('.', ',') + (it.unit || '');
}

function bgControl(kind) {
  const bg = state.backgrounds[kind];
  const title = kind === 'photo' ? 'Foto von liniertem Papier' : 'Hintergrundbild (z. B. Arbeitsblatt)';
  let info;
  if (!bg) info = kind === 'photo' ? 'Lade ein gerade aufgenommenes Foto oder einen Scan von liniertem Papier hoch. Die Linien werden automatisch erkannt.' : 'Lade ein Bild hoch und platziere dann das Textfeld auf Seite 1.';
  else if (kind === 'photo') {
    const d = bg.detect;
    const mm = d && d.lines.length >= 2 ? (d.spacingPx * 210 / bg.img.naturalWidth).toFixed(1).replace('.', ',') : null;
    info = d && d.ok ? `✓ ${d.lines.length} Linien erkannt, Abstand ≈ ${mm} mm` : '⚠︎ Keine Linien sicher erkannt. Ein helleres, gerades Foto hilft.';
  } else info = '✓ Textfeld auf Seite 1 verschieben; an der Ecke unten rechts ziehen, um die Größe zu ändern.';
  return el('div', { class: 'row bg' },
    el('span', { class: 'row-label' }, title),
    el('p', { class: 'hint' }, info),
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn', onclick: () => chooseBackground(kind) }, bg ? 'Anderes Bild' : 'Bild wählen'),
      bg ? el('button', { class: 'btn', onclick: async () => { await removeBackground(kind); buildSettings(); relayout(); } }, 'Entfernen') : null));
}

async function chooseBackground(kind) {
  const file = await pickFile('image/*');
  if (!file) return;
  const b = busy(kind === 'photo' ? 'Linien werden erkannt …' : 'Bild wird geladen …');
  try {
    await setBackground(kind, file);
  } catch {
    toast('Bild konnte nicht geladen werden');
  } finally { b.close(); }
  buildSettings();
  relayout();
}

// ---------- Layout & Vorschau ----------

const relayoutSoon = debounce(() => relayout(), 150);

function relayout() {
  if ($('#view-write').hidden) return;
  tpl = buildTemplate(state.settings, state.backgrounds);
  const t0 = performance.now();
  layout = layoutText(state.text, state.glyphs, state.settings, tpl);
  const ms = performance.now() - t0;
  renderInfo(ms);
  syncCards();
  markAllDirty();
}

function renderInfo() {
  const miss = layout.missing.map(m => m[0]);
  const bar = $('#w-missing');
  bar.replaceChildren();
  if (!state.glyphs.size) {
    bar.append(el('p', { class: 'warn' }, 'Noch keine Zeichen erfasst – schreibe zuerst unter „Erfassen“ deine Handschrift.'));
  } else if (miss.length) {
    const known = new Set(allChars(state.extraChars));
    bar.append(el('span', { class: 'warn' }, 'Fehlende Zeichen (rot markiert):'),
      ...miss.map(ch => el('button', { class: 'chip', onclick: () => fixMissing(ch, known.has(ch)) }, ch)));
  }
  const noLines = !tpl.baselines.length;
  $('#w-info').textContent = noLines
    ? 'Keine Schreibzeilen – Ränder, Textfeld oder Linienabstand anpassen.'
    : `${layout.pages.length} ${layout.pages.length === 1 ? 'Seite' : 'Seiten'} · Großbuchstaben ≈ ${layout.fontSizeMM.toFixed(1).replace('.', ',')} mm`;
}

async function fixMissing(ch, known) {
  if (!known) {
    const ok = await dialog({ title: `„${ch}“ ist nicht im Zeichensatz`, text: 'Als eigenes Zeichen hinzufügen und jetzt schreiben?', buttons: [{ label: 'Hinzufügen', value: true, primary: true }, { label: 'Abbrechen', value: false }] });
    if (!ok) return;
    state.extraChars.push(ch);
    await store.set('extraChars', state.extraChars);
  }
  openChar(ch);
}

function syncCards() {
  const root = $('#w-pages');
  const n = layout.pages.length;
  while (pageCards.length > n) { const c = pageCards.pop(); io.unobserve(c.wrap); c.card.remove(); }
  while (pageCards.length < n) {
    const i = pageCards.length;
    const canvas = el('canvas', { class: 'page-canvas' });
    const wrap = el('div', { class: 'page-wrap' }, canvas);
    const card = el('div', { class: 'page-card' },
      el('div', { class: 'page-head' }, el('span', {}, `Seite ${i + 1}`),
        el('button', { class: 'btn small', onclick: () => exportPng(i) }, 'PNG')),
      wrap);
    const entry = { card, wrap, canvas, index: i, dirty: true, visible: false };
    wrap.__entry = entry;
    root.append(card);
    io.observe(wrap);
    pageCards.push(entry);
  }
  for (const c of pageCards) c.wrap.style.aspectRatio = `${tpl.widthMM} / ${tpl.heightMM}`;
  setupTextBox();
}

function markAllDirty() {
  for (const c of pageCards) c.dirty = true;
  scheduleDraw();
}

function onVisibility(entries) {
  for (const e of entries) {
    const c = e.target.__entry;
    c.visible = e.isIntersecting;
    if (!c.visible && c.canvas.width) { c.canvas.width = c.canvas.height = 0; c.dirty = true; } // Speicher freigeben
  }
  scheduleDraw();
}

let drawRaf = 0;
function scheduleDraw() {
  if (!drawRaf) drawRaf = requestAnimationFrame(drawNext);
}

/** Zeichnet sichtbare Seiten nacheinander, damit die Oberfläche flüssig bleibt. */
function drawNext() {
  drawRaf = 0;
  const c = pageCards.find(p => p.visible && p.dirty);
  if (!c || !layout) return;
  c.dirty = false;
  const cssW = c.wrap.clientWidth;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderToCanvas(c.canvas, tpl, layout.pages[c.index], state.settings, (cssW * dpr) / tpl.widthMM, true);
  scheduleDraw();
}

// ---------- Textfeld auf eigenem Hintergrund ----------

function setupTextBox() {
  const old = $('#textbox');
  if (old) old.remove();
  if (tpl.kind !== 'sheet' || !pageCards[0]) return;
  const b = state.settings.box;
  const box = el('div', { id: 'textbox', class: 'textbox' }, el('div', { class: 'tb-handle', 'aria-label': 'Größe ändern' }));
  const place = () => Object.assign(box.style, { left: b.x * 100 + '%', top: b.y * 100 + '%', width: b.w * 100 + '%', height: b.h * 100 + '%' });
  place();
  pageCards[0].wrap.append(box);

  let drag = null;
  box.addEventListener('pointerdown', e => {
    e.preventDefault();
    box.setPointerCapture(e.pointerId);
    const r = pageCards[0].wrap.getBoundingClientRect();
    drag = { id: e.pointerId, resize: e.target.classList.contains('tb-handle'), sx: e.clientX, sy: e.clientY, r, start: { ...b } };
    box.classList.add('active');
  });
  box.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = (e.clientX - drag.sx) / drag.r.width, dy = (e.clientY - drag.sy) / drag.r.height;
    const st = drag.start;
    if (drag.resize) {
      b.w = clamp(st.w + dx, 0.08, 1 - st.x);
      b.h = clamp(st.h + dy, 0.03, 1 - st.y);
    } else {
      b.x = clamp(st.x + dx, 0, 1 - st.w);
      b.y = clamp(st.y + dy, 0, 1 - st.h);
    }
    place();
  });
  const end = e => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    box.classList.remove('active');
    changed();
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
  box.addEventListener('lostpointercapture', end);
}

// ---------- Export ----------

async function pagePng(i) {
  const c = document.createElement('canvas');
  renderToCanvas(c, tpl, layout.pages[i], state.settings, EXPORT_DPI / 25.4, false);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  c.width = c.height = 0; // Speicher sofort freigeben (iPad)
  return new File([blob], `handschrift-seite-${i + 1}.png`, { type: 'image/png' });
}

async function exportPng(i) {
  if (!layout) return;
  const b = busy(`Seite ${i + 1} wird in ${EXPORT_DPI} dpi erzeugt …`);
  let file;
  try { file = await pagePng(i); } finally { b.close(); }
  await offerFiles([file], 'PNG fertig');
}

async function exportAllPng() {
  if (!layout) return;
  const b = busy('PNG-Dateien werden erzeugt …');
  const files = [];
  try {
    for (let i = 0; i < layout.pages.length; i++) {
      b.set(`Seite ${i + 1} von ${layout.pages.length} …`);
      files.push(await pagePng(i));
    }
  } finally { b.close(); }
  await offerFiles(files, `${files.length} PNG-Dateien fertig`);
}

async function exportPdf() {
  if (!layout) return;
  const b = busy('PDF wird erzeugt …');
  let file;
  try {
    const images = [];
    const pages = layout.pages.map(page => {
      const be = pdfBackend(tpl.heightMM, images);
      drawPage(be, tpl, page, state.settings, { k: EXPORT_DPI / 25.4, preview: false });
      return { widthMM: tpl.widthMM, heightMM: tpl.heightMM, ops: be.ops };
    });
    const blob = await buildPdf(pages, images);
    file = new File([blob], 'handschrift.pdf', { type: 'application/pdf' });
  } catch (e) {
    console.error(e);
    toast('PDF-Export fehlgeschlagen');
  } finally { b.close(); }
  if (file) await offerFiles([file], 'PDF fertig');
}

