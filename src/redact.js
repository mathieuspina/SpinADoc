// Caviardage (logique pure, UMD) : zones à caviarder, recherche d'occurrences (texte, modèles e-mail / téléphone / IBAN), rectangles des occurrences,
// plan d'application (pages à rastériser, objets intégrés à l'image).
//
// Une zone « à caviarder » est un objet de l'historique : { type: 'redact', page, cx, cy, w, h, rot: 0 } (cadre en coordonnées PDF de la page source,
// comme les rectangles). Elle n'est JAMAIS écrite dans le PDF (pdf-edit l'ignore) : seul « Appliquer le caviardage » détruit l'information, en remplaçant
// chaque page concernée par une image où les blocs sont peints (voir src/redact-apply.js). Les zones suivent les opérations de pages comme tout objet.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./shapes.js'), require('./search.js'));
  else root.Redact = factory(root.Shapes, root.Search);
})(typeof self !== 'undefined' ? self : this, function (Shapes, Search) {
  'use strict';

  const MARK = [0.86, 0.1, 0.12]; // rouge des zones à caviarder (aperçu seulement)
  const HATCH = 7; // pas des hachures (pt)
  const LABEL = 'À caviarder';

  // Rectangle [x0, y0, x1, y1] d'une zone (cadre non tourné).
  const rectOf = (o) => [o.cx - o.w / 2, o.cy - o.h / 2, o.cx + o.w / 2, o.cy + o.h / 2];
  const norm = (r) => [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
  const intersects = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  const zoneFromRect = (page, r) => { const [x0, y0, x1, y1] = norm(r); return { type: 'redact', page, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, rot: 0 }; };

  // Aperçu : fond rouge pâle, hachures, bordure et libellé « À caviarder ». Mêmes primitives à l'écran (SVG) ; jamais écrites dans le PDF.
  function primitives(o) {
    const [x0, y0, x1, y1] = rectOf(o);
    const out = [];
    const box = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    out.push({ kind: 'path', segs: Shapes.polySegs(box, true), fill: { color: MARK, opacity: 0.12 }, stroke: null, blend: null });
    const segs = [];
    // hachures : droites x − y = k, découpées au rectangle
    for (let k = Math.ceil((x0 - y1) / HATCH) * HATCH; k < x1 - y0; k += HATCH) {
      const xa = Math.max(x0, y0 + k), xb = Math.min(x1, y1 + k);
      if (xb - xa > 0.01) segs.push(['M', xa, xa - k], ['L', xb, xb - k]);
    }
    if (segs.length) out.push({ kind: 'path', segs, fill: null, stroke: { color: MARK, width: 0.6, opacity: 0.75, dash: null }, blend: null });
    out.push({ kind: 'path', segs: Shapes.polySegs(box, true), fill: null, stroke: { color: MARK, width: 1.2, opacity: 1, dash: null }, blend: null });
    const size = Math.min(8, (y1 - y0) * 0.6);
    if (size >= 4 && x1 - x0 > size * 6) out.push({ kind: 'text', text: LABEL, x: x0 + 2, y: y1 - Shapes.K_BASE * size - 1, size, fontName: 'Helvetica-Bold', color: MARK, rot: 0, opacity: 1 });
    return out;
  }

  // Le cadre est un « frame » (poignées, redimensionnement, déplacement, sélection au clic à l'intérieur) ; pas de rotation.
  Shapes.FRAME.add('redact');
  Shapes.SOLID.add('redact');
  Shapes.register('redact', { primitives, noRotate: true, defaults: () => ({ color: MARK, width: 1.2, opacity: 1, dash: 'solid', fill: null, rot: 0 }), label: 'Zone à caviarder' });

  // ----------------------------------------------------------------------------- recherche
  // Modèles prédéfinis (recherche sur le texte de la page, éléments concaténés comme dans search.js).
  const PATTERNS = {
    email: { label: 'Adresse e-mail', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
    phone: { label: 'Numéro de téléphone', re: /(?:(?:\+|00)\s?33[\s.-]?(?:\(0\)[\s.-]?)?|\b0)[1-9](?:[\s.-]?\d{2}){4}\b/g },
    iban: { label: 'IBAN', re: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){11,30}\b/g, check: ibanValid },
  };

  // Contrôle d'un IBAN (clé modulo 97).
  function ibanValid(s) {
    const t = s.replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(t)) return false;
    const r = t.slice(4) + t.slice(0, 4);
    let m = 0;
    for (const ch of r) {
      const v = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
      for (const d of v) m = (m * 10 + Number(d)) % 97;
    }
    return m === 1;
  }

  // Occurrences d'une expression régulière (même format que Search.findMatches : { start, end, snippet, hit, parts }).
  function findRegex(items, re, check) {
    const { text, ranges } = Search.buildText(items);
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    const res = [];
    let m;
    while ((m = g.exec(text))) {
      if (!m[0].length) { g.lastIndex++; continue; }
      let hit = m[0];
      if (/\s$/.test(hit)) hit = hit.trimEnd();
      if (check && !check(hit)) continue;
      const start = m.index, end = start + hit.length;
      const parts = [];
      for (const r of ranges) {
        if (r.end <= start || r.start >= end || r.end === r.start) continue;
        parts.push({ idx: r.idx, from: Math.max(start, r.start) - r.start, to: Math.min(end, r.end) - r.start });
      }
      const clean = (t) => t.replace(/\s+/g, ' ');
      const pre = clean(text.slice(Math.max(0, start - 30), start)).trimStart();
      const post = clean(text.slice(end, end + 40)).trimEnd();
      res.push({ start, end, snippet: pre + clean(hit) + post, pre, hit: clean(hit), post, parts });
    }
    return res;
  }

  // Recherche : query = texte libre (sans casse ni accents, voir search.js) ou kind = 'email' | 'phone' | 'iban'.
  function find(items, { query, kind }) {
    if (kind && PATTERNS[kind]) return findRegex(items, PATTERNS[kind].re, PATTERNS[kind].check);
    return Search.findMatches(items, query);
  }

  // Début et fin (le long du texte) d'une portion d'élément : la largeur réelle de chaque caractère n'est pas connue (police du fichier). On prend l'UNION
  // de deux estimations — caractères de même largeur (chasse fixe) et proportions de l'Helvetica ramenées à la largeur de l'élément (polices
  // proportionnelles) — plus une marge d'un tiers de corps : le bloc mord un peu sur les voisins plutôt que de laisser dépasser un caractère.
  function spanOf(it, from, to, measure) {
    const n = Math.max(1, it.str.length), s = it.size || 10;
    let a = (from / n) * it.w, b = (to / n) * it.w;
    if (measure) {
      const tot = measure('Helvetica', it.str, 1);
      if (tot > 0) {
        const k = it.w / tot;
        const a2 = measure('Helvetica', it.str.slice(0, from), 1) * k, b2 = a2 + measure('Helvetica', it.str.slice(from, to), 1) * k;
        a = Math.min(a, a2); b = Math.max(b, b2);
      }
    }
    const pad = 0.35 * s;
    return [Math.max(-0.1 * s, a - pad), Math.min(Math.max(it.w, b) + 0.1 * s, b + pad)];
  }

  // Rectangle (axes de la page) d'une portion d'élément de texte, marges comprises (accents, jambages). Élément tourné : rectangle englobant.
  function partRect(it, from, to, measure) {
    if (it.ocr && it.box) { const [a, b, c, d] = it.box; const p = Math.max(0.5, (d - b) * 0.12); return [a - p, b - p, c + p, d + p]; } // mot reconnu : toute sa boîte
    const s = it.size || 10;
    const [u0, u1] = spanOf(it, from, to, measure);
    const v0 = -0.3 * s, v1 = 1.08 * s;
    const a = it.ang || 0, c = Math.cos(a), sn = Math.sin(a);
    const P = (u, v) => [it.x + u * c - v * sn, it.y + u * sn + v * c];
    const pts = [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)];
    return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  }

  // Rectangles d'une occurrence : un par ligne (les portions qui se recouvrent verticalement sont réunies).
  function matchRects(items, match, measure) {
    const rects = [];
    for (const p of match.parts) {
      const it = items[p.idx];
      if (!it || p.to <= p.from || !it.str.slice(p.from, p.to).trim()) continue;
      const r = partRect(it, p.from, p.to, measure);
      const same = rects.find((q) => { const ov = Math.min(q[3], r[3]) - Math.max(q[1], r[1]); return ov > 0.5 * Math.min(q[3] - q[1], r[3] - r[1]) && r[0] <= q[2] + (r[3] - r[1]) && q[0] <= r[2] + (r[3] - r[1]); });
      if (same) { same[0] = Math.min(same[0], r[0]); same[1] = Math.min(same[1], r[1]); same[2] = Math.max(same[2], r[2]); same[3] = Math.max(same[3], r[3]); }
      else rects.push(r);
    }
    return rects;
  }

  // Une zone existe déjà à cet endroit (évite les doublons quand on marque deux fois la même occurrence).
  function covered(edits, page, r) {
    return edits.some((e) => e.type === 'redact' && e.page === page && (() => { const z = rectOf(e); return z[0] <= r[0] + 0.5 && z[1] <= r[1] + 0.5 && z[2] >= r[2] - 0.5 && z[3] >= r[3] - 0.5; })());
  }

  // ----------------------------------------------------------------------------- plan d'application
  // Pages qui ont au moins une zone ; pour chacune : zones (rectangles), objets de l'application posés sur la page (ils sont intégrés à l'image, puis retirés
  // de la liste des objets) et parmi eux ceux qui touchent une zone (ils disparaissent sous le bloc).
  function plan(pages, edits, measure) {
    const by = new Map();
    for (const e of edits) if (e.type === 'redact' && e.w > 0 && e.h > 0 && pages[e.page]) {
      if (!by.has(e.page)) by.set(e.page, { index: e.page, uid: pages[e.page].u, zones: [], burn: [], touching: 0, touchIds: [] });
      by.get(e.page).zones.push(rectOf(e));
    }
    for (const e of edits) {
      const p = e.type !== 'redact' && by.get(e.page);
      if (!p) continue;
      let b = null;
      try { b = Shapes.bounds(e, measure); } catch { b = null; }
      const touch = !b || !isFinite(b.x0) || p.zones.some((z) => intersects(z, [b.x0, b.y0, b.x1, b.y1]));
      if (e.type === 'field' && !touch) continue; // champ de formulaire hors zone : reste un vrai champ (pas intégré à l'image)
      p.burn.push(e);
      if (touch) { p.touching++; p.touchIds.push(e.id); }
    }
    return [...by.values()].sort((a, b) => a.index - b.index);
  }

  // Zones en pixels d'une image de W × H couvrant la zone visible `view` [x0, y0, x1, y1] de la page (non tournée) : arrondies vers l'extérieur,
  // + `grow` pixels (l'anticrénelage du bord ne laisse jamais de trace).
  function pixelRects(zones, view, W, H, grow) {
    const sx = W / (view[2] - view[0]), sy = H / (view[3] - view[1]);
    const g = grow === undefined ? 1 : grow;
    const out = [];
    for (const z of zones) {
      const [x0, y0, x1, y1] = norm(z);
      const px0 = Math.max(0, Math.floor((x0 - view[0]) * sx) - g), px1 = Math.min(W, Math.ceil((x1 - view[0]) * sx) + g);
      const py0 = Math.max(0, Math.floor((view[3] - y1) * sy) - g), py1 = Math.min(H, Math.ceil((view[3] - y0) * sy) + g);
      if (px1 > px0 && py1 > py0) out.push([px0, py0, px1, py1]);
    }
    return out;
  }

  // Résolution effective : `dpi` demandé, réduit pour que l'image ne dépasse pas `maxPixels` (grands formats).
  function effectiveDpi(view, dpi, maxPixels) {
    const wIn = (view[2] - view[0]) / 72, hIn = (view[3] - view[1]) / 72;
    const cap = Math.sqrt(maxPixels / Math.max(1e-6, wIn * hIn));
    return Math.max(36, Math.min(dpi, Math.floor(cap)));
  }

  const isRedactedSrc = (src) => /^rd\d+$/.test(String(src || ''));
  const hasRedacted = (pages) => !!pages && pages.some((p) => isRedactedSrc(p.src));

  return { rectOf, norm, intersects, zoneFromRect, primitives, PATTERNS, ibanValid, findRegex, find, spanOf, partRect, matchRects, covered, plan, pixelRects, effectiveDpi, isRedactedSrc, hasRedacted, MARK, LABEL };
});
