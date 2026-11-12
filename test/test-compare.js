// Comparaison (logique pure) : zones, alignement, tolérance, formats différents, page vide, texte ajouté / supprimé, correspondance des pages,
// rapport PDF relu avec pdf.js. Pages fabriquées par code (traits et rectangles d'« encre »). Mesure durée et mémoire sur un A0.
// Usage : node test/test-compare.js   (COMPARE_BENCH=0 pour sauter la mesure A0)
const zlib = require('zlib');
const PDFLib = require('@cantoo/pdf-lib');
const Compare = require('../src/compare.js');
const PdfEdit = require('../src/pdf-edit.js');
const Report = require('../src/compare-report.js');

const failures = [];
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   ', name); }
  else { failures.push(name); console.log('  ECHEC', name, detail !== undefined ? '→ ' + JSON.stringify(detail) : ''); }
}

const K = 2; // px par point : 1 px = 0,176 mm
const W = 800, H = 600;
const img = (w = W, h = H) => ({ w, h, d: new Uint8Array(w * h) });
const rect = (im, x0, y0, x1, y1) => { for (let y = Math.max(0, y0); y < Math.min(im.h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(im.w, x1); x++) im.d[y * im.w + x] = 255; };
const hline = (im, x0, x1, y, t = 3) => rect(im, x0, y, x1, y + t);
const vline = (im, x, y0, y1, t = 3) => rect(im, x, y0, x + t, y1);
// Plan de référence : cadre, quelques traits et blocs irréguliers (pas de motif périodique qui tromperait la corrélation).
function scene() {
  const im = img();
  rect(im, 100, 100, 700, 103); rect(im, 100, 497, 700, 500); rect(im, 100, 100, 103, 500); rect(im, 697, 100, 700, 500);
  hline(im, 130, 380, 180); vline(im, 250, 130, 330); hline(im, 300, 650, 260, 4); vline(im, 520, 150, 470, 4);
  rect(im, 140, 380, 210, 440); rect(im, 560, 300, 640, 330); hline(im, 150, 230, 350, 2); vline(im, 400, 300, 450, 2); rect(im, 330, 420, 360, 470);
  return im;
}
const shifted = (im, sx, sy) => { const o = img(im.w, im.h); for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) { const nx = x + sx, ny = y + sy; if (nx >= 0 && ny >= 0 && nx < im.w && ny < im.h) o.d[ny * im.w + nx] = im.d[y * im.w + x]; } return o; };
const diff = (a, b, dx, dy, o) => Compare.diffMaps(a.d, a.w, a.h, b.d, b.w, b.h, dx || 0, dy || 0, K, o);
const al = (a, b) => Compare.align(a.d, a.w, a.h, b.d, b.w, b.h);

