// Génère de petits PDF de test (pages de tailles différentes, texte bien noir) dans un dossier.
const fs = require('fs');
const path = require('path');
const PDFLib = require('@cantoo/pdf-lib');

async function makePdf(file, label, sizes) {
  const d = await PDFLib.PDFDocument.create();
  const f = await d.embedFont(PDFLib.StandardFonts.HelveticaBold);
  sizes.forEach(([w, h], i) => {
    const p = d.addPage([w, h]);
    p.drawRectangle({ x: 40, y: h - 120, width: w - 80, height: 50, color: PDFLib.rgb(0, 0, 0) });
    p.drawText(`${label} - page ${i + 1}`, { x: 50, y: h - 160, size: 28, font: f });
    p.drawText('Ligne de texte exemple', { x: 50, y: h - 220, size: 16, font: f });
  });
  fs.writeFileSync(file, await d.save());
}

async function makeAll(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const A4 = [595, 842], LETTER = [612, 792], A3L = [1191, 842], A5 = [420, 595];
  const files = {
    a: path.join(dir, 'a-huit-pages.pdf'),
    b: path.join(dir, 'b-letter.pdf'),
    c: path.join(dir, 'c-mixte.pdf'),
    d: path.join(dir, 'd-a5.pdf'),
  };
  await makePdf(files.a, 'Doc A', Array(8).fill(A4));
  await makePdf(files.b, 'Doc B', Array(5).fill(LETTER));
  await makePdf(files.c, 'Doc C', [A3L, A4, A5, A3L, LETTER, A4]);
  await makePdf(files.d, 'Doc D', Array(3).fill(A5));
  return files;
}

module.exports = { makeAll };
