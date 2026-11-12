// Numérotation des pages : règles (formats, départ, plages, parité, jetons), règles qui se chevauchent, suivi après opérations de pages,
// historique, écriture dans le PDF relue avec pdf.js (texte et position sur page portrait, paysage, /Rotate 90, recadrée), page de sortie
// d'un sous-ensemble. Usage : node test/test-numbering.js
const assert = require('assert');
const PDFLib = require('@cantoo/pdf-lib');
const N = require('../src/numbering.js');
const PO = require('../src/page-ops.js');
const DM = require('../src/doc-model.js');
const Shapes = require('../src/shapes.js');
const { applyEdits } = require('../src/pdf-edit.js');

const MM = 72 / 25.4;
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg || ''} ${a} ≠ ${b}`);
const measure = Shapes.makeMeasure(PDFLib);
const mkPages = (n) => PO.identity(n).pages;
const texts = (rules, pages) => N.resolve(rules, pages).map((l) => l.map((x) => x.text).join('|'));

(async () => {
  // ---- formats
  assert.deepStrictEqual([1, 4, 9, 14, 40, 90, 1994, 3999].map((n) => N.formatNumber(n, 'i')), ['i', 'iv', 'ix', 'xiv', 'xl', 'xc', 'mcmxciv', 'mmmcmxcix']);
  assert.strictEqual(N.formatNumber(14, 'I'), 'XIV');
  assert.deepStrictEqual([1, 2, 26, 27, 52, 53].map((n) => N.formatNumber(n, 'a')), ['a', 'b', 'z', 'aa', 'az', 'ba']);
  assert.strictEqual(N.formatNumber(3, 'A'), 'C');
  assert.strictEqual(N.formatNumber(0, 'i'), '0', 'romain hors limites : chiffres');
  assert.strictEqual(N.formatNumber(7, '1'), '7');

  // ---- plages, départ, jetons
  const pages = mkPages(6);
  const u = (i) => pages[i].u;
  // « 1 à la page 3 jusqu'à la fin »
  let r = N.newRule({ fromU: u(2), text: '{n}' });
  assert.deepStrictEqual(texts([r], pages), ['', '', '1', '2', '3', '4']);
  // départ à 5, « Page {n} / {total} » : total = pages concernées (4)
  r = N.newRule({ fromU: u(2), start: 5, text: 'Page {n} / {total}' });
  assert.deepStrictEqual(texts([r], pages), ['', '', 'Page 5 / 4', 'Page 6 / 4', 'Page 7 / 4', 'Page 8 / 4']);
  // total du document, position {page}
  r = N.newRule({ text: '{page}/{total}', totalMode: 'doc' });
  assert.deepStrictEqual(texts([r], pages), ['1/6', '2/6', '3/6', '4/6', '5/6', '6/6']);
  // plage X à Y
  r = N.newRule({ fromU: u(1), toU: u(3), text: '{n}' });
  assert.deepStrictEqual(texts([r], pages), ['', '1', '2', '3', '', '']);
  // sauf la première page
  r = N.newRule({ skipFirst: true });
  assert.deepStrictEqual(texts([r], pages), ['', '1', '2', '3', '4', '5']);
  // paires seulement / impaires seulement (position dans le document)
  assert.deepStrictEqual(texts([N.newRule({ parity: 'even' })], pages), ['', '1', '', '2', '', '3']);
  assert.deepStrictEqual(texts([N.newRule({ parity: 'odd', start: 10 })], pages), ['10', '', '11', '', '12', '']);
  // romains, lettres
  assert.deepStrictEqual(texts([N.newRule({ format: 'i', text: '{n}', toU: u(2) })], pages).slice(0, 4), ['i', 'ii', 'iii', '']);
  assert.deepStrictEqual(texts([N.newRule({ format: 'A', text: '{n}', start: 25 })], pages).slice(0, 4), ['Y', 'Z', 'AA', 'AB']);
  // règle désactivée ; caractères hors WinAnsi remplacés
  assert.deepStrictEqual(texts([N.newRule({ enabled: false })], pages), ['', '', '', '', '', '']);
  assert.strictEqual(N.resolve([N.newRule({ text: 'Page → {n}' })], pages)[0][0].text, 'Page ? 1');
  // deux règles qui se chevauchent : les deux étiquettes sur les pages communes
  const A = N.newRule({ id: 1, fromU: u(1), toU: u(4), text: 'Page {n} / {total}', pos: 'br' });
  const B = N.newRule({ id: 2, fromU: u(3), text: 'A-{n}', pos: 'tl', start: 1 });
  assert.deepStrictEqual(texts([A, B], pages), ['', 'Page 1 / 4', 'Page 2 / 4', 'Page 3 / 4|A-1', 'Page 4 / 4|A-2', 'A-3']);
  assert.strictEqual(N.summary(A, pages), 'pages 2 à 5');
  assert.strictEqual(N.summary(B, pages), 'pages 4 à la fin');

  // ---- suivi après opérations de pages (supprimer, réordonner, insérer)
  const doc = DM.createDoc({ name: 't.pdf' });
  const id = PO.identity(6);
  DM.initPages(doc, id.pages, id.nextUid);
  const U = id.pages.map((p) => p.u);
  DM.setNumbering(doc, [N.newRule({ id: 1, fromU: U[1], toU: U[4], text: '{n}' })]);
  assert(doc.dirty && doc.undo.length === 1);
  let st = () => DM.pageState(doc);
  DM.setPagesState(doc, PO.remove(st(), [1])); // supprime la page de début d'étendue : le début passe à la page suivante
  assert.strictEqual(doc.numbering[0].fromU, U[2]);
  assert.deepStrictEqual(texts(doc.numbering, doc.pages), ['', '1', '2', '3', '']);
  DM.setPagesState(doc, PO.remove(st(), [3])); // supprime la page de fin (U[4]) : la fin recule
  assert.strictEqual(doc.numbering[0].toU, U[3]);
  assert.deepStrictEqual(texts(doc.numbering, doc.pages), ['', '1', '2', '']);
  DM.setPagesState(doc, PO.insert(st(), 2, [{ src: 'blank:595x842', i: 0 }])); // insertion à l'intérieur : la page insérée est numérotée
  assert.deepStrictEqual(texts(doc.numbering, doc.pages), ['', '1', '2', '3', '']);
  DM.undo(doc); // annule l'insertion
  assert.deepStrictEqual(texts(doc.numbering, doc.pages), ['', '1', '2', '']);
  DM.undo(doc); DM.undo(doc);
  assert.strictEqual(doc.numbering[0].fromU, U[1]);
  assert.deepStrictEqual(texts(doc.numbering, doc.pages), ['', '1', '2', '3', '4', '']);
  DM.redo(doc);
  assert.strictEqual(doc.numbering[0].fromU, U[2], 'rétablir restaure aussi la règle');
  // réordonner : la page suit (ici, la page U[3] passe en tête)
  const d2 = DM.createDoc({}); DM.initPages(d2, mkPages(5), 6);
  const U2 = d2.pages.map((p) => p.u);
  DM.setNumbering(d2, [N.newRule({ id: 1, fromU: U2[2], text: '{n}' })]); // pages 3 à la fin
  DM.setPagesState(d2, PO.move(DM.pageState(d2), [4], 0)); // dernière page placée en tête
  assert.deepStrictEqual(texts(d2.numbering, d2.pages), ['', '', '', '1', '2'], 'la règle suit la page de début ; la fin de document reste la fin');
  // toutes les pages supprimées d'une plage : règle sans page
  const d3 = DM.createDoc({}); DM.initPages(d3, mkPages(4), 5);
  const U3 = d3.pages.map((p) => p.u);
  DM.setNumbering(d3, [N.newRule({ id: 1, fromU: U3[1], toU: U3[1] })]);
  DM.setPagesState(d3, PO.remove(DM.pageState(d3), [1]));
  assert.strictEqual(d3.numbering[0].dead, true, 'étendue entièrement supprimée : règle sans page');
  assert.deepStrictEqual(texts(d3.numbering, d3.pages), ['', '', '']);
  DM.undo(d3);
  assert(!d3.numbering[0].dead && d3.numbering[0].fromU === U3[1], 'annuler rend la règle');

  // ---- écriture dans le PDF, relue avec pdf.js
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const src = await PDFLib.PDFDocument.create();
  src.addPage([595, 842]); // 0 portrait
  src.addPage([842, 595]); // 1 paysage
  const rotP = src.addPage([595, 842]); rotP.setRotation(PDFLib.degrees(90)); // 2 /Rotate 90
  const cropP = src.addPage([595, 842]); cropP.setCropBox(50, 100, 400, 500); // 3 CropBox différente
  src.addPage([595, 842]); // 4
  const bytes = await src.save();
  const idn = PO.identity(5);
  const rules = [
    N.newRule({ id: 1, fromU: idn.pages[0].u, toU: idn.pages[3].u, text: 'Page {n} / {total}', pos: 'bc', size: 12, my: 10, mx: 12 }),
    N.newRule({ id: 2, fromU: idn.pages[1].u, text: 'A-{n}', pos: 'tl', size: 10, mx: 15, my: 8, bold: true, format: 'A' }),
    N.newRule({ id: 3, fromU: idn.pages[4].u, text: 'Fin {page}', pos: 'mr', size: 9, mx: 5 }),
  ];
  const labels = N.resolve(rules, idn.pages);
  const out = await applyEdits(PDFLib, bytes, [], { images: {}, measure: { scales: {}, unit: 'm', precision: 2, include: true }, pages: { list: idn.pages, sources: {} }, numbering: labels });
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(out), verbosity: 0 }).promise;
  const item = async (pi, text) => {
    const p = await pdf.getPage(pi + 1);
    const tc = await p.getTextContent();
    const it = tc.items.find((x) => x.str === text);
    assert(it, `texte « ${text} » introuvable page ${pi + 1} : ${tc.items.map((x) => x.str).join(' / ')}`);
    const vp = p.getViewport({ scale: 1 });
    const m = pdfjs.Util.transform(vp.transform, it.transform);
    return { u: m[4], v: m[5], a: m[0], b: m[1], vp };
  };
  const expectDisplay = (it, text, size, fontName, col, row, mxMm, myMm) => {
    const tw = measure(fontName, text, size);
    const Wd = it.vp.width, Hd = it.vp.height;
    const eu = col === 'l' ? mxMm * MM : col === 'r' ? Wd - mxMm * MM - tw : (Wd - tw) / 2;
    const ev = row === 't' ? myMm * MM + 0.75 * size : row === 'b' ? Hd - myMm * MM - 0.2 * size : Hd / 2 + 0.35 * size;
    near(it.u, eu, 0.6, 'x affiché'); near(it.v, ev, 0.6, 'y affiché');
    assert(it.a > 0 && Math.abs(it.b) < 1e-6, 'texte droit dans l\'orientation affichée');
  };
  expectDisplay(await item(0, 'Page 1 / 4'), 'Page 1 / 4', 12, 'Helvetica', 'c', 'b', 12, 10); // portrait
  expectDisplay(await item(1, 'Page 2 / 4'), 'Page 2 / 4', 12, 'Helvetica', 'c', 'b', 12, 10); // paysage
  expectDisplay(await item(2, 'Page 3 / 4'), 'Page 3 / 4', 12, 'Helvetica', 'c', 'b', 12, 10); // /Rotate 90 : droit à l'affichage
  expectDisplay(await item(3, 'Page 4 / 4'), 'Page 4 / 4', 12, 'Helvetica', 'c', 'b', 12, 10); // recadrée : par rapport à la zone visible
  expectDisplay(await item(1, 'A-A'), 'A-A', 10, 'Helvetica-Bold', 'l', 't', 15, 8); // 2e règle (haut gauche, gras), même page
  expectDisplay(await item(3, 'A-C'), 'A-C', 10, 'Helvetica-Bold', 'l', 't', 15, 8);
  expectDisplay(await item(4, 'Fin 5'), 'Fin 5', 9, 'Helvetica', 'r', 'm', 5, 0);
  const p3 = await pdf.getPage(3);
  assert.strictEqual(p3.rotate, 90, 'la rotation de la page est conservée');
  const p4 = await pdf.getPage(4);
  near(p4.view[2] - p4.view[0], 400, 0.01, 'zone visible conservée');
  assert.strictEqual((await (await pdf.getPage(1)).getTextContent()).items.filter((x) => /A-/.test(x.str)).length, 0, 'page 1 : pas de 2e règle');

  // miroir recto-verso : pages paires (versos) à droite
  const mir = N.newRule({ fromU: idn.pages[0].u, text: '{page}', pos: 'bl', mirror: true, mx: 20, my: 8 });
  const out2 = await applyEdits(PDFLib, bytes, [], { images: {}, measure: { scales: {} }, pages: { list: idn.pages, sources: {} }, numbering: N.resolve([mir], idn.pages) });
  const pdf2 = await pdfjs.getDocument({ data: new Uint8Array(out2), verbosity: 0 }).promise;
  const x1 = (await (await pdf2.getPage(1)).getTextContent()).items.find((x) => x.str === '1').transform[4];
  const x2 = (await (await pdf2.getPage(2)).getTextContent()).items.find((x) => x.str === '2').transform[4];
  near(x1, 20 * MM, 0.6, 'recto : à gauche');
  assert(x2 > 700, 'verso (page 2) : miroir, à droite : ' + x2);

  // numérotation reportée sur un sous-ensemble de pages (extraction) : les étiquettes suivent la page
  const sub = PO.subset(PO.identity(5) && { pages: idn.pages, edits: [], scales: {}, nextId: 1, nextUid: idn.nextUid }, [2, 3]);
  const out3 = await applyEdits(PDFLib, bytes, [], { images: {}, measure: { scales: {} }, pages: { list: sub.pages, sources: {} }, numbering: sub.pages.map((p) => labels[idn.pages.findIndex((q) => q.u === p.u)]) });
  const pdf3 = await pdfjs.getDocument({ data: new Uint8Array(out3), verbosity: 0 }).promise;
  assert.strictEqual(pdf3.numPages, 2);
  const t0 = (await (await pdf3.getPage(1)).getTextContent()).items.map((x) => x.str).filter(Boolean).sort();
  assert.deepStrictEqual(t0, ['A-B', 'Page 3 / 4'], 'la page 3 du document garde ses étiquettes (« Page 3 / 4 », « A-B »)');

  // sans numérotation : fichier inchangé quant au texte
  const plain = await applyEdits(PDFLib, bytes, [], { images: {}, measure: { scales: {} }, pages: { list: idn.pages, sources: {} }, numbering: [] });
  const pdf4 = await pdfjs.getDocument({ data: new Uint8Array(plain), verbosity: 0 }).promise;
  assert.strictEqual((await (await pdf4.getPage(1)).getTextContent()).items.length, 0);
  console.log('OK : numérotation (formats, plages, parité, jetons, chevauchement, suivi des pages, historique, écriture et relecture pdf.js).');
})().catch((e) => { console.error('ECHEC', e); process.exit(1); });
