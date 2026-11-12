// Onglet « Mesure » : outils (distance, polyligne, surface, angle, cote, cercle, trou), échelle et calibrage, aimantation,
// panneau « Mesures » (tableau, tri, filtre, totaux), export CSV. Les calculs et le dessin sont dans src/measure.js ;
// l'aimantation dans src/snap-geometry.js. Les outils s'enregistrent auprès d'annotate.js (registerTool).
import { $, api, bus, store, toast } from './ui.js';
import * as V from './viewer.js';
import * as A from './annotate.js';
import * as Settings from './settings.js';
import * as Sidebar from './sidebar.js';

const { DocModel, Measure, SnapGeometry } = window;
const clone = (o) => JSON.parse(JSON.stringify(o));
const rt = (doc) => doc.runtime;
const SVGNS = 'http://www.w3.org/2000/svg';

// Nombre de points : n fixe, ou min (nombre variable : double-clic / Entrée pour terminer).
const SPEC = {
  'm-dist': { n: 2, label: 'Distance' }, 'm-dim': { n: 2, label: 'Cote' }, 'm-angle': { n: 3, label: 'Angle' }, 'm-circle': { n: 3, label: 'Cercle' },
  'm-poly': { n: 0, min: 2, label: 'Polyligne (mesure)' }, 'm-area': { n: 0, min: 3, label: 'Surface' },
  'm-hole': { n: 0, min: 3, label: 'Trou dans une surface' }, 'm-calib': { n: 2, label: 'Calibrer' },
};
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const state = (doc) => rt(doc).mx || null;

// ----------------------------------------------------------------------------- aimantation (points des tracés du plan)
export function snapIndex(doc, rec) {
  const r = rt(doc);
  const cache = r.mxSnap || (r.mxSnap = {});
  const c = cache[rec.uid];
  if (c) return c.idx || null;
  const entry = cache[rec.uid] = { idx: null, done: false };
  snapBusy(+1);
  entry.ready = (async () => {
    try {
      const page = rec.page;
      const ol = await page.getOperatorList();
      const g = SnapGeometry.extract(ol, V.OPS);
      const v = page.view;
      entry.idx = new SnapGeometry.Index(g, { x0: v[0], y0: v[1], w: v[2] - v[0], h: v[3] - v[1] });
    } catch { /* pas d'aimantation sur cette page */ }
    entry.done = true;
    snapBusy(-1);
    return entry.idx;
  })();
  return null;
}

// Analyse en cours pour cette page : promesse de l'index (null si l'analyse est finie ou n'a pas commencé).
export function snapPending(doc, rec) {
  const c = (rt(doc).mxSnap || {})[rec.uid];
  return c && !c.done ? c.ready : null;
}

// Indicateur discret dans la barre d'état tant qu'au moins une analyse de tracés est en cours.
let busyCount = 0;
function snapBusy(d) {
  busyCount = Math.max(0, busyCount + d);
  const el = document.getElementById('snap-busy');
  if (el) el.hidden = busyCount === 0;
}

const angle15 = (dx, dy) => { const L = Math.hypot(dx, dy); const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12); return [L * Math.cos(a), L * Math.sin(a)]; };

// Point effectif sous la souris : aimanté (extrémité / intersection), sinon contraint à 15° avec Maj.
function pointFor(doc, rec, ev) {
  const s = state(doc);
  let pt = A.pdfPoint(rec, ev);
  let snap = null;
  if (Settings.get('snap') !== false && !ev.altKey) {
    const idx = snapIndex(doc, rec);
    if (idx) { snap = idx.snap(pt[0], pt[1], 10 / rec.vp.scale); if (snap) pt = [snap.x, snap.y]; }
  }
  if (!snap && ev.shiftKey && s && s.points.length) {
    const a = s.points[s.points.length - 1];
    const [dx, dy] = angle15(pt[0] - a[0], pt[1] - a[1]);
    pt = [a[0] + dx, a[1] + dy];
  }
  return { pt, snap };
}

