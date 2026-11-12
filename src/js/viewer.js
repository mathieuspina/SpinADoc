// Affichage et édition d'un document : pages, zoom, modes d'affichage, couche de texte, calques d'édition.
// Tout l'état d'un document vit dans `doc` (voir src/doc-model.js) ; le non-sérialisable est dans doc.runtime.
import * as pdfjsLib from '../../vendor/pdfjs/pdf.mjs';
import { $, bus, store } from './ui.js';
import { loadPdf } from './pdfjs-load.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.mjs', import.meta.url).href;
const CMAP_URL = new URL('../../vendor/pdfjs/cmaps/', import.meta.url).href;
const FONT_URL = new URL('../../vendor/pdfjs/standard_fonts/', import.meta.url).href;

const { DocModel, PdfEdit, PageOps } = window;

export const OPS = pdfjsLib.OPS; // codes d'opérateurs PDF.js (aimantation des mesures)
export const CSS_100 = 4 / 3; // 100 % = 96 dpi
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 5;
const BASELINE_K = 0.9465; // ligne de base dans une ligne de 1,2 × la taille (Helvetica/Arial)
const GAP = 14;
const PAD = 18;
export const ROTATED_MSG = 'Les pages pivotées (ou l\'affichage pivoté) ne sont pas encore gérées pour l\'édition de texte.';

// Points d'accroche remplis par annotate.js (objets d'annotation) et app.js (notifications).
export const hooks = {
  toast: () => {},
  pageBuilt: () => {},   // (doc, rec) : une page vient d'être créée
  beforeScale: () => {}, // (doc) : le zoom / la rotation va changer
  renderAll: () => {},   // (doc) : redessiner tous les calques d'annotation
};

const mk = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
const cssColor = (c) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
const rt = (doc) => doc.runtime;

// PDF.js sur des octets quelconques (aperçu et rasterisation de l'impression) ; les octets fournis ne sont pas consommés.
export { loadPdf };

// =====================================================================  ouverture / fermeture
export async function openDocument(doc) {
  const pdf = await pdfjsLib.getDocument({
    data: doc.bytes.slice(), // pdf.js « consomme » le buffer : on garde l'original intact
    cMapUrl: CMAP_URL, cMapPacked: true, standardFontDataUrl: FONT_URL, isEvalSupported: false,
  }).promise;
  const r = rt(doc);
  r.pdf = pdf;
  r.srcPdfs = { 0: Promise.resolve(pdf) }; // sources de pages : { [src]: Promise<PDFDocumentProxy> } ('0' = le fichier ouvert)
  r.proxies = new Map();
  r.pages = [];
  if (!doc.pages) { const id = PageOps.identity(pdf.numPages); DocModel.initPages(doc, id.pages, id.nextUid); }
  r.editor = null;
  r.scrollTop = 0;
  r.highlights = null;

  r.view = mk('div', 'docview tool-select');
  r.viewer = mk('div', 'viewer');
  r.pagesEl = mk('div', 'pages');
  r.viewer.append(r.pagesEl);
  r.view.append(r.viewer);
  $('docs').append(r.view);

  const proxies = await Promise.all(doc.pages.map((d) => pageProxy(doc, d.src, d.i)));

  r.observer = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const rec = r.pages[Number(en.target.dataset.index)];
      if (!rec) continue;
      rec.visible = en.isIntersecting;
      if (en.isIntersecting) { if (!rec.rendered) { rec.div.classList.add('loading'); renderPage(doc, rec); } } else unrenderPage(rec);
    }
  }, { root: r.viewer, rootMargin: '800px 0px' });

  proxies.forEach((page, index) => {
    const rec = makeRec(doc, doc.pages[index], page, index);
    r.pagesEl.append(rec.div);
    r.pages.push(rec);
    hooks.pageBuilt(doc, rec);
  });

  let scrollRaf = 0;
  r.viewer.addEventListener('scroll', () => {
    if (r.view.classList.contains('active') && r.viewer.clientHeight) r.scrollTop = r.viewer.scrollTop;
    cancelAnimationFrame(scrollRaf);
    scrollRaf = requestAnimationFrame(() => updateCurrentPage(doc));
  });
  r.wheelLockUntil = 0;
  r.lastWheelT = 0;
  r.gestureScrolled = false;
  r.viewer.addEventListener('wheel', (ev) => {
    if (ev.ctrlKey) { // Ctrl+molette : zoom (tous les modes)
      ev.preventDefault();
      setZoom(doc, doc.view.zoom * (ev.deltaY < 0 ? 1.1 : 1 / 1.1), ev);
      return;
    }
    if (doc.view.mode === 'single') onSingleWheel(doc, ev);
  }, { passive: false });

  let roTimer = 0;
  r.resizeObs = new ResizeObserver(() => {
    if (!r.view.classList.contains('active') || !r.viewer.clientWidth) return;
    clearTimeout(roTimer);
    roTimer = setTimeout(() => { if (doc.view.fit) fit(doc, doc.view.fit); refreshVisible(doc); }, 80);
  });
  r.resizeObs.observe(r.viewer);

  // Rendu initial : le document devient visible, ajusté à la largeur (sans dépasser 100 %).
  activateDoc(doc);
  applyMode(doc);
  applyScale(doc);
  fit(doc, 'width', CSS_100);
  doc.view.fit = null;
  r.pages.forEach((rec) => { rec.div.dataset.obs = '1'; r.observer.observe(rec.div); });
  updateCurrentPage(doc);
}

