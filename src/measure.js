// Mesures sur plan : échelle, calculs (longueur, surface, angle, cercle), formatage, primitives de dessin, lignes CSV.
// Pur (ni DOM ni Electron). Les primitives ont le même format que Shapes.primitives : aperçu et enregistrement les parcourent à l'identique.
//
// Types d'objets (champ `type`), tous à points PDF (y vers le haut) :
//   'm-dist'   points [A,B]                     showDelta (décomposition ΔX / ΔY)
//   'm-poly'   points [P0..Pn]                  showSegments (longueur de chaque segment)
//   'm-area'   points [P0..Pn] (polygone fermé) holes: [[P…], …] (zones soustraites)
//   'm-angle'  points [A,B,C]                   angle en B
//   'm-dim'    points [A,B], offset (pt)        cote : traits d'attache, flèches, valeur au-dessus du trait
//   'm-circle' points [P1,P2,P3]                rayon / diamètre du cercle passant par les 3 points
// Champs communs : color, width, size (texte), label (libellé libre), lockedText (valeur figée) | null.
// Contexte d'affichage ctx = { scales: { [pageIndex]: { mmPerPt, source, ratio } }, unit: 'mm'|'cm'|'m', precision: 0..3 }.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Measure = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MM_PER_PT = 25.4 / 72; // 1 pt = 1/72 pouce = 0,3528 mm
  const TYPES = ['m-dist', 'm-poly', 'm-area', 'm-angle', 'm-dim', 'm-circle'];
  const LABELS = { 'm-dist': 'Distance', 'm-poly': 'Polyligne', 'm-area': 'Surface', 'm-angle': 'Angle', 'm-dim': 'Cote', 'm-circle': 'Cercle' };
  const PRESETS = [5, 10, 20, 50, 100, 200, 500];
  const isMeasure = (o) => !!o && TYPES.includes(o.type);

  // ------------------------------------------------------------------ échelle et unités (toujours calculées depuis le millimètre : pas de dérive)
  const toMm = (v, unit) => (unit === 'mm' ? v : unit === 'cm' ? v * 10 : v * 1000);
  const fromMm = (mm, unit) => (unit === 'mm' ? mm : unit === 'cm' ? mm / 10 : mm / 1000);
  const areaDiv = (unit) => (unit === 'mm' ? 1 : unit === 'cm' ? 100 : 1e6); // mm² → unité²

  const scaleFromRatio = (n) => ({ mmPerPt: n * MM_PER_PT, source: 'ratio', ratio: n });
  function scaleFromTwoPoints(distPt, realLength, unit) {
    if (!(distPt > 0) || !(realLength > 0)) return null;
    return { mmPerPt: toMm(realLength, unit) / distPt, source: 'points', ratio: null };
  }
  const ratioOf = (s) => s.mmPerPt / MM_PER_PT;

  function fmtNum(x, p) {
    const k = Math.pow(10, p);
    let r = Math.round(x * k) / k;
    if (Object.is(r, -0) || r === 0) r = 0;
    return r.toFixed(p).replace('.', ',');
  }
  function scaleLabel(s) {
    if (!s) return 'non définie';
    if (s.source === 'ratio') return '1:' + fmtNum(s.ratio, Number.isInteger(s.ratio) ? 0 : 1);
    return '≈ 1:' + fmtNum(ratioOf(s), 1);
  }
  const fmtLen = (mm, unit, p) => `${fmtNum(fromMm(mm, unit), p)} ${unit}`;
  const fmtArea = (mm2, unit, p) => `${fmtNum(mm2 / areaDiv(unit), p)} ${unit}²`;

  // ------------------------------------------------------------------ géométrie
  const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const polyLen = (pts) => { let s = 0; for (let i = 0; i < pts.length - 1; i++) s += dist(pts[i], pts[i + 1]); return s; };
  const perimeter = (pts) => (pts.length < 2 ? 0 : polyLen(pts) + dist(pts[pts.length - 1], pts[0]));
  function signedArea(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
  const area = (pts) => Math.abs(signedArea(pts));
  function centroid(pts) {
    const a = signedArea(pts);
    if (Math.abs(a) < 1e-9) return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
    let x = 0, y = 0;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; const f = p[0] * q[1] - q[0] * p[1]; x += (p[0] + q[0]) * f; y += (p[1] + q[1]) * f; }
    return [x / (6 * a), y / (6 * a)];
  }
  // Angle en degrés (0..180) au sommet b entre les demi-droites b→a et b→c.
  function angleDeg(a, b, c) {
    const u = [a[0] - b[0], a[1] - b[1]], v = [c[0] - b[0], c[1] - b[1]];
    const lu = Math.hypot(...u), lv = Math.hypot(...v);
    if (!lu || !lv) return 0;
    return (Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (lu * lv)))) * 180) / Math.PI;
  }
  // Cercle passant par 3 points : { cx, cy, r } ou null (points alignés).
  function circumcircle(a, b, c) {
    const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
    if (Math.abs(d) < 1e-9) return null;
    const a2 = a[0] * a[0] + a[1] * a[1], b2 = b[0] * b[0] + b[1] * b[1], c2 = c[0] * c[0] + c[1] * c[1];
    const cx = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
    const cy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
    return { cx, cy, r: Math.hypot(a[0] - cx, a[1] - cy) };
  }
  // Surface nette d'un polygone avec zones soustraites (trous supposés à l'intérieur).
  const netArea = (o) => Math.max(0, area(o.points) - (o.holes || []).reduce((s, h) => s + area(h), 0));

  // ------------------------------------------------------------------ valeurs et libellés
  const dflt = (ctx) => ({ scales: (ctx && ctx.scales) || {}, unit: (ctx && ctx.unit) || 'm', precision: ctx && ctx.precision !== undefined ? ctx.precision : 2 });
  const scaleFor = (o, ctx) => dflt(ctx).scales[o.page] || null;

  // Valeurs de l'objet en unités réelles (mm / mm² / degrés), avec l'échelle de sa page.
  function valuesOf(o, ctx) {
    const s = scaleFor(o, ctx);
    const k = s ? s.mmPerPt : MM_PER_PT;
    const pts = o.points || [];
    const v = { calibrated: !!s, k };
    if (o.type === 'm-dist' || o.type === 'm-dim') { v.length = dist(pts[0], pts[1]) * k; v.dx = Math.abs(pts[1][0] - pts[0][0]) * k; v.dy = Math.abs(pts[1][1] - pts[0][1]) * k; }
    else if (o.type === 'm-poly') { v.length = polyLen(pts) * k; v.segments = pts.slice(1).map((p, i) => dist(pts[i], p) * k); }
    else if (o.type === 'm-area') {
      v.area = netArea(o) * k * k;
      v.perimeter = (perimeter(pts) + (o.holes || []).reduce((t, h) => t + perimeter(h), 0)) * k;
    } else if (o.type === 'm-angle') v.angle = angleDeg(pts[0], pts[1], pts[2]);
    else if (o.type === 'm-circle') { const c = circumcircle(pts[0], pts[1], pts[2]); v.radius = c ? c.r * k : 0; v.diameter = v.radius * 2; }
    return v;
  }

  // Texte principal affiché (« 5,00 m », « S = 40,00 m² · P = 28,00 m », « 90° »…).
  function describe(o, ctx) {
    const c = dflt(ctx);
    const v = valuesOf(o, ctx);
    let t;
    if (o.lockedText) t = o.lockedText; // valeur verrouillée : ne suit plus l'échelle
    else if (o.type === 'm-dist' || o.type === 'm-poly' || o.type === 'm-dim') t = fmtLen(v.length, c.unit, c.precision);
    else if (o.type === 'm-area') t = `S = ${fmtArea(v.area, c.unit, c.precision)} · P = ${fmtLen(v.perimeter, c.unit, c.precision)}`;
    else if (o.type === 'm-angle') t = `${fmtNum(v.angle, Math.min(c.precision, 2))}°`;
    else if (o.type === 'm-circle') t = `Ø ${fmtLen(v.diameter, c.unit, c.precision)} · R ${fmtLen(v.radius, c.unit, c.precision)}`;
    else t = '';
    if (!v.calibrated && o.type !== 'm-angle' && !o.lockedText) t += ' *'; // * = échelle non définie (papier, 1:1)
    return o.label ? `${o.label} : ${t}` : t;
  }

  // Ligne de tableau / CSV : valeur numérique dans l'unité d'affichage.
  function rowOf(o, ctx) {
    const c = dflt(ctx);
    const v = valuesOf(o, ctx);
    let value = 0, unit = c.unit, kind = 'len';
    if (o.type === 'm-area') { value = v.area / areaDiv(c.unit); unit = c.unit + '²'; kind = 'area'; }
    else if (o.type === 'm-angle') { value = v.angle; unit = '°'; kind = 'angle'; }
    else if (o.type === 'm-circle') { value = v.diameter && fromMm(v.diameter, c.unit); }
    else value = fromMm(v.length, c.unit);
    if (o.lockedText) { const m = /([\d.,]+)/.exec(o.lockedText.replace(/\s/g, '')); if (m) value = parseFloat(m[1].replace(',', '.')); }
    return { id: o.id, page: o.page + 1, type: LABELS[o.type], typeId: o.type, name: o.label || '', value, unit, kind, calibrated: v.calibrated, locked: !!o.lockedText };
  }

  function totalsByType(rows) {
    const t = {};
    for (const r of rows) { const e = t[r.typeId] || (t[r.typeId] = { type: r.type, count: 0, total: 0, unit: r.unit, kind: r.kind }); e.count++; e.total += r.value; }
    return Object.values(t);
  }

  // ------------------------------------------------------------------ CSV (Excel français : « ; », virgule décimale, UTF-8 avec BOM)
  const CSV_BOM = '﻿';
  const csvCell = (s) => { const x = String(s); return /[;"\r\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
  function toCsv(rows, precision) {
    const p = precision === undefined ? 2 : precision;
    const lines = [['Page', 'Type', 'Libellé', 'Valeur', 'Unité'].join(';')];
    for (const r of rows) lines.push([r.page, r.type, r.name, fmtNum(r.value, r.kind === 'angle' ? Math.min(p, 2) : p), r.unit].map(csvCell).join(';'));
    return lines.join('\r\n') + '\r\n';
  }

  // ------------------------------------------------------------------ primitives de dessin (aperçu = enregistrement)
  const poly = (pts, closed) => { const s = pts.map((p, i) => [i ? 'L' : 'M', p[0], p[1]]); if (closed) s.push(['Z']); return s; };
  const FONT = 'Helvetica';

  function arrowTri(tip, dir, L) {
    const nx = -dir[1], ny = dir[0], bx = tip[0] - dir[0] * L, by = tip[1] - dir[1] * L, w = L * 0.35;
    return poly([tip, [bx + nx * w, by + ny * w], [bx - nx * w, by - ny * w]], true);
  }

  // Texte centré en `center`, tourné de `ang` (radians, lisible : jamais à l'envers), fond blanc translucide.
  function labelPrims(out, center, ang, text, size, color, measure, opts) {
    if (!text) return;
    let a = ang;
    if (a > Math.PI / 2 + 1e-9) a -= Math.PI; else if (a <= -Math.PI / 2 + 1e-9) a += Math.PI;
    const w = measure(FONT, text, size);
    const cs = Math.cos(a), sn = Math.sin(a);
    const R = (x, y) => [center[0] + x * cs - y * sn, center[1] + x * sn + y * cs];
    const hw = w / 2 + size * 0.3, hh = size * 0.62;
    if (!opts || opts.bg !== false) out.push({ kind: 'path', segs: poly([R(-hw, -hh), R(hw, -hh), R(hw, hh), R(-hw, hh)], true), fill: { color: [1, 1, 1], opacity: 0.85 }, stroke: null, blend: null });
    const p = R(-w / 2, -size * 0.36);
    out.push({ kind: 'text', text, x: p[0], y: p[1], size, fontName: FONT, color, rot: (a * 180) / Math.PI, opacity: 1 });
  }

  function primitives(o, measure, ctx) {
    const pts = o.points || [];
    const color = o.color || [0, 0.45, 0.8];
    const width = o.width || 1.2;
    const size = o.size || 10;
    const c = dflt(ctx);
    const stroke = (dash) => ({ color, width, opacity: 1, dash: dash || null });
    const line = (segs, dash) => ({ kind: 'path', segs, fill: null, stroke: stroke(dash), blend: null });
    const out = [];
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const ang = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
    const text = describe(o, ctx);
    const v = valuesOf(o, ctx);

    if (o.type === 'm-dist') {
      if (pts.length < 2) return out;
      const [A, B] = pts;
      const a = ang(A, B), nx = -Math.sin(a), ny = Math.cos(a), t = 4;
      out.push(line(poly([A, B])));
      out.push(line(poly([[A[0] + nx * t, A[1] + ny * t], [A[0] - nx * t, A[1] - ny * t]])));
      out.push(line(poly([[B[0] + nx * t, B[1] + ny * t], [B[0] - nx * t, B[1] - ny * t]])));
      if (o.showDelta && Math.abs(B[0] - A[0]) > 1e-6 && Math.abs(B[1] - A[1]) > 1e-6) {
        const K = [B[0], A[1]];
        out.push(line(poly([A, K, B]), [3, 2]));
        labelPrims(out, mid(A, K), 0, 'dX ' + fmtLen(v.dx, c.unit, c.precision), size * 0.85, color, measure);
        labelPrims(out, mid(K, B), Math.PI / 2, 'dY ' + fmtLen(v.dy, c.unit, c.precision), size * 0.85, color, measure);
      }
      labelPrims(out, mid(A, B), a, text, size, color, measure);
    } else if (o.type === 'm-poly') {
      if (pts.length < 2) return out;
      out.push(line(poly(pts)));
      for (const p of pts) out.push(line(poly([[p[0] - 2, p[1]], [p[0] + 2, p[1]]])));
      if (o.showSegments) pts.slice(1).forEach((p, i) => labelPrims(out, mid(pts[i], p), ang(pts[i], p), fmtLen(v.segments[i], c.unit, c.precision), size * 0.8, color, measure));
      // valeur totale au milieu du plus long segment
      let bi = 0, bl = -1;
      pts.slice(1).forEach((p, i) => { const l = dist(pts[i], p); if (l > bl) { bl = l; bi = i; } });
      const c0 = mid(pts[bi], pts[bi + 1]);
      const a0 = ang(pts[bi], pts[bi + 1]);
      const off = o.showSegments ? size * 1.5 : 0;
      labelPrims(out, [c0[0] - Math.sin(a0) * off, c0[1] + Math.cos(a0) * off], a0, text, size, color, measure);
    } else if (o.type === 'm-area') {
      if (pts.length < 3) { if (pts.length === 2) out.push(line(poly(pts))); return out; }
      const rings = [pts, ...(o.holes || [])];
      const segs = [];
      rings.forEach((r, i) => {
        const outerCCW = signedArea(pts) > 0;
        const wantCCW = i === 0 ? outerCCW : !outerCCW; // trous en sens inverse : « troués » à la surface (règle non nulle)
        const rr = (signedArea(r) > 0) === wantCCW ? r : r.slice().reverse();
        segs.push(...poly(rr, true));
      });
      out.push({ kind: 'path', segs, fill: { color, opacity: 0.16 }, stroke: stroke(), blend: null });
      labelPrims(out, centroid(pts), 0, text, size, color, measure);
    } else if (o.type === 'm-angle') {
      if (pts.length < 3) { if (pts.length === 2) out.push(line(poly(pts))); return out; }
      const [A, B, C] = pts;
      out.push(line(poly([A, B, C])));
      const a1 = ang(B, A), a2 = ang(B, C);
      let d = a2 - a1;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      const r = Math.max(6, Math.min(28, 0.4 * Math.min(dist(B, A), dist(B, C))));
      const arc = [];
      for (let i = 0; i <= 24; i++) { const t = a1 + (d * i) / 24; arc.push([B[0] + r * Math.cos(t), B[1] + r * Math.sin(t)]); }
      out.push(line(poly(arc)));
      const tm = a1 + d / 2, rl = r + size * 1.6;
      labelPrims(out, [B[0] + rl * Math.cos(tm), B[1] + rl * Math.sin(tm)], 0, text, size, color, measure);
    } else if (o.type === 'm-dim') {
      if (pts.length < 2) return out;
      const [A, B] = pts;
      const a = ang(A, B), dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
      const d = o.offset === undefined ? 20 : o.offset;
      const A2 = [A[0] + nx * d, A[1] + ny * d], B2 = [B[0] + nx * d, B[1] + ny * d];
      const sgn = d >= 0 ? 1 : -1, gap = 2, beyond = 4;
      out.push(line(poly([[A[0] + nx * gap * sgn, A[1] + ny * gap * sgn], [A2[0] + nx * beyond * sgn, A2[1] + ny * beyond * sgn]])));
      out.push(line(poly([[B[0] + nx * gap * sgn, B[1] + ny * gap * sgn], [B2[0] + nx * beyond * sgn, B2[1] + ny * beyond * sgn]])));
      out.push(line(poly([A2, B2])));
      const L = Math.min(7, dist(A, B) / 3);
      out.push({ kind: 'path', segs: arrowTri(A2, [-dx, -dy], L), fill: { color, opacity: 1 }, stroke: null, blend: null });
      out.push({ kind: 'path', segs: arrowTri(B2, [dx, dy], L), fill: { color, opacity: 1 }, stroke: null, blend: null });
      const m = mid(A2, B2);
      const lift = size * 0.85 * (d >= 0 ? 1 : -1);
      labelPrims(out, [m[0] + nx * lift, m[1] + ny * lift], a, text, size, color, measure, { bg: false });
    } else if (o.type === 'm-circle') {
      if (pts.length < 3) { for (const p of pts) out.push(line(poly([[p[0] - 3, p[1]], [p[0] + 3, p[1]]]))); return out; }
      const cc = circumcircle(pts[0], pts[1], pts[2]);
      if (!cc) { out.push(line(poly(pts))); return out; }
      const K = 0.5522847498 * cc.r, X = cc.cx, Y = cc.cy, r = cc.r;
      out.push(line([['M', X + r, Y], ['C', X + r, Y + K, X + K, Y + r, X, Y + r], ['C', X - K, Y + r, X - r, Y + K, X - r, Y], ['C', X - r, Y - K, X - K, Y - r, X, Y - r], ['C', X + K, Y - r, X + r, Y - K, X + r, Y], ['Z']]));
      out.push(line(poly([[X - 3, Y], [X + 3, Y]])));
      out.push(line(poly([[X, Y - 3], [X, Y + 3]])));
      out.push(line(poly([[X, Y], pts[0]]), [3, 2]));
      labelPrims(out, [X, Y - Math.max(size * 1.4, 0)], 0, text, size, color, measure);
    }
    return out;
  }

  const defaultsFor = (type) => {
    const base = { color: [0, 0.45, 0.8], width: 1.2, size: 10, label: '', lockedText: null };
    if (type === 'm-dist') return Object.assign(base, { showDelta: false });
    if (type === 'm-poly') return Object.assign(base, { showSegments: false });
    if (type === 'm-dim') return Object.assign(base, { offset: 20 });
    if (type === 'm-area') return Object.assign(base, { holes: [] });
    return base;
  };

  return {
    MM_PER_PT, TYPES, LABELS, PRESETS, isMeasure, toMm, fromMm, scaleFromRatio, scaleFromTwoPoints, ratioOf, scaleLabel, fmtNum, fmtLen, fmtArea,
    dist, polyLen, perimeter, area, signedArea, centroid, angleDeg, circumcircle, netArea, valuesOf, describe, rowOf, totalsByType,
    CSV_BOM, toCsv, primitives, defaultsFor,
  };
});