function drawSnapMark(rec, snap) {
  if (!snap) return;
  const [x, y] = A.toPx(rec)(snap.x, snap.y);
  const p = document.createElementNS(SVGNS, 'path');
  p.setAttribute('class', 'snap-mark');
  p.setAttribute('d', snap.kind === 'end'
    ? `M${x - 6} ${y - 6}h12v12h-12z`
    : `M${x - 6} ${y - 6}l12 12M${x + 6} ${y - 6}l-12 12`);
  rec.gTmp.append(p);
}

// ----------------------------------------------------------------------------- aperçu pendant le tracé
function previewObject(s, pts) {
  const type = s.type;
  const base = (t) => Object.assign(clone(A.defaultsOf(t)), { type: t, page: s.rec.index });
  const line = (p) => Object.assign(base('line'), { points: p });
  const n = pts.length;
  if (n < 2) return null;
  if (type === 'm-calib') return line(pts);
  if (type === 'm-hole') return n >= 3 ? Object.assign(base('polygon'), { points: pts }) : line(pts);
  if (type === 'm-angle' || type === 'm-circle') return n >= 3 ? Object.assign(base(type), { points: pts }) : line(pts);
  if (type === 'm-area') return n >= 3 ? Object.assign(base(type), { points: pts }) : line(pts);
  return Object.assign(base(type), { points: pts });
}

function preview(doc, rec, snap) {
  const s = state(doc);
  const pts = s ? (s.cursor ? [...s.points, s.cursor] : [...s.points]) : [];
  const obj = s && s.rec === rec ? previewObject(s, pts) : null;
  A.setTmp(doc, rec, obj ? { obj } : null);
  drawSnapMark(rec, snap);
}

// ----------------------------------------------------------------------------- création
function addHole(doc, pageIdx, pts) {
  const inside = (poly, p) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  const areas = doc.edits.filter((e) => e.type === 'm-area' && e.page === pageIdx && inside(e.points, pts[0]));
  const target = areas[areas.length - 1];
  if (!target) { toast('Le trou doit commencer à l\'intérieur d\'une surface mesurée.', 4000); return; }
  DocModel.updateEdits(doc, [target.id], (e) => ({ holes: [...(e.holes || []), pts] }));
  A.changed(doc);
}

function finish(doc) {
  const s = state(doc);
  if (!s) return false;
  rt(doc).mx = null;
  A.setTmp(doc, s.rec, null);
  const spec = SPEC[s.type];
  if (s.points.length < (spec.n || spec.min)) return true;
  if (s.type === 'm-calib') { openScale(doc, dist(s.points[0], s.points[1]), s.rec.index); return true; }
  if (s.type === 'm-hole') { addHole(doc, s.rec.index, s.points); return true; }
  const o = Object.assign(clone(A.defaultsOf(s.type)), { type: s.type, page: s.rec.index, points: s.points });
  A.afterCreate(doc, DocModel.addEdit(doc, o));
  A.changed(doc);
  return true;
}

const tool = {
  down(doc, rec, ev) {
    let s = state(doc);
    if (s && s.rec !== rec) return;
    const spec = SPEC[doc.tool];
    const { pt, snap } = pointFor(doc, rec, ev);
    if (!s) s = rt(doc).mx = { rec, type: doc.tool, points: [], cursor: null };
    else if (!spec.n && ev.detail >= 2) { finish(doc); return; } // double-clic : terminer
    const first = s.points[0];
    if (!spec.n && s.points.length >= 3 && first) { // clic sur le 1er point : fermer
      const f = A.toPx(rec)(first[0], first[1]);
      const [lx, ly] = A.localXY(rec, ev);
      if (Math.hypot(f[0] - lx, f[1] - ly) < 9) { finish(doc); return; }
    }
    const last = s.points[s.points.length - 1];
    if (!last || dist(last, pt) > 1e-6) s.points.push(pt);
    if (spec.n && s.points.length >= spec.n) { finish(doc); return; }
    s.cursor = pt;
    preview(doc, rec, snap);
  },
  move(doc, rec, ev) {
    const s = state(doc);
    if (s && s.rec !== rec) return;
    const { pt, snap } = pointFor(doc, rec, ev);
    if (s) s.cursor = pt;
    preview(doc, rec, snap);
  },
  cancel(doc) {
    const s = state(doc);
    if (!s) return false;
    rt(doc).mx = null;
    A.setTmp(doc, s.rec, null);
    return true;
  },
  finish(doc) { return finish(doc); },
};

