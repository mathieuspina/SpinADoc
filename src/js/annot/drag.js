// Gestes de souris : déplacement, poignées, lasso, création de formes, polygones, crayon, gomme.
// (Découpé de annotate.js : voir src/js/annotate.js pour l'API publique.)
import { bus, store } from '../ui.js';
import * as V from '../viewer.js';
import * as Settings from '../settings.js';

const { DocModel, PdfEdit, Shapes, PDFLib, TextInfo } = window;
import { clone, defaultsOf, hooks, isTextType, localXY, measure, pdfPoint, rt, scaleOf, toPx } from './common.js';
import { afterCreate, renderAll, renderPage, setTmp } from './render.js';
import { changed, hitObject, renderSelection } from './select.js';
import { editExisting } from './texted.js';

// ----------------------------------------------------------------------------- glisser : déplacement, poignées, création…
export function onDocMove(fn) { document.addEventListener('mousemove', fn); }
export function endDrag(doc, move, up) {
  document.removeEventListener('mousemove', move);
  document.removeEventListener('mouseup', up);
  rt(doc).drag = null;
}

export function startMove(doc, rec, hit, ev, temp) {
  const r = rt(doc);
  const additive = temp ? ev.shiftKey : ev.shiftKey || ev.ctrlKey || ev.metaKey;
  const wasSelected = doc.selection.includes(hit.id);
  if (additive) {
    doc.selection = wasSelected ? doc.selection.filter((i) => i !== hit.id) : [...doc.selection, hit.id];
    renderAll(doc); bus.emit('doc-changed', doc);
    if (wasSelected) return;
  } else if (!wasSelected) {
    doc.selection = [hit.id];
    renderAll(doc); bus.emit('doc-changed', doc);
  }
  const ids = doc.selection.filter((id) => { const e = DocModel.getEdit(doc, id); return e && e.page === rec.index; });
  const origs = new Map(ids.map((id) => [id, clone(DocModel.getEdit(doc, id))]));
  const start = pdfPoint(rec, ev);
  const startPx = [ev.clientX, ev.clientY];
  let moved = false;
  // Légende déplacée seule en la saisissant par sa boîte : la pointe reste en place, le repère suit ; saisie par le repère : tout l'objet bouge.
  const boxOnly = origs.size === 1 && hit.type === 'callout' && window.Callout.inBox(hit, start[0], start[1], measure);
  r.drag = { kind: 'move' };
  r.preview = new Map();

  const move = (m) => {
    if (!moved && Math.hypot(m.clientX - startPx[0], m.clientY - startPx[1]) < 4) return;
    moved = true;
    const p = rec.vp.convertToPdfPoint(m.clientX - rec.div.getBoundingClientRect().left, m.clientY - rec.div.getBoundingClientRect().top);
    let dx = p[0] - start[0], dy = p[1] - start[1];
    const snap = m.altKey ? null : snapMove(doc, rec, origs, dx, dy);
    if (snap) { dx = snap.dx; dy = snap.dy; }
    r.preview = new Map();
    for (const [id, o] of origs) r.preview.set(id, Shapes.translate(clone(o), dx, dy, boxOnly));
    r.tmp = snap ? { rec, guides: snap.guides } : null;
    renderPage(doc, rec);
  };
  const up = () => {
    endDrag(doc, move, up);
    const pv = r.preview;
    r.preview = null;
    r.tmp = null;
    if (moved && pv.size) {
      DocModel.updateEdits(doc, [...pv.keys()], (e) => pv.get(e.id));
      changed(doc);
    } else {
      renderPage(doc, rec);
      const only = doc.selection.length === 1 ? DocModel.getEdit(doc, doc.selection[0]) : null;
      const isText = only && isTextType(only.type);
      if (isText && !temp && (doc.tool === 'add' || doc.tool === 'edit' || (wasSelected && !additive))) editExisting(doc, rec, only);
    }
  };
  onDocMove(move);
  document.addEventListener('mouseup', up);
  r.drag = { kind: 'move', move, up };
}

