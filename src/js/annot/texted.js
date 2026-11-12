// Éditeur de texte (notes, texte ajouté) et outil « Modifier texte ».
// (Découpé de annotate.js : voir src/js/annotate.js pour l'API publique.)
import { bus, store } from '../ui.js';
import * as V from '../viewer.js';
import * as Settings from '../settings.js';

const { DocModel, PdfEdit, Shapes, PDFLib, TextInfo } = window;
import { extTools, pdfPoint, rgb, rt, scaleOf, svgEl, toPx } from './common.js';
import { previewPoly } from './drag.js';
import { afterCreate, fontCss, renderPage } from './render.js';
import { changed, hitHandle, hitObject } from './select.js';

// ----------------------------------------------------------------------------- éditeur de texte
export function textCtxFromObj(doc, rec, o, extra) {
  return Object.assign({ page: rec.index, obj: o }, extra || {});
}

export function styleEditor(ta, rec, ctx) {
  const o = ctx.obj;
  const s = scaleOf(rec);
  const [bx, by] = rec.vp.convertToViewportPoint(o.x, o.y);
  const size = o.size || 12;
  const f = fontCss(Shapes.fontKey(o));
  ta.style.left = bx + 'px';
  ta.style.top = by - Shapes.K_BASE * size * s + 'px';
  ta.style.fontSize = size * s + 'px';
  ta.style.lineHeight = Shapes.LINE_H * size * s + 'px';
  ta.style.fontFamily = f.family;
  ta.style.fontWeight = f.bold ? 'bold' : 'normal';
  ta.style.fontStyle = f.italic ? 'italic' : 'normal';
  ta.style.color = rgb(o.color || [0, 0, 0]);
  ta.style.textAlign = o.align || 'left';
  if (o.width > 0) { ta.style.width = o.width * s + 'px'; ta.style.whiteSpace = 'pre-wrap'; ta.style.fieldSizing = 'fixed'; }
  if (o.cover) ta.style.minWidth = o.cover.w * s + 'px';
  const screenRot = (rec.vp.rotation || 0) - (o.rot || 0); // angle d'écran du texte (horaire)
  if (Math.abs(screenRot) > 0.01) { ta.style.transformOrigin = `0 ${Shapes.K_BASE * size * s}px`; ta.style.transform = `rotate(${screenRot}deg)`; }
  if (ctx.type === 'replace' && o.cover) ta.style.background = rgb(Shapes.coverColor(o));
  if ((ctx.type === 'note' || ctx.type === 'callout') && o.fill) ta.style.background = rgb(o.fill);
}

export function openEditor(doc, rec, ctx) {
  closeEditor(doc, true);
  const o = ctx.obj;
  const ta = document.createElement('textarea');
  ta.className = 'editor' + (ctx.type === 'replace' ? ' replace' : '');
  ta.value = o.text || '';
  ta.spellcheck = false;
  styleEditor(ta, rec, ctx);
  rec.overlay.append(ta);
  rt(doc).editor = { rec, ctx, ta };
  renderPage(doc, rec);
  bus.emit('doc-changed', doc); // le panneau de propriétés suit l'objet en cours d'édition
  ta.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Escape') { ev.preventDefault(); closeEditor(doc, false); }
    else if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); closeEditor(doc, true); } // Entrée / Ctrl+Entrée : valider ; Maj+Entrée : nouvelle ligne
  });
  ta.addEventListener('blur', (ev) => {
    // Passer au panneau de propriétés (police, couleur, fond…) ne valide pas l'édition : le panneau pilote l'éditeur ouvert.
    if (ev.relatedTarget && ev.relatedTarget.closest && ev.relatedTarget.closest('#props')) return;
    closeEditor(doc, true);
  });
  ta.focus();
  if (ctx.type === 'replace' || ctx.id) ta.select();
}

export function closeEditor(doc, commit) {
  const ed = rt(doc).editor;
  if (!ed) return;
  rt(doc).editor = null; // avant remove() : le blur déclenché ensuite est ignoré
  const text = ed.ta.value;
  ed.ta.remove();
  if (ed.ctx.type === 'callout') rt(doc).tmp = null; // aperçu du repère pendant la saisie
  if (commit) applyEditorResult(doc, ed.ctx, text);
  renderPage(doc, ed.rec);
  bus.emit('doc-changed', doc);
}

// Le panneau de propriétés modifie le texte en cours d'édition (objet pas encore créé).
export function restyleEditor(doc) {
  const ed = rt(doc).editor;
  if (!ed) return;
  styleEditor(ed.ta, ed.rec, ed.ctx);
  ed.ta.focus();
}

