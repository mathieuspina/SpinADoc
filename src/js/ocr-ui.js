// Reconnaissance de texte (OCR) hors ligne : boîte de réglages, exécution en parallèle (workers tesseract.js), progression avec temps estimé,
// annulation immédiate, résultat rangé dans le modèle (doc.ocr, UNE étape d'historique), mots peu sûrs en évidence (option).
import { $, bus, toast } from './ui.js';
import * as V from './viewer.js';
import * as A from './annotate.js';
import { askForm, pageWord, targets } from './pages-ui.js';
import { progressItem } from './docs-ui.js';
import { createPool, recognizePage, planPage, poolSize } from './ocr-engine.js';

const { DocModel, Ocr } = window;
const yn = [{ v: 'yes', t: 'Oui' }, { v: 'no', t: 'Non' }];
export const state = { last: null, running: null }; // state.last : bilan du dernier lot (tests, rapport)

const fmtDur = (ms) => { const s = Math.max(1, Math.round(ms / 1000)); return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + String(s % 60).padStart(2, '0') + ' s'; };
const plural = (n, a, b) => `${n} ${n > 1 ? b : a}`;

// Pages à traiter selon le choix de la boîte.
function scopePages(doc, v) {
  if (v.scope === 'current') return [Math.min(doc.page, doc.pages.length - 1)];
  if (v.scope === 'selection') return targets(doc);
  return doc.pages.map((_, i) => i);
}

