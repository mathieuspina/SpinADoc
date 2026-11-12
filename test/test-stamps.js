// Note, tampons (6 prédéfinis, date, nom, texte), images (PNG transparent, JPEG), signature tracée : enregistrés,
// rechargés, rendus avec pdf.js ; pixels vérifiés sur page portrait, paysage et /Rotate 90.
const assert = require('assert');
const path = require('path');
const PDFLib = require('@cantoo/pdf-lib');
const { createCanvas } = require('@napi-rs/canvas');
const Shapes = require('../src/shapes.js');
const PdfEdit = require('../src/pdf-edit.js');

const { rgb, degrees } = PDFLib;
const measure = Shapes.makeMeasure(PDFLib);
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const to1 = (c) => c.map((v) => v);

async function source() {
  const d = await PDFLib.PDFDocument.create();
  const p1 = d.addPage([300, 300]);
  p1.drawRectangle({ x: 0, y: 0, width: 150, height: 100, color: rgb(0, 0, 0) }); // zone noire (transparence / Multiply)
  d.addPage([400, 250]);
  const p3 = d.addPage([300, 300]);
  p3.setRotation(degrees(90));
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
  const texts = (await page.getTextContent()).items.filter((i) => i.str.trim());
  return { px, texts, pdf };
}

const png = (w, h, draw) => { const c = createCanvas(w, h); draw(c.getContext('2d')); return new Uint8Array(c.toBuffer('image/png')); };
const jpg = (w, h, draw) => { const c = createCanvas(w, h); draw(c.getContext('2d')); return new Uint8Array(c.toBuffer('image/jpeg', 95)); };

async function imageCount(bytes) {
  const d = await PDFLib.PDFDocument.load(bytes);
  let n = 0;
  for (const [, obj] of d.context.enumerateIndirectObjects()) {
    const dict = obj.dict;
    if (dict && dict.get && dict.get(PDFLib.PDFName.of('Subtype')) === PDFLib.PDFName.of('Image')) n++;
  }
  return n;
}

