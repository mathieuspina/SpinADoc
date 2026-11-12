// Opérations sur la structure des pages d'un document (pivoter, supprimer, réordonner, dupliquer, insérer, recadrer, extraire, diviser).
// Module PUR (aucun accès au DOM, à Electron ni à pdf-lib) : il travaille sur la « liste de pages » du document et fait suivre les annotations
// et les échelles de mesure (qui désignent une page par son indice).
//
// Liste de pages : doc.pages = [{ u, src, i, rot, crop }]
//   u    identifiant stable de la page (survit aux déplacements : le visionneur y rattache son affichage)
//   src  source des pages : '0' = le PDF ouvert ; 'blank:LxH' = page vierge (L × H en points) ; 's1', 's2'… = PDF inséré
//   i    indice de la page dans sa source ; rot : rotation ajoutée (0|90|180|270, horaire, écrite dans /Rotate) ;
//   crop : null ou [x0, y0, x1, y1] en points PDF (CropBox)
// État manipulé : st = { pages, edits, scales, nextId, nextUid } ; chaque opération renvoie un NOUVEL état (l'entrée n'est jamais modifiée).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PageOps = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const norm = (a) => ((a % 360) + 360) % 360;
  const fail = (msg) => { throw new Error(msg); };

  // Indices triés, sans doublon, dans [0, n[.
  function normalize(idxs, n) {
    const set = [...new Set(idxs)].filter((i) => Number.isInteger(i) && i >= 0 && i < n).sort((a, b) => a - b);
    return set;
  }

  // Liste d'origine : une page par page du PDF ouvert. Renvoie { pages, nextUid }.
  function identity(n) {
    const pages = [];
    for (let i = 0; i < n; i++) pages.push({ u: 'p' + (i + 1), src: '0', i, rot: 0, crop: null });
    return { pages, nextUid: n + 1 };
  }

  const isIdentity = (pages, n) => pages.length === n && pages.every((p, k) => p.src === '0' && p.i === k && !p.rot && !p.crop);

  // Reporte les modifications et les échelles sur la nouvelle numérotation. map[ancien] = nouveau, ou -1 (page supprimée : ses objets disparaissent).
  function remap(st, pages, map, extra) {
    const edits = [];
    for (const e of st.edits) { const n = map[e.page]; if (n >= 0) edits.push(Object.assign({}, e, { page: n })); }
    const scales = {};
    for (const k of Object.keys(st.scales || {})) { const n = map[Number(k)]; if (n >= 0) scales[n] = st.scales[k]; }
    return Object.assign({ pages, edits, scales, nextId: st.nextId, nextUid: st.nextUid }, extra || {});
  }
  const same = (n) => Array.from({ length: n }, (_, i) => i);

  function rotate(st, idxs, delta) {
    const sel = new Set(normalize(idxs, st.pages.length));
    if (!sel.size) fail('Aucune page sélectionnée.');
    const pages = st.pages.map((p, k) => (sel.has(k) ? Object.assign({}, p, { rot: norm(p.rot + delta) }) : p));
    return remap(st, pages, same(st.pages.length));
  }

  function remove(st, idxs) {
    const n = st.pages.length;
    const sel = new Set(normalize(idxs, n));
    if (!sel.size) fail('Aucune page sélectionnée.');
    if (sel.size >= n) fail('Impossible de supprimer toutes les pages du document.');
    const map = []; const pages = [];
    st.pages.forEach((p, k) => { if (sel.has(k)) map.push(-1); else { map.push(pages.length); pages.push(p); } });
    return remap(st, pages, map);
  }

  // Déplace le bloc de pages `idxs` (dans leur ordre) devant la page `to` de la liste d'origine (0 … n : n = à la fin).
  function move(st, idxs, to) {
    const n = st.pages.length;
    const sel = normalize(idxs, n);
    if (!sel.length) fail('Aucune page sélectionnée.');
    const set = new Set(sel);
    const rest = []; for (let k = 0; k < n; k++) if (!set.has(k)) rest.push(k);
    const at = rest.filter((k) => k < to).length; // position dans la liste privée du bloc
    const order = rest.slice(0, at).concat(sel, rest.slice(at));
    const map = new Array(n);
    order.forEach((old, nw) => { map[old] = nw; });
    return remap(st, order.map((k) => st.pages[k]), map);
  }

  // Copie chaque page sélectionnée ; les copies forment un bloc inséré après la dernière page sélectionnée (objets copiés avec de nouveaux ids).
  // Crochets (modules qui gèrent des objets particuliers) : afterCopy(copies, autresObjets) après une duplication de pages (ex. champs renommés).
  const hooks = { afterCopy: [] };

  function duplicate(st, idxs) {
    const n = st.pages.length;
    const sel = normalize(idxs, n);
    if (!sel.length) fail('Aucune page sélectionnée.');
    const last = sel[sel.length - 1];
    let nextUid = st.nextUid; let nextId = st.nextId;
    const copies = sel.map((k) => Object.assign(clone(st.pages[k]), { u: 'p' + nextUid++ }));
    const pages = st.pages.slice(0, last + 1).concat(copies, st.pages.slice(last + 1));
    const map = []; for (let k = 0; k < n; k++) map.push(k <= last ? k : k + sel.length);
    const out = remap(st, pages, map, { nextUid });
    const scales = out.scales;
    const copied = [];
    sel.forEach((k, r) => {
      const target = last + 1 + r;
      for (const e of st.edits) if (e.page === k) { const c = Object.assign(clone(e), { id: nextId++, page: target }); copied.push(c); out.edits.push(c); }
      if (st.scales && st.scales[k]) scales[target] = clone(st.scales[k]);
    });
    for (const h of hooks.afterCopy) h(copied, out.edits.filter((e) => !copied.includes(e)));
    out.nextId = nextId;
    return out;
  }

  // Insère des pages (descripteurs { src, i, rot?, crop? }) devant la page `at` (0 … n).
  function insert(st, at, descs) {
    const n = st.pages.length;
    if (!(at >= 0 && at <= n)) fail('Position d\'insertion invalide.');
    if (!descs.length) fail('Aucune page à insérer.');
    let nextUid = st.nextUid;
    const add = descs.map((d) => ({ u: 'p' + nextUid++, src: d.src, i: d.i, rot: d.rot || 0, crop: d.crop || null }));
    const map = []; for (let k = 0; k < n; k++) map.push(k < at ? k : k + add.length);
    return remap(st, st.pages.slice(0, at).concat(add, st.pages.slice(at)), map, { nextUid });
  }

  // box : [x0, y0, x1, y1] (points PDF) ou null (retire le recadrage).
  function crop(st, idxs, box) {
    const sel = new Set(normalize(idxs, st.pages.length));
    if (!sel.size) fail('Aucune page sélectionnée.');
    if (box && !(box[2] - box[0] > 1 && box[3] - box[1] > 1)) fail('Cadre de recadrage trop petit.');
    const pages = st.pages.map((p, k) => (sel.has(k) ? Object.assign({}, p, { crop: box ? box.slice() : null }) : p));
    return remap(st, pages, same(st.pages.length));
  }

  // Sous-ensemble (extraction, division) : seules les pages `idxs`, dans l'ordre du document, avec leurs objets et leurs échelles.
  function subset(st, idxs) {
    const n = st.pages.length;
    const sel = normalize(idxs, n);
    if (!sel.length) fail('Aucune page à extraire.');
    const map = new Array(n).fill(-1);
    sel.forEach((old, nw) => { map[old] = nw; });
    return remap(st, sel.map((k) => st.pages[k]), map);
  }

  // ---- plages (« 1-3, 5, 8-12 ») : un groupe par élément ----
  function parseGroups(spec, n) {
    const parts = String(spec || '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return { error: 'Indiquez au moins une plage de pages.' };
    const groups = [];
    for (const part of parts) {
      const m = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(part);
      if (!m) return { error: `Plage non reconnue : « ${part} ».` };
      const a = Number(m[1]); const b = m[2] === undefined ? a : Number(m[2]);
      if (a < 1 || b < 1 || a > n || b > n) return { error: `La plage « ${part} » dépasse le document (1 à ${n}).` };
      const g = []; for (let k = Math.min(a, b); k <= Math.max(a, b); k++) g.push(k - 1);
      groups.push(g);
    }
    return { groups };
  }

  const labelOf = (g) => (g.length === 1 ? String(g[0] + 1) : `${g[0] + 1}-${g[g.length - 1] + 1}`);

  // Plan de division : [{ pages: [indices], label }]. mode : 'ranges' (value = texte), 'every' (value = N), 'each'.
  function splitPlan(n, mode, value) {
    let groups;
    if (mode === 'ranges') { const r = parseGroups(value, n); if (r.error) return { error: r.error }; groups = r.groups; }
    else {
      const step = mode === 'each' ? 1 : Math.floor(Number(value));
      if (!(step >= 1)) return { error: 'Indiquez un nombre de pages par fichier (1 ou plus).' };
      groups = []; for (let s = 0; s < n; s += step) groups.push(same(Math.min(step, n - s)).map((k) => s + k));
    }
    return { files: groups.map((g) => ({ pages: g, label: labelOf(g) })) };
  }

  // Nom de fichier : « base-1-3.pdf » ; si le nom existe déjà dans `taken` (ensemble de noms en minuscules), « base-1-3 (2).pdf ».
  function uniqueName(base, label, taken) {
    let name = `${base}-${label}.pdf`; let k = 2;
    while (taken.has(name.toLowerCase())) name = `${base}-${label} (${k++}).pdf`;
    taken.add(name.toLowerCase());
    return name;
  }

  // Source « page vierge » : 'blank:LxH' (points).
  const blankId = (w, h) => `blank:${Math.round(w * 100) / 100}x${Math.round(h * 100) / 100}`;
  function parseBlank(id) { const m = /^blank:([\d.]+)x([\d.]+)$/.exec(id || ''); return m ? { w: Number(m[1]), h: Number(m[2]) } : null; }

  return { hooks, identity, isIdentity, normalize, rotate, remove, move, duplicate, insert, crop, subset, parseGroups, splitPlan, uniqueName, blankId, parseBlank };
});