// options : { scope } portée proposée par défaut ; { auto: {…réglages} } pour les tests (sans boîte).
export async function run(doc, options) {
  if (state.running) { toast('Une reconnaissance de texte est déjà en cours.', 3000); return false; }
  A.closeEditor(doc, true);
  const o = options || {};
  const sel = targets(doc);
  const hasSel = !!(doc.runtime.pageSel && doc.runtime.pageSel.size > 1);
  const v = o.auto || await askForm({
    title: 'Reconnaître le texte (OCR)',
    intro: `« ${doc.name} » : ${pageWord(doc.pages.length)}. Le travail se fait sur cet ordinateur, sans aucun envoi sur Internet. Le texte reconnu est ajouté au fichier (calque invisible) à l'enregistrement.`,
    fields: [
      { id: 'scope', label: 'Pages', type: 'radio', value: o.scope === 'selection' && hasSel ? 'selection' : o.scope || 'current', options: [{ v: 'current', t: 'Page courante' }, ...(hasSel ? [{ v: 'selection', t: `Pages sélectionnées (${sel.length})` }] : []), { v: 'all', t: 'Tout le document' }] },
      { id: 'lang', label: 'Langues', type: 'select', options: [{ v: 'fra+eng', t: 'Français et anglais' }, { v: 'fra', t: 'Français' }, { v: 'eng', t: 'Anglais' }], value: 'fra+eng' },
      { id: 'quality', label: 'Qualité', type: 'select', options: [{ v: 'fast', t: 'Rapide (150 dpi)' }, { v: 'standard', t: 'Standard (300 dpi)' }, { v: 'fine', t: 'Fine (400 dpi)' }], value: 'standard', hint: 'Sur les grands formats (A1, A0) la résolution est réduite pour tenir en mémoire (jamais sous 170 dpi).' },
      { id: 'mode', label: 'Type de page', type: 'select', options: [{ v: 'text', t: 'Texte (courrier, notice, scan de lecture)' }, { v: 'plan', t: 'Plan / texte clairsemé (cotes, petits textes, texte pivoté)' }], value: 'text' },
      { id: 'turned', label: 'Lire aussi le texte pivoté (90°)', type: 'select', options: yn, value: 'yes', showIf: (x) => x.mode === 'plan' },
      { id: 'orientation', label: 'Détecter l\'orientation de la page', type: 'select', options: yn, value: 'yes', showIf: (x) => x.mode === 'text' },
      { id: 'skip', label: 'Ignorer les pages qui ont déjà du texte', type: 'select', options: yn, value: 'yes' },
      { id: 'redo', label: 'Refaire les pages déjà reconnues', type: 'select', options: yn, value: 'no', hint: 'Remplace le texte reconnu précédemment (annulable).' },
    ],
    okLabel: 'Lancer la reconnaissance',
  });
  if (!v) return false;
  const cfg = { lang: v.lang, quality: v.quality, mode: v.mode, turned: v.turned !== 'no', orientation: v.orientation !== 'no', skip: v.skip !== 'no', redo: v.redo === 'yes' };

  // --- pages concernées : on écarte celles qui ont déjà du texte (natif ou reconnu)
  const wanted = scopePages(doc, v);
  const recs = V.getPages(doc);
  const jobs = [], skipped = { native: [], done: [] };
  for (const i of wanted) {
    const rec = recs[i];
    if (!cfg.redo && doc.ocr && doc.ocr[rec.uid]) { skipped.done.push(i); continue; }
    if (cfg.skip) {
      let n = 0;
      try { n = Ocr.nativeChars((await rec.page.getTextContent()).items); } catch { /* page illisible : on tente l'OCR */ }
      if (n >= 12) { skipped.native.push(i); continue; }
    }
    jobs.push(i);
  }
  const skipMsg = () => [skipped.native.length ? `${plural(skipped.native.length, 'page a déjà du texte', 'pages ont déjà du texte')}` : '', skipped.done.length ? `${plural(skipped.done.length, 'page déjà reconnue', 'pages déjà reconnues')}` : ''].filter(Boolean).join(', ');
  if (!jobs.length) { toast(`Rien à reconnaître : ${skipMsg() || 'aucune page'}. (Décochez « Ignorer les pages qui ont déjà du texte » ou choisissez « Refaire » pour forcer.)`, 7000); state.last = { done: 0, skipped, failed: [], words: 0 }; return false; }

  // --- exécution
  const job = progressItem(`OCR : ${doc.name}`);
  const t0 = Date.now();
  let pool = null;
  state.running = { cancel: () => { job.cancelled = true; if (pool) pool.kill(); } };
  job.onCancel = () => state.running && state.running.cancel();
  const results = {}, failed = [], trace = {};
  let workers = 0;
  let tilesDone = 0, tilesTotal = 0;
  const upd = (label) => {
    const frac = tilesTotal ? Math.min(0.99, tilesDone / tilesTotal) : 0;
    const el = Date.now() - t0;
    const eta = tilesDone > 1 && frac > 0.02 ? ' — il reste ≈ ' + fmtDur(el / frac - el) : '';
    job.set(label + eta, frac);
  };
  try {
    job.set('Chargement du moteur de reconnaissance…', 0);
    const size = Math.min(poolSize(), Math.max(1, cfg.mode === 'plan' ? poolSize() : jobs.length));
    workers = size;
    pool = await createPool({ lang: cfg.lang, psm: cfg.mode === 'plan' ? 11 : 3, size, dpi: Ocr.QUALITY[cfg.quality].dpi });
    if (job.cancelled) throw Object.assign(new Error('annulé'), { cancelled: true });
    const passes = cfg.mode === 'plan' && cfg.turned ? 2 : 1;
    for (const i of jobs) tilesTotal += planPage(recs[i].page, { quality: cfg.quality, mode: cfg.mode }).tiles.length * passes;
    let finished = 0;
    const queue = jobs.slice();
    const worker = async () => {
      while (queue.length && !job.cancelled) {
        const i = queue.shift();
        const rec = recs[i];
        upd(`Page ${i + 1} (${finished + 1} / ${jobs.length})`);
        try {
          const r = await recognizePage(pool, rec.page, cfg, () => { tilesDone++; upd(`Page ${i + 1} (${finished + 1} / ${jobs.length})`); });
          results[rec.uid] = Ocr.makeRecord(r.words, { lang: cfg.lang, quality: cfg.quality, mode: cfg.mode, dpi: Math.round(r.plan.dpi) });
          trace[i] = { theta: r.theta, passes: r.trace };
        } catch (err) {
          if (err && err.cancelled) throw err;
          console.error(err);
          failed.push({ page: i + 1, error: String(err && err.message || err) });
        }
        finished++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, worker));
  } catch (err) {
    if (!(err && err.cancelled)) {
      console.error(err);
      job.end('OCR impossible : ' + (err && err.message || err), 'error', 12000);
      state.running = null; state.last = { error: String(err && err.message || err) };
      if (pool) pool.kill();
      return false;
    }
  }
  if (pool) pool.kill();
  state.running = null;
  const uids = Object.keys(results);
  if (uids.length) {
    DocModel.setOcr(doc, results);
    A.changed(doc);
    V.syncOcr(doc);
  }
  const words = uids.reduce((s, u) => s + results[u].n, 0);
  const conf = words ? Math.round(uids.reduce((s, u) => s + results[u].conf * results[u].n, 0) / words) : 0;
  state.last = { done: uids.length, words, conf, skipped, failed, ms: Date.now() - t0, cancelled: job.cancelled, workers, trace };
  if (job.cancelled) {
    job.end(uids.length ? `Annulé : ${plural(uids.length, 'page reconnue conservée', 'pages reconnues conservées')} (Ctrl+Z pour les retirer).` : 'Reconnaissance annulée : rien n\'a été ajouté.', 'cancelled', 8000);
    return false;
  }
  const parts = [`${plural(uids.length, 'page reconnue', 'pages reconnues')} en ${fmtDur(Date.now() - t0)} : ${plural(words, 'mot', 'mots')}, confiance moyenne ${conf} %`];
  if (skipMsg()) parts.push(skipMsg());
  if (failed.length) parts.push(`échec : page${failed.length > 1 ? 's' : ''} ${failed.map((f) => f.page).join(', ')}`);
  job.end(parts.join(' — ') + '.', failed.length ? 'error' : 'done', failed.length ? 15000 : 10000);
  return uids.length > 0;
}

