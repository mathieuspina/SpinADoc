// Analyse d'un élément de texte existant (« Modifier texte ») : géométrie (y compris texte incliné / vertical),
// police d'origine → police standard la plus proche, couleur du texte et couleur du fond.
// Pur : aucun accès au DOM (le rendu d'échantillonnage passe par `makeCanvas`) ; utilisable dans le renderer et dans Node.
//
// Couleur et fond sont mesurés sur un rendu de la zone du texte à fort grossissement (échantillonnage), pas en suivant les
// opérateurs de couleur du flux PDF : PDF.js ne fournit pas de lien fiable entre un élément de getTextContent() et les
// opérateurs showText d'origine (éléments fusionnés ou découpés), alors que le rendu reflète exactement ce qui est affiché
// (pile q/Q, gris/RVB/CMJN, motifs…). Voir README.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TextInfo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEG = Math.PI / 180;

  // Éléments de texte d'une page : { str, hasEOL, x, y, w, size, ang (radians), fontName, upright, editable }
  function itemsFromContent(tc) {
    const out = [];
    for (const it of tc.items) {
      if (typeof it.str !== 'string') continue;
      const t = it.transform;
      const size = Math.hypot(t[0], t[1]);
      const det = t[0] * t[3] - t[1] * t[2];
      const ang = Math.atan2(t[1], t[0]);
      out.push({
        str: it.str, hasEOL: !!it.hasEOL, x: t[4], y: t[5], w: it.width, size, ang, fontName: it.fontName,
        upright: Math.abs(ang) < 1e-3 && t[0] > 0,
        editable: size > 0 && det > 0 && it.width > 0 && it.str.trim() !== '',
      });
    }
    return out;
  }

  // Rectangle de recouvrement (spécification du projet), tourné avec le texte autour de son origine (ox, oy).
  function coverFor(item) {
    const s = item.size;
    return { x: item.x, y: item.y - 0.25 * s, w: item.w + 1, h: 1.15 * s, rot: (item.ang || 0) / DEG, ox: item.x, oy: item.y };
  }

  function coverCorners(c) {
    const a = (c.rot || 0) * DEG;
    const ox = c.ox === undefined ? c.x : c.ox, oy = c.oy === undefined ? c.y : c.oy;
    const cs = Math.cos(a), sn = Math.sin(a);
    return [[c.x, c.y], [c.x + c.w, c.y], [c.x + c.w, c.y + c.h], [c.x, c.y + c.h]].map((p) => {
      const dx = p[0] - ox, dy = p[1] - oy;
      return [ox + dx * cs - dy * sn, oy + dx * sn + dy * cs];
    });
  }

  // Le point PDF (px, py) est-il sur le texte ? (repère de l'élément : tient compte de l'inclinaison)
  function hitItem(item, px, py) {
    const a = -(item.ang || 0);
    const dx = px - item.x, dy = py - item.y;
    const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    return lx >= 0 && lx <= item.w + 1 && ly >= -0.25 * item.size && ly <= 0.9 * item.size;
  }

  // ---- police
  // info : { name, bold, italic, isSerif, isMono, family } → police standard la plus proche.
  function fontChoice(info) {
    const raw = info.name || '';
    const embedded = /^[A-Z]{6}\+/.test(raw); // sous-ensemble incorporé : non réutilisable
    const name = raw.replace(/^[A-Z]{6}\+/, '');
    const n = name.toLowerCase();
    let font = 'Helvetica';
    if (info.isMono || info.family === 'monospace' || /courier|mono|consolas|lucida console|typewriter/.test(n)) font = 'Courier';
    else if (!/sans|arial|helvet|verdana|calibri|tahoma|segoe|gothic|univers|frutiger/.test(n)
      && (info.isSerif || info.family === 'serif' || /times|serif|georgia|garamond|minion|palatino|cambria|bookman|century/.test(n))) font = 'Times';
    return {
      font,
      bold: !!info.bold || /bold|black|heavy|demi|semibold/.test(n),
      italic: !!info.italic || /italic|oblique|-it$|ital\b/.test(n),
      origName: name || (info.family || 'inconnue'),
      embedded,
    };
  }

  const fontLabel = (o) => `${o.font || 'Helvetica'}${o.bold ? ' gras' : ''}${o.italic ? ' italique' : ''}`;

  // Informations de police d'un élément via PDF.js (commonObjs) ; repli sur la famille CSS de getTextContent().
  async function fontInfo(page, item, styles) {
    const style = (styles && styles[item.fontName]) || {};
    const info = { family: /^(serif|sans-serif|monospace)$/.test(style.fontFamily || '') ? style.fontFamily : '' };
    try {
      const f = await Promise.race([
        new Promise((res) => { page.commonObjs.get(item.fontName, res); }),
        new Promise((res) => setTimeout(() => res(null), 600)),
      ]);
      if (f) {
        info.name = f.name || f.fallbackName || '';
        info.bold = f.bold || f.black;
        info.italic = f.italic;
        info.isSerif = f.isSerifFont;
        info.isMono = f.isMonospace;
      }
    } catch { /* repli : famille CSS seulement */ }
    return fontChoice(info);
  }

  // ---- couleurs par échantillonnage
  const key = (r, g, b) => ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);

  // makeCanvas(w, h) → { ctx, render } où `render` est un objet fusionné dans les options de page.render() (ex. canvasFactory).
  async function sampleColors(page, item, makeCanvas) {
    const cov = coverFor(item);
    const poly = coverCorners(cov);
    const m = 2; // marge (pt) autour du texte : sert à mesurer le fond
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    const x0 = Math.min(...xs) - m, x1 = Math.max(...xs) + m, y0 = Math.min(...ys) - m, y1 = Math.max(...ys) + m;
    const sc = Math.max(1, Math.min(8, 380 / Math.max(x1 - x0, y1 - y0)));
    const vp = page.getViewport({ scale: sc, rotation: 0 });
    const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map((p) => vp.convertToViewportPoint(p[0], p[1]));
    const minX = Math.floor(Math.min(...corners.map((c) => c[0]))), minY = Math.floor(Math.min(...corners.map((c) => c[1])));
    const W = Math.max(2, Math.ceil(Math.max(...corners.map((c) => c[0])) - minX)), H = Math.max(2, Math.ceil(Math.max(...corners.map((c) => c[1])) - minY));
    const cv = makeCanvas(W, H);
    await page.render(Object.assign({ canvasContext: cv.ctx, viewport: vp, transform: [1, 0, 0, 1, -minX, -minY], background: 'rgb(255,255,255)' }, cv.render || {})).promise;
    const d = cv.ctx.getImageData(0, 0, W, H).data;
    const pp = poly.map((p) => { const q = vp.convertToViewportPoint(p[0], p[1]); return [q[0] - minX, q[1] - minY]; });
    const inside = (x, y) => {
      let ins = false;
      for (let i = 0, j = pp.length - 1; i < pp.length; j = i++) {
        if ((pp[i][1] > y) !== (pp[j][1] > y) && x < ((pp[j][0] - pp[i][0]) * (y - pp[i][1])) / (pp[j][1] - pp[i][1]) + pp[i][0]) ins = !ins;
      }
      return ins;
    };
    // Fond : couleur dominante des pixels hors du rectangle du texte.
    const bins = new Map();
    const ins = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        if (inside(x + 0.5, y + 0.5)) { ins.push(i); continue; }
        const k = key(r, g, b);
        const e = bins.get(k) || { n: 0, r: 0, g: 0, b: 0 };
        e.n++; e.r += r; e.g += g; e.b += b;
        bins.set(k, e);
      }
    }
    let best = null;
    for (const e of bins.values()) if (!best || e.n > best.n) best = e;
    const bg = best ? [best.r / best.n, best.g / best.n, best.b / best.n] : [255, 255, 255];
    // Texte : moyenne des pixels intérieurs les plus éloignés du fond.
    const dist = (i) => Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2]);
    let maxd = 0;
    for (const i of ins) maxd = Math.max(maxd, dist(i));
    let ink = null;
    if (maxd >= 40) {
      let n = 0, r = 0, g = 0, b = 0;
      for (const i of ins) { if (dist(i) >= maxd * 0.7) { n++; r += d[i]; g += d[i + 1]; b += d[i + 2]; } }
      if (n) ink = [r / n, g / n, b / n];
    }
    const norm = (c) => c.map((v) => Math.round((v / 255) * 100) / 100);
    const snap = (c) => (c.every((v) => v < 0.15) ? [0, 0, 0] : c.every((v) => v > 0.93) ? [1, 1, 1] : c);
    const bgn = snap(norm(bg));
    return { ink: ink ? snap(norm(ink)) : null, bg: bgn };
  }

  // Analyse complète d'un élément : police + couleurs.
  async function analyze(page, item, styles, makeCanvas) {
    const [font, colors] = await Promise.all([fontInfo(page, item, styles), sampleColors(page, item, makeCanvas).catch(() => ({ ink: null, bg: [1, 1, 1] }))]);
    return { font, ink: colors.ink, bg: colors.bg };
  }

  // Champs d'une modification « replace » à partir d'un élément analysé (le texte est celui d'origine).
  function buildReplaceEdit(item, info, pageIndex, srcKey) {
    return {
      type: 'replace', page: pageIndex, x: item.x, y: item.y, text: item.str, size: item.size,
      color: info.ink || [0, 0, 0], rot: Math.round((item.ang / DEG) * 100) / 100,
      font: info.font.font, bold: info.font.bold, italic: info.font.italic,
      origFont: info.font.origName, origEmbedded: info.font.embedded,
      cover: coverFor(item), bgAuto: info.bg, bgMode: 'auto', bgColor: null, srcKey,
    };
  }

  return { itemsFromContent, coverFor, coverCorners, hitItem, fontChoice, fontLabel, fontInfo, sampleColors, analyze, buildReplaceEdit, DEG };
});
