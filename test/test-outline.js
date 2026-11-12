// Signets après une opération de pages (logique) : déplacement, suppression, duplication, insertion d'une page blanche ; relecture pdf.js
// (titre → page de destination). Un signet dont la page est supprimée disparaît ; son enfant conservé remonte à sa place.
// Usage : node test/test-outline.js
const PDFLib = require('@cantoo/pdf-lib');
const path = require('path');
const DocModel = require('../src/doc-model.js');
const PageOps = require('../src/page-ops.js');
const PdfEdit = require('../src/pdf-edit.js');
const Outline = require('../src/outline.js');

const failures = [];
let passed = 0;
const check = (name, cond, detail) => { if (cond) { passed++; console.log('  ok   ', name); } else { failures.push(name); console.log('  ECHEC', name, detail !== undefined ? '→ ' + JSON.stringify(detail) : ''); } };
const FONTS = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep;

(async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // 4 pages ; signets : « Plan A » → p1 (enfant « Détail A » → p2), « Coupe » → p3 (par destination nommée), « Notes » → p4
  const d = await PDFLib.PDFDocument.create();
  const pg = [0, 1, 2, 3].map(() => d.addPage([595, 842]));
  const ctx = d.context, N = (s) => PDFLib.PDFName.of(s);
  d.catalog.set(N('Names'), ctx.obj({ Dests: ctx.obj({ Names: [PDFLib.PDFString.of('coupe'), ctx.obj([pg[2].ref, 'Fit'])] }) }));
  const root = ctx.nextRef(), a = ctx.nextRef(), a1 = ctx.nextRef(), b = ctx.nextRef(), c = ctx.nextRef();
  ctx.assign(a1, ctx.obj({ Title: PDFLib.PDFHexString.fromText('Détail A'), Parent: a, Dest: [pg[1].ref, 'Fit'] }));
  ctx.assign(a, ctx.obj({ Title: PDFLib.PDFHexString.fromText('Plan A'), Parent: root, Next: b, First: a1, Last: a1, Count: 1, Dest: [pg[0].ref, 'Fit'] }));
  ctx.assign(b, ctx.obj({ Title: PDFLib.PDFHexString.fromText('Coupe'), Parent: root, Prev: a, Next: c, Dest: PDFLib.PDFString.of('coupe') }));
  ctx.assign(c, ctx.obj({ Title: PDFLib.PDFHexString.fromText('Notes'), Parent: root, Prev: b, Dest: [pg[3].ref, 'XYZ', 0, 800, 0] }));
  ctx.assign(root, ctx.obj({ Type: 'Outlines', First: a, Last: c, Count: 4 }));
  d.catalog.set(N('Outlines'), root);
  const bytes = await d.save();

  const src = await PDFLib.PDFDocument.load(bytes);
  const tree = Outline.read(PDFLib, src);
  check('lecture : 3 signets de premier niveau, « Coupe » (destination nommée) → page 3', tree.length === 3 && tree[1].pageIndex === 2 && tree[0].children[0].pageIndex === 1, tree.map((n) => [n.title, n.pageIndex]));

  const flat = async (out) => {
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(out), verbosity: 0, standardFontDataUrl: FONTS }).promise;
    const res = [];
    const walk = async (items, pre) => { for (const it of items || []) { const dest = Array.isArray(it.dest) ? it.dest : await pdf.getDestination(it.dest); const idx = dest ? await pdf.getPageIndex(dest[0]) : -1; res.push(pre + it.title + '→' + (idx + 1)); await walk(it.items, pre + '  '); } };
    await walk(await pdf.getOutline(), '');
    await pdf.destroy();
    return res;
  };
  const run = async (op) => {
    const doc = DocModel.createDoc({ bytes, name: 'plans.pdf' });
    const id = PageOps.identity(4); DocModel.initPages(doc, id.pages, id.nextUid);
    DocModel.setPagesState(doc, op(DocModel.pageState(doc)));
    return flat(await PdfEdit.applyEdits(PDFLib, doc.bytes.slice(), [], { pages: { list: doc.pages, sources: doc.sources } }));
  };
  let r = await run((st) => PageOps.move(st, [3], 0));
  check('page 4 déplacée en tête : Notes→1, Plan A→2, Détail A→3, Coupe→4', r.join('|') === 'Plan A→2|  Détail A→3|Coupe→4|Notes→1', r);
  r = await run((st) => PageOps.remove(st, [0]));
  check('page 1 supprimée : « Plan A » pointe sur son enfant conservé (page 1), Coupe→2, Notes→3', r.join('|') === 'Plan A→1|  Détail A→1|Coupe→2|Notes→3', r);
  r = await run((st) => PageOps.remove(st, [2]));
  check('page 3 supprimée : le signet « Coupe » disparaît', r.join('|') === 'Plan A→1|  Détail A→2|Notes→3', r);
  r = await run((st) => PageOps.duplicate(st, [0]));
  check('page 1 dupliquée : les signets pointent sur la première occurrence, les suivants décalés', r.join('|') === 'Plan A→1|  Détail A→3|Coupe→4|Notes→5', r);
  r = await run((st) => PageOps.insert(st, 0, [{ src: PageOps.blankId(595, 842), i: 0 }]));
  check('page blanche insérée en tête : tout décalé d\'une page', r.join('|') === 'Plan A→2|  Détail A→3|Coupe→4|Notes→5', r);

  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : signets après opérations de pages.');
})().catch((e) => { console.error(e); process.exit(1); });