export function applyEditorResult(doc, ctx, text) {
  if (ctx.id) {
    const e = DocModel.getEdit(doc, ctx.id);
    if (!e) return;
    if ((e.type === 'add' || e.type === 'note' || e.type === 'callout') && text.trim() === '') { DocModel.removeEdit(doc, ctx.id); changed(doc); }
    else if (text !== e.text) { DocModel.updateEdit(doc, ctx.id, { text }); changed(doc); }
    return;
  }
  const o = ctx.obj;
  if ((ctx.type === 'add' || ctx.type === 'note' || ctx.type === 'callout') && text.trim() === '') return;
  if (ctx.type === 'replace' && text === o.text) return;
  const id = DocModel.addEdit(doc, Object.assign({}, o, { page: ctx.page, type: ctx.type, text }));
  afterCreate(doc, id);
  changed(doc);
}

export function editExisting(doc, rec, e) {
  doc.selection = [e.id];
  openEditor(doc, rec, { id: e.id, type: e.type, page: e.page, obj: e });
}

// ----------------------------------------------------------------------------- texte existant (outil « Modifier texte »)
export function hitItem(rec, px, py) {
  if (!rec.allItems) return -1;
  for (let i = rec.allItems.length - 1; i >= 0; i--) {
    const it = rec.allItems[i];
    if (it.editable && TextInfo.hitItem(it, px, py)) return i;
  }
  return -1;
}

// Pas de canevas DOM hors écran dans text-info.js : on lui fournit la fabrique.
export const makeCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return { ctx: c.getContext('2d', { willReadFrequently: true }) }; };

// Surbrillance (tournée avec le texte) du bloc survolé.
export function setHover(rec, item) {
  rec.gHover.replaceChildren();
  if (!item) return;
  const poly = TextInfo.coverCorners(TextInfo.coverFor(item));
  const el = svgEl('path');
  el.setAttribute('d', Shapes.pathD(Shapes.polySegs(poly, true), toPx(rec)));
  el.setAttribute('class', 'hover-poly');
  rec.gHover.append(el);
}

export async function replaceToolClick(doc, rec, ev) {
  const pt = pdfPoint(rec, ev);
  await V.getPageItems(doc, rec.index);
  const i = hitItem(rec, pt[0], pt[1]);
  if (i < 0) return;
  const it = rec.allItems[i];
  const srcKey = `${rec.index}:${i}`;
  const existing = doc.edits.find((e) => e.srcKey === srcKey);
  if (existing) return editExisting(doc, rec, existing);
  // Couleur du texte, police d'origine (→ police standard la plus proche) et couleur du fond détectées.
  const info = await TextInfo.analyze(rec.page, it, rec.styles, makeCanvas);
  openEditor(doc, rec, { type: 'replace', page: rec.index, obj: TextInfo.buildReplaceEdit(it, info, rec.index, srcKey) });
}

export function onPageMouseMove(doc, rec, ev) {
  const r = rt(doc);
  if (extTools[doc.tool] && extTools[doc.tool].move) { extTools[doc.tool].move(doc, rec, ev); return; }
  // Pages « Modifier texte » : surbrillance du bloc survolé
  if (doc.tool === 'edit' && !r.editor && !r.drag) {
    const pt = pdfPoint(rec, ev);
    if (hitObject(doc, rec, pt)) { setHover(rec, null); rec.div.style.cursor = 'move'; }
    else if (!rec.allItems) V.getPageItems(doc, rec.index);
    else {
      const i = hitItem(rec, pt[0], pt[1]);
      if (i < 0) { setHover(rec, null); rec.div.style.cursor = ''; }
      else { setHover(rec, rec.allItems[i]); rec.div.style.cursor = 'pointer'; }
    }
  }
  // Polygone / polyligne / nuage en cours : segment élastique
  if (r.poly && r.poly.rec === rec) {
    const p = pdfPoint(rec, ev);
    r.poly.cursor = p;
    previewPoly(doc, rec);
  }
  // Curseur selon ce qu'il y a sous la souris
  if ((doc.tool === 'select' || doc.tool === 'add') && !r.drag) {
    const h = hitHandle(doc, rec, ev);
    const CUR = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize', rot: 'grab', p0: 'crosshair', p1: 'crosshair' };
    rec.div.style.cursor = h ? CUR[h] : hitObject(doc, rec, pdfPoint(rec, ev)) ? 'move' : '';
  }
}