// Page (proxy PDF.js) d'une source de pages : le fichier ouvert, une page vierge (générée) ou un PDF inséré. Mis en cache.
function srcPdf(doc, id) {
  const r = rt(doc);
  if (!r.srcPdfs[id]) {
    r.srcPdfs[id] = (async () => {
      const b = PageOps.parseBlank(id);
      if (b) {
        const d = await window.PDFLib.PDFDocument.create();
        d.addPage([b.w, b.h]);
        return loadPdf(await d.save());
      }
      const src = doc.sources[id];
      if (!src) throw new Error('Source de pages introuvable : ' + id);
      return loadPdf(src.bytes);
    })();
  }
  return r.srcPdfs[id];
}
function pageProxy(doc, src, i) {
  const r = rt(doc);
  const key = src + '|' + i;
  if (!r.proxies.has(key)) r.proxies.set(key, srcPdf(doc, src).then((p) => p.getPage(i + 1)));
  return r.proxies.get(key);
}

function makeRec(doc, desc, page, index) {
  const div = mk('div', 'page');
  div.dataset.index = index;
  const canvas = mk('canvas');
  const textLayer = mk('div', 'textLayer');
  const searchLayer = mk('div', 'searchLayer');
  const overlay = mk('div', 'overlay');
  const hl = mk('div', 'hover-hl');
  hl.hidden = true;
  const spinner = mk('img', 'spinner page-spinner');
  spinner.src = 'assets/logo-mark.svg';
  spinner.alt = '';
  div.append(spinner, canvas, textLayer, searchLayer, overlay);
  return {
    index, uid: desc.u, desc, sig: descSig(desc), srcKey: desc.src + '|' + desc.i, page, div, canvas, textLayer, searchLayer, overlay, hl,
    vp: null, bw: 0, bh: 0, rendered: false, visible: false, token: 0, renderTask: null, tlTask: null,
    rotated: false, itemsPromise: null, allItems: null, box: null,
  };
}
const descSig = (d) => d.src + ':' + d.i + '|' + d.rot + '|' + (d.crop ? d.crop.join(',') : '');

// Rotation (degrés, horaire) de la page affichée : /Rotate de la source + rotation ajoutée + rotation d'affichage (indépendante du fichier).
// Cadre : le recadrage ajouté, sinon la zone visible de la page (CropBox ∩ MediaBox).
export const pageBox = (rec) => {
  const c = rec.desc.crop;
  const v = rec.page.view;
  return c ? [Math.max(c[0], v[0]), Math.max(c[1], v[1]), Math.min(c[2], v[2]), Math.min(c[3], v[3])] : v.slice();
};
export function pageViewport(rec, scale, viewRotation) {
  const rotation = (rec.page.rotate + (rec.desc.rot || 0) + (viewRotation || 0)) % 360;
  const base = rec.page.getViewport({ scale, rotation });
  if (!rec.desc.crop) return base;
  return new base.constructor({ viewBox: pageBox(rec), userUnit: base.userUnit, scale, rotation, offsetX: 0, offsetY: 0 });
}

