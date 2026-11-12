// Tests de la géométrie (Shapes) et de l'enregistrement « figé » de chaque type d'annotation :
// on enregistre, on recharge avec pdf.js, on RENDRE la page et on lit les pixels aux positions attendues.
const assert = require('assert');
const PDFLib = require('@cantoo/pdf-lib');
const Shapes = require('../src/shapes.js');
const PdfEdit = require('../src/pdf-edit.js');

const measure = Shapes.makeMeasure(PDFLib);
const W = 300, H = 300;

async function basePdf(blackRect) {
  const d = await PDFLib.PDFDocument.create();
  const p = d.addPage([W, H]);
  if (blackRect) p.drawRectangle({ x: blackRect[0], y: blackRect[1], width: blackRect[2], height: blackRect[3], color: PDFLib.rgb(0, 0, 0) });
  return d.save();
}

let pdfjsP = null;
async function render(bytes) {
  pdfjsP = pdfjsP || import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfjs = await pdfjsP;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, verbosity: 0 }).promise;
  const page = await pdf.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const cc = pdf.canvasFactory.create(vp.width, vp.height);
  await page.render({ canvasContext: cc.context, viewport: vp, canvasFactory: pdf.canvasFactory }).promise;
  const img = cc.context.getImageData(0, 0, vp.width, vp.height);
  const px = (x, y) => { // x, y en points PDF (y vers le haut)
    const i = (Math.round(H - y) * img.width + Math.round(x)) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  };
  return { px, page, pdf };
}

const near = (c, ref, tol = 40) => c.every((v, i) => Math.abs(v - ref[i]) <= tol);
const isWhite = (c) => near(c, [255, 255, 255], 12);
const RED = [0.9, 0.1, 0.1], BLUE = [0.1, 0.2, 0.9], GREEN = [0.1, 0.7, 0.2];
const to255 = (c) => c.map((v) => v * 255);

async function save(edits, blackRect) {
  const out = await PdfEdit.applyEdits(PDFLib, await basePdf(blackRect), edits.map((e, i) => Object.assign({ id: i + 1, page: 0 }, e)));
  return render(out);
}

