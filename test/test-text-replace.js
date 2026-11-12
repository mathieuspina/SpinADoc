// « Modifier texte » / « Ajouter texte » : couleur et police d'origine, couleur du fond, texte incliné / vertical /
// italique, page paysage, page /Rotate 90, affichage pivoté. On enregistre, on rend avec pdf.js et on vérifie les pixels.
const assert = require('assert');
const PDFLib = require('@cantoo/pdf-lib');
const Shapes = require('../src/shapes.js');
const PdfEdit = require('../src/pdf-edit.js');
const TextInfo = require('../src/text-info.js');

const { rgb, degrees, StandardFonts } = PDFLib;
const RED = [0.85, 0.1, 0.1], BLUE = [0.1, 0.2, 0.85], GREEN = [0.1, 0.55, 0.15], GRAY = [0.8, 0.8, 0.8];
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

async function makeSource() {
  const d = await PDFLib.PDFDocument.create();
  const helv = await d.embedFont(StandardFonts.Helvetica);
  const obl = await d.embedFont(StandardFonts.HelveticaOblique);
  const times = await d.embedFont(StandardFonts.TimesRomanBold);
  const cour = await d.embedFont(StandardFonts.Courier);
  // page 1 : portrait
  const p1 = d.addPage([595, 842]);
  p1.drawRectangle({ x: 60, y: 640, width: 460, height: 60, color: rgb(...GRAY) });
  p1.drawText('Rouge italique sur cellule', { x: 70, y: 662, size: 20, font: obl, color: rgb(...RED) });
  p1.drawText('Angle trente degres', { x: 100, y: 400, size: 22, font: helv, color: rgb(0, 0, 0), rotate: degrees(30) });
  p1.drawText('Verticale quatre vingt dix', { x: 480, y: 300, size: 20, font: helv, color: rgb(...BLUE), rotate: degrees(90) });
  p1.drawText('Vertical deux sept zero', { x: 540, y: 700, size: 20, font: helv, color: rgb(...BLUE), rotate: degrees(270) });
  p1.drawText('Times gras noir', { x: 70, y: 560, size: 18, font: times, color: rgb(0, 0, 0) });
  p1.drawText('Courier mono', { x: 70, y: 520, size: 16, font: cour, color: rgb(0, 0, 0) });
  // page 2 : paysage
  const p2 = d.addPage([842, 595]);
  p2.drawRectangle({ x: 80, y: 280, width: 500, height: 50, color: rgb(...GRAY) });
  p2.drawText('Paysage bleu sur gris', { x: 100, y: 296, size: 24, font: helv, color: rgb(...BLUE) });
  // page 3 : /Rotate 90
  const p3 = d.addPage([595, 842]);
  p3.setRotation(degrees(90));
  p3.drawRectangle({ x: 80, y: 480, width: 400, height: 50, color: rgb(...GRAY) });
  p3.drawText('Page tournee verte', { x: 100, y: 496, size: 22, font: helv, color: rgb(...GREEN) });
  return d.save();
}

let pdfjsP = null;
async function load(bytes) {
  pdfjsP = pdfjsP || import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfjs = await pdfjsP;
  const fontDir = require('path').join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'standard_fonts').split('\\').join('/') + '/';
  return pdfjs.getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: fontDir, verbosity: 0 }).promise;
}
async function renderPage(pdf, n, rotation) {
  const page = await pdf.getPage(n);
  const vp = page.getViewport(rotation === undefined ? { scale: 1 } : { scale: 1, rotation });
  const cc = pdf.canvasFactory.create(vp.width, vp.height);
  await page.render({ canvasContext: cc.context, viewport: vp, canvasFactory: pdf.canvasFactory }).promise;
  const img = cc.context.getImageData(0, 0, vp.width, vp.height);
  // pixel au point PDF (x, y), quelle que soit la rotation de la page / de l'affichage
  const px = (x, y) => {
    const [vx, vy] = vp.convertToViewportPoint(x, y);
    const i = (Math.min(img.height - 1, Math.max(0, Math.floor(vy))) * img.width + Math.min(img.width - 1, Math.max(0, Math.floor(vx)))) * 4;
    return [img.data[i] / 255, img.data[i + 1] / 255, img.data[i + 2] / 255];
  };
  return { page, vp, img, px };
}

