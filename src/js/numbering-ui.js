// Numérotation des pages : boîte de dialogue (liste de règles, formulaire, aperçu en direct sur une page et sur toutes les pages du document).
// La logique est dans src/numbering.js (pur) ; les règles sont dans l'historique du document (DocModel.setNumbering) : une validation = une étape.
import { $, bus, store } from './ui.js';
import * as V from './viewer.js';
import * as A from './annotate.js';

const { DocModel, Numbering: N } = window;

const clone = (o) => JSON.parse(JSON.stringify(o));
const hex = (c) => '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
const unhex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const st = { doc: null, work: [], sel: -1, token: 0, prevKey: '', timer: 0 };

function nextId() { return st.work.reduce((m, r) => Math.max(m, r.id || 0), 0) + 1; }
function addRule(over) {
  const r = N.newRule(Object.assign({ id: nextId() }, over || {}));
  st.work.push(r);
  st.sel = st.work.length - 1;
}

// ----------------------------------------------------------------------------- liste
function drawList() {
  const ul = $('num-list');
  ul.replaceChildren();
  st.work.forEach((r, i) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(i === st.sel));
    li.dataset.idx = String(i);
    if (!r.enabled) li.classList.add('off');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = !!r.enabled; cb.title = 'Activer ou désactiver cette règle'; cb.className = 'num-en';
    cb.setAttribute('aria-label', 'Activer la règle ' + (i + 1));
    const main = document.createElement('div');
    main.className = 'nl-main';
    const name = document.createElement('span');
    name.className = 'nl-name';
    name.textContent = r.name || 'Règle ' + (i + 1);
    const sub = document.createElement('span');
    sub.className = 'muted small';
    sub.textContent = `« ${r.text} » · ${N.summary(r, st.doc.pages)}`;
    main.append(name, sub);
    li.append(cb, main);
    li.addEventListener('click', (e) => { if (e.target === cb) return; st.sel = i; drawList(); loadForm(); schedulePreview(); });
    cb.addEventListener('change', () => { r.enabled = cb.checked; li.classList.toggle('off', !r.enabled); changed(); });
    ul.append(li);
  });
  $('num-form').classList.toggle('disabled', st.sel < 0);
  $('num-dup').disabled = $('num-del').disabled = st.sel < 0;
}

// ----------------------------------------------------------------------------- formulaire
const clampPage = (v) => Math.max(1, Math.min(st.doc.pages.length, Math.round(Number(v) || 1)));
function loadForm() {
  const r = st.work[st.sel];
  const pages = st.doc.pages;
  $('num-form').classList.toggle('disabled', !r);
  if (!r) return;
  const a = r.fromU == null ? 1 : Math.max(1, pages.findIndex((p) => p.u === r.fromU) + 1);
  const b = r.toU == null ? pages.length : Math.max(1, pages.findIndex((p) => p.u === r.toU) + 1);
  $('num-scope').value = r.fromU == null && r.toU == null ? 'all' : r.toU == null ? 'from' : 'range';
  $('num-from').value = a; $('num-to').value = b;
  $('num-from').max = $('num-to').max = pages.length;
  $('num-parity').value = r.parity; $('num-skip').checked = !!r.skipFirst;
  $('num-start').value = r.start; $('num-format').value = r.format; $('num-text').value = r.text; $('num-total').value = r.totalMode;
  $('num-font').value = r.font; $('num-bold').checked = !!r.bold; $('num-italic').checked = !!r.italic;
  $('num-size').value = r.size; $('num-color').value = hex(r.color); $('num-opacity').value = r.opacity;
  $('num-pos').value = r.pos; $('num-mx').value = r.mx; $('num-my').value = r.my; $('num-mirror').checked = !!r.mirror;
  scopeVisibility();
}
function scopeVisibility() {
  const s = $('num-scope').value;
  for (const [id, on] of [['num-from', s !== 'all'], ['num-to', s === 'range']]) {
    $(id).disabled = !on;
    const lab = document.querySelector(`label[for=${id}]`);
    if (lab) lab.style.opacity = on ? '' : '.45';
  }
}
const num = (id, def) => { const v = Number($(id).value); return isFinite(v) && $(id).value !== '' ? v : def; };
function readForm() {
  const r = st.work[st.sel];
  if (!r) return;
  const pages = st.doc.pages;
  const scope = $('num-scope').value;
  r.fromU = scope === 'all' ? null : pages[clampPage(num('num-from', 1)) - 1].u;
  r.toU = scope === 'range' ? pages[clampPage(num('num-to', pages.length)) - 1].u : null;
  delete r.dead;
  r.parity = $('num-parity').value; r.skipFirst = $('num-skip').checked;
  r.start = Math.round(num('num-start', 1)); r.format = $('num-format').value; r.text = $('num-text').value; r.totalMode = $('num-total').value;
  r.font = $('num-font').value; r.bold = $('num-bold').checked; r.italic = $('num-italic').checked;
  r.size = Math.max(4, Math.min(72, num('num-size', 10))); r.color = unhex($('num-color').value); r.opacity = Math.max(0.1, Math.min(1, num('num-opacity', 1)));
  r.pos = $('num-pos').value; r.mx = Math.max(0, num('num-mx', 0)); r.my = Math.max(0, num('num-my', 0)); r.mirror = $('num-mirror').checked;
}

