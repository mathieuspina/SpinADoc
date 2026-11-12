// Constantes, outils, valeurs par défaut et coordonnées partagées par les modules d'annotation.
// (Découpé de annotate.js : voir src/js/annotate.js pour l'API publique.)
import { bus, store } from '../ui.js';
import * as V from '../viewer.js';
import * as Settings from '../settings.js';

const { DocModel, PdfEdit, Shapes, PDFLib, TextInfo } = window;

export const SVGNS = 'http://www.w3.org/2000/svg';
export const measure = Shapes.makeMeasure(PDFLib);

export const SHAPE_TOOLS = ['line', 'arrow', 'rect', 'ellipse', 'hlrect', 'polygon', 'polyline', 'cloud', 'pen'];
export const MARKUP_TOOLS = ['highlight', 'underline', 'strike'];
export const PLACE_TOOLS = ['stamp', 'image', 'signature']; // outils de pose (tampon, image, signature) : charge utile = placing
export const TOOLS = ['select', 'add', 'note', 'edit', 'eraser', ...PLACE_TOOLS, ...SHAPE_TOOLS, ...MARKUP_TOOLS];
export const POLY_TOOLS = new Set(['polygon', 'polyline', 'cloud']);
// Outils ajoutés par d'autres modules (ex. mesures) : { down(doc, rec, ev), move?(doc, rec, ev), cancel?(doc) → true si quelque chose était en cours, finish?(doc) → true si traité }
export const extTools = {};
export function registerTool(name, label, handlers) { extTools[name] = handlers; TOOLS.push(name); TOOL_LABELS[name] = label; }
export const ROTATED_MSG = V.ROTATED_MSG;
export const TOOL_LABELS = {
  select: 'Sélection', note: 'Note', stamp: 'Tampon', image: 'Image', signature: 'Signature', add: 'Ajouter texte', edit: 'Modifier texte', eraser: 'Gomme', line: 'Ligne', arrow: 'Flèche', rect: 'Rectangle',
  ellipse: 'Ellipse', hlrect: 'Surlignage libre', polygon: 'Polygone', polyline: 'Polyligne', cloud: 'Nuage', pen: 'Crayon',
  highlight: 'Surligner', underline: 'Souligner', strike: 'Barrer',
};

export const rt = (d) => d.runtime;
export const svgEl = (tag) => document.createElementNS(SVGNS, tag);
export const rgb = (c) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
export const clone = (o) => JSON.parse(JSON.stringify(o));
export const scaleOf = (rec) => rec.vp.scale;

// ----------------------------------------------------------------------------- valeurs par défaut (par type)
export const defaultsByType = {};
export const defaultsOf = (type) => defaultsByType[type] || (defaultsByType[type] = Shapes.defaultsFor(type));
export const toolType = (tool) => (tool === 'edit' ? 'add' : tool === 'signature' ? 'sig' : tool);
export const isTextType = (t) => t === 'add' || t === 'note' || t === 'replace' || t === 'callout';
// Crochets posés par d'autres modules (légende : aimantation de la pointe).
export const hooks = { snapPoint: null, beforeAdd: [] }; // beforeAdd(doc, copies) : avant l'ajout de copies (Ctrl+D, collage)

// ----------------------------------------------------------------------------- coordonnées
export function localXY(rec, ev) {
  const r = rec.div.getBoundingClientRect();
  return [ev.clientX - r.left, ev.clientY - r.top];
}
export const pdfPoint = (rec, ev) => rec.vp.convertToPdfPoint(...localXY(rec, ev));
export const toPx = (rec) => (x, y) => rec.vp.convertToViewportPoint(x, y);
export const tolOf = (rec) => 6 / scaleOf(rec);

