// Aimantation : extrait les segments des tracés vectoriels d'une page (liste d'opérateurs PDF.js) et propose le point d'accroche
// le plus proche (extrémités, coins de rectangles, intersections). Pur : prend en entrée le résultat de page.getOperatorList() et pdfjs.OPS.
//
// Décision (2b-2) : FAISABLE et rapide. constructPath (moveTo/lineTo/rectangle/curveTo/closePath) + save/restore/transform/formes XObject
// donnent les segments en espace utilisateur ; un index en grille répond en quelques dizaines de microsecondes. Limites : les courbes
// ne sont accrochées que par leurs extrémités ; le texte, les images et les tracés non peints (clips) sont ignorés.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SnapGeometry = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const mul = (a, b) => [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
  const app = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

  // → { segs: Float64Array [x1,y1,x2,y2,…], pts: Float64Array [x,y,…] } en coordonnées PDF (espace utilisateur de la page).
  function extract(opList, OPS) {
    const segs = [];
    const pts = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    let pending = []; // segments du tracé en cours (déjà transformés)
    let pendPts = [];
    const PAINT = new Set([OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
    const fn = opList.fnArray, args = opList.argsArray;
    for (let i = 0; i < fn.length; i++) {
      const op = fn[i];
      if (op === OPS.save) stack.push(ctm);
      else if (op === OPS.restore) { if (stack.length) ctm = stack.pop(); }
      else if (op === OPS.transform) ctm = mul(ctm, args[i]);
      else if (op === OPS.paintFormXObjectBegin) { stack.push(ctm); if (args[i] && args[i][0]) ctm = mul(ctm, args[i][0]); }
      else if (op === OPS.paintFormXObjectEnd) { if (stack.length) ctm = stack.pop(); }
      else if (op === OPS.constructPath) {
        const ops = args[i][0], c = args[i][1];
        let k = 0, cur = null, start = null;
        for (const o of ops) {
          if (o === OPS.moveTo) { cur = app(ctm, c[k], c[k + 1]); start = cur; pendPts.push(cur); k += 2; }
          else if (o === OPS.lineTo) {
            const p = app(ctm, c[k], c[k + 1]); k += 2;
            if (cur) pending.push([cur[0], cur[1], p[0], p[1]]);
            pendPts.push(p); cur = p;
          } else if (o === OPS.curveTo) { const p = app(ctm, c[k + 4], c[k + 5]); k += 6; pendPts.push(p); cur = p; }
          else if (o === OPS.curveTo2 || o === OPS.curveTo3) { const p = app(ctm, c[k + 2], c[k + 3]); k += 4; pendPts.push(p); cur = p; }
          else if (o === OPS.closePath) { if (cur && start) { pending.push([cur[0], cur[1], start[0], start[1]]); cur = start; } }
          else if (o === OPS.rectangle) {
            const x = c[k], y = c[k + 1], w = c[k + 2], h = c[k + 3]; k += 4;
            const q = [app(ctm, x, y), app(ctm, x + w, y), app(ctm, x + w, y + h), app(ctm, x, y + h)];
            for (let j = 0; j < 4; j++) pending.push([q[j][0], q[j][1], q[(j + 1) % 4][0], q[(j + 1) % 4][1]]);
            pendPts.push(...q);
            cur = q[0]; start = q[0];
          }
        }
      } else if (PAINT.has(op)) { for (const s of pending) segs.push(...s); for (const p of pendPts) pts.push(p[0], p[1]); pending = []; pendPts = []; }
      else if (op === OPS.endPath || op === OPS.clip || op === OPS.eoClip) { pending = []; pendPts = []; }
    }
    // Les segments de longueur nulle ne servent à rien.
    const out = [];
    for (let i = 0; i < segs.length; i += 4) if (Math.hypot(segs[i + 2] - segs[i], segs[i + 3] - segs[i + 1]) > 1e-6) out.push(segs[i], segs[i + 1], segs[i + 2], segs[i + 3]);
    return { segs: Float64Array.from(out), pts: Float64Array.from(pts) };
  }

  function intersect(a, b) { // intersection de deux segments (dans leurs étendues) ou null
    const d1x = a[2] - a[0], d1y = a[3] - a[1], d2x = b[2] - b[0], d2y = b[3] - b[1];
    const den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < 1e-12) return null;
    const t = ((b[0] - a[0]) * d2y - (b[1] - a[1]) * d2x) / den;
    const u = ((b[0] - a[0]) * d1y - (b[1] - a[1]) * d1x) / den;
    if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
    return [a[0] + t * d1x, a[1] + t * d1y];
  }

  class Index {
    constructor(geom, bounds) {
      this.segs = geom.segs;
      this.pts = geom.pts;
      const w = Math.max(1, bounds.w), h = Math.max(1, bounds.h);
      this.x0 = bounds.x0; this.y0 = bounds.y0;
      this.cell = Math.max(w, h) / 64;
      this.n = Math.ceil(Math.max(w, h) / this.cell) + 1;
      this.sgrid = new Map(); // cellule → indices de segments
      this.pgrid = new Map(); // cellule → indices de points
      const key = (cx, cy) => cx * this.n + cy;
      this.key = key;
      for (let i = 0; i < this.segs.length; i += 4) {
        const s = i / 4;
        // Cellules traversées par le segment (échantillonnage plus fin qu'une cellule).
        const sx = this.segs[i], sy = this.segs[i + 1], ex = this.segs[i + 2], ey = this.segs[i + 3];
        const steps = Math.max(1, Math.ceil(Math.hypot(ex - sx, ey - sy) / (this.cell / 4)));
        let last = -1;
        for (let t = 0; t <= steps; t++) {
          const cx = Math.floor((sx + ((ex - sx) * t) / steps - this.x0) / this.cell), cy = Math.floor((sy + ((ey - sy) * t) / steps - this.y0) / this.cell);
          const k = key(cx, cy);
          if (k === last) continue;
          last = k;
          const arr = this.sgrid.get(k) || this.sgrid.set(k, []).get(k);
          if (arr[arr.length - 1] !== s) arr.push(s);
        }
      }
      for (let i = 0; i < this.pts.length; i += 2) {
        const k = key(Math.floor((this.pts[i] - this.x0) / this.cell), Math.floor((this.pts[i + 1] - this.y0) / this.cell));
        (this.pgrid.get(k) || this.pgrid.set(k, []).get(k)).push(i / 2);
      }
    }

    // Point d'accroche le plus proche de (x, y) dans le rayon r (unités PDF) : { x, y, kind: 'end' | 'int' } ou null.
    snap(x, y, r) {
      const cx0 = Math.floor((x - r - this.x0) / this.cell), cx1 = Math.floor((x + r - this.x0) / this.cell);
      const cy0 = Math.floor((y - r - this.y0) / this.cell), cy1 = Math.floor((y + r - this.y0) / this.cell);
      let best = null;
      const consider = (px, py, kind) => {
        const d = Math.hypot(px - x, py - y);
        if (d > r) return;
        // une extrémité l'emporte sur une intersection à peu près aussi proche
        if (!best || d + (kind === 'end' ? 0 : r * 0.15) < best.d + (best.kind === 'end' ? 0 : r * 0.15)) best = { x: px, y: py, kind, d };
      };
      const cand = new Set();
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const k = this.key(cx, cy);
          const ps = this.pgrid.get(k);
          if (ps) for (const p of ps) consider(this.pts[p * 2], this.pts[p * 2 + 1], 'end');
          const ss = this.sgrid.get(k);
          if (ss) for (const s of ss) cand.add(s);
        }
      }
      const list = [...cand].slice(0, 80).map((s) => this.segs.subarray(s * 4, s * 4 + 4));
      for (const s of list) { consider(s[0], s[1], 'end'); consider(s[2], s[3], 'end'); }
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) { const p = intersect(list[i], list[j]); if (p) consider(p[0], p[1], 'int'); }
      return best && { x: best.x, y: best.y, kind: best.kind };
    }
  }

  return { extract, Index, intersect };
});
