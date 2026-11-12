// Test : génère un PDF, applique un « add » et un « replace », relit avec pdfjs-dist.
const assert = require('assert');
const PDFLib = require('@cantoo/pdf-lib');
const { applyEdits, sanitizeWinAnsi, coverFor } = require('../src/pdf-edit.js');

async function extractText(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    out.push(tc.items.map((it) => it.str).join('\n'));
  }
  return out;
}

(async () => {
  // PDF de départ
  const doc = await PDFLib.PDFDocument.create();
  const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  const p = doc.addPage([300, 200]);
  p.drawText('Bonjour', { x: 50, y: 100, size: 14, font });
  const original = await doc.save();

  const size = 14;
  const width = font.widthOfTextAtSize('Bonjour', size);
  const edits = [
    { page: 0, type: 'add', x: 20, y: 40, text: 'Ajouté : été à Noël', size: 12, color: [1, 0, 0] },
    { page: 0, type: 'replace', x: 50, y: 100, text: 'Salut', size, color: [0, 0, 0], cover: coverFor(50, 100, width, size) },
  ];
  const result = await applyEdits(PDFLib, original, edits);

  const [text] = await extractText(result);
  console.log('Texte relu :', JSON.stringify(text));
  assert(text.includes('Ajouté : été à Noël'), 'texte ajouté (accents) manquant');
  assert(text.includes('Salut'), 'texte de remplacement manquant');

  // Position (ligne de base) et taille du texte écrit
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(result), useSystemFonts: true }).promise;
  const tc = await (await pdf.getPage(1)).getTextContent();
  const salut = tc.items.find((i) => i.str === 'Salut');
  assert(Math.abs(salut.transform[4] - 50) < 0.01 && Math.abs(salut.transform[5] - 100) < 0.01, 'position de « Salut »');
  assert(Math.abs(salut.transform[0] - 14) < 0.01, 'taille de « Salut »');

  // Sanitisation
  assert.strictEqual(sanitizeWinAnsi('é€日本'), 'é€??');
  // Rectangle de recouvrement
  assert.deepStrictEqual(coverFor(10, 20, 30, 10), { x: 10, y: 17.5, w: 31, h: 11.5 });
  // Les octets d'origine ne sont pas modifiés
  const [origText] = await extractText(original);
  assert(origText.includes('Bonjour') && !origText.includes('Salut'));

  console.log('OK : tous les tests passent.');
})().catch((e) => {
  console.error('ÉCHEC :', e);
  process.exit(1);
});
