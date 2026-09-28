// Teil 1: Handschrift Zeichen für Zeichen erfassen
import { state, saveGlyph, saveSettings, compactStrokes, on } from './state.js';
import { allChars, groupOf, displayName, MAX_VARIANTS } from './charset.js';
import { GUIDE, strokeOutline, fillOutline, drawVariantFit } from './ink.js';
import { $, el, dialog, toast } from './util.js';

// Sichtbarer Bereich der Schreibfläche in Glyphen-Einheiten (oben/unten)
const VIEW_TOP = -1.45, VIEW_BOTTOM = 0.85;

let pad, ctx, dpr = 1, U = 200, baseY = 0, cssW = 0, cssH = 0;
let strokes = [];      // aktuelle, noch nicht gespeicherte Striche
let active = null;     // gerade gezeichneter Strich
let t0 = 0;            // Zeitbezug des aktuellen Zeichens
let index = 0;         // Position im Zeichensatz
let raf = 0;

const chars = () => allChars(state.extraChars);
const current = () => chars()[index];
const variantsOf = key => (state.glyphs.get(key)?.variants) || [];

export function initCapture() {
  pad = $('#pad');
  ctx = pad.getContext('2d');
  new ResizeObserver(resize).observe(pad.parentElement);

  pad.addEventListener('pointerdown', down);
  pad.addEventListener('pointermove', move);
  pad.addEventListener('pointerup', up);
  pad.addEventListener('pointercancel', up);
  // Kein Scrollen/Zoomen/Lupe auf der Schreibfläche (iPadOS)
  for (const t of ['touchstart', 'touchmove']) pad.addEventListener(t, e => e.preventDefault(), { passive: false });

  $('#cap-undo').onclick = () => { strokes.pop(); redraw(); updateButtons(); };
  $('#cap-clear').onclick = () => { strokes = []; redraw(); updateButtons(); };
  $('#cap-variant').onclick = () => commit(false);
  $('#cap-next').onclick = () => commit(true);
  $('#cap-prev').onclick = () => go(index - 1);
  $('#cap-missing').onclick = () => {
    const list = chars();
    for (let i = 1; i <= list.length; i++) {
      const j = (index + i) % list.length;
      if (!variantsOf(list[j]).length) return go(j);
    }
    toast('Alle Zeichen sind erfasst 🎉');
  };
  const pen = $('#cap-penonly');
  pen.checked = state.settings.penOnly;
  pen.onchange = () => { state.settings.penOnly = pen.checked; saveSettings(); };

  on('glyphs', () => { if (!$('#view-capture').hidden) renderHeader(); });
  const first = chars().findIndex(c => !variantsOf(c).length);
  index = Math.max(0, first);
  renderHeader();
}

/** Springt zu einem bestimmten Zeichen (z. B. aus der Übersicht). */
export async function showChar(key) {
  const i = chars().indexOf(key);
  if (i >= 0) await go(i, true);
}

export function onShowCapture() {
  resize();
  renderHeader();
}

async function go(i, force = false) {
  const list = chars();
  i = (i + list.length) % list.length;
  if (strokes.length && !force) {
    const ok = await dialog({
      title: 'Ungespeichertes Zeichen',
      text: 'Das gerade geschriebene Zeichen wurde noch nicht gespeichert. Verwerfen?',
      buttons: [{ label: 'Verwerfen', value: true, danger: true }, { label: 'Abbrechen', value: false, primary: true }],
    });
    if (!ok) return;
  }
  index = i;
  strokes = [];
  redraw();
  renderHeader();
}

/** Speichert die aktuelle Zeichnung als Variante. next=true: danach zum nächsten Zeichen. */
async function commit(next) {
  const key = current();
  if (strokes.length) {
    let rec = state.glyphs.get(key);
    if (!rec) { rec = { key, variants: [] }; state.glyphs.set(key, rec); }
    if (rec.variants.length >= MAX_VARIANTS) {
      const r = await dialog({
        title: `Schon ${MAX_VARIANTS} Varianten`,
        text: 'Soll die älteste Variante ersetzt werden?',
        buttons: [{ label: 'Älteste ersetzen', value: true, primary: true }, { label: 'Abbrechen', value: false }],
      });
      if (!r) return;
      rec.variants.shift();
    }
    rec.variants.push({ strokes: compactStrokes(strokes), created: Date.now() });
    strokes = [];
    await saveGlyph(key);
  } else if (!next) {
    toast('Erst ein Zeichen schreiben');
    return;
  }
  if (next) index = (index + 1) % chars().length;
  redraw();
  renderHeader();
}

