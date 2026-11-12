// Alignement des objets sélectionnés (tous types : champs, formes, textes, tampons…) : à gauche, centrés, à droite, en haut, au milieu, en bas,
// tels qu'ils sont VUS à l'écran (page pivotée comprise). Référence = l'ensemble des objets de la page du premier objet sélectionné ; les objets
// des autres pages ne bougent pas. UNE étape d'historique.
import { bus, toast } from './ui.js';
import * as V from './viewer.js';
import * as A from './annotate.js';

const { DocModel, Shapes } = window;
export const MODES = { 'al-left': 'left', 'al-center': 'center', 'al-right': 'right', 'al-top': 'top', 'al-middle': 'middle', 'al-bottom': 'bottom' };

// Boîte vue (pixels de la page) d'un objet.
function screenBox(rec, e) {
  const b = Shapes.bounds(e, A.measure);
  const pts = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].map((p) => rec.vp.convertToViewportPoint(p[0], p[1]));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys) };
}

export function align(doc, mode) {
  if (!doc) return false;
  const objs = doc.selection.map((id) => DocModel.getEdit(doc, id)).filter(Boolean);
  if (objs.length < 2) { toast('Sélectionnez au moins deux objets à aligner (Maj + clic).', 3500); return false; }
  const page = objs[0].page;
  const same = objs.filter((e) => e.page === page);
  if (same.length < 2) { toast('Les objets à aligner doivent être sur la même page.', 3500); return false; }
  const rec = V.getPages(doc)[page];
  if (!rec || !rec.vp) return false;
  const boxes = new Map(same.map((e) => [e.id, screenBox(rec, e)]));
  const all = [...boxes.values()];
  const L = Math.min(...all.map((b) => b.l)), R = Math.max(...all.map((b) => b.r)), T = Math.min(...all.map((b) => b.t)), B = Math.max(...all.map((b) => b.b));
  const delta = (b) => {
    if (mode === 'left') return [L - b.l, 0];
    if (mode === 'right') return [R - b.r, 0];
    if (mode === 'center') return [(L + R) / 2 - (b.l + b.r) / 2, 0];
    if (mode === 'top') return [0, T - b.t];
    if (mode === 'bottom') return [0, B - b.b];
    return [0, (T + B) / 2 - (b.t + b.b) / 2];
  };
  const moves = new Map();
  for (const e of same) {
    const [dx, dy] = delta(boxes.get(e.id));
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) continue;
    const p0 = rec.vp.convertToPdfPoint(0, 0), p1 = rec.vp.convertToPdfPoint(dx, dy);
    moves.set(e.id, [p1[0] - p0[0], p1[1] - p0[1]]);
  }
  if (!moves.size) return true;
  DocModel.updateEdits(doc, [...moves.keys()], (e) => { const [dx, dy] = moves.get(e.id); return Shapes.translate(JSON.parse(JSON.stringify(e)), dx, dy); });
  A.changed(doc);
  bus.emit('doc-changed', doc);
  return true;
}