export function closeDocument(doc) {
  const r = rt(doc);
  if (r.observer) r.observer.disconnect();
  if (r.resizeObs) r.resizeObs.disconnect();
  (r.pages || []).forEach(unrenderPage);
  if (r.pdf) r.pdf.destroy();
  for (const a of Object.values(doc.assets.images)) URL.revokeObjectURL(a.url);
  if (r.view) r.view.remove();
  doc.runtime = {};
}

// Affiche le document actif, masque les autres.
export function activateDoc(doc) {
  for (const d of store.docs) if (d.runtime.view) d.runtime.view.classList.toggle('active', d === doc);
  if (!doc) return;
  const r = rt(doc);
  if (r.viewer) {
    // Remesure, restaure la position de défilement et force le rendu des pages visibles.
    r.viewer.scrollTop = r.scrollTop || 0;
    const kind = doc.view.fit;
    requestAnimationFrame(() => {
      if (kind && doc.view.fit === kind) fit(doc, kind);
      r.viewer.scrollTop = r.scrollTop || 0;
      refreshVisible(doc);
    });
  }
}

// =====================================================================  rendu des pages
let renderTimers = new WeakMap();
function scheduleVisibleRender(doc) {
  clearTimeout(renderTimers.get(doc));
  renderTimers.set(doc, setTimeout(() => refreshVisible(doc), 60));
}

// Détermine sans IntersectionObserver quelles pages sont (presque) visibles, rend celles qui
// ne le sont pas encore et libère les autres. Appelé à l'activation, au zoom, au redimensionnement.
export function refreshVisible(doc) {
  const r = rt(doc);
  const v = r.viewer;
  if (!v || !r.view.classList.contains('active') || !v.clientHeight) return;
  const top = v.scrollTop - 800;
  const bottom = v.scrollTop + v.clientHeight + 800;
  for (const rec of r.pages) {
    const off = rec.div.classList.contains('off');
    const t = rec.div.offsetTop;
    const vis = !off && t + rec.div.offsetHeight > top && t < bottom;
    rec.visible = vis;
    if (vis && !rec.rendered) { rec.div.classList.add('loading'); renderPage(doc, rec); }
    else if (!vis && (rec.rendered || rec.renderTask)) unrenderPage(rec);
  }
}

async function renderPage(doc, rec) {
  const token = ++rec.token;
  if (rec.renderTask) {
    const old = rec.renderTask;
    old.cancel();
    try { await old.promise; } catch { /* annulé */ }
    if (token !== rec.token) return;
  }
  const vp = rec.vp;
  let dpr = window.devicePixelRatio || 1;
  while (vp.width * dpr * vp.height * dpr > 40e6 && dpr > 1) dpr -= 0.25;
  const canvas = rec.canvas;
  canvas.width = Math.floor(vp.width * dpr);
  canvas.height = Math.floor(vp.height * dpr);
  canvas.style.width = vp.width + 'px';
  canvas.style.height = vp.height + 'px';
  const task = rec.page.render({
    canvasContext: canvas.getContext('2d'), viewport: vp,
    annotationMode: rt(doc).formUids && rt(doc).formUids.has(rec.uid) ? 2 : 1, // 2 : sans les widgets de formulaire (le calque HTML de forms-ui.js les remplace)
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
  });
  rec.renderTask = task;
  try {
    await task.promise;
    if (token === rec.token) { rec.rendered = true; rec.div.classList.remove('loading'); renderTextLayer(doc, rec, token); }
  } catch (err) {
    if (err && err.name !== 'RenderingCancelledException') console.error(err);
  } finally {
    if (rec.renderTask === task) rec.renderTask = null;
  }
}

