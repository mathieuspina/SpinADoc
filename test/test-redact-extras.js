// Caviardage, structures hors du contenu des pages (logique, sans interface). PDF piège n° 2 (test/lib/make-redact-extras-pdf.js) : un secret
// différent dans les signets (page caviardée et page conservée), la pièce jointe du document, le JavaScript du document, l'action à l'ouverture,
// une destination nommée, un champ de la page caviardée (relié par la hiérarchie du formulaire à des champs de la page conservée), un champ masqué,
// une action de page, un lien JavaScript, une pièce jointe en annotation et une note de la page conservée.
// Vérifie : l'inventaire (liste « Éléments à vérifier »), puis après application + enregistrement ce qui est supprimé et ce qui subsiste.
// Usage : node test/test-redact-extras.js
const PDFLib = require('@cantoo/pdf-lib');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');
const Shapes = require('../src/shapes.js');
const DocModel = require('../src/doc-model.js');
const PageOps = require('../src/page-ops.js');
const PdfEdit = require('../src/pdf-edit.js');
require('../src/text-info.js');
const Redact = require('../src/redact.js');
const RedactApply = require('../src/redact-apply.js');
const RedactActive = require('../src/redact-active.js');
const { makeRedactExtrasPdf, S, PUBLIC2 } = require('./lib/make-redact-extras-pdf.js');
const { scan } = require('./lib/secret-scan.js');

const failures = [];
let passed = 0;
const check = (name, cond, detail) => { if (cond) { passed++; console.log('  ok   ', name); } else { failures.push(name); console.log('  ECHEC', name, detail !== undefined ? '→ ' + JSON.stringify(detail).slice(0, 400) : ''); } };
const FONTS = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep;
const found = (bytes) => Object.keys(S).filter((k) => scan(bytes, S[k]).hits.length);