(async () => {
  const src = await source();
  const save = async (edits, pageNo, assets) => {
    const out = await PdfEdit.applyEdits(PDFLib, src, edits.map((e, i) => Object.assign({ id: i + 1, page: pageNo - 1 }, e)), assets);
    return Object.assign(await render(out, pageNo), { out });
  };
  const stamp = (preset, extra) => {
    const o = Object.assign(Shapes.defaultsFor('stamp'), { type: 'stamp', rot: 0 }, preset, extra);
    const sz = Shapes.stampSize(o, measure, 0.5); // échelle 0,5 : « Pour information » tient dans la page de test
    return Object.assign(o, { w: sz.w, h: sz.h });
  };

  // ---------------------------------------------------------------- géométrie
  {
    const a = Shapes.stampNatural({ label: 'Approuvé', frame: true }, measure);
    const b = Shapes.stampNatural({ label: 'Approuvé', frame: true, date: '10/11/2026', user: 'M. EXEMPLE' }, measure);
    assert(b.h > a.h && b.w >= a.w, 'date et nom ajoutent des lignes sous le texte');
    const s = stamp(Shapes.STAMPS[0], { cx: 100, cy: 100 });
    assert(Shapes.hitTest(s, 100, 100, 1, measure) && !Shapes.hitTest(s, 100 + s.w, 100, 1, measure), 'un tampon se sélectionne à l\'intérieur');
    assert(Shapes.ASPECT_LOCKED.has('stamp') && Shapes.ASPECT_LOCKED.has('image') && Shapes.ASPECT_LOCKED.has('sig') && !Shapes.ASPECT_LOCKED.has('rect'));
    assert(/^\d\d\/\d\d\/\d{4}$/.test(Shapes.formatDate(new Date(2026, 10, 9))) && Shapes.formatDate(new Date(2026, 10, 9)) === '09/11/2026', 'date jj/mm/aaaa');
    assert.strictEqual(Shapes.STAMPS.length, 6);
    console.log('  ok   géométrie des tampons');
  }

  // ---------------------------------------------------------------- note
  for (const [pageNo, label] of [[1, 'portrait'], [2, 'paysage'], [3, 'Rotate 90']]) {
    const note = Object.assign(Shapes.defaultsFor('note'), { type: 'note', x: 160, y: 230, text: 'Bonjour la note', shadow: true });
    const r = await save([note], pageNo);
    const L = Shapes.layoutText(note, measure);
    assert(near(r.px(L.box.x0 + 2, L.box.y1 - 2), [1, 0.96, 0.6], 0.1), `note ${label} : fond jaune`);
    assert(near(r.px(L.box.x1 + 1.5, L.box.y0 - 1.5), [0.78, 0.78, 0.78], 0.18) && !near(r.px(L.box.x1 + 1.5, L.box.y0 - 1.5), [1, 1, 1], 0.05), `note ${label} : ombre légère`);
    assert(r.texts.map((t) => t.str).join(' ').includes('Bonjour la note') || r.texts.map((t) => t.str).join('').includes('Bonjour'), `note ${label} : texte`);
    let border = false;
    for (let dy = -1.2; dy <= 1.2; dy += 0.3) if (near(r.px(L.box.x0 + 40, L.box.y1 + dy), [0.8, 0.68, 0.2], 0.25)) border = true;
    assert(border, `note ${label} : bordure fine`);
  }
  console.log('  ok   note (portrait, paysage, /Rotate 90)');

  // ---------------------------------------------------------------- tampons prédéfinis
  for (const preset of Shapes.STAMPS) {
    const s = stamp(preset, { cx: 150, cy: 200 });
    const r = await save([s], 1);
    let edge = false;
    for (let dy = -3; dy <= 3; dy += 0.4) if (near(r.px(150, 200 + s.h / 2 - 0.8 + dy), preset.color, 0.28)) edge = true;
    assert(edge, `tampon « ${preset.label} » : cadre de la bonne couleur`);
    assert(r.texts.some((t) => t.str === preset.label.toUpperCase()), `tampon « ${preset.label} » : texte en capitales (${r.texts.map((t) => t.str).join('|')})`);
  }
  console.log('  ok   6 tampons prédéfinis (cadre arrondi, couleur, capitales)');
  {
    const date = Shapes.formatDate(new Date(2026, 10, 10));
    const s = stamp(Shapes.STAMPS[0], { cx: 150, cy: 200, date, user: 'M. EXEMPLE', rot: 30 });
    const r = await save([s], 1);
    const strs = r.texts.map((t) => t.str);
    assert(strs.includes('APPROUVÉ') && strs.includes(date) && strs.includes('M. EXEMPLE'), 'tampon avec date et nom : ' + strs.join('|'));
    const t = r.texts.find((x) => x.str === 'APPROUVÉ');
    assert(Math.abs(Math.atan2(t.transform[1], t.transform[0]) - Math.PI / 6) < 0.02, 'tampon incliné de 30°');
    for (const [pageNo, label] of [[2, 'paysage'], [3, 'Rotate 90']]) {
      const s2 = stamp(Shapes.STAMPS[1], { cx: 150, cy: 120 });
      const r2 = await save([s2], pageNo);
      let edge = false;
      for (let dy = -3; dy <= 3; dy += 0.4) if (near(r2.px(150, 120 + s2.h / 2 - 0.8 + dy), Shapes.STAMPS[1].color, 0.28)) edge = true;
      assert(edge, `tampon ${label} : cadre au bon endroit`);
    }
    console.log('  ok   tampon avec date, nom, inclinaison ; paysage et /Rotate 90');
  }
  {
    const s = stamp({ label: 'Mon tampon', color: [0.2, 0.2, 0.7], frame: false }, { cx: 150, cy: 200 });
    const r = await save([s], 1);
    assert(r.texts.some((t) => t.str === 'MON TAMPON') && near(r.px(150, 200 + s.h / 2 + 2), [1, 1, 1], 0.05), 'tampon texte sans cadre');
    console.log('  ok   tampon texte personnalisé (sans cadre)');
  }

  // ---------------------------------------------------------------- images
  const pngT = png(40, 40, (g) => { g.fillStyle = 'rgb(220,20,20)'; g.fillRect(0, 0, 20, 40); }); // moitié droite transparente
  const jpgB = jpg(40, 40, (g) => { g.fillStyle = 'rgb(20,40,220)'; g.fillRect(0, 0, 40, 40); });
  const assets = { images: { A: { mime: 'image/png', bytes: pngT }, B: { mime: 'image/jpeg', bytes: jpgB } } };
  const img = (id, extra) => Object.assign({ type: 'image', imgId: id, cx: 100, cy: 60, w: 80, h: 80, rot: 0, opacity: 1 }, extra);
  {
    const r = await save([img('A')], 1, assets);
    assert(near(r.px(80, 60), [0.86, 0.08, 0.08], 0.12), 'PNG : partie opaque rouge');
    assert(near(r.px(120, 60), [0, 0, 0], 0.08), 'PNG : transparence conservée (le fond noir de la page est visible)');
    const r2 = await save([img('A', { cx: 250, cy: 200 })], 1, assets);
    assert(near(r2.px(270, 200), [1, 1, 1], 0.05), 'PNG : transparence sur page blanche');
    console.log('  ok   image PNG avec transparence');
    const rj = await save([img('B', { cx: 220, cy: 200 })], 1, assets);
    assert(near(rj.px(220, 200), [0.08, 0.16, 0.86], 0.15), 'JPEG : couleur');
    console.log('  ok   image JPEG');
    const ro = await save([img('B', { cx: 220, cy: 200, opacity: 0.5 })], 1, assets);
    assert(near(ro.px(220, 200), [0.54, 0.58, 0.93], 0.12), 'opacité 50 %');
    for (const [pageNo, label] of [[2, 'paysage'], [3, 'Rotate 90']]) {
      const rp = await save([img('B', { cx: 200, cy: 120 })], pageNo, assets);
      assert(near(rp.px(200, 120), [0.08, 0.16, 0.86], 0.15) && near(rp.px(260, 120), [1, 1, 1], 0.06), `image ${label} : position`);
    }
    // rotation 90° d'une image 60 × 20 (gauche rouge, droite bleue) : devient 20 × 60, rouge en bas
    const half = png(60, 20, (g) => { g.fillStyle = 'rgb(220,20,20)'; g.fillRect(0, 0, 30, 20); g.fillStyle = 'rgb(20,40,220)'; g.fillRect(30, 0, 30, 20); });
    const a2 = { images: { H: { mime: 'image/png', bytes: half } } };
    const rr = await save([{ type: 'image', imgId: 'H', cx: 220, cy: 180, w: 60, h: 20, rot: 90, opacity: 1 }], 1, a2);
    assert(near(rr.px(220, 165), [0.86, 0.08, 0.08], 0.12) && near(rr.px(220, 195), [0.08, 0.16, 0.86], 0.15), 'image tournée de 90° (rouge en bas, bleu en haut)');
    assert(near(rr.px(245, 180), [1, 1, 1], 0.05), 'image tournée : la largeur est devenue la hauteur');
    console.log('  ok   image : opacité, rotation, paysage, /Rotate 90');
    // même image posée trois fois : intégrée une seule fois
    const one = await save([img('A')], 1, assets);
    const three = await save([img('A'), img('A', { cx: 200 }), img('A', { cx: 250 })], 1, assets);
    assert.strictEqual(await imageCount(three.out), await imageCount(one.out), 'pas de duplication d\'une image posée plusieurs fois');
    assert((await imageCount(three.out)) >= 1);
    console.log('  ok   une image posée 3 fois n\'est intégrée qu\'une fois (' + (await imageCount(three.out)) + ' objets image)');
    await assert.rejects(() => save([img('Z')], 1, assets), /Image introuvable/);
  }

  // ---------------------------------------------------------------- signature tracée
  {
    const sig = { type: 'sig', cx: 220, cy: 200, w: 100, h: 40, w0: 100, lw: 3, rot: 0, color: [0, 0, 0.5], opacity: 1, strokes: [[[0.05, 0.1], [0.5, 0.9], [0.95, 0.1]], [[0.5, 0.5]]] };
    const r = await save([sig], 1);
    assert(near(r.px(220, 200 + 40 * 0.4), [0, 0, 0.5], 0.2), 'signature : tracé');
    assert(near(r.px(180, 215), [1, 1, 1], 0.05), 'signature : fond transparent');
    for (const [pageNo, label] of [[2, 'paysage'], [3, 'Rotate 90']]) {
      const rp = await save([Object.assign({}, sig, { cx: 200, cy: 120 })], pageNo);
      assert(near(rp.px(200, 120 + 40 * 0.4), [0, 0, 0.5], 0.2), `signature ${label}`);
    }
    const big = await save([Object.assign({}, sig, { w: 200, h: 80, cx: 150, cy: 150 })], 1);
    const thick = [...Array(12).keys()].filter((k) => near(big.px(150, 150 + 80 * 0.4 + 3 - k * 0.5), [0, 0, 0.5], 0.25)).length;
    assert(thick >= 3, 'signature agrandie : l\'épaisseur du trait suit l\'échelle');
    console.log('  ok   signature tracée (vectorielle, transparente, mise à l\'échelle)');
  }

  console.log('OK : note, tampons, images, signatures.');
})().catch((e) => { console.error('ÉCHEC :', e); process.exit(1); });