// Aimantation : bords et centres des autres objets de la page (seuil 6 px), avec guides.
export function snapMove(doc, rec, origs, dx, dy) {
  const thr = 6 / scaleOf(rec);
  const moving = new Set(origs.keys());
  let bb = null;
  for (const o of origs.values()) {
    const q = Shapes.bounds(Shapes.translate(clone(o), dx, dy), measure);
    bb = bb ? { x0: Math.min(bb.x0, q.x0), y0: Math.min(bb.y0, q.y0), x1: Math.max(bb.x1, q.x1), y1: Math.max(bb.y1, q.y1) } : q;
  }
  if (!bb) return null;
  const xs = [bb.x0, (bb.x0 + bb.x1) / 2, bb.x1], ys = [bb.y0, (bb.y0 + bb.y1) / 2, bb.y1];
  let bestX = null, bestY = null;
  for (const e of doc.edits) {
    if (e.page !== rec.index || moving.has(e.id)) continue;
    const q = Shapes.bounds(e, measure);
    if (!isFinite(q.x0)) continue;
    const tx = [q.x0, (q.x0 + q.x1) / 2, q.x1], ty = [q.y0, (q.y0 + q.y1) / 2, q.y1];
    for (const a of xs) for (const t of tx) if (Math.abs(t - a) <= thr && (!bestX || Math.abs(t - a) < Math.abs(bestX.d))) bestX = { d: t - a, at: t, q };
    for (const a of ys) for (const t of ty) if (Math.abs(t - a) <= thr && (!bestY || Math.abs(t - a) < Math.abs(bestY.d))) bestY = { d: t - a, at: t, q };
  }
  if (!bestX && !bestY) return null;
  const guides = [];
  if (bestX) guides.push({ x0: bestX.at, y0: Math.min(bb.y0, bestX.q.y0) - 10, x1: bestX.at, y1: Math.max(bb.y1, bestX.q.y1) + 10 });
  if (bestY) guides.push({ x0: Math.min(bb.x0, bestY.q.x0) - 10, y0: bestY.at, x1: Math.max(bb.x1, bestY.q.x1) + 10, y1: bestY.at });
  return { dx: dx + (bestX ? bestX.d : 0), dy: dy + (bestY ? bestY.d : 0), guides };
}

export const snapAngle = (dx, dy) => { const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12); const l = Math.hypot(dx, dy); return [l * Math.cos(a), l * Math.sin(a)]; };

