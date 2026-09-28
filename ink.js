// Strichdarstellung (perfect-freehand) und Glyphen-Metriken
import { getStroke } from './perfect-freehand.js';

/**
 * Normiertes Koordinatensystem der Erfassung:
 * Grundlinie y = 0, Oberlänge/Großbuchstaben y = -1, Mittellinie (x-Höhe) y = -0.55,
 * Unterlänge y = +0.45. x ist in derselben Einheit, der Ursprung ist beliebig.
 * Punkte: [x, y, druck, zeitMs]
 */
export const GUIDE = { cap: -1, xh: -0.55, base: 0, desc: 0.45 };

const bboxCache = new WeakMap();

export function variantBBox(variant) {
  let b = bboxCache.get(variant);
  if (!b) {
    b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    for (const s of variant.strokes) for (const p of s) {
      if (p[0] < b.minX) b.minX = p[0];
      if (p[0] > b.maxX) b.maxX = p[0];
      if (p[1] < b.minY) b.minY = p[1];
      if (p[1] > b.maxY) b.maxY = p[1];
    }
    if (!isFinite(b.minX)) b.minX = b.maxX = b.minY = b.maxY = 0;
    bboxCache.set(variant, b);
  }
  return b;
}

/** Umriss eines Strichs; pts in Pixeln [x, y, druck], size = Strichdicke in Pixeln. */
export function strokeOutline(pts, size, thinning = 0.5, simulate = false) {
  return getStroke(pts, {
    size,
    thinning,
    smoothing: 0.5,
    streamline: 0.3,
    simulatePressure: simulate,
    last: true,
    start: { taper: 0, cap: true },
    end: { taper: 0, cap: true },
  });
}

export function fillOutline(ctx, outline) {
  if (outline.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) ctx.lineTo(outline[i][0], outline[i][1]);
  ctx.closePath();
  ctx.fill();
}

/** Zeichnet eine Variante in ein Rechteck (für Vorschaubilder). */
export function drawVariantFit(ctx, variant, x, y, w, h, color = '#1d2a55', strokePx = 2.2) {
  const b = variantBBox(variant);
  // Vertikal immer im Raster (Oberlänge bis Unterlänge), damit Größen vergleichbar bleiben
  const top = Math.min(GUIDE.cap - 0.15, b.minY), bottom = Math.max(GUIDE.desc + 0.1, b.maxY);
  const gw = Math.max(b.maxX - b.minX, 0.6);
  const k = Math.min(h / (bottom - top), w / (gw + 0.2));
  const ox = x + (w - (b.maxX - b.minX) * k) / 2 - b.minX * k;
  const oy = y + (h - (bottom - top) * k) / 2 - top * k;
  ctx.fillStyle = color;
  for (const s of variant.strokes) {
    const pts = s.map(p => [ox + p[0] * k, oy + p[1] * k, p[2]]);
    fillOutline(ctx, strokeOutline(pts, strokePx, 0.5));
  }
  return { k, oy };
}