(async () => {
  const src = await makeSource();
  const pdf = await load(src);
  const makeCanvas = (w, h) => { const cc = pdf.canvasFactory.create(w, h); return { ctx: cc.context, render: { canvasFactory: pdf.canvasFactory } }; };

  async function replaceTest(pageNo, needle, expect) {
    const page = await pdf.getPage(pageNo);
    const tc = await page.getTextContent();
    const items = TextInfo.itemsFromContent(tc);
    const item = items.find((i) => i.str.includes(needle));
    assert(item, 'élément introuvable : ' + needle);
    assert(item.editable, 'élément éditable : ' + needle);
    const info = await TextInfo.analyze(page, item, tc.styles, makeCanvas);
    const edit = Object.assign(TextInfo.buildReplaceEdit(item, info, pageNo - 1, `${pageNo - 1}:0`), { id: 1, text: 'Ok' });

    // --- détection
    if (expect.ink) assert(info.ink && near(info.ink, expect.ink, 0.13), `${needle} : couleur du texte détectée ${JSON.stringify(info.ink)} ≠ ${JSON.stringify(expect.ink)}`);
    if (expect.bg) assert(near(info.bg, expect.bg, 0.08), `${needle} : fond détecté ${JSON.stringify(info.bg)} ≠ ${JSON.stringify(expect.bg)}`);
    if (expect.italic !== undefined) assert.strictEqual(info.font.italic, expect.italic, `${needle} : italique`);
    if (expect.bold !== undefined) assert.strictEqual(info.font.bold, expect.bold, `${needle} : gras`);
    if (expect.font) assert.strictEqual(info.font.font, expect.font, `${needle} : famille ${info.font.origName}`);
    assert(Math.abs(edit.rot - expect.angle) < 0.6 || Math.abs(Math.abs(edit.rot - expect.angle) - 360) < 0.6, `${needle} : angle ${edit.rot} ≠ ${expect.angle}`);

    // --- enregistrement + rendu
    const out = await PdfEdit.applyEdits(PDFLib, src, [edit]);
    const pdf2 = await load(out);
    const r = await renderPage(pdf2, pageNo);
    const a = item.ang, cs = Math.cos(a), sn = Math.sin(a);
    const at = (lx, ly) => r.px(item.x + lx * cs - ly * sn, item.y + lx * sn + ly * cs);
    // bout éloigné de l'ancien texte : le recouvrement doit avoir la couleur du fond (pas du blanc sur une cellule grise)
    const far = at(item.w * 0.93, item.size * 0.25);
    assert(near(far, expect.bg || [1, 1, 1], 0.1), `${needle} : recouvrement de la couleur du fond ${JSON.stringify(far)}`);
    // le nouveau texte a la couleur d'origine, au début de la zone
    const inkRef = expect.ink || [0, 0, 0];
    let hits = 0;
    for (let lx = 0; lx < item.size * 1.6; lx += 0.4) for (let ly = -0.1 * item.size; ly < 0.75 * item.size; ly += 0.4) if (near(at(lx, ly), inkRef, 0.25)) hits++;
    assert(hits > 6, `${needle} : le nouveau texte est de la couleur d'origine (${hits} pixels)`);
    // orientation conservée
    const items2 = TextInfo.itemsFromContent(await (await pdf2.getPage(pageNo)).getTextContent());
    const ok = items2.find((i) => i.str === 'Ok');
    assert(ok, `${needle} : nouveau texte présent`);
    let da = ok.ang - item.ang;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    assert(Math.abs(da) < 0.02, `${needle} : orientation du texte conservée (écart ${da})`);
    console.log(`  ok   ${needle} (angle ${expect.angle}°, ${info.font.origName} → ${info.font.font}${info.font.bold ? ' gras' : ''}${info.font.italic ? ' italique' : ''})`);
  }

  await replaceTest(1, 'Rouge italique', { angle: 0, ink: RED, bg: GRAY, italic: true, bold: false, font: 'Helvetica' });
  await replaceTest(1, 'Angle trente', { angle: 30, ink: [0, 0, 0], bg: [1, 1, 1], font: 'Helvetica' });
  await replaceTest(1, 'Verticale quatre', { angle: 90, ink: BLUE, bg: [1, 1, 1] });
  await replaceTest(1, 'Vertical deux sept', { angle: 270, ink: BLUE, bg: [1, 1, 1] });
  await replaceTest(1, 'Times gras', { angle: 0, ink: [0, 0, 0], font: 'Times', bold: true, italic: false });
  await replaceTest(1, 'Courier mono', { angle: 0, ink: [0, 0, 0], font: 'Courier' });
  await replaceTest(2, 'Paysage bleu', { angle: 0, ink: BLUE, bg: GRAY });
  await replaceTest(3, 'Page tournee', { angle: 0, ink: GREEN, bg: GRAY });

  // --- Fond : Auto / Blanc / personnalisé
  {
    const page = await pdf.getPage(1);
    const tc = await page.getTextContent();
    const item = TextInfo.itemsFromContent(tc).find((i) => i.str.includes('Rouge italique'));
    const info = await TextInfo.analyze(page, item, tc.styles, makeCanvas);
    const base = Object.assign(TextInfo.buildReplaceEdit(item, info, 0, '0:0'), { id: 1, text: 'Ok' });
    const sampleFar = async (e) => { const o = await PdfEdit.applyEdits(PDFLib, src, [e]); const r = await renderPage(await load(o), 1); return r.px(item.x + item.w * 0.93, item.y + item.size * 0.25); };
    assert(near(await sampleFar(base), GRAY, 0.1), 'fond Auto = gris détecté');
    assert(near(await sampleFar(Object.assign({}, base, { bgMode: 'white' })), [1, 1, 1], 0.05), 'fond Blanc');
    assert(near(await sampleFar(Object.assign({}, base, { bgMode: 'custom', bgColor: [1, 1, 0] })), [1, 1, 0], 0.05), 'fond personnalisé (jaune)');
    console.log('  ok   fond : Auto / Blanc / personnalisé');
  }

  // --- « Ajouter texte » droit dans l'orientation affichée : page /Rotate 90 et affichage pivoté
  async function darkBox(r) {
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let y = 0; y < r.img.height; y++) for (let x = 0; x < r.img.width; x++) { const i = (y * r.img.width + x) * 4; if (r.img.data[i] < 100) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }
    return { w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  async function blankPage(rotate) {
    const d = await PDFLib.PDFDocument.create();
    const p = d.addPage([595, 842]);
    if (rotate) p.setRotation(degrees(rotate));
    return d.save();
  }
  for (const [label, pageRot, viewRot] of [['page /Rotate 90', 90, undefined], ['page /Rotate 270', 270, undefined], ['affichage pivoté de 90°', 0, 90], ['page 90° + affichage 180°', 90, 270]]) {
    const bytes = await blankPage(pageRot);
    const probe = await (await load(bytes)).getPage(1);
    const vpRot = probe.getViewport(viewRot === undefined ? { scale: 1 } : { scale: 1, rotation: viewRot }).rotation;
    const mk = (rot) => ({ id: 1, page: 0, type: 'add', x: 150, y: 400, text: 'Texte droit dans le sens de lecture', size: 24, color: [0, 0, 0], font: 'Helvetica', align: 'left', rot });
    const r0 = await renderPage(await load(await PdfEdit.applyEdits(PDFLib, bytes, [mk(0)])), 1, viewRot);
    const r1 = await renderPage(await load(await PdfEdit.applyEdits(PDFLib, bytes, [mk(vpRot)])), 1, viewRot);
    const b0 = await darkBox(r0), b1 = await darkBox(r1);
    if (vpRot !== 0 && vpRot !== 180) assert(b0.h > b0.w, `${label} : sans correction le texte est de travers`);
    assert(b1.w > b1.h * 3, `${label} : avec rot = rotation de l'affichage (${vpRot}°) le texte est horizontal (${b1.w}×${b1.h})`);
    console.log(`  ok   texte ajouté droit : ${label} (rotation d'affichage ${vpRot}°)`);
  }

  // --- géométrie du recouvrement tourné
  {
    const e = { type: 'replace', x: 100, y: 100, text: 'a', size: 10, cover: { x: 100, y: 97.5, w: 51, h: 11.5, rot: 90, ox: 100, oy: 100 } };
    const poly = Shapes.coverPoly(e);
    const b = Shapes.bounds(e);
    assert(Math.abs(b.x0 - 91) < 0.01 && Math.abs(b.x1 - 102.5) < 0.01 && Math.abs(b.y0 - 100) < 0.01 && Math.abs(b.y1 - 151) < 0.01, 'bornes du recouvrement tourné de 90° : ' + JSON.stringify(b));
    assert(Shapes.hitTest(e, 95, 130, 1, null) && !Shapes.hitTest(e, 130, 100, 1, null), 'hit-test du recouvrement tourné');
    assert(poly.length === 4);
    assert(TextInfo.hitItem({ x: 100, y: 100, w: 50, size: 10, ang: Math.PI / 2 }, 97, 130) && !TextInfo.hitItem({ x: 100, y: 100, w: 50, size: 10, ang: Math.PI / 2 }, 130, 100), 'hit-test d\'un texte vertical');
    console.log('  ok   géométrie du recouvrement tourné');
  }

  console.log('OK : Modifier texte / Ajouter texte (couleur, police, fond, inclinaison, pages pivotées).');
})().catch((e) => { console.error('ÉCHEC :', e); process.exit(1); });
