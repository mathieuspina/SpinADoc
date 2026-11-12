// Onglet Pages : commandes (ruban, panneau de miniatures, menu contextuel), boîtes de dialogue, recadrage, extraction, division.
// La logique de structure est dans src/page-ops.js (pur) ; l'écriture dans src/pdf-edit.js ; l'affichage dans viewer.js (syncPages).
// Chaque opération est UNE étape de l'historique des objets (DocModel.setPagesState) : Annuler / Rétablir couvrent pages et annotations.
import { $, api, bus, store, toast, busy } from './ui.js';
import * as V from './viewer.js';
import * as A from './annotate.js';
import * as NumUI from './numbering-ui.js';
import * as FormsUI from './forms-ui.js';
import { readSource } from './pdf-source.js';
import { guardOutput } from './redact-guard.js';

const { DocModel, PageOps, PDFLib, PrintLayout } = window;

// ---------------------------------------------------------------- sélection de pages (miniatures)
export const selection = (doc) => doc.runtime.pageSel || (doc.runtime.pageSel = new Set());
export const selectedList = (doc) => [...selection(doc)].filter((i) => i < doc.pages.length).sort((a, b) => a - b);
// Pages visées par une commande : la sélection, sinon la page courante.
export function targets(doc) { const s = selectedList(doc); return s.length ? s : [Math.min(doc.page, doc.pages.length - 1)]; }
export function setSelection(doc, list, anchor) {
  doc.runtime.pageSel = new Set(list);
  if (anchor !== undefined) doc.runtime.pageAnchor = anchor;
  bus.emit('page-selection', doc);
}

// ---------------------------------------------------------------- exécution d'une opération
// fn(état) → nouvel état (PageOps) ; select : 'keep' (mêmes pages sélectionnées), 'new' (pages créées), 'none'.
async function run(doc, fn, select, label) {
  A.closeEditor(doc, true);
  const before = DocModel.pageState(doc);
  const oldUids = new Set(before.pages.map((p) => p.u));
  const keepUids = selectedList(doc).map((i) => before.pages[i].u);
  let st;
  try { st = fn(before); } catch (err) { toast(err.message || String(err)); return false; }
  if (!(await FormsUI.guard(doc, st.pages))) return false; // champs de formulaire perdus : l'utilisateur est prévenu
  DocModel.setPagesState(doc, st);
  await V.syncPages(doc);
  const idxOf = new Map(doc.pages.map((p, i) => [p.u, i]));
  let sel = [];
  if (select === 'keep') sel = keepUids.map((u) => idxOf.get(u)).filter((i) => i !== undefined);
  else if (select === 'new') sel = doc.pages.map((p, i) => (oldUids.has(p.u) ? -1 : i)).filter((i) => i >= 0);
  setSelection(doc, sel, sel[0]);
  A.changed(doc);
  if (label) toast(label, 2500);
  return true;
}

export const pageWord = (n) => `${n} page${n > 1 ? 's' : ''}`;

// ---------------------------------------------------------------- opérations
export const rotate = (doc, delta) => run(doc, (st) => PageOps.rotate(st, targets(doc), delta), 'keep');
export const remove = (doc) => {
  const t = targets(doc);
  return run(doc, (st) => PageOps.remove(st, t), 'none', `${pageWord(t.length)} supprimée${t.length > 1 ? 's' : ''} (Ctrl+Z pour annuler).`);
};
export const duplicate = (doc) => run(doc, (st) => PageOps.duplicate(st, targets(doc)), 'new');
// Glisser-déposer : déplace les pages `idxs` devant la page `to` (0 … n).
export const move = (doc, idxs, to) => run(doc, (st) => PageOps.move(st, idxs, to), 'keep');
export function selectAll(doc) { setSelection(doc, doc.pages.map((_, i) => i), 0); }

