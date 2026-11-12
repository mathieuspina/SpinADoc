// Rendu SVG des objets par page, aperçu temporaire, création (afterCreate / changed).
// (Découpé de annotate.js : voir src/js/annotate.js pour l'API publique.)
import { bus, store } from '../ui.js';
import * as V from '../viewer.js';
import * as Settings from '../settings.js';

const { DocModel, PdfEdit, Shapes, PDFLib, TextInfo } = window;
import { measure, rgb, rt, scaleOf, svgEl, toPx } from './common.js';
import { setTool } from './events.js';
import { renderSelection } from './select.js';

// ----------------------------------------------------------------------------- rendu SVG
export function fontCss(fontName) {
  const fam = /^Times/.test(fontName) ? 'Times' : /^Courier/.test(fontName) ? 'Courier' : 'Helvetica';
  return { family: Shapes.cssFamily({ font: fam }), bold: /Bold/.test(fontName), italic: /Italic|Oblique/.test(fontName) };
}

export const viewOf = (rec) => ({ scale: scaleOf(rec), rotation: rec.vp.rotation || 0, toPx: toPx(rec), assets: rec.docRef ? rec.docRef.assets : { images: {} } });
export const primToSvg = (rec, p) => primToSvgV(viewOf(rec), p);

// view : { scale, rotation, toPx(x, y), assets } — même rendu pour la page et pour les miniatures de la bibliothèque.
export function primToSvgV(view, p) {
  const s = view.scale;
  if (p.kind === 'image') {
    const a = view.assets.images[p.imgId];
    const el = svgEl('image');
    if (a) el.setAttribute('href', a.url);
    const [cx, cy] = view.toPx(p.cx, p.cy);
    el.setAttribute('x', String(-(p.w * s) / 2)); el.setAttribute('y', String(-(p.h * s) / 2));
    el.setAttribute('width', String(p.w * s)); el.setAttribute('height', String(p.h * s));
    el.setAttribute('preserveAspectRatio', 'none');
    el.setAttribute('opacity', String(p.opacity === undefined ? 1 : p.opacity));
    el.setAttribute('transform', `translate(${cx} ${cy}) rotate(${view.rotation - (p.rot || 0)})`);
    return el;
  }
  if (p.kind === 'text') {
    const el = svgEl('text');
    const [px, py] = view.toPx(p.x, p.y);
    // rot : angle du texte dans l'espace PDF (anti-horaire) ; rotation : rotation d'affichage (horaire) de la page.
    el.setAttribute('transform', `translate(${px} ${py}) rotate(${view.rotation - (p.rot || 0)})`);
    if (p.opacity !== undefined && p.opacity < 1) el.setAttribute('fill-opacity', String(p.opacity));
    const f = fontCss(p.fontName);
    el.setAttribute('font-size', String(p.size * s));
    el.setAttribute('font-family', f.family);
    if (f.bold) el.setAttribute('font-weight', 'bold');
    if (f.italic) el.setAttribute('font-style', 'italic');
    el.setAttribute('fill', rgb(p.color));
    el.setAttribute('class', 'at');
    el.textContent = p.text;
    return el;
  }
  const el = svgEl('path');
  el.setAttribute('d', Shapes.pathD(p.segs, view.toPx));
  if (p.fill) { el.setAttribute('fill', rgb(p.fill.color)); el.setAttribute('fill-opacity', String(p.fill.opacity)); } else el.setAttribute('fill', 'none');
  if (p.stroke) {
    el.setAttribute('stroke', rgb(p.stroke.color));
    el.setAttribute('stroke-width', String(p.stroke.width * s));
    el.setAttribute('stroke-opacity', String(p.stroke.opacity));
    el.setAttribute('stroke-linecap', 'round');
    el.setAttribute('stroke-linejoin', 'round');
    if (p.stroke.dash) el.setAttribute('stroke-dasharray', p.stroke.dash.map((d) => d * s).join(' '));
  }
  if (p.blend === 'multiply') el.style.mixBlendMode = 'multiply';
  return el;
}

export function objectGroup(rec, o, id) {
  const g = svgEl('g');
  g.dataset.id = id;
  if (o.type === 'field' && rec.docRef.runtime && rec.docRef.runtime.fieldPreview) return g; // prévisualisation : le calque de remplissage remplace l'aperçu
  const pageRot = (((rec.page && rec.page.rotate) || 0) + ((rec.desc && rec.desc.rot) || 0)) % 360; // champs : texte droit sur page pivotée
  for (const p of Shapes.primitives(o, measure, { measure: rec.docRef.measure, pageRot })) g.append(primToSvg(rec, p));
  return g;
}

