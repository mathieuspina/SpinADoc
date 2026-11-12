// Fusion de PDF (src/js/merge-worker.js, exécuté ici dans un contexte Node simulant un Worker) : ordre, plages, rotation par fichier, signets
// (destinations explicites et nommées), fichier chiffré (mot de passe absent / correct / faux), très gros fichier (temps et mémoire).
// Usage : node test/test-merge.js [--sans-gros]
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const PDFLib = require('@cantoo/pdf-lib');

const messages = [];
// importScripts : pdf-lib est déjà fourni ; les modules du projet (../outline.js) sont réellement chargés dans le bac à sable
const sandbox = { PDFLib, importScripts: (...urls) => { for (const u of urls) if (!/pdf-lib/.test(u)) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'js', u), 'utf8'), sandbox); }, self: { postMessage: (m) => messages.push(m) }, console, setTimeout };
sandbox.self.onmessage = null;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'merge-worker.js'), 'utf8'), sandbox);

async function merge(task) {
  messages.length = 0;
  const copy = Object.assign({}, task, { files: task.files.map((f) => Object.assign({}, f, { bytes: f.bytes.slice().buffer })) });
  sandbox.self.onmessage({ data: copy });
  for (let i = 0; i < 6000; i++) { // 10 min max
    const end = messages.find((m) => m.type === 'done' || m.type === 'error');
    if (end) return end;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('délai dépassé');
}

async function makeSource(label, n, opts) {
  const o = opts || {};
  const d = await PDFLib.PDFDocument.create();
  const f = await d.embedFont(PDFLib.StandardFonts.Helvetica);
  for (let k = 0; k < n; k++) {
    const p = d.addPage([200 + k * 10, 300]);
    p.drawText(`${label}-${k + 1}`, { x: 20, y: 40, size: 14, font: f });
    if (o.rotate && o.rotate[k]) p.setRotation(PDFLib.degrees(o.rotate[k]));
  }
  if (o.outline) addOutline(d, o.outline);
  if (o.encrypt) d.encrypt({ userPassword: o.encrypt, ownerPassword: o.encrypt + 'x', permissions: { printing: true } });
  return d.save();
}
// outline : [{ title, page (indice), named?: nom, children: [...] }] ; les destinations nommées vont dans /Names /Dests
function addOutline(d, tree) {
  const ctx = d.context;
  const pages = d.getPages();
  const named = [];
  const build = (list, parent) => {
    const refs = list.map(() => ctx.nextRef());
    list.forEach((n, i) => {
      const dest = ctx.obj([pages[n.page].ref, PDFLib.PDFName.of('Fit')]);
      const dict = { Title: PDFLib.PDFHexString.fromText(n.title), Parent: parent };
      if (n.named) { named.push([n.named, dest]); dict.Dest = PDFLib.PDFHexString.fromText(n.named); } else dict.Dest = dest;
      if (i > 0) dict.Prev = refs[i - 1];
      if (i < list.length - 1) dict.Next = refs[i + 1];
      const o = ctx.obj(dict);
      if (n.children) { const s = build(n.children, refs[i]); o.set(PDFLib.PDFName.of('First'), s.first); o.set(PDFLib.PDFName.of('Last'), s.last); o.set(PDFLib.PDFName.of('Count'), PDFLib.PDFNumber.of(n.children.length)); }
      ctx.assign(refs[i], o);
    });
    return { first: refs[0], last: refs[refs.length - 1] };
  };
  const root = ctx.nextRef();
  const b = build(tree, root);
  ctx.assign(root, ctx.obj({ Type: 'Outlines', First: b.first, Last: b.last, Count: tree.length }));
  d.catalog.set(PDFLib.PDFName.of('Outlines'), root);
  if (named.length) {
    const arr = []; named.sort((a, c) => (a[0] < c[0] ? -1 : 1)).forEach(([k, v]) => { arr.push(PDFLib.PDFHexString.fromText(k), v); });
    d.catalog.set(PDFLib.PDFName.of('Names'), ctx.obj({ Dests: ctx.obj({ Names: arr }) }));
  }
}

async function read(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const p = await pdf.getPage(i);
    const tc = await p.getTextContent();
    pages.push({ text: tc.items.map((x) => x.str).join(''), rotate: p.rotate, w: p.view[2] });
  }
  const outline = await pdf.getOutline();
  const flat = async (items) => {
    const o = [];
    for (const it of items || []) {
      let idx = null;
      try { const dest = typeof it.dest === 'string' ? await pdf.getDestination(it.dest) : it.dest; idx = await pdf.getPageIndex(dest[0]); } catch { /* */ }
      o.push({ title: it.title, page: idx, children: await flat(it.items) });
    }
    return o;
  };
  return { pages, outline: await flat(outline) };
}

