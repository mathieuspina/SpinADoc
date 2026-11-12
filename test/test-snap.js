// Aimantation : segments extraits des opérateurs de tracé, extrémités et intersections. Usage : node test/test-snap.js [plan.pdf (lecture seule)]
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const PDFLib = require('@cantoo/pdf-lib');
const Snap = require('../src/snap-geometry.js');

async function pdfjsLoad(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  return { pdfjs, doc };
}
const near = (p, x, y, tol = 1e-6) => p && Math.hypot(p.x - x, p.y - y) < tol;

(async () => {
  // PDF : deux lignes qui se croisent en (150,150), un rectangle (transformé par cm), une polyligne
  const d = await PDFLib.PDFDocument.create();
  const pg = d.addPage([300, 300]);
  pg.drawLine({ start: { x: 100, y: 100 }, end: { x: 200, y: 200 }, thickness: 1 });
  pg.drawLine({ start: { x: 100, y: 200 }, end: { x: 200, y: 100 }, thickness: 1 });
  pg.drawRectangle({ x: 20, y: 20, width: 40, height: 30, borderWidth: 1, borderColor: PDFLib.rgb(0, 0, 0) });
  pg.drawSvgPath('M 0 0 L 30 0 L 30 -20', { x: 220, y: 270, borderWidth: 1, borderColor: PDFLib.rgb(0, 0, 0) });
  const bytes = await d.save();
  const { pdfjs, doc } = await pdfjsLoad(bytes);
  const page = await doc.getPage(1);
  const geom = Snap.extract(await page.getOperatorList(), pdfjs.OPS);
  assert(geom.segs.length >= 4 * 8, 'segments extraits : ' + geom.segs.length / 4);
  const idx = new Snap.Index(geom, { x0: 0, y0: 0, w: 300, h: 300 });
  assert(near(idx.snap(151, 149, 5), 150, 150), 'intersection des deux lignes (150,150) : ' + JSON.stringify(idx.snap(151, 149, 5)));
  assert.strictEqual(idx.snap(151, 149, 5).kind, 'int');
  assert(near(idx.snap(102, 103, 6), 100, 100), 'extrémité d\'une ligne');
  assert(near(idx.snap(198, 99, 6), 200, 100) && idx.snap(198, 99, 6).kind === 'end', 'extrémité (priorité sur les intersections)');
  assert(near(idx.snap(61, 51, 5), 60, 50), 'coin de rectangle (tracé transformé par cm)');
  assert(near(idx.snap(21, 21, 5), 20, 20), 'coin de rectangle opposé');
  assert(near(idx.snap(250, 270, 5), 250, 270) || near(idx.snap(251, 251, 6), 250, 250), 'chemin SVG (transformation y inversé) : ' + JSON.stringify(idx.snap(250, 270, 5)));
  assert.strictEqual(idx.snap(10, 280, 5), null, 'rien à accrocher dans le vide');
  console.log('  ok   extraction (cm, rectangles, chemins) et accrochage');

  // Plan réel (lecture seule) : taille, durée d'extraction, durée d'une requête
  const real = process.argv[2] || process.env.SPINADOC_SNAP_PLAN || 'C:/Projets/SpinADoc/exemples/plan-exemple.pdf';
  if (fs.existsSync(real)) {
    const { pdfjs: pj, doc: rd } = await pdfjsLoad(fs.readFileSync(real));
    const rp = await rd.getPage(1);
    const [x0, y0, x1, y1] = rp.view;
    let t0 = performance.now();
    const ol = await rp.getOperatorList();
    const tOps = performance.now() - t0;
    t0 = performance.now();
    const g = Snap.extract(ol, pj.OPS);
    const tEx = performance.now() - t0;
    t0 = performance.now();
    const ix = new Snap.Index(g, { x0, y0, w: x1 - x0, h: y1 - y0 });
    const tIx = performance.now() - t0;
    t0 = performance.now();
    let hits = 0, n = 0;
    for (let i = 0; i < 300; i++) { const p = ix.snap(x0 + ((i * 97) % 1000) / 1000 * (x1 - x0), y0 + ((i * 53) % 1000) / 1000 * (y1 - y0), 6); n++; if (p) hits++; }
    const tQ = (performance.now() - t0) / n;
    console.log(`  info plan réel « ${path.basename(real)} » : ${ol.fnArray.length} opérateurs, ${g.segs.length / 4} segments, ${g.pts.length / 2} points ; getOperatorList ${tOps.toFixed(0)} ms, extraction ${tEx.toFixed(0)} ms, index ${tIx.toFixed(0)} ms, requête ${tQ.toFixed(3)} ms (${hits}/${n} points d'accroche trouvés)`);
    assert(g.segs.length > 0, 'le plan réel contient des tracés vectoriels');
    assert(tQ < 5, 'requête rapide');
  }
  console.log('OK : aimantation (extraction des tracés, extrémités, intersections).');
})().catch((e) => { console.error('ÉCHEC :', e); process.exit(1); });
