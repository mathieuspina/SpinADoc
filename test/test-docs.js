// Documents : métadonnées de résolution des images (PNG pHYs, JPEG JFIF), propriétés du document (relecture après écriture, accents), mot de passe
// (faux, bon, chiffrement à l'écriture), optimisation (taille et contenu identique), historique des propriétés.
// Usage : node test/test-docs.js
const assert = require('assert');
const zlib = require('zlib');
const PDFLib = require('@cantoo/pdf-lib');
const IM = require('../src/image-meta.js');
const DM = require('../src/doc-model.js');
const PO = require('../src/page-ops.js');
const { applyEdits } = require('../src/pdf-edit.js');

const near = (a, b, t, m) => assert(Math.abs(a - b) <= t, `${m || ''} ${a} ≠ ${b}`);
const meas = { scales: {}, unit: 'm', precision: 2, include: true };

function makePng(w, h) { // PNG RVB sans entrelacement, rempli de blanc
  const crc = IM.crc32;
  const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'ascii'); data.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + data.length)), 8 + data.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h, 255); for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
const JPEG = new Uint8Array(Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=', 'base64'));

(async () => {
  // ---- métadonnées de résolution
  const png = makePng(12, 7);
  assert.deepStrictEqual(IM.size(png), { w: 12, h: 7, type: 'png' });
  assert.strictEqual(IM.dpiOf(png), null);
  const p300 = IM.setDpi(png, 300);
  assert.deepStrictEqual(IM.size(p300), { w: 12, h: 7, type: 'png' }, 'dimensions conservées');
  near(IM.dpiOf(p300), 300, 0.05, 'PNG 300 dpi');
  near(IM.dpiOf(IM.setDpi(p300, 72)), 72, 0.05, 'pHYs remplacé, pas dupliqué');
  assert.strictEqual(Buffer.from(IM.setDpi(p300, 72)).toString('latin1').split('pHYs').length - 1, 1);
  assert.doesNotThrow(() => zlib.inflateSync(Buffer.from(IM.setDpi(png, 96)).subarray(0).slice(Buffer.from(IM.setDpi(png, 96)).indexOf('IDAT') + 4, Buffer.from(IM.setDpi(png, 96)).indexOf('IEND') - 8)), 'flux de données intact');
  assert.deepStrictEqual(IM.size(JPEG), { w: 1, h: 1, type: 'jpg' });
  near(IM.dpiOf(IM.setDpi(JPEG, 200)), 200, 0.01, 'JPEG 200 dpi');
  assert.deepStrictEqual(IM.size(IM.setDpi(JPEG, 200)), { w: 1, h: 1, type: 'jpg' });
  assert.strictEqual(IM.size(new Uint8Array([1, 2, 3])), null);

  // ---- document source
  const src = await PDFLib.PDFDocument.create();
  const font = await src.embedFont(PDFLib.StandardFonts.Helvetica);
  for (let i = 0; i < 40; i++) {
    const p = src.addPage([595, 842]);
    p.drawText('Contenu de la page ' + (i + 1), { x: 50, y: 700, size: 14, font });
    for (let k = 0; k < 20; k++) p.drawRectangle({ x: 20 + k * 3, y: 100 + k * 5, width: 40, height: 10, borderWidth: 0.5 });
  }
  src.setTitle('Titre d\'origine'); src.setAuthor('Auteur A');
  const plainBytes = await src.save({ useObjectStreams: false });
  const id = PO.identity(40);
  const run = (bytes, extra) => applyEdits(PDFLib, bytes, [], Object.assign({ images: {}, measure: meas, pages: { list: id.pages, sources: {} }, numbering: [] }, extra || {}));
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const openJs = (b, password) => pdfjs.getDocument({ data: new Uint8Array(b), verbosity: 0, password }).promise;

  // ---- propriétés : relecture après écriture (accents, valeur vide = entrée retirée)
  const withInfo = await run(plainBytes, { info: { title: 'Plan d\'étage — été', author: 'Léa Dupont', subject: 'Sujet ç', keywords: 'béton, acier' } });
  let js = await openJs(withInfo);
  let info = (await js.getMetadata()).info;
  assert.strictEqual(info.Title, 'Plan d\'étage — été');
  assert.strictEqual(info.Author, 'Léa Dupont');
  assert.strictEqual(info.Subject, 'Sujet ç');
  assert.strictEqual(info.Keywords, 'béton, acier');
  const cleared = await run(withInfo, { info: { title: '', author: 'Léa Dupont' } });
  info = (await (await openJs(cleared)).getMetadata()).info;
  assert(!info.Title && info.Author === 'Léa Dupont' && info.Keywords === 'béton, acier', JSON.stringify(info));
  const untouched = await run(plainBytes, { info: null });
  assert.strictEqual((await (await openJs(untouched)).getMetadata()).info.Title, 'Titre d\'origine', 'sans changement : valeurs du fichier');
  // historique
  const doc = DM.createDoc({}); DM.initPages(doc, PO.identity(2).pages, 3);
  DM.setInfo(doc, { title: 'T', author: '', subject: '', keywords: '' });
  assert(doc.dirty && doc.info.title === 'T' && doc.undo.length === 1);
  DM.undo(doc); assert.strictEqual(doc.info, null); assert(!doc.dirty);
  DM.redo(doc); assert.strictEqual(doc.info.title, 'T');

  // ---- mot de passe : écriture chiffrée, mauvais / bon mot de passe, réécriture d'un PDF protégé
  const locked = await run(plainBytes, { encrypt: { userPassword: 'sésame1', ownerPassword: 'x-owner', permissions: { printing: 'highResolution', copying: false, modifying: false } } });
  await assert.rejects(() => openJs(locked), (e) => e.name === 'PasswordException' && e.code === 1, 'sans mot de passe : demandé');
  await assert.rejects(() => openJs(locked, 'faux'), (e) => e.name === 'PasswordException' && e.code === 2, 'mot de passe incorrect');
  js = await openJs(locked, 'sésame1');
  assert.strictEqual(js.numPages, 40);
  assert(/page 3$/.test((await (await js.getPage(3)).getTextContent()).items[0].str), 'contenu lisible avec le bon mot de passe');
  await assert.rejects(() => PDFLib.PDFDocument.load(locked), /encrypted/i);
  await assert.rejects(() => PDFLib.PDFDocument.load(locked, { password: 'faux' }), /password/i);
  const reopened = await run(locked, { password: 'sésame1' }); // document ouvert avec son mot de passe : écriture possible (sortie non chiffrée)
  assert.strictEqual((await openJs(reopened)).numPages, 40);
  const again = await run(locked, { password: 'sésame1', encrypt: { userPassword: 'sésame1' } });
  await assert.rejects(() => openJs(again), (e) => e.name === 'PasswordException', 'même protection remise');

  // ---- optimisation : flux d'objets compressés, contenu identique
  const objStreams = await run(plainBytes, { useObjectStreams: true });
  const noStreams = await run(plainBytes, { useObjectStreams: false });
  assert(objStreams.length < plainBytes.length * 0.95, `taille optimisée ${objStreams.length} < 95 % de ${plainBytes.length}`);
  assert(noStreams.length > objStreams.length, 'sans flux d\'objets : plus gros');
  const a = await openJs(plainBytes), b = await openJs(objStreams);
  assert.strictEqual(a.numPages, b.numPages);
  for (const n of [1, 17, 40]) {
    const ta = (await (await a.getPage(n)).getTextContent()).items.map((x) => x.str).join('|');
    const tb = (await (await b.getPage(n)).getTextContent()).items.map((x) => x.str).join('|');
    assert.strictEqual(ta, tb, 'texte de la page ' + n);
    const oa = (await (await a.getPage(n)).getOperatorList()).fnArray.length, ob = (await (await b.getPage(n)).getOperatorList()).fnArray.length;
    assert.strictEqual(oa, ob, 'même nombre d\'opérations graphiques, page ' + n);
  }
  assert.strictEqual((await b.getMetadata()).info.Title, 'Titre d\'origine', 'propriétés conservées');
  console.log(`OK : documents (résolution des images, propriétés, mot de passe, optimisation ${plainBytes.length} → ${objStreams.length} octets).`);
})().catch((e) => { console.error('ECHEC', e); process.exit(1); });