// ----------------------------------------------------------------------------- aperçus
function changed() { schedulePreview(); }
function schedulePreview() {
  clearTimeout(st.timer);
  st.timer = setTimeout(() => { livePreview(); drawPagePreview(); }, 60);
}
function livePreview() {
  const r = st.doc.runtime;
  r.numWork = st.work; r.numWorkVer = (r.numWorkVer || 0) + 1; r.numHide = !$('num-showall').checked;
  A.renderAll(st.doc);
}
async function drawPagePreview() {
  const doc = st.doc;
  const my = ++st.token;
  const pi = Math.max(0, Math.min(doc.pages.length - 1, Math.round(num('num-ppage', doc.page + 1)) - 1));
  const rec = V.getPages(doc)[pi];
  if (!rec) return;
  const base = V.pageViewport(rec, 1, 0);
  const s = Math.min(260 / base.width, 340 / base.height);
  const vp = V.pageViewport(rec, s, 0);
  const canvas = $('num-canvas');
  const key = rec.uid + '|' + rec.sig + '|' + Math.round(s * 1000);
  if (st.prevKey !== key) {
    st.prevKey = key;
    const dpr = window.devicePixelRatio || 1;
    const vpd = V.pageViewport(rec, s * dpr, 0);
    canvas.width = Math.floor(vpd.width); canvas.height = Math.floor(vpd.height);
    canvas.style.width = Math.floor(vp.width) + 'px'; canvas.style.height = Math.floor(vp.height) + 'px';
    try { await rec.page.render({ canvasContext: canvas.getContext('2d'), viewport: vpd }).promise; } catch { /* page détruite */ }
  }
  if (my !== st.token) return;
  const svg = $('num-svg');
  svg.setAttribute('width', String(vp.width)); svg.setAttribute('height', String(vp.height));
  svg.setAttribute('viewBox', `0 0 ${vp.width} ${vp.height}`);
  svg.replaceChildren();
  const items = N.resolve(st.work, doc.pages)[pi] || [];
  const view = { scale: s, rotation: vp.rotation || 0, toPx: (x, y) => vp.convertToViewportPoint(x, y), assets: doc.assets };
  const info = { box: rec.box, rot: ((rec.page.rotate + (rec.desc.rot || 0)) % 360 + 360) % 360, index: pi };
  for (const p of N.primitives(items, info, A.measure)) svg.append(A.primToSvgV(view, p));
  $('num-note').textContent = items.length ? `Page ${pi + 1} : ${items.map((x) => '« ' + x.text + ' »').join(' et ')}` : `Page ${pi + 1} : aucune numérotation.`;
}

// ----------------------------------------------------------------------------- ouverture / fermeture
export function open(doc) {
  if (!doc || !doc.pages) return;
  A.closeEditor(doc, true);
  st.doc = doc; st.work = clone(doc.numbering); st.sel = st.work.length ? 0 : -1; st.prevKey = '';
  if (!st.work.length) addRule({ name: '' });
  $('num-showall').checked = !doc.runtime.numHide;
  $('num-ppage').max = doc.pages.length;
  $('num-ppage').value = Math.min(doc.pages.length, (doc.page || 0) + 1);
  $('numdlg').hidden = false;
  drawList(); loadForm(); livePreview(); drawPagePreview();
  $('num-text').focus();
}
function close(apply) {
  const doc = st.doc;
  if (!doc) return;
  clearTimeout(st.timer);
  $('numdlg').hidden = true;
  const r = doc.runtime;
  r.numWork = null; r.numHide = !$('num-showall').checked;
  if (apply && JSON.stringify(st.work) !== JSON.stringify(doc.numbering)) DocModel.setNumbering(doc, st.work);
  st.doc = null; st.token++;
  A.changed(doc);
}
export function togglePreview(doc) { doc.runtime.numHide = !doc.runtime.numHide; A.changed(doc); }
export const isOpen = () => !$('numdlg').hidden;

export function init() {
  $('num-format').replaceChildren(...N.FORMATS.map(([v, t]) => Object.assign(document.createElement('option'), { value: v, textContent: t })));
  $('num-pos').replaceChildren(...N.POSITIONS.map(([v, t]) => Object.assign(document.createElement('option'), { value: v, textContent: t })));
  const dlg = $('numdlg');
  const onForm = () => { scopeVisibility(); readForm(); drawList(); changed(); };
  $('num-form').addEventListener('input', onForm);
  $('num-form').addEventListener('change', onForm);
  $('num-ppage').addEventListener('input', () => { st.prevKey = ''; schedulePreview(); });
  $('num-showall').addEventListener('change', () => { livePreview(); });
  $('num-add').addEventListener('click', () => { addRule(); drawList(); loadForm(); changed(); $('num-text').focus(); });
  $('num-dup').addEventListener('click', () => {
    const r = st.work[st.sel];
    if (!r) return;
    const c = clone(r); c.id = nextId(); c.name = (r.name || 'Règle ' + (st.sel + 1)) + ' (copie)';
    st.work.splice(st.sel + 1, 0, c); st.sel += 1;
    drawList(); loadForm(); changed();
  });
  $('num-del').addEventListener('click', () => {
    if (st.sel < 0) return;
    st.work.splice(st.sel, 1);
    st.sel = Math.min(st.sel, st.work.length - 1);
    drawList(); loadForm(); changed();
  });
  $('num-cancel').addEventListener('click', () => close(false));
  $('num-ok').addEventListener('click', () => close(true));
  dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); } }, true);
}