// ----------------------------------------------------------------------------- échelle et calibrage
let dlg = null; // { doc, page, picked, mode }

function ratioChoice(sc) {
  if (!sc) return null;
  const n = Measure.ratioOf(sc);
  return Number.isFinite(n) ? n : null;
}

function setMode(mode) {
  dlg.mode = mode;
  $('mc-tab-ratio').setAttribute('aria-selected', String(mode === 'ratio'));
  $('mc-tab-pts').setAttribute('aria-selected', String(mode === 'pts'));
  $('mc-ratio').hidden = mode !== 'ratio';
  $('mc-pts').hidden = mode !== 'pts';
}

export function openScale(doc, pickedPt, pageIdx) {
  if (!doc) return;
  const page = pageIdx === undefined ? doc.page : pageIdx;
  dlg = { doc, page, picked: pickedPt || 0, mode: pickedPt ? 'pts' : 'ratio' };
  const sc = doc.measure.scales[page];
  const sel = $('mc-preset');
  sel.replaceChildren();
  for (const n of Measure.PRESETS) { const o = document.createElement('option'); o.value = String(n); o.textContent = String(n); sel.append(o); }
  const other = document.createElement('option'); other.value = 'custom'; other.textContent = 'Autre…'; sel.append(other);
  const cur = ratioChoice(sc);
  if (cur && Measure.PRESETS.includes(Math.round(cur)) && Math.abs(cur - Math.round(cur)) < 1e-6) sel.value = String(Math.round(cur));
  else if (cur) { sel.value = 'custom'; $('mc-custom').value = String(Math.round(cur * 100) / 100); }
  else sel.value = '50';
  $('mc-custom').disabled = sel.value !== 'custom';
  $('mc-all').checked = false;
  $('mc-len').value = '';
  $('mc-picked').textContent = dlg.picked ? `${Measure.fmtNum(dlg.picked * Measure.MM_PER_PT, 1)} mm sur le papier` : 'aucune : utilisez « Tracer deux points… »';
  $('mcdlg-title').textContent = `Échelle de la page ${page + 1}`;
  $('mc-note').textContent = `Échelle actuelle : ${Measure.scaleLabel(sc)}. Une échelle fausse fausse toutes les mesures de la page.`;
  $('mc-clear').disabled = !sc;
  setMode(dlg.mode);
  $('mcdlg').hidden = false;
  (dlg.mode === 'pts' ? $('mc-len') : sel).focus();
}

function closeScale() { $('mcdlg').hidden = true; dlg = null; }

function applyScale(scale) { // scale null : supprime
  const { doc, page } = dlg;
  const pages = $('mc-all').checked ? Array.from({ length: V.pageCount(doc) }, (_, i) => i) : [page];
  DocModel.setMeasure(doc, (m) => {
    const scales = Object.assign({}, m.scales);
    for (const p of pages) { if (scale) scales[p] = scale; else delete scales[p]; }
    return { scales };
  });
  closeScale();
  A.changed(doc);
}

function okScale() {
  if (!dlg) return;
  if (dlg.mode === 'ratio') {
    const n = $('mc-preset').value === 'custom' ? Number($('mc-custom').value) : Number($('mc-preset').value);
    if (!(n > 0)) { toast('Indiquez une échelle valide.', 3000); return; }
    applyScale(Measure.scaleFromRatio(n));
  } else {
    const sc = Measure.scaleFromTwoPoints(dlg.picked, Number($('mc-len').value), $('mc-unit').value);
    if (!sc) { toast(dlg.picked ? 'Indiquez la longueur réelle.' : 'Tracez d\'abord deux points sur le plan.', 3000); return; }
    applyScale(sc);
  }
}

