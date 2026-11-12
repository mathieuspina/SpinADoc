// Événements d'une page, marquage du texte, changement d'outil.
// (Découpé de annotate.js : voir src/js/annotate.js pour l'API publique.)
import { bus, store } from '../ui.js';
import * as V from '../viewer.js';
import * as Settings from '../settings.js';

const { DocModel, PdfEdit, Shapes, PDFLib, TextInfo } = window;
import { PLACE_TOOLS, POLY_TOOLS, SHAPE_TOOLS, TOOLS, clone, defaultsOf, extTools, isTextType, localXY, pdfPoint, rt, scaleOf } from './common.js';
import { polyClick, startBand, startCreateDrag, startErase, startHandleDrag, startMove, startPen } from './drag.js';
import { clearPlacing, placeAt } from './place.js';
import { renderAll, setTmp } from './render.js';
import { changed, clearSelection, hitHandle, hitObject } from './select.js';
import { closeEditor, editExisting, openEditor, replaceToolClick, setHover } from './texted.js';

// ----------------------------------------------------------------------------- événements d'une page
export function onPageMouseDown(doc, rec, ev) {
  if (ev.button !== 0) return;
  if (ev.target.closest && ev.target.closest('textarea.editor')) return;
  const r = rt(doc);
  if (r.drag) return;
  closeEditor(doc, true);
  const tool = doc.tool;

  const ctrl = ev.ctrlKey || ev.metaKey;
  const baseTool = tool === 'select' || tool === 'add' || tool === 'edit';
  // Ctrl maintenu avec un outil de dessin : sélection temporaire d'un objet existant, sans quitter l'outil.
  if (!baseTool && ctrl && !r.poly) {
    ev.preventDefault();
    const hnd = hitHandle(doc, rec, ev);
    if (hnd) return startHandleDrag(doc, rec, hnd, ev);
    const hitTemp = hitObject(doc, rec, pdfPoint(rec, ev));
    if (hitTemp) return startMove(doc, rec, hitTemp, ev, true);
    return clearSelection(doc);
  }
  if (!baseTool && doc.selection.length && !r.poly && !(extTools[tool] && extTools[tool].keepSelection)) clearSelection(doc);
  if (extTools[tool]) { ev.preventDefault(); return extTools[tool].down(doc, rec, ev); }

  if (POLY_TOOLS.has(tool)) { ev.preventDefault(); return polyClick(doc, rec, ev); }

  if (baseTool) {
    const h = hitHandle(doc, rec, ev);
    if (h) { ev.preventDefault(); return startHandleDrag(doc, rec, h, ev); }
    const hit = hitObject(doc, rec, pdfPoint(rec, ev));
    if (hit) { ev.preventDefault(); return startMove(doc, rec, hit, ev); }
  }

  switch (tool) {
    case 'select':
      if (ev.target.closest && ev.target.closest('.textLayer span')) { clearSelection(doc); return; } // sélection de texte native
      ev.preventDefault();
      return startBand(doc, rec, ev);
    case 'add': case 'note': {
      ev.preventDefault();
      clearSelection(doc);
      const d = clone(defaultsOf(tool));
      const [lx, ly] = localXY(rec, ev);
      const pad = tool === 'note' ? d.size * 0.55 : 0; // la note a une marge intérieure : le coin du cartouche est le point cliqué
      // Le point cliqué est le coin haut-gauche de la zone ; on en déduit la ligne de base.
      const [px, py] = rec.vp.convertToPdfPoint(lx + pad * scaleOf(rec), ly + (Shapes.K_BASE * d.size + pad) * scaleOf(rec));
      // Le texte doit apparaître droit dans l'orientation affichée (page /Rotate, affichage pivoté) : rot = rotation d'affichage.
      return openEditor(doc, rec, { type: tool, page: rec.index, obj: Object.assign(d, { x: px, y: py, text: '', rot: rec.vp.rotation || 0 }) });
    }
    case 'stamp': case 'image': case 'signature':
      ev.preventDefault();
      clearSelection(doc);
      return placeAt(doc, rec, pdfPoint(rec, ev));
    case 'edit':
      ev.preventDefault();
      clearSelection(doc);
      return replaceToolClick(doc, rec, ev);
    case 'eraser':
      ev.preventDefault();
      return startErase(doc, rec, ev);
    case 'pen':
      ev.preventDefault();
      return startPen(doc, rec, ev);
    case 'highlight': case 'underline': case 'strike':
      return; // la sélection de texte native s'en charge ; l'objet est créé au relâchement (voir initGlobal)
    default:
      if (SHAPE_TOOLS.includes(tool)) { ev.preventDefault(); return startCreateDrag(doc, rec, ev); }
  }
}

