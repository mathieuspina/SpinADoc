// Pose de tampons, images et signatures.
// (Découpé de annotate.js : voir src/js/annotate.js pour l'API publique.)
import { bus, store } from '../ui.js';
import * as V from '../viewer.js';
import * as Settings from '../settings.js';

const { DocModel, PdfEdit, Shapes, PDFLib, TextInfo } = window;
import { clone, defaultsByType, defaultsOf, measure, rt, svgEl, toPx } from './common.js';
import { setTool } from './events.js';
import { afterCreate, primToSvgV } from './render.js';
import { changed } from './select.js';

// ----------------------------------------------------------------------------- pose : tampons, images, signatures
// charge utile de l'outil de pose, partagée entre documents :
//   { tool:'stamp', kind:'stamp', stamp:{ label, color, frame, … } } | { tool:'image'|'signature', kind:'image', imgId, withDate }
//   | { tool:'signature', kind:'sig', strokes, w, h, lw, color, withDate }
let placing = null;
export const getPlacing = () => placing;
export const clearPlacing = () => { placing = null; };

export function startPlacing(doc, payload) {
  placing = payload;
  if (payload.kind === 'stamp') defaultsByType.stamp = Object.assign(Shapes.defaultsFor('stamp'), payload.stamp);
  if (payload.kind === 'sig') defaultsByType.sig = Object.assign(Shapes.defaultsFor('sig'), { color: payload.color || [0, 0, 0] });
  setTool(doc, payload.tool);
}

export async function sha1(bytes) {
  try {
    const d = await crypto.subtle.digest('SHA-1', bytes);
    return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { // repli : somme de contrôle simple
    let h = 2166136261;
    for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 16777619); }
    return 'f' + (h >>> 0).toString(16) + bytes.length;
  }
}

// Enregistre une image dans le document (une même image = un seul fichier, même posée plusieurs fois) et renvoie son id.
export async function addImageAsset(doc, { mime, bytes, w, h }) {
  const id = await sha1(bytes);
  if (!doc.assets.images[id]) doc.assets.images[id] = { mime, bytes, w, h, url: URL.createObjectURL(new Blob([bytes], { type: mime })) };
  return id;
}

export function pageAt(doc, x, y) {
  for (const rec of rt(doc).pages) {
    const r = rec.div.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { rec, pt: rec.vp.convertToPdfPoint(x - r.left, y - r.top) };
  }
  return null;
}
// Centre de la zone visible (page la plus proche du centre de l'écran).
export function viewCenter(doc) {
  const vr = rt(doc).viewer.getBoundingClientRect();
  const hit = pageAt(doc, vr.left + vr.width / 2, vr.top + vr.height / 2);
  if (hit) return hit;
  const rec = rt(doc).pages[Math.min(doc.page, rt(doc).pages.length - 1)];
  const w = rec.box[2] - rec.box[0], h = rec.box[3] - rec.box[1];
  return { rec, pt: [rec.box[0] + w / 2, rec.box[1] + h / 2] };
}

export function placeAt(doc, rec, pt, payload) {
  const p = payload || placing;
  if (!p) return;
  const vr = rec.vp.rotation || 0; // l'objet doit apparaître droit dans l'orientation affichée
  const list = [];
  let box = null;
  if (p.kind === 'stamp') {
    const d = defaultsOf('stamp');
    const o = Object.assign(clone(d), { type: 'stamp', page: rec.index, cx: pt[0], cy: pt[1] });
    o.date = d.withDate ? Shapes.formatDate() : null;
    o.user = d.withUser ? Settings.get('userName') || null : null;
    o.rot = (d.tilt ? -7 : 0) + vr;
    const sz = Shapes.stampSize(o, measure, 1);
    o.w = sz.w; o.h = sz.h;
    list.push(o);
  } else if (p.kind === 'image') {
    const a = doc.assets.images[p.imgId];
    if (!a) return;
    const pageW = rec.box[2] - rec.box[0];
    const w = Math.min(a.w * 0.75, pageW * (p.maxFrac || 0.4));
    box = { w, h: (w * a.h) / a.w };
    list.push({ type: 'image', page: rec.index, imgId: p.imgId, cx: pt[0], cy: pt[1], w: box.w, h: box.h, rot: vr, opacity: defaultsOf('image').opacity });
  } else if (p.kind === 'sig') {
    const d = defaultsOf('sig');
    box = { w: p.w, h: p.h };
    list.push({ type: 'sig', page: rec.index, cx: pt[0], cy: pt[1], w: p.w, h: p.h, w0: p.w, lw: p.lw, strokes: p.strokes, color: d.color || p.color, opacity: d.opacity, rot: vr });
  }
  if (p.withDate && box) {
    // date à côté de la signature : à droite, dans le sens de lecture affiché
    const a = vr * Shapes.DEG, off = box.w / 2 + 8;
    list.push({ type: 'add', page: rec.index, text: Shapes.formatDate(), size: 11, font: 'Helvetica', bold: false, italic: false, align: 'left', width: null, fill: null, border: null, color: [0.2, 0.2, 0.2], rot: vr, x: pt[0] + Math.cos(a) * off + Math.sin(a) * 4, y: pt[1] + Math.sin(a) * off - Math.cos(a) * 4 });
  }
  if (!list.length) return;
  const ids = DocModel.addEdits(doc, list);
  afterCreate(doc, ids[0]);
  changed(doc);
}

// Miniature SVG d'un objet de la bibliothèque (même rendu que la page).
export function thumbSvg(obj, maxW, maxH, assets) {
  const b = Shapes.bounds(obj, measure);
  const bw = Math.max(1, b.x1 - b.x0), bh = Math.max(1, b.y1 - b.y0);
  const s = Math.min((maxW - 4) / bw, (maxH - 4) / bh);
  const svg = svgEl('svg');
  svg.setAttribute('width', String(bw * s + 4)); svg.setAttribute('height', String(bh * s + 4));
  svg.setAttribute('viewBox', `0 0 ${bw * s + 4} ${bh * s + 4}`);
  const view = { scale: s, rotation: 0, toPx: (x, y) => [(x - b.x0) * s + 2, (b.y1 - y) * s + 2], assets: assets || { images: {} } };
  for (const p of Shapes.primitives(obj, measure)) svg.append(primToSvgV(view, p));
  return svg;
}

export function stampObject(stamp) { // objet « tampon » (échelle 1) pour les miniatures
  const o = Object.assign(Shapes.defaultsFor('stamp'), stamp, { type: 'stamp', cx: 0, cy: 0, rot: 0 });
  const sz = Shapes.stampSize(o, measure, 1);
  return Object.assign(o, { w: sz.w, h: sz.h });
}