function renderHeader() {
  const list = chars();
  const key = current();
  const vs = variantsOf(key);
  $('#cap-char').textContent = key;
  $('#cap-char').classList.toggle('long', key.length > 1);
  const name = displayName(key);
  const done = list.filter(c => variantsOf(c).length).length;
  $('#cap-meta').textContent = `${groupOf(key, state.extraChars)}${name ? ' · ' + name : ''} · Zeichen ${index + 1} von ${list.length} · ${done} erfasst`;
  $('#cap-hint').textContent = vs.length >= MAX_VARIANTS
    ? `${MAX_VARIANTS} Varianten gespeichert – "Weiter" oder eine Variante löschen`
    : vs.length ? `Variante ${vs.length + 1} von ${MAX_VARIANTS} schreiben (optional)` : (key.length > 1 ? 'Die Kombination zusammenhängend schreiben' : 'Auf die Grundlinie schreiben');

  const box = $('#cap-variants');
  box.replaceChildren();
  vs.forEach((v, i) => {
    const c = el('canvas', { width: 120, height: 120, class: 'thumb' });
    const g = c.getContext('2d');
    drawVariantFit(g, v, 6, 6, 108, 108, '#1d2a55', 4);
    box.append(el('div', { class: 'variant' }, c,
      el('button', { class: 'variant-del', 'aria-label': `Variante ${i + 1} löschen`, onclick: () => deleteVariant(key, i) }, '×')));
  });
  updateButtons();
}

async function deleteVariant(key, i) {
  const ok = await dialog({ title: 'Variante löschen?', buttons: [{ label: 'Löschen', value: true, danger: true }, { label: 'Abbrechen', value: false, primary: true }] });
  if (!ok) return;
  const rec = state.glyphs.get(key);
  rec.variants.splice(i, 1);
  await saveGlyph(key);
  renderHeader();
}

function updateButtons() {
  const has = strokes.length > 0;
  $('#cap-undo').disabled = !has;
  $('#cap-clear').disabled = !has;
  $('#cap-variant').disabled = !has;
  $('#cap-next').textContent = has ? 'Speichern & weiter →' : 'Weiter →';
}

function resize() {
  const wrap = pad.parentElement;
  cssW = wrap.clientWidth; cssH = wrap.clientHeight;
  if (!cssW || !cssH) return;
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  pad.width = Math.round(cssW * dpr);
  pad.height = Math.round(cssH * dpr);
  pad.style.width = cssW + 'px';
  pad.style.height = cssH + 'px';
  U = Math.min(cssH / (VIEW_BOTTOM - VIEW_TOP), 300, cssW / 3);
  baseY = (cssH - (VIEW_BOTTOM - VIEW_TOP) * U) / 2 - VIEW_TOP * U;
  redraw();
}

function accept(e) {
  if (e.pointerType === 'pen') return true;
  return !state.settings.penOnly && (e.pointerType === 'mouse' || e.pointerType === 'touch');
}

function toPoint(e) {
  const r = pad.getBoundingClientRect();
  const p = e.pointerType === 'pen' ? Math.max(0.05, Math.min(1, e.pressure || 0.05)) : 0.5;
  return [(e.clientX - r.left) / U, (e.clientY - r.top - baseY) / U, p, e.timeStamp - t0];
}

function down(e) {
  if (!accept(e) || active) return;
  e.preventDefault();
  pad.setPointerCapture(e.pointerId);
  if (!strokes.length) t0 = e.timeStamp;
  active = { id: e.pointerId, pts: [toPoint(e)] };
  schedule();
}

function move(e) {
  if (!active || e.pointerId !== active.id) return;
  e.preventDefault();
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of (evs.length ? evs : [e])) active.pts.push(toPoint(ev));
  schedule();
}

function up(e) {
  if (!active || e.pointerId !== active.id) return;
  if (e.type === 'pointerup') active.pts.push(toPoint(e));
  strokes.push(active.pts);
  active = null;
  schedule();
  updateButtons();
}

function schedule() {
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; redraw(); });
}

function guide(y, color, width, dash, label) {
  const Y = baseY + y * U;
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath(); ctx.moveTo(0, Y); ctx.lineTo(cssW, Y); ctx.stroke();
  ctx.fillStyle = color; ctx.font = '13px -apple-system, system-ui, sans-serif';
  ctx.fillText(label, 10, Y - 6);
  ctx.restore();
}

function redraw() {
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  // Bereich zwischen Mittellinie und Grundlinie leicht hinterlegen
  ctx.fillStyle = 'rgba(80,130,255,0.06)';
  ctx.fillRect(0, baseY + GUIDE.xh * U, cssW, -GUIDE.xh * U);
  guide(GUIDE.cap, '#9aa3b5', 1.5, [], 'Oberlänge / Großbuchstaben');
  guide(GUIDE.xh, '#5b8def', 1.5, [8, 6], 'Mittellinie (x-Höhe)');
  guide(GUIDE.base, '#2b3550', 2.5, [], 'Grundlinie');
  guide(GUIDE.desc, '#9aa3b5', 1.5, [], 'Unterlänge');

  ctx.fillStyle = '#1d2a55';
  const size = U * 0.06;
  const all = active ? [...strokes, active.pts] : strokes;
  for (const s of all) {
    const pts = s.map(p => [p[0] * U, baseY + p[1] * U, p[2]]);
    fillOutline(ctx, strokeOutline(pts, size, 0.5));
  }
}