// Texte reconnu (OCR) : mots transparents posés sur l'image, mêmes conventions que le calque de texte de pdf.js (sélection, copie).
let measureCtx = null;
function appendOcrSpans(rec, ocr) {
  measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
  const frag = document.createDocumentFragment();
  for (const ln of window.Ocr.lines(ocr.words)) {
    ln.forEach((w, i) => {
      const b = window.Ocr.viewBox(w, rec.vp);
      if (!(b.len > 0.5 && b.thick > 0.5)) return;
      const sp = mk('span', 'ocr-w' + (w.c < 60 ? ' low' : ''));
      const size = Math.max(4, b.thick * 0.85);
      measureCtx.font = size + 'px sans-serif';
      const nat = measureCtx.measureText(w.t).width || 1;
      sp.textContent = w.t + (i < ln.length - 1 ? ' ' : '');
      sp.style.fontSize = size + 'px';
      sp.style.left = b.cx + 'px'; sp.style.top = b.cy + 'px';
      sp.style.transform = 'rotate(' + b.rot + 'deg) translate(' + (-b.len / 2) + 'px, ' + (-b.thick / 2) + 'px) scaleX(' + (b.len / nat) + ')';
      sp.title = w.t + ' (confiance ' + w.c + ' %)';
      frag.append(sp);
    });
    frag.append(document.createElement('br'));
  }
  rec.textLayer.append(frag);
}
// Texte reconnu ou modifié : à appeler après Annuler / Rétablir / un lot d'OCR (recalcule le texte des pages dont l'enregistrement a changé).
export function syncOcr(doc) {
  const r = rt(doc);
  if (!r.pages) return;
  for (const rec of r.pages) {
    const cur = (doc.ocr && doc.ocr[rec.uid]) || null;
    if (rec.ocrRef === cur) continue;
    rec.ocrRef = cur; rec.itemsPromise = null; rec.allItems = null;
    if (rec.rendered) renderTextLayer(doc, rec, rec.token);
  }
  renderHighlights(doc);
}
export function setOcrLowlight(doc, on) { rt(doc).view.classList.toggle('ocr-low', !!on); }

async function renderTextLayer(doc, rec, token) {
  if (rec.tlTask) { rec.tlTask.cancel(); rec.tlTask = null; }
  rec.textLayer.replaceChildren();
  rec.textLayer.style.setProperty('--scale-factor', String(rec.vp.scale));
  rec.textLayer.style.setProperty('--total-scale-factor', String(rec.vp.scale));
  const tl = new pdfjsLib.TextLayer({
    textContentSource: rec.page.streamTextContent(), container: rec.textLayer, viewport: rec.vp,
  });
  rec.tlTask = tl;
  try { await tl.render(); } catch { /* annulé */ }
  if (token !== rec.token) { rec.textLayer.replaceChildren(); return; }
  const ocr = doc.ocr && doc.ocr[rec.uid];
  rec.ocrRef = ocr || null;
  if (ocr && ocr.words.length && !rec.textLayer.querySelector('span:not(.markedContent)')) appendOcrSpans(rec, ocr); // seulement si la page n'a pas de texte natif
}

function unrenderPage(rec) {
  rec.token++;
  if (rec.renderTask) { rec.renderTask.cancel(); rec.renderTask = null; }
  if (rec.tlTask) { rec.tlTask.cancel(); rec.tlTask = null; }
  rec.textLayer.replaceChildren();
  rec.div.classList.remove('loading');
  rec.canvas.width = 0;
  rec.canvas.height = 0;
  rec.rendered = false;
}

// =====================================================================  zoom, ajustement, disposition
function layoutRec(doc, rec) {
  rec.vp = pageViewport(rec, doc.view.zoom, doc.view.rotation);
  const b = pageViewport(rec, 1, doc.view.rotation);
  rec.bw = b.width;
  rec.bh = b.height;
  rec.box = pageBox(rec);
  rec.rotated = rec.vp.rotation % 360 !== 0;
  rec.div.style.width = rec.vp.width + 'px';
  rec.div.style.height = rec.vp.height + 'px';
  rec.canvas.style.width = rec.vp.width + 'px';
  rec.canvas.style.height = rec.vp.height + 'px';
  rec.rendered = false;
}

