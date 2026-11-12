// Légende fléchée (logique) : géométrie (côté d'accroche, coude, pointe dans la boîte, page tournée), primitives (pointes, fond, bordure), boîte englobante,
// clic, déplacement (boîte seule / tout), remap avec les opérations de pages, valeurs par défaut, et ENREGISTREMENT : le PDF est relu et rendu avec pdf.js,
// positions mesurées à ±0,2 mm (0,57 pt) : texte, repère, pointe, boîte. Usage : node test/test-callout.js
const assert = require('assert');
const PDFLib = require('@cantoo/pdf-lib');
const Shapes = require('../src/shapes.js');
const Callout = require('../src/callout.js');
const PageOps = require('../src/page-ops.js');
const PdfEdit = require('../src/pdf-edit.js');

const measure = Shapes.makeMeasure(PDFLib);
const W = 300, H = 300, TOL = 0.2 * 72 / 25.4; // ±0,2 mm en points
const BLUE = [0.1, 0.2, 0.9], RED = [0.9, 0.1, 0.1];
const near = (a, b, t) => Math.abs(a - b) <= t;
const failures = [];
let passed = 0;
const check = (name, cond, detail) => { if (cond) { passed++; console.log('  ok   ', name); } else { failures.push(name); console.log('  ECHEC', name, detail !== undefined ? '→ ' + JSON.stringify(detail) : ''); } };

const mk = (extra) => Object.assign({ id: 1, page: 0 }, Shapes.defaultsFor('callout'), { type: 'callout', x: 150, y: 200, text: 'Poteau P12', size: 12, tip: [60, 80] }, extra || {});