// ---------------------------------------------------------------- boîte de dialogue générique
// fields : [{ id, label, type: 'select'|'number'|'text'|'radio'|'note', options: [{ v, t }], value, min, max, hint, showIf(values) }]
// validate(values) → message d'erreur (la boîte reste ouverte) ou ''. Renvoie les valeurs, ou null si annulé.
export function askForm({ title, intro, fields, okLabel, validate }) {
  return new Promise((resolve) => {
    const dlg = $('pgdlg');
    $('pgdlg-title').textContent = title;
    $('pgdlg-intro').textContent = intro || '';
    $('pgdlg-intro').hidden = !intro;
    $('pgdlg-err').textContent = '';
    $('pgdlg-ok').textContent = okLabel || 'OK';
    const body = $('pgdlg-body');
    body.replaceChildren();
    const ctl = {};
    const rows = [];
    const read = () => {
      const v = {};
      for (const f of fields) {
        if (f.type === 'note') continue;
        if (f.type === 'radio') v[f.id] = (body.querySelector(`input[name=pgf-${f.id}]:checked`) || {}).value;
        else if (f.type === 'number') v[f.id] = Number(ctl[f.id].value);
        else v[f.id] = ctl[f.id].value;
      }
      return v;
    };
    const showAll = () => { const v = read(); rows.forEach(([f, els]) => { const on = !f.showIf || f.showIf(v); els.forEach((e) => { e.hidden = !on; }); }); };
    for (const f of fields) {
      const lab = document.createElement('label');
      lab.textContent = f.label || '';
      let el;
      if (f.type === 'note') { el = document.createElement('p'); el.className = 'muted small'; el.textContent = f.value; el.style.gridColumn = '1 / -1'; body.append(el); rows.push([f, [el]]); continue; }
      if (f.type === 'select') {
        el = document.createElement('select');
        for (const o of f.options) { const op = document.createElement('option'); op.value = o.v; op.textContent = o.t; el.append(op); }
        el.value = f.value;
      } else if (f.type === 'radio') {
        el = document.createElement('div');
        for (const o of f.options) {
          const l = document.createElement('label');
          l.className = 'radio';
          const r = document.createElement('input');
          r.type = 'radio'; r.name = 'pgf-' + f.id; r.value = o.v; r.checked = o.v === f.value;
          l.append(r, ' ' + o.t);
          el.append(l);
        }
      } else {
        el = document.createElement('input');
        el.type = f.type === 'number' ? 'number' : f.type === 'password' ? 'password' : 'text';
        if (f.min !== undefined) el.min = f.min;
        if (f.max !== undefined) el.max = f.max;
        if (f.placeholder) el.placeholder = f.placeholder;
        el.value = f.value === undefined ? '' : f.value;
      }
      el.id = 'pgf-' + f.id;
      lab.htmlFor = el.id;
      ctl[f.id] = el;
      body.append(lab, el);
      if (f.hint) { const h = document.createElement('span'); h.className = 'muted small'; h.textContent = f.hint; h.style.gridColumn = '2'; body.append(h); rows.push([f, [lab, el, h]]); } else rows.push([f, [lab, el]]);
    }
    const finish = (v) => {
      dlg.hidden = true;
      dlg.removeEventListener('keydown', onKey, true);
      dlg.removeEventListener('input', showAll);
      $('pgdlg-ok').onclick = null; $('pgdlg-cancel').onclick = null;
      resolve(v);
    };
    const ok = () => {
      const v = read();
      const err = validate ? validate(v) : '';
      if (err) { $('pgdlg-err').textContent = err; return; }
      finish(v);
    };
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
      else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'SELECT') { e.preventDefault(); e.stopPropagation(); ok(); }
      else e.stopPropagation();
    }
    $('pgdlg-ok').onclick = ok;
    $('pgdlg-cancel').onclick = () => finish(null);
    dlg.addEventListener('keydown', onKey, true);
    dlg.addEventListener('input', showAll);
    showAll();
    dlg.hidden = false;
    const first = body.querySelector('select, input:not([type=radio])') || body.querySelector('input');
    if (first) first.focus();
  });
}

