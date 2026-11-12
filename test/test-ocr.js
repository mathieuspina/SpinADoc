// OCR (logique pure) : plan de rendu par tuiles, rotation des boîtes, conversion en coordonnées PDF, fusion, ordre de lecture, éléments de recherche,
// texte natif, historique (une étape par lot, annuler / rétablir) et suivi des opérations de pages (rotation, suppression, déplacement, recadrage,
// duplication), écriture de la couche de texte invisible relue avec pdf.js (texte, position, largeur, aucun tracé ajouté).
// La reconnaissance elle-même (tesseract.js dans le moteur de rendu) est testée par test-ocr-ui. Usage : node test/test-ocr.js
const PDFLib = require('@cantoo/pdf-lib');
const Ocr = require('../src/ocr.js');
const DocModel = require('../src/doc-model.js');
const PageOps = require('../src/page-ops.js');
const PdfEdit = require('../src/pdf-edit.js');

const failures = [];
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   ', name); }
  else { failures.push(name); console.log('  ECHEC', name, detail !== undefined ? '→ ' + JSON.stringify(detail) : ''); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

(async () => {
  console.log('1. Plan de rendu');
  const a4 = Ocr.plan(595, 842, { quality: 'standard', mode: 'text' });
  check('A4 standard : une seule tuile, ≈ 300 dpi', a4.tiles.length === 1 && !a4.tiled && near(a4.dpi, 300, 0.5), [a4.tiles.length, a4.dpi]);
  const a0 = Ocr.plan(2384, 3370, { quality: 'standard', mode: 'text' });
  check('A0 standard : tuilé, au plus 80 tuiles, au moins 170 dpi', a0.tiled && a0.tiles.length <= Ocr.MAX_TILES && a0.dpi >= 170, [a0.tiles.length, Math.round(a0.dpi)]);
  const a0f = Ocr.plan(2384, 3370, { quality: 'fast', mode: 'plan' });
  check('A0 rapide (plan) : 150 dpi, moins de tuiles que le standard', a0f.dpi <= 151 && a0f.tiles.length < a0.tiles.length, [Math.round(a0f.dpi), a0f.tiles.length]);
  const a4p = Ocr.plan(595, 842, { quality: 'standard', mode: 'plan' });
  check('mode plan : toujours par tuiles (texte clairsemé)', a4p.tiled);
  // couverture
  const W = 5000, H = 3300, tl = Ocr.tileRects(W, H);
  const cov = new Uint8Array(W * H / 100);
  for (const t of tl) for (let y = t.y; y < t.y + t.h; y += 10) for (let x = t.x; x < t.x + t.w; x += 10) cov[(y / 10 | 0) * (W / 10) + (x / 10 | 0)] = 1;
  check('les tuiles couvrent toute la page, sans dépasser', cov.every((v) => v === 1) && tl.every((t) => t.x + t.w <= W && t.y + t.h <= H && t.w > 0 && t.h > 0), tl.length);

  console.log('2. Rotation de lecture et conversion en coordonnées PDF');
  // image d'origine 400 × 200 ; la boîte (50, 20)-(150, 60) tournée de θ doit se retrouver à sa place
  const rotPt = (x, y, th, w, h) => (th === 90 ? [h - y, x] : th === 180 ? [w - x, h - y] : th === 270 ? [y, w - x] : [x, y]);
  let ok = true;
  for (const th of [0, 90, 180, 270]) {
    const p = rotPt(50, 20, th, 400, 200), q = rotPt(150, 60, th, 400, 200);
    const b = Ocr.unrotateBox({ x0: Math.min(p[0], q[0]), y0: Math.min(p[1], q[1]), x1: Math.max(p[0], q[0]), y1: Math.max(p[1], q[1]) }, th, 400, 200);
    if (!(near(b.x0, 50, 1e-9) && near(b.y0, 20, 1e-9) && near(b.x1, 150, 1e-9) && near(b.y1, 60, 1e-9))) ok = false;
  }
  check('unrotateBox : retrouve la boîte d\'origine pour 0°, 90°, 180°, 270°', ok);
  const conv = (px, py) => [px / 4, 842 - py / 4]; // viewport non pivoté, 4 px par point
  const w1 = Ocr.toUser([{ t: 'a', x0: 400, y0: 100, x1: 800, y1: 180, c: 90 }], { x: 40, y: 60, w: 2000, h: 2000 }, 0, conv, 0)[0];
  check('pixels de tuile → points PDF (décalage de tuile, y vers le haut)', near(w1.x0, 110, 1e-6) && near(w1.x1, 210, 1e-6) && near(w1.y1, 842 - 40, 1e-6) && near(w1.y0, 842 - 60, 1e-6) && w1.a === 0, w1);
  check('texte lu après rotation de 90° : angle 90° (de bas en haut)', Ocr.toUser([{ t: 'a', x0: 0, y0: 0, x1: 10, y1: 5, c: 90 }], { x: 0, y: 0, w: 100, h: 100 }, 90, conv, 0)[0].a === 90);
  check('page native /Rotate 90 : l\'angle utilisateur tient compte de la rotation du viewport', Ocr.toUser([{ t: 'a', x0: 0, y0: 0, x1: 10, y1: 5, c: 90 }], { x: 0, y: 0, w: 100, h: 100 }, 0, conv, 90)[0].a === 90);

  console.log('3. Résultats : conversion, fusion, ordre de lecture, recherche');
  const blocks = [{ paragraphs: [{ lines: [{ words: [{ text: 'Poutre', confidence: 96, bbox: { x0: 10, y0: 10, x1: 90, y1: 40 } }, { text: '  ', confidence: 90, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } }, { text: 'bruit', confidence: 3, bbox: { x0: 100, y0: 10, x1: 140, y1: 40 } }, { text: 'IPE', confidence: 80, bbox: { x0: 100, y0: 10, x1: 140, y1: 40 } }] }] }] }];
  const fw = Ocr.wordsFromBlocks(blocks);
  check('mots extraits : vides et bruit (confiance < 8) écartés', fw.length === 2 && fw[0].t === 'Poutre' && fw[1].t === 'IPE', fw);
  const merged = Ocr.mergeWords([[{ t: 'IPE', x0: 100, y0: 10, x1: 140, y1: 40, c: 70, a: 0 }, { t: 'seul', x0: 300, y0: 10, x1: 340, y1: 40, c: 90, a: 0 }], [{ t: 'IPE', x0: 102, y0: 11, x1: 141, y1: 41, c: 95, a: 0 }, { t: 'lPE', x0: 101, y0: 10, x1: 139, y1: 40, c: 40, a: 0 }]]);
  check('fusion des tuiles : doublons supprimés, le plus sûr gardé', merged.length === 2 && merged.find((w) => w.x0 < 200).c === 95, merged);
  const words = [
    { t: 'deux', x0: 100, y0: 700, x1: 140, y1: 712, c: 90, a: 0 }, { t: 'Ligne', x0: 50, y0: 700, x1: 95, y1: 712, c: 90, a: 0 },
    { t: 'Haut', x0: 50, y0: 780, x1: 90, y1: 792, c: 90, a: 0 }, { t: 'Axe', x0: 30, y0: 300, x1: 42, y1: 330, c: 85, a: 90 },
  ];
  check('texte de la page : lignes de haut en bas, mots de gauche à droite, texte pivoté à la fin', Ocr.pageText(words) === 'Haut\nLigne deux\nAxe', Ocr.pageText(words));
  const its = Ocr.items(words), S = require('../src/search.js');
  const m = S.findMatches(its, 'ligne deux');
  check('recherche : une expression sur plusieurs mots est trouvée (sans accents ni casse)', m.length === 1 && m[0].parts.length === 2 && its[m[0].parts[0].idx].ocr === true, m.length);
  check('éléments de recherche non modifiables, avec leur boîte', its.every((i) => i.editable === false && i.box.length === 4));
  const vb = Ocr.viewBox({ t: 'x', x0: 100, y0: 700, x1: 140, y1: 712, a: 0 }, { rotation: 0, convertToViewportRectangle: (r) => [r[0] * 2, 1684 - r[1] * 2, r[2] * 2, 1684 - r[3] * 2] });
  check('boîte d\'affichage : longueur 80, épaisseur 24, sans rotation', vb.len === 80 && vb.thick === 24 && vb.rot === 0, vb);
  const vv = Ocr.viewBox({ t: 'x', x0: 30, y0: 300, x1: 42, y1: 330, a: 90 }, { rotation: 0, convertToViewportRectangle: (r) => [r[0], 842 - r[1], r[2], 842 - r[3]] });
  check('mot vertical : longueur = hauteur de la boîte, rotation CSS 270°', vv.len === 30 && vv.thick === 12 && vv.rot === 270, vv);
  const vr = Ocr.viewBox({ t: 'x', x0: 30, y0: 300, x1: 42, y1: 330, a: 90 }, { rotation: 90, convertToViewportRectangle: (r) => [r[0], r[1], r[2], r[3]] });
  check('page affichée tournée de 90° : le mot vertical devient horizontal', vr.rot === 0, vr);
  check('texte natif : seuil de caractères', Ocr.hasNativeText([{ str: 'Bonjour le monde' }]) && !Ocr.hasNativeText([{ str: '12' }, { str: ' ' }]) && !Ocr.hasNativeText([]));

  console.log('4. Historique et opérations de pages');
  const rec = (t) => Ocr.makeRecord([{ t, x0: 10, y0: 10, x1: 60, y1: 22, c: 90, a: 0 }], { lang: 'fra+eng', quality: 'standard', mode: 'text' });
  const doc = DocModel.createDoc({ name: 'scan.pdf', bytes: new Uint8Array(1) });
  const id = PageOps.identity(4);
  DocModel.initPages(doc, id.pages, id.nextUid);
  const u = doc.pages.map((p) => p.u);
  DocModel.setOcr(doc, { [u[0]]: rec('un'), [u[1]]: rec('deux'), [u[2]]: rec('trois') });
  check('un lot = UNE étape d\'historique, document modifié', doc.undo.length === 1 && doc.dirty && Object.keys(doc.ocr).length === 3);
  DocModel.undo(doc);
  check('annuler : le texte reconnu disparaît', Object.keys(doc.ocr).length === 0 && !doc.dirty);
  DocModel.redo(doc);
  check('rétablir : il revient (mêmes enregistrements)', doc.ocr[u[1]].words[0].t === 'deux');
  const st = (fn) => { const s = fn(DocModel.pageState(doc)); DocModel.setPagesState(doc, s); };
  st((s) => PageOps.rotate(s, [1], 90));
  check('rotation : l\'enregistrement suit la page (même uid, géométrie source)', doc.ocr[u[1]].words[0].t === 'deux');
  st((s) => PageOps.move(s, [0], 3));
  check('déplacement : le texte reste attaché à sa page', doc.pages.find((p) => p.u === u[0]) && doc.ocr[u[0]].words[0].t === 'un');
  st((s) => PageOps.crop(s, [2], [5, 5, 100, 100]));
  check('recadrage : le texte reste attaché', doc.ocr[u[2]].words[0].t === 'trois');
  st((s) => PageOps.duplicate(s, [doc.pages.findIndex((p) => p.u === u[1])]));
  const dup = doc.pages.filter((p) => p.src === doc.pages.find((q) => q.u === u[1]).src && p.i === doc.pages.find((q) => q.u === u[1]).i);
  check('duplication : la copie (nouvel uid) hérite du texte reconnu', dup.length === 2 && dup.every((p) => doc.ocr[p.u] && doc.ocr[p.u].words[0].t === 'deux'), dup.map((p) => p.u));
  st((s) => PageOps.remove(s, [doc.pages.findIndex((p) => p.u === u[0])]));
  const keep = doc.ocr[u[0]];
  DocModel.undo(doc);
  check('suppression puis annulation : la page et son texte reviennent', doc.pages.some((p) => p.u === u[0]) && !!doc.ocr[u[0]] && keep === doc.ocr[u[0]]);
  const snapPages = doc.undo.length;
  DocModel.setOcr(doc, { [u[1]]: null });
  check('retrait du texte d\'une page : étape annulable', !doc.ocr[u[1]] && doc.undo.length === snapPages + 1 && (DocModel.undo(doc), !!doc.ocr[u[1]]));

  console.log('5. Écriture : couche de texte invisible');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const mk = async (rot) => {
    const d = await PDFLib.PDFDocument.create();
    const p = d.addPage([595, 842]);
    p.drawRectangle({ x: 50, y: 600, width: 300, height: 150, color: PDFLib.rgb(0.8, 0.8, 0.8) }); // « image » du scan
    if (rot) p.setRotation(PDFLib.degrees(rot));
    return d.save();
  };
  const ocrWords = [
    { t: 'Poutre', x0: 60, y0: 700, x1: 140, y1: 716, c: 95, a: 0 }, { t: 'IPE', x0: 150, y0: 700, x1: 190, y1: 716, c: 90, a: 0 },
    { t: 'Axe', x0: 400, y0: 500, x1: 414, y1: 540, c: 80, a: 90 }, { t: 'été', x0: 60, y0: 650, x1: 100, y1: 664, c: 70, a: 0 },
    { t: '日本語', x0: 60, y0: 620, x1: 120, y1: 634, c: 60, a: 0 }, { t: 'Ωmega', x0: 200, y0: 620, x1: 260, y1: 634, c: 60, a: 0 },
  ];
  const recW = Ocr.makeRecord(ocrWords, { lang: 'fra' });
  const base = await mk(0);
  const out = await PdfEdit.applyEdits(PDFLib, base, [], { images: {}, measure: {}, ocr: [recW] });
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(out), verbosity: 0 }).promise;
  const pg = await pdf.getPage(1);
  const tc = await pg.getTextContent();
  const str = tc.items.map((i) => i.str).join(' ');
  check('pdf.js extrait le texte reconnu (Poutre, IPE, Axe, été)', /Poutre/.test(str) && /IPE/.test(str) && /Axe/.test(str) && /été/.test(str), str);
  check('caractères non latins remplacés par « ? », sans erreur', /\?\?\?/.test(str) && /\?mega/.test(str), str);
  const poutre = tc.items.find((i) => /Poutre/.test(i.str));
  check('position : à moins de 0,5 mm du mot (x, y de la ligne de base)', near(poutre.transform[4], 60, 1.5) && near(poutre.transform[5], 700 + 0.2 * 16, 1.5), poutre.transform);
  check('largeur ajustée : « Poutre IPE » occupe exactement de x = 60 à x = 190 (±3 %)', near(poutre.width, 130, 3.9), poutre.width);
  const axe = tc.items.find((i) => /Axe/.test(i.str));
  check('mot pivoté à 90° : orienté de bas en haut', near(axe.transform[1], axe.height || axe.transform[1], 1e9) && Math.abs(axe.transform[0]) < 1e-6 && axe.transform[1] > 0, axe.transform);
  const opsOf = async (bytes) => { const p = await (await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise).getPage(1); const l = await p.getOperatorList(); const O = pdfjs.OPS; return l.fnArray.filter((f) => [O.fill, O.stroke, O.paintImageXObject, O.constructPath, O.eoFill, O.fillStroke].includes(f)).length; };
  check('aucun tracé ni image ajoutés : l\'aspect de la page est inchangé', (await opsOf(base)) === (await opsOf(out)), [await opsOf(base), await opsOf(out)]);
  const content = await (async () => {
    const d = await PDFLib.PDFDocument.load(out);
    const c = d.getPage(0).node.Contents();
    const arr = c.asArray ? c.asArray() : [c];
    let txt = '';
    for (const r of arr) { const st = d.context.lookup(r); const b = Buffer.from(st.getContents()); try { txt += require('zlib').inflateSync(b).toString('latin1'); } catch { txt += b.toString('latin1'); } }
    return txt;
  })();
  check('le texte est écrit en mode de rendu 3 (invisible), avec échelle horizontale (Tz)', /\b3 Tr\b/.test(content) && /\bTz\b/.test(content), content.slice(-300));
  // page /Rotate 90 + ajout de rotation : la couche suit la géométrie source
  const out90 = await PdfEdit.applyEdits(PDFLib, await mk(90), [], { images: {}, measure: {}, ocr: [recW] });
  const p90 = await (await pdfjs.getDocument({ data: new Uint8Array(out90), verbosity: 0 }).promise).getPage(1);
  const t90 = (await p90.getTextContent()).items.find((i) => /Poutre/.test(i.str));
  check('page à /Rotate 90 : le texte reste lisible dans la page (extrait entier)', !!t90 && near(t90.width, 130, 3.9), t90 && t90.width);
  // aucune page OCR : rien n'est écrit
  const none = await PdfEdit.applyEdits(PDFLib, base, [], { images: {}, measure: {}, ocr: [null] });
  check('sans texte reconnu : le fichier ne contient aucun texte ajouté', (await (await (await pdfjs.getDocument({ data: new Uint8Array(none), verbosity: 0 }).promise).getPage(1)).getTextContent()).items.length === 0);
  // structure : page supprimée → seul le texte des pages gardées est écrit
  const two = await (async () => { const d = await PDFLib.PDFDocument.create(); d.addPage([595, 842]); d.addPage([595, 842]); return d.save(); })();
  const pl = PageOps.identity(2);
  const spec = PageOps.remove({ pages: pl.pages, edits: [], scales: {}, nextId: 1, nextUid: pl.nextUid }, [0]);
  const o2 = await PdfEdit.applyEdits(PDFLib, two, [], { images: {}, measure: {}, pages: { list: spec.pages, sources: {} }, ocr: [Ocr.makeRecord([{ t: 'Reste', x0: 50, y0: 700, x1: 100, y1: 714, c: 90, a: 0 }])] });
  const d2 = await pdfjs.getDocument({ data: new Uint8Array(o2), verbosity: 0 }).promise;
  check('page supprimée : 1 page, texte de la page gardée', d2.numPages === 1 && /Reste/.test((await (await d2.getPage(1)).getTextContent()).items.map((i) => i.str).join('')));

  console.log('9. Orientation (règles) : déclenchement, choix par comparaison, échantillon');
  const WS = (n, c) => Array.from({ length: n }, () => ({ c }));
  check('déclenchement : page droite lue à 95 % → pas d\'essai', !Ocr.looksWrong(WS(92, 95)));
  check('déclenchement : 60 % pile (cas fautif de 0.12.3) → essai', Ocr.looksWrong(WS(38, 60)));
  check('déclenchement : 79 % → essai ; 80 % → pas d\'essai (seuil = ORIENT.trigger)', Ocr.looksWrong(WS(40, 79)) && !Ocr.looksWrong(WS(40, 80)) && Ocr.ORIENT.trigger === 80);
  check('déclenchement : moins de 8 mots, même sûrs → essai', Ocr.looksWrong(WS(7, 96)));
  const C = (a) => a.map(([theta, n, avg]) => ({ theta, n, avg }));
  // valeurs MESURÉES (bench-ocr-orient, échantillon 1400 px)
  check('page couchée (0° 50 %, 90° 95 %) → 90', Ocr.pickOrientation(C([[0, 86, 50], [90, 92, 95], [270, 86, 50], [180, 92, 95]])) === 90);
  check('page à l\'envers : égalité 270 / 180 → premier de la liste (270)', Ocr.pickOrientation(C([[0, 84, 50], [90, 84, 50], [270, 92, 95], [180, 92, 95]])) === 270);
  check('page fautive (0° 58 %) → 90', Ocr.pickOrientation(C([[0, 39, 58], [90, 46, 95], [270, 39, 58], [180, 46, 95]])) === 90);
  check('texte clairsemé couché (6 mots par échantillon) → 90', Ocr.pickOrientation(C([[0, 6, 60], [90, 6, 94], [270, 6, 60], [180, 6, 94]])) === 90);
  check('plan lu en mode texte (0° : 2 mots, non plausible) → 90', Ocr.pickOrientation(C([[0, 2, 91], [90, 3, 87], [270, 2, 66], [180, 2, 69]])) === 90);
  check('page illisible (aucun mot nulle part) → 0', Ocr.pickOrientation(C([[0, 0, 0], [90, 0, 0], [270, 0, 0], [180, 0, 0]])) === 0);
  check('page droite médiocre (0° 72 %, autres pires) → 0', Ocr.pickOrientation(C([[0, 60, 72], [90, 20, 40], [270, 30, 45], [180, 25, 50]])) === 0);
  check('gain inférieur à la marge (0° 70 %, 90° 78 %) → 0', Ocr.pickOrientation(C([[0, 50, 70], [90, 50, 78], [270, 40, 50], [180, 40, 50]])) === 0);
  check('meilleure orientation trop peu sûre (< 70 %) → 0', Ocr.pickOrientation(C([[0, 50, 40], [90, 50, 65], [270, 40, 45], [180, 40, 45]])) === 0);
  check('nombre de mots non plausible (90° : 3 mots contre 80) → 0', Ocr.pickOrientation(C([[0, 80, 55], [90, 3, 96], [270, 70, 50], [180, 75, 52]])) === 0);
  const sr = Ocr.sampleRect([{ x: 300, y: 300 }, { x: 350, y: 320 }, { x: 400, y: 330 }, { x: 2400, y: 3400 }], 2480, 3508, 1400);
  check('échantillon : carré de 1400 px sur la zone la plus riche en mots, dans la page', sr.w === 1400 && sr.h === 1400 && sr.x === 0 && sr.y === 0, sr);
  const sr2 = Ocr.sampleRect([], 1000, 700, 1400);
  check('échantillon : page plus petite que l\'échantillon → page entière ; sans mot → centre', sr2.x === 0 && sr2.y === 0 && sr2.w === 1000 && sr2.h === 700, sr2);
  const sr3 = Ocr.sampleRect([], 2480, 3508, 1400);
  check('échantillon sans mot : centré', sr3.x === 540 && sr3.y === 1054, sr3);

  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : OCR (logique).');
})();
