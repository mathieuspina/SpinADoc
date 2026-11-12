// Tampons, images et signatures : bibliothèque (dossier userData), menus du ruban, boîtes de création, insertion d'images.
import { $, api, bus, store, toast, askChoice } from './ui.js';
import * as A from './annotate.js';
import * as Settings from './settings.js';

const { Shapes } = window;
const MAX_SIDE = 4000; // au-delà, on propose de réduire l'image

let library = [];
const urlCache = new Map();
const blobUrl = (e) => {
  if (!e.bytes) return '';
  if (!urlCache.has(e.id)) urlCache.set(e.id, URL.createObjectURL(new Blob([e.bytes], { type: e.mime || 'image/png' })));
  return urlCache.get(e.id);
};

export async function loadLibrary() {
  library = await api.libList();
  for (const [id, u] of urlCache) if (!library.some((e) => e.id === id)) { URL.revokeObjectURL(u); urlCache.delete(id); }
}
export const getLibrary = () => library;

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const hex = (c) => '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
const unhex = (h) => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const active = () => store.active;

// ====================================================================== images : lecture, réduction, pose
async function decode(bytes, mime) {
  const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
  return { bmp, w: bmp.width, h: bmp.height };
}
const canvasBytes = (canvas, mime) => new Promise((res) => canvas.toBlob(async (b) => res(new Uint8Array(await b.arrayBuffer())), mime, 0.92));

// { name, mime, bytes } → { mime, bytes, w, h } (réduit si > 4000 px et si l'utilisateur l'accepte) ou null (annulé / illisible)
export async function prepareImage(file) {
  let mime = /png/i.test(file.mime) ? 'image/png' : 'image/jpeg';
  let d;
  try { d = await decode(file.bytes, mime); } catch { toast(`« ${file.name} » : image illisible (PNG ou JPEG attendu).`); return null; }
  let { bytes } = file;
  let { w, h } = d;
  if (Math.max(w, h) > MAX_SIDE) {
    const choice = await askChoice({
      title: 'Image très grande',
      message: `Cette image fait ${w} × ${h} px. La réduire à ${MAX_SIDE} px de côté garde un PDF raisonnable.`,
      buttons: [{ id: 'reduce', label: `Réduire à ${MAX_SIDE} px`, primary: true }, { id: 'keep', label: 'Garder la taille d\'origine' }, { id: 'cancel', label: 'Annuler' }],
    });
    if (choice === 'cancel') return null;
    if (choice === 'reduce') {
      const k = MAX_SIDE / Math.max(w, h);
      const c = document.createElement('canvas');
      c.width = Math.round(w * k); c.height = Math.round(h * k);
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(d.bmp, 0, 0, c.width, c.height);
      bytes = await canvasBytes(c, mime);
      w = c.width; h = c.height;
    }
  }
  return { mime, bytes, w, h, name: file.name };
}

// Pose immédiate (glisser-déposer, Ctrl+V) : au point donné, ou au centre de la zone visible.
export async function placeImageFile(doc, file, where) {
  const img = await prepareImage(file);
  if (!img) return false;
  const id = await A.addImageAsset(doc, img);
  const target = (where && A.pageAt(doc, where.x, where.y)) || A.viewCenter(doc);
  A.placeAt(doc, target.rec, target.pt, { kind: 'image', imgId: id });
  return true;
}

// « Image » du ruban : choisit un fichier puis l'outil de pose reste actif (un clic = une image).
export async function insertImage() {
  const doc = active();
  if (!doc) return;
  const files = await api.openImages();
  if (!files.length) return;
  const img = await prepareImage(files[0]);
  if (!img) return;
  const id = await A.addImageAsset(doc, img);
  A.startPlacing(doc, { tool: 'image', kind: 'image', imgId: id });
  toast('Cliquez sur la page pour poser l\'image (Échap pour terminer).', 3500);
}

