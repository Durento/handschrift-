// Zeichnet Seiten – auf Canvas (Vorschau, PNG) oder als Vektoren (PDF)
import { strokeOutline } from './ink.js';
import { absPoint } from './layout.js';

/**
 * Zeichnet eine Seite über ein "Backend" in Millimeter-Koordinaten.
 * k = Pixel pro mm, in denen die Strichumrisse berechnet werden (Detailgrad).
 */
export function drawPage(be, tpl, page, settings, { k, preview = false } = {}) {
  const W = tpl.widthMM, H = tpl.heightMM;
  if (tpl.image) be.image(tpl.image, 0, 0, W, H);
  else be.rect(0, 0, W, H, settings.paperColor);

  for (const y of tpl.rules) be.line(0, y, W, y, 0.22, settings.lineColor);
  for (const x of tpl.marginLines) be.line(x, 0, x, H, 0.3, '#e6a3a3');
  if (preview) {
    for (const y of tpl.guides) be.line(tpl.box ? tpl.box.x : 0, y, tpl.box ? tpl.box.x + tpl.box.w : W, y, 0.25, 'rgba(40,120,255,0.55)', true);
  }

  const size = settings.strokeWidth * k;
  const thinning = settings.thinning;
  for (const line of page.lines) {
    for (const g of line.glyphs) {
      const it = g.item;
      if (it.kind === 'ink') {
        for (const st of it.strokes) {
          const pts = st.map(p => {
            const [x, y] = absPoint(line, g, p);
            return [x * k, y * k, p[2]];
          });
          const outline = strokeOutline(pts, size, thinning);
          be.poly(outline.map(q => [q[0] / k, q[1] / k]), settings.inkColor);
        }
      } else if (it.kind === 'missing' && preview) { // Markierung nur in der Vorschau, im Export bleibt eine Lücke
        const [x, y] = absPoint(line, g, [0, it.top]);
        be.missing(x, y, it.w, it.bottom - it.top);
      }
    }
  }
}

/** Canvas-Backend. Der Kontext ist so skaliert, dass 1 Einheit = 1 mm ist. */
export function canvasBackend(ctx) {
  return {
    rect(x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); },
    image(img, x, y, w, h) { ctx.drawImage(img, x, y, w, h); },
    line(x1, y1, x2, y2, width, color, dashed = false) {
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = width;
      if (dashed) ctx.setLineDash([2, 1.5]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.restore();
    },
    poly(pts, color) {
      if (pts.length < 2) return;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fill();
    },
    missing(x, y, w, h) {
      ctx.save();
      ctx.fillStyle = 'rgba(230,40,40,0.12)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#e02828'; ctx.lineWidth = 0.3; ctx.setLineDash([0.8, 0.6]);
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    },
  };
}

/** Rendert eine Seite in ein Canvas mit pxPerMM Auflösung. */
export function renderToCanvas(canvas, tpl, page, settings, pxPerMM, preview) {
  canvas.width = Math.round(tpl.widthMM * pxPerMM);
  canvas.height = Math.round(tpl.heightMM * pxPerMM);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(pxPerMM, 0, 0, pxPerMM, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  drawPage(canvasBackend(ctx), tpl, page, settings, { k: Math.max(pxPerMM, 8), preview });
  return canvas;
}
