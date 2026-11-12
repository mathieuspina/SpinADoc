// Numérotation des pages : « règles de document » (pur, sans DOM ni Electron ; UMD).
// Une règle s'applique à une plage de pages bornée par des ANCRES (identifiants stables de pages, `u` de doc.pages) : elle suit la page après une
// opération de pages (réordonner, supprimer, insérer). Le numéro affiché est indépendant de la position (départ au choix).
// L'aperçu (SVG) et l'écriture (pdf-lib) utilisent les mêmes primitives de texte : Numbering.primitives(items, info, measure).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./shapes.js'));
  else root.Numbering = factory(root.Shapes);
})(typeof self !== 'undefined' ? self : this, function (Shapes) {
  'use strict';

  const FORMATS = [['1', '1, 2, 3'], ['i', 'i, ii, iii'], ['I', 'I, II, III'], ['a', 'a, b, c'], ['A', 'A, B, C']];
  const POSITIONS = [['tl', 'Haut gauche'], ['tc', 'Haut centre'], ['tr', 'Haut droite'], ['ml', 'Milieu gauche'], ['mc', 'Centre'], ['mr', 'Milieu droite'], ['bl', 'Bas gauche'], ['bc', 'Bas centre'], ['br', 'Bas droite']];
  const ROMAN = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];

  function formatNumber(n, fmt) {
    n = Math.round(Number(n));
    if (!isFinite(n)) n = 0;
    if (fmt === 'i' || fmt === 'I') {
      if (n < 1 || n > 3999) return String(n);
      let s = '', r = n;
      for (const [v, t] of ROMAN) while (r >= v) { s += t; r -= v; }
      return fmt === 'I' ? s.toUpperCase() : s;
    }
    if (fmt === 'a' || fmt === 'A') {
      if (n < 1) return String(n);
      let s = '', r = n;
      while (r > 0) { r -= 1; s = String.fromCharCode(97 + (r % 26)) + s; r = Math.floor(r / 26); }
      return fmt === 'A' ? s.toUpperCase() : s;
    }
    return String(n);
  }

  // Règle par défaut. fromU / toU : ancres (null = début / fin du document).
  function newRule(over) {
    return Object.assign({
      id: 0, name: '', enabled: true,
      fromU: null, toU: null, skipFirst: false, parity: 'all', // 'all' | 'odd' | 'even' (parité de la position de la page dans le document)
      start: 1, format: '1', text: '{n}', totalMode: 'rule', // totalMode : 'rule' (pages concernées) | 'doc' (pages du document)
      font: 'Helvetica', bold: false, italic: false, size: 10, color: [0, 0, 0], opacity: 1,
      pos: 'bc', mx: 12, my: 10, mirror: false, // marges en mm
    }, over || {});
  }

  const idxOf = (pages, u) => (u === null || u === undefined ? -1 : pages.findIndex((p) => p.u === u));

  // Positions (indices, 0 = première page) concernées par la règle, dans l'ordre du document.
  function concerned(rule, pages) {
    if (!rule || rule.dead || !pages || !pages.length) return [];
    let a = rule.fromU == null ? 0 : idxOf(pages, rule.fromU);
    let b = rule.toU == null ? pages.length - 1 : idxOf(pages, rule.toU);
    if (a < 0) a = 0;
    if (b < 0) b = pages.length - 1;
    if (a > b) { const t = a; a = b; b = t; }
    const out = [];
    for (let i = a; i <= b; i++) {
      if (rule.skipFirst && i === a) continue;
      const pos = i + 1;
      if (rule.parity === 'odd' && pos % 2 === 0) continue;
      if (rule.parity === 'even' && pos % 2 === 1) continue;
      out.push(i);
    }
    return out;
  }

  // Texte d'une page : jetons {n} (numéro mis en forme), {total} (pages concernées ou du document), {page} (position dans le document).
  function render(rule, k, pos, nConcerned, nDoc) {
    const n = Number(rule.start) + k;
    const total = rule.totalMode === 'doc' ? nDoc : nConcerned;
    const ts = String(rule.text === undefined || rule.text === null ? '{n}' : rule.text)
      .replace(/\{n\}/g, formatNumber(n, rule.format))
      .replace(/\{total\}/g, formatNumber(total, rule.format))
      .replace(/\{page\}/g, String(pos));
    return Shapes.sanitize(ts).replace(/\n/g, ' ');
  }

  // Étiquettes par position de page : tableau (une entrée par page) de listes { text, rule }.
  function resolve(rules, pages) {
    const byPos = (pages || []).map(() => []);
    for (const rule of rules || []) {
      if (!rule.enabled) continue;
      const idx = concerned(rule, pages);
      idx.forEach((i, k) => { byPos[i].push({ text: render(rule, k, i + 1, idx.length, pages.length), rule }); });
    }
    return byPos;
  }

  // Primitive de texte (voir Shapes.primitives) pour une étiquette, sur une page.
  // info : { box: [x0, y0, x1, y1] (zone visible, espace PDF non tourné), rot: rotation de la page affichée (0 / 90 / 180 / 270, horaire), index }
  // Le texte est droit dans l'orientation affichée : rotation du texte = rotation de la page.
  function place(item, info, measure) {
    const r = item.rule;
    const fontName = Shapes.fontKey({ font: r.font, bold: r.bold, italic: r.italic });
    const size = Number(r.size) || 10;
    const tw = measure(fontName, item.text, size);
    const R = (((Math.round((info.rot || 0) / 90) * 90) % 360) + 360) % 360;
    const [x0, y0, x1, y1] = info.box;
    const bw = x1 - x0, bh = y1 - y0;
    const Wd = R % 180 === 0 ? bw : bh, Hd = R % 180 === 0 ? bh : bw;
    const mm = 72 / 25.4;
    const mx = (Number(r.mx) || 0) * mm, my = (Number(r.my) || 0) * mm;
    let col = r.pos[1]; // 'l' | 'c' | 'r' (après la ligne : t / m / b)
    const row = r.pos[0];
    if (r.mirror && (info.index % 2 === 1)) { if (col === 'l') col = 'r'; else if (col === 'r') col = 'l'; } // pages paires (versos) : miroir
    const u = col === 'l' ? mx : col === 'r' ? Wd - mx - tw : (Wd - tw) / 2;
    const v = row === 't' ? my + 0.75 * size : row === 'b' ? Hd - my - 0.2 * size : Hd / 2 + 0.35 * size;
    let x, y;
    if (R === 0) { x = x0 + u; y = y1 - v; }
    else if (R === 90) { x = x0 + v; y = y0 + u; }
    else if (R === 180) { x = x1 - u; y = y0 + v; }
    else { x = x1 - v; y = y1 - u; }
    return { kind: 'text', text: item.text, x, y, size, fontName, color: r.color || [0, 0, 0], rot: R, opacity: r.opacity === undefined ? 1 : r.opacity };
  }
  const primitives = (items, info, measure) => (items || []).map((it) => place(it, info, measure));

  // Après une opération de pages : ramène les ancres sur des pages qui existent encore. Une ancre de début passe à la page suivante conservée,
  // une ancre de fin à la page précédente conservée ; une règle sans page restante est marquée `dead`.
  function remap(rules, oldPages, newPages) {
    const alive = new Set(newPages.map((p) => p.u));
    return (rules || []).map((rule) => {
      const r = Object.assign({}, rule);
      const fix = (u, dir) => {
        if (u == null || alive.has(u)) return { u, ok: true };
        const i = idxOf(oldPages, u);
        if (i < 0) return { u: null, ok: false };
        for (let j = i; j >= 0 && j < oldPages.length; j += dir) if (alive.has(oldPages[j].u)) return { u: oldPages[j].u, ok: true };
        return { u: null, ok: false };
      };
      const a = fix(r.fromU, 1), b = fix(r.toU, -1);
      const moved = (r.fromU != null && !alive.has(r.fromU)) || (r.toU != null && !alive.has(r.toU));
      if (a.ok && b.ok && moved && a.u != null && b.u != null && idxOf(newPages, a.u) > idxOf(newPages, b.u)) { r.fromU = a.u; r.toU = b.u; r.dead = true; return r; } // toute l'étendue a été supprimée
      if (!a.ok || !b.ok) { r.dead = true; r.fromU = a.ok ? a.u : null; r.toU = b.ok ? b.u : null; } else { r.fromU = a.u; r.toU = b.u; delete r.dead; }
      return r;
    });
  }

  // Résumé lisible d'une règle (liste de la boîte de dialogue).
  function summary(rule, pages) {
    const a = rule.fromU == null ? 1 : idxOf(pages, rule.fromU) + 1;
    const b = rule.toU == null ? pages.length : idxOf(pages, rule.toU) + 1;
    const scope = rule.dead ? 'aucune page' : (rule.fromU == null && rule.toU == null ? 'toutes les pages' : rule.toU == null ? `pages ${a} à la fin` : `pages ${a} à ${b}`);
    return scope + (rule.parity === 'odd' ? ', impaires' : rule.parity === 'even' ? ', paires' : '') + (rule.skipFirst ? ', sauf la première' : '');
  }

  return { FORMATS, POSITIONS, formatNumber, newRule, concerned, render, resolve, place, primitives, remap, summary };
});