// Ctrl+V : image du presse-papiers (si nouvelle) sinon objets copiés dans l'application.
let lastClipHash = null;
export async function markInternalCopy() { // après une copie d'objets : l'image encore présente dans le presse-papiers est « ancienne »
  const f = await api.clipboardImage();
  lastClipHash = f ? await hashOf(f.bytes) : null;
}
const hashOf = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', bytes))).slice(0, 8).map((b) => b.toString(16)).join('');
export async function pasteFromClipboard(doc) {
  const f = await api.clipboardImage();
  if (f) {
    const h = await hashOf(f.bytes);
    if (h !== lastClipHash) { lastClipHash = h; await placeImageFile(doc, f); return; }
  }
  A.paste(doc);
}

export async function dropImages(doc, files, x, y) {
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    await placeImageFile(doc, { name: f.name, mime: f.type || (/\.png$/i.test(f.name) ? 'image/png' : 'image/jpeg'), bytes }, { x, y });
  }
}

// ====================================================================== menus du ruban
function menuEl() { return $('lib-menu'); }
let menuKind = null;
export function closeMenu() { menuEl().hidden = true; menuKind = null; document.querySelectorAll('[data-cmd=stamps-menu],[data-cmd=sig-menu]').forEach((b) => b.setAttribute('aria-expanded', 'false')); }

function thumbOf(e, w, h) {
  if (e.kind === 'stamp-text') return A.thumbSvg(A.stampObject({ label: e.label, color: e.color, frame: e.frame !== false }), w, h);
  if (e.kind === 'sig-ink') return A.thumbSvg({ type: 'sig', cx: 0, cy: 0, w: e.w, h: e.h, w0: e.w, lw: e.lw, strokes: e.strokes, color: e.color, rot: 0 }, w, h);
  const img = el('img', 'lib-img');
  img.src = blobUrl(e);
  img.alt = '';
  return img;
}

function libRow(e, onPick, kindLabel) {
  const row = el('div', 'lib-row');
  const pick = el('button', 'lib-pick');
  pick.type = 'button';
  pick.title = `${e.name} — cliquer pour poser`;
  const th = el('span', 'lib-thumb');
  th.append(thumbOf(e, 120, 40));
  const name = el('span', 'lib-name', e.name);
  pick.append(th, name);
  pick.addEventListener('click', () => onPick(e));
  const ren = el('button', 'icon-btn small', '');
  ren.type = 'button';
  ren.setAttribute('aria-label', `Renommer « ${e.name} »`);
  ren.title = 'Renommer';
  ren.innerHTML = '';
  const ri = el('span', 'ico'); ri.dataset.icon = 'pencil'; ren.append(ri);
  ren.addEventListener('click', () => {
    const inp = el('input', 'lib-rename');
    inp.type = 'text'; inp.value = e.name; inp.maxLength = 60;
    name.replaceWith(inp); inp.focus(); inp.select();
    let done = false;
    const commit = async (ok) => { if (done) return; done = true; if (ok && inp.value.trim()) await api.libRename(e.id, inp.value.trim()); await loadLibrary(); refreshMenu(); };
    inp.addEventListener('keydown', (k) => { k.stopPropagation(); if (k.key === 'Enter') commit(true); else if (k.key === 'Escape') commit(false); });
    inp.addEventListener('blur', () => commit(true));
  });
  const del = el('button', 'icon-btn small');
  del.type = 'button';
  del.setAttribute('aria-label', `Supprimer « ${e.name} »`);
  del.title = 'Supprimer de la bibliothèque';
  const di = el('span', 'ico'); di.dataset.icon = 'trash-2'; del.append(di);
  del.addEventListener('click', async () => { await api.libRemove(e.id); await loadLibrary(); refreshMenu(); });
  row.append(pick, ren, del);
  return row;
}

function checkbox(label, key, onChange) {
  const l = el('label', 'chk');
  const c = el('input'); c.type = 'checkbox'; c.checked = !!Settings.get(key);
  c.addEventListener('change', () => { Settings.set(key, c.checked); if (onChange) onChange(c.checked); });
  l.append(c, document.createTextNode(' ' + label));
  return l;
}

