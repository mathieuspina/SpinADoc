// Géométrie des objets d'annotation, SANS dépendance au DOM ni à Electron.
// Utilisée à la fois par l'aperçu (SVG dans le viewer) et par l'enregistrement (pdf-edit.js) :
// les deux parcourent exactement les mêmes « primitives », ce qui garantit un rendu identique.
//
// Coordonnées : points PDF (origine en bas à gauche, y vers le haut).
//
// FAMILLES D'OBJETS (champ `type`)
//   texte       'add'                     x,y (ligne de base, 1re ligne), text, size, font, bold, italic, align,
//                                         width (largeur fixe → retour automatique) | null, fill, border, color, rot
//   remplacer   'replace'                 (voir pdf-edit.js) texte qui recouvre un texte existant (+ cover)
//   cadre       'rect' 'ellipse' 'hlrect' cx,cy,w,h,rot (+ radius pour rect) ; hlrect = surlignage rectangulaire libre
//   points      'line' 'arrow'            points:[[x,y],[x,y]], arrowStart, arrowEnd
//               'polygon' 'polyline' 'cloud' 'pen'   points:[[x,y],…] (+ arc pour cloud)
//   marquage    'highlight' 'underline' 'strike'     rects:[[x,y,w,h],…] (rectangles de texte)
// Propriétés de style communes : color [r,g,b] (0..1), width (pt), opacity (0..1), dash 'solid'|'dash'|'dot', fill [r,g,b]|null.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./measure.js'));
  else root.Shapes = factory(root.Measure);
})(typeof self !== 'undefined' ? self : this, function (Measure) {
  'use strict';

  const DEG = Math.PI / 180;
  const K_BASE = 0.9465;   // distance du haut de la ligne à la ligne de base, en fraction de la taille
  const LINE_H = 1.2;      // interligne
  const KAPPA = 0.5522847498;

  const FRAME = new Set(['rect', 'ellipse', 'hlrect', 'stamp', 'image', 'sig']);
  const SOLID = new Set(['stamp', 'image', 'sig']);       // cliquables à l'intérieur
  const ASPECT_LOCKED = new Set(['stamp', 'image', 'sig']); // redimensionnement proportionnel (Maj = libre)
  const POINTS = new Set(['line', 'arrow', 'polygon', 'polyline', 'cloud', 'pen', ...Measure.TYPES]); // mesures : voir measure.js
  const MARKUP = new Set(['highlight', 'underline', 'strike']);
  const CLOSED = new Set(['polygon', 'cloud', 'm-area']);

  // Types ajoutés par d'autres modules (voir register) : { primitives, bounds, hit, translate, noRotate, defaults, label }.
  const EXT = {};
  function register(type, impl) { EXT[type] = impl; if (impl.label) LABELS[type] = impl.label; }

  function kindOf(o) {
    if (o.type === 'add' || o.type === 'note' || o.type === 'callout') return 'text';
    if (o.type === 'replace') return 'replace';
    if (FRAME.has(o.type)) return 'frame';
    if (POINTS.has(o.type)) return 'points';
    if (MARKUP.has(o.type)) return 'markup';
    return null;
  }

  // ------------------------------------------------------------------ texte
  const WIN_EXTRA = new Set([0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d,
    0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178]);
  // Les caractères hors jeu WinAnsi (polices standard du PDF) sont remplacés par « ? ».
  function sanitize(text) {
    let out = '';
    for (const ch of String(text)) {
      const c = ch.codePointAt(0);
      if (ch === '\n' || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_EXTRA.has(c)) out += ch;
      else if (c === 0x09) out += '    ';
      else if (c === 0x0d) { /* CRLF : ignoré */ }
      else if (c === 0x202f) out += ' ';
      else out += '?';
    }
    return out;
  }

  const FONT_NAMES = {
    Helvetica: ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'],
    Times: ['Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic'],
    Courier: ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'],
  };
  const CSS_FAMILY = {
    Helvetica: 'Helvetica, Arial, sans-serif',
    Times: '"Times New Roman", Times, serif',
    Courier: '"Courier New", Courier, monospace',
  };
  // Nom de police standard PDF (celui de pdf-lib StandardFonts) pour un objet texte.
  function fontKey(o) {
    const names = FONT_NAMES[o.font] || FONT_NAMES.Helvetica;
    return names[(o.bold ? 1 : 0) + (o.italic ? 2 : 0)];
  }
  const cssFamily = (o) => CSS_FAMILY[o.font] || CSS_FAMILY.Helvetica;

  // Mesure de texte avec les métriques exactes des polices standard (synchrone, identique renderer / Node).
  function makeMeasure(PDFLib) {
    const cache = {};
    return (fontName, text, size) => {
      const e = cache[fontName] || (cache[fontName] = PDFLib.StandardFontEmbedder.for(fontName));
      return e.widthOfTextAtSize(sanitize(text), size);
    };
  }

  function wrapParagraph(para, maxW, width) {
    if (para === '') return [''];
    const words = para.split(' ');
    const lines = [];
    let cur = '';
    const pushLong = (w) => { // mot plus long que la ligne : coupé au caractère
      let part = '';
      for (const ch of w) {
        if (width(part + ch) > maxW && part) { lines.push(part); part = ch; } else part += ch;
      }
      return part;
    };
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      if (width(test) <= maxW) { cur = test; continue; }
      if (cur) { lines.push(cur); cur = ''; }
      cur = width(w) > maxW ? pushLong(w) : w;
    }
    lines.push(cur);
    return lines;
  }

  // Mise en page d'un objet texte : lignes positionnées (non tournées) + boîte englobante.
  function layoutText(o, measure) {
    const size = o.size || 12;
    const fn = fontKey(o);
    const w = (t) => measure(fn, t, size);
    const fixed = o.width > 0 ? o.width : null;
    let lines = [];
    for (const para of sanitize(o.text || '').split('\n')) {
      if (fixed) lines.push(...wrapParagraph(para, fixed, w)); else lines.push(para);
    }
    const widths = lines.map(w);
    const W = fixed || Math.max(0, ...widths);
    const lh = size * LINE_H;
    const H = lines.length * lh;
    const pad = o.type === 'note' ? size * 0.55 : o.type === 'callout' ? size * 0.4 : o.fill || o.border ? size * 0.25 : 0;
    const topText = o.y + K_BASE * size;
    const items = lines.map((t, i) => {
      const lw = widths[i];
      const dx = o.align === 'center' ? (W - lw) / 2 : o.align === 'right' ? W - lw : 0;
      return { text: t, x: o.x + dx, y: o.y - i * lh };
    });
    return { lines: items, W, H, size, fn, box: { x0: o.x - pad, y0: topText - H - pad, x1: o.x + W + pad, y1: topText + pad } };
  }

  const rotAbout = (px, py, ox, oy, a) => {
    const c = Math.cos(a), s = Math.sin(a);
    return [ox + (px - ox) * c - (py - oy) * s, oy + (px - ox) * s + (py - oy) * c];
  };

  // Les 4 coins (tournés) de la boîte d'un texte.
  function textCorners(o, measure) {
    const L = layoutText(o, measure);
    const a = (o.rot || 0) * DEG;
    const b = L.box;
    return [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].map((p) => rotAbout(p[0], p[1], o.x, o.y, a));
  }

  // ------------------------------------------------------------------ recouvrement d'un « replace »
  // cover : { x, y, w, h, rot, ox, oy } — rectangle (non tourné) tourné de `rot` degrés autour du pivot (ox, oy).
  function coverPoly(e) {
    const c = e.cover;
    const a = (c.rot || 0) * DEG;
    const ox = c.ox === undefined ? c.x : c.ox, oy = c.oy === undefined ? c.y : c.oy;
    return [[c.x, c.y], [c.x + c.w, c.y], [c.x + c.w, c.y + c.h], [c.x, c.y + c.h]].map((p) => rotAbout(p[0], p[1], ox, oy, a));
  }
  // Couleur du fond : Auto (détectée), Blanc, ou personnalisée.
  function coverColor(e) {
    if (e.bgMode === 'white') return [1, 1, 1];
    if (e.bgMode === 'custom') return e.bgColor || [1, 1, 1];
    return e.bgAuto || [1, 1, 1];
  }
  function coverPrimitive(e) {
    return { kind: 'path', segs: polySegs(coverPoly(e), true), fill: { color: coverColor(e), opacity: 1 }, stroke: null, blend: null };
  }

  // ------------------------------------------------------------------ chemins
  const M = (x, y) => ['M', x, y];
  const Ln = (x, y) => ['L', x, y];
  const Cb = (a, b, c, d, e, f) => ['C', a, b, c, d, e, f];

  function polySegs(pts, closed) {
    const segs = pts.map((p, i) => (i === 0 ? M(p[0], p[1]) : Ln(p[0], p[1])));
    if (closed) segs.push(['Z']);
    return segs;
  }

  function rectCorners(o) { // coins du cadre, tournés
    const a = (o.rot || 0) * DEG;
    const hw = o.w / 2, hh = o.h / 2;
    return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map((p) => rotAbout(o.cx + p[0], o.cy + p[1], o.cx, o.cy, a));
  }

  function frameSegs(o) {
    const a = (o.rot || 0) * DEG;
    const P = (u, v) => rotAbout(o.cx + u, o.cy + v, o.cx, o.cy, a);
    const hw = o.w / 2, hh = o.h / 2;
    if (o.type === 'ellipse') {
      const k = KAPPA;
      const pt = (u, v) => P(u, v);
      const c = (p, q, r) => Cb(p[0], p[1], q[0], q[1], r[0], r[1]);
      const s = pt(hw, 0);
      return [
        M(s[0], s[1]),
        c(pt(hw, k * hh), pt(k * hw, hh), pt(0, hh)),
        c(pt(-k * hw, hh), pt(-hw, k * hh), pt(-hw, 0)),
        c(pt(-hw, -k * hh), pt(-k * hw, -hh), pt(0, -hh)),
        c(pt(k * hw, -hh), pt(hw, -k * hh), pt(hw, 0)),
        ['Z'],
      ];
    }
    const r = Math.max(0, Math.min(o.radius || 0, hw, hh));
    if (r < 0.05) return polySegs([P(-hw, -hh), P(hw, -hh), P(hw, hh), P(-hw, hh)], true);
    const k = KAPPA * r;
    const p = (u, v) => P(u, v);
    const q = (a1, a2, b1, b2, c1, c2) => { const A = p(a1, a2), B = p(b1, b2), C = p(c1, c2); return Cb(A[0], A[1], B[0], B[1], C[0], C[1]); };
    const st = p(-hw + r, -hh);
    return [
      M(st[0], st[1]),
      Ln(...p(hw - r, -hh)), q(hw - r + k, -hh, hw, -hh + r - k, hw, -hh + r),
      Ln(...p(hw, hh - r)), q(hw, hh - r + k, hw - r + k, hh, hw - r, hh),
      Ln(...p(-hw + r, hh)), q(-hw + r - k, hh, -hw, hh - r + k, -hw, hh - r),
      Ln(...p(-hw, -hh + r)), q(-hw, -hh + r - k, -hw + r - k, -hh, -hw + r, -hh),
      ['Z'],
    ];
  }

  // Nuage de révision : arcs de cercle tournés vers l'extérieur le long du polygone.
  function cloudSegs(pts, arc) {
    if (pts.length < 3) return polySegs(pts, true);
    const target = Math.max(4, arc || 14);
    let area = 0;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; area += p[0] * q[1] - q[0] * p[1]; }
    const sign = area >= 0 ? 1 : -1; // >0 : sens trigonométrique (y vers le haut)
    const segs = [M(pts[0][0], pts[0][1])];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const n = Math.max(1, Math.round(len / target));
      const nx = (dy / len) * sign, ny = (-dx / len) * sign; // normale sortante
      for (let k = 0; k < n; k++) {
        const p0 = [a[0] + (dx * k) / n, a[1] + (dy * k) / n];
        const p1 = [a[0] + (dx * (k + 1)) / n, a[1] + (dy * (k + 1)) / n];
        const r = len / n / 2;
        const h = (4 / 3) * r;
        segs.push(Cb(p0[0] + nx * h, p0[1] + ny * h, p1[0] + nx * h, p1[1] + ny * h, p1[0], p1[1]));
      }
    }
    segs.push(['Z']);
    return segs;
  }

  function arrowHead(tip, dir, L) { // triangle plein, pointe en `tip`
    const nx = -dir[1], ny = dir[0];
    const bx = tip[0] - dir[0] * L, by = tip[1] - dir[1] * L;
    const w = L * 0.42;
    return polySegs([tip, [bx + nx * w, by + ny * w], [bx - nx * w, by - ny * w]], true);
  }

  // Lissage du crayon : suppression des points trop proches puis découpe des coins (Chaikin).
  function smooth(pts, minDist, iterations) {
    const md = minDist || 0.6;
    let a = [];
    for (const p of pts) if (!a.length || Math.hypot(p[0] - a[a.length - 1][0], p[1] - a[a.length - 1][1]) >= md) a.push([p[0], p[1]]);
    if (pts.length && a.length && (a[a.length - 1][0] !== pts[pts.length - 1][0] || a[a.length - 1][1] !== pts[pts.length - 1][1])) a.push([pts[pts.length - 1][0], pts[pts.length - 1][1]]);
    for (let it = 0; it < (iterations === undefined ? 2 : iterations) && a.length > 2; it++) {
      const b = [a[0]];
      for (let i = 0; i < a.length - 1; i++) {
        const p = a[i], q = a[i + 1];
        b.push([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]], [0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]);
      }
      b.push(a[a.length - 1]);
      a = b;
    }
    return a;
  }

  // ------------------------------------------------------------------ primitives (aperçu = enregistrement)
  const dashArray = (o) => {
    const w = Math.max(1, o.width || 1);
    if (o.dash === 'dash') return [w * 4, w * 3];
    if (o.dash === 'dot') return [w, w * 2];
    return null;
  };

  // ------------------------------------------------------------------ tampons, signatures tracées, images
  // 'stamp' : cadre arrondi + texte en capitales (+ date, + nom), vectoriel ; cx, cy, w, h (= taille naturelle × k), rot.
  // 'sig'   : tracés vectoriels normalisés strokes:[[[u,v],…],…] (u,v dans [0,1], v vers le haut) dans le cadre cx, cy, w, h ; w0 = largeur de référence.
  // 'image' : imgId (référence à un fichier image du document), cx, cy, w, h, rot, opacity.
  const STAMP_FONT = 'Helvetica-Bold';
  const STAMPS = [
    { label: 'Approuvé', color: [0.1, 0.55, 0.2] },
    { label: 'Refusé', color: [0.8, 0.1, 0.1] },
    { label: 'Pour information', color: [0.1, 0.35, 0.8] },
    { label: 'À corriger', color: [0.9, 0.5, 0.05] },
    { label: 'Brouillon', color: [0.45, 0.45, 0.45] },
    { label: 'Confidentiel', color: [0.55, 0.05, 0.1] },
  ];
  const pad2 = (n) => String(n).padStart(2, '0');
  const formatDate = (d) => { const x = d || new Date(); return pad2(x.getDate()) + '/' + pad2(x.getMonth() + 1) + '/' + x.getFullYear(); };

  function mapSegs(segs, f) {
    return segs.map((s) => {
      if (s[0] === 'Z') return s;
      if (s[0] === 'C') { const a = f(s[1], s[2]), b = f(s[3], s[4]), c = f(s[5], s[6]); return ['C', a[0], a[1], b[0], b[1], c[0], c[1]]; }
      const p = f(s[1], s[2]);
      return [s[0], p[0], p[1]];
    });
  }
  function roundedLocal(hw, hh, r) {
    const k = KAPPA * r;
    return [M(-hw + r, -hh), Ln(hw - r, -hh), Cb(hw - r + k, -hh, hw, -hh + r - k, hw, -hh + r), Ln(hw, hh - r),
      Cb(hw, hh - r + k, hw - r + k, hh, hw - r, hh), Ln(-hw + r, hh), Cb(-hw + r - k, hh, -hw, hh - r + k, -hw, hh - r),
      Ln(-hw, -hh + r), Cb(-hw, -hh + r - k, -hw + r - k, -hh, -hw + r, -hh), ['Z']];
  }

  // Taille naturelle (échelle 1) d'un tampon d'après son contenu.
  function stampNatural(o, measure) {
    const lines = [{ text: sanitize(String(o.label || '')).toUpperCase(), size: 26 }];
    if (o.date) lines.push({ text: sanitize(o.date), size: 12 });
    if (o.user) lines.push({ text: sanitize(o.user), size: 12 });
    const framed = o.frame !== false;
    const padx = framed ? 16 : 4, pady = framed ? 11 : 3;
    const widths = lines.map((l) => measure(STAMP_FONT, l.text, l.size));
    const bh = lines.reduce((a, l, i) => a + l.size * 1.15 + (i ? 2 : 0), 0);
    return { lines, widths, bh, framed, w: Math.max(...widths, 1) + 2 * padx, h: bh + 2 * pady };
  }
  const stampSize = (o, measure, k) => { const n = stampNatural(o, measure); return { w: n.w * k, h: n.h * k }; };

  function stampPrimitives(o, measure) {
    const nat = stampNatural(o, measure);
    const k = o.w / nat.w;
    const op = o.opacity === undefined ? 1 : o.opacity;
    const a = (o.rot || 0) * DEG;
    const xf = (x, y) => rotAbout(o.cx + k * x, o.cy + k * y, o.cx, o.cy, a);
    const col = o.color || [0.1, 0.55, 0.2];
    const out = [];
    if (nat.framed) {
      out.push({ kind: 'path', segs: mapSegs(roundedLocal(nat.w / 2 - 1.6, nat.h / 2 - 1.6, 9), xf), fill: null, stroke: { color: col, width: 3.2 * k, opacity: op, dash: null }, blend: null });
    }
    let y = nat.bh / 2;
    nat.lines.forEach((l, i) => {
      const gap = i ? 2 : 0;
      const p = xf(-nat.widths[i] / 2, y - gap - l.size * 0.86);
      out.push({ kind: 'text', text: l.text, x: p[0], y: p[1], size: l.size * k, fontName: STAMP_FONT, color: col, rot: o.rot || 0, opacity: op });
      y -= l.size * 1.15 + gap;
    });
    return out;
  }

  function sigPrimitives(o) {
    const op = o.opacity === undefined ? 1 : o.opacity;
    const lw = (o.lw || 2.2) * (o.w / (o.w0 || o.w || 1));
    const a = (o.rot || 0) * DEG;
    const f = (u, v) => rotAbout(o.cx + (u - 0.5) * o.w, o.cy + (v - 0.5) * o.h, o.cx, o.cy, a);
    return (o.strokes || []).filter((s) => s.length).map((s) => {
      const pts = s.map((p) => f(p[0], p[1]));
      if (pts.length === 1) pts.push([pts[0][0] + 0.01, pts[0][1]]); // point isolé : un point rond
      return { kind: 'path', segs: polySegs(pts, false), fill: null, stroke: { color: o.color || [0, 0, 0], width: lw, opacity: op, dash: null }, blend: null };
    });
  }

  // Primitives : { kind:'path', segs, fill:{color,opacity}|null, stroke:{color,width,opacity,dash}|null, blend:'multiply'|null }
  //              { kind:'text', text, x, y, size, fontName, color, rot, opacity }
  // ctx : { measure: { scales, unit, precision } } — contexte d'affichage des mesures (échelle de chaque page).
  function primitives(o, measure, ctx) {
    if (Measure.isMeasure(o)) return Measure.primitives(o, measure, ctx && ctx.measure);
    if (EXT[o.type] && EXT[o.type].primitives) return EXT[o.type].primitives(o, measure, ctx);
    const k = kindOf(o);
    const op = o.opacity === undefined ? 1 : o.opacity;
    const width = o.width === undefined ? 2 : o.width;
    const stroke = () => ({ color: o.color || [0, 0, 0], width, opacity: op, dash: dashArray(o) });
    const fillSpec = () => (o.fill ? { color: o.fill, opacity: op } : null);
    const out = [];

    if (k === 'text' || k === 'replace') {
      const t = k === 'replace' ? Object.assign({}, o, { type: 'add' }) : o;
      const L = layoutText(t, measure);
      const a = (t.rot || 0) * DEG;
      if (t.fill || t.border) {
        const b = L.box;
        const corners = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].map((p) => rotAbout(p[0], p[1], t.x, t.y, a));
        if (t.shadow) out.push({ kind: 'path', segs: polySegs(corners.map((p) => [p[0] + 2.5, p[1] - 2.5]), true), fill: { color: [0, 0, 0], opacity: 0.22 }, stroke: null, blend: null });
        out.push({
          kind: 'path', segs: polySegs(corners, true),
          fill: t.fill ? { color: t.fill, opacity: 1 } : null,
          stroke: t.border ? { color: t.border, width: 1, opacity: 1, dash: null } : null, blend: null,
        });
      }
      for (const it of L.lines) {
        if (!it.text) continue;
        const p = rotAbout(it.x, it.y, t.x, t.y, a);
        out.push({ kind: 'text', text: it.text, x: p[0], y: p[1], size: L.size, fontName: L.fn, color: t.color || [0, 0, 0], rot: t.rot || 0, opacity: 1 });
      }
      return out;
    }

    if (o.type === 'stamp') return stampPrimitives(o, measure);
    if (o.type === 'sig') return sigPrimitives(o);
    if (o.type === 'image') return [{ kind: 'image', imgId: o.imgId, cx: o.cx, cy: o.cy, w: o.w, h: o.h, rot: o.rot || 0, opacity: op }];

    if (k === 'frame') {
      const segs = frameSegs(o);
      if (o.type === 'hlrect') out.push({ kind: 'path', segs, fill: { color: o.color || [1, 0.9, 0.2], opacity: op }, stroke: null, blend: 'multiply' });
      else out.push({ kind: 'path', segs, fill: fillSpec(), stroke: stroke(), blend: null });
      return out;
    }

    if (k === 'markup') {
      for (const r of o.rects || []) {
        const [x, y, w, h] = r;
        if (o.type === 'highlight') {
          out.push({ kind: 'path', segs: polySegs([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true), fill: { color: o.color || [1, 0.9, 0.2], opacity: op }, stroke: null, blend: 'multiply' });
        } else {
          const yy = o.type === 'underline' ? y + h * 0.1 : y + h * 0.36;
          out.push({ kind: 'path', segs: polySegs([[x, yy], [x + w, yy]], false), fill: null, stroke: { color: o.color || [0.9, 0.1, 0.1], width: Math.max(0.8, h * 0.07), opacity: op, dash: null }, blend: null });
        }
      }
      return out;
    }

    if (k === 'points') {
      const pts = o.points || [];
      if (pts.length < 2) return out;
      if (o.type === 'line' || o.type === 'arrow') {
        const p0 = pts[0], p1 = pts[1];
        const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        if (len < 1e-6) return out;
        const dir = [(p1[0] - p0[0]) / len, (p1[1] - p0[1]) / len];
        const L = Math.max(7, width * 4.5);
        let a = p0, b = p1;
        const heads = [];
        const shorten = Math.min(L * 0.7, len / 2.5);
        if (o.arrowEnd) { b = [p1[0] - dir[0] * shorten, p1[1] - dir[1] * shorten]; heads.push(arrowHead(p1, dir, L)); }
        if (o.arrowStart) { a = [p0[0] + dir[0] * shorten, p0[1] + dir[1] * shorten]; heads.push(arrowHead(p0, [-dir[0], -dir[1]], L)); }
        out.push({ kind: 'path', segs: polySegs([a, b], false), fill: null, stroke: stroke(), blend: null });
        for (const h of heads) out.push({ kind: 'path', segs: h, fill: { color: o.color || [0, 0, 0], opacity: op }, stroke: null, blend: null });
        return out;
      }
      if (o.type === 'cloud') {
        out.push({ kind: 'path', segs: cloudSegs(pts, o.arc), fill: fillSpec(), stroke: stroke(), blend: null });
        return out;
      }
      out.push({ kind: 'path', segs: polySegs(pts, CLOSED.has(o.type)), fill: CLOSED.has(o.type) ? fillSpec() : null, stroke: stroke(), blend: null });
      return out;
    }
    return out;
  }

  // Sérialisation d'un chemin en « d » SVG ; `map` transforme un point PDF en point cible.
  const num = (n) => (Math.round(n * 1000) / 1000).toString();
  function pathD(segs, map) {
    const f = map || ((x, y) => [x, y]);
    return segs.map((s) => {
      if (s[0] === 'Z') return 'Z';
      if (s[0] === 'C') { const a = f(s[1], s[2]), b = f(s[3], s[4]), c = f(s[5], s[6]); return `C${num(a[0])} ${num(a[1])} ${num(b[0])} ${num(b[1])} ${num(c[0])} ${num(c[1])}`; }
      const p = f(s[1], s[2]);
      return `${s[0]}${num(p[0])} ${num(p[1])}`;
    }).join(' ');
  }

  // ------------------------------------------------------------------ géométrie : bornes, hit-test, transformations
  const emptyB = () => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  const grow = (b, x, y) => { b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y); };

  // Rectangle englobant aligné sur les axes : { x0, y0, x1, y1 }.
  function bounds(o, measure) {
    const k = kindOf(o);
    const b = emptyB();
    if (k === 'frame') rectCorners(o).forEach((p) => grow(b, p[0], p[1]));
    else if (k === 'points') (o.points || []).forEach((p) => grow(b, p[0], p[1]));
    else if (k === 'markup') (o.rects || []).forEach((r) => { grow(b, r[0], r[1]); grow(b, r[0] + r[2], r[1] + r[3]); });
    else if (k === 'text') textCorners(o, measure).forEach((p) => grow(b, p[0], p[1]));
    else if (k === 'replace') { if (o.cover) coverPoly(o).forEach((p) => grow(b, p[0], p[1])); }
    if (EXT[o.type] && EXT[o.type].bounds) EXT[o.type].bounds(o, b, measure, grow);
    return b;
  }

  const center = (o, measure) => { const b = bounds(o, measure); return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]; };

  function distSeg(px, py, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - a[0]) * dx + (py - a[1]) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
  }
  function inPoly(px, py, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a[1] > py) !== (b[1] > py) && px < ((b[0] - a[0]) * (py - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }

  // Le point (x, y) touche-t-il l'objet ? `tol` en unités PDF (marge de clic).
  function hitTest(o, x, y, tol, measure) {
    if (EXT[o.type] && EXT[o.type].hit && EXT[o.type].hit(o, x, y, tol, measure)) return true;
    const k = kindOf(o);
    const w2 = (o.width === undefined ? 2 : o.width) / 2;
    if (k === 'frame') {
      const a = -(o.rot || 0) * DEG;
      const [u, v] = rotAbout(x, y, o.cx, o.cy, a).map((val, i) => val - (i ? o.cy : o.cx));
      const hw = o.w / 2, hh = o.h / 2;
      const filled = o.type === 'hlrect' || !!o.fill || SOLID.has(o.type);
      let dist; // distance signée au bord (négative à l'intérieur)
      if (o.type === 'ellipse') {
        const r = Math.hypot(u / Math.max(hw, 1e-6), v / Math.max(hh, 1e-6));
        dist = (r - 1) * Math.min(hw, hh);
      } else {
        const dx = Math.abs(u) - hw, dy = Math.abs(v) - hh;
        dist = dx > 0 || dy > 0 ? Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) : Math.max(dx, dy);
      }
      return filled ? dist <= tol : Math.abs(dist) <= tol + w2;
    }
    if (k === 'points') {
      const pts = o.points || [];
      for (let i = 0; i < pts.length - 1; i++) if (distSeg(x, y, pts[i], pts[i + 1]) <= tol + w2) return true;
      if (CLOSED.has(o.type) && pts.length > 2) {
        if (distSeg(x, y, pts[pts.length - 1], pts[0]) <= tol + w2) return true;
        if ((o.fill || o.type === 'm-area') && inPoly(x, y, pts)) return true;
      }
      return false;
    }
    if (k === 'markup') return (o.rects || []).some((r) => x >= r[0] - tol && x <= r[0] + r[2] + tol && y >= r[1] - tol && y <= r[1] + r[3] + tol);
    if (k === 'text') {
      const c = textCorners(o, measure);
      if (inPoly(x, y, c)) return true;
      for (let i = 0; i < 4; i++) if (distSeg(x, y, c[i], c[(i + 1) % 4]) <= tol) return true;
      return false;
    }
    if (k === 'replace') {
      if (!o.cover) return false;
      const poly = coverPoly(o);
      if (inPoly(x, y, poly)) return true;
      for (let i = 0; i < 4; i++) if (distSeg(x, y, poly[i], poly[(i + 1) % 4]) <= tol) return true;
      return false;
    }
    return false;
  }

  // Les objets suivants peuvent-ils être tournés / redimensionnés ?
  const canRotate = (o) => { if (EXT[o.type] && EXT[o.type].noRotate) return false; const k = kindOf(o); return k === 'frame' || k === 'points' || k === 'text'; };
  const canResize = (o) => { const k = kindOf(o); return k === 'frame' || (k === 'points' && o.type !== 'line' && o.type !== 'arrow') || (k === 'text'); };

  // Déplacement (modifie l'objet).
  // boxOnly : pour un objet composé (légende), seule la boîte bouge.
  function translate(o, dx, dy, boxOnly) {
    const k = kindOf(o);
    if (EXT[o.type] && EXT[o.type].translate) EXT[o.type].translate(o, dx, dy, boxOnly);
    if (k === 'frame') { o.cx += dx; o.cy += dy; }
    else if (k === 'points') { o.points = o.points.map((p) => [p[0] + dx, p[1] + dy]); if (o.holes) o.holes = o.holes.map((h) => h.map((p) => [p[0] + dx, p[1] + dy])); }
    else if (k === 'markup') o.rects = o.rects.map((r) => [r[0] + dx, r[1] + dy, r[2], r[3]]);
    else if (k === 'text' || k === 'replace') { o.x += dx; o.y += dy; }
    return o;
  }

  // Rotation de `deg` degrés autour de (cx, cy).
  function rotateBy(o, deg, cx, cy) {
    const k = kindOf(o);
    const a = deg * DEG;
    if (k === 'frame') { const p = rotAbout(o.cx, o.cy, cx, cy, a); o.cx = p[0]; o.cy = p[1]; o.rot = (((o.rot || 0) + deg) % 360 + 360) % 360; }
    else if (k === 'points') { o.points = o.points.map((p) => rotAbout(p[0], p[1], cx, cy, a)); if (o.holes) o.holes = o.holes.map((h) => h.map((p) => rotAbout(p[0], p[1], cx, cy, a))); }
    else if (k === 'text') { const p = rotAbout(o.x, o.y, cx, cy, a); o.x = p[0]; o.y = p[1]; o.rot = (((o.rot || 0) + deg) % 360 + 360) % 360; }
    return o;
  }

  // Redimensionnement d'un objet à points : l'ancienne boîte `from` devient la boîte `to`.
  function resizePoints(o, from, to) {
    const sx = from.x1 - from.x0 > 1e-6 ? (to.x1 - to.x0) / (from.x1 - from.x0) : 1;
    const sy = from.y1 - from.y0 > 1e-6 ? (to.y1 - to.y0) / (from.y1 - from.y0) : 1;
    const f = (p) => [to.x0 + (p[0] - from.x0) * sx, to.y0 + (p[1] - from.y0) * sy];
    o.points = o.points.map(f);
    if (o.holes) o.holes = o.holes.map((h) => h.map(f));
    return o;
  }

  // Nouvel objet avec les valeurs par défaut de son type.
  function defaultsFor(type) {
    const base = { color: [0.88, 0.15, 0.18], width: 2, opacity: 1, dash: 'solid', fill: null };
    const d = {
      line: {}, arrow: { arrowEnd: true }, rect: { radius: 0 }, ellipse: {}, polygon: {}, polyline: {}, cloud: { arc: 14 },
      pen: { color: [0.1, 0.35, 0.9] },
      hlrect: { color: [1, 0.9, 0.2], width: 0 },
      highlight: { color: [1, 0.9, 0.2], width: 0 },
      underline: { color: [0.9, 0.1, 0.1] }, strike: { color: [0.9, 0.1, 0.1] },
      note: { color: [0.15, 0.12, 0], size: 11, font: 'Helvetica', bold: false, italic: false, align: 'left', width: 170, fill: [1, 0.96, 0.6], border: [0.8, 0.68, 0.2], rot: 0, shadow: false },
      stamp: { label: 'Approuvé', color: [0.1, 0.55, 0.2], frame: true, date: null, user: null, withDate: false, withUser: false, tilt: false, opacity: 1 },
      sig: { color: [0, 0, 0], opacity: 1 },
      image: { opacity: 1 },
      add: { color: [0, 0, 0], size: 12, font: 'Helvetica', bold: false, italic: false, align: 'left', width: null, fill: null, border: null, rot: 0 },
    };
    if (Measure.isMeasure({ type })) return Measure.defaultsFor(type);
    if (EXT[type] && EXT[type].defaults) return Object.assign({}, base, EXT[type].defaults());
    return Object.assign({}, base, d[type] || {});
  }

  // Étiquette lisible d'un type d'objet.
  const LABELS = Object.assign({}, Measure.LABELS, {
    note: 'Note', stamp: 'Tampon', image: 'Image', sig: 'Signature',
    add: 'Texte', replace: 'Texte modifié', line: 'Ligne', arrow: 'Flèche', rect: 'Rectangle', ellipse: 'Ellipse', polygon: 'Polygone',
    polyline: 'Polyligne', cloud: 'Nuage', pen: 'Crayon', hlrect: 'Surlignage', highlight: 'Surlignage du texte',
    underline: 'Soulignement', strike: 'Texte barré',
  });

  return {
    coverPoly, coverColor, coverPrimitive, kindOf, sanitize, fontKey, cssFamily, makeMeasure, layoutText, textCorners, primitives, pathD, polySegs, smooth,
    register, arrowHead, rotAbout, distSeg, bounds, center, hitTest, canRotate, canResize, translate, rotateBy, resizePoints, rectCorners, defaultsFor, dashArray,
    STAMPS, formatDate, stampNatural, stampSize, ASPECT_LOCKED, SOLID,
    LABELS, DEG, K_BASE, LINE_H, FRAME, POINTS, MARKUP, CLOSED,
  };
});