// Objet tel qu'affiché : l'aperçu d'un glisser (déplacement, redimensionnement…) remplace l'original.
export const shown = (doc, e) => (rt(doc).preview && rt(doc).preview.get(e.id)) || e;

// Numérotation affichée : règles en cours d'édition (boîte ouverte) ou celles du document ; étiquettes calculées une fois par état du document.
function numLabels(doc) {
  const r = rt(doc);
  const rules = r.numWork || doc.numbering;
  if (!rules || !rules.length || !doc.pages || r.numHide) return null;
  const key = doc.stateId + '|' + (r.numWork ? r.numWorkVer : 0) + '|' + doc.pages.length;
  if (r.numCache && r.numCache.key === key) return r.numCache.labels;
  const labels = window.Numbering.resolve(rules, doc.pages);
  r.numCache = { key, labels };
  return labels;
}

export function renderPage(doc, rec) {
  const svg = rec.svg;
  svg.setAttribute('width', String(rec.vp.width));
  svg.setAttribute('height', String(rec.vp.height));
  svg.setAttribute('viewBox', `0 0 ${rec.vp.width} ${rec.vp.height}`);
  rec.gCovers.replaceChildren();
  rec.gObjs.replaceChildren();
  const editingId = rt(doc).editor && rt(doc).editor.ctx.id;
  for (const e of doc.edits) {
    if (e.page !== rec.index) continue;
    if (e.cover) rec.gCovers.append(primToSvg(rec, Shapes.coverPrimitive(e)));
    if (e.id === editingId) continue;
    rec.gObjs.append(objectGroup(rec, shown(doc, e), e.id));
  }
  rec.gNum.replaceChildren();
  const lab = numLabels(doc);
  if (lab && lab[rec.index] && lab[rec.index].length) {
    const info = { box: rec.box, rot: ((rec.page.rotate + (rec.desc.rot || 0)) % 360 + 360) % 360, index: rec.index };
    for (const p of window.Numbering.primitives(lab[rec.index], info, measure)) rec.gNum.append(primToSvg(rec, p));
  }
  renderSelection(doc, rec);
  renderTemp(doc, rec);
}

export function renderAll(doc) { rt(doc).pages.forEach((rec) => renderPage(doc, rec)); }

// ----------------------------------------------------------------------------- aperçu temporaire (création, lasso, guides)
export function renderTemp(doc, rec) {
  const r = rt(doc);
  rec.gTmp.replaceChildren();
  const t = r.tmp;
  if (!t || t.rec !== rec) return;
  if (t.obj) for (const p of Shapes.primitives(t.obj, measure, { measure: doc.measure, pageRot: (((rec.page && rec.page.rotate) || 0) + ((rec.desc && rec.desc.rot) || 0)) % 360 })) rec.gTmp.append(primToSvg(rec, p));
  if (t.band) {
    const [a, b] = t.band;
    const el = svgEl('rect');
    el.setAttribute('x', Math.min(a[0], b[0])); el.setAttribute('y', Math.min(a[1], b[1]));
    el.setAttribute('width', Math.abs(a[0] - b[0])); el.setAttribute('height', Math.abs(a[1] - b[1]));
    el.setAttribute('class', 'sel-band');
    rec.gTmp.append(el);
  }
  for (const gd of t.guides || []) {
    const el = svgEl('line');
    const p = toPx(rec)(gd.x0, gd.y0), q = toPx(rec)(gd.x1, gd.y1);
    el.setAttribute('x1', p[0]); el.setAttribute('y1', p[1]); el.setAttribute('x2', q[0]); el.setAttribute('y2', q[1]);
    el.setAttribute('class', 'sel-guide');
    rec.gTmp.append(el);
  }
}

export function setTmp(doc, rec, tmp) { rt(doc).tmp = tmp ? Object.assign({ rec }, tmp) : null; renderTemp(doc, rec); }

// Réglage « Garder l'outil actif après un tracé » (activé par défaut) : l'outil reste actif et le nouvel objet n'est
// pas sélectionné (le panneau montre les réglages de l'outil). Désactivé : retour à « Sélection » avec l'objet sélectionné.
export const keepTool = () => Settings.get('keepTool') !== false;
export function afterCreate(doc, id) {
  if (keepTool()) { doc.selection = []; return; }
  doc.selection = [id];
  if (doc.tool !== 'select') setTool(doc, 'select');
}

