// Einstieg: Ansichten umschalten, Daten laden, Offline-Unterstützung
import { loadState } from './state.js';
import { requestPersistence } from './store.js';
import { initCapture, onShowCapture, showChar } from './capture.js';
import { initOverview, render as renderOverview } from './overview.js';
import { initWrite, onShowWrite } from './write.js';
import { $, $$ } from './util.js';

const VIEWS = {
  capture: onShowCapture,
  overview: renderOverview,
  write: onShowWrite,
};

function show(name) {
  for (const v of Object.keys(VIEWS)) {
    $('#view-' + v).hidden = v !== name;
    $(`.tab[data-view="${v}"]`).classList.toggle('on', v === name);
  }
  document.body.dataset.view = name;
  VIEWS[name]();
  try { localStorage.setItem('view', name); } catch { /* egal */ }
}

async function openChar(key) {
  show('capture');
  await showChar(key);
}

async function main() {
  // Pinch-Zoom und Doppeltipp-Zoom in der Web-App unterdrücken
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('dblclick', e => e.preventDefault());

  await loadState();
  initCapture();
  initOverview(openChar);
  initWrite(openChar);
  for (const t of $$('.tab')) t.addEventListener('click', () => show(t.dataset.view));
  let start = 'capture';
  try { start = localStorage.getItem('view') || start; } catch { /* egal */ }
  show(VIEWS[start] ? start : 'capture');
  document.body.classList.remove('loading');
  requestPersistence();

  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

main().catch(err => {
  console.error(err);
  document.body.classList.remove('loading');
  document.body.insertAdjacentHTML('afterbegin', `<div class="fatal">Die App konnte nicht starten: ${String(err && err.message || err)}</div>`);
});