function initScaleDialog() {
  $('mc-tab-ratio').addEventListener('click', () => dlg && setMode('ratio'));
  $('mc-tab-pts').addEventListener('click', () => dlg && setMode('pts'));
  $('mc-preset').addEventListener('change', () => { $('mc-custom').disabled = $('mc-preset').value !== 'custom'; if (!$('mc-custom').disabled) $('mc-custom').focus(); });
  $('mc-ok').addEventListener('click', okScale);
  $('mc-cancel').addEventListener('click', closeScale);
  $('mc-clear').addEventListener('click', () => dlg && applyScale(null));
  $('mc-draw').addEventListener('click', () => { const d = dlg && dlg.doc; closeScale(); if (d) A.setTool(d, 'm-calib'); });
  $('mcdlg').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeScale(); }
    else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); e.stopPropagation(); okScale(); }
    else e.stopPropagation();
  }, true);
  $('scale-label').addEventListener('click', () => openScale(store.active));
}

// ----------------------------------------------------------------------------- réglages d'affichage, persistance
function setDisplay(doc, patch) {
  DocModel.setMeasure(doc, patch);
  A.changed(doc);
}

const measuresOf = (doc) => doc.edits.filter((e) => Measure.isMeasure(e));
const lastSaved = new WeakMap();
function persist(doc) {
  if (!doc || !doc.path || !doc.runtime.mxLoaded) return;
  const data = JSON.stringify({ scales: doc.measure.scales, unit: doc.measure.unit, precision: doc.measure.precision, include: doc.measure.include });
  if (lastSaved.get(doc) === data) return;
  lastSaved.set(doc, data);
  api.measureSave(doc.path, JSON.parse(data));
}
function ensureLoaded(doc) {
  if (!doc || doc.runtime.mxLoaded !== undefined) return;
  doc.runtime.mxLoaded = false;
  const done = (d) => {
    if (d && d.scales) {
      Object.assign(doc.measure, { scales: d.scales, unit: d.unit || doc.measure.unit, precision: d.precision === undefined ? doc.measure.precision : d.precision, include: d.include !== false });
      lastSaved.set(doc, JSON.stringify({ scales: doc.measure.scales, unit: doc.measure.unit, precision: doc.measure.precision, include: doc.measure.include }));
    }
    doc.runtime.mxLoaded = true;
    if (d) { A.renderAll(doc); refresh(); }
  };
  if (!doc.path) { done(null); return; }
  api.measureLoad(doc.path).then(done, () => done(null));
}

// ----------------------------------------------------------------------------- ruban et barre d'état
export function ribbonState(cmd, doc) {
  if (!cmd.startsWith('m-')) return null;
  const sel = doc ? doc.selection.map((id) => DocModel.getEdit(doc, id)).filter((e) => Measure.isMeasure(e)) : [];
  switch (cmd) {
    case 'm-snap': return { disabled: !doc, pressed: Settings.get('snap') !== false };
    case 'm-include': return { disabled: !doc, pressed: !!doc && doc.measure.include !== false };
    case 'm-lock': return { disabled: !sel.length };
    case 'm-panel': return { disabled: !doc, pressed: Sidebar.isOpen() && $('sbtab-measures').getAttribute('aria-selected') === 'true' };
    case 'm-csv': return { disabled: !doc || !measuresOf(doc).length };
    default: return { disabled: !doc };
  }
}

function refresh() {
  const doc = store.active;
  const lab = $('scale-label');
  lab.disabled = !doc;
  if (!doc) { lab.textContent = ''; lab.classList.remove('uncal'); return; }
  const sc = doc.measure.scales[doc.page];
  lab.textContent = 'Échelle : ' + Measure.scaleLabel(sc);
  lab.classList.toggle('uncal', !sc);
  if (document.activeElement !== $('m-unit')) $('m-unit').value = doc.measure.unit;
  if (document.activeElement !== $('m-prec')) $('m-prec').value = String(doc.measure.precision);
  $('m-unit').disabled = $('m-prec').disabled = false;
  renderPanel(doc);
}