// Position d'insertion : sélecteur commun aux pages vierges et aux pages d'un autre PDF.
const positionFields = (n, cur) => [
  { id: 'where', label: 'Position', type: 'select', value: 'after', options: [
    { v: 'after', t: `Après la page courante (${cur + 1})` }, { v: 'before', t: `Avant la page courante (${cur + 1})` },
    { v: 'start', t: 'Au début du document' }, { v: 'end', t: 'À la fin du document' }, { v: 'at', t: 'Avant la page n°…' }] },
  { id: 'at', label: 'Avant la page n°', type: 'number', value: Math.min(n, cur + 2), min: 1, max: n + 1, showIf: (v) => v.where === 'at' },
];
function positionOf(v, n, cur) {
  if (v.where === 'after') return cur + 1;
  if (v.where === 'before') return cur;
  if (v.where === 'start') return 0;
  if (v.where === 'end') return n;
  return Math.min(n, Math.max(0, Math.round(v.at) - 1));
}

// ---------------------------------------------------------------- page vierge
const PAPER_MM = { A4: [210, 297], A3: [297, 420], A2: [420, 594] };
export async function insertBlank(doc) {
  const n = doc.pages.length;
  const cur = Math.min(doc.page, n - 1);
  const v = await askForm({
    title: 'Insérer une page vierge',
    fields: [
      { id: 'size', label: 'Format', type: 'select', value: 'A4', options: [{ v: 'A4', t: 'A4' }, { v: 'A3', t: 'A3' }, { v: 'A2', t: 'A2' }, { v: 'same', t: 'Identique à la page courante' }] },
      { id: 'orient', label: 'Orientation', type: 'select', value: 'portrait', options: [{ v: 'portrait', t: 'Portrait' }, { v: 'landscape', t: 'Paysage' }], showIf: (x) => x.size !== 'same' },
      { id: 'count', label: 'Nombre de pages', type: 'number', value: 1, min: 1, max: 200 },
      ...positionFields(n, cur),
    ],
    okLabel: 'Insérer',
    validate: (x) => (!(x.count >= 1 && x.count <= 200) ? 'Indiquez un nombre de pages entre 1 et 200.' : ''),
  });
  if (!v) return false;
  let w, h;
  if (v.size === 'same') {
    const vp = V.pageViewport(V.getPages(doc)[cur], 1, 0); // taille affichée de la page courante (recadrage et rotation compris)
    w = vp.width; h = vp.height;
  } else {
    const [a, b] = PAPER_MM[v.size];
    w = PrintLayout.mm(v.orient === 'landscape' ? b : a); h = PrintLayout.mm(v.orient === 'landscape' ? a : b);
  }
  const id = PageOps.blankId(w, h);
  const at = positionOf(v, n, cur);
  const count = Math.round(v.count);
  return run(doc, (st) => PageOps.insert(st, at, Array.from({ length: count }, () => ({ src: id, i: 0 }))), 'new');
}

// ---------------------------------------------------------------- pages d'un autre PDF
export async function insertFromPdf(doc) {
  const paths = await api.openDialog();
  if (!paths || !paths.length) return false;
  const done = busy('Lecture du PDF…');
  let file, count;
  try {
    file = await api.readFile(paths[0], { noRecent: true });
    count = (await PDFLib.PDFDocument.load(file.bytes)).getPageCount();
  } catch (err) {
    done();
    toast('Impossible de lire ce PDF (fichier protégé, abîmé ou introuvable).');
    return false;
  }
  done();
  const n = doc.pages.length;
  const cur = Math.min(doc.page, n - 1);
  const v = await askForm({
    title: 'Insérer des pages d\'un PDF',
    intro: `« ${file.name} » : ${pageWord(count)}.`,
    fields: [
      { id: 'range', label: 'Pages à insérer', type: 'text', value: '', placeholder: 'Toutes', hint: 'Laissez vide pour toutes, ou : 1-3, 5, 8-12' },
      ...positionFields(n, cur),
    ],
    okLabel: 'Insérer',
    validate: (x) => (x.range.trim() ? (PageOps.parseGroups(x.range, count).error || '') : ''),
  });
  if (!v) return false;
  const idx = v.range.trim() ? PageOps.parseGroups(v.range, count).groups.flat() : Array.from({ length: count }, (_, i) => i);
  let k = Object.keys(doc.sources).length + 1;
  while (doc.sources['s' + k]) k++;
  const id = 's' + k;
  DocModel.addSource(doc, id, { bytes: file.bytes, name: file.name });
  const at = positionOf(v, n, cur);
  return run(doc, (st) => PageOps.insert(st, at, idx.map((i) => ({ src: id, i }))), 'new', `${pageWord(idx.length)} insérée${idx.length > 1 ? 's' : ''} depuis « ${file.name} ».`);
}

