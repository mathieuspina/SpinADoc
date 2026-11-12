// Fusion de PDF dans un Web Worker (l'interface ne gèle pas : copie des pages, signets et enregistrement se font ici).
// Entrée  : { files: [{ name, bytes (ArrayBuffer), password?, pages: [indices], rotate }], bookmarks: bool, title }
// Sortie  : { type: 'progress', fraction, label } puis { type: 'done', bytes, stats } ou { type: 'error', message, file? }
// Signets : un signet par fichier source (nom du fichier) contenant les signets du fichier (destinations explicites ou nommées) qui désignent des
// pages conservées ; les autres sont abandonnés. Liens internes, champs de formulaire et étiquettes de pages ne sont pas repris.
/* eslint-env worker */
importScripts('../../vendor/pdf-lib/pdf-lib.min.js');

const { PDFDocument, PDFName, PDFArray, PDFDict, PDFRef, PDFHexString, PDFString, PDFNumber, degrees } = PDFLib;
const N = (s) => PDFName.of(s);
const post = (m, transfer) => self.postMessage(m, transfer || []);

// ---- signets : logique partagée avec la reconstruction des pages (src/outline.js) ----
importScripts('../outline.js');
function readOutline(src) { return self.Outline.read(PDFLib, src); }
// Un signet par fichier source (titre = nom du fichier) contenant ses signets qui désignent des pages conservées.
function writeOutline(out, entries) {
  const top = [];
  for (const e of entries) {
    const first = e.pageRefs[0];
    if (!first) continue;
    top.push({ title: e.title, ref: first, rest: [], children: self.Outline.prune(e.outline, (k) => e.pageRefByIndex.get(k)) });
  }
  return self.Outline.write(PDFLib, out, top);
}

async function run(task) {
  const out = await PDFDocument.create();
  const entries = [];
  const nFiles = task.files.length;
  let pagesTotal = 0;
  for (let fi = 0; fi < nFiles; fi++) {
    const f = task.files[fi];
    post({ type: 'progress', fraction: fi / nFiles, label: `Lecture de « ${f.name} »` });
    let src;
    try { src = await PDFDocument.load(f.bytes, { password: f.password || undefined, updateMetadata: false }); } catch (e) {
      const m = String((e && e.message) || e);
      throw Object.assign(new Error(/password|encrypt|decrypt/i.test(m) ? `« ${f.name} » est protégé par un mot de passe (absent ou incorrect).` : `« ${f.name} » est illisible ou abîmé (${m}).`), { file: f.name });
    }
    const all = src.getPages();
    const idx = f.pages.filter((i) => i >= 0 && i < all.length);
    if (!idx.length) throw Object.assign(new Error(`« ${f.name} » : aucune page à fusionner.`), { file: f.name });
    for (const i of idx) all[i].node.normalize();
    const copies = await out.copyPages(src, idx);
    const pageRefByIndex = new Map();
    const pageRefs = [];
    copies.forEach((p, k) => {
      if (f.rotate) p.setRotation(degrees((((p.getRotation().angle + f.rotate) % 360) + 360) % 360));
      out.addPage(p);
      pageRefByIndex.set(idx[k], p.ref);
      pageRefs.push(p.ref);
    });
    pagesTotal += copies.length;
    let outline = [];
    if (task.bookmarks) {
      try { outline = readOutline(src, new Map(all.map((p, i) => [p.ref.toString(), i]))); } catch { outline = []; }
    }
    entries.push({ title: f.title || f.name, outline, pageRefs, pageRefByIndex });
    post({ type: 'progress', fraction: (fi + 1) / nFiles * 0.9, label: `« ${f.name} » : ${copies.length} page${copies.length > 1 ? 's' : ''}` });
  }
  let bookmarks = 0;
  if (task.bookmarks) { try { bookmarks = writeOutline(out, entries); } catch { bookmarks = 0; } }
  if (task.title) out.setTitle(task.title);
  post({ type: 'progress', fraction: 0.95, label: 'Enregistrement' });
  const bytes = await out.save();
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  post({ type: 'done', bytes: buf, stats: { pages: pagesTotal, bookmarks } }, [buf]);
}

self.onmessage = (e) => {
  run(e.data).catch((err) => post({ type: 'error', message: String((err && err.message) || err), file: err && err.file }));
};
