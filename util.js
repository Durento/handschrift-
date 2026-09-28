// Kleine Hilfsfunktionen: Zufall, Entprellen, Dialoge, Dateiausgabe

/** Deterministischer Hash aus beliebig vielen Zahlen/Strings. */
export function hash(...parts) {
  let h = 2166136261 >>> 0;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 0x9e3779b9;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Seedbarer Zufallsgenerator (mulberry32), liefert Zahlen in [0, 1). */
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Werte in [-1, 1], zur Mitte hin gewichtet (wirkt natürlicher als gleichverteilt)
  next.signed = () => (next() + next() + next()) / 1.5 - 1;
  return next;
}

export function debounce(fn, ms) {
  let t = 0;
  const d = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  d.flush = (...args) => { clearTimeout(t); fn(...args); };
  return d;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** Modaler Dialog mit frei wählbaren Buttons. Liefert den value des gedrückten Buttons. */
export function dialog({ title, text = '', body = null, buttons = [{ label: 'OK', value: true, primary: true }] }) {
  return new Promise(resolve => {
    const close = value => { overlay.remove(); resolve(value); };
    const overlay = el('div', { class: 'modal-overlay' },
      el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
        el('h2', {}, title),
        text ? el('p', {}, text) : null,
        body,
        el('div', { class: 'modal-buttons' },
          buttons.map(b => el('button', { class: b.primary ? 'btn primary' : b.danger ? 'btn danger' : 'btn', onclick: () => close(b.value) }, b.label)))));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(undefined); });
    document.body.append(overlay);
  });
}

export function toast(msg, ms = 2200) {
  const t = el('div', { class: 'toast' }, msg);
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
}

export function busy(msg) {
  const o = el('div', { class: 'modal-overlay busy' }, el('div', { class: 'modal' }, el('div', { class: 'spinner' }), el('p', {}, msg)));
  document.body.append(o);
  return { set: m => { o.querySelector('p').textContent = m; }, close: () => o.remove() };
}

function download(file) {
  const url = URL.createObjectURL(file);
  const a = el('a', { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/**
 * Bietet fertige Dateien an. Auf dem iPad ist "Teilen" der zuverlässige Weg
 * (In Dateien sichern / Bild sichern). Weil das Teilen-Menü eine frische
 * Nutzer-Geste braucht, fragen wir erst nach, wenn die Dateien fertig sind.
 */
export async function offerFiles(files, title = 'Export fertig') {
  const canShare = !!(navigator.canShare && navigator.canShare({ files }));
  const names = files.map(f => f.name).join(', ');
  const size = files.reduce((s, f) => s + f.size, 0);
  const sizeText = size > 1e6 ? (size / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(size / 1e3)) + ' kB';
  const buttons = [];
  if (canShare) buttons.push({ label: 'Teilen / Sichern', value: 'share', primary: true });
  buttons.push({ label: 'Herunterladen', value: 'download', primary: !canShare });
  buttons.push({ label: 'Abbrechen', value: null });
  const choice = await dialog({ title, text: `${names} (${sizeText})`, buttons });
  if (choice === 'share') {
    try {
      await navigator.share({ files });
    } catch (e) {
      if (e.name !== 'AbortError') files.forEach(download);
    }
  } else if (choice === 'download') {
    files.forEach(download);
  }
}

export function pickFile(accept) {
  return new Promise(resolve => {
    const input = el('input', { type: 'file', accept, style: 'display:none' });
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

export function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
