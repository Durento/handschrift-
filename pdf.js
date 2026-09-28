// Minimaler PDF-Erzeuger: Handschrift als Vektorflächen, Hintergrundbilder als JPEG.

const PT = 72 / 25.4;
const enc = new TextEncoder();
const num = v => (Math.round(v * 100) / 100).toString();

function rgb(color) {
  const m = /^#?([0-9a-f]{6})$/i.exec(color || '');
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => num(v / 255)).join(' ');
}

/** Backend für drawPage(): sammelt PDF-Zeichenbefehle einer Seite. */
export function pdfBackend(heightMM, images) {
  const ops = [];
  const X = x => num(x * PT), Y = y => num((heightMM - y) * PT);
  return {
    ops,
    rect(x, y, w, h, color) { ops.push(`${rgb(color)} rg ${X(x)} ${Y(y + h)} ${num(w * PT)} ${num(h * PT)} re f`); },
    image(img, x, y, w, h) {
      let id = images.indexOf(img);
      if (id < 0) { images.push(img); id = images.length - 1; }
      ops.push(`q ${num(w * PT)} 0 0 ${num(h * PT)} ${X(x)} ${Y(y + h)} cm /Im${id} Do Q`);
    },
    line(x1, y1, x2, y2, width, color) {
      ops.push(`q ${rgb(color)} RG ${num(width * PT)} w ${X(x1)} ${Y(y1)} m ${X(x2)} ${Y(y2)} l S Q`);
    },
    poly(pts, color) {
      if (pts.length < 2) return;
      let s = `${rgb(color)} rg ${X(pts[0][0])} ${Y(pts[0][1])} m`;
      for (let i = 1; i < pts.length; i++) s += ` ${X(pts[i][0])} ${Y(pts[i][1])} l`;
      ops.push(s + ' h f');
    },
    missing() { /* im Export nicht markiert */ },
  };
}

async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const cs = new CompressionStream('deflate');
    const stream = new Blob([bytes]).stream().pipeThrough(cs);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch { return null; }
}

async function toJpeg(img) {
  const maxW = 2480;
  const s = Math.min(1, maxW / img.naturalWidth);
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s);
  c.height = Math.round(img.naturalHeight * s);
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  c.width = c.height = 0;
  return { bytes, w: Math.round(img.naturalWidth * s), h: Math.round(img.naturalHeight * s) };
}

/**
 * pages: [{ widthMM, heightMM, ops: [...] }], images: [HTMLImageElement]
 * Liefert ein Blob (application/pdf).
 */
export async function buildPdf(pages, images) {
  const chunks = [];
  const offsets = [];
  let pos = 0;
  const push = b => { const u = typeof b === 'string' ? enc.encode(b) : b; chunks.push(u); pos += u.length; };
  const nPages = pages.length;
  // Objektnummern: 1 Katalog, 2 Seitenbaum, dann je Seite (Page, Content), dann Bilder
  const pageObj = i => 3 + i * 2;
  const contentObj = i => 4 + i * 2;
  const imageObj = i => 3 + nPages * 2 + i;
  const total = 2 + nPages * 2 + images.length;
  const begin = n => { offsets[n] = pos; push(`${n} 0 obj\n`); };
  const end = () => push('\nendobj\n');

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  begin(1); push('<< /Type /Catalog /Pages 2 0 R >>'); end();
  begin(2); push(`<< /Type /Pages /Count ${nPages} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] >>`); end();

  const xobj = images.length ? `/XObject << ${images.map((_, i) => `/Im${i} ${imageObj(i)} 0 R`).join(' ')} >>` : '';
  for (let i = 0; i < nPages; i++) {
    const p = pages[i];
    begin(pageObj(i));
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(p.widthMM * PT)} ${num(p.heightMM * PT)}] /Resources << ${xobj} >> /Contents ${contentObj(i)} 0 R >>`);
    end();
    const raw = enc.encode(p.ops.join('\n'));
    const z = await deflate(raw);
    begin(contentObj(i));
    push(`<< /Length ${(z || raw).length}${z ? ' /Filter /FlateDecode' : ''} >>\nstream\n`);
    push(z || raw);
    push('\nendstream');
    end();
  }
  for (let i = 0; i < images.length; i++) {
    const { bytes, w, h } = await toJpeg(images[i]);
    begin(imageObj(i));
    push(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`);
    push(bytes);
    push('\nendstream');
    end();
  }
  const xref = pos;
  let x = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= total; n++) x += String(offsets[n]).padStart(10, '0') + ' 00000 n \n';
  push(x);
  push(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}