async function pickStamp(stampParams) {
  const doc = active();
  if (!doc) return;
  closeMenu();
  A.startPlacing(doc, {
    tool: 'stamp', kind: 'stamp',
    stamp: { label: stampParams.label, color: stampParams.color, frame: stampParams.frame !== false, withDate: !!Settings.get('stampDate'), withUser: !!Settings.get('stampUser'), tilt: !!Settings.get('stampTilt') },
  });
}

async function pickLibImage(e, tool, extra) {
  const doc = active();
  if (!doc) return;
  closeMenu();
  const id = await A.addImageAsset(doc, { mime: e.mime || 'image/png', bytes: e.bytes, w: e.w, h: e.h });
  A.startPlacing(doc, Object.assign({ tool, kind: 'image', imgId: id }, extra));
}

function buildStampsMenu(m) {
  m.append(el('div', 'menu-title', 'Tampons prédéfinis'));
  const grid = el('div', 'lib-grid');
  for (const s of Shapes.STAMPS) {
    const b = el('button', 'lib-cell'); b.type = 'button'; b.title = s.label;
    b.append(A.thumbSvg(A.stampObject({ label: s.label, color: s.color }), 150, 46));
    b.addEventListener('click', () => pickStamp(s));
    grid.append(b);
  }
  m.append(grid);
  const mine = library.filter((e) => e.kind === 'stamp-text' || e.kind === 'stamp-image');
  m.append(el('div', 'menu-title', 'Mes tampons'));
  if (!mine.length) m.append(el('div', 'menu-empty', 'Aucun tampon personnalisé.'));
  for (const e of mine) m.append(libRow(e, (x) => (x.kind === 'stamp-text' ? pickStamp(x) : pickLibImage(x, 'image', { maxFrac: 0.3 }))));
  const opts = el('div', 'lib-opts');
  opts.append(checkbox('Date', 'stampDate', () => syncStampDefaults()), checkbox('Nom', 'stampUser', () => syncStampDefaults()), checkbox('Incliné', 'stampTilt', () => syncStampDefaults()));
  m.append(opts);
  const create = el('button', 'secondary lib-create', 'Créer un tampon…');
  create.type = 'button';
  create.addEventListener('click', () => { closeMenu(); openStampDialog(); });
  m.append(create);
}

function syncStampDefaults() {
  Object.assign(A.defaultsOf('stamp'), { withDate: !!Settings.get('stampDate'), withUser: !!Settings.get('stampUser'), tilt: !!Settings.get('stampTilt') });
}

function buildSigMenu(m) {
  m.append(el('div', 'menu-title', 'Mes signatures'));
  const mine = library.filter((e) => e.kind === 'sig-ink' || e.kind === 'sig-image');
  if (!mine.length) m.append(el('div', 'menu-empty', 'Aucune signature enregistrée.'));
  for (const e of mine) {
    m.append(libRow(e, (x) => {
      const doc = active();
      if (!doc) return;
      if (x.kind === 'sig-ink') { closeMenu(); A.startPlacing(doc, { tool: 'signature', kind: 'sig', strokes: x.strokes, w: x.w, h: x.h, lw: x.lw, color: x.color, withDate: !!Settings.get('sigDate') }); } else pickLibImage(x, 'signature', { maxFrac: 0.3, withDate: !!Settings.get('sigDate') });
    }));
  }
  const opts = el('div', 'lib-opts');
  opts.append(checkbox('Ajouter la date à côté', 'sigDate'));
  m.append(opts);
  const create = el('button', 'secondary lib-create', 'Nouvelle signature…');
  create.type = 'button';
  create.addEventListener('click', () => { closeMenu(); openSigDialog(); });
  m.append(create);
  m.append(el('p', 'menu-note', 'Une signature posée est une image figée dans la page : ce n\'est pas une signature électronique qualifiée ou certifiée (aucune valeur juridique de signature numérique).'));
}

function refreshMenu() { if (menuKind) openMenu(menuKind, $('lib-menu')._anchor, true); }