// Aligne l'affichage sur doc.pages (après une opération sur les pages, ou Annuler / Rétablir). Les pages inchangées gardent leur rendu ;
// seules les pages nouvelles ou dont la rotation / le cadre ont changé sont re-dessinées (et seulement si elles sont visibles).
export async function syncPages(doc) {
  const r = rt(doc);
  if (!r.pagesEl || !doc.pages) return false;
  const list = doc.pages;
  const unchanged = list.length === r.pages.length && list.every((d, k) => r.pages[k].uid === d.u && r.pages[k].sig === descSig(d));
  if (unchanged) return false;
  hooks.beforeScale(doc);
  const byUid = new Map(r.pages.map((rec) => [rec.uid, rec]));
  const recs = await Promise.all(list.map(async (d, k) => {
    const old = byUid.get(d.u);
    if (old && old.srcKey === d.src + '|' + d.i) return old; // même page source : l'enregistrement est conservé (rotation / recadrage : redessinée)
    return makeRec(doc, d, await pageProxy(doc, d.src, d.i), k);
  }));
  const keep = new Set(recs);
  for (const rec of r.pages) if (!keep.has(rec)) { unrenderPage(rec); r.observer.unobserve(rec.div); rec.div.remove(); }
  recs.forEach((rec, k) => {
    const d = list[k];
    const fresh = !rec.vp;
    if (fresh) { r.pagesEl.append(rec.div); hooks.pageBuilt(doc, rec); }
    const ref = r.pagesEl.children[k];
    if (ref !== rec.div) r.pagesEl.insertBefore(rec.div, ref || null);
    rec.index = k;
    rec.div.dataset.index = k;
    rec.desc = d;
    const sig = descSig(d);
    if (fresh || sig !== rec.sig) {
      rec.sig = sig;
      unrenderPage(rec);
      rec.itemsPromise = null; rec.allItems = null; // texte et zone : à recalculer (recherche)
      layoutRec(doc, rec);
    }
  });
  r.pages = recs;
  r.mxSnap = {};
  applyMode(doc);
  doc.page = Math.min(doc.page, r.pages.length - 1);
  hooks.renderAll(doc);
  renderHighlights(doc);
  if (doc.view.fit) fit(doc, doc.view.fit);
  recs.forEach((rec) => { if (rec.div.dataset.obs !== '1') { rec.div.dataset.obs = '1'; r.observer.observe(rec.div); } });
  refreshVisible(doc);
  bus.emit('pages', doc);
  bus.emit('page', doc);
  return true;
}

function applyScale(doc) {
  hooks.beforeScale(doc);
  const r = rt(doc);
  for (const rec of r.pages) layoutRec(doc, rec);
  hooks.renderAll(doc);
  renderHighlights(doc);
  scheduleVisibleRender(doc);
  bus.emit('zoom', doc);
}

export function setZoom(doc, next, anchor, keepFit) {
  next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
  if (!keepFit) doc.view.fit = null;
  if (Math.abs(next - doc.view.zoom) < 1e-4) { bus.emit('zoom', doc); return; }
  const v = rt(doc).viewer;
  const r = v.getBoundingClientRect();
  const mx = anchor ? anchor.clientX - r.left : v.clientWidth / 2;
  const my = anchor ? anchor.clientY - r.top : v.clientHeight / 2;
  const fx = (v.scrollLeft + mx) / v.scrollWidth;
  const fy = (v.scrollTop + my) / v.scrollHeight;
  doc.view.zoom = next;
  applyScale(doc);
  v.scrollLeft = fx * v.scrollWidth - mx;
  v.scrollTop = fy * v.scrollHeight - my;
}

