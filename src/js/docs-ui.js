// Onglet Document : export de pages en images (PNG / JPG), propriétés du document, optimisation (flux d'objets compressés), protection par mot de passe.
// Les opérations lourdes ne bloquent pas l'interface : rendu page par page (pdf.js, avec des pauses), écriture fichier par fichier, notification de progression.
import { $, api, store, toast, busy } from './ui.js';
import * as V from './viewer.js';
import * as A from './annotate.js';
import { loadPdf } from './pdfjs-load.js';
import { askForm, pageWord, targets } from './pages-ui.js';
import { guardOutput } from './redact-guard.js';

const { DocModel, PageOps, ImageMeta } = window;

// Branché par app.js : enregistrement d'un document (voir saveDoc) avec options { bytes?, encrypt?, useObjectStreams? }.
export const hooks = { save: async () => false };

const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(n >= 10485760 ? 1 : 2).replace('.', ',') + ' Mo' : Math.max(1, Math.round(n / 1024)) + ' Ko');

// ----------------------------------------------------------------------------- propriétés
export async function readInfo(pdf) {
  let i = {};
  try { i = (await pdf.getMetadata()).info || {}; } catch { /* métadonnées absentes */ }
  return { title: i.Title || '', author: i.Author || '', subject: i.Subject || '', keywords: i.Keywords || '' };
}
// PDF protégé ouvert : les informations du fichier d'origine (chiffrées) sont relues avec le mot de passe et conservées à l'écriture.
export async function adoptInfo(doc, origBytes, password) {
  try {
    const p = await loadPdf(origBytes, { password });
    doc.info = await readInfo(p);
    p.destroy();
  } catch { /* conservées telles quelles */ }
}

export async function properties(doc) {
  const cur = doc.info || await readInfo(V.getPdf(doc));
  const v = await askForm({
    title: 'Propriétés du document',
    intro: `« ${doc.name} » : ${pageWord(doc.pages.length)}.`,
    fields: [
      { id: 'title', label: 'Titre', type: 'text', value: cur.title },
      { id: 'author', label: 'Auteur', type: 'text', value: cur.author },
      { id: 'subject', label: 'Sujet', type: 'text', value: cur.subject },
      { id: 'keywords', label: 'Mots-clés', type: 'text', value: cur.keywords, hint: 'Séparés par des virgules ou des espaces' },
    ],
    okLabel: 'Appliquer',
  });
  if (!v) return false;
  const next = { title: v.title.trim(), author: v.author.trim(), subject: v.subject.trim(), keywords: v.keywords.trim() };
  if (JSON.stringify(next) === JSON.stringify(cur)) return false;
  DocModel.setInfo(doc, next);
  A.changed(doc);
  toast('Propriétés modifiées (écrites à l\'enregistrement).', 3500);
  return true;
}

// ----------------------------------------------------------------------------- export en images
const MAX_SIDE = 16000;
const MAX_AREA = 200e6;
let expSeq = 0;
export function progressItem(title) {
  const el = document.createElement('div');
  el.className = 'pq-item'; el.dataset.id = 'exp' + ++expSeq; el.dataset.state = 'running';
  const name = document.createElement('div'); name.className = 'pq-name'; name.textContent = title;
  const status = document.createElement('div'); status.className = 'pq-status'; status.textContent = 'Préparation…';
  const bar = document.createElement('div'); bar.className = 'pq-bar'; bar.append(document.createElement('i'));
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'secondary'; cancel.textContent = 'Annuler';
  el.append(name, cancel, status, bar);
  $('printq').append(el);
  const it = { el, cancelled: false };
  cancel.addEventListener('click', () => { it.cancelled = true; status.textContent = 'Annulation…'; if (it.onCancel) it.onCancel(); });
  it.set = (text, frac) => { status.textContent = text; bar.firstChild.style.width = Math.round(frac * 100) + '%'; };
  it.end = (text, state, ms) => { el.dataset.state = state; status.textContent = text; cancel.remove(); bar.firstChild.style.width = '100%'; setTimeout(() => el.remove(), ms || 6000); };
  return it;
}

const nextFrame = () => new Promise((r) => setTimeout(r, 0));
const toBlob = (canvas, type, q) => new Promise((res) => canvas.toBlob(res, type, q));

// Pages (indices) à exporter selon le choix de la boîte.
function wantedPages(doc, v) {
  if (v.scope === 'current') return [Math.min(doc.page, doc.pages.length - 1)];
  if (v.scope === 'selection') return targets(doc);
  if (v.scope === 'range') { const r = PageOps.parseGroups(v.range, doc.pages.length); return r.error ? null : [...new Set(r.groups.flat())].sort((a, b) => a - b); }
  return doc.pages.map((_, i) => i);
}