// Fichiers PDF déposés sur le panneau des miniatures : toutes leurs pages sont insérées à la position `at` (0 … n), dans l'ordre des fichiers,
// en UNE étape d'historique. items : [{ path, name }]. Renvoie le nombre de pages insérées (0 si rien).
export async function insertDropped(doc, items, at) {
  const pdfs = [];
  for (const it of items) {
    if (!/\.pdf$/i.test(it.name || it.path || '')) toast(`« ${it.name || it.path} » n'est pas un PDF : ignoré.`, 5000);
    else pdfs.push(it);
  }
  if (!pdfs.length) return 0;
  A.closeEditor(doc, true);
  let done = busy('Lecture des PDF…');
  const srcs = [];
  try {
    for (const it of pdfs) {
      let file;
      try { file = await api.readFile(it.path, { noRecent: true }); } catch { toast(`« ${it.name} » est introuvable ou illisible.`, 5000); continue; }
      const r = await readSource(file.name || it.name, file.bytes, async (o) => { done(); const v = await askForm(o); done = busy('Lecture des PDF…'); return v; });
      if (r.error) { toast(r.error, 6000); continue; }
      srcs.push({ name: file.name || it.name, bytes: r.bytes, n: r.n });
    }
  } finally { done(); }
  if (!srcs.length) return 0;
  const descs = [];
  let k = Object.keys(doc.sources).length + 1;
  for (const s of srcs) {
    while (doc.sources['s' + k]) k++;
    const id = 's' + k++;
    DocModel.addSource(doc, id, { bytes: s.bytes, name: s.name });
    for (let i = 0; i < s.n; i++) descs.push({ src: id, i });
  }
  // défilement stable : la page affichée reste à la même place à l'écran
  const rt = doc.runtime;
  const cur = rt.pages && rt.pages[Math.min(doc.page, rt.pages.length - 1)];
  const vtop = rt.viewer ? rt.viewer.getBoundingClientRect().top : 0;
  const off = cur ? cur.div.getBoundingClientRect().top - vtop : 0;
  const curU = cur && cur.uid;
  const pos = Math.max(0, Math.min(doc.pages.length, at));
  const ok = await run(doc, (st) => PageOps.insert(st, pos, descs), 'new', `${pageWord(descs.length)} insérée${descs.length > 1 ? 's' : ''} depuis ${srcs.length > 1 ? srcs.length + ' fichiers' : '« ' + srcs[0].name + ' »'}.`);
  if (ok && cur && rt.viewer) {
    const idx = doc.pages.findIndex((p) => p.u === curU);
    const rec = rt.pages[idx];
    if (rec) { doc.page = idx; rt.viewer.scrollTop += rec.div.getBoundingClientRect().top - rt.viewer.getBoundingClientRect().top - off; }
  }
  return ok ? descs.length : 0;
}

// ---------------------------------------------------------------- extraire / diviser
const baseName = (doc) => doc.name.replace(/\.pdf$/i, '');
export async function extract(doc) {
  A.closeEditor(doc, true);
  if (!(await guardOutput(doc, "L'extraction", targets(doc)))) return false; // zones non appliquées sur ces pages
  const t = targets(doc);
  const done = busy('Extraction…');
  try {
    const st = PageOps.subset(DocModel.pageState(doc), t);
    const bytes = await V.exportBytes(doc, st);
    const r = await api.saveAs(bytes, `${baseName(doc)}-extrait.pdf`, doc.path);
    if (r.saved) toast(`${pageWord(t.length)} extraite${t.length > 1 ? 's' : ''} vers « ${r.name} ».`);
    return !!r.saved;
  } catch (err) {
    console.error(err);
    toast(`Échec de l'extraction : ${err && err.message ? err.message : err}`, 8000);
    return false;
  } finally { done(); }
}