(async () => {
  const A = await makeSource('A', 3, { outline: [{ title: 'Intro A', page: 0 }, { title: 'Chapitre A', page: 1, children: [{ title: 'Section A2', page: 2 }] }] });
  const B = await makeSource('B', 2, { outline: [{ title: 'Début B', page: 0, named: 'debutB' }, { title: 'Fin B', page: 1, named: 'finB' }] });
  const Cc = await makeSource('C', 4, { rotate: [90, 0, 0, 0] });

  // ordre, plages, rotation par fichier
  let r = await merge({ bookmarks: true, title: 'Fusion', files: [
    { name: 'B.pdf', bytes: B, pages: [0, 1], rotate: 0 },
    { name: 'A.pdf', bytes: A, pages: [0, 2], rotate: 90 },          // plage « 1, 3 », tourné de 90°
    { name: 'C.pdf', bytes: Cc, pages: [1, 2, 3], rotate: 270 },     // plage « 2-4 », tourné de 270°
  ] });
  assert.strictEqual(r.type, 'done', r.message);
  let m = await read(Buffer.from(r.bytes));
  assert.deepStrictEqual(m.pages.map((p) => p.text), ['B-1', 'B-2', 'A-1', 'A-3', 'C-2', 'C-3', 'C-4'], 'ordre et plages');
  assert.deepStrictEqual(m.pages.map((p) => p.rotate), [0, 0, 90, 90, 270, 270, 270], 'rotation par fichier');
  assert.strictEqual(m.pages[3].w, 220, 'taille de page conservée');
  assert.strictEqual(r.stats.pages, 7);
  console.log('  ok   ordre, plages, rotation par fichier');

  // /Rotate 90 d'origine + rotation de fichier
  r = await merge({ files: [{ name: 'C.pdf', bytes: Cc, pages: [0, 1], rotate: 90 }] });
  m = await read(Buffer.from(r.bytes));
  assert.deepStrictEqual(m.pages.map((p) => p.rotate), [180, 90], '/Rotate d\'origine cumulé');
  console.log('  ok   page /Rotate 90 d\'origine cumulée avec la rotation du fichier');

  // signets : un par fichier + ceux des sources, pages conservées seulement, destinations nommées résolues
  r = await merge({ bookmarks: true, files: [
    { name: 'A.pdf', bytes: A, pages: [0, 1, 2], rotate: 0 },
    { name: 'B.pdf', bytes: B, pages: [1], rotate: 0 },        // « Début B » vise une page retirée
    { name: 'C.pdf', bytes: Cc, pages: [0, 1, 2, 3], rotate: 0 },
  ] });
  m = await read(Buffer.from(r.bytes));
  const o = m.outline;
  assert.deepStrictEqual(o.map((x) => x.title), ['A.pdf', 'B.pdf', 'C.pdf'], 'un signet par fichier');
  assert.deepStrictEqual(o[0].children.map((x) => [x.title, x.page]), [['Intro A', 0], ['Chapitre A', 1]], 'signets de A, pages décalées correctement');
  assert.deepStrictEqual(o[0].children[1].children.map((x) => [x.title, x.page]), [['Section A2', 2]], 'sous-signet conservé');
  assert.deepStrictEqual(o[1].children.map((x) => [x.title, x.page]), [['Fin B', 3]], 'destination nommée résolue ; signet vers une page retirée abandonné');
  assert.strictEqual(o[1].page, 3, 'le signet du fichier B pointe sur sa première page');
  assert.strictEqual(o[2].page, 4, 'signet du fichier C');
  assert(r.stats.bookmarks >= 6, 'nombre de signets : ' + r.stats.bookmarks);
  r = await merge({ bookmarks: false, files: [{ name: 'A.pdf', bytes: A, pages: [0], rotate: 0 }] });
  assert.deepStrictEqual((await read(Buffer.from(r.bytes))).outline, [], 'signets désactivés');
  console.log('  ok   signets : un par fichier, signets des sources (explicites et nommés), pages retirées abandonnées');

  // fichier chiffré
  const E = await makeSource('E', 2, { encrypt: 'secret' });
  r = await merge({ files: [{ name: 'E.pdf', bytes: E, pages: [0, 1], rotate: 0 }] });
  assert.strictEqual(r.type, 'error'); assert(/mot de passe/.test(r.message) && r.file === 'E.pdf', r.message);
  r = await merge({ files: [{ name: 'E.pdf', bytes: E, pages: [0, 1], rotate: 0, password: 'faux' }] });
  assert.strictEqual(r.type, 'error', 'mot de passe faux : refusé');
  r = await merge({ files: [{ name: 'A.pdf', bytes: A, pages: [0], rotate: 0 }, { name: 'E.pdf', bytes: E, pages: [1], rotate: 0, password: 'secret' }] });
  assert.strictEqual(r.type, 'done', r.message);
  m = await read(Buffer.from(r.bytes));
  assert.deepStrictEqual(m.pages.map((p) => p.text), ['A-1', 'E-2'], 'fichier chiffré fusionné avec le bon mot de passe');
  r = await merge({ files: [{ name: 'X.pdf', bytes: Buffer.from('pas un pdf'), pages: [0], rotate: 0 }] });
  assert.strictEqual(r.type, 'error'); assert(/illisible/.test(r.message), r.message);
  r = await merge({ files: [{ name: 'A.pdf', bytes: A, pages: [9], rotate: 0 }] });
  assert.strictEqual(r.type, 'error'); assert(/aucune page/.test(r.message));
  console.log('  ok   fichier chiffré : refusé sans mot de passe (message clair), accepté avec le bon ; fichier illisible, plage vide');

  // très gros fichier : temps et mémoire
  if (!process.argv.includes('--sans-gros')) {
    const big = await PDFLib.PDFDocument.create();
    const f = await big.embedFont(PDFLib.StandardFonts.Helvetica);
    // 10 images PNG de bruit (≈ 3 Mo chacune, incompressibles) réutilisées sur les pages : un fichier lourd comme un plan scanné
    const zlib = require('zlib');
    const png = (w, h, seed) => {
      const raw = Buffer.alloc((w * 3 + 1) * h);
      let x = seed * 2654435761 >>> 0;
      for (let y = 0; y < h; y++) for (let i = 1; i <= w * 3; i++) { x = (x * 1664525 + 1013904223) >>> 0; raw[y * (w * 3 + 1) + i] = x >>> 24; }
      const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, c]); };
      const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
      return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0))]);
    };
    const pics = []; for (let k = 0; k < 10; k++) pics.push(await big.embedPng(png(1000, 1000, k + 1)));
    for (let k = 0; k < 600; k++) {
      const p = big.addPage([2384, 3370]); // A0
      p.drawImage(pics[k % 10], { x: 200, y: 200, width: 1500, height: 1500 });
      p.drawText('GROS-' + (k + 1), { x: 100, y: 100, size: 60, font: f });
      for (let i = 0; i < 1500; i++) p.drawLine({ start: { x: (i * 37 + k) % 2300, y: (i * 53) % 3300 }, end: { x: (i * 91 + k * 3) % 2300, y: (i * 17 + 400) % 3300 }, thickness: 0.5 });
    }
    const bytes = await big.save({ useObjectStreams: false });
    const mb = bytes.length / 1048576;
    const mem0 = process.memoryUsage().rss;
    const t0 = Date.now();
    r = await merge({ bookmarks: true, files: [{ name: 'gros.pdf', bytes, pages: Array.from({ length: 600 }, (_, i) => i), rotate: 0 }, { name: 'gros.pdf', bytes, pages: Array.from({ length: 600 }, (_, i) => i), rotate: 90 }] });
    const dt = (Date.now() - t0) / 1000;
    const peak = (process.memoryUsage().rss - mem0) / 1048576;
    assert.strictEqual(r.type, 'done', r.message);
    assert.strictEqual(r.stats.pages, 1200);
    console.log(`  ok   très gros fichier : 2 × ${mb.toFixed(0)} Mo (600 pages A0 chacun, images + vectoriel) fusionnés en ${dt.toFixed(1)} s, mémoire supplémentaire ≈ ${peak.toFixed(0)} Mo, résultat ${(r.bytes.byteLength / 1048576).toFixed(0)} Mo`);
    assert(dt < 120, 'fusion en moins de 2 minutes');
  }
  console.log('OK : fusion.');
})().catch((e) => { console.error('ÉCHEC :', e); process.exit(1); });