// Pages visibles ensemble (1 ou 2 selon la disposition) autour de la page courante.
function spreadPages(doc) {
  const r = rt(doc);
  const n = doc.view.spread;
  const start = n === 2 ? doc.page - (doc.page % 2) : doc.page;
  return r.pages.slice(start, start + n);
}

export function fit(doc, kind, cap) {
  const r = rt(doc);
  if (!kind || !r.viewer || !r.viewer.clientWidth) return;
  const cw = r.viewer.clientWidth - 2 * PAD - 2;
  const ch = r.viewer.clientHeight - 2 * PAD - 2;
  let s;
  if (kind === 'width') {
    const widest = Math.max(...r.pages.map((p) => p.bw));
    s = cw / (doc.view.spread === 2 ? 2 * widest + GAP : widest);
  } else {
    const sp = spreadPages(doc);
    const w = sp.reduce((a, p) => a + p.bw, 0) + (sp.length - 1) * GAP;
    const h = Math.max(...sp.map((p) => p.bh));
    s = Math.min(cw / w, ch / h);
  }
  if (cap) s = Math.min(s, cap);
  doc.view.fit = kind;
  setZoom(doc, s, null, true);
}

export function setMode(doc, mode) {
  if (doc.view.mode === mode) return;
  doc.view.mode = mode;
  applyMode(doc);
  bus.emit('view', doc);
  if (mode === 'continuous') goToPage(doc, doc.page);
}

export function setSpread(doc, n) {
  if (doc.view.spread === n) return;
  doc.view.spread = n;
  applyMode(doc);
  if (doc.view.fit) fit(doc, doc.view.fit);
  bus.emit('view', doc);
}

export function rotateView(doc, delta) {
  doc.view.rotation = (doc.view.rotation + delta + 360) % 360;
  const keep = doc.view.fit;
  applyScale(doc);
  if (keep) fit(doc, keep);
  bus.emit('view', doc);
}

function applyMode(doc) {
  const r = rt(doc);
  r.pagesEl.classList.toggle('two', doc.view.spread === 2);
  const single = doc.view.mode === 'single';
  const visible = new Set(single ? spreadPages(doc).map((p) => p.index) : r.pages.map((p) => p.index));
  r.pages.forEach((rec) => rec.div.classList.toggle('off', !visible.has(rec.index)));
}

export function goToPage(doc, index, opts) {
  const r = rt(doc);
  if (!r.pages.length) return;
  doc.page = Math.min(r.pages.length - 1, Math.max(0, index));
  if (doc.view.mode === 'single') {
    applyMode(doc);
    if (doc.view.fit === 'page') fit(doc, 'page');
    r.viewer.scrollTop = opts && opts.toEnd ? r.viewer.scrollHeight : 0;
  } else {
    r.viewer.scrollTop = r.pages[doc.page].div.offsetTop - PAD;
  }
  bus.emit('page', doc);
}

export function pageStep(doc, dir, opts) {
  goToPage(doc, doc.page + dir * (doc.view.spread === 2 ? 2 : 1), opts);
}

// ---- Mode « page par page » : molette ----
// Page entièrement visible : un cran change de page. Page plus grande que la fenêtre : la molette défile,
// et ne change de page qu'à partir du bas (ou du haut). Temporisation de 250 ms + notion de « geste »
// (événements séparés de moins de 180 ms) pour que l'inertie ne saute pas plusieurs pages.
const WHEEL_LOCK_MS = 250;
const GESTURE_GAP_MS = 180;
function onSingleWheel(doc, ev) {
  const r = rt(doc);
  const v = r.viewer;
  const dir = ev.deltaY > 0 ? 1 : ev.deltaY < 0 ? -1 : 0;
  if (!dir) return;
  const now = performance.now();
  if (now - r.lastWheelT > GESTURE_GAP_MS) r.gestureScrolled = false; // nouveau geste
  r.lastWheelT = now;
  if (now < r.wheelLockUntil) { ev.preventDefault(); return; }
  const fits = v.scrollHeight <= v.clientHeight + 1;
  const atBottom = v.scrollTop + v.clientHeight >= v.scrollHeight - 1;
  const atTop = v.scrollTop <= 0;
  const atBoundary = fits || (dir > 0 ? atBottom : atTop);
  if (!atBoundary) { r.gestureScrolled = true; return; } // défilement naturel dans la page
  ev.preventDefault();
  if (r.gestureScrolled) return; // même geste que le défilement qui vient d'arriver au bord
  const before = doc.page;
  pageStep(doc, dir, { toEnd: dir < 0 });
  if (doc.page !== before) { r.wheelLockUntil = now + WHEEL_LOCK_MS; r.gestureScrolled = true; }
}