function lockSelection(doc) {
  const sel = doc.selection.map((id) => DocModel.getEdit(doc, id)).filter((e) => Measure.isMeasure(e));
  if (!sel.length) { toast('Sélectionnez une mesure.', 2500); return; }
  const unlock = sel.every((e) => e.lockedText);
  DocModel.updateEdits(doc, sel.map((e) => e.id), (e) => ({ lockedText: unlock ? null : Measure.describe(Object.assign({}, e, { label: '', lockedText: null }), doc.measure) }));
  A.changed(doc);
  toast(unlock ? 'Valeur déverrouillée : elle suit à nouveau l\'échelle.' : 'Valeur verrouillée : elle ne suit plus l\'échelle.', 2500);
}

async function exportCsv(doc) {
  const rows = measuresOf(doc).sort((a, b) => a.page - b.page || a.id - b.id).map((e) => Measure.rowOf(e, doc.measure));
  if (!rows.length) { toast('Aucune mesure à exporter.', 3000); return; }
  const name = doc.name.replace(/\.pdf$/i, '') + '-mesures.csv';
  const r = await api.saveText(Measure.CSV_BOM + Measure.toCsv(rows, doc.measure.precision), name, 'Fichier CSV', 'csv');
  if (r && r.saved) toast('Mesures exportées : ' + r.path, 4000);
}

// Commandes du ruban (data-cmd) ; app.js les fusionne dans sa table.
export const commands = {
  'm-scale': () => openScale(store.active),
  'm-snap': () => { Settings.set('snap', Settings.get('snap') === false); bus.emit('view', store.active); },
  'm-include': () => { const d = store.active; if (d) setDisplay(d, { include: d.measure.include === false }); },
  'm-lock': () => { const d = store.active; if (d) lockSelection(d); },
  'm-csv': () => { const d = store.active; if (d) exportCsv(d); },
  'm-panel': () => { Sidebar.showTab('sbtab-measures'); refresh(); },
};

// ----------------------------------------------------------------------------- panneau « Mesures »
const panel = { sort: 'page', dir: 1, type: 'all', onlyPage: false };
const COLS = [['page', 'Page'], ['typeId', 'Type'], ['name', 'Libellé'], ['value', 'Valeur']];
const fmtRow = (r, p) => Measure.fmtNum(r.value, r.kind === 'angle' ? Math.min(p, 2) : p) + ' ' + r.unit + (!r.calibrated && r.kind !== 'angle' && !r.locked ? ' *' : '');

