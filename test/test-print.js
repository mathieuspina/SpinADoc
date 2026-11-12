// Impression : calculs de mise en page (purs) et assemblage du PDF d'impression (mesures sur le rendu pdf.js, tolérance 0,6 mm).
// Usage : node test/test-print.js
const assert = require('assert');
const PDFLib = require('@cantoo/pdf-lib');
const L = require('../src/print-layout.js');
const C = require('../src/print-compose.js');

const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg || ''} ${a} ≠ ${b} (±${tol})`);
const { mm } = L;
const A4 = { w: mm(210), h: mm(297) }, A3p = { w: mm(297), h: mm(420) }, A1 = { w: mm(594), h: mm(841) };

// ------------------------------------------------------------ plages de pages
assert.deepStrictEqual(L.parseRanges('1-3, 5, 8-12', 12).pages, [0, 1, 2, 4, 7, 8, 9, 10, 11]);
assert.deepStrictEqual(L.parseRanges('3-1', 5).pages, [2, 1, 0], 'plage décroissante');
assert.deepStrictEqual(L.parseRanges('2,2,1-2', 5).pages, [1, 0], 'sans doublon');
assert(L.parseRanges('0', 5).error && L.parseRanges('1-9', 5).error && L.parseRanges('a', 5).error && L.parseRanges('', 5).error, 'erreurs');

// ------------------------------------------------------------ échelle et placement
const plan = (pages, o) => L.planSheet(pages, Object.assign({ paperW: 297, paperH: 420, orientation: 'auto', mode: 'fit', center: true }, o));
let p = plan([A4], { mode: 'actual' });
near(p.items[0].scale, 1, 1e-9, 'A4 sur A3 taille réelle');
near(p.sheet.w, mm(297), 1e-6); near(p.sheet.h, mm(420), 1e-6);
near(p.items[0].x, (mm(297) - mm(210)) / 2, 1e-6, 'centré en x'); near(p.items[0].y, (mm(420) - mm(297)) / 2, 1e-6, 'centré en y');
assert(!p.items[0].cropped && !p.items[0].reduced);
p = plan([A4], { mode: 'fit' });
near(p.items[0].scale, Math.min(297 / 210, 420 / 297), 1e-9, 'A4 ajusté sur A3 : agrandi'); assert(p.items[0].enlarged);
p = plan([A4], { mode: 'shrink' });
near(p.items[0].scale, 1, 1e-9, 'réduire seulement : pas d\'agrandissement');
p = plan([A1], { mode: 'fit' });
near(p.items[0].scale, Math.min(297 / 594, 420 / 841), 1e-9, 'A1 ajusté sur A3'); assert(p.items[0].reduced && p.warnings.some((w) => /réduite/.test(w)));
p = plan([A1], { mode: 'shrink' });
near(p.items[0].scale, Math.min(297 / 594, 420 / 841), 1e-9, 'A1 réduit sur A3');
p = plan([A1], { mode: 'actual' });
assert(p.items[0].cropped && p.warnings.some((w) => /coupée/.test(w)), 'A1 à 100 % sur A3 : coupé, avertissement');
p = plan([A4], { mode: 'percent', percent: 50 });
near(p.items[0].scale, 0.5, 1e-9, 'pourcentage');
p = plan([A4], { mode: 'fit', margins: { top: 10, right: 10, bottom: 10, left: 10 } });
near(p.items[0].scale, Math.min((297 - 20) / 210, (420 - 20) / 297), 1e-9, 'marges prises en compte');
p = plan([A4], { mode: 'actual', center: false, margins: { top: 5, right: 5, bottom: 5, left: 5 } });
near(p.items[0].x, mm(5), 1e-6, 'sans centrage : coin haut-gauche de la zone'); near(p.items[0].y + p.items[0].h, mm(420 - 5), 1e-6);
assert(plan([A4], { margins: { top: 300, right: 0, bottom: 300, left: 0 } }).warnings.length === 1, 'marges trop grandes');

// ------------------------------------------------------------ orientation
const land = { w: mm(420), h: mm(297) };
p = plan([land], {});
assert(p.sheet.w > p.sheet.h, 'automatique : page paysage → feuille paysage'); near(p.items[0].scale, 1, 1e-9, 'A3 paysage sur A3 paysage, ajusté = 1');
p = plan([A4], { orientation: 'landscape' });
assert(p.sheet.w > p.sheet.h && p.items[0].rotate === 90, 'paysage imposé : feuille paysage, page tournée');
near(p.items[0].scale, Math.min(420 / 297, 297 / 210), 1e-9, 'paysage imposé : ajustement avec la page tournée');
p = plan([land], { orientation: 'portrait' });
assert(p.sheet.h > p.sheet.w && p.items[0].rotate === 90, 'portrait imposé');

// ------------------------------------------------------------ planches 2 / 4 pages par feuille
p = L.planSheet([A4, A4], { paperW: 297, paperH: 420, nup: 2, mode: 'fit', center: true });
assert(p.sheet.w > p.sheet.h && p.items.length === 2, '2 pages A4 portrait : feuille paysage');
assert(p.items[0].x + p.items[0].w <= p.items[1].x + 1e-6, 'les deux pages ne se chevauchent pas');
p = L.planSheet([A4, A4, A4, A4], { paperW: 297, paperH: 420, nup: 4, mode: 'fit', center: true });
const rects = p.items.map((i) => [i.x, i.y, i.x + i.w, i.y + i.h]);
for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) assert(rects[i][2] <= rects[j][0] + 1e-6 || rects[j][2] <= rects[i][0] + 1e-6 || rects[i][3] <= rects[j][1] + 1e-6 || rects[j][3] <= rects[i][1] + 1e-6, 'planche de 4 : sans chevauchement');
// groupement par taille de feuille
const g = L.groupBySize([{ sheet: { w: mm(210), h: mm(297) } }, { sheet: { w: mm(210), h: mm(297) } }, { sheet: { w: mm(297), h: mm(420) } }, { sheet: { w: mm(210), h: mm(297) } }]);
assert.deepStrictEqual(g.map((x) => x.sheets.length), [2, 1, 1], 'une tâche par taille de feuille consécutive');
console.log('  ok   mise en page : plages, échelle, orientation, marges, planches');

// ------------------------------------------------------------ exactitude géométrique du PDF d'impression (lue dans les opérateurs, sans pixels)
// Matrices cumulées : CTM de la page (opérateurs cm) × /Matrix du formulaire intégré, appliquées aux extrémités du trait (m / l).
const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
async function exactLine(outBytes) {
  const d = await PDFLib.PDFDocument.load(outBytes);
  let pageTxt = null, form = null;
  for (const [, o] of d.context.enumerateIndirectObjects()) {
    if (!o.contents) continue;
    const t = Buffer.from(PDFLib.decodePDFRawStream(o).decode()).toString('latin1');
    const sub = o.dict.get(PDFLib.PDFName.of('Subtype'));
    if (sub && String(sub) === '/Form') form = { t, m: o.dict.get(PDFLib.PDFName.of('Matrix')).asArray().map((n) => n.asNumber()) };
    else if (/ Do\b/.test(t)) pageTxt = t;
  }
  let ctm = [1, 0, 0, 1, 0, 0], atDo = null; const st = [];
  for (const ln of pageTxt.split('\n')) {
    const t = ln.trim();
    if (t === 'q') st.push(ctm.slice()); else if (t === 'Q') ctm = st.pop() || ctm;
    else if (/ Do$/.test(t)) atDo = ctm.slice();
    else if (/ cm$/.test(t)) ctm = mul(t.split(/\s+/).slice(0, 6).map(Number), ctm);
  }
  const M = mul(form.m, atDo);
  const pts = [...form.t.matchAll(/(-?[\d.]+) (-?[\d.]+) [ml]\n/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const [a, b] = [pts[0], pts[pts.length - 1]].map(([x, y]) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]]);
  return { len: L.toMm(Math.hypot(b[0] - a[0], b[1] - a[1])), a, b };
}
async function lineDoc(wmm, hmm, rotate) {
  const dd = await PDFLib.PDFDocument.create();
  const pg = dd.addPage([mm(wmm), mm(hmm)]);
  pg.drawLine({ start: { x: mm(20), y: mm(hmm - 30) }, end: { x: mm(120), y: mm(hmm - 30) }, thickness: mm(0.3) });
  if (rotate) pg.setRotation(PDFLib.degrees(rotate));
  return dd.save();
}
async function exactCase(label, wmm, hmm, o, expectLen) {
  const src = await lineDoc(wmm, hmm, o.rot || 0);
  const infos = await C.pageInfos(PDFLib, src);
  const pl = L.planSheet([infos[0]], o);
  const out = await C.compose(PDFLib, src, [{ w: pl.sheet.w, h: pl.sheet.h, items: [Object.assign({ page: 0 }, pl.items[0])] }]);
  const r = await exactLine(out);
  near(r.len, expectLen(pl.items[0]), 1e-6, label + ' : longueur exacte du trait (opérateurs)');
  const sz = (await PDFLib.PDFDocument.load(out)).getPage(0).getSize();
  near(sz.width, pl.sheet.w, 1e-9, label + ' : largeur de page'); near(sz.height, pl.sheet.h, 1e-9, label + ' : hauteur de page');
}
(async () => {
  await exactCase('A4', 210, 297, { paperW: 210, paperH: 297, mode: 'actual', center: true }, () => 100);
  await exactCase('A3', 297, 420, { paperW: 297, paperH: 420, mode: 'actual', center: true }, () => 100);
  await exactCase('A1', 594, 841, { paperW: 594, paperH: 841, mode: 'actual', center: true }, () => 100);
  await exactCase('A1 sur A3 ajusté', 594, 841, { paperW: 297, paperH: 420, mode: 'fit', center: true }, (it) => 100 * it.scale);
  await exactCase('A4 /Rotate 90 sur A3', 210, 297, { paperW: 297, paperH: 420, mode: 'actual', center: true, rot: 90 }, () => 100);
  await exactCase('A4 paysage imposé', 210, 297, { paperW: 297, paperH: 420, orientation: 'landscape', mode: 'actual', center: true }, () => 100);
  console.log('  ok   PDF d\'impression exact (A4, A3, A1, réduit, tourné) : longueur lue dans les opérateurs, sans pixels');
})().catch((e) => { console.error('ÉCHEC (exactitude) :', e); process.exit(1); });

// ------------------------------------------------------------ assemblage : mesures sur le rendu
let pdfjsP = null;
async function renderDark(bytes, pageNo, dpi) {
  pdfjsP = pdfjsP || import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfjs = await pdfjsP;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const page = await doc.getPage(pageNo);
  const vp0 = page.getViewport({ scale: dpi / 72 });
  const W = Math.ceil(vp0.width), H = Math.ceil(vp0.height);
  const cc = doc.canvasFactory.create(W, H);
  cc.context.fillStyle = '#fff'; cc.context.fillRect(0, 0, W, H);
  await page.render({ canvasContext: cc.context, viewport: vp0, canvasFactory: doc.canvasFactory }).promise;
  const img = cc.context.getImageData(0, 0, W, H);
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; if (img.data[i] < 128) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  const k = 25.4 / dpi;
  return { w: vp0.width * k, h: vp0.height * k, x0: x0 * k, y0: y0 * k, x1: (x1 + 1) * k, y1: (y1 + 1) * k };
}
// Source : page w × h (mm) avec une équerre : trait horizontal de 100 mm et vertical de 100 mm à 20 mm du bord gauche / 30 mm du haut
async function source(wmm, hmm, rotate) {
  const d = await PDFLib.PDFDocument.create();
  const pg = d.addPage([mm(wmm), mm(hmm)]);
  const top = (y) => mm(hmm - y);
  pg.drawLine({ start: { x: mm(20), y: top(30) }, end: { x: mm(120), y: top(30) }, thickness: mm(0.3) });
  pg.drawLine({ start: { x: mm(20), y: top(30) }, end: { x: mm(20), y: top(130) }, thickness: mm(0.3) });
  if (rotate) pg.setRotation(PDFLib.degrees(rotate));
  return d.save();
}
const TOL = 0.6;
async function check(label, srcBytes, o, expect) {
  const infos = await C.pageInfos(PDFLib, srcBytes);
  const pl = L.planSheet([infos[0]], o);
  const it = pl.items[0];
  const out = await C.compose(PDFLib, srcBytes, [{ w: pl.sheet.w, h: pl.sheet.h, items: [Object.assign({ page: 0 }, it)] }]);
  const r = await renderDark(out, 1, 300);
  near(r.w, L.toMm(pl.sheet.w), 0.05, label + ' : largeur de la feuille'); near(r.h, L.toMm(pl.sheet.h), 0.05, label + ' : hauteur de la feuille');
  const e = expect(pl, it);
  near(r.x1 - r.x0, e.w, TOL, label + ' : largeur du tracé'); near(r.y1 - r.y0, e.h, TOL, label + ' : hauteur du tracé');
  near(r.x0, e.x, TOL, label + ' : position x'); near(r.y0, e.y, TOL, label + ' : position y (depuis le haut)');
  console.log('  ok   ' + label);
}
(async () => {
  const mmOf = (v) => L.toMm(v);
  // équerre dans la page : x 19,85…120,15 ; y(haut) 29,85…130,15 (traits de 0,3 mm)
  const sq = { x: 19.85, y: 29.85, w: 100.3, h: 100.3 };
  const A4s = await source(210, 297, 0);
  // 1. A4 sur A3, taille réelle, centré : trait de 100 mm exact, décalé de (43,5 ; 61,5) mm
  await check('A4 sur A3, taille réelle', A4s, { paperW: 297, paperH: 420, mode: 'actual', center: true }, (pl, it) => ({ w: sq.w, h: sq.h, x: sq.x + 43.5, y: sq.y + 61.5 }));
  // 2. A4 sur A3 ajusté : agrandi
  await check('A4 sur A3, ajusté (×1,414)', A4s, { paperW: 297, paperH: 420, mode: 'fit', center: true }, (pl, it) => ({ w: sq.w * it.scale, h: sq.h * it.scale, x: sq.x * it.scale, y: sq.y * it.scale }));
  // 3. A1 sur A3 ajusté : réduit, vectoriel
  const A1s = await source(594, 841, 0);
  await check('A1 sur A3, ajusté (réduit)', A1s, { paperW: 297, paperH: 420, mode: 'fit', center: true }, (pl, it) => ({ w: sq.w * it.scale, h: sq.h * it.scale, x: it.x ? mmOf(it.x) + sq.x * it.scale : 0, y: (mmOf(pl.sheet.h) - mmOf(it.y) - mmOf(it.h)) + sq.y * it.scale }));
  // 4. A1 sur A3, 50 %
  await check('A1 sur A3, 50 %', A1s, { paperW: 297, paperH: 420, mode: 'percent', percent: 50, center: false }, (pl, it) => ({ w: sq.w * 0.5, h: sq.h * 0.5, x: mmOf(it.x) + sq.x * 0.5, y: (mmOf(pl.sheet.h) - mmOf(it.y) - mmOf(it.h)) + sq.y * 0.5 }));
  // 5. page tournée de 90° (paysage imposé) : équerre tournée, boîte placée connue
  await check('A4 portrait sur A3 paysage imposé (rotation 90°)', A4s, { paperW: 297, paperH: 420, orientation: 'landscape', mode: 'actual', center: true }, (pl, it) => {
    // page (px, py) en mm depuis le coin bas-gauche → feuille : x = it.x + it.w − s·py, y(bas) = it.y + s·px
    const s = it.scale, X = mmOf(it.x), Y = mmOf(it.y), W = mmOf(it.w), Hs = mmOf(pl.sheet.h);
    const pts = [[19.85, 297 - 29.85], [120.15, 297 - 29.85], [19.85, 297 - 130.15], [120.15, 297 - 130.15]].map(([px, py]) => [X + W - s * py, Y + s * px]);
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    return { w: maxX - minX, h: maxY - minY, x: minX, y: Hs - maxY };
  });
  // 6. page source avec /Rotate 90 : affichée tournée, tracé à sa place
  const rot = await source(210, 297, 90);
  await check('A4 avec /Rotate 90 sur A3, taille réelle', rot, { paperW: 297, paperH: 420, mode: 'actual', center: true }, (pl, it) => {
    // page non tournée (W=210, H=297) affichée tournée de 90° horaire : (px, py) → (py, 210 − px) ; affichage 297 × 210
    const X = mmOf(it.x), Y = mmOf(it.y), Hs = mmOf(pl.sheet.h);
    const pts = [[19.85, 297 - 29.85], [120.15, 297 - 29.85], [19.85, 297 - 130.15], [120.15, 297 - 130.15]].map(([px, py]) => [X + py, Y + (210 - px)]);
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), x: Math.min(...xs), y: Hs - Math.max(...ys) };
  });
  // 7. A1 aux dimensions exactes (feuille personnalisée) : taille réelle sur feuille A1
  await check('A1 sur A1, taille réelle (feuille 594 × 841 mm)', A1s, { paperW: 594, paperH: 841, mode: 'actual', center: true }, (pl, it) => ({ w: sq.w, h: sq.h, x: sq.x, y: sq.y }));
  console.log('OK : impression (mise en page et assemblage vectoriel).');
})().catch((e) => { console.error('ÉCHEC :', e); process.exit(1); });

// ------------------------------------------------------------ nom du travail, marges, imprimantes (fonctions pures)
(function names() {
  assert.strictEqual(L.cleanName('C:\\dossier\\1234_56 CLIENT EXEMPLE - PLANS.pdf'), '1234_56 CLIENT EXEMPLE - PLANS', 'chemin et extension retirés');
  assert.strictEqual(L.jobTitle('1234_56 CLIENT EXEMPLE - PLANS.pdf', 0, 1), '1234_56 CLIENT EXEMPLE - PLANS.pdf');
  assert.strictEqual(L.jobTitle('Plan.pdf', 1, 2), 'Plan (2/2).pdf');
  assert.strictEqual(L.jobFileName('Plan.pdf', 0, 2), 'Plan (1-2).pdf', 'pas de « / » dans un nom de fichier');
  assert.strictEqual(L.cleanName('a<b>c:d"e|h?i*j.pdf'), 'a b c d e h i j');
  assert.strictEqual(L.cleanName('Éléphant à l’été — rapport.pdf'), 'Éléphant à l’été — rapport', 'accents conservés');
  assert.strictEqual(L.cleanName('   ...  '), 'Sans titre'); assert.strictEqual(L.cleanName(''), 'Sans titre'); assert.strictEqual(L.cleanName(null), 'Sans titre');
  const long = L.cleanName('x'.repeat(300) + '.pdf');
  assert(long.length <= 90 && long.endsWith('…'), 'nom très long tronqué');
  assert(!/[<>:"/\\|?*…]/.test(L.jobFileName('x'.repeat(300) + '.pdf', 0, 1)), 'nom de fichier sûr');
  assert(L.isPdfPrinter('PDFCreator') && L.isPdfPrinter('Microsoft Print to PDF') && L.isPdfPrinter('SpinADoc Test PDF') && !L.isPdfPrinter('\\\\serveur\\imprimante'));
  assert.strictEqual(L.normMargin('', 2), 2, 'champ vide : valeur précédente'); assert.strictEqual(L.normMargin('abc', 3), 3); assert.strictEqual(L.normMargin('-1', 3), 3);
  assert.strictEqual(L.normMargin('2,5', 0), 2.5); assert.strictEqual(L.normMargin('0', 2), 0, '0 est une valeur valide'); assert.strictEqual(L.normMargin('500', 2), 2);
  assert.strictEqual(L.defaultMargin(null), 2); assert.strictEqual(L.defaultMargin(0), 2); assert.strictEqual(L.defaultMargin(4.2), 4.2, 'jamais sous la marge matérielle');
  // coupe due à la marge matérielle : A4 ajusté avec 2 mm de marge sur une imprimante à 4,2 mm
  const pp = L.planSheet([A4], { paperW: 210, paperH: 297, mode: 'fit', center: true, margins: { top: 2, right: 2, bottom: 2, left: 2 } });
  near(L.hardwareCut(pp.sheet, pp.items, 4.2).cutMm, 2.2, 0.11, 'coupe annoncée en mm');
  assert.strictEqual(L.hardwareCut(pp.sheet, pp.items, 1.5).cutMm, 0, 'marge suffisante : rien de coupé');
  assert.strictEqual(L.hardwareCut(pp.sheet, pp.items, null).cutMm, 0);
  console.log('  ok   nom du travail, marge par défaut / saisie, imprimantes PDF, coupe matérielle');
})();