(async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const load = (bytes) => pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, standardFontDataUrl: FONTS, isEvalSupported: false }).promise;
  const measure = Shapes.makeMeasure(PDFLib);
  const deps = { PDFLib, measure, loadPdf: (b) => load(b.slice ? b.slice() : b), createCanvas: (w, h) => { const c = createCanvas(w, h); return { canvas: c, context: c.getContext('2d') }; }, renderCanvasFactory: 'auto' };
  const orig = await makeRedactExtrasPdf();

  console.log('1. Témoin positif : chaque secret est présent dans le fichier d\'origine');
  check('les 13 secrets sont trouvés dans le fichier d\'origine', found(orig).length === Object.keys(S).length, found(orig));

  console.log('2. Inventaire (boîte « Appliquer ») : document d\'origine, pages conservées 2 et 3');
  const src = await PDFLib.PDFDocument.load(orig, { updateMetadata: false });
  const inv = RedactActive.inventory(PDFLib, src, [1, 2]);
  const exp = { outlines: 2, embedded: 1, docJs: 2, dests: 1, fields: 3, pageActions: 1, attachments: 1, actions: 1, namedLinks: 1, hidden: 1, widgets: 1, comments: 1, media: 0, uris: 0 };
  check('inventaire : signets 2, pièce jointe 1, JavaScript 2, destination 1, champs 3, action de page 1, pièce jointe en annotation 1, action de lien 1, lien nommé 1, masqué 1, commentaire 1',
    Object.keys(exp).every((k) => inv[k] === exp[k]), inv);
  const items = RedactActive.items(inv);
  check('liste : 11 éléments, dont « commentaires » marqué CONSERVÉ (seul élément conservé)', items.length === 11 && items.filter((i) => i.fate === 'kept').map((i) => i.key).join() === 'comments', items.map((i) => i.key + ':' + i.fate));
  check('l\'inventaire ne modifie pas le document', found(await src.save({ useObjectStreams: false })).length === Object.keys(S).length);
  const none = RedactActive.items(RedactActive.inventory(PDFLib, await PDFLib.PDFDocument.load(await (await PDFLib.PDFDocument.create()).save()), [0]));
  check('document vide : liste vide', none.length === 0, none);

  console.log('3. Application (zone sur toute la page 1) puis enregistrement');
  const doc = DocModel.createDoc({ bytes: orig, name: 'piege2.pdf' });
  const id = PageOps.identity(3); DocModel.initPages(doc, id.pages, id.nextUid);
  DocModel.addEdit(doc, Redact.zoneFromRect(0, [0, 0, 595, 842]));
  const res = await RedactApply.apply(doc, deps, { dpi: 72 });
  RedactApply.commit(DocModel, doc, res);
  let scrubbed = null;
  const out = await PdfEdit.applyEdits(PDFLib, doc.bytes.slice(), doc.edits, { pages: { list: doc.pages, sources: doc.sources }, scrub: Redact.hasRedacted(doc.pages), onScrub: (s) => { scrubbed = s; } });
  const left = found(out);
  const removedKeys = ['outline1', 'outline2', 'embed', 'js', 'open', 'dest', 'field', 'hidden', 'pageAA', 'linkJS', 'annotFile', 'text1'];
  for (const k of removedKeys) check(`supprimé : ${k} (« ${S[k]} ») absent des octets (bruts, décompressés, UTF-16, hexadécimal)`, !left.includes(k));
  check('SUBSISTE (comportement documenté, signalé dans la liste) : texte de la note de la page conservée', left.includes('note'), left);
  check('bilan du nettoyage : structures actives comptées (pièce jointe, action, champs, masqué)', scrubbed && scrubbed.active && scrubbed.active.attachments === 1 && scrubbed.active.actions === 1 && scrubbed.active.hidden === 1 && scrubbed.active.widgets === 1, scrubbed && scrubbed.active);

  console.log('4. Relecture pdf.js du fichier enregistré');
  const pdf = await load(out);
  check('3 pages', pdf.numPages === 3);
  check('aucun signet', !(await pdf.getOutline()) || (await pdf.getOutline()).length === 0);
  check('aucune pièce jointe', !(await pdf.getAttachments()) || Object.keys(await pdf.getAttachments()).length === 0);
  check('aucun JavaScript du document', !(await pdf.getJSActions()));
  check('aucune destination nommée', Object.keys((await pdf.getDestinations()) || {}).length === 0);
  check('aucun champ de formulaire', !(await pdf.getFieldObjects()));
  const p2 = await pdf.getPage(2);
  check('page 2 : aucune action de page', !(await p2.getJSActions()));
  const an = await p2.getAnnotations();
  check('page 2 : restent 2 liens inertes, la note et le champ visible figé (ni pièce jointe ni champ masqué)', an.map((a) => a.subtype).sort().join() === 'Link,Link,Text,Widget', an.map((a) => a.subtype));
  check('page 2 : les liens n\'ont plus ni action ni destination', an.filter((a) => a.subtype === 'Link').every((a) => !a.url && !a.dest && !a.action), an.filter((a) => a.subtype === 'Link'));
  check('page 2 : le widget restant n\'a plus ni nom ni valeur de champ', an.filter((a) => a.subtype === 'Widget').every((a) => !a.fieldName && !a.fieldValue), an.filter((a) => a.subtype === 'Widget').map((a) => [a.fieldName, a.fieldValue]));
  const txt = (await p2.getTextContent()).items.map((t) => t.str).join(' ');
  check('page 2 : texte public intact', txt.includes(PUBLIC2), txt);
  const vp = p2.getViewport({ scale: 2 });
  const cc = pdf.canvasFactory.create(Math.ceil(vp.width), Math.ceil(vp.height));
  await p2.render({ canvasContext: cc.context, viewport: vp, canvasFactory: pdf.canvasFactory, background: 'rgb(255,255,255)' }).promise;
  const img = cc.context.getImageData(0, 0, cc.canvas.width, cc.canvas.height);
  let ink = 0;
  for (let x = 74; x < 160; x += 0.5) for (let y = 544; y < 560; y += 0.5) { const q = vp.convertToViewportPoint(x, y); const i = (Math.round(q[1]) * img.width + Math.round(q[0])) * 4; if (img.data[i] < 100) ink++; }
  check('page 2 : la valeur visible du champ « nom » reste affichée (apparence figée)', ink > 20, ink);
  await pdf.destroy();

  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : caviardage, structures hors contenu.');
})().catch((e) => { console.error(e); process.exit(1); });
