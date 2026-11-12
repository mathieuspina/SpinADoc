// Légende fléchée : boîte de texte + ligne de repère jusqu'à une pointe (UMD, pur : aucune dépendance au DOM).
// Objet : { type: 'callout', x, y (ligne de base de la 1re ligne, comme 'add'), text, size, font, bold, italic, align, width (largeur fixe | null), rot,
//           color (texte), fill (fond | null), border (bordure | null), borderWidth, lineColor, lineWidth, tip: [x, y] (pointe), tipStyle 'arrow'|'dot'|'none',
//           elbow (ligne à coude), opacity }.
// La boîte est la boîte d'un texte (Shapes.layoutText) ; le repère part du CÔTÉ de la boîte le plus proche de la pointe (ligne droite) ou du côté
// gauche / droit (ligne à coude : un segment horizontal près de la boîte, dans le sens du texte). Aperçu SVG et écriture PDF parcourent les mêmes
// primitives (Shapes.primitives) : le rendu est identique.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./shapes.js'));
  else root.Callout = factory(root.Shapes);
})(typeof self !== 'undefined' ? self : this, function (Shapes) {
  'use strict';

  const DEG = Shapes.DEG;
  const rotAbout = Shapes.rotAbout;
  const KAPPA = 0.5522847498;

  const DEFAULTS = {
    color: [0, 0, 0], size: 11, font: 'Helvetica', bold: false, italic: false, align: 'left', width: null, rot: 0, opacity: 1,
    fill: [1, 1, 1], border: [0.88, 0.15, 0.18], borderWidth: 1, lineColor: [0.88, 0.15, 0.18], lineWidth: 1.5, tipStyle: 'arrow', elbow: false,
  };
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

  // Géométrie : boîte (repère local = non tournée, origine (x, y)), côté d'accroche, polyligne du repère (coordonnées PDF).
  function geometry(o, measure) {
    const L = Shapes.layoutText(o, measure);
    const b = L.box;
    const a = (o.rot || 0) * DEG;
    const glob = (p) => rotAbout(p[0], p[1], o.x, o.y, a);
    const tip = rotAbout(o.tip[0], o.tip[1], o.x, o.y, -a); // pointe dans le repère local
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, w = Math.max(1e-6, b.x1 - b.x0), h = Math.max(1e-6, b.y1 - b.y0);
    const inside = tip[0] >= b.x0 && tip[0] <= b.x1 && tip[1] >= b.y0 && tip[1] <= b.y1;
    let side, anchor, pts;
    if (o.elbow) {
      side = tip[0] >= cx ? 'right' : 'left';
      anchor = side === 'right' ? [b.x1, cy] : [b.x0, cy];
      const run = Math.max(6, (o.size || 12) * 0.9);
      const knee = [anchor[0] + (side === 'right' ? run : -run), anchor[1]];
      // pointe plus proche de la boîte que le coude : pas de coude, ligne directe
      const beyond = side === 'right' ? tip[0] > knee[0] : tip[0] < knee[0];
      pts = beyond ? [anchor, knee, tip] : [anchor, tip];
    } else {
      const dx = tip[0] - cx, dy = tip[1] - cy;
      if (Math.abs(dx) / w >= Math.abs(dy) / h) { side = dx >= 0 ? 'right' : 'left'; anchor = [dx >= 0 ? b.x1 : b.x0, cy]; }
      else { side = dy >= 0 ? 'top' : 'bottom'; anchor = [cx, dy >= 0 ? b.y1 : b.y0]; } // y vers le haut : pointe au-dessus = côté haut
      pts = [anchor, tip];
    }
    const corners = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].map(glob);
    return { L, box: b, side, inside, anchor: glob(anchor), points: pts.map(glob), corners, a };
  }

  const circleSegs = (cx, cy, r) => {
    const k = r * KAPPA;
    return [['M', cx + r, cy], ['C', cx + r, cy + k, cx + k, cy + r, cx, cy + r], ['C', cx - k, cy + r, cx - r, cy + k, cx - r, cy], ['C', cx - r, cy - k, cx - k, cy - r, cx, cy - r], ['C', cx + k, cy - r, cx + r, cy - k, cx + r, cy], ['Z']];
  };

  function primitives(o, measure) {
    const op = num(o.opacity, 1);
    const lw = num(o.lineWidth, DEFAULTS.lineWidth);
    const lc = o.lineColor || DEFAULTS.lineColor;
    const g = geometry(o, measure);
    const out = [];
    const style = (o.tipStyle || 'arrow');
    // 1. repère (sous la boîte)
    if (!g.inside && g.points.length >= 2) {
      let pts = g.points.map((p) => p.slice());
      let head = null;
      const n = pts.length, tip = pts[n - 1], prev = pts[n - 2];
      const len = Math.hypot(tip[0] - prev[0], tip[1] - prev[1]);
      if (style === 'arrow' && len > 1e-6) {
        const dir = [(tip[0] - prev[0]) / len, (tip[1] - prev[1]) / len];
        const Lh = Math.max(7, lw * 4.5);
        const shorten = Math.min(Lh * 0.7, len / 2.5);
        pts[n - 1] = [tip[0] - dir[0] * shorten, tip[1] - dir[1] * shorten];
        head = Shapes.arrowHead(tip, dir, Lh);
      }
      out.push({ kind: 'path', segs: Shapes.polySegs(pts, false), fill: null, stroke: { color: lc, width: lw, opacity: op, dash: null }, blend: null });
      if (head) out.push({ kind: 'path', segs: head, fill: { color: lc, opacity: op }, stroke: null, blend: null });
    }
    if (style === 'dot') out.push({ kind: 'path', segs: circleSegs(o.tip[0], o.tip[1], Math.max(2.5, lw * 1.8)), fill: { color: lc, opacity: op }, stroke: null, blend: null });
    // 2. boîte (fond, bordure) puis texte
    if (o.fill || o.border) {
      out.push({
        kind: 'path', segs: Shapes.polySegs(g.corners, true),
        fill: o.fill ? { color: o.fill, opacity: op } : null,
        stroke: o.border ? { color: o.border, width: num(o.borderWidth, 1), opacity: op, dash: null } : null, blend: null,
      });
    }
    for (const it of g.L.lines) {
      if (!it.text) continue;
      const p = rotAbout(it.x, it.y, o.x, o.y, g.a);
      out.push({ kind: 'text', text: it.text, x: p[0], y: p[1], size: g.L.size, fontName: g.L.fn, color: o.color || [0, 0, 0], rot: o.rot || 0, opacity: op });
    }
    return out;
  }

  // Hooks de Shapes : étendre la boîte englobante, test de clic sur le repère, déplacement, valeurs par défaut.
  function bounds(o, b, measure, grow) {
    if (!o.tip) return;
    const g = geometry(o, measure);
    for (const p of g.points) grow(b, p[0], p[1]);
    const r = Math.max(2.5, num(o.lineWidth, DEFAULTS.lineWidth) * 1.8);
    grow(b, o.tip[0] - r, o.tip[1] - r); grow(b, o.tip[0] + r, o.tip[1] + r);
  }
  function hit(o, x, y, tol, measure) {
    if (!o.tip) return false;
    const g = geometry(o, measure);
    const w2 = num(o.lineWidth, DEFAULTS.lineWidth) / 2;
    if (Math.hypot(x - o.tip[0], y - o.tip[1]) <= tol + Math.max(2.5, w2 * 3.6)) return true;
    if (g.inside) return false;
    for (let i = 0; i < g.points.length - 1; i++) if (Shapes.distSeg(x, y, g.points[i], g.points[i + 1]) <= tol + w2) return true;
    return false;
  }
  // boxOnly : seule la boîte bouge (la pointe reste en place, le repère suit) ; sinon tout l'objet se déplace.
  function translate(o, dx, dy, boxOnly) { if (!boxOnly && o.tip) o.tip = [o.tip[0] + dx, o.tip[1] + dy]; }
  // La pointe est-elle sur le texte (clic dans la boîte, pas sur le repère) ?
  function inBox(o, x, y, measure) { return Shapes.hitTest(Object.assign({}, o, { type: 'add', fill: o.fill || [1, 1, 1] }), x, y, 0, measure); }

  Shapes.register('callout', {
    primitives, bounds, hit, translate, noRotate: true, label: 'Légende',
    defaults: () => Object.assign({}, DEFAULTS),
  });

  return { geometry, primitives, inBox, DEFAULTS, circleSegs };
});