export async function exportImages(doc) {
  A.closeEditor(doc, true);
  if (!(await guardOutput(doc, "L'export en images"))) return false;
  const sel = targets(doc);
  const hasSel = !!(doc.runtime.pageSel && doc.runtime.pageSel.size > 1);
  const v = await askForm({
    title: 'Exporter des pages en images',
    intro: `« ${doc.name} » : ${pageWord(doc.pages.length)}. Les annotations et la numérotation sont incluses (comme à l'enregistrement).`,
    fields: [
      { id: 'format', label: 'Format', type: 'select', options: [{ v: 'png', t: 'PNG (sans perte)' }, { v: 'jpg', t: 'JPEG (plus léger)' }], value: 'png' },
      { id: 'dpi', label: 'Résolution (dpi)', type: 'number', min: 36, max: 1200, value: 150, hint: '72 = taille d\'écran, 150 = lecture, 300 = impression' },
      { id: 'quality', label: 'Qualité JPEG (%)', type: 'number', min: 10, max: 100, value: 90, showIf: (x) => x.format === 'jpg' },
      { id: 'scope', label: 'Pages', type: 'radio', value: hasSel ? 'selection' : 'all', options: [{ v: 'all', t: 'Toutes' }, { v: 'current', t: 'Page courante' }, ...(hasSel ? [{ v: 'selection', t: `Pages sélectionnées (${sel.length})` }] : []), { v: 'range', t: 'Plage' }] },
      { id: 'range', label: 'Plage', type: 'text', value: '', placeholder: '1-3, 5, 8-12', showIf: (x) => x.scope === 'range' },
    ],
    okLabel: 'Choisir le dossier…',
    validate: (x) => {
      const dpi = Number(x.dpi);
      if (!(dpi >= 36 && dpi <= 1200)) return 'Résolution : entre 36 et 1200 dpi.';
      if (x.scope === 'range') { const r = PageOps.parseGroups(x.range, doc.pages.length); if (r.error) return r.error; }
      const list = wantedPages(doc, x);
      if (!list || !list.length) return 'Aucune page à exporter.';
      for (const i of list) {
        const rec = V.getPages(doc)[i];
        const b = V.pageViewport(rec, dpi / 72, 0);
        if (b.width > MAX_SIDE || b.height > MAX_SIDE || b.width * b.height > MAX_AREA) return `La page ${i + 1} serait trop grande à ${dpi} dpi (${Math.round(b.width)} × ${Math.round(b.height)} px) : baissez la résolution.`;
      }
      return '';
    },
  });
  if (!v) return false;
  const dpi = Number(v.dpi);
  const list = wantedPages(doc, v);
  const dir = await api.pickDir(doc.path ? doc.path.replace(/[\\/][^\\/]*$/, '') : undefined);
  if (!dir) return false;
  const base = doc.name.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, '_');
  const ext = v.format === 'jpg' ? 'jpg' : 'png';
  const digits = String(doc.pages.length).length;
  const job = progressItem(`Export ${ext.toUpperCase()} : ${doc.name}`);
  let pdf = null;
  const written = [];
  try {
    // PDF « tel qu'enregistré » (annotations, numérotation, structure des pages) puis rendu page par page, avec une pause entre les étapes.
    job.set('Préparation du document…', 0);
    const bytes = await V.exportBytes(doc, null, { encrypt: null });
    pdf = await loadPdf(bytes);
    await nextFrame();
    for (let k = 0; k < list.length; k++) {
      if (job.cancelled) break;
      const i = list[k];
      job.set(`Page ${i + 1} (${k + 1} / ${list.length})`, k / list.length);
      const page = await pdf.getPage(i + 1);
      const vp = page.getViewport({ scale: dpi / 72 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: dpi / 72 }) }).promise;
      await nextFrame();
      const blob = await toBlob(canvas, v.format === 'jpg' ? 'image/jpeg' : 'image/png', Number(v.quality) / 100);
      canvas.width = 0; canvas.height = 0; // libère la mémoire
      if (!blob) throw new Error('Image trop grande pour être encodée.');
      const img = ImageMeta.setDpi(new Uint8Array(await blob.arrayBuffer()), dpi);
      const name = `${base}-page-${String(i + 1).padStart(digits, '0')}.${ext}`;
      const r = await api.writeMany(dir, [{ name, bytes: img }]);
      written.push(...r.written);
      page.cleanup();
    }
    if (job.cancelled) { job.end(`Export annulé : ${written.length} image${written.length > 1 ? 's' : ''} déjà écrite${written.length > 1 ? 's' : ''}.`, 'cancelled'); return false; }
    job.end(`${written.length} image${written.length > 1 ? 's' : ''} exportée${written.length > 1 ? 's' : ''} dans « ${dir} ».`, 'done', 9000);
    return written;
  } catch (err) {
    console.error(err);
    job.end('Export impossible : ' + (err && err.message || err), 'error', 12000);
    return false;
  } finally {
    if (pdf) pdf.destroy();
  }
}

