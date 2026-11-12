// Champs du panneau de propriétés et contexte / application des propriétés.
// (Découpé de annotate.js : voir src/js/annotate.js pour l'API publique.)
import { bus, store } from '../ui.js';
import * as V from '../viewer.js';
import * as Settings from '../settings.js';

const { DocModel, PdfEdit, Shapes, PDFLib, TextInfo } = window;
import { defaultsOf, measure, rt, toolType } from './common.js';
import { changed } from './select.js';
import { restyleEditor } from './texted.js';

// Champs éditables dans le panneau de propriétés : clé, libellé, genre de contrôle, types d'objets concernés.
export const STROKE = ['line', 'arrow', 'rect', 'ellipse', 'polygon', 'polyline', 'cloud', 'pen'];
export const ALL = [...STROKE, 'hlrect', 'highlight', 'underline', 'strike', 'add', 'note', 'replace', 'stamp', 'sig'];
export const FIELDS = [
  { k: 'color', label: 'Couleur', kind: 'color', types: ALL },
  { k: 'fill', label: 'Remplissage', kind: 'colorOrNone', types: ['rect', 'ellipse', 'polygon', 'cloud'] },
  { k: 'fill', label: 'Fond du texte', kind: 'colorOrNone', types: ['add', 'note'] },
  { k: 'border', label: 'Bordure du texte', kind: 'colorOrNone', types: ['add', 'note'] },
  { k: 'width', label: 'Épaisseur', kind: 'number', min: 0.5, max: 40, step: 0.5, types: STROKE },
  { k: 'opacity', label: 'Opacité', kind: 'range', types: [...STROKE, 'hlrect', 'highlight', 'underline', 'strike', 'stamp', 'sig', 'image'] },
  { k: 'shadow', label: 'Ombre légère', kind: 'bool', types: ['note'] },
  { k: 'label', label: 'Texte du tampon', kind: 'text', types: ['stamp'] },
  { k: 'frame', label: 'Cadre', kind: 'bool', types: ['stamp'] },
  { k: 'withDate', label: 'Date (jj/mm/aaaa)', kind: 'bool', types: ['stamp'] },
  { k: 'withUser', label: 'Nom de l\'utilisateur', kind: 'bool', types: ['stamp'] },
  { k: 'tilt', label: 'Incliné à la pose', kind: 'bool', types: ['stamp'] },
  { k: 'dash', label: 'Style de trait', kind: 'select', options: [['solid', 'Plein'], ['dash', 'Tirets'], ['dot', 'Pointillés']], types: STROKE },
  { k: 'arrowStart', label: 'Pointe au début', kind: 'bool', types: ['line', 'arrow'] },
  { k: 'arrowEnd', label: 'Pointe à la fin', kind: 'bool', types: ['line', 'arrow'] },
  { k: 'radius', label: 'Coins arrondis', kind: 'number', min: 0, max: 100, step: 1, types: ['rect'] },
  { k: 'arc', label: 'Taille des arcs', kind: 'number', min: 4, max: 80, step: 1, types: ['cloud'] },
  { k: 'font', label: 'Police', kind: 'select', options: [['Helvetica', 'Helvetica'], ['Times', 'Times'], ['Courier', 'Courier']], types: ['add', 'note', 'replace'] },
  { k: 'bold', label: 'Gras', kind: 'bool', types: ['add', 'note', 'replace'] },
  { k: 'italic', label: 'Italique', kind: 'bool', types: ['add', 'note', 'replace'] },
  { k: 'bgMode', label: 'Fond du texte remplacé', kind: 'select', options: [['auto', 'Auto (détecté)'], ['white', 'Blanc'], ['custom', 'Personnalisé']], types: ['replace'] },
  { k: 'bgColor', label: 'Couleur du fond', kind: 'color', types: ['replace'] },
  { k: 'size', label: 'Taille', kind: 'number', min: 4, max: 200, step: 1, types: ['add', 'note', 'replace'] },
  { k: 'align', label: 'Alignement', kind: 'select', options: [['left', 'Gauche'], ['center', 'Centré'], ['right', 'Droite']], types: ['add', 'note'] },
  { k: 'width', label: 'Largeur fixe', kind: 'optnum', min: 10, max: 2000, step: 5, def: 200, types: ['add', 'note'] },
];

// ----------------------------------------------------------------------------- propriétés
// Contexte du panneau : objets sélectionnés, ou valeurs par défaut de l'outil actif.
export function propsContext(doc) {
  if (!doc) return null;
  const ed = rt(doc).editor;
  if (ed && ed.ctx.type === 'replace' && !ed.ctx.id) {
    return { objs: [Object.assign({ id: -1 }, ed.ctx.obj, { type: 'replace' })], types: new Set(['replace']), virtual: false, pending: true };
  }
  if (doc.selection.length) {
    const objs = doc.selection.map((id) => DocModel.getEdit(doc, id)).filter(Boolean);
    if (objs.length) return { objs, types: new Set(objs.map((o) => o.type)), virtual: false };
  }
  if (doc.tool !== 'select' && doc.tool !== 'eraser') {
    const t = toolType(doc.tool);
    return { objs: [Object.assign({ type: t }, defaultsOf(t))], types: new Set([t]), virtual: true };
  }
  return null;
}

// Contenu d'un tampon modifié : la taille suit (échelle conservée).
export const STAMP_KEYS = new Set(['label', 'frame', 'withDate', 'withUser']);
export function stampPatch(e, key, value) {
  const k = e.w / Shapes.stampNatural(e, measure).w;
  const ch = { [key]: value };
  if (key === 'withDate') ch.date = value ? Shapes.formatDate() : null;
  if (key === 'withUser') ch.user = value ? Settings.get('userName') || null : null;
  const n = Object.assign({}, e, ch);
  const nat = Shapes.stampNatural(n, measure);
  return Object.assign(ch, { w: nat.w * k, h: nat.h * k });
}

// Réglage propre à un type (ex. champs : noms uniques, groupes radio) : propHooks[type](doc, objets, clé, valeur) → true si traité (une étape).
export const propHooks = {};

export function setProp(doc, key, value, fieldTypes) {
  const ctx = propsContext(doc);
  if (!ctx) return;
  if (ctx.pending) {
    const ed = rt(doc).editor;
    ed.ctx.obj[key] = value;
    restyleEditor(doc);
    bus.emit('doc-changed', doc);
    return;
  }
  const hook = !ctx.virtual && ctx.types.size === 1 && propHooks[[...ctx.types][0]];
  if (hook) { if (hook(doc, ctx.objs, key, value)) changed(doc); bus.emit('doc-changed', doc); return; }
  const applies = (type) => !fieldTypes || fieldTypes.includes(type);
  if (!ctx.virtual) {
    const ids = ctx.objs.filter((o) => applies(o.type)).map((o) => o.id);
    if (ids.length) { DocModel.updateEdits(doc, ids, (e) => (e.type === 'stamp' && STAMP_KEYS.has(key) ? stampPatch(e, key, value) : { [key]: value })); changed(doc); }
  }
  for (const t of ctx.types) if (applies(t)) defaultsOf(t)[key] = value; // la prochaine création reprend ce réglage
  bus.emit('doc-changed', doc);
}