function renderPanel(doc) {
  const el = $('sb-measures');
  if (el.hidden || !doc) return;
  const p = doc.measure.precision;
  let rows = measuresOf(doc).map((e) => Measure.rowOf(e, doc.measure));
  const all = rows;
  if (panel.type !== 'all') rows = rows.filter((r) => r.typeId === panel.type);
  if (panel.onlyPage) rows = rows.filter((r) => r.page === doc.page + 1);
  const key = panel.sort;
  rows.sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * panel.dir || a.id - b.id);
  const root = document.createElement('div');
  root.className = 'm-panel';

  const bar = document.createElement('div');
  bar.className = 'm-bar';
  const sel = document.createElement('select');
  sel.setAttribute('aria-label', 'Filtrer par type');
  for (const [v, t] of [['all', 'Tous les types'], ...Measure.TYPES.map((t) => [t, Measure.LABELS[t]])]) { const o = document.createElement('option'); o.value = v; o.textContent = t; if (v === panel.type) o.selected = true; sel.append(o); }
  sel.addEventListener('change', () => { panel.type = sel.value; renderPanel(store.active); });
  const lab = document.createElement('label');
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.checked = panel.onlyPage;
  cb.addEventListener('change', () => { panel.onlyPage = cb.checked; renderPanel(store.active); });
  lab.append(cb, document.createTextNode(' Page courante'));
  const csv = document.createElement('button');
  csv.type = 'button'; csv.className = 'secondary'; csv.textContent = 'Exporter en CSV'; csv.disabled = !all.length;
  csv.addEventListener('click', () => exportCsv(store.active));
  bar.append(sel, lab, csv);
  root.append(bar);

  if (!rows.length) {
    const m = document.createElement('p');
    m.className = 'muted';
    m.textContent = all.length ? 'Aucune mesure pour ce filtre.' : 'Aucune mesure. Choisissez un outil dans l\'onglet « Mesure » du ruban.';
    root.append(m);
  } else {
    const table = document.createElement('table');
    const head = document.createElement('tr');
    for (const [k, t] of COLS) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = t + (panel.sort === k ? (panel.dir > 0 ? ' ▲' : ' ▼') : '');
      th.tabIndex = 0;
      const go = () => { if (panel.sort === k) panel.dir = -panel.dir; else { panel.sort = k; panel.dir = 1; } renderPanel(store.active); };
      th.addEventListener('click', go);
      th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      head.append(th);
    }
    table.append(head);
    for (const r of rows) {
      const tr = document.createElement('tr');
      tr.className = 'm-row' + (doc.selection.includes(r.id) ? ' sel' : '');
      tr.dataset.id = String(r.id);
      tr.tabIndex = 0;
      const cells = [r.page, r.type, r.name, fmtRow(r, p)];
      cells.forEach((c, i) => { const td = document.createElement('td'); td.textContent = String(c); if (i === 3) td.className = 'num'; tr.append(td); });
      const go = () => { A.setTool(doc, 'select'); A.selectIds(doc, [r.id]); const e = DocModel.getEdit(doc, r.id); if (e) V.goToPage(doc, e.page); bus.emit('doc-changed', doc); };
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      table.append(tr);
    }
    root.append(table);
    const tot = document.createElement('ul');
    tot.className = 'm-tot';
    tot.setAttribute('aria-label', 'Totaux par type');
    for (const t of Measure.totalsByType(rows)) {
      const li = document.createElement('li');
      const a = document.createElement('span'); a.textContent = `${t.type} (${t.count})`;
      const b = document.createElement('strong'); b.textContent = t.kind === 'angle' ? '' : Measure.fmtNum(t.total, p) + ' ' + t.unit;
      li.append(a, b); tot.append(li);
    }
    root.append(tot);
  }
  el.replaceChildren(root);
}

// ----------------------------------------------------------------------------- initialisation
export function initMeasure() {
  for (const t of Object.keys(SPEC)) A.registerTool(t, SPEC[t].label, tool);
  const MT = Measure.TYPES;
  A.FIELDS.push(
    { k: 'label', label: 'Libellé', kind: 'text', empty: true, types: MT },
    { k: 'color', label: 'Couleur', kind: 'color', types: MT },
    { k: 'width', label: 'Épaisseur', kind: 'number', min: 0.5, max: 20, step: 0.5, types: MT },
    { k: 'size', label: 'Taille du texte', kind: 'number', min: 6, max: 48, step: 1, types: MT },
    { k: 'showDelta', label: 'Afficher dX / dY', kind: 'bool', types: ['m-dist'] },
    { k: 'showSegments', label: 'Longueur de chaque segment', kind: 'bool', types: ['m-poly'] },
    { k: 'offset', label: 'Décalage de la cote', kind: 'number', min: -200, max: 200, step: 1, types: ['m-dim'] },
  );
  initScaleDialog();
  $('m-unit').addEventListener('change', () => { const d = store.active; if (d) setDisplay(d, { unit: $('m-unit').value }); });
  $('m-prec').addEventListener('change', () => { const d = store.active; if (d) setDisplay(d, { precision: Number($('m-prec').value) }); });
  $('sbtab-measures').addEventListener('click', () => setTimeout(() => { renderPanel(store.active); bus.emit('view', store.active); }, 0));
  for (const ev of ['doc-changed', 'page', 'tool', 'view']) bus.on(ev, onChange);
  onChange();
}

// Appelé aussi par app.js à chaque rafraîchissement de la barre d'état (ouverture, changement d'onglet…).
export function onChange() { const d = store.active; ensureLoaded(d); refresh(); persist(d); }
