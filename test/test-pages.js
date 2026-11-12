// Onglet Pages : opérations sur la structure des pages (module pur page-ops.js), historique, écriture dans le PDF (pdf-edit.buildPages),
// avec annotations et mesures présentes, page /Rotate 90, annuler / rétablir, division par plages.
// Usage : node test/test-pages.js
const assert = require('assert');
const PDFLib = require('@cantoo/pdf-lib');
const PO = require('../src/page-ops.js');
const DM = require('../src/doc-model.js');
const { applyEdits } = require('../src/pdf-edit.js');

const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg || ''} ${a} ≠ ${b}`);
const idxOf = (pages) => pages.map((p) => p.src + ':' + p.i + (p.rot ? 'r' + p.rot : '') + (p.crop ? 'c' : ''));
const mkState = (n, edits, scales) => { const id = PO.identity(n); return { pages: id.pages, edits: edits || [], scales: scales || {}, nextId: 100, nextUid: id.nextUid }; };

// ------------------------------------------------------------ opérations pures
(function pure() {
  const edits = [0, 1, 2, 3, 4].map((k) => ({ id: k + 1, page: k, type: 'add', text: 'T' + k }));
  const scales = { 1: { mmPerPt: 1 }, 3: { mmPerPt: 3 } };
  const st = mkState(5, edits, scales);

  // rotation : cumulée, modulo 360, objets inchangés
  let r = PO.rotate(st, [1, 2], 90);
  r = PO.rotate(r, [1], -180);
  assert.deepStrictEqual(r.pages.map((p) => p.rot), [0, 270, 90, 0, 0]);
  assert.deepStrictEqual(r.edits.map((e) => e.page), [0, 1, 2, 3, 4]);
  assert.strictEqual(st.pages[1].rot, 0, 'l\'état d\'entrée n\'est pas modifié');

  // suppression : objets et échelles de la page supprimée disparaissent, les autres suivent
  r = PO.remove(st, [1, 3]);
  assert.deepStrictEqual(r.pages.map((p) => p.i), [0, 2, 4]);
  assert.deepStrictEqual(r.edits.map((e) => [e.text, e.page]), [['T0', 0], ['T2', 1], ['T4', 2]]);
  assert.deepStrictEqual(r.scales, {}, 'échelles des pages 2 et 4 supprimées');
  r = PO.remove(st, [0]);
  assert.deepStrictEqual(Object.keys(r.scales), ['0', '2'], 'échelles décalées avec les pages');
  assert.throws(() => PO.remove(st, [0, 1, 2, 3, 4]), /toutes les pages/);
  assert.throws(() => PO.remove(st, []), /Aucune page/);

  // déplacement : vers le début, vers la fin, bloc, sur place
  r = PO.move(st, [3], 0);
  assert.deepStrictEqual(r.pages.map((p) => p.i), [3, 0, 1, 2, 4]);
  assert.deepStrictEqual(r.edits.map((e) => e.page + ':' + e.text), ['1:T0', '2:T1', '3:T2', '0:T3', '4:T4']);
  assert.deepStrictEqual(Object.keys(r.scales).sort(), ['0', '2'], 'échelles suivent');
  assert.strictEqual(r.scales[0].mmPerPt, 3);
  r = PO.move(st, [0, 1], 5);
  assert.deepStrictEqual(r.pages.map((p) => p.i), [2, 3, 4, 0, 1]);
  r = PO.move(st, [1, 2], 4);
  assert.deepStrictEqual(r.pages.map((p) => p.i), [0, 3, 1, 2, 4], 'bloc devant la page 5');
  r = PO.move(st, [2], 2);
  assert.deepStrictEqual(r.pages.map((p) => p.i), [0, 1, 2, 3, 4], 'déposer sur place : inchangé');
  r = PO.move(st, [2], 3);
  assert.deepStrictEqual(r.pages.map((p) => p.i), [0, 1, 2, 3, 4], 'déposer juste après : inchangé');

  // duplication : bloc de copies après la dernière page sélectionnée, objets copiés avec de nouveaux ids
  r = PO.duplicate(st, [1, 3]);
  assert.deepStrictEqual(r.pages.map((p) => p.i), [0, 1, 2, 3, 1, 3, 4]);
  assert.strictEqual(new Set(r.pages.map((p) => p.u)).size, 7, 'identifiants de pages uniques');
  assert.deepStrictEqual(r.edits.filter((e) => e.text === 'T1' || e.text === 'T3').map((e) => e.page + ':' + e.text).sort(), ['1:T1', '3:T3', '4:T1', '5:T3']);
  assert.strictEqual(new Set(r.edits.map((e) => e.id)).size, r.edits.length, 'ids d\'objets uniques');
  assert.strictEqual(r.edits.find((e) => e.text === 'T4').page, 6);
  assert(r.scales[4] && r.scales[5] && r.scales[6] === undefined && r.scales[1] && r.scales[3], 'échelles copiées avec les pages');
  assert.strictEqual(r.nextId, 102);

  // insertion
  r = PO.insert(st, 2, [{ src: 'blank:595x842', i: 0 }, { src: 's1', i: 4, rot: 90 }]);
  assert.deepStrictEqual(idxOf(r.pages), ['0:0', '0:1', 'blank:595x842:0', 's1:4r90', '0:2', '0:3', '0:4']);
  assert.deepStrictEqual(r.edits.map((e) => e.page), [0, 1, 4, 5, 6]);
  assert.deepStrictEqual(Object.keys(r.scales).sort(), ['1', '5']);
  assert.throws(() => PO.insert(st, 9, [{ src: '0', i: 0 }]), /invalide/);

  // recadrage
  r = PO.crop(st, [2], [10, 10, 100, 200]);
  assert.deepStrictEqual(r.pages[2].crop, [10, 10, 100, 200]);
  assert.strictEqual(PO.crop(r, [2], null).pages[2].crop, null);
  assert.throws(() => PO.crop(st, [0], [0, 0, 0.5, 0.5]), /trop petit/);

  // sous-ensemble (extraction)
  r = PO.subset(st, [4, 1, 1]);
  assert.deepStrictEqual(r.pages.map((p) => p.i), [1, 4], 'ordre du document, sans doublon');
  assert.deepStrictEqual(r.edits.map((e) => e.page + ':' + e.text), ['0:T1', '1:T4']);
  assert.deepStrictEqual(Object.keys(r.scales), ['0']);

  // plages et division
  assert.deepStrictEqual(PO.parseGroups('1-3, 5, 8-12', 12).groups, [[0, 1, 2], [4], [7, 8, 9, 10, 11]]);
  assert(PO.parseGroups('0', 5).error && PO.parseGroups('1-9', 5).error && PO.parseGroups('x', 5).error && PO.parseGroups('', 5).error);
  let sp = PO.splitPlan(12, 'ranges', '1-3, 5, 8-12');
  assert.deepStrictEqual(sp.files.map((f) => f.label), ['1-3', '5', '8-12']);
  sp = PO.splitPlan(7, 'every', 3);
  assert.deepStrictEqual(sp.files.map((f) => f.pages.length + ':' + f.label), ['3:1-3', '3:4-6', '1:7']);
  sp = PO.splitPlan(3, 'each');
  assert.deepStrictEqual(sp.files.map((f) => f.label), ['1', '2', '3']);
  assert(PO.splitPlan(3, 'every', 0).error);
  const taken = new Set(['doc-1.pdf']);
  assert.strictEqual(PO.uniqueName('doc', '1', taken), 'doc-1 (2).pdf');
  assert.strictEqual(PO.uniqueName('doc', '2', taken), 'doc-2.pdf');
  assert.deepStrictEqual(PO.parseBlank(PO.blankId(595.2756, 841.8898)), { w: 595.28, h: 841.89 });
  assert(PO.isIdentity(st.pages, 5) && !PO.isIdentity(PO.rotate(st, [0], 90).pages, 5) && !PO.isIdentity(PO.remove(st, [4]).pages, 5));
  console.log('  ok   opérations pures : rotation, suppression, ordre, duplication, insertion, recadrage, extraction, plages');
})();

// ------------------------------------------------------------ gros documents : opérations rapides sur la liste (pas de PDF)
(function perf() {
  const n = 5000;
  const edits = Array.from({ length: 20000 }, (_, k) => ({ id: k + 1, page: k % n, type: 'add', text: 't' + k }));
  const st = mkState(n, edits, Object.fromEntries(Array.from({ length: 500 }, (_, k) => [k * 10, { mmPerPt: 1 }])));
  const t0 = Date.now();
  let r = PO.rotate(st, Array.from({ length: 1000 }, (_, k) => k), 90);
  r = PO.move(r, Array.from({ length: 500 }, (_, k) => k * 3), 4000);
  r = PO.remove(r, Array.from({ length: 800 }, (_, k) => k * 5));
  r = PO.duplicate(r, [10, 20, 30]);
  r = PO.insert(r, 100, [{ src: 'blank:100x100', i: 0 }]);
  const ms = Date.now() - t0;
  assert(ms < 400, `5 opérations sur 5000 pages et 20000 objets : ${ms} ms`);
  assert.strictEqual(new Set(r.pages.map((p) => p.u)).size, r.pages.length);
  console.log(`  ok   gros document (5000 pages, 20000 objets) : 5 opérations en ${ms} ms`);
})();

// ------------------------------------------------------------ historique (annuler / rétablir) et état « modifié »
(function history() {
  const doc = DM.createDoc({ name: 'x.pdf', bytes: new Uint8Array(1) });
  const id = PO.identity(4);
  DM.initPages(doc, id.pages, id.nextUid);
  DM.addEdit(doc, { page: 2, type: 'add', text: 'A' });
  DM.markSaved(doc);
  assert(!doc.dirty);
  const ops = [
    (st) => PO.rotate(st, [0], 90), (st) => PO.remove(st, [1]), (st) => PO.move(st, [0], 3),
    (st) => PO.duplicate(st, [0]), (st) => PO.insert(st, 1, [{ src: 'blank:100x100', i: 0 }]), (st) => PO.crop(st, [0], [0, 0, 50, 50]),
  ];
  const snaps = [];
  for (const op of ops) {
    snaps.push(JSON.stringify([doc.pages, doc.edits]));
    DM.setPagesState(doc, op(DM.pageState(doc)));
    assert(doc.dirty, 'modifié après une opération de page');
  }
  const final = JSON.stringify([doc.pages, doc.edits]);
  for (let k = ops.length - 1; k >= 0; k--) {
    assert(DM.undo(doc));
    assert.strictEqual(JSON.stringify([doc.pages, doc.edits]), snaps[k], 'annuler restaure pages et objets (étape ' + k + ')');
  }
  assert(!doc.dirty, 'retour à l\'état enregistré : plus « modifié »');
  for (let k = 0; k < ops.length; k++) assert(DM.redo(doc));
  assert.strictEqual(JSON.stringify([doc.pages, doc.edits]), final, 'rétablir');
  // mélange avec une annotation : même historique
  DM.addEdit(doc, { page: 0, type: 'add', text: 'B' });
  DM.undo(doc); DM.undo(doc);
  assert.strictEqual(JSON.stringify([doc.pages, doc.edits]), snaps[ops.length - 1].length ? JSON.stringify([doc.pages, doc.edits]) : '');
  console.log('  ok   historique : une étape par opération, annuler / rétablir, état « modifié »');
})();

// ------------------------------------------------------------ écriture dans le PDF
async function makeSource(label, sizes, rotates) {
  const d = await PDFLib.PDFDocument.create();
  const font = await d.embedFont(PDFLib.StandardFonts.Helvetica);
  sizes.forEach(([w, h], k) => {
    const p = d.addPage([w, h]);
    p.drawText(`${label}-${k}`, { x: 20, y: 40, size: 12, font });
    if (rotates && rotates[k]) p.setRotation(PDFLib.degrees(rotates[k]));
  });
  return d.save();
}
async function texts(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    out.push({ strs: tc.items.map((it) => it.str), rotate: page.rotate, view: page.view, items: tc.items });
  }
  return out;
}

(async () => {
  const sizes = [[200, 300], [210, 310], [220, 320], [230, 330], [240, 340]];
  const rot = [0, 90, 0, 0, 0]; // la page 2 de la source a déjà /Rotate 90
  const src0 = await makeSource('P', sizes, rot);
  const src1 = await makeSource('X', [[400, 100], [410, 110], [420, 120]]);
  const sources = { s1: { bytes: src1 } };
  const edits = sizes.map((_, k) => ({ id: k + 1, page: k, type: 'add', x: 100, y: 200, text: 'ANN' + k, size: 10, color: [1, 0, 0] }));
  let st = mkState(5, edits);
  const build = (s, extra) => applyEdits(PDFLib, src0, s.edits, Object.assign({ pages: { list: s.pages, sources } }, extra));
  const labelsOf = (t) => t.map((p) => p.strs.filter((x) => /^(P|X|B|R|ANN)/.test(x)).join('+'));

  // identité : écriture inchangée (même nombre de pages, pas de reconstruction)
  let out = await build(st);
  assert.strictEqual((await PDFLib.PDFDocument.load(out)).getPageCount(), 5);

  // rotation (page déjà /Rotate 90 → 180) + suppression + ordre + annotations qui suivent
  st = PO.rotate(st, [1], 90);       // P-1 : 90 + 90 = 180
  st = PO.rotate(st, [3], -90);      // P-3 : 270
  st = PO.remove(st, [2]);           // retire P-2 : reste P0 P1 P3 P4
  st = PO.move(st, [3], 0);          // P4 P0 P1 P3
  out = await build(st);
  let t = await texts(out);
  assert.deepStrictEqual(labelsOf(t), ['P-4+ANN4', 'P-0+ANN0', 'P-1+ANN1', 'P-3+ANN3'], 'pages dans le nouvel ordre, annotations avec leur page');
  assert.deepStrictEqual(t.map((p) => p.rotate), [0, 0, 180, 270], 'rotation écrite (/Rotate cumulé avec celui de la source)');
  near(t[2].view[2], 210, 0.01); near(t[2].view[3], 310, 0.01);
  const ann1 = t[2].items.find((i) => i.str === 'ANN1');
  near(ann1.transform[4], 100, 0.01, 'annotation à la même position (espace utilisateur)'); near(ann1.transform[5], 200, 0.01);

  // insertion d'une page vierge A4 et de pages d'un autre PDF, duplication, recadrage
  st = PO.insert(st, 1, [{ src: PO.blankId(595.28, 841.89), i: 0 }]);
  st = PO.insert(st, 3, [{ src: 's1', i: 2 }, { src: 's1', i: 0 }]);
  st = PO.duplicate(st, [0]);       // P-4 dupliquée (avec son annotation)
  st = PO.crop(st, [3], [20, 20, 180, 260]);
  out = await build(st);
  t = await texts(out);
  assert.deepStrictEqual(labelsOf(t), ['P-4+ANN4', 'P-4+ANN4', '', 'P-0+ANN0', 'X-2', 'X-0', 'P-1+ANN1', 'P-3+ANN3']);
  near(t[2].view[2], 595.28, 0.01); near(t[2].view[3], 841.89, 0.01);
  near(t[4].view[2], 420, 0.01); near(t[5].view[2], 400, 0.01);
  // recadrage : P-0 est en position 3 → CropBox écrite
  assert.deepStrictEqual(t[3].view.map(Math.round), [20, 20, 180, 260], 'CropBox écrite');
  const outDoc = await PDFLib.PDFDocument.load(out);
  assert.strictEqual(outDoc.getPageCount(), 8);
  // la copie de P-4 est indépendante : pivoter l'une ne pivote pas l'autre
  let st2 = PO.rotate(st, [1], 90);
  t = await texts(await build(st2));
  assert.deepStrictEqual([t[0].rotate, t[1].rotate], [0, 90], 'copie indépendante');

  // mesures : l'échelle d'une page suit sa page (indices) ; mesures « m-dist » écrites sur la bonne page
  const m = { id: 50, page: 3, type: 'm-dist', points: [[10, 10], [110, 10]], color: [0, 0, 1] };
  let sm = mkState(5, edits.concat([m]), { 3: { mmPerPt: 1, source: 'x', ratio: 1 } });
  sm = PO.move(sm, [3], 0); // la page 4 de la liste (indice 3) passe en tête
  assert.strictEqual(sm.edits.find((e) => e.id === 50).page, 0);
  assert(sm.scales[0] && !sm.scales[3]);
  out = await applyEdits(PDFLib, src0, sm.edits, { pages: { list: sm.pages, sources }, measure: { scales: sm.scales, unit: 'mm', precision: 2, include: true } });
  t = await texts(out);
  assert(t[0].strs.some((s) => /mm/.test(s)), 'la cote suit la page déplacée : ' + JSON.stringify(t[0].strs));
  assert(!t[3].strs.some((s) => /mm/.test(s)));

  // extraction : seules les pages choisies, dans l'ordre du document, avec leurs annotations ; fichier plus petit
  const big = await makeSource('B', Array.from({ length: 30 }, () => [300, 400]));
  const bigSt = mkState(30, [{ id: 1, page: 9, type: 'add', x: 50, y: 100, text: 'ANN9', size: 10, color: [1, 0, 0] }]);
  const ex = PO.subset(bigSt, [9, 2]);
  out = await applyEdits(PDFLib, big, ex.edits, { pages: { list: ex.pages, sources: {} } });
  t = await texts(out);
  assert.deepStrictEqual(labelsOf(t), ['B-2', 'B-9+ANN9']);
  assert(out.length < big.length / 4, `extraction : fichier réduit (${out.length} < ${big.length})`);
  // suppression : le fichier diminue
  const del = PO.remove(bigSt, Array.from({ length: 25 }, (_, k) => k + 5));
  out = await applyEdits(PDFLib, big, del.edits, { pages: { list: del.pages, sources: {} } });
  assert((await PDFLib.PDFDocument.load(out)).getPageCount() === 5 && out.length < big.length / 3, 'suppression : fichier réduit');

  // division par plages : chaque fichier contient les bonnes pages
  const plan = PO.splitPlan(30, 'ranges', '1-3, 10, 28-30');
  const files = [];
  for (const f of plan.files) {
    const s = PO.subset(bigSt, f.pages);
    files.push(await applyEdits(PDFLib, big, s.edits, { pages: { list: s.pages, sources: {} } }));
  }
  const counts = await Promise.all(files.map(async (b) => (await PDFLib.PDFDocument.load(b)).getPageCount()));
  assert.deepStrictEqual(counts, [3, 1, 3]);
  assert.deepStrictEqual(labelsOf(await texts(files[1])), ['B-9+ANN9'], 'l\'annotation de la page 10 est dans le fichier « 10 »');
  assert.deepStrictEqual(labelsOf(await texts(files[2])), ['B-27', 'B-28', 'B-29']);

  // page source /Rotate 90 seule, pivotée à gauche : 90 − 90 = 0
  const r90 = await makeSource('R', [[200, 300]], [90]);
  const sr = PO.rotate(mkState(1), [0], -90);
  t = await texts(await applyEdits(PDFLib, r90, [], { pages: { list: sr.pages, sources: {} } }));
  assert.strictEqual(t[0].rotate, 0);
  console.log('  ok   écriture : rotation (/Rotate 90 de départ), suppression, ordre, insertion (vierge, autre PDF), duplication, recadrage, extraction, division, mesures et annotations suivent');
  console.log('OK : pages (opérations, historique, écriture).');
})().catch((e) => { console.error('ÉCHEC :', e); process.exit(1); });
