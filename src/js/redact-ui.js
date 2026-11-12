// Onglet « Caviarder » : outil « Zone à caviarder » (cadres hachurés, modifiables et annulables tant qu'ils ne sont pas appliqués), « Rechercher et
// caviarder » (redact-find.js), « Appliquer le caviardage » (avertissement, couleur, libellé, résolution ; src/redact-apply.js), relance de l'OCR sur
// les pages caviardées, « Nettoyer les métadonnées », et garde-fous à l'enregistrement (zones non appliquées, jamais d'écrasement du fichier d'origine).
import { $, bus, toast, askChoice } from './ui.js';
import * as V from './viewer.js';
import * as A from './annotate.js';
import { progressItem } from './docs-ui.js';
import { setSelection } from './pages-ui.js';
import * as OcrUI from './ocr-ui.js';
import * as Find from './redact-find.js';
import * as Guard from './redact-guard.js';
import * as Check from './redact-check.js';

const { DocModel, Redact, RedactApply, RedactPdf, PDFLib } = window;
export const MAX_PIXELS = RedactApply.DEFAULTS.maxPixels;
export const state = { last: null, running: null }; // state.last : bilan de la dernière application (tests, rapport)

const zones = (doc) => (doc ? doc.edits.filter((e) => e.type === 'redact') : []);
export const redactedPages = (doc) => (doc && doc.pages ? doc.pages.map((p, i) => (Redact.isRedactedSrc(p.src) ? i : -1)).filter((i) => i >= 0) : []);
const plural = (n, a, b) => `${n} ${n > 1 ? b : a}`;
const hexToRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); const v = m ? parseInt(m[1], 16) : 0; return [(v >> 16) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; };
function createCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return { canvas: c, context: c.getContext('2d', { willReadFrequently: true }) }; }
function refresh(doc) { A.changed(doc); }

// ----------------------------------------------------------------------------- boîte « Appliquer le caviardage »
function askApply(doc, plan) {
  return new Promise((resolve) => {
    const dlg = $('rdx-apply');
    const nz = plan.reduce((s, p) => s + p.zones.length, 0), touching = plan.reduce((s, p) => s + p.touching, 0), burned = plan.reduce((s, p) => s + p.burn.length, 0);
    $('rdx-apply-summary').textContent = `${plural(nz, 'zone', 'zones')} sur ${plural(plan.length, 'page', 'pages')} (${plan.map((p) => p.index + 1).join(', ')}).`
      + (touching ? ` ${plural(touching, 'annotation touche', 'annotations touchent')} une zone et ${touching > 1 ? 'disparaîtront' : 'disparaîtra'}.` : '')
      + (burned - touching > 0 ? ` ${plural(burned - touching, 'autre objet ajouté', 'autres objets ajoutés')} sur ces pages ${burned - touching > 1 ? 'seront intégrés' : 'sera intégré'} à l'image (plus modifiable${burned - touching > 1 ? 's' : ''}).` : '');
    const conf = $('rdx-confirm'), ok = $('rdx-apply-ok');
    conf.checked = false; ok.disabled = true;
    const recs = V.getPages(doc);
    const hint = () => {
      const dpi = Number($('rdx-dpi').value);
      const low = plan.map((p) => ({ p, d: Redact.effectiveDpi(recs[p.index].page.view, dpi, MAX_PIXELS) })).filter((x) => x.d < dpi);
      $('rdx-dpi-hint').textContent = low.length ? `Grand format : ${low.map((x) => `page ${x.p.index + 1} rendue à ${x.d} dpi`).join(', ')} (limite de mémoire).` : '';
    };
    hint();
    state.check = Check.fill(doc, plan); // « Éléments à vérifier » (asynchrone ; tests : state.check)
    const onConf = () => { ok.disabled = !conf.checked; };
    const finish = (v) => {
      dlg.hidden = true;
      conf.removeEventListener('change', onConf); $('rdx-dpi').removeEventListener('change', hint); dlg.removeEventListener('keydown', onKey, true);
      ok.onclick = null; $('rdx-apply-cancel').onclick = null;
      resolve(v);
    };
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); } else e.stopPropagation(); }
    conf.addEventListener('change', onConf); $('rdx-dpi').addEventListener('change', hint); dlg.addEventListener('keydown', onKey, true);
    ok.onclick = () => { if (conf.checked) finish({ dpi: Number($('rdx-dpi').value), color: hexToRgb($('rdx-color').value), label: $('rdx-label').value.trim() }); };
    $('rdx-apply-cancel').onclick = () => finish(null);
    dlg.hidden = false;
    $('rdx-apply-cancel').focus();
  });
}

