// Impression : calculs purs de mise en page (formats de papier, plages de pages, échelle, position, planches multi-pages).
// Aucune dépendance : utilisable dans le renderer (global PrintLayout) et dans Node (tests). Unités : points PDF (pt) pour les pages et
// les feuilles ; millimètres pour les formats de papier, marges et décalages saisis par l'utilisateur.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PrintLayout = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PT_PER_MM = 72 / 25.4;
  const mm = (v) => v * PT_PER_MM;
  const toMm = (pt) => pt / PT_PER_MM;

  // Formats usuels (mm, portrait : largeur × hauteur)
  const PAPERS = {
    A5: [148, 210], A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841], A0: [841, 1189],
    Letter: [215.9, 279.4], Legal: [215.9, 355.6], Tabloid: [279.4, 431.8],
  };

  // « 1-3, 5, 8-12 » → indices de pages (à partir de 0), dans l'ordre saisi, sans doublon. Erreur → { error }.
  function parseRanges(text, count) {
    const s = String(text || '').trim();
    if (!s) return { error: 'Indiquez des pages (ex. 1-3, 5, 8-12).' };
    const out = [];
    const seen = new Set();
    for (const part of s.split(/[,;]/)) {
      const t = part.trim();
      if (!t) continue;
      const m = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(t);
      if (!m) return { error: `« ${t} » n'est pas une plage valide.` };
      const a = Number(m[1]);
      const b = m[2] === undefined ? a : Number(m[2]);
      if (a < 1 || b < 1 || a > count || b > count) return { error: `Les pages vont de 1 à ${count}.` };
      const step = a <= b ? 1 : -1;
      for (let p = a; step > 0 ? p <= b : p >= b; p += step) if (!seen.has(p)) { seen.add(p); out.push(p - 1); }
    }
    if (!out.length) return { error: 'Aucune page indiquée.' };
    return { pages: out };
  }

  const isLandscape = (w, h) => w > h + 1e-6;

  // Dimensions d'une feuille (pt) pour un papier (mm, portrait) et une orientation 'portrait' | 'landscape'.
  function sheetSize(paperW, paperH, landscape) {
    const w = Math.min(paperW, paperH), h = Math.max(paperW, paperH);
    return landscape ? { w: mm(h), h: mm(w) } : { w: mm(w), h: mm(h) };
  }

  // Place une page (taille affichée pw × ph en pt) dans un rectangle utile { x, y, w, h } (pt, origine en bas à gauche de la feuille).
  //   mode : 'fit' (ajuster, agrandit si besoin) | 'shrink' (réduire seulement) | 'actual' (100 %) | 'percent' (percent %)
  //   rotate : 0 | 90 (rotation anti-horaire du contenu pour épouser la feuille)
  // → { scale, x, y, w, h (contenu placé, pt), cropped, reduced, enlarged }
  function placeInArea(pw, ph, area, mode, percent, center, rotate) {
    const cw0 = rotate === 90 ? ph : pw, ch0 = rotate === 90 ? pw : ph;
    let scale = 1;
    const fit = Math.min(area.w / cw0, area.h / ch0);
    if (mode === 'fit') scale = fit;
    else if (mode === 'shrink') scale = Math.min(1, fit);
    else if (mode === 'percent') scale = Math.max(0.01, (percent || 100) / 100);
    const w = cw0 * scale, h = ch0 * scale;
    const x = center ? area.x + (area.w - w) / 2 : area.x;
    const y = center ? area.y + (area.h - h) / 2 : area.y + area.h - h; // sans centrage : coin haut-gauche de la zone
    const eps = 0.01;
    return { scale, x, y, w, h, cropped: w > area.w + eps || h > area.h + eps, reduced: scale < 0.9995, enlarged: scale > 1.0005 };
  }

  // Rectangles (pt) d'une planche « n pages par feuille » : grille cols × rows, remplie ligne par ligne depuis le haut.
  function nupCells(area, cols, rows, gap) {
    const g = gap || 0;
    const cw = (area.w - g * (cols - 1)) / cols, ch = (area.h - g * (rows - 1)) / rows;
    const cells = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ x: area.x + c * (cw + g), y: area.y + area.h - (r + 1) * ch - r * g, w: cw, h: ch });
    return cells;
  }

  // Plan d'impression d'une page (n = 1) ou d'un groupe de n pages sur une feuille.
  //   pages : [{ w, h }] tailles affichées (pt) des pages du groupe (1, 2 ou 4)
  //   o : { paperW, paperH (mm, portrait), orientation: 'auto'|'portrait'|'landscape', mode, percent, margins: { top, right, bottom, left } (mm),
  //         center (bool), nup: 1|2|4, sameSheet (taille de feuille imposée = taille de la page, voir 'paper' = null) }
  // paper = null : « format de la page » (la feuille prend la taille de la page).
  // → { sheet: { w, h }, items: [{ index, scale, rotate, x, y, w, h, cropped, reduced, enlarged }], warnings: [] }
  function planSheet(pages, o) {
    const nup = o.nup || 1;
    const first = pages[0];
    const m = Object.assign({ top: 0, right: 0, bottom: 0, left: 0 }, o.margins || {});
    let sheetLandscape;
    let cols = 1, rows = 1;
    const pageLand = isLandscape(first.w, first.h);
    if (nup === 2) { cols = pageLand ? 1 : 2; rows = pageLand ? 2 : 1; sheetLandscape = !pageLand; }
    else if (nup === 4) { cols = 2; rows = 2; sheetLandscape = pageLand; }
    else sheetLandscape = pageLand;
    if (o.orientation === 'portrait') sheetLandscape = false;
    else if (o.orientation === 'landscape') sheetLandscape = true;
    if ((nup === 2) && o.orientation && o.orientation !== 'auto') { cols = sheetLandscape ? 2 : 1; rows = sheetLandscape ? 1 : 2; }

    let sheet;
    if (!o.paperW || !o.paperH) sheet = nup === 1 ? { w: first.w, h: first.h } : sheetSize(...(first.w < first.h ? [toMm(first.w), toMm(first.h)] : [toMm(first.h), toMm(first.w)]), sheetLandscape);
    else sheet = sheetSize(o.paperW, o.paperH, sheetLandscape);
    const area = { x: mm(m.left), y: mm(m.bottom), w: sheet.w - mm(m.left + m.right), h: sheet.h - mm(m.top + m.bottom) };
    const warnings = [];
    if (!(area.w > 1 && area.h > 1)) return { sheet, items: [], warnings: ['Les marges sont trop grandes pour ce papier.'], area, cells: [] };
    const cells = nup === 1 ? [area] : nupCells(area, cols, rows, mm(3));
    const items = pages.map((p, i) => {
      const land = isLandscape(p.w, p.h);
      const cellLand = cells[i].w > cells[i].h;
      const forced = o.orientation && o.orientation !== 'auto';
      // Orientation imposée (ou planche) : la page est tournée de 90° si cela lui permet de mieux épouser la feuille.
      const rotate = (forced || nup > 1) && land !== cellLand ? 90 : 0;
      const r = placeInArea(p.w, p.h, cells[i], o.mode || 'fit', o.percent, o.center !== false, rotate);
      return Object.assign({ index: i, rotate }, r);
    });
    if (items.some((i) => i.cropped)) warnings.push('Une page dépasse la zone imprimable : elle sera coupée.');
    else if (items.some((i) => i.reduced)) warnings.push('Une page sera réduite pour tenir sur le papier.');
    return { sheet, items, warnings, area, cells };
  }

  // Regroupe les feuilles de même taille consécutives (une tâche d'impression par taille de feuille ; arrondi au 0,1 mm).
  function groupBySize(sheets) {
    const key = (s) => Math.round(toMm(s.w) * 10) + 'x' + Math.round(toMm(s.h) * 10);
    const groups = [];
    for (const s of sheets) {
      const k = key(s.sheet);
      const g = groups[groups.length - 1];
      if (g && g.key === k) g.sheets.push(s); else groups.push({ key: k, w: s.sheet.w, h: s.sheet.h, sheets: [s] });
    }
    return groups;
  }

  // ---- nom du travail d'impression (titre vu par le spouleur) ----
  // Nom lisible : caractères interdits sous Windows remplacés, espaces réduits, point final retiré ; l'extension .pdf est retirée (rajoutée par
  // jobTitle). Nom vide → « Sans titre ». Longueur limitée (troncature avec « … »), accents conservés.
  const MAX_NAME = 90;
  function cleanName(name) {
    let b = String(name || '').replace(/^.*[\\/]/, '').replace(/\.pdf$/i, '');
    b = b.replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
    if (!b) return 'Sans titre';
    if (b.length > MAX_NAME) b = b.slice(0, MAX_NAME - 1).trimEnd() + '…';
    return b;
  }
  // Titre : « nom.pdf » ou, pour plusieurs tâches (feuilles de formats différents), « nom (1/2).pdf ».
  const jobTitle = (name, i, n) => cleanName(name) + (n > 1 ? ` (${i + 1}/${n})` : '') + '.pdf';
  // Nom de fichier (le « / » est interdit dans un nom de fichier) : « nom (1-2).pdf ».
  const jobFileName = (name, i, n) => cleanName(name).replace(/…/g, '_') + (n > 1 ? ` (${i + 1}-${n})` : '') + '.pdf';

  // ---- imprimantes ----
  // Imprimante PDF virtuelle (par le nom) : le résultat est un fichier, donc vectoriel si on n'a pas demandé de rasterisation.
  const isPdfPrinter = (name) => /pdf|xps|onenote|creator|print to file|enregistrer/i.test(String(name || ''));

  // Marge saisie (mm) : valeur valide ou `prev` (champ vide / illisible / négatif / > 100). Jamais NaN.
  function normMargin(raw, prev) {
    const t = String(raw === undefined || raw === null ? '' : raw).replace(',', '.').trim();
    const v = t === '' ? NaN : Number(t);
    if (!Number.isFinite(v) || v < 0 || v > 100) return prev;
    return Math.round(v * 10) / 10;
  }
  const DEFAULT_MARGIN = 2;
  // Marge par défaut : 2 mm, jamais sous la marge matérielle annoncée (hardMm, null si inconnue).
  const defaultMargin = (hardMm) => Math.max(DEFAULT_MARGIN, hardMm ? Math.ceil(hardMm * 10) / 10 : 0);

  // Coupe due à la marge matérielle : la zone imprimable réelle est la feuille moins `hardMm` de chaque côté. Renvoie
  // { cutMm } = débordement maximal (mm) du contenu placé (items de planSheet : x, y, w, h en points, origine bas-gauche) dans cette bande ; 0 si rien n'est coupé.
  function hardwareCut(sheet, items, hardMm) {
    if (!(hardMm > 0)) return { cutMm: 0 };
    let cut = 0;
    for (const it of items) {
      const d = Math.min(it.x, it.y, sheet.w - (it.x + it.w), sheet.h - (it.y + it.h)); // distance au bord le plus proche (pt)
      cut = Math.max(cut, hardMm - toMm(d));
    }
    return { cutMm: Math.max(0, Math.round(cut * 10) / 10) };
  }

  return { PT_PER_MM, PAPERS, mm, toMm, parseRanges, sheetSize, placeInArea, nupCells, planSheet, groupBySize, isLandscape, cleanName, jobTitle, jobFileName, isPdfPrinter, normMargin, defaultMargin, DEFAULT_MARGIN, hardwareCut };
});