// PNG minimal (RGBA 8 bits) pour le test du rapport.
function png(w, h, rgba) {
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, d) => { const o = Buffer.alloc(12 + d.length); o.writeUInt32BE(d.length, 0); o.write(t, 4, 'latin1'); Buffer.from(d).copy(o, 8); o.writeUInt32BE(crc(o.subarray(4, 8 + d.length)), 8 + d.length); return o; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

(async () => {
  const A = scene();

  console.log('1. Page identique, trait ajouté, trait supprimé');
  let r = diff(A, scene());
  check('identique : 0 différence, 0 %', r.regions.length === 0 && r.stats.percent === 0, r.stats);
  const B1 = scene(); hline(B1, 180, 330, 540, 3);
  r = diff(A, B1);
  check('trait ajouté : 1 zone « added », rien d\'ancien', r.regions.length === 1 && r.regions[0].kind === 'added' && r.stats.old === 0, r.regions);
  check('la zone englobe le trait (180..330 × 540..543)', r.regions[0].x0 <= 180 && r.regions[0].x1 >= 330 && r.regions[0].y0 <= 540 && r.regions[0].y1 >= 543, r.regions[0]);
  const B2 = scene(); rect(B2, 330, 420, 360, 470, 0); for (let y = 420; y < 470; y++) for (let x = 330; x < 360; x++) B2.d[y * W + x] = 0;
  r = diff(A, B2);
  check('bloc supprimé : 1 zone « removed »', r.regions.length === 1 && r.regions[0].kind === 'removed' && r.stats.nu === 0, r.regions);
  const B3 = scene(); hline(B3, 180, 330, 540, 3); for (let y = 420; y < 470; y++) for (let x = 330; x < 360; x++) B3.d[y * W + x] = 0;
  r = diff(A, B3);
  check('un ajout et une suppression éloignés : 2 zones numérotées 1 et 2', r.regions.length === 2 && r.regions[0].id === 1 && r.regions[1].id === 2, r.regions.map((g) => [g.id, g.kind]));
  check('pourcentage de changement strictement entre 0 et 100', r.stats.percent > 0 && r.stats.percent < 100, r.stats.percent);

  console.log('2. Alignement automatique (déplacement de 5 mm)');
  const sx = Math.round(5 / Compare.mmPerPx(K)), sy = -Math.round(3 / Compare.mmPerPx(K)); // 28 px, -17 px
  const S = shifted(A, sx, sy);
  const a = al(A, S);
  check(`décalage retrouvé exactement (${-sx}, ${-sy})`, a.dx === -sx && a.dy === -sy && a.confident, a);
  r = diff(A, S, a.dx, a.dy);
  check('avec ce décalage : 0 différence', r.regions.length === 0, r.regions.length);
  r = diff(A, S, 0, 0);
  check('sans alignement : des différences (déplacement non compensé)', r.regions.length > 0 && r.stats.percent > 20, r.stats);
  const a0 = al(A, scene());
  check('pages identiques : décalage nul', a0.dx === 0 && a0.dy === 0, a0);
  const Sb = shifted(A, 3, 2); hline(Sb, 180, 330, 540, 3);
  const ab = al(A, Sb);
  check('alignement robuste à un ajout (petit décalage + trait ajouté)', ab.dx === -3 && ab.dy === -2, ab);
  r = diff(A, Sb, ab.dx, ab.dy);
  check('… et il ne reste que le trait ajouté', r.regions.length === 1 && r.regions[0].kind === 'added', r.regions.length);

  console.log('3. Tolérance (micro-décalages d\'antialiasing)');
  const S1 = shifted(A, 1, 1);
  check('décalage de 1 px, tolérance 0,5 mm : 0 différence', diff(A, S1, 0, 0, { tolMm: 0.5 }).regions.length === 0);
  check('décalage de 1 px, tolérance 0 : des différences', diff(A, S1, 0, 0, { tolMm: 0 }).regions.length > 0);
  const S4 = shifted(A, 6, 0);
  check('décalage de 6 px (1 mm) dépasse la tolérance 0,5 mm', diff(A, S4, 0, 0, { tolMm: 0.5 }).regions.length > 0);
  check('… mais pas une tolérance de 1,5 mm', diff(A, S4, 0, 0, { tolMm: 1.5 }).regions.length === 0);

  console.log('4. Formats de page différents, page vide');
  const Bsmall = img(600, 500); for (let y = 0; y < 500; y++) for (let x = 0; x < 600; x++) Bsmall.d[y * 600 + x] = A.d[y * W + x];
  r = diff(A, Bsmall, 0, 0);
  check('formats différents : cadre = union, zone commune = la plus petite', !r.frame.sameSize && r.frame.W === 800 && r.frame.H === 600 && r.frame.common.x1 === 600 && r.frame.common.y1 === 500, r.frame);
  check('le contenu hors zone commune n\'est pas compté comme différence', r.regions.length === 0, r.regions.length);
  check('… il est marqué « hors zone » (classe 5) dans la carte', r.map.includes(Compare.C.OUT_INK));
  const E = img();
  r = diff(E, img(), 0, 0);
  check('deux pages vides : 0 différence, 0 %, alignement nul', r.regions.length === 0 && r.stats.percent === 0 && al(E, img()).dx === 0);
  r = diff(E, A, 0, 0);
  check('page vide contre plan : tout est « nouveau » (100 %)', r.stats.old === 0 && r.stats.nu > 0 && Math.round(r.stats.percent) === 100, r.stats);
  r = diff(A, E, 0, 0);
  check('plan contre page vide : tout est « ancien »', r.stats.nu === 0 && r.stats.old > 0, r.stats);

  console.log('5. Résolution commune et conversions');
  const k = Compare.planScale([[2384, 3370], [1684, 2384]], 4096, 12e6);
  check('A0 : le plus grand côté tient dans 4096 px', Math.max(2384, 3370) * k <= 4096.001, k);
  check('A5 : plafonné à 4 px/pt', Compare.planScale([[420, 595]], 4096, 12e6) === 4);
  check('conversions mm ↔ px cohérentes', Math.abs(Compare.pxToMm(Compare.mmToPx(5, K), K) - 5) < 0.1);

  console.log('6. Texte : ajouts et suppressions');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  async function textPdf(lines) {
    const d = await PDFLib.PDFDocument.create();
    const f = await d.embedFont(PDFLib.StandardFonts.Helvetica);
    const p = d.addPage([400, 300]);
    lines.forEach((t, i) => p.drawText(t, { x: 30, y: 250 - i * 24, size: 14, font: f }));
    if (!lines.length) d.addPage([400, 300]);
    return d.save();
  }
  async function tokens(bytes) {
    const p = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
    const t = Compare.tokenize((await (await p.getPage(1)).getTextContent()).items);
    await p.destroy();
    return t;
  }
  const to = await tokens(await textPdf(['Poutre IPE 200 acier S235', 'Entraxe 600 mm', 'Indice A']));
  const tn = await tokens(await textPdf(['Poutre IPE 240 acier S235', 'Entraxe 600 mm', 'Indice B', 'Voir note 4']));
  check('mots extraits avec une boîte positive', to.length === 10 && to.every((t) => t.x1 > t.x0 && t.y1 > t.y0), to.length);
  const d = Compare.diffWords(to.map((t) => t.w), tn.map((t) => t.w));
  const gone = to.filter((_, i) => d.a[i]).map((t) => t.w), added = tn.filter((_, i) => d.b[i]).map((t) => t.w);
  check('supprimés : « 200 » et « A »', JSON.stringify(gone) === JSON.stringify(['200', 'A']), gone);
  check('ajoutés : « 240 », « B », « Voir note 4 »', JSON.stringify(added) === JSON.stringify(['240', 'B', 'Voir', 'note', '4']), added);
  check('modifications regroupées (2 remplacements, le dernier étendu par l\'ajout)', d.changes.map((c) => c.type).join() === 'changed,changed', d.changes.map((c) => c.type));
  const same = Compare.diffWords(to.map((t) => t.w), to.map((t) => t.w));
  check('texte identique : aucune modification', same.changes.length === 0);
  check('page sans texte (vide) : aucun mot, sans erreur', (await tokens(await textPdf([]))).length === 0);
  const big = Array.from({ length: 6000 }, (_, i) => 'm' + i), big2 = Array.from({ length: 6000 }, (_, i) => 'n' + i);
  const dc = Compare.diffWords(big, big2, 500);
  check('texte entièrement différent et très long : plafonné sans planter', dc.capped && dc.a.every((x) => x === 1));

  console.log('7. Correspondance des pages');
  check('3 pages contre 5 : 5 paires, les 2 dernières « ajoutées »', (() => { const p = Compare.defaultPairs(3, 5); return p.length === 5 && p[3].a === null && Compare.pairKind(p[4]) === 'added' && Compare.pairKind(p[0]) === 'both'; })());
  check('5 contre 3 : les 2 dernières « supprimées »', Compare.pairKind(Compare.defaultPairs(5, 3)[4]) === 'removed');

  console.log('8. Rapport PDF (une page par page comparée)');
  const rr = diff(A, B3);
  const pal = Compare.DEFAULT_PALETTE;
  const rgba = new Uint8ClampedArray(W * H * 4);
  Compare.paintRows(rr.map, W, 0, H, { old: Compare.parseColor(pal.old), nu: Compare.parseColor(pal.nu), same: Compare.parseColor(pal.same) }, rgba);
  const pngBytes = png(W, H, rgba);
  const pageInfo = (t) => ({ png: pngBytes, W, H, k: K, regions: rr.regions, title: t, pal, mmPerPx: rr.mmPerPx, tolMm: 0.5, stats: rr.stats, shiftMm: [0, 0] });
  const out = await Report.buildReport(PDFLib, PdfEdit, [pageInfo('Ancien : a.pdf p. 1 — Nouveau : b.pdf p. 1'), pageInfo('Ancien : a.pdf p. 2 — Nouveau : b.pdf p. 2')]);
  const rp = await pdfjs.getDocument({ data: new Uint8Array(out), verbosity: 0 }).promise;
  check('2 pages, taille = image en points + légende', rp.numPages === 2 && (await rp.getPage(1)).view[2] === W / K && (await rp.getPage(1)).view[3] > H / K, rp.numPages);
  const txt = (await (await rp.getPage(2)).getTextContent()).items.map((i) => i.str).join(' ');
  check('légende, titre et numéros de zones présents dans le PDF', /Ancien seulement/.test(txt) && /Nouveau seulement/.test(txt) && /Inchangé/.test(txt) && /p\. 2/.test(txt) && /2 différences/.test(txt) && /\b1\b/.test(txt) && /\b2\b/.test(txt), txt.slice(0, 300));
  const ops = await (await rp.getPage(1)).getOperatorList();
  check('image de superposition présente', ops.fnArray.some((f) => f === pdfjs.OPS.paintImageXObject || f === pdfjs.OPS.paintInlineImageXObject));
  await rp.destroy();

  if (process.env.COMPARE_BENCH !== '0') {
    console.log('9. Mesure sur un A0 (2384 × 3370 pt) à 4096 px');
    const kA0 = Compare.planScale([[2384, 3370]], 4096, 12e6), w0 = Math.ceil(2384 * kA0), h0 = Math.ceil(3370 * kA0);
    const big0 = img(w0, h0);
    for (let i = 0; i < 4000; i++) { const x = (i * 7919) % (w0 - 100), y = (i * 104729) % (h0 - 20); hline(big0, x, x + 20 + (i % 70), y, 2); vline(big0, x + 5, y, y + 10 + (i % 50), 2); }
    const big1 = shifted(big0, 23, -14); hline(big1, 500, 900, 1000, 3);
    const rss0 = process.memoryUsage().rss;
    let t = Date.now();
    const ba = Compare.align(big0.d, w0, h0, big1.d, w0, h0);
    const tAlign = Date.now() - t;
    t = Date.now();
    const bd = Compare.diffMaps(big0.d, w0, h0, big1.d, w0, h0, ba.dx, ba.dy, kA0, { tolMm: 0.5 });
    const tDiff = Date.now() - t;
    const rssMo = Math.round((process.memoryUsage().rss - rss0) / 1048576);
    console.log(`     A0 ${w0}×${h0} px (${Compare.mmPerPx(kA0).toFixed(3)} mm/px, ${Math.round(Compare.dpiOf(kA0))} dpi) : alignement ${tAlign} ms, différences ${tDiff} ms, mémoire supplémentaire ≈ ${rssMo} Mo, ${bd.regions.length} zone(s)`);
    check('A0 : décalage retrouvé et seule la différence ajoutée subsiste', ba.dx === -23 && ba.dy === 14 && bd.regions.some((g) => g.kind === 'added'), { ba, n: bd.regions.length });
    check('A0 : alignement + différences en moins de 20 s', tAlign + tDiff < 20000, tAlign + tDiff);
  }

  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : comparaison (logique).');
})();