export function toggleLowConf(doc) {
  const on = !doc.runtime.ocrLow;
  doc.runtime.ocrLow = on;
  V.setOcrLowlight(doc, on);
  bus.emit('doc-changed', doc);
  toast(on ? 'Mots peu sûrs (confiance < 60 %) surlignés en orange. Passez la souris dessus pour voir la confiance.' : 'Surlignage des mots peu sûrs désactivé.', 3500);
}
export function removeOcr(doc, uids) {
  const entries = {};
  for (const u of uids) if (doc.ocr && doc.ocr[u]) entries[u] = null;
  if (!Object.keys(entries).length) return false;
  DocModel.setOcr(doc, entries); A.changed(doc); V.syncOcr(doc);
  return true;
}

export const commands = {
  'doc-ocr': (d) => run(d, { scope: 'current' }),
  'pg-ocr': (d) => run(d, { scope: 'selection' }),
  'ocr-lowconf': (d) => toggleLowConf(d),
  'ocr-remove': (d) => { const ts = scopePages(d, { scope: d.runtime.pageSel && d.runtime.pageSel.size > 1 ? 'selection' : 'all' }); const ok = removeOcr(d, ts.map((i) => d.pages[i].u)); toast(ok ? 'Texte reconnu retiré (Ctrl+Z pour annuler).' : 'Aucun texte reconnu à retirer.', 3500); },
};
export const isOcrCmd = (c) => Object.prototype.hasOwnProperty.call(commands, c);
export function ribbonState(cmd, doc) {
  if (cmd === 'ocr-lowconf') return { disabled: !doc || !doc.ocr || !Object.keys(doc.ocr).length, pressed: !!(doc && doc.runtime.ocrLow) };
  if (cmd === 'ocr-remove') return { disabled: !doc || !doc.ocr || !Object.keys(doc.ocr).length };
  return null;
}
void $;