export function startHandleDrag(doc, rec, handle, ev) {
  const r = rt(doc);
  const id = doc.selection[0];
  const orig = clone(DocModel.getEdit(doc, id));
  const kind = Shapes.kindOf(orig);
  const b0 = Shapes.bounds(orig, measure);
  const c0 = Shapes.center(orig, measure);
  const a0 = Math.atan2(pdfPoint(rec, ev)[1] - c0[1], pdfPoint(rec, ev)[0] - c0[0]);
  r.drag = { kind: 'handle' };
  r.preview = new Map();
  let moved = false;

  const compute = (m) => {
    const rect = rec.div.getBoundingClientRect();
    const p = rec.vp.convertToPdfPoint(m.clientX - rect.left, m.clientY - rect.top);
    const o = clone(orig);
    if (handle === 'rot') {
      let d = Math.atan2(p[1] - c0[1], p[0] - c0[0]) - a0;
      let deg = d / Shapes.DEG;
      if (m.shiftKey) deg = Math.round(deg / 15) * 15;
      return Shapes.rotateBy(o, deg, c0[0], c0[1]);
    }
    if (handle === 'tip') { // pointe de la légende (aimantée au plan, Alt = libre)
      o.tip = hooks.snapPoint ? hooks.snapPoint(doc, rec, p, m) : p;
      return o;
    }
    if (handle === 'p0' || handle === 'p1') {
      const i = handle === 'p0' ? 0 : 1;
      let q = p;
      if (m.shiftKey) { const other = o.points[1 - i]; const [sx, sy] = snapAngle(p[0] - other[0], p[1] - other[1]); q = [other[0] + sx, other[1] + sy]; }
      o.points[i] = q;
      return o;
    }
    const sx = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
    const sy = handle.includes('n') ? 1 : handle.includes('s') ? -1 : 0;
    if (kind === 'frame') {
      const a = (orig.rot || 0) * Shapes.DEG;
      const dxp = p[0] - orig.cx, dyp = p[1] - orig.cy;
      const qx = dxp * Math.cos(-a) - dyp * Math.sin(-a), qy = dxp * Math.sin(-a) + dyp * Math.cos(-a);
      const hw = orig.w / 2, hh = orig.h / 2;
      let nx0 = -hw, nx1 = hw, ny0 = -hh, ny1 = hh;
      if (sx === 1) nx1 = qx; else if (sx === -1) nx0 = qx;
      if (sy === 1) ny1 = qy; else if (sy === -1) ny0 = qy;
      let w = Math.max(2, nx1 - nx0), h = Math.max(2, ny1 - ny0);
      const locked = Shapes.ASPECT_LOCKED.has(orig.type) ? !m.shiftKey : m.shiftKey && sx && sy;
      if (locked) {
        const kk = Math.max(0.05, sx && sy ? Math.max(w / orig.w, h / orig.h) : sx ? w / orig.w : h / orig.h);
        w = orig.w * kk; h = orig.h * kk;
        if (sx === 1) nx1 = nx0 + w; else if (sx === -1) nx0 = nx1 - w; else { nx0 = -w / 2; nx1 = w / 2; }
        if (sy === 1) ny1 = ny0 + h; else if (sy === -1) ny0 = ny1 - h; else { ny0 = -h / 2; ny1 = h / 2; }
      }
      const ucx = (nx0 + nx1) / 2, ucy = (ny0 + ny1) / 2;
      o.w = w; o.h = h;
      o.cx = orig.cx + ucx * Math.cos(a) - ucy * Math.sin(a);
      o.cy = orig.cy + ucx * Math.sin(a) + ucy * Math.cos(a);
      return o;
    }
    if (kind === 'text') {
      const a = (orig.rot || 0) * Shapes.DEG;
      const L = Shapes.layoutText(orig, measure);
      const dxp = p[0] - orig.x, dyp = p[1] - orig.y;
      const qx = dxp * Math.cos(-a) - dyp * Math.sin(-a);
      if (handle === 'e') o.width = Math.max(20, qx);
      else { // bord gauche : l'origine se déplace et la largeur s'ajuste
        const nw = Math.max(20, L.W - qx);
        const shift = L.W - nw;
        o.width = nw;
        o.x = orig.x + shift * Math.cos(a);
        o.y = orig.y + shift * Math.sin(a);
      }
      return o;
    }
    // objets à points : mise à l'échelle de la boîte englobante
    const nb = { x0: b0.x0, y0: b0.y0, x1: b0.x1, y1: b0.y1 };
    if (sx === 1) nb.x1 = p[0]; else if (sx === -1) nb.x0 = p[0];
    if (sy === 1) nb.y1 = p[1]; else if (sy === -1) nb.y0 = p[1];
    if (m.shiftKey && sx && sy) {
      const k = Math.max((nb.x1 - nb.x0) / (b0.x1 - b0.x0 || 1), (nb.y1 - nb.y0) / (b0.y1 - b0.y0 || 1));
      if (sx === 1) nb.x1 = nb.x0 + (b0.x1 - b0.x0) * k; else nb.x0 = nb.x1 - (b0.x1 - b0.x0) * k;
      if (sy === 1) nb.y1 = nb.y0 + (b0.y1 - b0.y0) * k; else nb.y0 = nb.y1 - (b0.y1 - b0.y0) * k;
    }
    if (nb.x1 - nb.x0 < 2) nb.x1 = nb.x0 + 2;
    if (nb.y1 - nb.y0 < 2) nb.y1 = nb.y0 + 2;
    return Shapes.resizePoints(o, b0, nb);
  };
  const move = (m) => { moved = true; r.preview = new Map([[id, compute(m)]]); renderPage(doc, rec); };
  const up = () => {
    endDrag(doc, move, up);
    const pv = r.preview;
    r.preview = null;
    if (moved && pv.size) { DocModel.updateEdits(doc, [id], (e) => pv.get(e.id)); changed(doc); } else renderPage(doc, rec);
  };
  onDocMove(move);
  document.addEventListener('mouseup', up);
  r.drag = { kind: 'handle', move, up };
}