export function openMenu(kind, anchor, force) {
  const m = menuEl();
  if (!force && !m.hidden && menuKind === kind && m._anchor === anchor) return closeMenu();
  m.replaceChildren();
  m._anchor = anchor;
  menuKind = kind;
  if (kind === 'stamps') buildStampsMenu(m); else buildSigMenu(m);
  const r = anchor.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 400)) + 'px';
  m.style.top = r.bottom + 6 + 'px';
  m.hidden = false;
  anchor.setAttribute('aria-expanded', 'true');
}

// ====================================================================== boîte « Créer un tampon »
let stampImg = null; // { mime, bytes, w, h }
function openStampDialog() {
  const d = $('stampdlg');
  stampImg = null;
  $('sd-label').value = 'Mon tampon';
  $('sd-color').value = '#1a8c33';
  $('sd-frame').checked = true;
  $('sd-name').value = '';
  $('sd-picked').textContent = '';
  setStampTab('text');
  d.hidden = false;
  $('sd-label').focus();
  renderStampPreview();
}
function setStampTab(t) {
  $('sd-tab-text').setAttribute('aria-selected', String(t === 'text'));
  $('sd-tab-img').setAttribute('aria-selected', String(t === 'img'));
  $('sd-text').hidden = t !== 'text';
  $('sd-img').hidden = t !== 'img';
  $('stampdlg')._tab = t;
  renderStampPreview();
}
function renderStampPreview() {
  const box = $('sd-preview');
  box.replaceChildren();
  if ($('stampdlg')._tab === 'img') {
    if (stampImg) { const i = el('img', 'lib-img big'); i.src = URL.createObjectURL(new Blob([stampImg.bytes], { type: stampImg.mime })); i.alt = ''; box.append(i); } else box.append(el('span', 'muted', 'Choisissez une image PNG ou JPEG.'));
  } else {
    box.append(A.thumbSvg(A.stampObject({ label: $('sd-label').value || ' ', color: unhex($('sd-color').value), frame: $('sd-frame').checked }), 360, 110));
  }
}
async function saveStamp() {
  const doc = active();
  const name = $('sd-name').value.trim() || ($('stampdlg')._tab === 'img' ? (stampImg && stampImg.name) || 'Tampon image' : $('sd-label').value.trim() || 'Tampon');
  let entry;
  if ($('stampdlg')._tab === 'img') {
    if (!stampImg) return toast('Choisissez d\'abord une image.');
    entry = await api.libAdd({ kind: 'stamp-image', name, mime: stampImg.mime, ext: stampImg.mime === 'image/png' ? 'png' : 'jpg', w: stampImg.w, h: stampImg.h }, stampImg.bytes);
  } else {
    if (!$('sd-label').value.trim()) return toast('Saisissez le texte du tampon.');
    entry = await api.libAdd({ kind: 'stamp-text', name, label: $('sd-label').value.trim(), color: unhex($('sd-color').value), frame: $('sd-frame').checked });
  }
  $('stampdlg').hidden = true;
  await loadLibrary();
  if (doc) {
    const e = library.find((x) => x.id === entry.id);
    if (e.kind === 'stamp-text') pickStamp(e); else pickLibImage(e, 'image', { maxFrac: 0.3 });
  }
}

// ====================================================================== boîte « Nouvelle signature »
const SIG_FONTS = [['Caveat', '700'], ['Dancing Script', '700'], ['Homemade Apple', '400']]; // [famille, graisse] (OFL, embarquées dans vendor/fonts)
const sig = { tab: 'draw', strokes: [], img: null };

function sigColor() { return $('sg-color').value; }

function redrawPad() {
  const c = $('sg-canvas');
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.strokeStyle = sigColor(); g.lineWidth = 3; g.lineCap = 'round'; g.lineJoin = 'round';
  for (const s of sig.strokes) {
    const pts = s.length === 1 ? [s[0], [s[0][0] + 0.01, s[0][1]]] : Shapes.smooth(s, 1, 2);
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
    g.stroke();
  }
}

