// Satz-Engine: Text zerlegen, Zeichen platzieren, Zeilen umbrechen, Seiten füllen.
// Reine Logik ohne DOM, damit sie sich auch außerhalb des Browsers testen lässt.
import Hypher from './hypher.js';
import patternsDe from './hyphenation-de.js';
import { hash, rng } from './util.js';
import { variantBBox } from './ink.js';
import { normalizeText } from './charset.js';

const hyphenator = new Hypher(patternsDe);
const DEG = Math.PI / 180;

/**
 * Vertikale Grenzen relativ zum effektiven Zeilenabstand Leff:
 * Nichts ragt höher als asc·Leff über die Grundlinie oder tiefer als desc·Leff darunter.
 * asc + desc < 1 → Zeichen benachbarter Zeilen können sich nie berühren,
 * auch nicht, wenn eine Zeile leicht steigt und die nächste fällt (drift).
 */
export const LIMITS = { asc: 0.64, desc: 0.28, drift: 0.022, sizeBase: 0.6, xJitter: 0.8 };

// Wörter, die nur aus schließenden Satzzeichen bestehen, hängen am vorherigen Wort
const CLOSING_ONLY = /^[.,;:!?)\]“'–…]+$/;
const OPENING_ONLY = /^[„(\[]+$/;
const NBSP = ' ';
const isLetter = c => /\p{L}/u.test(c);
const isAlnum = c => /[\p{L}\p{N}]/u.test(c);
const isPunct = c => /[.,;:!?)\]“'–…]/.test(c);

// Ersatz-Bindestrich, falls "-" noch nicht erfasst ist (nur für automatische Trennung)
const SYNTH_HYPHEN = { strokes: [[[0, -0.42, 0.5], [0.12, -0.425, 0.55], [0.24, -0.43, 0.55], [0.34, -0.435, 0.5]]] };

/** Zerlegt eingefügten Text in Absätze aus Wörtern. Leere Zeilen bleiben erhalten. */
export function parseParagraphs(text) {
  return normalizeText(text).split('\n').map(line => {
    const words = [];
    let open = '';
    for (const tok of line.split(' ').filter(Boolean)) {
      if (OPENING_ONLY.test(tok)) { open += (open ? NBSP : '') + tok; continue; }
      if (words.length && !open && CLOSING_ONLY.test(tok)) { words[words.length - 1] += NBSP + tok; continue; }
      words.push(open ? open + NBSP + tok : tok);
      open = '';
    }
    if (open) words.push(open);
    return words;
  });
}

/** Mögliche Trennstellen eines Wortes: {i, hyphen} – i = Index des ersten Zeichens danach. */
export function breakPoints(chars) {
  const bps = [];
  const n = chars.length;
  for (let i = 1; i < n - 1; i++) {
    if ((chars[i] === '-' || chars[i] === '/' || chars[i] === '–') && isAlnum(chars[i - 1]) && isAlnum(chars[i + 1])) {
      bps.push({ i: i + 1, hyphen: false });
    }
  }
  let i = 0;
  while (i < n) {
    if (!isLetter(chars[i])) { i++; continue; }
    let j = i;
    while (j < n && isLetter(chars[j])) j++;
    if (j - i >= 4) {
      const parts = hyphenator.hyphenate(chars.slice(i, j).join(''));
      let pos = i;
      for (let k = 0; k < parts.length - 1; k++) {
        pos += Array.from(parts[k]).length;
        bps.push({ i: pos, hyphen: true });
      }
    }
    i = j;
  }
  return bps.sort((a, b) => a.i - b.i);
}

/** Längste Übereinstimmung zuerst (sch vor ch vor c). */
export function tokenize(chars, keys, maxLen, offset = 0) {
  const out = [];
  let i = 0;
  while (i < chars.length) {
    const c = chars[i];
    if (c === NBSP || c === ' ') { out.push({ type: 'space', idx: offset + i }); i++; continue; }
    let hit = null;
    for (let len = Math.min(maxLen, chars.length - i); len >= 1; len--) {
      const sub = chars.slice(i, i + len).join('');
      if (keys.has(sub)) { hit = sub; break; }
    }
    if (hit) { out.push({ type: 'glyph', key: hit, idx: offset + i }); i += Array.from(hit).length; }
    else { out.push({ type: 'missing', ch: c, idx: offset + i }); i++; }
  }
  return out;
}

function makeContext(glyphs, settings, template) {
  const Leff = template.Leff;
  const available = new Map();
  for (const [k, g] of glyphs) if (g.variants && g.variants.length) available.set(k, g.variants);
  let maxLen = 1;
  for (const k of available.keys()) maxLen = Math.max(maxLen, Array.from(k).length);
  const s = (settings.fontSize / 100) * LIMITS.sizeBase * Leff;
  // Halbe Strichbreite (bei vollem Druck) – die Tinte ragt so weit über die Mittellinie des Strichs hinaus
  const pad = (settings.strokeWidth || 0) * (0.5 + 0.5 * (settings.thinning ?? 0.5));
  return {
    glyphs: available, keys: new Set(available.keys()), maxLen, Leff, s,
    r: settings.randomness / 100,
    seed: settings.seed,
    slant: settings.slant,
    letterGap: settings.letterSpacing * s,
    wordSpace: settings.wordSpacing * s,
    hyphenMode: settings.hyphenMode,
    ascMax: (LIMITS.asc - LIMITS.drift) * Leff - pad,
    descMax: (LIMITS.desc - LIMITS.drift) * Leff - pad,
    left: template.left + pad,
    lineWidth: template.right - template.left - LIMITS.xJitter - 2 * pad,
    cache: new Map(),
    missing: new Map(),
  };
}

/** Platziert eine Glyphen-Variante mit zufälliger Größe, Drehung, Höhe und Neigung. */
function shapeGlyph(variant, R, ctx) {
  const { s, r } = ctx;
  const k = s * (1 + r * 0.07 * R.signed());
  const rot = r * 3.5 * DEG * R.signed();
  const dy = r * 0.035 * s * R.signed();
  const sl = Math.tan((ctx.slant + r * 1.5 * R.signed()) * DEG);
  const gap = ctx.letterGap + r * 0.06 * s * R.signed();
  const b = variantBBox(variant);
  const cx = (b.maxX - b.minX) * k / 2, cy = -0.35 * k;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const strokes = variant.strokes.map(st => st.map(p => {
    let X = (p[0] - b.minX) * k, Y = p[1] * k;
    X -= Y * sl;
    const ddx = X - cx, ddy = Y - cy;
    X = cx + ddx * cos - ddy * sin;
    Y = cy + ddx * sin + ddy * cos + dy;
    if (X < minX) minX = X; if (X > maxX) maxX = X;
    if (Y < minY) minY = Y; if (Y > maxY) maxY = Y;
    return [X, Y, p[2]];
  }));
  if (!isFinite(minX)) return { kind: 'space', w: 0, gap: 0 };
  // Sicherheitsbegrenzung: zu hohe/tiefe Zeichen werden um die Grundlinie herum verkleinert
  let f = 1;
  if (-minY > ctx.ascMax) f = Math.min(f, ctx.ascMax / -minY);
  if (maxY > ctx.descMax) f = Math.min(f, ctx.descMax / maxY);
  for (const st of strokes) for (const p of st) {
    p[0] = (p[0] - minX) * f;
    p[1] *= f;
  }
  return { kind: 'ink', strokes, w: (maxX - minX) * f, top: minY * f, bottom: maxY * f, gap };
}

function shapeToken(tok, seed, ctx) {
  const item = shapeTokenInner(tok, seed, ctx);
  item.key = tok.type === 'hyphen' ? '-' : (tok.key || tok.ch || ' ');
  return item;
}

function shapeTokenInner(tok, seed, ctx) {
  const R = rng(hash(seed, tok.idx, tok.key || tok.ch || tok.type));
  if (tok.type === 'space') return { kind: 'space', w: ctx.wordSpace * (1 + ctx.r * 0.15 * R.signed()), gap: 0 };
  if (tok.type === 'hyphen') {
    const vs = ctx.glyphs.get('-');
    return shapeGlyph(vs ? vs[Math.floor(R() * vs.length)] : SYNTH_HYPHEN, R, ctx);
  }
  if (tok.type === 'missing') {
    ctx.missing.set(tok.ch, (ctx.missing.get(tok.ch) || 0) + 1);
    return { kind: 'missing', ch: tok.ch, w: 0.5 * ctx.s, top: -0.75 * ctx.s, bottom: 0.05 * ctx.s, gap: ctx.letterGap };
  }
  const vs = ctx.glyphs.get(tok.key);
  return shapeGlyph(vs[Math.floor(R() * vs.length)], R, ctx);
}

/** Setzt einen Wortteil chars[start, end) (optional mit Trennstrich) und misst seine Breite. */
function shapeWord(word, start, end, hyphen, ctx) {
  const key = `${word.seed}|${start}|${end}|${hyphen ? 1 : 0}`;
  let res = ctx.cache.get(key);
  if (res) return res;
  const toks = tokenize(word.chars.slice(start, end), ctx.keys, ctx.maxLen, start);
  if (hyphen) toks.push({ type: 'hyphen', idx: end });
  const placed = [];
  let x = 0, prevGap = 0;
  toks.forEach((t, i) => {
    const item = shapeToken(t, word.seed, ctx);
    if (i > 0) x += prevGap;
    placed.push({ item, x });
    x += item.w;
    prevGap = item.gap;
  });
  res = { placed, width: x };
  ctx.cache.set(key, res);
  return res;
}

function spaceWidth(word, ctx) {
  const R = rng(hash(word.seed, 'space'));
  return ctx.wordSpace * (1 + ctx.r * 0.15 * R.signed());
}

/** Zeilenumbruch nach ganzen Wörtern, bei Bedarf mit deutscher Silbentrennung. */
function breakParagraph(words, pIdx, ctx) {
  const W = ctx.lineWidth;
  const lines = [];
  let cur = [], curW = 0;
  const flush = () => { lines.push({ parts: cur, width: curW }); cur = []; curW = 0; };
  const put = (shaped, space) => { cur.push({ shaped, space }); curW += space + shaped.width; };
  const queue = words.map((w, wi) => ({ chars: Array.from(w), start: 0, seed: hash(ctx.seed, pIdx, wi, w), bps: null }));

  while (queue.length) {
    const w = queue.shift();
    const n = w.chars.length;
    const full = shapeWord(w, w.start, n, false, ctx);
    const space = cur.length ? spaceWidth(w, ctx) : 0;
    if (curW + space + full.width <= W) { put(full, space); continue; }

    const remaining = W - curW - space;
    const tooLong = full.width > W;
    const allow = tooLong || ctx.hyphenMode === 'max' || (ctx.hyphenMode === 'normal' && remaining > W * 0.18);
    let done = false;
    if (allow && remaining > ctx.s * 1.2) {
      if (!w.bps) w.bps = breakPoints(w.chars);
      const cands = w.bps.filter(b => b.i - w.start >= 2 && b.i <= n - 2);
      for (let c = cands.length - 1; c >= 0; c--) {
        const b = cands[c];
        const pre = shapeWord(w, w.start, b.i, b.hyphen, ctx);
        if (pre.width <= remaining) {
          put(pre, space);
          flush();
          queue.unshift({ ...w, start: b.i });
          done = true;
          break;
        }
      }
    }
    if (done) continue;
    if (cur.length) { flush(); queue.unshift(w); continue; }

    // Leere Zeile und das Wort passt trotzdem nicht: notfalls zwischen zwei Zeichen trennen
    let best = w.start + 1;
    for (let i = n - 1; i > w.start + 1; i--) {
      if (isPunct(w.chars[i])) continue; // nächste Zeile nie mit Satzzeichen beginnen
      if (shapeWord(w, w.start, i, true, ctx).width <= W) { best = i; break; }
    }
    put(shapeWord(w, w.start, best, true, ctx), 0);
    flush();
    queue.unshift({ ...w, start: best });
  }
  if (cur.length) flush();
  return lines;
}

/** Legt x-Positionen, leichten Zeilenanstieg und Startversatz einer Zeile fest. */
function composeLine(line, seed, ctx) {
  const R = rng(seed);
  const x0 = ctx.left + Math.abs(R.signed()) * ctx.r * LIMITS.xJitter;
  const slope = (ctx.r * LIMITS.drift * 0.95 * ctx.Leff / Math.max(ctx.lineWidth, 1)) * R.signed();
  const glyphs = [];
  let x = 0;
  for (const part of line.parts) {
    x += part.space;
    for (const p of part.shaped.placed) if (p.item.kind !== 'space') glyphs.push({ item: p.item, x: x + p.x });
    x += part.shaped.width;
  }
  return { x0, slope, width: line.width, glyphs };
}

/**
 * Hauptfunktion.
 * template: { Leff, left, right, baselines: [y in mm] }
 * Rückgabe: { pages: [{ lines: [{ baseline, x0, slope, glyphs }] }], missing: [[zeichen, anzahl]] }
 */
export function layoutText(text, glyphs, settings, template) {
  const ctx = makeContext(glyphs, settings, template);
  const paras = parseParagraphs(text).map((words, pi) => {
    if (!words.length) return { blank: true, lines: [{ blank: true }] };
    return { lines: breakParagraph(words, pi, ctx), text: words.join(' ') };
  });
  paras.forEach((p, i) => {
    if (p.blank || p.lines.length !== 1) return;
    const next = paras.slice(i + 1).find(q => !q.blank);
    p.heading = !!next && p.text.length <= 70 && !/[.,;]$/.test(p.text);
  });

  const flat = [];
  paras.forEach((p, pi) => p.lines.forEach((l, li) => flat.push({ ...l, pi, li, pn: p.lines.length, heading: !!p.heading })));

  const slots = template.baselines.length;
  const pages = [];
  let cur = [];
  const newPage = () => { pages.push(cur); cur = []; };
  if (slots > 0) {
    for (let i = 0; i < flat.length; i++) {
      const L = flat[i];
      if (!cur.length && L.blank) continue; // keine Leerzeilen oben auf einer Seite
      const rem = slots - cur.length;
      if (cur.length) {
        if (L.heading) {
          // Überschrift nie allein am Seitenende: mit mindestens 2 Zeilen des Folgeabsatzes
          let j = i + 1, blanks = 0;
          while (j < flat.length && flat[j].blank) { blanks++; j++; }
          const need = 1 + blanks + (j < flat.length ? Math.min(2, flat[j].pn) : 0);
          if (rem < need && need <= slots) newPage();
        } else if (L.li === 0 && L.pn > 1 && rem === 1) {
          newPage(); // erste Absatzzeile nicht allein unten
        } else if (L.pn >= 4 && L.li === L.pn - 2 && L.li >= 2 && rem === 1) {
          newPage(); // letzte Absatzzeile nicht allein oben auf der nächsten Seite
        }
      }
      cur.push(L);
      if (cur.length === slots) newPage();
    }
  }
  if (cur.length || !pages.length) pages.push(cur);

  let lineNo = 0;
  const outPages = pages.map(lines => ({
    lines: lines.map((L, j) => {
      lineNo++;
      if (L.blank) return null;
      return { baseline: template.baselines[j], ...composeLine(L, hash(ctx.seed, 'line', L.pi, L.li), ctx) };
    }).filter(Boolean),
  }));
  return { pages: outPages, missing: [...ctx.missing.entries()], lineCount: lineNo, fontSizeMM: ctx.s };
}

/** Absolute Seitenkoordinaten eines Punktes einer platzierten Glyphe. */
export function absPoint(line, g, p) {
  const lx = g.x + p[0];
  return [line.x0 + lx, line.baseline + line.slope * lx + p[1]];
}
