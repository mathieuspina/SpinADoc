// Caviardage : structures hors du contenu des pages (UMD pur, renderer et Node). Un document caviardé est reconstruit page par page
// (pdf-edit.buildPages) : le catalogue d'origine n'est pas recopié, mais tout ce qui est attaché aux pages CONSERVÉES l'est (annotations,
// actions, widgets et, par leur /Parent, toute la hiérarchie du formulaire, valeurs de champs d'autres pages comprises).
//  strip(PDFLib, doc)               : nettoie le document reconstruit (appelé par RedactPdf.scrub, avant la suppression des objets inaccessibles) ;
//  inventory(PDFLib, doc, pageIdx)  : mêmes règles, sans rien modifier, sur le document d'origine et ses pages conservées (boîte « Appliquer »).
// Règles. Supprimés : signets, pièces jointes (document et annotations), JavaScript et actions (document, pages, liens, champs), destinations
// nommées, structure et valeurs du formulaire (les widgets visibles des pages conservées restent comme apparences figées), annotations masquées,
// sons / vidéos / médias. Conservés (signalés) : texte des commentaires des pages conservées, adresses web des liens.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RedactActive = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MEDIA = new Set(['FileAttachment', 'Sound', 'Movie', 'Screen', 'RichMedia', '3D']);
  const SAFE_ACTIONS = new Set(['URI', 'GoTo']); // les autres (JavaScript, Launch, SubmitForm, ImportData, ResetForm, GoToR, GoToE, Rendition…) sont retirées
  const FIELD_KEYS = ['Parent', 'T', 'TU', 'TM', 'V', 'DV', 'Kids', 'FT', 'Ff', 'Opt', 'TI', 'I', 'MaxLen', 'AA', 'A', 'RV', 'DS'];
  const CATALOG_KEYS = ['Outlines', 'Names', 'Dests', 'OpenAction', 'AA', 'AcroForm', 'Threads', 'URI', 'Collection', 'Perms', 'Legal', 'SpiderInfo'];

  const name = (PDFLib, v) => (v instanceof PDFLib.PDFName ? v.decodeText() : null);
  const text = (PDFLib, v) => (v instanceof PDFLib.PDFString || v instanceof PDFLib.PDFHexString ? v.decodeText() : '');

  // Nombre d'entrées d'un arbre de noms (/Names [clé valeur …] et /Kids).
  function nameTreeCount(PDFLib, node, depth) {
    const { PDFDict, PDFArray, PDFName } = PDFLib;
    if (!(node instanceof PDFDict) || depth > 32) return 0;
    let n = 0;
    const names = node.lookup(PDFName.of('Names'));
    if (names instanceof PDFArray) n += Math.floor(names.size() / 2);
    const kids = node.lookup(PDFName.of('Kids'));
    if (kids instanceof PDFArray) for (let i = 0; i < kids.size(); i++) n += nameTreeCount(PDFLib, kids.lookup(i), depth + 1);
    return n;
  }
  function outlineCount(PDFLib, node, seen) {
    const { PDFDict, PDFName } = PDFLib;
    let n = 0;
    for (let it = node instanceof PDFDict ? node.lookup(PDFName.of('First')) : null; it instanceof PDFDict && !seen.has(it) && seen.size < 100000; it = it.lookup(PDFName.of('Next'))) {
      seen.add(it); n++;
      n += outlineCount(PDFLib, it, seen);
    }
    return n;
  }
  function fieldCount(PDFLib, arr, depth, seen) {
    const { PDFArray, PDFDict, PDFName } = PDFLib;
    if (!(arr instanceof PDFArray) || depth > 32) return 0;
    let n = 0;
    for (let i = 0; i < arr.size(); i++) {
      const f = arr.lookup(i);
      if (!(f instanceof PDFDict) || seen.has(f)) continue;
      seen.add(f);
      const kids = f.lookup(PDFName.of('Kids'));
      const sub = kids instanceof PDFArray ? fieldCount(PDFLib, kids, depth + 1, seen) : 0;
      n += sub || (f.has(PDFName.of('T')) || f.has(PDFName.of('FT')) ? 1 : 0);
    }
    return n;
  }
  const isJs = (PDFLib, a) => a instanceof PDFLib.PDFDict && name(PDFLib, a.lookup(PDFLib.PDFName.of('S'))) === 'JavaScript';

  function counts() {
    return { outlines: 0, embedded: 0, docJs: 0, dests: 0, fields: 0, pageActions: 0, attachments: 0, media: 0, hidden: 0, actions: 0, namedLinks: 0, widgets: 0, comments: 0, uris: 0, popups: 0 };
  }

  // Une passe sur le catalogue et les pages d'indices pageIdx (tous si absent). mutate = true : nettoie.
  function pass(PDFLib, doc, pageIdx, mutate) {
    const { PDFDict, PDFArray, PDFName, PDFRef } = PDFLib;
    const N = (k) => PDFName.of(k);
    const c = counts();
    const cat = doc.catalog;
    c.outlines = outlineCount(PDFLib, cat.lookup(N('Outlines')), new Set());
    const names = cat.lookup(N('Names'));
    if (names instanceof PDFDict) {
      c.embedded = nameTreeCount(PDFLib, names.lookup(N('EmbeddedFiles')), 0);
      c.docJs = nameTreeCount(PDFLib, names.lookup(N('JavaScript')), 0);
      c.dests = nameTreeCount(PDFLib, names.lookup(N('Dests')), 0);
    }
    const dd = cat.lookup(N('Dests'));
    if (dd instanceof PDFDict) c.dests += dd.keys().length;
    if (isJs(PDFLib, cat.lookup(N('OpenAction')))) c.docJs++;
    const caa = cat.lookup(N('AA'));
    if (caa instanceof PDFDict) c.docJs += caa.keys().length;
    const af = cat.lookup(N('AcroForm'));
    if (af instanceof PDFDict) c.fields = fieldCount(PDFLib, af.lookup(N('Fields')), 0, new Set());
    if (mutate) for (const k of CATALOG_KEYS) cat.delete(N(k));

    const pages = doc.getPages();
    const idx = pageIdx || pages.map((_, i) => i);
    for (const i of idx) {
      const page = pages[i];
      if (!page) continue;
      const node = page.node;
      const paa = node.lookup(N('AA'));
      if (paa instanceof PDFDict) c.pageActions += paa.keys().length;
      if (mutate) { node.delete(N('AA')); node.delete(N('B')); }
      const annots = node.lookup(N('Annots'));
      if (!(annots instanceof PDFArray)) continue;
      const keep = [], removed = new Set();
      for (let k = 0; k < annots.size(); k++) {
        const raw = annots.get(k);
        const a = raw instanceof PDFRef ? doc.context.lookup(raw) : raw;
        if (!(a instanceof PDFDict)) continue;
        const sub = name(PDFLib, a.lookup(N('Subtype')));
        const flags = Number(a.lookup(N('F')) ? a.lookup(N('F')).asNumber() : 0);
        if (MEDIA.has(sub)) { if (sub === 'FileAttachment') c.attachments++; else c.media++; removed.add(a); continue; }
        if (flags & (2 | 32)) { c.hidden++; removed.add(a); continue; }
        keep.push([raw, a, sub]);
      }
      const out = [];
      for (const [raw, a, sub] of keep) {
        if (sub === 'Popup') {
          const par = a.lookup(N('Parent'));
          if (par instanceof PDFDict && removed.has(par)) { c.popups++; continue; }
          out.push(raw); continue;
        }
        if (a.has(N('AA'))) { c.actions++; if (mutate) a.delete(N('AA')); }
        const act = a.lookup(N('A'));
        if (act instanceof PDFDict) {
          const s = name(PDFLib, act.lookup(N('S')));
          const d = act.lookup(N('D'));
          if (s === 'URI') c.uris++;
          if (!SAFE_ACTIONS.has(s) || act.has(N('Next'))) { c.actions++; if (mutate) a.delete(N('A')); }
          else if (s === 'GoTo' && !(d instanceof PDFArray)) { c.namedLinks++; if (mutate) a.delete(N('A')); }
        }
        const dest = a.lookup(N('Dest'));
        if (dest && !(dest instanceof PDFArray)) { c.namedLinks++; if (mutate) a.delete(N('Dest')); }
        if (sub === 'Widget') { c.widgets++; if (mutate) for (const k of FIELD_KEYS) a.delete(N(k)); }
        else if (text(PDFLib, a.lookup(N('Contents'))).trim() || a.has(N('RC'))) c.comments++;
        out.push(raw);
      }
      if (mutate) node.set(N('Annots'), doc.context.obj(out));
    }
    return c;
  }

  const strip = (PDFLib, doc) => pass(PDFLib, doc, null, true);
  const inventory = (PDFLib, doc, pageIdx) => pass(PDFLib, doc, pageIdx, false);

  // Liste lisible (boîte « Appliquer le caviardage », rapport) : { key, label, n, fate: 'removed' | 'kept' }.
  function items(c) {
    const L = [
      ['outlines', 'Signets (titres) : tous retirés, y compris ceux des pages conservées', 'removed'],
      ['embedded', 'Pièces jointes du document', 'removed'],
      ['attachments', 'Pièces jointes dans les annotations des pages conservées', 'removed'],
      ['docJs', 'JavaScript et actions automatiques du document', 'removed'],
      ['pageActions', 'Actions automatiques des pages conservées', 'removed'],
      ['actions', 'Actions des liens et des champs (JavaScript, lancement, envoi…)', 'removed'],
      ['dests', 'Destinations nommées', 'removed'],
      ['namedLinks', 'Liens vers une destination nommée (ne fonctionnent plus)', 'removed'],
      ['fields', 'Champs de formulaire : noms et valeurs (les champs visibles des pages conservées restent affichés, figés)', 'removed'],
      ['hidden', 'Annotations et champs masqués des pages conservées', 'removed'],
      ['media', 'Sons, vidéos et médias', 'removed'],
      ['comments', 'Texte des commentaires (notes, annotations) des pages conservées : CONSERVÉ, à vérifier', 'kept'],
      ['uris', 'Adresses web des liens des pages conservées : conservées', 'kept'],
    ];
    return L.filter(([k]) => c[k] > 0).map(([key, label, fate]) => ({ key, label, n: c[key], fate }));
  }

  return { strip, inventory, items, counts };
});