// ---- Clavier (hors champs de saisie). Renvoie true si la touche a été traitée. ----
export function handleNavKey(doc, e) {
  const v = rt(doc).viewer;
  if (!v || e.ctrlKey || e.altKey || e.metaKey) return false;
  const single = doc.view.mode === 'single';
  const fits = v.scrollHeight <= v.clientHeight + 1 && v.scrollWidth <= v.clientWidth + 1;
  const k = e.key;
  if (k === 'PageDown' || k === 'PageUp' || k === ' ') {
    const dir = k === 'PageDown' || (k === ' ' && !e.shiftKey) ? 1 : -1;
    const atEnd = dir > 0 ? v.scrollTop + v.clientHeight >= v.scrollHeight - 1 : v.scrollTop <= 0;
    if (single && atEnd) pageStep(doc, dir, { toEnd: dir < 0 });
    else v.scrollTop += dir * v.clientHeight * 0.9;
    return true;
  }
  if (k === 'ArrowRight' || k === 'ArrowLeft') {
    const dir = k === 'ArrowRight' ? 1 : -1;
    if (single && fits) pageStep(doc, dir);
    else v.scrollLeft += dir * 60;
    return true;
  }
  if (k === 'ArrowDown' || k === 'ArrowUp') { v.scrollTop += (k === 'ArrowDown' ? 1 : -1) * 60; return true; }
  if (k === 'Home') { goToPage(doc, 0); return true; }
  if (k === 'End') { goToPage(doc, pageCount(doc) - 1); return true; }
  return false;
}

function updateCurrentPage(doc) {
  const r = rt(doc);
  if (!r.pages.length || doc.view.mode === 'single' || !r.viewer.clientHeight) return;
  const mid = r.viewer.scrollTop + r.viewer.clientHeight / 2;
  let cur = r.pages.length - 1;
  for (let i = 0; i < r.pages.length; i++) {
    const d = r.pages[i].div;
    if (d.offsetTop + d.offsetHeight > mid) { cur = i; break; }
  }
  if (cur !== doc.page) { doc.page = cur; bus.emit('page', doc); }
}

export const pageCount = (doc) => (rt(doc).pages || []).length;

// =====================================================================  texte existant
// Éléments de texte d'une page (voir text-info.js) : { str, hasEOL, x, y, w, size, ang, fontName, upright, editable } (indices stables, utilisés par la recherche).
export function getPageItems(doc, index) {
  const rec = rt(doc).pages[index];
  if (!rec.itemsPromise) {
    rec.itemsPromise = rec.page.getTextContent().then((tc) => {
      rec.styles = tc.styles;
      rec.allItems = window.TextInfo.itemsFromContent(tc);
      const ocr = doc.ocr && doc.ocr[rec.uid];
      if (ocr && ocr.words.length && !window.Ocr.hasNativeText(tc.items)) rec.allItems = window.Ocr.items(ocr.words); // page sans texte natif : texte reconnu
      return rec.allItems;
    });
  }
  return rec.itemsPromise;
}

// =====================================================================  surlignage de la recherche
// list : [{ page, parts:[{idx,from,to}] }, …] ; current : indice dans list (ou -1).
export function setHighlights(doc, list, current) {
  rt(doc).highlights = list ? { list, current } : null;
  renderHighlights(doc);
}

// Rectangle (x0, y0, x1, y1 en pixels de la page affichée) → position CSS d'un élément.
function rectToStyle(el, r) {
  Object.assign(el.style, { left: Math.min(r[0], r[2]) + 'px', top: Math.min(r[1], r[3]) + 'px', width: Math.abs(r[2] - r[0]) + 'px', height: Math.abs(r[3] - r[1]) + 'px' });
}