// ---- lasso de sélection
export function startBand(doc, rec, ev) {
  const r = rt(doc);
  const startL = localXY(rec, ev);
  const additive = ev.shiftKey || ev.ctrlKey || ev.metaKey;
  const base = additive ? [...doc.selection] : [];
  if (!additive) { if (doc.selection.length) { doc.selection = []; bus.emit('doc-changed', doc); } }
  r.drag = { kind: 'band' };
  const move = (m) => {
    const rect = rec.div.getBoundingClientRect();
    const cur = [m.clientX - rect.left, m.clientY - rect.top];
    setTmp(doc, rec, { band: [startL, cur] });
    const a = rec.vp.convertToPdfPoint(...startL), b = rec.vp.convertToPdfPoint(...cur);
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
    const ids = doc.edits.filter((e) => e.page === rec.index).filter((e) => {
      const q = Shapes.bounds(e, measure);
      return isFinite(q.x0) && q.x1 >= x0 && q.x0 <= x1 && q.y1 >= y0 && q.y0 <= y1;
    }).map((e) => e.id);
    doc.selection = [...new Set([...base, ...ids])];
    renderSelection(doc, rec);
  };
  const up = () => { endDrag(doc, move, up); setTmp(doc, rec, null); renderAll(doc); bus.emit('doc-changed', doc); };
  onDocMove(move);
  document.addEventListener('mouseup', up);
  r.drag = { kind: 'band', move, up };
}

// ---- création par glisser : ligne, flèche, rectangle, ellipse, surlignage libre
// opts (facultatif) : { type, base, click(point, base) → objet posé sur un simple clic, finish(objet) → objet final } (champs de formulaire).
export function startCreateDrag(doc, rec, ev, opts) {
  const r = rt(doc);
  const type = (opts && opts.type) || doc.tool;
  const start = pdfPoint(rec, ev);
  const base = Object.assign({}, clone((opts && opts.base) || defaultsOf(type)), { type, page: rec.index });
  let cur = start;
  let moved = false;
  const build = (shift) => {
    const o = clone(base);
    if (type === 'line' || type === 'arrow') {
      let q = cur;
      if (shift) { const [sx, sy] = snapAngle(cur[0] - start[0], cur[1] - start[1]); q = [start[0] + sx, start[1] + sy]; }
      o.points = [start, q];
    } else {
      let w = cur[0] - start[0], h = cur[1] - start[1];
      if (shift) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
      o.cx = start[0] + w / 2; o.cy = start[1] + h / 2; o.w = Math.abs(w); o.h = Math.abs(h); o.rot = 0;
    }
    return o;
  };
  r.drag = { kind: 'create' };
  const move = (m) => {
    const rect = rec.div.getBoundingClientRect();
    cur = rec.vp.convertToPdfPoint(m.clientX - rect.left, m.clientY - rect.top);
    moved = true;
    setTmp(doc, rec, { obj: build(m.shiftKey) });
  };
  const up = (u) => {
    endDrag(doc, move, up);
    const o = build(u.shiftKey);
    setTmp(doc, rec, null);
    const big = (type === 'line' || type === 'arrow') ? Math.hypot(cur[0] - start[0], cur[1] - start[1]) * scaleOf(rec) > 4 : (o.w * scaleOf(rec) > 4 && o.h * scaleOf(rec) > 4);
    const fin = (x) => (opts && opts.finish ? opts.finish(x) : x);
    if (moved && big) {
      afterCreate(doc, DocModel.addEdit(doc, fin(o)));
      changed(doc);
    } else if (opts && opts.click) {
      afterCreate(doc, DocModel.addEdit(doc, fin(opts.click(start, clone(base)))));
      changed(doc);
    }
  };
  onDocMove(move);
  document.addEventListener('mouseup', up);
  r.drag = { kind: 'create', move, up };
}

