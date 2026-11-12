// Sélection : contours, poignées, tests de clic.
// (Découpé de annotate.js : voir src/js/annotate.js pour l'API publique.)
import { bus, store } from '../ui.js';
import * as V from '../viewer.js';
import * as Settings from '../settings.js';

const { DocModel, PdfEdit, Shapes, PDFLib, TextInfo } = window;
import { localXY, measure, scaleOf, svgEl, toPx, tolOf } from './common.js';
import { renderAll, shown } from './render.js';

// ----------------------------------------------------------------------------- sélection : contours et poignées
export const selectedObjs = (doc) => doc.selection.map((id) => DocModel.getEdit(doc, id)).filter(Boolean).map((e) => shown(doc, e));

export function outlineCorners(o) {
  const k = Shapes.kindOf(o);
  if (k === 'replace') return Shapes.coverPoly(o);
  if (k === 'frame') return Shapes.rectCorners(o);
  if (k === 'text') return Shapes.textCorners(o, measure);
  const b = Shapes.bounds(o, measure);
  return [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]];
}

// Poignées de l'objet : [{ name, x, y }] en coordonnées PDF.
export const ROT_OFFSET_PX = 26;
export function handlesOf(o, scale) {
  const k = Shapes.kindOf(o);
  const out = [];
  if (k === 'points' && (o.type === 'line' || o.type === 'arrow')) {
    o.points.forEach((p, i) => out.push({ name: 'p' + i, x: p[0], y: p[1] }));
    return out;
  }
  if (k === 'frame') {
    const a = (o.rot || 0) * Shapes.DEG;
    const P = (u, v) => { const c = Math.cos(a), s = Math.sin(a); return [o.cx + u * c - v * s, o.cy + u * s + v * c]; };
    const hw = o.w / 2, hh = o.h / 2;
    for (const [n, sx, sy] of [['nw', -1, 1], ['n', 0, 1], ['ne', 1, 1], ['e', 1, 0], ['se', 1, -1], ['s', 0, -1], ['sw', -1, -1], ['w', -1, 0]]) {
      const p = P(sx * hw, sy * hh);
      out.push({ name: n, x: p[0], y: p[1] });
    }
    const r = P(0, hh + ROT_OFFSET_PX / scale);
    out.push({ name: 'rot', x: r[0], y: r[1] });
    return out;
  }
  if (k === 'points') {
    const b = Shapes.bounds(o, measure);
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    for (const [n, x, y] of [['nw', b.x0, b.y1], ['n', cx, b.y1], ['ne', b.x1, b.y1], ['e', b.x1, cy], ['se', b.x1, b.y0], ['s', cx, b.y0], ['sw', b.x0, b.y0], ['w', b.x0, cy]]) out.push({ name: n, x, y });
    out.push({ name: 'rot', x: cx, y: b.y1 + ROT_OFFSET_PX / scale });
    return out;
  }
  if (k === 'text') {
    const c = Shapes.textCorners(o, measure); // bas-gauche, bas-droite, haut-droite, haut-gauche
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const e = mid(c[1], c[2]), w = mid(c[0], c[3]), n = mid(c[3], c[2]);
    out.push({ name: 'e', x: e[0], y: e[1] }, { name: 'w', x: w[0], y: w[1] });
    if (o.type === 'callout' && o.tip) { out.push({ name: 'tip', x: o.tip[0], y: o.tip[1] }); return out; } // légende : poignée de la pointe, pas de rotation
    const a = (o.rot || 0) * Shapes.DEG;
    out.push({ name: 'rot', x: n[0] - Math.sin(a) * (ROT_OFFSET_PX / scale), y: n[1] + Math.cos(a) * (ROT_OFFSET_PX / scale) });
    return out;
  }
  return out;
}

export function renderSelection(doc, rec) {
  const g = rec.gSel;
  g.replaceChildren();
  const objs = selectedObjs(doc).filter((o) => o.page === rec.index);
  if (!objs.length) return;
  const f = toPx(rec);
  const path = (pts, cls) => {
    const el = svgEl('path');
    el.setAttribute('d', Shapes.pathD(Shapes.polySegs(pts, true), f));
    el.setAttribute('class', cls);
    return el;
  };
  for (const o of objs) {
    if (o.type === 'line' || o.type === 'arrow') continue;
    g.append(path(outlineCorners(o), 'sel-outline'));
  }
  if (objs.length > 1) {
    const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const o of objs) { const q = Shapes.bounds(o, measure); b.x0 = Math.min(b.x0, q.x0); b.y0 = Math.min(b.y0, q.y0); b.x1 = Math.max(b.x1, q.x1); b.y1 = Math.max(b.y1, q.y1); }
    g.append(path([[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]], 'sel-group'));
    return;
  }
  if (doc.selection.length !== 1) return;
  const o = objs[0];
  const hs = handlesOf(o, scaleOf(rec));
  const rot = hs.find((h) => h.name === 'rot');
  if (rot) {
    const k = Shapes.kindOf(o);
    const base = k === 'frame' ? Shapes.rectCorners(o) : outlineCorners(o); // bas-gauche, bas-droite, haut-droite, haut-gauche
    const topMid = [(base[2][0] + base[3][0]) / 2, (base[2][1] + base[3][1]) / 2];
    const a = f(topMid[0], topMid[1]), b = f(rot.x, rot.y);
    const l = svgEl('line');
    l.setAttribute('x1', a[0]); l.setAttribute('y1', a[1]); l.setAttribute('x2', b[0]); l.setAttribute('y2', b[1]);
    l.setAttribute('class', 'sel-rotline');
    g.append(l);
  }
  for (const h of hs) {
    const [x, y] = f(h.x, h.y);
    const el = svgEl(h.name === 'rot' ? 'circle' : 'rect');
    if (h.name === 'rot') { el.setAttribute('cx', x); el.setAttribute('cy', y); el.setAttribute('r', 6); }
    else { el.setAttribute('x', x - 4.5); el.setAttribute('y', y - 4.5); el.setAttribute('width', 9); el.setAttribute('height', 9); el.setAttribute('rx', h.name[0] === 'p' ? 4.5 : 1.5); }
    el.setAttribute('class', 'sel-handle');
    g.append(el);
  }
}

export function hitHandle(doc, rec, ev) {
  if (doc.selection.length !== 1) return null;
  const o = selectedObjs(doc)[0];
  if (!o || o.page !== rec.index) return null;
  const [lx, ly] = localXY(rec, ev);
  const f = toPx(rec);
  for (const h of handlesOf(o, scaleOf(rec))) {
    const [x, y] = f(h.x, h.y);
    if (Math.hypot(x - lx, y - ly) <= 8) return h.name;
  }
  return null;
}

// Objet le plus haut (dernier dans l'ordre) touché par le point.
export function hitObject(doc, rec, pt) {
  const tol = tolOf(rec);
  for (let i = doc.edits.length - 1; i >= 0; i--) {
    const e = doc.edits[i];
    if (e.page === rec.index && Shapes.hitTest(e, pt[0], pt[1], tol, measure)) return e;
  }
  return null;
}

// ----------------------------------------------------------------------------- sélection
export function changed(doc) { renderAll(doc); bus.emit('doc-changed', doc); }

export function selectIds(doc, ids) {
  doc.selection = [...ids];
  renderAll(doc);
  bus.emit('doc-changed', doc);
}
export const clearSelection = (doc) => { if (doc.selection.length) selectIds(doc, []); };