async function renderHighlights(doc) {
  const r = rt(doc);
  r.pages.forEach((rec) => rec.searchLayer.replaceChildren());
  const h = r.highlights;
  if (!h) return;
  const pages = [...new Set(h.list.map((m) => m.page))];
  await Promise.all(pages.map((p) => getPageItems(doc, p)));
  if (r.highlights !== h) return;
  h.list.forEach((m, k) => {
    const rec = r.pages[m.page];
    for (const part of m.parts) {
      const it = rec.allItems[part.idx];
      if (it && it.ocr) { // mot reconnu : toute sa boîte
        const el0 = mk('div', 'search-hl' + (k === h.current ? ' current' : ''));
        rectToStyle(el0, rec.vp.convertToViewportRectangle(it.box));
        rec.searchLayer.append(el0);
        continue;
      }
      if (!it || !it.upright || !it.str.length) continue;
      const a = part.from / it.str.length;
      const b = part.to / it.str.length;
      const x = it.x + a * it.w;
      const w = Math.max((b - a) * it.w, 1);
      const el = mk('div', 'search-hl' + (k === h.current ? ' current' : ''));
      rectToStyle(el, rec.vp.convertToViewportRectangle([x, it.y - 0.2 * it.size, x + w, it.y + 0.95 * it.size]));
      rec.searchLayer.append(el);
    }
  });
}

// Amène la correspondance à l'écran.
export async function revealMatch(doc, m) {
  const r = rt(doc);
  await getPageItems(doc, m.page);
  goToPage(doc, m.page);
  const rec = r.pages[m.page];
  const it = rec.allItems[m.parts[0].idx];
  if (it) {
    const [, vy] = rec.vp.convertToViewportPoint(it.x, it.y);
    r.viewer.scrollTop = rec.div.offsetTop + vy - r.viewer.clientHeight / 3;
  }
}

// =====================================================================  enregistrement
// Écriture : annotations figées dans les pages, structure des pages (rotation, ordre, insertions, recadrage…) incluse.
// st : état de pages (voir PageOps ; par défaut celui du document, ou un sous-ensemble pour l'extraction) ; edits : objets à écrire (défaut : tous).
// Étiquettes de numérotation des pages de sortie (calculées sur le document complet, reportées par identifiant de page).
export function numberingFor(doc, pagesOut) {
  if (!doc.numbering || !doc.numbering.length || !doc.pages) return [];
  const all = window.Numbering.resolve(doc.numbering, doc.pages);
  const byU = new Map(doc.pages.map((p, i) => [p.u, all[i]]));
  return pagesOut.map((p) => byU.get(p.u) || []);
}
export function exportBytes(doc, st, opts) {
  const s = st || DocModel.pageState(doc);
  const o = opts || {};
  return PdfEdit.applyEdits(window.PDFLib, doc.bytes.slice(), o.edits || s.edits, {
    images: doc.assets.images, measure: Object.assign({}, doc.measure, { scales: s.scales }, o.measure || {}), pages: { list: s.pages, sources: doc.sources }, numbering: o.numbering === false ? [] : numberingFor(doc, s.pages), ocr: o.ocr === false ? [] : s.pages.map((p) => (doc.ocr && doc.ocr[p.u]) || null),
    form: o.form === undefined ? (doc.form || doc.runtime.flatten ? { values: doc.form ? doc.form.values : {}, flatten: !!doc.runtime.flatten } : null) : o.form, warn: o.warn || null,
    info: o.info === undefined ? doc.info : o.info, encrypt: o.encrypt || null, useObjectStreams: o.useObjectStreams,
    clean: o.clean === undefined ? doc.clean : o.clean, scrub: window.Redact.hasRedacted(s.pages), onScrub: o.onScrub || null,
  });
}

export const getPdf = (doc) => rt(doc).pdf;
export const getPages = (doc) => rt(doc).pages;
