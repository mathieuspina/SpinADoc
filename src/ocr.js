// OCR : logique pure (UMD : navigateur, Node). Aucune dépendance à tesseract.js : ce module prépare le travail (plan de rendu par tuiles),
// transforme et fusionne les résultats (mots + boîtes + confiance, en coordonnées PDF de la page SOURCE, avant rotation ajoutée et recadrage),
// et fournit la géométrie partagée par l'affichage (calque de sélection, recherche) et l'écriture (couche de texte invisible).
//
// Un mot : { t, x0, y0, x1, y1, c, a } — texte, boîte (boîte englobante alignée sur les axes de l'espace utilisateur PDF, y vers le haut),
// confiance 0–100, angle (degrés, sens trigonométrique, multiple de 90) de la ligne de base du texte dans l'espace utilisateur.
// Un enregistrement de page (doc.ocr[uid]) : { words, lang, quality, mode, n, conf } — immuable (jamais modifié en place).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Ocr = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const QUALITY = { fast: { dpi: 150, label: 'Rapide' }, standard: { dpi: 300, label: 'Standard' }, fine: { dpi: 400, label: 'Fine' } };
  const TILE = 2000; // côté d'une tuile (px)
  const OVERLAP = 140;
  const MAX_FULL_PX = 40e6; // en dessous : page entière en un seul passage (mode texte)
  const MAX_TILES = 80;
  const MIN_CONF_KEEP = 8; // en dessous, le « mot » est du bruit

  // ---------------------------------------------------------------- plan de rendu
  // Résolution (px par point) et tuiles. Le plafond de tuiles borne la durée et la mémoire sur les grands formats (A1/A0) : la résolution baisse
  // au besoin (jamais sous ~170 dpi : en dessous les petits textes ne sont plus lisibles). Une tuile n'est rendue qu'au moment de son traitement.
  function plan(wPt, hPt, opts) {
    const o = Object.assign({ quality: 'standard', mode: 'text' }, opts || {});
    const q = QUALITY[o.quality] || QUALITY.standard;
    let k = q.dpi / 72;
    const area = (kk) => wPt * kk * hPt * kk;
    const tiling = o.mode === 'plan' || area(k) > MAX_FULL_PX;
    if (tiling) {
      const step = TILE - OVERLAP;
      const count = (kk) => Math.ceil(Math.max(1, (wPt * kk - OVERLAP) / step)) * Math.ceil(Math.max(1, (hPt * kk - OVERLAP) / step));
      while (count(k) > MAX_TILES && k * 72 > 170) k *= 0.93;
    }
    const W = Math.max(1, Math.round(wPt * k)), H = Math.max(1, Math.round(hPt * k));
    return { k, dpi: k * 72, W, H, tiles: tiling ? tileRects(W, H) : [{ x: 0, y: 0, w: W, h: H }], tiled: tiling };
  }
  function tileRects(W, H, tile, overlap) {
    const T = tile || TILE, ov = overlap === undefined ? OVERLAP : overlap, step = T - ov;
    const out = [];
    for (let y = 0; ; y += step) {
      const h = Math.min(T, H - y);
      for (let x = 0; ; x += step) {
        const w = Math.min(T, W - x);
        out.push({ x, y, w, h });
        if (x + T >= W) break;
      }
      if (y + T >= H) break;
    }
    return out;
  }

  // ---------------------------------------------------------------- rotation d'une image d'entrée
  // Une tuile peut être lue tournée de θ (0, 90, 180, 270, sens horaire) : boîte (dans l'image tournée) → boîte dans l'image d'origine (w × h).
  function unrotateBox(b, theta, w, h) {
    const pt = (x, y) => { // point de l'image tournée → image d'origine
      if (theta === 90) return [y, h - x]; // tournée de 90° horaire : (x, y) = (h - y0, x0)
      if (theta === 180) return [w - x, h - y];
      if (theta === 270) return [w - y, x];
      return [x, y];
    };
    const p = pt(b.x0, b.y0), q = pt(b.x1, b.y1);
    return { x0: Math.min(p[0], q[0]), y0: Math.min(p[1], q[1]), x1: Math.max(p[0], q[0]), y1: Math.max(p[1], q[1]) };
  }

  // ---------------------------------------------------------------- résultats
  // blocks de tesseract.js → mots en pixels : [{ t, x0, y0, x1, y1, c }]
  function wordsFromBlocks(blocks) {
    const out = [];
    for (const b of blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) {
      const t = String(w.text || '').trim();
      if (!t || !w.bbox || w.confidence < MIN_CONF_KEEP) continue;
      out.push({ t, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, c: Math.round(w.confidence) });
    }
    return out;
  }

  // Mots d'une tuile (pixels de la tuile, lue tournée de theta) → mots de la page en coordonnées PDF.
  // tile : { x, y, w, h } ; convert(px, py) → [X, Y] (viewport.convertToPdfPoint) ; vpRot : rotation (degrés horaires) du viewport utilisé pour le rendu.
  function toUser(words, tile, theta, convert, vpRot) {
    const out = [];
    // image lue tournée de θ (horaire) : le texte y apparaît, dans l'image d'origine, orienté de θ (antihoraire) par rapport à l'horizontale
    const dv = theta % 360;
    const a = (((dv + vpRot) % 360) + 360) % 360;
    for (const w of words) {
      const b = theta ? unrotateBox(w, theta, tile.w, tile.h) : w;
      const p = convert(b.x0 + tile.x, b.y0 + tile.y), q = convert(b.x1 + tile.x, b.y1 + tile.y);
      out.push({ t: w.t, x0: Math.min(p[0], q[0]), y0: Math.min(p[1], q[1]), x1: Math.max(p[0], q[0]), y1: Math.max(p[1], q[1]), c: w.c, a });
    }
    return out;
  }

  const area = (w) => Math.max(0, w.x1 - w.x0) * Math.max(0, w.y1 - w.y0);
  function overlapFrac(a, b) {
    const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    if (ix <= 0 || iy <= 0) return 0;
    return (ix * iy) / Math.max(1e-9, Math.min(area(a), area(b)));
  }
  // Fusion des mots de plusieurs tuiles / orientations : deux mots qui se recouvrent beaucoup sont le même mot (on garde le plus sûr).
  function mergeWords(lists) {
    const all = [].concat(...lists).filter((w) => area(w) > 0).sort((p, q) => q.c - p.c);
    const kept = [];
    const cell = 50, grid = new Map();
    const key = (x, y) => Math.floor(x / cell) + ',' + Math.floor(y / cell);
    for (const w of all) {
      let dup = false;
      for (let gx = Math.floor(w.x0 / cell); gx <= Math.floor(w.x1 / cell) && !dup; gx++) {
        for (let gy = Math.floor(w.y0 / cell); gy <= Math.floor(w.y1 / cell) && !dup; gy++) {
          for (const k of grid.get(gx + ',' + gy) || []) if (overlapFrac(w, k) > 0.5) { dup = true; break; }
        }
      }
      if (dup) continue;
      kept.push(w);
      for (let gx = Math.floor(w.x0 / cell); gx <= Math.floor(w.x1 / cell); gx++) for (let gy = Math.floor(w.y0 / cell); gy <= Math.floor(w.y1 / cell); gy++) { const kk = gx + ',' + gy; (grid.get(kk) || grid.set(kk, []).get(kk)).push(w); }
    }
    void key;
    return kept;
  }

  const round1 = (v) => Math.round(v * 10) / 10;
  // Enregistrement de page prêt à ranger dans doc.ocr (arrondis, ordre de lecture, statistiques).
  function makeRecord(words, meta) {
    const ws = readingOrder(words).map((w) => ({ t: w.t, x0: round1(w.x0), y0: round1(w.y0), x1: round1(w.x1), y1: round1(w.y1), c: w.c, a: w.a || 0 }));
    const n = ws.length;
    return Object.freeze(Object.assign({ words: ws, n, conf: n ? Math.round(ws.reduce((s, w) => s + w.c, 0) / n) : 0 }, meta || {}));
  }

  // ---------------------------------------------------------------- ordre de lecture et texte
  // Lignes (mots horizontaux d'abord, de haut en bas, de gauche à droite), puis les mots d'autres orientations (par angle, puis de haut en bas).
  function lines(words) {
    const horiz = words.filter((w) => !w.a), other = words.filter((w) => w.a);
    horiz.sort((p, q) => (p.y1 + p.y0) - (q.y1 + q.y0));
    const out = [];
    for (const w of horiz.slice().sort((p, q) => (q.y1 + q.y0) - (p.y1 + p.y0))) { // y vers le haut : du haut de la page vers le bas
      const cy = (w.y0 + w.y1) / 2, h = w.y1 - w.y0;
      const ln = out.find((l) => Math.abs(l.cy - cy) < Math.max(h, l.h) * 0.5);
      if (ln) { ln.words.push(w); ln.cy = (ln.cy * (ln.words.length - 1) + cy) / ln.words.length; ln.h = Math.max(ln.h, h); } else out.push({ cy, h, words: [w] });
    }
    out.sort((p, q) => q.cy - p.cy);
    const res = out.map((l) => l.words.sort((p, q) => p.x0 - q.x0));
    const byAngle = new Map();
    for (const w of other) (byAngle.get(w.a) || byAngle.set(w.a, []).get(w.a)).push(w);
    for (const a of [...byAngle.keys()].sort((p, q) => p - q)) {
      for (const w of byAngle.get(a).sort((p, q) => (q.y1 + q.y0) - (p.y1 + p.y0) || p.x0 - q.x0)) res.push([w]);
    }
    return res;
  }
  const readingOrder = (words) => [].concat(...lines(words));
  const pageText = (words) => lines(words).map((l) => l.map((w) => w.t).join(' ')).join('\n');

  // Éléments de texte pour la recherche (même forme que TextInfo.itemsFromContent) : un élément par mot, un espace après chaque mot sauf en fin de ligne.
  function items(words) {
    const out = [];
    for (const ln of lines(words)) {
      ln.forEach((w, i) => {
        const last = i === ln.length - 1;
        out.push({ str: w.t + (last ? '' : ' '), hasEOL: last, x: w.x0, y: w.y1, w: w.x1 - w.x0, size: Math.max(1, w.y1 - w.y0), ang: 0, fontName: 'ocr', upright: false, editable: false, ocr: true, box: [w.x0, w.y0, w.x1, w.y1], conf: w.c });
      });
    }
    return out;
  }

  // Un mot, pour un viewport : longueur et épaisseur (px) le long de son sens de lecture, centre, angle visuel (degrés horaires pour CSS).
  // vp : { rotation, convertToViewportRectangle } ; renvoie { cx, cy, len, thick, rot }
  function viewBox(w, vp) {
    const r = vp.convertToViewportRectangle([w.x0, w.y0, w.x1, w.y1]);
    const x0 = Math.min(r[0], r[2]), x1 = Math.max(r[0], r[2]), y0 = Math.min(r[1], r[3]), y1 = Math.max(r[1], r[3]);
    const vd = (((w.a - vp.rotation) % 360) + 360) % 360; // sens de lecture visuel (antihoraire)
    const vertical = vd === 90 || vd === 270;
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, len: vertical ? y1 - y0 : x1 - x0, thick: vertical ? x1 - x0 : y1 - y0, rot: (360 - vd) % 360 };
  }

  // Qualité d'une lecture : somme des confiances des mots sûrs (≥ 50 %).
  const score = (words) => words.reduce((s, w) => s + (w.c >= 50 ? w.c / 100 : 0), 0);
  const stats = (words) => ({ n: words.length, avg: words.length ? Math.round(words.reduce((s, w) => s + w.c, 0) / words.length) : 0 });

  // ---------------------------------------------------------------- orientation (page entière posée de côté ou à l'envers)
  // Mesuré (scans simulés A4 300 dpi, graine fixe) : à 0°, une page droite est lue à 90-96 % de confiance moyenne, une page couchée à 51-60 %.
  // Déclenchement : lecture à 0° douteuse (confiance < trigger) ou trop peu de mots. On compare alors les 4 orientations sur un ÉCHANTILLON
  // de la page et on ne tourne que si une orientation a un nombre de mots plausible ET une confiance nettement meilleure.
  const ORIENT = { trigger: 80, minWords: 8, sample: 1400, plausible: 0.5, margin: 10, minAvg: 70 };
  const looksWrong = (words) => { const s = stats(words); return s.n < ORIENT.minWords || s.avg < ORIENT.trigger; };
  // cands : [{ theta, n, avg }] lus sur le MÊME échantillon, 0° compris. Renvoie l'orientation à appliquer (0 = ne rien changer).
  // Plausible : au moins 3 mots et au moins `plausible` × le plus grand nombre de mots lus. Parmi les plausibles, meilleure confiance
  // moyenne (à égalité : ordre de la liste). On tourne seulement si 0° n'est pas plausible ou si le gain dépasse `margin` points, et si la
  // confiance gagnante atteint `minAvg`.
  function pickOrientation(cands) {
    const maxN = Math.max(0, ...cands.map((c) => c.n));
    const ok = cands.filter((c) => c.n >= 3 && c.n >= ORIENT.plausible * maxN);
    if (!ok.length) return 0;
    const best = ok.reduce((b, c) => (c.avg > b.avg ? c : b));
    if (best.theta === 0 || best.avg < ORIENT.minAvg) return 0;
    const zero = cands.find((c) => c.theta === 0);
    const zeroOk = zero && ok.includes(zero);
    return !zeroOk || best.avg >= zero.avg + ORIENT.margin ? best.theta : 0;
  }
  // Échantillon : carré de côté `side` (px, borné par la page) centré sur la zone la plus riche en mots lus à 0° (pts = centres en px du
  // rendu, même si la lecture est fausse, les « mots » sont sur l'encre). Sans mot : centre de la page. Renvoie { x, y, w, h } entiers.
  function sampleRect(pts, W, H, side) {
    const w = Math.min(side, W), h = Math.min(side, H);
    let cx = W / 2, cy = H / 2, best = -1;
    for (const p of pts) {
      const n = pts.reduce((s, q) => s + (Math.abs(q.x - p.x) <= w / 2 && Math.abs(q.y - p.y) <= h / 2 ? 1 : 0), 0);
      if (n > best) { best = n; cx = p.x; cy = p.y; }
    }
    const x = Math.round(Math.max(0, Math.min(W - w, cx - w / 2))), y = Math.round(Math.max(0, Math.min(H - h, cy - h / 2)));
    return { x, y, w: Math.round(w), h: Math.round(h) };
  }

  // ---------------------------------------------------------------- texte natif
  // La page a-t-elle déjà du texte exploitable ? items : getTextContent().items. Seuil : au moins `minChars` caractères non blancs.
  function nativeChars(items) {
    let n = 0;
    for (const it of items || []) if (typeof it.str === 'string') n += it.str.replace(/\s+/g, '').length;
    return n;
  }
  const hasNativeText = (items, minChars) => nativeChars(items) >= (minChars === undefined ? 12 : minChars);

  // ---------------------------------------------------------------- pages
  // Après une opération de pages : une page dupliquée (nouvel uid, même page source) hérite du texte reconnu de son original. Rotation,
  // suppression, déplacement et recadrage conservent l'uid : l'enregistrement suit tout seul (géométrie en espace source). Renvoie le même objet
  // s'il n'y a rien à changer.
  function remap(ocr, oldPages, newPages) {
    if (!ocr || !Object.keys(ocr).length || !oldPages) return ocr;
    const bySrc = new Map();
    for (const p of oldPages) if (ocr[p.u]) bySrc.set(p.src + '|' + p.i, ocr[p.u]);
    let next = null;
    for (const p of newPages) {
      if (ocr[p.u]) continue;
      const rec = bySrc.get(p.src + '|' + p.i);
      if (rec) { next = next || Object.assign({}, ocr); next[p.u] = rec; }
    }
    return next || ocr;
  }

  // ---------------------------------------------------------------- écriture
  // Exécutions de texte invisible d'une page : une par mot. widthOf(text, size) : largeur naturelle du texte dans la police (points).
  // Renvoie [{ text, size, squeeze (échelle horizontale en %), m: [a, b, c, d, e, f] (matrice de texte) }].
  function invisibleRuns(words, widthOf) {
    const runs = [];
    for (const w of words) {
      const vertical = w.a === 90 || w.a === 270;
      const len = vertical ? w.y1 - w.y0 : w.x1 - w.x0, thick = vertical ? w.x1 - w.x0 : w.y1 - w.y0;
      if (!(len > 0 && thick > 0) || !w.t) continue;
      const size = Math.max(1, thick / 0.95);
      const nat = widthOf(w.t, size);
      if (!(nat > 0)) continue;
      const squeeze = Math.max(5, Math.min(2000, (len / nat) * 100));
      const d = 0.2 * thick; // la ligne de base se place un peu au-dessus du bas de la boîte (les descentes y sont incluses)
      let x, y;
      if (w.a === 90) { x = w.x1 - d; y = w.y0; } else if (w.a === 180) { x = w.x1; y = w.y1 - d; } else if (w.a === 270) { x = w.x0 + d; y = w.y1; } else { x = w.x0; y = w.y0 + d; }
      const rad = (w.a || 0) * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
      runs.push({ text: w.t, size, squeeze, m: [Math.round(c), Math.round(s), -Math.round(s), Math.round(c), x, y] });
    }
    return runs;
  }

  return { QUALITY, TILE, OVERLAP, MAX_TILES, ORIENT, plan, tileRects, unrotateBox, wordsFromBlocks, toUser, mergeWords, makeRecord, lines, readingOrder, pageText, items, viewBox, nativeChars, hasNativeText, score, stats, looksWrong, pickOrientation, sampleRect, remap, invisibleRuns };
});
