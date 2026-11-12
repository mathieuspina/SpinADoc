// Recherche de texte dans les éléments de getTextContent() de PDF.js (logique pure).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Search = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Minuscules sans accents, en conservant la longueur (1 unité UTF-16 -> 1 unité) pour garder les indices.
  function fold(s) {
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      const d = c.normalize('NFD')[0] || c;
      out += d.toLowerCase().length === 1 ? d.toLowerCase() : c;
    }
    return out;
  }

  // Texte de la page : éléments concaténés, un espace après les fins de ligne.
  function buildText(items) {
    let text = '';
    const ranges = [];
    items.forEach((it, idx) => {
      const start = text.length;
      text += it.str;
      ranges.push({ idx, start, end: text.length });
      if (it.hasEOL) text += ' ';
    });
    return { text, ranges };
  }

  // Occurrences de `query` : [{ start, end, snippet, parts: [{ idx, from, to }] }]
  // `parts` : portion de chaque élément concerné (indices dans item.str).
  function findMatches(items, query) {
    const q = fold(String(query || '').trim());
    if (!q) return [];
    const { text, ranges } = buildText(items);
    const hay = fold(text);
    const res = [];
    let pos = 0;
    while ((pos = hay.indexOf(q, pos)) !== -1) {
      const start = pos;
      const end = pos + q.length;
      const parts = [];
      for (const r of ranges) {
        if (r.end <= start || r.start >= end || r.end === r.start) continue;
        parts.push({ idx: r.idx, from: Math.max(start, r.start) - r.start, to: Math.min(end, r.end) - r.start });
      }
      const clean = (t) => t.replace(/\s+/g, ' ');
      const pre = clean(text.slice(Math.max(0, start - 30), start)).trimStart();
      const hit = clean(text.slice(start, end));
      const post = clean(text.slice(end, end + 40)).trimEnd();
      res.push({ start, end, snippet: pre + hit + post, pre, hit, post, parts });
      pos = end;
    }
    return res;
  }

  return { fold, buildText, findMatches };
});