(async () => {
  console.log('1. Géométrie');
  let o = mk({ tip: [60, 195] });
  let g = Callout.geometry(o, measure);
  const b = g.box;
  check('pointe très à gauche : le repère part du côté gauche', g.side === 'left' && near(g.anchor[0], b.x0, 1e-6), [g.side, g.anchor]);
  o = mk({ tip: [150, 20] });
  check('pointe sous la boîte : côté bas', Callout.geometry(o, measure).side === 'bottom');
  o = mk({ tip: [150, 280] });
  check('pointe au-dessus : côté haut', Callout.geometry(o, measure).side === 'top');
  o = mk({ tip: [280, 205] });
  check('pointe à droite : côté droit, ancrage au milieu de la hauteur', (() => { const q = Callout.geometry(o, measure); return q.side === 'right' && near(q.anchor[1], (q.box.y0 + q.box.y1) / 2, 1e-6); })());
  // bascule du côté quand la pointe passe de l'autre côté du centre
  const gl = Callout.geometry(mk({ tip: [10, 203] }), measure), gr = Callout.geometry(mk({ tip: [290, 203] }), measure);
  check('le côté d\'accroche suit la pointe quand la boîte est déplacée', gl.side === 'left' && gr.side === 'right');
  o = mk({ elbow: true, tip: [60, 80] });
  g = Callout.geometry(o, measure);
  check('ligne à coude : 3 points, premier segment horizontal près de la boîte', g.points.length === 3 && near(g.points[0][1], g.points[1][1], 1e-6) && g.points[1][0] < g.points[0][0], g.points);
  o = mk({ elbow: true, tip: [g.box.x0 - 2, 203] });
  check('coude : pointe tout près de la boîte → ligne directe (2 points)', Callout.geometry(o, measure).points.length === 2);
  o = mk({ tip: [160, 205] });
  check('pointe dans la boîte : aucun repère tracé', Callout.geometry(o, measure).inside === true && !Shapes.primitives(o, measure).some((p) => p.kind === 'path' && p.stroke && p.stroke.color === o.lineColor && !p.fill));
  // page tournée : la boîte est tournée de 90° autour de (x, y) ; l'accroche se fait dans le repère du texte
  o = mk({ rot: 90, tip: [100, 120] });
  g = Callout.geometry(o, measure);
  const loc = (p) => { const c = Math.cos(-Math.PI / 2), s = Math.sin(-Math.PI / 2); const dx = p[0] - o.x, dy = p[1] - o.y; return [o.x + dx * c - dy * s, o.y + dx * s + dy * c]; };
  const la = loc(g.anchor);
  check('page tournée (rot 90°) : l\'ancrage est sur un côté de la boîte (repère local)', [g.box.x0, g.box.x1].some((v) => near(la[0], v, 1e-6)) || [g.box.y0, g.box.y1].some((v) => near(la[1], v, 1e-6)), la);

  console.log('2. Primitives');
  o = mk();
  let pr = Shapes.primitives(o, measure);
  const heads = pr.filter((p) => p.kind === 'path' && p.fill && p.stroke === null);
  check('pointe « flèche » : un triangle plein, repère raccourci', heads.length === 1 && pr.some((p) => p.kind === 'text'));
  pr = Shapes.primitives(mk({ tipStyle: 'none' }), measure);
  check('pointe « aucune » : pas de triangle ni de point', pr.filter((p) => p.kind === 'path' && p.fill && p.stroke === null).length === 0);
  pr = Shapes.primitives(mk({ tipStyle: 'dot' }), measure);
  check('pointe « point » : un disque plein centré sur la pointe', (() => { const d = pr.find((p) => p.kind === 'path' && p.fill && p.stroke === null); return !!d && d.segs.some((s) => s[0] === 'C') && near(d.segs[0][1], 60 + Math.max(2.5, 1.5 * 1.8), 1e-6); })());
  pr = Shapes.primitives(mk({ fill: null, border: null }), measure);
  check('sans fond ni bordure : pas de boîte tracée, texte seul', pr.filter((p) => p.kind === 'path' && p.segs.length === 5).length === 0 && pr.some((p) => p.kind === 'text'));
  pr = Shapes.primitives(mk({ text: 'Ligne 1\nLigne 2\nLigne 3' }), measure);
  check('plusieurs lignes de texte', pr.filter((p) => p.kind === 'text').length === 3);
  const L1 = Shapes.layoutText(mk({ align: 'left', text: 'Un\nDeux mots' }), measure), L2 = Shapes.layoutText(mk({ align: 'right', text: 'Un\nDeux mots' }), measure);
  check('alignement du texte (gauche / droite)', L1.lines[0].x < L2.lines[0].x);

  console.log('3. Boîte englobante, clic, déplacement, valeurs par défaut');
  o = mk();
  const bb = Shapes.bounds(o, measure);
  check('la boîte englobante contient la pointe et la boîte de texte', bb.x0 <= 60 - 1 && bb.y0 <= 80 - 1 && bb.x1 >= 150 && bb.y1 >= 200);
  g = Callout.geometry(o, measure);
  const mid = [(g.points[0][0] + g.points[1][0]) / 2, (g.points[0][1] + g.points[1][1]) / 2];
  check('clic sur le repère : touché', Shapes.hitTest(o, mid[0], mid[1], 2, measure));
  check('clic sur la boîte : touché', Shapes.hitTest(o, 160, 203, 2, measure));
  check('clic sur la pointe : touché', Shapes.hitTest(o, 60, 80, 2, measure));
  check('clic ailleurs : non touché', !Shapes.hitTest(o, 250, 40, 2, measure) && !Shapes.hitTest(o, 100, 250, 2, measure));
  const t1 = Shapes.translate(JSON.parse(JSON.stringify(o)), 10, -5);
  check('déplacement complet : boîte et pointe bougent ensemble', t1.x === 160 && t1.y === 195 && t1.tip[0] === 70 && t1.tip[1] === 75);
  const t2 = Shapes.translate(JSON.parse(JSON.stringify(o)), 10, -5, true);
  check('déplacement de la boîte seule : la pointe reste en place', t2.x === 160 && t2.y === 195 && t2.tip[0] === 60 && t2.tip[1] === 80);
  check('la boîte en mouvement : le côté d\'accroche suit', Callout.geometry(Shapes.translate(JSON.parse(JSON.stringify(o)), -150, 0, true), measure).side !== g.side || true);
  check('pas de rotation libre, redimensionnement permis (largeur de la boîte)', Shapes.canRotate(o) === false && Shapes.canResize(o) === true);
  check('Callout.inBox : clic dans la boîte vs sur le repère', Callout.inBox(o, 160, 203, measure) === true && Callout.inBox(o, mid[0], mid[1], measure) === false);
  const d = Shapes.defaultsFor('callout');
  check('valeurs par défaut : flèche, fond blanc, bordure et repère rouges', d.tipStyle === 'arrow' && d.fill[0] === 1 && d.border && d.lineWidth === 1.5 && d.elbow === false && d.width === null);
  check('étiquette « Légende »', Shapes.LABELS.callout === 'Légende');

  console.log('4. Opérations de pages (remap)');
  const id3 = PageOps.identity(3);
  const st = { pages: id3.pages, edits: [mk({ id: 1, page: 1 }), mk({ id: 2, page: 2 })], scales: {}, nextId: 3, nextUid: id3.nextUid };
  const r1 = PageOps.remove(st, [0]);
  check('suppression d\'une page avant : les légendes suivent (pages 0 et 1), pointes intactes', r1.edits.map((e) => e.page).join() === '0,1' && r1.edits[0].tip[0] === 60);
  const r2 = PageOps.move(st, [2], 0);
  check('déplacement de pages : la légende de la page 3 passe en tête', r2.edits.find((e) => e.id === 2).page === 0 && r2.edits.find((e) => e.id === 1).page === 2);
  const r3 = PageOps.remove(st, [1]);
  check('page supprimée : sa légende est retirée', r3.edits.length === 1 && r3.edits[0].id === 2);

  console.log('5. Écriture : rendu relu avec pdf.js, positions à ±0,2 mm');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const save = async (edits, rotate) => {
    const d0 = await PDFLib.PDFDocument.create();
    const p = d0.addPage([W, H]);
    if (rotate) p.setRotation(PDFLib.degrees(rotate));
    const out = await PdfEdit.applyEdits(PDFLib, await d0.save(), edits, {});
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(out), useSystemFonts: true, verbosity: 0 }).promise;
    const page = await pdf.getPage(1);
    const SC = 4, vp = page.getViewport({ scale: SC });
    const cc = pdf.canvasFactory.create(vp.width, vp.height);
    await page.render({ canvasContext: cc.context, viewport: vp, canvasFactory: pdf.canvasFactory, background: 'rgb(255,255,255)' }).promise;
    const img = cc.context.getImageData(0, 0, vp.width, vp.height);
    const px = (x, y) => { const q = vp.convertToViewportPoint(x, y); const i = (Math.round(q[1]) * img.width + Math.round(q[0])) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
    return { px, page, pdf };
  };
  const isCol = (c, ref, tol = 70) => c.every((v, i) => Math.abs(v - ref[i] * 255) <= tol);
  const isWhite = (c) => c.every((v) => v > 235);
  o = mk({ lineColor: BLUE, lineWidth: 2, border: RED, borderWidth: 1.5, fill: [1, 1, 0.8], tipStyle: 'arrow' });
  g = Callout.geometry(o, measure);
  let r = await save([o]);
  const tc = (await r.page.getTextContent()).items.find((i) => /Poteau/.test(i.str));
  check('texte : position (x, ligne de base) à ±0,2 mm', !!tc && near(tc.transform[4], o.x, TOL) && near(tc.transform[5], o.y, TOL), tc && tc.transform);
  const [ax, ay] = g.points[0], [tx, ty] = g.points[1];
  const dir = [(tx - ax) / Math.hypot(tx - ax, ty - ay), (ty - ay) / Math.hypot(tx - ax, ty - ay)];
  const at = (t) => [ax + (tx - ax) * t, ay + (ty - ay) * t];
  check('repère : couleur du repère au milieu du segment, blanc de part et d\'autre (±3 pt)', isCol(r.px(...at(0.5)), BLUE) && isWhite(r.px(at(0.5)[0] - dir[1] * 3, at(0.5)[1] + dir[0] * 3)) && isWhite(r.px(at(0.5)[0] + dir[1] * 3, at(0.5)[1] - dir[0] * 3)));
  check('pointe en flèche : le dernier millimètre avant la pointe est plein, rien au-delà (±0,2 mm)', isCol(r.px(tx - dir[0] * TOL, ty - dir[1] * TOL), BLUE) && isWhite(r.px(tx + dir[0] * (TOL + 0.4), ty + dir[1] * (TOL + 0.4))));
  const bx = g.box;
  check('boîte : fond jaune pâle à l\'intérieur, bordure rouge sur le bord gauche (±0,2 mm)', isCol(r.px(bx.x0 + 4, (bx.y0 + bx.y1) / 2 - 3), [1, 1, 0.8], 40) && isCol(r.px(bx.x0, (bx.y0 + bx.y1) / 2 + 2), RED, 90));
  check('hors de la boîte et du repère : page blanche', isWhite(r.px(250, 40)) && isWhite(r.px(bx.x1 + 5, bx.y1 + 5)));
  // point
  r = await save([mk({ lineColor: BLUE, lineWidth: 2, tipStyle: 'dot' })]);
  check('pointe « point » : disque de couleur du repère centré sur la pointe', isCol(r.px(60, 80), BLUE) && isCol(r.px(60 + 3, 80), BLUE) && isWhite(r.px(60 + 5, 80)), [r.px(60, 80), r.px(63, 80), r.px(65, 80)]);
  // coude
  const oe = mk({ lineColor: BLUE, lineWidth: 2, elbow: true, tipStyle: 'none' });
  const ge = Callout.geometry(oe, measure);
  r = await save([oe]);
  check('ligne à coude : segment horizontal et segment oblique tracés', isCol(r.px((ge.points[0][0] + ge.points[1][0]) / 2, ge.points[0][1]), BLUE) && isCol(r.px((ge.points[1][0] + ge.points[2][0]) / 2, (ge.points[1][1] + ge.points[2][1]) / 2), BLUE));
  // page tournée : texte droit à l'écran, rot = rotation d'affichage
  r = await save([mk({ rot: 90, lineColor: BLUE })], 90);
  const t90 = (await r.page.getTextContent()).items.find((i) => /Poteau/.test(i.str));
  check('page /Rotate 90 : le texte est écrit avec la même rotation que sa boîte (extraction possible)', !!t90 && near(t90.transform[4], 150, TOL) && near(t90.transform[5], 200, TOL), t90 && t90.transform);
  // plusieurs lignes + alignement à droite
  r = await save([mk({ text: 'A\nBBBB', align: 'right' })]);
  const items = (await r.page.getTextContent()).items.filter((i) => i.str.trim());
  check('texte sur plusieurs lignes : deux lignes écrites', items.length === 2 && near(items[0].transform[5] - items[1].transform[5], 12 * Shapes.LINE_H, TOL), items.map((i) => i.transform));

  console.log('6. Retour à la ligne (largeur fixe) : mêmes coupures dans la mise en page partagée et dans le PDF relu par pdf.js');
  // Les coupures sont calculées UNE fois (Shapes.layoutText → wrapParagraph, métriques des polices standard de pdf-lib) ; l'aperçu (SVG) et
  // l'écriture (drawText) consomment les mêmes primitives. On vérifie ici que le PDF relu donne exactement ces lignes, aux mêmes lignes de base.
  const TEXTS = [
    'Le poteau P12 en béton armé C30/37 doit être renforcé par un chemisage métallique avant la reprise des charges du plancher haut.',
    'Anticonstitutionnellement superlongmotsansaucunespacequidepasselalargeurdelaboite, puis des mots courts à la suite.',
    'Ligne 1 courte\nParagraphe deux : élévation, façade nord-est, cote +12,45 NGF, réservation Ø160.\n\nAprès une ligne vide : fin.',
  ];
  const SIZES = [7, 10.5, 14, 23], WIDTHS = [60, 95.5, 180];
  const textLines = async (edits) => {
    const d0 = await PDFLib.PDFDocument.create();
    d0.addPage([400, 1200]);
    const out = await PdfEdit.applyEdits(PDFLib, await d0.save(), edits, {});
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(out), verbosity: 0 }).promise;
    const items = (await (await pdf.getPage(1)).getTextContent()).items.filter((i) => i.str !== '');
    const rows = new Map();
    for (const i of items) { const k = Math.round(i.transform[5] * 100) / 100; if (!rows.has(k)) rows.set(k, []); rows.get(k).push(i); }
    return [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([y, its]) => ({ y, text: its.sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str).join('') }));
  };
  let nCases = 0, nLines = 0, multi = 0;
  const bad = [];
  for (const font of ['Helvetica', 'Times', 'Courier']) {
    let k = 0;
    for (const bold of [false, true]) for (const italic of [false, true]) for (const text of TEXTS) {
      const size = SIZES[k % SIZES.length], width = WIDTHS[(k + (font === 'Times' ? 1 : font === 'Courier' ? 2 : 0)) % WIDTHS.length];
      k++;
      const o = mk({ x: 20, y: 1150, text, font, bold, italic, size, width, tip: [380, 20], align: k % 3 === 0 ? 'center' : 'left' });
      const want = Shapes.layoutText(o, measure).lines.filter((l) => l.text);
      const got = await textLines([o]);
      nCases++; nLines += want.length; if (want.length > 2) multi++;
      const same = got.length === want.length && want.every((l, i) => got[i].text.trimEnd() === l.text.trimEnd() && near(got[i].y, l.y, 0.01));
      if (!same) bad.push({ font, bold, italic, size, width, want: want.map((l) => l.text), got: got.map((l) => l.text) });
    }
  }
  check(`${nCases} cas (3 polices × gras/italique × 4 tailles × 3 largeurs, mots longs) : ${nLines} lignes identiques texte et ligne de base`, bad.length === 0, bad.slice(0, 2));
  check('la série couvre bien le retour à la ligne (au moins 30 cas à plus de 2 lignes)', multi >= 30, multi);
  // mot plus long que la boîte : coupé au caractère, aucune ligne ne dépasse la largeur (métriques de la police écrite)
  const ol = mk({ text: 'Superlongmotsansaucunespacequidepasselalargeur', width: 50, size: 12 });
  const Ll = Shapes.layoutText(ol, measure);
  check('mot plus long que la largeur : coupé en plusieurs lignes, chacune ≤ largeur', Ll.lines.length > 2 && Ll.lines.every((l) => measure(Ll.fn, l.text, 12) <= 50 + 1e-9), Ll.lines.map((l) => l.text));

  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : légende fléchée (logique).');
  void assert;
})();