export async function split(doc) {
  A.closeEditor(doc, true);
  const n = doc.pages.length;
  if (n < 2) { toast('Ce document n\'a qu\'une page : rien à diviser.'); return false; }
  if (!(await guardOutput(doc, 'La division'))) return false;
  const v = await askForm({
    title: 'Diviser le PDF',
    intro: `« ${doc.name} » : ${pageWord(n)}. Les annotations et mesures sont écrites dans les fichiers produits.`,
    fields: [
      { id: 'mode', label: 'Découpe', type: 'radio', value: 'ranges', options: [{ v: 'ranges', t: 'Par plages (un fichier par plage)' }, { v: 'every', t: 'Tous les N pages' }, { v: 'each', t: 'Une page par fichier' }] },
      { id: 'ranges', label: 'Plages', type: 'text', value: '', placeholder: '1-3, 5, 8-12', showIf: (x) => x.mode === 'ranges' },
      { id: 'every', label: 'Pages par fichier', type: 'number', value: 10, min: 1, max: n, showIf: (x) => x.mode === 'every' },
    ],
    okLabel: 'Choisir le dossier…',
    validate: (x) => (PageOps.splitPlan(n, x.mode, x.mode === 'ranges' ? x.ranges : x.every).error || ''),
  });
  if (!v) return false;
  const plan = PageOps.splitPlan(n, v.mode, v.mode === 'ranges' ? v.ranges : v.every).files;
  const dir = await api.pickDir(doc.path ? doc.path.replace(/[\\/][^\\/]*$/, '') : undefined);
  if (!dir) return false;
  const done = busy('Division…');
  try {
    const taken = new Set();
    const base = baseName(doc);
    const names = [];
    const st0 = DocModel.pageState(doc);
    for (let k = 0; k < plan.length; k++) {
      $('busy-label').textContent = `Division… fichier ${k + 1} / ${plan.length}`;
      const bytes = await V.exportBytes(doc, PageOps.subset(st0, plan[k].pages));
      const r = await api.writeMany(dir, [{ name: PageOps.uniqueName(base, plan[k].label, taken), bytes }]);
      names.push(...r.written);
    }
    toast(`${names.length} fichier${names.length > 1 ? 's' : ''} écrit${names.length > 1 ? 's' : ''} dans ${dir}.`, 7000);
    return true;
  } catch (err) {
    console.error(err);
    toast(`Échec de la division : ${err && err.message ? err.message : err}`, 8000);
    return false;
  } finally { done(); }
}

// ---------------------------------------------------------------- recadrage (cadre tiré à la souris)
let crop = null; // { doc, rec, layer, rect:{x,y,w,h}|null, targets }
const MIN_PX = 12;

export function cropActive() { return !!crop; }
export function startCrop(doc) {
  if (crop) cancelCrop();
  A.closeEditor(doc, true);
  const rec = V.getPages(doc)[Math.min(doc.page, doc.pages.length - 1)];
  const t = targets(doc);
  const layer = document.createElement('div');
  layer.className = 'crop-layer';
  rec.div.append(layer);
  crop = { doc, rec, layer, rect: null, targets: t, els: [] };
  const many = t.length > 1;
  $('crop-info').textContent = many ? `Tirez un cadre sur la page ${rec.index + 1} : il sera appliqué à ${t.length} pages.` : `Tirez un cadre sur la page ${rec.index + 1}.`;
  $('crop-ok').disabled = true;
  $('cropbar').hidden = false;
  layer.addEventListener('mousedown', onCropDown);
  drawCrop();
  bus.emit('view', doc);
}