// ----------------------------------------------------------------------------- optimiser
export async function optimize(doc) {
  A.closeEditor(doc, true);
  const done = busy('Optimisation…');
  let opt, plain;
  try {
    opt = await V.exportBytes(doc, null, { useObjectStreams: true, encrypt: doc.protect || null });
    plain = doc.bytes.length;
  } catch (err) {
    done();
    toast('Optimisation impossible : ' + (err && err.message || err), 7000);
    return false;
  }
  done();
  const gain = plain - opt.length;
  const pct = plain ? Math.round((gain / plain) * 1000) / 10 : 0;
  const better = gain > 0;
  const v = await askForm({
    title: 'Optimiser le PDF',
    intro: `Réenregistrement avec flux d'objets compressés (les images ne sont pas recompressées).${doc.dirty ? ' Les modifications en cours sont incluses.' : ''}`,
    fields: [
      { id: 'a', type: 'note', value: 'Taille d\'origine : ' + fmtSize(plain) },
      { id: 'b', type: 'note', value: `Taille optimisée : ${fmtSize(opt.length)} — ${better ? `gain de ${fmtSize(gain)} (${String(pct).replace('.', ',')} %)` : 'aucun gain : le fichier est déjà compact ou ses données sont surtout des images'}` },
    ],
    okLabel: better ? 'Enregistrer sous…' : 'Enregistrer quand même',
  });
  if (!v) return false;
  const ok = await hooks.save(doc, { bytes: opt });
  if (ok) toast(`Optimisé : ${fmtSize(plain)} → ${fmtSize(opt.length)}.`, 6000);
  return ok;
}

// ----------------------------------------------------------------------------- protéger
export async function protect(doc) {
  const had = !!doc.protect;
  const yn = [{ v: 'yes', t: 'Oui' }, { v: 'no', t: 'Non' }];
  const v = await askForm({
    title: 'Protéger par un mot de passe',
    intro: had ? 'Ce document est protégé. Laissez le mot de passe vide pour enregistrer SANS protection.' : 'Le fichier enregistré demandera ce mot de passe à l\'ouverture (chiffrement du PDF). Le mot de passe n\'est mémorisé nulle part : en cas d\'oubli, le fichier ne peut plus être ouvert.',
    fields: [
      { id: 'pw', label: 'Mot de passe', type: 'password', value: '' },
      { id: 'pw2', label: 'Confirmation', type: 'password', value: '' },
      { id: 'print', label: 'Autoriser l\'impression', type: 'select', options: yn, value: 'yes' },
      { id: 'copy', label: 'Autoriser la copie du texte', type: 'select', options: yn, value: 'yes' },
      { id: 'modify', label: 'Autoriser les modifications', type: 'select', options: yn, value: 'no' },
    ],
    okLabel: 'Enregistrer sous…',
    validate: (x) => (x.pw !== x.pw2 ? 'Les deux mots de passe sont différents.' : !x.pw && !had ? 'Saisissez un mot de passe.' : ''),
  });
  if (!v) return false;
  const prot = v.pw ? { userPassword: v.pw, ownerPassword: v.pw + '·Spin', permissions: { printing: v.print === 'yes' ? 'highResolution' : false, copying: v.copy === 'yes', modifying: v.modify === 'yes', annotating: v.modify === 'yes', fillingForms: true, documentAssembly: v.modify === 'yes', contentAccessibility: true } } : null;
  const ok = await hooks.save(doc, { encrypt: prot });
  if (ok) { doc.protect = prot; toast(prot ? 'Enregistré avec mot de passe.' : 'Enregistré sans protection.', 4000); }
  return ok;
}

export const commands = {
  'doc-export-images': (d) => exportImages(d),
  'doc-properties': (d) => properties(d),
  'doc-optimize': (d) => optimize(d),
  'doc-protect': (d) => protect(d),
};
export const isDocCmd = (c) => Object.prototype.hasOwnProperty.call(commands, c);
export const exec = (c, d) => (d && commands[c] ? commands[c](d) : undefined);
