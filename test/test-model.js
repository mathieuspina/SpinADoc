// Tests : documents indépendants, historique, onglets, fichiers récents, recherche, registre de types.
const assert = require('assert');
const PDFLib = require('@cantoo/pdf-lib');
const M = require('../src/doc-model.js');
const R = require('../src/recents.js');
const S = require('../src/search.js');
const PdfEdit = require('../src/pdf-edit.js');

(async () => {
  // --- plusieurs documents indépendants ---
  const a = M.createDoc({ name: 'a.pdf', path: 'C:\\x\\a.pdf' });
  const b = M.createDoc({ name: 'b.pdf', path: 'C:\\x\\b.pdf' });
  assert.notStrictEqual(a.id, b.id);
  const ida = M.addEdit(a, { page: 0, type: 'add', x: 1, y: 2, text: 'A', size: 12, color: [0, 0, 0] });
  assert.strictEqual(a.edits.length, 1);
  assert.strictEqual(b.edits.length, 0, 'le document b ne doit pas être touché');
  assert(a.dirty && !b.dirty);
  M.addEdit(b, { page: 0, type: 'add', x: 1, y: 2, text: 'B', size: 12, color: [0, 0, 0] });
  M.updateEdit(a, ida, { text: 'A2' });
  assert.strictEqual(M.getEdit(a, ida).text, 'A2');
  assert.strictEqual(b.edits[0].text, 'B');
  // annuler / rétablir propres à chaque document
  assert(M.undo(a));
  assert.strictEqual(M.getEdit(a, ida).text, 'A');
  assert(M.undo(a));
  assert.strictEqual(a.edits.length, 0);
  assert(!M.undo(a));
  assert.strictEqual(b.edits.length, 1, 'annuler a ne touche pas b');
  assert(M.redo(a) && M.redo(a));
  assert.strictEqual(M.getEdit(a, ida).text, 'A2');
  M.markSaved(a);
  assert(!a.dirty);
  M.removeEdit(a, ida);
  assert(a.dirty && a.edits.length === 0);

  // --- état « modifié » = position dans l'historique ---
  const h = M.createDoc({ name: 'h.pdf' });
  assert(!h.dirty, 'neuf : non modifié');
  const E = (t) => ({ page: 0, type: 'add', x: 0, y: 0, text: t, size: 12, color: [0, 0, 0] });
  M.addEdit(h, E('1'));
  assert(h.dirty);
  M.undo(h);
  assert(!h.dirty, 'annuler jusqu\'à l\'état de départ : non modifié');
  M.redo(h);
  assert(h.dirty);
  M.markSaved(h);
  assert(!h.dirty, 'enregistré : non modifié');
  M.addEdit(h, E('2'));
  assert(h.dirty);
  M.undo(h);
  assert(!h.dirty, 'annuler jusqu\'à l\'état enregistré : non modifié');
  M.undo(h);
  assert(h.dirty, 'avant l\'état enregistré : modifié');
  M.redo(h);
  assert(!h.dirty);
  // une nouvelle modification après un annuler ne doit jamais être confondue avec l'état enregistré
  M.addEdit(h, E('2'));
  M.markSaved(h);
  M.undo(h);
  M.addEdit(h, E('autre'));
  assert(h.dirty, 'même longueur d\'historique mais contenu différent : modifié');
  // sélection d'une modification supprimée par annuler
  const h2 = M.createDoc({});
  const hid = M.addEdit(h2, E('x'));
  h2.selection = [hid];
  M.undo(h2);
  assert.deepStrictEqual(h2.selection, []);
  // opérations groupées : une seule étape d'historique
  const h3 = M.createDoc({});
  const ids = M.addEdits(h3, [E('a'), E('b'), E('c')]);
  assert.strictEqual(ids.length, 3);
  assert.strictEqual(h3.undo.length, 1);
  M.updateEdits(h3, [ids[0], ids[2]], { size: 30 });
  assert.deepStrictEqual(h3.edits.map((e) => e.size), [30, 12, 30]);
  assert.strictEqual(h3.undo.length, 2);
  M.setEdits(h3, [h3.edits[2], h3.edits[0], h3.edits[1]]);
  assert.deepStrictEqual(h3.edits.map((e) => e.text), ['c', 'a', 'b']);
  h3.selection = [ids[1]];
  M.removeEdits(h3, [ids[1], ids[2]]);
  assert.strictEqual(h3.edits.length, 1);
  assert.deepStrictEqual(h3.selection, []);
  M.undo(h3);
  assert.strictEqual(h3.edits.length, 3, 'annuler une suppression groupée restaure tout');
  M.undo(h3);
  assert.deepStrictEqual(h3.edits.map((e) => e.text), ['a', 'b', 'c'], "annuler le changement d'ordre");

  // --- onglets ---
  const st = M.createStore();
  const c = M.createDoc({ name: 'c.pdf', path: 'C:\\x\\c.pdf' });
  [a, b, c].forEach((d) => st.add(d));
  assert.strictEqual(st.active, c);
  assert.strictEqual(st.findByPath('c:\\X\\C.PDF'), c, 'recherche de chemin insensible à la casse');
  st.move(2, 0);
  assert.deepStrictEqual(st.docs.map((d) => d.name), ['c.pdf', 'a.pdf', 'b.pdf']);
  st.activate(a.id);
  st.cycle(1);
  assert.strictEqual(st.active, b);
  st.cycle(1);
  assert.strictEqual(st.active, c, 'circulaire');
  st.cycle(-1);
  assert.strictEqual(st.active, b);
  assert(st.anyDirty());
  st.close(b.id);
  assert.strictEqual(st.docs.length, 2);
  assert(st.active && st.active !== b, 'un voisin devient actif');
  st.close(a.id); st.close(c.id);
  assert.strictEqual(st.active, null);

  // --- fichiers récents ---
  let l = [];
  for (let i = 1; i <= 12; i++) l = R.addRecent(l, `C:\\d\\f${i}.pdf`, i);
  assert.strictEqual(l.length, 10, 'maximum 10');
  assert.strictEqual(l[0].name, 'f12.pdf');
  l = R.addRecent(l, 'c:/d/F5.PDF', 99);
  assert.strictEqual(l.length, 10);
  assert.strictEqual(l[0].date, 99, 'remonté en tête, sans doublon');
  assert.strictEqual(l.filter((e) => /f5\.pdf/i.test(e.path)).length, 1);
  assert.strictEqual(R.removeRecent(l, 'C:\\d\\f12.pdf').length, 9);

  // --- recherche ---
  const items = [{ str: 'Bonjour le ' }, { str: 'monde', hasEOL: true }, { str: 'Été à Noël' }];
  let m = S.findMatches(items, 'MONDE');
  assert.strictEqual(m.length, 1);
  assert.deepStrictEqual(m[0].parts, [{ idx: 1, from: 0, to: 5 }]);
  m = S.findMatches(items, 'le monde');
  assert.deepStrictEqual(m[0].parts.map((p) => p.idx), [0, 1], 'occurrence sur deux éléments');
  assert.strictEqual(S.findMatches(items, 'ete a noel').length, 1, 'insensible aux accents');
  assert.strictEqual(S.findMatches(items, 'o').length, 4);
  assert.strictEqual(S.findMatches(items, '  ').length, 0);

  // --- registre de types ---
  PdfEdit.registerType('test-box', {
    cover: () => { calls.push('cover'); },
    draw: () => { calls.push('draw'); },
  });
  const calls = [];
  const d = await PDFLib.PDFDocument.create();
  d.addPage([100, 100]);
  const bytes = await d.save();
  await PdfEdit.applyEdits(PDFLib, bytes, [{ page: 0, type: 'test-box' }, { page: 0, type: 'test-box' }]);
  assert.deepStrictEqual(calls, ['cover', 'cover', 'draw', 'draw'], 'deux passes');
  await assert.rejects(() => PdfEdit.applyEdits(PDFLib, bytes, [{ page: 0, type: 'inconnu' }]), /inconnu/);

  // Échelles de mesure : dans l'historique (annuler / rétablir), état « modifié »
  {
    const m = M.createDoc({ name: 'm.pdf' });
    assert.deepStrictEqual(m.measure, { scales: {}, unit: 'm', precision: 2, include: true });
    M.setMeasure(m, (x) => ({ scales: Object.assign({}, x.scales, { 0: { mmPerPt: 17.6389, source: 'ratio', ratio: 50 } }) }));
    assert(m.dirty && m.measure.scales[0].ratio === 50, 'échelle posée : document modifié');
    M.setMeasure(m, { unit: 'cm' });
    M.undo(m); assert.strictEqual(m.measure.unit, 'm', 'annuler restaure l unite');
    M.undo(m); assert.deepStrictEqual(m.measure.scales, {}, 'annuler restaure les échelles');
    assert(!m.dirty, 'retour a l etat d origine : non modifie');
    M.redo(m); assert.strictEqual(m.measure.scales[0].ratio, 50, 'rétablir');
    // mesures exclues du PDF : applyEdits ne les écrit pas quand include est faux
    const d2 = await PDFLib.PDFDocument.create(); d2.addPage([300, 300]);
    const b2 = await d2.save();
    const edit = Object.assign(require('../src/shapes.js').defaultsFor('m-dist'), { id: 1, page: 0, type: 'm-dist', points: [[10, 10], [100, 10]] });
    const withM = await PdfEdit.applyEdits(PDFLib, b2, [edit], { measure: { scales: {}, unit: 'm', precision: 2, include: true } });
    const without = await PdfEdit.applyEdits(PDFLib, b2, [edit], { measure: { scales: {}, unit: 'm', precision: 2, include: false } });
    assert(withM.length > without.length, 'include=false : mesures non écrites');
  }

  console.log('OK : modèle, onglets, récents, recherche, registre.');
})().catch((e) => { console.error('ÉCHEC :', e); process.exit(1); });