export function onPageDblClick(doc, rec, ev) {
  if (doc.tool !== 'select') return;
  const hit = hitObject(doc, rec, pdfPoint(rec, ev));
  if (hit && isTextType(hit.type)) editExisting(doc, rec, hit);
}

// ----------------------------------------------------------------------------- marquage du texte sélectionné
export function mergeLineRects(rects) {
  const rs = rects.map((r) => r.slice()).sort((a, b) => (b[1] + b[3] / 2) - (a[1] + a[3] / 2) || a[0] - b[0]);
  const out = [];
  for (const r of rs) {
    const last = out[out.length - 1];
    if (last && Math.abs((last[1] + last[3] / 2) - (r[1] + r[3] / 2)) < Math.min(last[3], r[3]) * 0.5 && r[0] <= last[0] + last[2] + 2) {
      const x1 = Math.max(last[0] + last[2], r[0] + r[2]);
      const y0 = Math.min(last[1], r[1]), y1 = Math.max(last[1] + last[3], r[1] + r[3]);
      last[0] = Math.min(last[0], r[0]); last[2] = x1 - last[0]; last[1] = y0; last[3] = y1 - y0;
    } else out.push(r);
  }
  return out;
}

export function createMarkupFromSelection(doc, type) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const clientRects = Array.from(range.getClientRects()).filter((q) => q.width > 1 && q.height > 1);
  if (!clientRects.length) return;
  const list = [];
  for (const rec of rt(doc).pages) {
    const pr = rec.div.getBoundingClientRect();
    const rects = [];
    for (const q of clientRects) {
      const cx = q.left + q.width / 2, cy = q.top + q.height / 2;
      if (cx < pr.left || cx > pr.right || cy < pr.top || cy > pr.bottom) continue;
      const a = rec.vp.convertToPdfPoint(q.left - pr.left, q.top - pr.top), b = rec.vp.convertToPdfPoint(q.right - pr.left, q.bottom - pr.top);
      rects.push([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])]);
    }
    if (rects.length) list.push(Object.assign(clone(defaultsOf(type)), { type, page: rec.index, rects: mergeLineRects(rects) }));
  }
  sel.removeAllRanges();
  if (!list.length) return;
  DocModel.addEdits(doc, list);
  changed(doc);
}

// ----------------------------------------------------------------------------- outils
export function setTool(doc, tool) {
  closeEditor(doc, true);
  cancelPending(doc);
  doc.tool = tool;
  const v = rt(doc).view;
  TOOLS.forEach((t) => v.classList.remove('tool-' + t));
  v.classList.add('tool-' + tool);
  if (tool !== 'select' && tool !== 'add' && tool !== 'edit') doc.selection = [];
  rt(doc).pages.forEach((r) => { setHover(r, null); r.div.style.cursor = ''; });
  if (!PLACE_TOOLS.includes(tool)) clearPlacing();
  renderAll(doc);
  bus.emit('tool', doc);
  bus.emit('doc-changed', doc);
}

export function cancelPending(doc) {
  const r = rt(doc);
  for (const t of Object.values(extTools)) if (t.cancel) t.cancel(doc);
  if (r.poly) { const rec = r.poly.rec; r.poly = null; setTmp(doc, rec, null); }
  if (r.drag && r.drag.up) { document.removeEventListener('mousemove', r.drag.move); document.removeEventListener('mouseup', r.drag.up); r.drag = null; r.preview = null; r.tmp = null; renderAll(doc); }
}

