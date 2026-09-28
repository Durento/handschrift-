// Zeichensatz, Gruppen und Text-Normalisierung

const range = (a, b) => {
  const out = [];
  for (let c = a.charCodeAt(0); c <= b.charCodeAt(0); c++) out.push(String.fromCharCode(c));
  return out;
};

export const GROUPS = [
  { id: 'lower', title: 'Kleinbuchstaben', chars: range('a', 'z') },
  { id: 'upper', title: 'Großbuchstaben', chars: range('A', 'Z') },
  { id: 'umlaut', title: 'Umlaute & ß', chars: ['ä', 'ö', 'ü', 'Ä', 'Ö', 'Ü', 'ß'] },
  { id: 'digits', title: 'Ziffern', chars: range('0', '9') },
  { id: 'punct', title: 'Satzzeichen', chars: ['.', ',', ';', ':', '!', '?', '-', '–', '„', '“', "'", '(', ')', '/'] },
  { id: 'combo', title: 'Buchstabenkombinationen', chars: ['sch', 'ch', 'ck', 'st', 'sp', 'ei', 'ie', 'eu', 'au', 'qu', 'th', 'll', 'ss', 'tt', 'nn', 'mm', 'en', 'er', 'un'] },
];

export const MAX_VARIANTS = 3;

/** Alle Zeichen in Erfassungsreihenfolge (inkl. eigener Zusatzzeichen). */
export function allChars(extra = []) {
  const list = GROUPS.flatMap(g => g.chars);
  for (const c of extra) if (!list.includes(c)) list.push(c);
  return list;
}

export function groupOf(ch, extra = []) {
  const g = GROUPS.find(g => g.chars.includes(ch));
  if (g) return g.title;
  return extra.includes(ch) ? 'Eigene Zeichen' : '';
}

/** Anzeigename für Zeichen, die man sonst schlecht sieht. */
export function displayName(ch) {
  const names = { '.': 'Punkt', ',': 'Komma', ';': 'Semikolon', ':': 'Doppelpunkt', '!': 'Ausrufezeichen', '?': 'Fragezeichen',
    '-': 'Bindestrich', '–': 'Gedankenstrich', '„': 'Anführungszeichen unten', '“': 'Anführungszeichen oben', "'": 'Apostroph',
    '(': 'Klammer auf', ')': 'Klammer zu', '/': 'Schrägstrich' };
  return names[ch] || '';
}

/**
 * Vereinheitlicht eingefügten Text: Anführungszeichen, Striche, Leerzeichen.
 * Gerade " werden je nach Position zu „ oder “.
 */
export function normalizeText(text) {
  let t = text.replace(/\r\n?/g, '\n')
    .replace(/[­​-‍﻿]/g, '')
    .replace(/[\t  -  ]/g, ' ')
    .replace(/[”″]/g, '“')
    .replace(/»/g, '„').replace(/«/g, '“')
    .replace(/[‘’‚`´]/g, "'")
    .replace(/[—]/g, '–')
    .replace(/…/g, '...');
  // Gerade Anführungszeichen: öffnend nach Anfang/Leerraum/Klammer, sonst schließend
  t = t.replace(/(^|[\s(\[\/–-])"/g, '$1„').replace(/"/g, '“');
  return t;
}