// opts.auto : { dpi, color, label, ocr } (tests : sans boîte, sans question finale).
export async function apply(doc, opts) {
  if (!doc) return false;
  if (state.running) { toast('Un caviardage est déjà en cours.', 3000); return false; }
  A.closeEditor(doc, true);
  const plan = Redact.plan(doc.pages, doc.edits, A.measure);
  if (!plan.length) { toast('Aucune zone à caviarder : tracez des zones (outil « Zone à caviarder ») ou utilisez « Rechercher et caviarder ».', 5000); return false; }
  const auto = opts && opts.auto;
  const v = auto || await askApply(doc, plan);
  if (!v) return false;
  const job = progressItem(`Caviardage : ${doc.name}`);
  state.running = job;
  const t0 = performance.now();
  try {
    const res = await RedactApply.apply(doc, {
      PDFLib, measure: A.measure, loadPdf: (b) => V.loadPdf(b), createCanvas, job,
      onProgress: (f, i) => job.set(`Page ${i + 1} : rendu de la page et peinture des blocs…`, f),
    }, v);
    if (!res) { job.end('Rien à caviarder.', 'done'); return false; }
    RedactApply.commit(DocModel, doc, res);
    await V.syncPages(doc);
    V.syncOcr(doc);
    refresh(doc);
    const ms = performance.now() - t0;
    state.last = { report: res.report, ms };
    const dpis = [...new Set(res.report.map((r) => r.dpi))].join(' / ');
    job.end(`${plural(res.report.length, 'page caviardée', 'pages caviardées')} (${dpis} dpi) en ${(ms / 1000).toFixed(1)} s.`, 'done');
    const pages = res.report.map((r) => r.index + 1).join(', ');
    const choice = auto ? (auto.ocr ? 'ocr' : 'later') : await askChoice({
      title: 'Caviardage appliqué',
      message: `${res.report.length > 1 ? 'Les pages' : 'La page'} ${pages} ${res.report.length > 1 ? 'sont remplacées' : 'est remplacée'} par une image (${dpis} dpi) où les zones sont peintes : le contenu d'origine de ${res.report.length > 1 ? 'ces pages' : 'cette page'} ne sera pas enregistré. `
        + 'Conséquences : texte non sélectionnable ni cherchable sur ces pages, fichier plus lourd. Annuler (Ctrl+Z) rétablit tout tant que le document n\'est pas enregistré. '
        + 'Relancer la reconnaissance de texte (OCR) sur ces pages pour retrouver du texte cherchable ? Le texte caviardé ne peut pas réapparaître : il n\'est plus dans l\'image.',
      buttons: [{ id: 'ocr', label: 'Relancer l\'OCR', primary: true }, { id: 'later', label: 'Plus tard' }],
    });
    if (choice === 'ocr') await rerunOcr(doc, res.report.map((r) => r.index));
    return true;
  } catch (err) {
    if (err && err.cancelled) job.end('Caviardage annulé : rien n\'a été modifié.', 'error');
    else { console.error(err); job.end('Échec : ' + (err && err.message ? err.message : err), 'error', 10000); toast('Échec du caviardage : ' + (err && err.message ? err.message : err) + '. Le document n\'a pas été modifié.', 8000); }
    return false;
  } finally {
    state.running = null;
  }
}

// OCR des pages caviardées (indices) : boîte de l'OCR préréglée sur ces pages (ocrOpts.auto pour les tests).
export async function rerunOcr(doc, idxs, ocrOpts) {
  const list = (idxs && idxs.length ? idxs : redactedPages(doc)).filter((i) => i < doc.pages.length);
  if (!list.length) { toast('Aucune page caviardée dans ce document.', 3500); return false; }
  if (list.length === 1) { doc.page = list[0]; return OcrUI.run(doc, Object.assign({ scope: 'current' }, ocrOpts || {})); }
  setSelection(doc, list, list[0]);
  return OcrUI.run(doc, Object.assign({ scope: 'selection' }, ocrOpts || {}));
}

export function clearZones(doc) {
  const ids = zones(doc).map((e) => e.id);
  if (!ids.length) return false;
  DocModel.removeEdits(doc, ids);
  refresh(doc);
  toast(`${plural(ids.length, 'zone à caviarder retirée', 'zones à caviarder retirées')} (Ctrl+Z pour annuler).`, 3500);
  return true;
}

