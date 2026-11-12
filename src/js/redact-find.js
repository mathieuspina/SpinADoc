// « Rechercher et caviarder » : panneau flottant. Mot / expression (sans casse ni accents) ou modèle (e-mail, téléphone, IBAN), sur le texte natif ET
// le texte reconnu (OCR) des pages (viewer.getPageItems) ; liste des occurrences à cocher ; « Marquer » ajoute les zones en UNE étape d'historique.
import { $, store, toast } from './ui.js';
import * as V from './viewer.js';
import * as A from './annotate.js';

const { DocModel, Redact } = window;
let cur = null; // { doc, results: [{ page, m, rects, checked, ocr, marked }] }
export const lastResults = () => (cur ? cur.results : []);

const status = (t) => { $('rdx-status').textContent = t; };

export function open(doc) {
  if (!doc) return;
  if (cur && cur.doc !== doc) clearHl();
  cur = { doc, results: cur && cur.doc === doc ? cur.results : [] };
  $('rdx-find').hidden = false;
  render();
  $('rdx-q').focus();
  $('rdx-q').select();
}
function clearHl() { if (cur && store.docs.includes(cur.doc)) V.setHighlights(cur.doc, null); }
export function close() { clearHl(); cur = null; $('rdx-find').hidden = true; }

export async function search() {
  if (!cur) return [];
  const doc = cur.doc;
  const kind = $('rdx-kind').value;
  const q = $('rdx-q').value;
  if (kind === 'text' && !q.trim()) { status('Saisissez un mot ou une expression, ou choisissez un modèle.'); return []; }
  const pages = $('rdx-scope').value === 'current' ? [Math.min(doc.page, doc.pages.length - 1)] : doc.pages.map((_, i) => i);
  const results = [];
  for (const p of pages) {
    if (cur === null || cur.doc !== doc) return [];
    status(`Recherche… page ${p + 1} / ${doc.pages.length}`);
    const items = await V.getPageItems(doc, p);
    for (const m of Redact.find(items, kind === 'text' ? { query: q } : { kind })) {
      const rects = Redact.matchRects(items, m, A.measure);
      if (!rects.length) continue;
      const marked = rects.every((r) => Redact.covered(doc.edits, p, r));
      results.push({ page: p, m, rects, checked: !marked, marked, ocr: m.parts.some((pt) => items[pt.idx] && items[pt.idx].ocr) });
    }
  }
  cur.results = results;
  render();
  V.setHighlights(doc, results.map((r) => ({ page: r.page, parts: r.m.parts })), -1);
  const ocr = results.filter((r) => r.ocr).length;
  status(results.length ? `${results.length} occurrence${results.length > 1 ? 's' : ''}${ocr ? ` (dont ${ocr} dans le texte reconnu par OCR)` : ''}.` : 'Aucune occurrence. (Une page scannée sans OCR n\'a pas de texte : lancez d\'abord « Reconnaître le texte », ou tracez les zones à la main.)');
  return results;
}

function render() {
  const list = $('rdx-list');
  const rows = (cur ? cur.results : []).map((r, k) => {
    const row = document.createElement('div');
    row.className = 'rdx-row' + (r.marked ? ' marked' : '');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = r.checked; cb.disabled = r.marked; cb.dataset.k = k;
    cb.setAttribute('aria-label', `Occurrence ${k + 1}, page ${r.page + 1}`);
    cb.addEventListener('change', () => { r.checked = cb.checked; updateCount(); });
    const go = document.createElement('button');
    go.type = 'button'; go.className = 'rdx-go link'; go.title = 'Afficher cette occurrence';
    const pg = document.createElement('span'); pg.className = 'rdx-pg'; pg.textContent = 'p. ' + (r.page + 1);
    const snip = document.createElement('span'); snip.className = 'rdx-snip';
    const mark = document.createElement('mark'); mark.textContent = r.m.hit;
    snip.append(document.createTextNode(r.m.pre ? '…' + r.m.pre : ''), mark, document.createTextNode(r.m.post ? r.m.post + '…' : ''));
    go.append(pg, snip);
    if (r.ocr) { const t = document.createElement('span'); t.className = 'rdx-tag'; t.textContent = 'OCR'; go.append(t); }
    if (r.marked) { const t = document.createElement('span'); t.className = 'rdx-tag'; t.textContent = 'marquée'; go.append(t); }
    go.addEventListener('click', () => { V.setHighlights(cur.doc, cur.results.map((x) => ({ page: x.page, parts: x.m.parts })), k); V.revealMatch(cur.doc, { page: r.page, parts: r.m.parts }); });
    row.append(cb, go);
    return row;
  });
  list.replaceChildren(...rows);
  updateCount();
}
function updateCount() {
  const n = cur ? cur.results.filter((r) => r.checked && !r.marked).length : 0;
  $('rdx-mark').disabled = n === 0;
  $('rdx-mark').textContent = n ? `Marquer ${n} occurrence${n > 1 ? 's' : ''}` : 'Marquer';
}

// Ajoute une zone par ligne de chaque occurrence cochée (celles déjà couvertes par une zone sont ignorées).
export function markChecked() {
  if (!cur) return 0;
  const doc = cur.doc;
  const add = [];
  for (const r of cur.results) {
    if (!r.checked || r.marked) continue;
    for (const rect of r.rects) if (!Redact.covered(doc.edits, r.page, rect) && !Redact.covered(add, r.page, rect)) add.push(Redact.zoneFromRect(r.page, rect));
    r.marked = true; r.checked = false;
  }
  if (!add.length) { render(); return 0; }
  DocModel.addEdits(doc, add);
  A.changed(doc);
  render();
  toast(`${add.length} zone${add.length > 1 ? 's' : ''} à caviarder ajoutée${add.length > 1 ? 's' : ''} (Ctrl+Z pour annuler). Rien n'est détruit avant « Appliquer le caviardage ».`, 4500);
  return add.length;
}

export function init() {
  $('rdx-search').addEventListener('click', () => { search(); });
  $('rdx-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } else if (e.key === 'Escape') { e.preventDefault(); close(); } e.stopPropagation(); });
  $('rdx-kind').addEventListener('change', () => { const t = $('rdx-kind').value === 'text'; $('rdx-q').disabled = !t; if (!t) search(); });
  $('rdx-all').addEventListener('click', () => { if (cur) { cur.results.forEach((r) => { if (!r.marked) r.checked = true; }); render(); } });
  $('rdx-none').addEventListener('click', () => { if (cur) { cur.results.forEach((r) => { r.checked = false; }); render(); } });
  $('rdx-mark').addEventListener('click', () => markChecked());
  $('rdx-close').addEventListener('click', () => close());
  $('rdx-find').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } e.stopPropagation(); });
}