function setSigTab(t) {
  sig.tab = t;
  for (const id of ['draw', 'import', 'type']) {
    $('sg-tab-' + id).setAttribute('aria-selected', String(id === t));
    $('sg-' + id).hidden = id !== t;
  }
  if (t === 'type') renderTyped();
}

async function cropToPng(canvas) { // recadre sur le contenu non transparent
  const g = canvas.getContext('2d');
  const d = g.getImageData(0, 0, canvas.width, canvas.height).data;
  let x0 = canvas.width, y0 = canvas.height, x1 = -1, y1 = -1;
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (d[(y * canvas.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const pad = 6;
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1 + 2 * pad; out.height = y1 - y0 + 1 + 2 * pad;
  out.getContext('2d').drawImage(canvas, x0, y0, x1 - x0 + 1, y1 - y0 + 1, pad, pad, x1 - x0 + 1, y1 - y0 + 1);
  return { canvas: out, bytes: await canvasBytes(out, 'image/png'), w: out.width, h: out.height };
}

async function renderTyped() {
  const [family, weight] = SIG_FONTS.find((f) => f[0] === $('sg-font').value) || SIG_FONTS[0];
  const text = $('sg-text').value || ' ';
  const size = 140;
  const font = `${weight} ${size}px "${family}"`;
  await document.fonts.load(font, text);
  const c = document.createElement('canvas');
  const g0 = c.getContext('2d');
  g0.font = font;
  c.width = Math.ceil(g0.measureText(text).width) + 80;
  c.height = Math.round(size * 1.8);
  const g = c.getContext('2d');
  g.font = font;
  g.fillStyle = sigColor();
  g.textBaseline = 'alphabetic';
  g.fillText(text, 40, size * 1.25);
  sig.img = await cropToPng(c);
  const prev = $('sg-type-prev');
  prev.replaceChildren();
  if (sig.img) { sig.img.canvas.className = 'sig-prev-canvas'; prev.append(sig.img.canvas); }
}

async function importSigImage() {
  const files = await api.openImages();
  if (!files.length) return;
  const { bmp } = await decode(files[0].bytes, /png/i.test(files[0].mime) ? 'image/png' : 'image/jpeg');
  const k = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, c.width, c.height);
  // détourage simple du fond blanc : le blanc devient transparent, dégradé doux jusqu'au gris clair
  const im = g.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < im.data.length; i += 4) {
    const lum = 0.299 * im.data[i] + 0.587 * im.data[i + 1] + 0.114 * im.data[i + 2];
    const a = lum >= 240 ? 0 : lum <= 190 ? 255 : Math.round(((240 - lum) / 50) * 255);
    im.data[i + 3] = Math.min(im.data[i + 3], a);
  }
  g.putImageData(im, 0, 0);
  sig.img = await cropToPng(c);
  const prev = $('sg-import-prev');
  prev.replaceChildren();
  if (sig.img) { sig.img.canvas.className = 'sig-prev-canvas'; prev.append(sig.img.canvas); } else prev.append(el('span', 'muted', 'Aucun tracé détecté dans cette image.'));
}

function openSigDialog() {
  sig.strokes = []; sig.img = null; sig.tab = 'draw';
  $('sg-name').value = '';
  $('sg-text').value = '';
  $('sg-import-prev').replaceChildren(el('span', 'muted', 'Choisissez une image (photo ou scan de votre signature).'));
  setSigTab('draw');
  redrawPad();
  $('sigdlg').hidden = false;
  $('sg-canvas').focus();
}

async function saveSig() {
  const doc = active();
  let entry, bytes = null;
  const name = $('sg-name').value.trim() || 'Signature';
  if (sig.tab === 'draw') {
    const pts = sig.strokes.flat();
    if (!pts.length) return toast('Dessinez d\'abord votre signature dans le cadre.');
    const x0 = Math.min(...pts.map((p) => p[0])) - 4, x1 = Math.max(...pts.map((p) => p[0])) + 4;
    const y0 = Math.min(...pts.map((p) => p[1])) - 4, y1 = Math.max(...pts.map((p) => p[1])) + 4;
    const bw = Math.max(10, x1 - x0), bh = Math.max(10, y1 - y0);
    const W = 150; // largeur de référence (pt)
    const strokes = sig.strokes.map((s) => (s.length === 1 ? s : Shapes.smooth(s, 1, 2)).map((p) => [(p[0] - x0) / bw, 1 - (p[1] - y0) / bh]));
    entry = await api.libAdd({ kind: 'sig-ink', name, strokes, w: W, h: (W * bh) / bw, lw: 3 * (W / bw), color: unhex(sigColor()) });
  } else {
    if (!sig.img) return toast(sig.tab === 'type' ? 'Saisissez votre nom.' : 'Choisissez d\'abord une image.');
    entry = await api.libAdd({ kind: 'sig-image', name, mime: 'image/png', ext: 'png', w: sig.img.w, h: sig.img.h }, sig.img.bytes);
  }
  $('sigdlg').hidden = true;
  await loadLibrary();
  const e = library.find((x) => x.id === entry.id);
  if (doc && e) {
    if (e.kind === 'sig-ink') A.startPlacing(doc, { tool: 'signature', kind: 'sig', strokes: e.strokes, w: e.w, h: e.h, lw: e.lw, color: e.color, withDate: !!Settings.get('sigDate') });
    else await pickLibImage(e, 'signature', { maxFrac: 0.3, withDate: !!Settings.get('sigDate') });
  }
}

// ====================================================================== branchements
export function initStamps() {
  // onglets des boîtes
  $('sd-tab-text').addEventListener('click', () => setStampTab('text'));
  $('sd-tab-img').addEventListener('click', () => setStampTab('img'));
  ['sd-label', 'sd-color', 'sd-frame'].forEach((id) => $(id).addEventListener('input', renderStampPreview));
  $('sd-pick').addEventListener('click', async () => {
    const f = (await api.openImages())[0];
    if (!f) return;
    const img = await prepareImage(f);
    if (!img) return;
    stampImg = img;
    $('sd-picked').textContent = `${f.name} (${img.w} × ${img.h})`;
    renderStampPreview();
  });
  $('sd-cancel').addEventListener('click', () => { $('stampdlg').hidden = true; });
  $('sd-save').addEventListener('click', saveStamp);

  for (const t of ['draw', 'import', 'type']) $('sg-tab-' + t).addEventListener('click', () => setSigTab(t));
  $('sg-clear').addEventListener('click', () => { sig.strokes = []; redrawPad(); });
  $('sg-color').addEventListener('input', () => { redrawPad(); if (sig.tab === 'type') renderTyped(); });
  $('sg-text').addEventListener('input', renderTyped);
  $('sg-font').addEventListener('change', renderTyped);
  $('sg-pick').addEventListener('click', importSigImage);
  $('sg-cancel').addEventListener('click', () => { $('sigdlg').hidden = true; });
  $('sg-save').addEventListener('click', saveSig);
  // tracé à la souris
  const cv = $('sg-canvas');
  const pos = (e) => { const r = cv.getBoundingClientRect(); return [((e.clientX - r.left) * cv.width) / r.width, ((e.clientY - r.top) * cv.height) / r.height]; };
  cv.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const s = [pos(e)];
    sig.strokes.push(s);
    const move = (m) => { s.push(pos(m)); redrawPad(); };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); redrawPad(); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    redrawPad();
  });
  for (const id of ['stampdlg', 'sigdlg']) {
    $(id).addEventListener('mousedown', (e) => { if (e.target === $(id)) $(id).hidden = true; });
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); $(id).hidden = true; } });
  }

  // ruban
  document.addEventListener('mousedown', (e) => {
    if (!menuEl().hidden && !e.target.closest('#lib-menu') && !e.target.closest('[data-cmd=stamps-menu],[data-cmd=sig-menu]')) closeMenu();
  });
  syncStampDefaults();
  return loadLibrary();
}