// ---- polygone / polyligne / nuage : un clic par sommet
export function previewPoly(doc, rec) {
  const p = rt(doc).poly;
  if (!p) return;
  const o = Object.assign(clone(defaultsOf(p.type)), { type: p.type, page: rec.index, points: p.cursor ? [...p.points, p.cursor] : [...p.points] });
  if (o.points.length < 2) { setTmp(doc, rec, null); return; }
  setTmp(doc, rec, { obj: o });
}

export function finishPoly(doc, close) {
  const r = rt(doc);
  const p = r.poly;
  if (!p) return;
  r.poly = null;
  const min = p.type === 'polyline' ? 2 : 3;
  setTmp(doc, p.rec, null);
  if (p.points.length >= min) {
    const o = Object.assign(clone(defaultsOf(p.type)), { type: p.type, page: p.rec.index, points: p.points });
    afterCreate(doc, DocModel.addEdit(doc, o));
    changed(doc);
  }
}

export function polyClick(doc, rec, ev) {
  const r = rt(doc);
  const pt = pdfPoint(rec, ev);
  if (!r.poly) { r.poly = { rec, type: doc.tool, points: [pt], cursor: null }; previewPoly(doc, rec); return; }
  if (r.poly.rec !== rec) return;
  if (ev.detail >= 2) { finishPoly(doc); return; } // double-clic : terminer
  const first = r.poly.points[0];
  const f = toPx(rec);
  const [fx, fy] = f(first[0], first[1]);
  const [lx, ly] = localXY(rec, ev);
  if (r.poly.points.length >= 3 && Math.hypot(fx - lx, fy - ly) < 9 && r.poly.type !== 'polyline') { finishPoly(doc); return; } // clic sur le 1er point : fermer
  r.poly.points.push(pt);
  previewPoly(doc, rec);
}

// ---- crayon libre
export function startPen(doc, rec, ev) {
  const r = rt(doc);
  const pts = [pdfPoint(rec, ev)];
  const base = Object.assign(clone(defaultsOf('pen')), { type: 'pen', page: rec.index });
  r.drag = { kind: 'pen' };
  const move = (m) => {
    const rect = rec.div.getBoundingClientRect();
    pts.push(rec.vp.convertToPdfPoint(m.clientX - rect.left, m.clientY - rect.top));
    setTmp(doc, rec, { obj: Object.assign(clone(base), { points: pts.slice() }) });
  };
  const up = () => {
    endDrag(doc, move, up);
    setTmp(doc, rec, null);
    if (pts.length >= 2) {
      const smoothed = Shapes.smooth(pts, 0.8 / scaleOf(rec), 2);
      const id = DocModel.addEdit(doc, Object.assign(base, { points: smoothed }));
      doc.selection = [];
      changed(doc);
      return id;
    }
  };
  onDocMove(move);
  document.addEventListener('mouseup', up);
  r.drag = { kind: 'pen', move, up };
}

// ---- gomme d'objet
export function startErase(doc, rec, ev) {
  const r = rt(doc);
  let started = false;
  const eraseAt = (e2) => {
    const rect = rec.div.getBoundingClientRect();
    const pt = rec.vp.convertToPdfPoint(e2.clientX - rect.left, e2.clientY - rect.top);
    const hit = hitObject(doc, rec, pt);
    if (!hit) return;
    if (!started) { started = true; DocModel.commit(doc, (d) => { d.edits = d.edits.filter((e) => e.id !== hit.id); }); }
    else doc.edits = doc.edits.filter((e) => e.id !== hit.id); // même étape d'historique pour tout le geste
    doc.selection = doc.selection.filter((i) => i !== hit.id);
    doc.dirty = true;
    changed(doc);
  };
  r.drag = { kind: 'erase' };
  eraseAt(ev);
  const move = (m) => eraseAt(m);
  const up = () => endDrag(doc, move, up);
  onDocMove(move);
  document.addEventListener('mouseup', up);
  r.drag = { kind: 'erase', move, up };
}

