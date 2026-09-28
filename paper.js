// Papier-Vorlagen: generiertes Linienpapier, Foto von Linienpapier, Bild mit Textfeld
import { LIMITS } from './layout.js';

export const A4 = { w: 210, h: 297 };

/**
 * Liefert die Seitenvorlage:
 * { widthMM, heightMM, Leff, left, right, baselines, rules, marginLines, image, box, guides }
 * baselines = Zeilen, auf die geschrieben wird; rules = Linien, die gezeichnet werden.
 */
export function buildTemplate(settings, backgrounds) {
  const n = Number(settings.lineEvery) || 1;
  const mode = settings.paperMode;

  if (mode === 'photo' && backgrounds.photo) {
    const { img, detect } = backgrounds.photo;
    const W = A4.w, H = A4.w * img.naturalHeight / img.naturalWidth;
    const k = W / img.naturalWidth;
    const lines = (detect && detect.lines.length >= 2) ? detect.lines.map(y => y * k) : [];
    const L = lines.length >= 2 ? median(diffs(lines)) : settings.lineSpacing;
    const shift = settings.photoShift || 0;
    const usable = lines.map(y => y + shift).filter(y => y - LIMITS.asc * L * n >= 0 && y + LIMITS.desc * L * n <= H);
    return {
      kind: 'photo', widthMM: W, heightMM: H, Leff: L * n,
      left: settings.marginLeft, right: W - settings.marginRight,
      baselines: usable.filter((_, i) => i % n === 0),
      rules: [], marginLines: [], image: img,
      guides: settings.showGuides ? lines.map(y => y + shift) : [],
    };
  }

  if (mode === 'sheet' && backgrounds.sheet) {
    const { img } = backgrounds.sheet;
    const W = A4.w, H = A4.w * img.naturalHeight / img.naturalWidth;
    const b = settings.box;
    const L = settings.lineSpacing * n;
    const top = b.y * H, bottom = (b.y + b.h) * H;
    const baselines = [];
    for (let y = top + LIMITS.asc * L; y + LIMITS.desc * L <= bottom + 1e-6; y += L) baselines.push(y);
    return {
      kind: 'sheet', widthMM: W, heightMM: H, Leff: L,
      left: b.x * W, right: (b.x + b.w) * W,
      baselines, rules: [], marginLines: [], image: img,
      box: { x: b.x * W, y: top, w: b.w * W, h: bottom - top },
      guides: settings.showGuides ? baselines : [],
    };
  }

  // Standard: A4 hochkant, liniert wie ein Schulheft
  const L = settings.lineSpacing;
  const rules = [];
  for (let y = settings.marginTop; y <= A4.h - settings.marginBottom + 1e-6; y += L) rules.push(y);
  const marginLines = [];
  let left = settings.marginLeft, right = A4.w - settings.marginRight;
  if (settings.marginLineLeft) { marginLines.push(settings.marginLeft); left += 2.5; }
  if (settings.marginLineRight) { marginLines.push(A4.w - settings.marginRight); right -= 2.5; }
  return {
    kind: 'lined', widthMM: A4.w, heightMM: A4.h, Leff: L * n,
    left, right, baselines: rules.filter((_, i) => i % n === 0),
    rules, marginLines, image: null, guides: [],
  };
}

const diffs = a => a.slice(1).map((v, i) => v - a[i]);
function median(a) {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

/**
 * Erkennt waagerechte Linien in einem Foto/Scan von liniertem Papier.
 * Idee: Helligkeitsprofil über die Zeilen → lokale Hochpass-Filterung →
 * Linienabstand per Autokorrelation → Maxima im passenden Raster.
 * Ergebnis in Pixeln des Originalbilds.
 */
export function detectLines(img) {
  const scale = Math.min(1, 1000 / img.naturalWidth);
  const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  const data = g.getImageData(0, 0, w, h).data;

  // Profil über die mittleren 70 % der Breite (Ränder sind oft Schatten)
  const x0 = Math.floor(w * 0.15), x1 = Math.ceil(w * 0.85);
  const prof = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      sum += 255 - (0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2]);
    }
    prof[y] = sum / (x1 - x0);
  }
  // Hochpass: Wert minus Mittel der Umgebung
  const hp = new Float32Array(h);
  const R = Math.max(4, Math.round(h / 150));
  for (let y = 0; y < h; y++) {
    let s = 0, n = 0;
    for (let d = -R * 2; d <= R * 2; d++) {
      if (Math.abs(d) <= 1) continue;
      const yy = y + d;
      if (yy >= 0 && yy < h) { s += prof[yy]; n++; }
    }
    hp[y] = Math.max(0, prof[y] - s / n);
  }
  // Linienabstand per Autokorrelation
  const minLag = Math.max(5, Math.round(h / 120)), maxLag = Math.round(h / 6);
  const ac = [];
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let y = 0; y + lag < h; y++) s += hp[y] * hp[y + lag];
    s /= (h - lag);
    ac[lag] = s;
    if (s > best) best = s;
  }
  let period = 0;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (ac[lag] >= 0.6 * best && ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1]) { period = lag; break; }
  }
  if (!period || best <= 0) return { lines: [], spacingPx: 0, ok: false };

  // Maxima suchen, mindestens 0,6 × Abstand voneinander entfernt
  const peaks = [];
  for (let y = 1; y < h - 1; y++) if (hp[y] > 0 && hp[y] >= hp[y - 1] && hp[y] >= hp[y + 1]) peaks.push(y);
  const strengths = peaks.map(y => hp[y]).sort((a, b) => b - a);
  const expected = Math.max(2, Math.floor(h / period));
  const ref = strengths[Math.min(strengths.length - 1, Math.floor(expected * 0.5))] || 0;
  const thr = ref * 0.35;
  const chosen = [];
  for (const y of peaks.filter(y => hp[y] >= thr).sort((a, b) => hp[b] - hp[a])) {
    if (chosen.every(c => Math.abs(c - y) >= period * 0.6)) chosen.push(y);
  }
  chosen.sort((a, b) => a - b);
  // Nur Linien, die zum Raster passen (Abstand ≈ Vielfaches von period)
  const lines = chosen.filter((y, i) => {
    const nb = [chosen[i - 1], chosen[i + 1]].filter(v => v != null).map(v => Math.abs(v - y) / period);
    return nb.some(r => Math.abs(r - Math.round(r)) < 0.2 && Math.round(r) >= 1);
  });
  // Subpixel-Verfeinerung (Parabel durch das Maximum)
  const refined = lines.map(y => {
    const a = hp[y - 1], b = hp[y], c2 = hp[y + 1];
    const den = a - 2 * b + c2;
    return y + (den ? 0.5 * (a - c2) / den : 0);
  });
  return { lines: refined.map(y => y / scale), spacingPx: period / scale, ok: refined.length >= 3 };
}
