// Clavier des annotations.
// (Découpé de annotate.js : voir src/js/annotate.js pour l'API publique.)
import { bus, store } from '../ui.js';
import * as V from '../viewer.js';
import * as Settings from '../settings.js';

const { DocModel, PdfEdit, Shapes, PDFLib, TextInfo } = window;
import { copySelection, cutSelection, duplicateSelection, hasClipboard, nudge, paste } from './clipboard.js';
import { extTools, rt } from './common.js';
import { finishPoly } from './drag.js';
import { cancelPending, setTool } from './events.js';
import { clearSelection } from './select.js';

// ----------------------------------------------------------------------------- clavier
// Renvoie true si la touche a été traitée.
export function handleKey(doc, e) {
  const r = rt(doc);
  if (e.key === 'Escape') {
    if (r.poly) { cancelPending(doc); return true; }
    if (Object.values(extTools).some((t) => t.cancel && t.cancel(doc))) return true;
    if (r.drag) { cancelPending(doc); return true; }
    if (doc.tool !== 'select') { setTool(doc, 'select'); return true; } // quitte l'outil actif
    if (doc.selection.length) { clearSelection(doc); return true; }
    return false;
  }
  if (e.key === 'Enter' && r.poly) { finishPoly(doc); return true; }
  if (e.key === 'Enter' && extTools[doc.tool] && extTools[doc.tool].finish && extTools[doc.tool].finish(doc)) return true;
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (ctrl && k === 'd') { duplicateSelection(doc); return true; }
  if (ctrl && k === 'c' && doc.selection.length && !window.getSelection().toString()) { copySelection(doc); return true; }
  if (ctrl && k === 'x' && doc.selection.length) { cutSelection(doc); return true; }
  if (ctrl && k === 'v' && hasClipboard()) { paste(doc); return true; }
  if (!ctrl && doc.selection.length && r.view && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
    const step = e.shiftKey ? 10 : 1;
    nudge(doc, e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0);
    return true;
  }
  return false;
}

