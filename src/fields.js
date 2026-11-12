// Champs de formulaire CRÉÉS dans Spin A Doc (logique pure, UMD). Un champ est un objet de l'historique comme les autres :
//   { type: 'field', ftype, page, cx, cy, w, h, rot: 0, name, tip, value, options, export, multiline, maxLen, fontSize, align, font, color,
//     fill, border, borderWidth, required, readOnly, visible, tab }
// (cadre en coordonnées PDF de la page, comme les rectangles) : il suit donc les opérations de pages (page-ops remappe edits[].page), il est
// sélectionnable, déplaçable, redimensionnable, copiable, annulable. Il n'est PAS dessiné dans le contenu de la page : il est écrit comme un VRAI
// champ AcroForm (src/fields-pdf.js). Les primitives ci-dessous ne servent qu'à l'aperçu (même cadre que l'écriture).
// ftype : 'text' | 'check' | 'radio' | 'combo' (liste déroulante) | 'list' (liste) | 'date' (champ texte au format jj/mm/aaaa, sans JavaScript).
// Boutons radio : chaque bouton est un objet ; un GROUPE = les boutons de même nom ; `export` = valeur de l'option ; `value` = true sur l'option
// choisie par défaut. Valeur par défaut des autres types : `value` (texte, booléen pour la case, option choisie pour les listes).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./shapes.js'), require('./page-ops.js'));
  else root.Fields = factory(root.Shapes, root.PageOps);
})(typeof self !== 'undefined' ? self : this, function (Shapes, PageOps) {
  'use strict';

  const FTYPES = ['text', 'check', 'radio', 'combo', 'list', 'date'];
  const LABELS = { text: 'Champ texte', check: 'Case à cocher', radio: 'Bouton radio', combo: 'Liste déroulante', list: 'Liste', date: 'Champ de date' };
  const BASE = { text: 'Texte', check: 'Case', radio: 'Groupe', combo: 'Liste', list: 'Choix', date: 'Date' };
  const SIZE = { text: [160, 22], check: [14, 14], radio: [14, 14], combo: [140, 22], list: [140, 60], date: [90, 22] }; // taille par défaut (pt)
  const DATE_FORMAT = 'jj/mm/aaaa';
  const GROUP_KEYS = ['name', 'tip', 'required', 'readOnly', 'visible']; // boutons radio : réglages communs à tout le groupe

  const isField = (e) => !!e && e.type === 'field';
  const rectOf = (o) => [o.cx - o.w / 2, o.cy - o.h / 2, o.cx + o.w / 2, o.cy + o.h / 2];

  // Nom valide : non vide, sans point (séparateur de hiérarchie AcroForm), sans caractère de contrôle, 120 caractères au plus.
  function nameError(n) {
    const s = String(n || '').trim();
    if (!s) return 'Le nom ne peut pas être vide.';
    if (s.includes('.')) return 'Le nom ne peut pas contenir de point (séparateur des noms de champs PDF).';
    if (/[\u0000-\u001f]/.test(s)) return 'Le nom contient un caractère non autorisé.';
    if (s.length > 120) return 'Nom trop long (120 caractères au plus).';
    return '';
  }
  // Nom libre dérivé de `base` : base, sinon base2, base3… (si base finit par un nombre, ce nombre est incrémenté).
  function uniqueName(base, taken) {
    const set = taken instanceof Set ? taken : new Set(taken);
    const b = String(base || 'Champ').trim() || 'Champ';
    if (!set.has(b)) return b;
    const m = /^(.*?)(\d+)$/.exec(b);
    const stem = m ? m[1] : b;
    let k = m ? Number(m[2]) + 1 : 2;
    while (set.has(stem + k)) k++;
    return stem + k;
  }
  const namesOf = (edits) => new Set(edits.filter(isField).map((e) => e.name));
  const nextName = (ftype, taken) => uniqueName(BASE[ftype] + '1', taken);

  // Nouveau champ (cadre [x0, y0, x1, y1]) ; taken = noms déjà utilisés (champs créés + champs d'origine du PDF).
  function create(ftype, page, r, taken, opts) {
    const [x0, y0, x1, y1] = [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
    const o = Object.assign(defaults(ftype), { type: 'field', ftype, page, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, rot: 0 });
    o.name = (opts && opts.name) || nextName(ftype, taken);
    if (ftype === 'radio') o.export = (opts && opts.export) || 'Choix1';
    if (opts && opts.value !== undefined) o.value = opts.value;
    return o;
  }
  // Cadre par défaut centré sur un point (clic simple).
  function rectAt(ftype, x, y) { const [w, h] = SIZE[ftype]; return [x - w / 2, y - h / 2, x + w / 2, y + h / 2]; }

  function defaults(ftype) {
    const t = ftype || 'text';
    return {
      type: 'field', ftype: t, rot: 0, name: '', tip: '', value: t === 'check' || t === 'radio' ? false : '', options: t === 'combo' || t === 'list' ? ['Option 1', 'Option 2'] : [],
      export: '', multiline: false, maxLen: t === 'date' ? 10 : 0, fontSize: 0, align: 'left', font: 'Helvetica', color: [0, 0, 0],
      fill: [1, 1, 1], border: [0.25, 0.25, 0.25], borderWidth: 1, required: false, readOnly: false, visible: true, opacity: 1,
    };
  }

  // ----------------------------------------------------------------------------- ordre de tabulation
  // Champs dans l'ordre de tabulation : `tab` (ordre choisi) d'abord, puis par page, de haut en bas, de gauche à droite.
  // Les boutons d'un même groupe radio se suivent (le groupe prend la place de son premier bouton).
  // Ordre de lecture : page, puis ligne (bords hauts à moins d'une demi-hauteur du plus petit des deux = même ligne), puis de gauche à droite.
  function byPosition(a, b) {
    if (a.page !== b.page) return a.page - b.page;
    const ra = rectOf(a), rb = rectOf(b);
    if (Math.abs(ra[3] - rb[3]) >= Math.min(a.h, b.h) / 2) return rb[3] - ra[3];
    return ra[0] - rb[0] || rb[3] - ra[3];
  }
  function tabOrder(edits) {
    const fs = edits.filter(isField);
    const hasTab = (e) => Number.isFinite(e.tab);
    const sorted = fs.slice().sort((a, b) => (hasTab(a) && hasTab(b) ? a.tab - b.tab : hasTab(a) ? -1 : hasTab(b) ? 1 : byPosition(a, b)));
    const out = [], seen = new Set();
    for (const f of sorted) {
      if (f.ftype !== 'radio') { out.push(f); continue; }
      if (seen.has(f.name)) continue;
      seen.add(f.name);
      for (const g of sorted) if (g.ftype === 'radio' && g.name === f.name) out.push(g);
    }
    return out;
  }
  // Ordre par position (bouton « Ordre automatique ») : { id: tab }.
  function autoTabs(edits) { const m = {}; edits.filter(isField).sort(byPosition).forEach((e, i) => { m[e.id] = i; }); return m; }

  // ----------------------------------------------------------------------------- copies (duplication, collage, pages dupliquées)
  // copies : objets nouvellement créés (sans id) ; edits : objets déjà présents. sameGroup = true : un bouton radio copié rejoint le groupe de son
  // original avec une nouvelle valeur d'option (Ctrl+D, collage dans le même document) ; false : chaque nom copié devient un nouveau nom (et un
  // groupe radio copié devient un nouveau groupe : page dupliquée). Modifie les copies en place.
  function renameCopies(copies, edits, sameGroup, extraTaken) {
    const taken = new Set([...namesOf(edits), ...(extraTaken || [])]);
    const map = {};
    for (const c of copies) {
      if (!isField(c)) continue;
      if (c.ftype === 'radio' && sameGroup && taken.has(c.name)) {
        const opts = new Set(edits.concat(copies).filter((e) => isField(e) && e.ftype === 'radio' && e.name === c.name && e !== c).map((e) => e.export));
        c.export = uniqueName(c.export || 'Choix1', opts);
        c.value = false;
        continue;
      }
      if (!(c.name in map)) { map[c.name] = uniqueName(c.name, taken); taken.add(map[c.name]); }
      c.name = map[c.name];
      delete c.tab;
    }
    return copies;
  }

  // ----------------------------------------------------------------------------- valeurs et calque de remplissage
  // Valeur par défaut d'un champ (tous objets d'un même nom confondus) : texte → chaîne, case → booléen, radio → option choisie ('' = aucune),
  // liste déroulante → chaîne, liste → tableau.
  function defaultValue(edits, name) {
    const ws = edits.filter((e) => isField(e) && e.name === name);
    if (!ws.length) return undefined;
    const f = ws[0];
    if (f.ftype === 'check') return !!f.value;
    if (f.ftype === 'radio') { const s = ws.find((w) => w.value); return s ? s.export : ''; }
    if (f.ftype === 'list') return f.value ? [f.value] : [];
    return f.value || '';
  }
  // Descripteurs pour le calque de remplissage (même forme que Forms.fromAnnotations), dans l'ordre de tabulation ; page = indice de SORTIE.
  function descriptors(edits) {
    return tabOrder(edits).filter((e) => e.visible !== false).map((e) => {
      const d = { name: e.name, type: e.ftype === 'date' ? 'text' : e.ftype, page: e.page, rect: rectOf(e), created: true, id: e.id,
        readOnly: !!e.readOnly, required: !!e.required, multiline: e.ftype === 'text' && !!e.multiline, maxLen: e.maxLen || 0, password: false, comb: false,
        placeholder: e.ftype === 'date' ? DATE_FORMAT : '' };
      if (e.ftype === 'radio') d.exportValue = e.export;
      if (e.ftype === 'check') d.exportValue = 'Yes';
      if (e.ftype === 'combo' || e.ftype === 'list') { d.options = (e.options || []).map((o) => ({ v: o, t: o })); d.multiSelect = false; }
      return d;
    });
  }

  // ----------------------------------------------------------------------------- géométrie tournée (page pivotée)
  // Repère « droit à l'écran » d'un cadre sur une page de rotation rot (0, 90, 180, 270, sens horaire à l'affichage, comme /Rotate) :
  // origine = coin bas-gauche VU, axes u (vers la droite vue) et v (vers le haut vu), largeur W et hauteur H vues.
  function frameBasis(o, rot) {
    const [x0, y0, x1, y1] = rectOf(o);
    const r = ((Math.round((rot || 0) / 90) * 90) % 360 + 360) % 360;
    if (r === 90) return { org: [x1, y0], u: [0, 1], v: [-1, 0], W: o.h, H: o.w, rot: 90 };
    if (r === 180) return { org: [x1, y1], u: [-1, 0], v: [0, -1], W: o.w, H: o.h, rot: 180 };
    if (r === 270) return { org: [x0, y1], u: [0, -1], v: [1, 0], W: o.h, H: o.w, rot: 270 };
    return { org: [x0, y0], u: [1, 0], v: [0, 1], W: o.w, H: o.h, rot: 0 };
  }
  const at = (B, a, b) => [B.org[0] + B.u[0] * a + B.v[0] * b, B.org[1] + B.u[1] * a + B.v[1] * b];

  // Hauteurs des polices standard (pdf-lib heightOfFontAtSize(1), avec et sans jambage) : aperçu = apparence écrite.
  const FONT_H = { Helvetica: [0.925, 0.718], Times: [0.9, 0.683], Courier: [0.786, 0.629] };
  const fontH = (o) => FONT_H[o.font] || FONT_H.Helvetica;
  // Taille de police effective. 0 = automatique, calculée comme pdf-lib le fait pour l'apparence écrite (champ d'une ligne) : la plus grande
  // taille entière (≥ 4) dont la ligne tient en largeur et dont 1,2 × hauteur de police tient en hauteur, marges = bordure + 1.
  function fontSizeOf(o, W, H, measure, text) {
    if (o.fontSize > 0) return o.fontSize;
    if (o.ftype === 'list' || (o.ftype === 'text' && o.multiline)) return 10;
    const pad = (o.border ? Math.max(0, o.borderWidth || 0) : 0) + 1;
    const bw = W - 2 * pad, bh = H - 2 * pad;
    const fontName = Shapes.fontKey({ font: o.font });
    let s = 4;
    while (s < 500) {
      if (text && measure && measure(fontName, text, s) > bw) return s - 1;
      if (fontH(o)[0] * s * 1.2 > bh) return s - 1;
      s++;
    }
    return s;
  }

  // ----------------------------------------------------------------------------- aperçu (primitives)
  const GREY = [0.45, 0.45, 0.5];
  function primitives(o, measure, ctx) {
    const B = frameBasis(o, ctx && ctx.pageRot);
    const out = [];
    const quad = (a0, b0, a1, b1) => [at(B, a0, b0), at(B, a1, b0), at(B, a1, b1), at(B, a0, b1)];
    const hidden = o.visible === false;
    const op = hidden ? 0.35 : 1;
    const bw = o.border ? Math.max(0, o.borderWidth || 0) : 0;
    out.push({ kind: 'path', segs: Shapes.polySegs(quad(0, 0, B.W, B.H), true), fill: o.fill ? { color: o.fill, opacity: op } : null,
      stroke: o.border && bw > 0 ? { color: o.border, width: bw, opacity: op, dash: hidden ? [3, 2] : null } : { color: [0.2, 0.45, 0.9], width: 0.6, opacity: 0.8, dash: [2, 2] }, blend: null });
    const fontName = Shapes.fontKey({ font: o.font });
    const value0 = typeof o.value === 'string' ? o.value : '';
    const arrow0 = o.ftype === 'combo' ? Math.min(B.H * 0.8, 14) : 0;
    const size = fontSizeOf(o, B.W - arrow0, B.H, measure, value0);
    const pad = 1 + bw;
    const fit = (t, w, s) => { let x = String(t); while (x.length > 1 && measure(fontName, x, s) > w) x = x.slice(0, -1); return x; };
    const text = (t, a, b, s, color, opacity) => {
      if (!t) return;
      const p = at(B, a, b);
      out.push({ kind: 'text', text: t, x: p[0], y: p[1], size: s, fontName, color, rot: B.rot, opacity });
    };
    const value = typeof o.value === 'string' ? o.value : '';
    if (o.ftype === 'check') {
      const s = Math.min(B.W, B.H) * 0.62, c = [B.W / 2, B.H / 2];
      if (o.value) out.push({ kind: 'path', segs: Shapes.polySegs([at(B, c[0] - s * 0.45, c[1]), at(B, c[0] - s * 0.1, c[1] - s * 0.4), at(B, c[0] + s * 0.5, c[1] + s * 0.45)], false), fill: null, stroke: { color: o.color, width: Math.max(1, s * 0.16), opacity: op, dash: null }, blend: null });
    } else if (o.ftype === 'radio') {
      const r = Math.min(B.W, B.H) * 0.5 - pad / 2, cx = B.W / 2, cy = B.H / 2;
      const circle = (rr) => { const k = 0.5522847498 * rr; const P = (a, b) => at(B, cx + a, cy + b); const p = [P(rr, 0), P(rr, k), P(k, rr), P(0, rr), P(-k, rr), P(-rr, k), P(-rr, 0), P(-rr, -k), P(-k, -rr), P(0, -rr), P(k, -rr), P(rr, -k)];
        return [['M', ...p[0]], ['C', ...p[1], ...p[2], ...p[3]], ['C', ...p[4], ...p[5], ...p[6]], ['C', ...p[7], ...p[8], ...p[9]], ['C', ...p[10], ...p[11], ...p[0]], ['Z']]; };
      out.push({ kind: 'path', segs: circle(Math.max(1, r)), fill: null, stroke: { color: o.border || GREY, width: 0.8, opacity: op, dash: null }, blend: null });
      if (o.value) out.push({ kind: 'path', segs: circle(Math.max(0.5, r * 0.45)), fill: { color: o.color, opacity: op }, stroke: null, blend: null });
    } else if (o.ftype === 'list') {
      const opts = o.options || [];
      const lh = size * 1.15;
      opts.forEach((t, i) => {
        const top = B.H - pad - lh * i;
        if (top - lh < pad - 0.5) return;
        if (t === o.value) out.push({ kind: 'path', segs: Shapes.polySegs(quad(pad, top - lh, B.W - pad, top), true), fill: { color: [0.6, 0.75, 1], opacity: 0.6 * op }, stroke: null, blend: null });
        text(fit(t, B.W - 2 * pad, size), pad, top - Shapes.K_BASE * size, size, o.color, op);
      });
    } else {
      // texte, date, liste déroulante : valeur par défaut, sinon nom du champ en gris (repère de conception)
      const arrow = o.ftype === 'combo' ? Math.min(B.H * 0.8, 14) : 0;
      const inner = B.W - 2 * pad - arrow;
      const shown = value || (o.ftype === 'date' ? DATE_FORMAT : o.name);
      const color = value ? o.color : GREY;
      const t = fit(shown, inner, size);
      const tw = measure(fontName, t, size);
      const a = o.align === 'center' ? pad + (inner - tw) / 2 : o.align === 'right' ? pad + inner - tw : pad;
      const multi = o.ftype === 'text' && o.multiline;
      const b = multi ? B.H - pad - Shapes.K_BASE * size : pad + (B.H - 2 * pad - fontH(o)[1] * size) / 2; // ligne de base comme pdf-lib
      text(t, a, b, size, color, (value ? 1 : 0.8) * op);
      if (arrow) {
        const ax = B.W - pad - arrow / 2, ay = B.H / 2, s = arrow * 0.25;
        out.push({ kind: 'path', segs: Shapes.polySegs([at(B, ax - s, ay + s * 0.5), at(B, ax + s, ay + s * 0.5), at(B, ax, ay - s * 0.6)], true), fill: { color: GREY, opacity: op }, stroke: null, blend: null });
      }
    }
    if (o.required) { const p = at(B, B.W - 1.5, B.H - 1.5); out.push({ kind: 'text', text: '*', x: p[0], y: p[1] - 5, size: 8, fontName: 'Helvetica-Bold', color: [0.86, 0.1, 0.12], rot: B.rot, opacity: 1 }); }
    return out;
  }

  Shapes.FRAME.add('field');
  Shapes.SOLID.add('field');
  Shapes.register('field', { primitives, noRotate: true, defaults: () => defaults('text'), label: 'Champ de formulaire' });

  // Pages dupliquées (onglet Pages) : les champs copiés reçoivent de nouveaux noms (un groupe radio copié devient un nouveau groupe).
  if (PageOps && PageOps.hooks) PageOps.hooks.afterCopy.push((copies, edits) => renameCopies(copies, edits, false));

  return { FTYPES, LABELS, SIZE, DATE_FORMAT, GROUP_KEYS, isField, rectOf, nameError, uniqueName, namesOf, nextName, create, rectAt, defaults,
    tabOrder, autoTabs, renameCopies, defaultValue, descriptors, frameBasis, fontSizeOf, primitives };
});