(async () => {
  // ----------------------------------------------------------------- géométrie
  const rect = { type: 'rect', cx: 100, cy: 100, w: 40, h: 20, rot: 0, width: 2, fill: null };
  let b = Shapes.bounds(rect);
  assert.deepStrictEqual([b.x0, b.y0, b.x1, b.y1], [80, 90, 120, 110]);
  const r90 = Shapes.rotateBy(Object.assign({}, rect), 90, 100, 100);
  b = Shapes.bounds(r90);
  assert(Math.abs(b.x0 - 90) < 1e-9 && Math.abs(b.x1 - 110) < 1e-9 && Math.abs(b.y0 - 80) < 1e-9 && Math.abs(b.y1 - 120) < 1e-9, 'rotation de 90° d\'un cadre');
  assert.strictEqual(r90.rot, 90);
  assert(Shapes.hitTest(rect, 80, 100, 1, measure), 'bord gauche du rectangle (non rempli)');
  assert(!Shapes.hitTest(rect, 100, 100, 1, measure), 'centre d\'un rectangle non rempli : pas touché');
  assert(Shapes.hitTest(Object.assign({}, rect, { fill: [1, 0, 0] }), 100, 100, 1, measure), 'centre d\'un rectangle rempli');
  assert(Shapes.hitTest(r90, 100, 118, 1, measure), 'rectangle tourné : bord haut');
  const line = { type: 'line', points: [[0, 0], [100, 0]], width: 2 };
  assert(Shapes.hitTest(line, 50, 3, 3, measure) && !Shapes.hitTest(line, 50, 10, 3, measure));
  const poly = { type: 'polygon', points: [[0, 0], [100, 0], [50, 80]], fill: [1, 0, 0], width: 2 };
  assert(Shapes.hitTest(poly, 50, 30, 1, measure) && !Shapes.hitTest(poly, 5, 70, 1, measure));
  const sc = Shapes.resizePoints(JSON.parse(JSON.stringify(poly)), { x0: 0, y0: 0, x1: 100, y1: 80 }, { x0: 0, y0: 0, x1: 200, y1: 40 });
  assert.deepStrictEqual(sc.points, [[0, 0], [200, 0], [100, 40]]);
  const tr = Shapes.translate({ type: 'highlight', rects: [[1, 2, 3, 4]] }, 10, 20);
  assert.deepStrictEqual(tr.rects, [[11, 22, 3, 4]]);
  const sm = Shapes.smooth([[0, 0], [10, 0], [10, 10], [20, 10]], 0.1, 2);
  assert(sm.length > 4 && sm[0][0] === 0 && sm[sm.length - 1][0] === 20, 'lissage : extrémités conservées');
  // mise en page du texte : retour automatique, alignement
  const t0 = { type: 'add', x: 10, y: 200, text: 'un deux trois quatre cinq six sept huit', size: 12, font: 'Helvetica', width: 80, align: 'left' };
  const L0 = Shapes.layoutText(t0, measure);
  assert(L0.lines.length > 2, 'retour automatique à la ligne : ' + L0.lines.length);
  assert(L0.lines.every((l) => measure(L0.fn, l.text, 12) <= 80.01), 'chaque ligne tient dans la largeur fixe');
  const Lc = Shapes.layoutText(Object.assign({}, t0, { align: 'center' }), measure);
  assert(Lc.lines[0].x > 10 || Lc.lines.every((l) => l.x >= 10), 'alignement centré');
  assert.notStrictEqual(Shapes.fontKey({ font: 'Times', bold: true, italic: true }), Shapes.fontKey({ font: 'Times' }));
  assert.strictEqual(Shapes.fontKey({ font: 'Courier', italic: true }), 'Courier-Oblique');
  // nuage : arcs sortants (chaque arc dépasse du segment d'origine)
  const cloud = Shapes.primitives({ type: 'cloud', points: [[50, 50], [250, 50], [250, 250], [50, 250]], arc: 20, width: 2, color: RED }, measure)[0];
  assert(cloud.segs.filter((s) => s[0] === 'C').length >= 40 && cloud.segs[cloud.segs.length - 1][0] === 'Z', 'nuage fermé fait d\'arcs');
  console.log('  ok   géométrie');

  // ----------------------------------------------------------------- enregistrement figé : un test par type
  let r;
  r = await save([{ type: 'line', points: [[50, 50], [250, 50]], color: RED, width: 4, opacity: 1, dash: 'solid' }]);
  assert(near(r.px(150, 50), to255(RED)) && isWhite(r.px(150, 100)) && isWhite(r.px(150, 40)), 'ligne');
  console.log('  ok   line');

  r = await save([{ type: 'arrow', points: [[50, 50], [250, 50]], color: RED, width: 4, opacity: 1, arrowEnd: true }]);
  assert(near(r.px(236, 55), to255(RED)), 'pointe de flèche (hors du trait)');
  assert(isWhite(r.px(60, 55)), 'pas de pointe au départ');
  r = await save([{ type: 'arrow', points: [[50, 50], [250, 50]], color: RED, width: 4, opacity: 1, arrowStart: true, arrowEnd: true }]);
  assert(near(r.px(64, 55), to255(RED)) && near(r.px(236, 55), to255(RED)), 'flèche à deux pointes');
  console.log('  ok   arrow (1 et 2 pointes)');

  r = await save([{ type: 'rect', cx: 150, cy: 150, w: 100, h: 60, rot: 0, color: RED, fill: BLUE, width: 4, opacity: 1, radius: 0 }]);
  assert(near(r.px(150, 150), to255(BLUE)) && near(r.px(100, 150), to255(RED), 60) && isWhite(r.px(60, 150)), 'rectangle rempli');
  r = await save([{ type: 'rect', cx: 150, cy: 150, w: 100, h: 60, rot: 90, color: RED, fill: null, width: 4, opacity: 1, radius: 0 }]);
  assert(near(r.px(120, 150), to255(RED), 60) && near(r.px(150, 100), to255(RED), 60) && isWhite(r.px(150, 150)) && isWhite(r.px(100, 150)), 'rectangle tourné de 90° (devient 60 de large × 100 de haut)');
  r = await save([{ type: 'rect', cx: 150, cy: 150, w: 100, h: 100, rot: 0, color: RED, fill: BLUE, width: 2, opacity: 1, radius: 30 }]);
  assert(isWhite(r.px(102, 102)) && near(r.px(150, 150), to255(BLUE)), 'coins arrondis : le coin est évidé');
  console.log('  ok   rect (rempli, tourné, arrondi)');

  r = await save([{ type: 'ellipse', cx: 150, cy: 150, w: 120, h: 60, rot: 0, color: RED, fill: GREEN, width: 3, opacity: 1 }]);
  assert(near(r.px(150, 150), to255(GREEN)) && isWhite(r.px(95, 175)) && isWhite(r.px(150, 190)), 'ellipse');
  console.log('  ok   ellipse');

  r = await save([{ type: 'polygon', points: [[50, 50], [250, 50], [150, 250]], color: RED, fill: GREEN, width: 3, opacity: 1 }]);
  assert(near(r.px(150, 100), to255(GREEN)) && isWhite(r.px(60, 200)), 'polygone rempli');
  console.log('  ok   polygon');

  r = await save([{ type: 'polyline', points: [[50, 50], [150, 250], [250, 50]], color: RED, width: 4, opacity: 1 }]);
  assert(near(r.px(100, 150), to255(RED), 60) && isWhite(r.px(150, 100)), 'polyligne (ouverte : pas de base, pas de remplissage)');
  assert(isWhite(r.px(150, 50)), 'polyligne non refermée');
  console.log('  ok   polyline');

  r = await save([{ type: 'cloud', points: [[50, 50], [250, 50], [250, 250], [50, 250]], arc: 20, color: RED, fill: null, width: 3, opacity: 1 }]);
  const bulge = Math.min(...[...Array(25).keys()].map((k) => 50 - k).filter((y) => !isWhite(r.px(60, y))));
  assert(bulge < 48, 'nuage : le trait dépasse du côté bas du polygone (arc sortant) → y min = ' + bulge);
  assert(isWhite(r.px(150, 150)), 'nuage non rempli');
  console.log('  ok   cloud');

  const pen = Shapes.smooth([[50, 50], [100, 120], [150, 100], [200, 180], [250, 150]], 0.5, 2);
  r = await save([{ type: 'pen', points: pen, color: BLUE, width: 4, opacity: 1 }]);
  assert(near(r.px(pen[0][0], pen[0][1]), to255(BLUE), 60) && near(r.px(pen[Math.floor(pen.length / 2)][0], pen[Math.floor(pen.length / 2)][1]), to255(BLUE), 60), 'crayon libre');
  console.log('  ok   pen');

  // Surlignage : Multiply → le noir sous le surlignage reste noir ; sur le blanc, le jaune apparaît.
  r = await save([{ type: 'highlight', color: [1, 0.9, 0.2], opacity: 1, rects: [[50, 100, 100, 20]] }], [50, 100, 50, 20]);
  const onBlack = r.px(75, 110), onWhite = r.px(125, 110);
  assert(onBlack.every((v) => v < 25), 'Multiply : le noir sous le surlignage reste noir ' + onBlack);
  assert(onWhite[0] > 240 && onWhite[1] > 200 && onWhite[2] < 90, 'surlignage jaune sur le blanc ' + onWhite);
  console.log('  ok   highlight (Multiply)');

  r = await save([{ type: 'hlrect', cx: 150, cy: 150, w: 100, h: 40, rot: 0, color: [1, 0.9, 0.2], opacity: 1 }], [100, 130, 50, 40]);
  assert(r.px(120, 150).every((v) => v < 25) && r.px(175, 150)[2] < 90, 'surlignage rectangulaire libre (Multiply)');
  console.log('  ok   hlrect');

  r = await save([{ type: 'underline', color: RED, opacity: 1, rects: [[50, 100, 100, 20]] }]);
  assert(near(r.px(100, 102), to255(RED), 70) && isWhite(r.px(100, 112)), 'soulignement (bas du rectangle de texte)');
  r = await save([{ type: 'strike', color: RED, opacity: 1, rects: [[50, 100, 100, 20]] }]);
  assert([105, 106, 107, 108].some((y) => near(r.px(100, y), to255(RED), 90)) && isWhite(r.px(100, 102)) && isWhite(r.px(100, 115)), 'texte barré (milieu)');
  console.log('  ok   underline, strike');

  // Texte amélioré : police, retour automatique, alignement, fond, bordure, rotation
  r = await save([{ type: 'add', x: 20, y: 250, text: 'Bonjour le monde éàç', size: 20, color: [0, 0, 0], font: 'Times', bold: true, italic: true, align: 'left', width: null, fill: null, border: null, rot: 0 }]);
  let items = (await r.page.getTextContent()).items.filter((i) => i.str.trim());
  assert(items.length === 1 && items[0].str === 'Bonjour le monde éàç', 'texte Times gras italique : ' + JSON.stringify(items.map((i) => i.str)));
  assert(Math.abs(items[0].transform[4] - 20) < 0.5 && Math.abs(items[0].transform[5] - 250) < 0.5 && Math.abs(items[0].transform[0] - 20) < 0.5, 'position et taille du texte');
  const fontObjName = items[0].fontName;
  const fontDesc = await new Promise((res) => r.page.commonObjs.get(fontObjName, res));
  assert(/Times/i.test(fontDesc.name || fontDesc.fallbackName || ''), 'police Times intégrée : ' + (fontDesc.name || fontDesc.fallbackName));

  r = await save([{ type: 'add', x: 20, y: 250, text: 'un deux trois quatre cinq six sept huit neuf dix', size: 12, color: [0, 0, 0], font: 'Helvetica', align: 'left', width: 90, rot: 0 }]);
  items = (await r.page.getTextContent()).items.filter((i) => i.str.trim());
  assert(items.length >= 4 && items.every((i) => Math.abs(i.transform[4] - 20) < 0.5), 'largeur fixe : ' + items.length + ' lignes alignées à gauche');
  r = await save([{ type: 'add', x: 20, y: 250, text: 'un\ndeux mots', size: 12, color: [0, 0, 0], font: 'Courier', align: 'right', width: 150, rot: 0 }]);
  items = (await r.page.getTextContent()).items.filter((i) => i.str.trim());
  assert(items.length === 2 && items[0].transform[4] > 100 && items[1].transform[4] > 60, 'alignement à droite (largeur fixe)');
  r = await save([{ type: 'add', x: 100, y: 150, text: 'Fond', size: 20, color: [0, 0, 0], font: 'Helvetica', align: 'left', fill: [1, 1, 0], border: [1, 0, 0], rot: 0 }]);
  assert(r.px(98, 160)[2] < 120 && r.px(98, 160)[0] > 200, 'fond jaune derrière le texte (marge)');
  r = await save([{ type: 'add', x: 100, y: 150, text: 'Tourné', size: 20, color: [0, 0, 0], font: 'Helvetica', align: 'left', rot: 90 }]);
  items = (await r.page.getTextContent()).items.filter((i) => i.str.trim());
  assert(items.length === 1 && Math.abs(items[0].transform[1]) > 15 && Math.abs(items[0].transform[0]) < 1, 'texte tourné de 90°');
  console.log('  ok   add (police, retour à la ligne, alignement, fond/bordure, rotation)');

  // Ordre : le dernier objet est dessiné au-dessus
  r = await save([
    { type: 'rect', cx: 150, cy: 150, w: 100, h: 100, rot: 0, color: RED, fill: RED, width: 0, opacity: 1, radius: 0 },
    { type: 'rect', cx: 150, cy: 150, w: 60, h: 60, rot: 0, color: BLUE, fill: BLUE, width: 0, opacity: 1, radius: 0 },
  ]);
  assert(near(r.px(150, 150), to255(BLUE)) && near(r.px(110, 150), to255(RED)), 'ordre d\'empilement = ordre des objets');
  console.log('  ok   ordre');

  // Opacité et tirets
  r = await save([{ type: 'rect', cx: 150, cy: 150, w: 100, h: 100, rot: 0, color: [0, 0, 0], fill: [0, 0, 0], width: 0, opacity: 0.5, radius: 0 }]);
  assert(r.px(150, 150).every((v) => v > 110 && v < 145), 'opacité 50 % : gris moyen ' + r.px(150, 150));
  r = await save([{ type: 'line', points: [[20, 50], [280, 50]], color: [0, 0, 0], width: 3, opacity: 1, dash: 'dash' }]);
  const row = [...Array(260).keys()].map((k) => r.px(20 + k, 50)[0] < 128);
  const transitions = row.filter((v, i) => i && v !== row[i - 1]).length;
  assert(transitions >= 10, 'trait en tirets : ' + transitions + ' transitions');
  console.log('  ok   opacité, tirets');

  console.log('OK : géométrie et enregistrement de chaque type d\'annotation.');
})().catch((e) => { console.error('ÉCHEC :', e); process.exit(1); });
