// Mesures enregistrées (figées) : on enregistre, on recharge, on rend avec pdf.js, on lit le texte et les pixels.
// Portrait, paysage et /Rotate 90. Usage : node test/test-measure-render.js
const assert = require('assert');
const path = require('path');
const PDFLib = require('@cantoo/pdf-lib');
const Shapes = require('../src/shapes.js');
const Measure = require('../src/measure.js');
const PdfEdit = require('../src/pdf-edit.js');

const { rgb, degrees } = PDFLib;
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const BLUE = [0, 0.45, 0.8];

async function source() {
  const d = await PDFLib.PDFDocument.create();
  d.addPage([842, 595]); // 0 : A4 paysage
  d.addPage([595, 842]); // 1 : portrait
  const p = d.addPage([595, 842]); // 2 : /Rotate 90
  p.setRotation(degrees(90));
  return d.save();
}
let pdfjsP = null;
async function load(bytes) {
  pdfjsP = pdfjsP || import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfjs = await pdfjsP;
  const fontDir = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'standard_fonts').split('\\').join('/') + '/';
  return pdfjs.getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: fontDir, verbosity: 0 }).promise;
}
async function render(bytes, n) {
  const pdf = await load(bytes);
  const page = await pdf.getPage(n);
  const vp = page.getViewport({ scale: 2 });
  const cc = pdf.canvasFactory.create(vp.width, vp.height);
  await page.render({ canvasContext: cc.context, viewport: vp, canvasFactory: pdf.canvasFactory }).promise;
  const img = cc.context.getImageData(0, 0, vp.width, vp.height);
  const px = (x, y) => {
    const [vx, vy] = vp.convertToViewportPoint(x, y);
    const i = (Math.min(img.height - 1, Math.max(0, Math.round(vy))) * img.width + Math.min(img.width - 1, Math.max(0, Math.round(vx)))) * 4;
    return [img.data[i] / 255, img.data[i + 1] / 255, img.data[i + 2] / 255];
  };
  const texts = (await page.getTextContent()).items.map((i) => i.str).filter((s) => s.trim());
  return { px, texts };
}
const anyNear = (r, x, y, color, tol, rad = 2) => { for (let dx = -rad; dx <= rad; dx += 0.5) for (let dy = -rad; dy <= rad; dy += 0.5) if (near(r.px(x + dx, y + dy), color, tol)) return true; return false; };

(async () => {
  const src = await source();
  const measureCtx = { scales: { 0: Measure.scaleFromRatio(50), 1: Measure.scaleFromRatio(100), 2: Measure.scaleFromRatio(50) }, unit: 'm', precision: 2 };
  const save = async (edits, pageIdx) => {
    const out = await PdfEdit.applyEdits(PDFLib, src, edits.map((e, i) => Object.assign(Shapes.defaultsFor(e.type), { id: i + 1, page: pageIdx }, e)), { measure: measureCtx });
    return render(out, pageIdx + 1);
  };
  const mm100 = 100 / Measure.MM_PER_PT; // 100 mm sur le papier

  for (const [pageIdx, label, ratio] of [[0, 'paysage', 50], [1, 'portrait', 100], [2, 'Rotate 90', 50]]) {
    const expected = Measure.describe({ type: 'm-dist', page: pageIdx, points: [[0, 0], [mm100, 0]] }, measureCtx);
    assert.strictEqual(expected, ratio === 50 ? '5,00 m' : '10,00 m');
    // distance
    let r = await save([{ type: 'm-dist', points: [[100, 300], [100 + mm100, 300]] }], pageIdx);
    assert(r.texts.includes(expected), `distance ${label} : texte « ${expected} » (${r.texts.join('|')})`);
    assert(anyNear(r, 100 + mm100 / 4, 300, BLUE, 0.2, 1.5), `distance ${label} : trait`);
    // cote : flèches + valeur
    r = await save([{ type: 'm-dim', points: [[100, 200], [100 + mm100, 200]], offset: 30 }], pageIdx);
    assert(r.texts.includes(expected), `cote ${label} : valeur`);
    assert(anyNear(r, 100 + mm100 / 2, 230, BLUE, 0.2, 1.5), `cote ${label} : ligne de cote décalée de 30 pt`);
    assert(anyNear(r, 100, 215, BLUE, 0.2, 1.5), `cote ${label} : trait d'attache`);
    // surface : 10 m × 4 m
    const k = ratio * Measure.MM_PER_PT;
    const w = 10000 / k, h = 4000 / k;
    r = await save([{ type: 'm-area', points: [[50, 100], [50 + w, 100], [50 + w, 100 + h], [50, 100 + h]], fill: [0, 0.45, 0.8] }], pageIdx);
    assert(r.texts.some((t) => t === 'S = 40,00 m² · P = 28,00 m'), `surface ${label} : texte (${r.texts.join('|')})`);
    const inside = r.px(50 + w / 2, 100 + h * 0.25);
    assert(inside[2] > inside[0] + 0.05 && inside[0] > 0.7, `surface ${label} : remplissage translucide ` + inside);
    // angle 90°
    r = await save([{ type: 'm-angle', points: [[200, 400], [150, 400], [150, 450]] }], pageIdx);
    assert(r.texts.some((t) => /^90,00°$/.test(t)), `angle ${label} : 90°`);
    assert(anyNear(r, 175, 400, BLUE, 0.2, 1.5), `angle ${label} : branche`);
    // polyligne, cercle
    r = await save([{ type: 'm-poly', points: [[100, 100], [200, 100], [200, 160]], showSegments: true }, { type: 'm-circle', points: [[400, 300], [350, 350], [300, 300]] }], pageIdx);
    assert(r.texts.length >= 4 && r.texts.some((t) => /^Ø /.test(t)), `polyligne et cercle ${label} : ${r.texts.join('|')}`);
    console.log(`  ok   mesures sur page ${label} (échelle 1:${ratio})`);
  }
  // valeur verrouillée : ne suit pas un changement d'échelle
  {
    const ctx2 = { scales: { 0: Measure.scaleFromRatio(200) }, unit: 'm', precision: 2 };
    const out = await PdfEdit.applyEdits(PDFLib, src, [Object.assign(Shapes.defaultsFor('m-dist'), { id: 1, page: 0, type: 'm-dist', points: [[100, 300], [100 + mm100, 300]], lockedText: '5,00 m' })], { measure: ctx2 });
    const r = await render(out, 1);
    assert(r.texts.includes('5,00 m'), 'valeur verrouillée conservée après changement d\'échelle');
    const out2 = await PdfEdit.applyEdits(PDFLib, src, [Object.assign(Shapes.defaultsFor('m-dist'), { id: 1, page: 0, type: 'm-dist', points: [[100, 300], [100 + mm100, 300]] })], { measure: ctx2 });
    assert((await render(out2, 1)).texts.includes('20,00 m'), 'valeur non verrouillée : recalculée (1:200 → 20 m)');
    console.log('  ok   valeur verrouillée / recalcul');
  }
  console.log('OK : mesures figées dans le PDF (texte et pixels).');
})().catch((e) => { console.error('ÉCHEC :', e); process.exit(1); });