function drawCrop() {
  const c = crop;
  c.layer.replaceChildren();
  const W = c.rec.vp.width, H = c.rec.vp.height;
  const r = c.rect;
  if (!r) return;
  const shade = (x, y, w, h) => { const e = document.createElement('div'); e.className = 'crop-shade'; Object.assign(e.style, { left: x + 'px', top: y + 'px', width: Math.max(0, w) + 'px', height: Math.max(0, h) + 'px' }); c.layer.append(e); };
  shade(0, 0, W, r.y); shade(0, r.y + r.h, W, H - r.y - r.h); shade(0, r.y, r.x, r.h); shade(r.x + r.w, r.y, W - r.x - r.w, r.h);
  const box = document.createElement('div');
  box.className = 'crop-rect';
  Object.assign(box.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
  box.dataset.part = 'move';
  c.layer.append(box);
  for (const [px, py, name] of [[r.x, r.y, 'nw'], [r.x + r.w, r.y, 'ne'], [r.x, r.y + r.h, 'sw'], [r.x + r.w, r.y + r.h, 'se']]) {
    const h = document.createElement('div');
    h.className = 'crop-h';
    h.dataset.part = name;
    h.style.cursor = name + '-resize';
    Object.assign(h.style, { left: px + 'px', top: py + 'px' });
    c.layer.append(h);
  }
  $('crop-ok').disabled = !(r.w >= MIN_PX && r.h >= MIN_PX);
}

function onCropDown(ev) {
  if (ev.button !== 0 || !crop) return;
  ev.preventDefault(); ev.stopPropagation();
  const c = crop;
  const W = c.rec.vp.width, H = c.rec.vp.height;
  const b = c.rec.div.getBoundingClientRect();
  const pt = (e) => [Math.min(W, Math.max(0, e.clientX - b.left)), Math.min(H, Math.max(0, e.clientY - b.top))];
  const part = ev.target.dataset && ev.target.dataset.part;
  const [x0, y0] = pt(ev);
  const start = c.rect ? Object.assign({}, c.rect) : null;
  let mode = 'new';
  if (start && part === 'move') mode = 'move';
  else if (start && part) mode = part;
  const move = (e) => {
    const [x, y] = pt(e);
    if (mode === 'new') c.rect = { x: Math.min(x0, x), y: Math.min(y0, y), w: Math.abs(x - x0), h: Math.abs(y - y0) };
    else if (mode === 'move') {
      const dx = Math.min(W - start.w - start.x, Math.max(-start.x, x - x0)), dy = Math.min(H - start.h - start.y, Math.max(-start.y, y - y0));
      c.rect = { x: start.x + dx, y: start.y + dy, w: start.w, h: start.h };
    } else {
      // coin tiré : l'angle opposé reste fixe
      const fx = mode.includes('w') ? start.x + start.w : start.x, fy = mode.includes('n') ? start.y + start.h : start.y;
      c.rect = { x: Math.min(fx, x), y: Math.min(fy, y), w: Math.abs(x - fx), h: Math.abs(y - fy) };
    }
    drawCrop();
  };
  const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

export function cancelCrop() {
  if (!crop) return;
  crop.layer.remove();
  const doc = crop.doc;
  crop = null;
  $('cropbar').hidden = true;
  bus.emit('view', doc);
}

// Cadre (pixels de la page affichée) → boîte PDF [x0, y0, x1, y1], limitée à la zone visible de chaque page visée.
function cropBoxes(c) {
  const r = c.rect;
  const [ax, ay] = c.rec.vp.convertToPdfPoint(r.x, r.y);
  const [bx, by] = c.rec.vp.convertToPdfPoint(r.x + r.w, r.y + r.h);
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}
async function applyCrop(reset) {
  const c = crop;
  if (!c) return;
  const { doc } = c;
  const recs = V.getPages(doc);
  let box = null;
  if (!reset) { if (!c.rect) return; box = cropBoxes(c); }
  const ts = c.targets;
  cancelCrop();
  await run(doc, (st) => {
    let s = st;
    for (const i of ts) {
      let b = null;
      if (box) { const v = recs[i].page.view; b = [Math.max(box[0], v[0]), Math.max(box[1], v[1]), Math.min(box[2], v[2]), Math.min(box[3], v[3])]; }
      s = PageOps.crop(s, [i], b);
    }
    return s;
  }, 'keep');
}
export function initCropBar() {
  $('crop-ok').addEventListener('click', () => applyCrop(false));
  $('crop-reset').addEventListener('click', () => applyCrop(true));
  $('crop-cancel').addEventListener('click', cancelCrop);
  document.addEventListener('keydown', (e) => { if (crop && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelCrop(); } else if (crop && e.key === 'Enter' && !$('crop-ok').disabled) { e.preventDefault(); applyCrop(false); } }, true);
  bus.on('pages', () => { if (crop) cancelCrop(); });
}

// ---------------------------------------------------------------- table des commandes (ruban, barre des miniatures, menu contextuel)
// Branché par app.js (évite une dépendance circulaire avec ocr-ui.js).
export const hooks = { ocr: () => {} };
export const commands = {
  'pg-select-all': (d) => selectAll(d),
  'pg-rot-left': (d) => rotate(d, -90),
  'pg-rot-right': (d) => rotate(d, 90),
  'pg-delete': (d) => remove(d),
  'pg-dup': (d) => duplicate(d),
  'pg-extract': (d) => extract(d),
  'pg-blank': (d) => insertBlank(d),
  'pg-insert': (d) => insertFromPdf(d),
  'pg-crop': (d) => (crop ? cancelCrop() : startCrop(d)),
  'pg-split': (d) => split(d),
  'pg-number': (d) => NumUI.open(d),
  'pg-ocr': (d) => hooks.ocr(d),
  'pg-number-preview': (d) => NumUI.togglePreview(d),
};
export const isPageCmd = (c) => Object.prototype.hasOwnProperty.call(commands, c);
export function exec(cmd, doc) { return doc && commands[cmd] ? commands[cmd](doc) : undefined; }

// ---------------------------------------------------------------- menu contextuel des miniatures
const MENU = [
  ['pg-rot-left', 'Pivoter à gauche'], ['pg-rot-right', 'Pivoter à droite'], null,
  ['pg-dup', 'Dupliquer'], ['pg-delete', 'Supprimer'], ['pg-extract', 'Extraire vers un nouveau PDF…'], null,
  ['pg-blank', 'Insérer une page vierge…'], ['pg-insert', 'Insérer des pages d\'un PDF…'], null,
  ['pg-crop', 'Recadrer…'], ['pg-number', 'Numéroter les pages…'], ['pg-ocr', 'Reconnaître le texte (OCR)…'], null, ['pg-select-all', 'Tout sélectionner'],
];
export function closeMenu() { $('pgmenu').hidden = true; }
export function openMenu(x, y, doc) {
  const m = $('pgmenu');
  m.replaceChildren();
  for (const it of MENU) {
    if (!it) { const hr = document.createElement('hr'); hr.style.cssText = 'border:0;border-top:1px solid var(--border);margin:4px 0'; m.append(hr); continue; }
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'recent-item'; b.setAttribute('role', 'menuitem');
    b.textContent = it[1];
    b.dataset.cmd2 = it[0];
    b.addEventListener('click', () => { closeMenu(); exec(it[0], doc); });
    m.append(b);
  }
  m.style.left = Math.max(8, Math.min(x, window.innerWidth - 280)) + 'px';
  m.style.top = Math.max(8, Math.min(y, window.innerHeight - 420)) + 'px';
  m.hidden = false;
}
document.addEventListener('mousedown', (e) => { if (!$('pgmenu').hidden && !e.target.closest('#pgmenu')) closeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('pgmenu').hidden) { closeMenu(); e.stopPropagation(); } }, true);

// État des boutons du ruban : null si la commande n'est pas une commande de pages.
export function ribbonState(cmd, doc) {
  if (!isPageCmd(cmd)) return null;
  if (!doc || !doc.pages) return { disabled: true };
  if (cmd === 'pg-crop') return { disabled: false, pressed: !!crop };
  if (cmd === 'pg-number-preview') return { disabled: false, pressed: !doc.runtime.numHide };
  if (cmd === 'pg-split') return { disabled: doc.pages.length < 2 };
  if (cmd === 'pg-delete') return { disabled: targets(doc).length >= doc.pages.length };
  return { disabled: false };
}
