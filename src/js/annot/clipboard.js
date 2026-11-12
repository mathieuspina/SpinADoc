// Historique, suppression, presse-papiers, duplication, ordre d'empilement.
// (Découpé de annotate.js : voir src/js/annotate.js pour l'API publique.)
import { bus, store } from '../ui.js';
import * as V from '../viewer.js';
import * as Settings from '../settings.js';

const { DocModel, PdfEdit, Shapes, PDFLib, TextInfo } = window;
import { clone, hooks } from './common.js';
import { changed } from './select.js';
import { closeEditor } from './texted.js';

// ----------------------------------------------------------------------------- historique, suppression, presse-papiers, ordre
// Annuler / Rétablir : un même historique pour les objets et pour la structure des pages (le visionneur est réaligné si les pages ont changé).
export async function undo(doc) { closeEditor(doc, true); if (DocModel.undo(doc)) { await V.syncPages(doc); V.syncOcr(doc); changed(doc); } }
export async function redo(doc) { closeEditor(doc, true); if (DocModel.redo(doc)) { await V.syncPages(doc); V.syncOcr(doc); changed(doc); } }

export function deleteSelected(doc) {
  if (!doc.selection.length) return;
  DocModel.removeEdits(doc, doc.selection);
  changed(doc);
}

let clipboard = null; // { objs: [...] } — partagé entre documents

export function copySelection(doc) {
  const objs = doc.selection.map((id) => DocModel.getEdit(doc, id)).filter((e) => e && e.type !== 'replace').map((e) => { const c = clone(e); delete c.id; return c; });
  if (!objs.length) return false;
  const assets = {};
  for (const o of objs) if (o.imgId && doc.assets.images[o.imgId]) assets[o.imgId] = doc.assets.images[o.imgId];
  clipboard = { objs, pastes: 0, assets };
  return true;
}
export function cutSelection(doc) { if (copySelection(doc)) deleteSelected(doc); }

export function pasteObjs(doc, objs, shift) {
  const page = Math.min(doc.page, V.pageCount(doc) - 1);
  const first = objs[0].page;
  const list = objs.map((o) => {
    const c = clone(o);
    c.page = objs.every((x) => x.page === first) ? page : Math.min(c.page, V.pageCount(doc) - 1);
    delete c.srcKey; delete c.cover;
    return shift ? Shapes.translate(c, shift, -shift) : c;
  });
  for (const h of hooks.beforeAdd) h(doc, list);
  const ids = DocModel.addEdits(doc, list);
  doc.selection = ids;
  changed(doc);
}

export function paste(doc) {
  if (!clipboard) return false;
  for (const [id, a] of Object.entries(clipboard.assets || {})) {
    if (!doc.assets.images[id]) doc.assets.images[id] = { mime: a.mime, bytes: a.bytes, w: a.w, h: a.h, url: URL.createObjectURL(new Blob([a.bytes], { type: a.mime })) };
  }
  const same = clipboard.objs.every((o) => o.page === Math.min(doc.page, V.pageCount(doc) - 1));
  clipboard.pastes += 1;
  pasteObjs(doc, clipboard.objs, same ? 14 * clipboard.pastes : 0);
  return true;
}

export function duplicateSelection(doc) {
  const objs = doc.selection.map((id) => DocModel.getEdit(doc, id)).filter((e) => e && e.type !== 'replace').map((e) => { const c = clone(e); delete c.id; return c; });
  if (!objs.length) return;
  const list = objs.map((c) => Shapes.translate(c, 14, -14));
  for (const h of hooks.beforeAdd) h(doc, list);
  const ids = DocModel.addEdits(doc, list);
  doc.selection = ids;
  changed(doc);
}

// Ordre d'empilement : 'front' | 'back' | 'forward' | 'backward'.
export function reorder(doc, mode) {
  if (!doc.selection.length) return;
  const sel = new Set(doc.selection);
  const list = doc.edits.slice();
  let out;
  if (mode === 'front') out = [...list.filter((e) => !sel.has(e.id)), ...list.filter((e) => sel.has(e.id))];
  else if (mode === 'back') out = [...list.filter((e) => sel.has(e.id)), ...list.filter((e) => !sel.has(e.id))];
  else {
    out = list.slice();
    if (mode === 'forward') for (let i = out.length - 2; i >= 0; i--) { if (sel.has(out[i].id) && !sel.has(out[i + 1].id)) [out[i], out[i + 1]] = [out[i + 1], out[i]]; }
    else for (let i = 1; i < out.length; i++) { if (sel.has(out[i].id) && !sel.has(out[i - 1].id)) [out[i], out[i - 1]] = [out[i - 1], out[i]]; }
  }
  if (out.every((e, i) => e === list[i])) return;
  DocModel.setEdits(doc, out);
  changed(doc);
}

export function nudge(doc, dx, dy) {
  if (!doc.selection.length) return;
  DocModel.updateEdits(doc, doc.selection, (e) => Shapes.translate(clone(e), dx, dy));
  changed(doc);
}

export function hasClipboard() { return !!clipboard; }