// ----------------------------------------------------------------------------- métadonnées
const META = Object.keys(RedactPdf.META_LABELS);
async function fileMeta(doc) {
  try { const m = await V.getPdf(doc).getMetadata(); return { info: m.info || {}, xmp: !!m.metadata }; } catch { return { info: {}, xmp: false }; }
}
export async function cleanMeta(doc, auto) {
  if (!doc) return false;
  const fm = await fileMeta(doc);
  const cur = doc.info || { title: fm.info.Title || '', author: fm.info.Author || '', subject: fm.info.Subject || '', keywords: fm.info.Keywords || '' };
  const value = { title: cur.title, author: cur.author, subject: cur.subject, keywords: cur.keywords, creator: fm.info.Creator || '', producer: fm.info.Producer || '', dates: [fm.info.CreationDate, fm.info.ModDate].filter(Boolean).join(' ; '), xmp: fm.xmp ? 'présentes' : '' };
  const flags = auto || await new Promise((resolve) => {
    const dlg = $('rdx-meta');
    const list = $('rdx-meta-list');
    list.replaceChildren(...META.map((k) => {
      const lab = document.createElement('label');
      lab.className = 'chk rdx-meta-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.id = 'rdx-m-' + k; cb.checked = !(doc.clean && doc.clean[k] === false);
      const name = document.createElement('span'); name.textContent = RedactPdf.META_LABELS[k];
      const val = document.createElement('span'); val.className = 'muted small rdx-meta-val'; val.textContent = value[k] ? '« ' + String(value[k]).slice(0, 80) + ' »' : '(vide)';
      lab.append(cb, name, val);
      return lab;
    }));
    const finish = (v) => { dlg.hidden = true; dlg.removeEventListener('keydown', onKey, true); $('rdx-meta-ok').onclick = null; $('rdx-meta-cancel').onclick = null; resolve(v); };
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); } else e.stopPropagation(); }
    $('rdx-meta-ok').onclick = () => finish(Object.fromEntries(META.map((k) => [k, $('rdx-m-' + k).checked])));
    $('rdx-meta-cancel').onclick = () => finish(null);
    dlg.addEventListener('keydown', onKey, true);
    dlg.hidden = false;
    $('rdx-meta-ok').focus();
  });
  if (!flags) return false;
  DocModel.commit(doc, (d) => {
    d.clean = Object.assign({}, flags);
    d.info = { title: flags.title ? '' : cur.title || '', author: flags.author ? '' : cur.author || '', subject: flags.subject ? '' : cur.subject || '', keywords: flags.keywords ? '' : cur.keywords || '' };
  });
  refresh(doc);
  const n = META.filter((k) => flags[k]).length;
  toast(n ? `Métadonnées : ${plural(n, 'élément sera retiré', 'éléments seront retirés')} à l'enregistrement (Ctrl+Z pour annuler).` : 'Aucune métadonnée ne sera retirée.', 4500);
  return true;
}

// ----------------------------------------------------------------------------- enregistrement
// Appelé avant tout enregistrement. Renvoie null (abandon) ou { name?, forbid?, reopen? } : un document caviardé est proposé sous un nouveau nom,
// ne peut jamais remplacer le fichier d'origine, et est rouvert depuis le fichier écrit (l'historique, qui contient encore l'original, est fermé).
// o.unapplied : réponse imposée (tests) à la question des zones non appliquées : 'apply' | 'save' | 'cancel'.
export async function beforeSave(doc, o) {
  const n = zones(doc).length;
  if (n) {
    const c = (o && o.unapplied) || await askChoice({
      title: 'Zones à caviarder non appliquées',
      message: `${plural(n, 'zone à caviarder n\'est pas appliquée', 'zones à caviarder ne sont pas appliquées')}. Les zones ne sont jamais écrites dans le fichier : sans « Appliquer le caviardage », le contenu dessous resterait lisible.`,
      buttons: [{ id: 'apply', label: 'Appliquer puis enregistrer', primary: true }, { id: 'save', label: 'Enregistrer sans caviarder' }, { id: 'cancel', label: 'Annuler' }],
    });
    if (c === 'cancel') return null;
    if (c === 'apply' && !(await apply(doc, o && o.applyOpts))) return null;
  }
  const applied = n > 0 && !zones(doc).length;
  if (!Redact.hasRedacted(doc.pages)) return { applied };
  const base = doc.name.replace(/\.pdf$/i, '');
  return { name: /caviard/i.test(base) ? base + '.pdf' : base + ' (caviardé).pdf', forbid: doc.path || null, reopen: true, applied };
}

// ----------------------------------------------------------------------------- ruban
export const commands = {
  'rdx-find': (d) => Find.open(d),
  'rdx-apply': (d) => apply(d),
  'rdx-clear': (d) => clearZones(d),
  'rdx-ocr': (d) => rerunOcr(d),
  'rdx-meta': (d) => cleanMeta(d),
};
export function ribbonState(cmd, doc) {
  if (!Object.prototype.hasOwnProperty.call(commands, cmd)) return null;
  if (!doc) return { disabled: true };
  if (cmd === 'rdx-apply' || cmd === 'rdx-clear') return { disabled: !zones(doc).length || !!state.running };
  if (cmd === 'rdx-ocr') return { disabled: !redactedPages(doc).length };
  return { disabled: false };
}

export function initRedact() {
  Guard.setApplier((d) => apply(d)); // « Appliquer d'abord » des sorties (impression, export, fusion, extraction, division)
  A.registerTool('redact', 'Zone à caviarder', {
    down(doc, rec, ev) { ev.preventDefault(); A.startCreateDrag(doc, rec, ev); },
    cancel() { return false; },
  });
  Find.init();
}
