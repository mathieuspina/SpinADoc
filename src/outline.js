// Signets (arbre /Outlines) : lecture d'un document source et écriture dans un document reconstruit. UMD pur (renderer, Node, Web Worker).
// Utilisé par la fusion (js/merge-worker.js : un signet par fichier) et par la reconstruction des pages (pdf-edit.buildPages : les signets du
// fichier ouvert suivent les opérations de pages ; un signet dont la page n'est plus là est abandonné, ou pointe sur son premier descendant conservé).
// Destinations explicites ([page /Fit…]), actions GoTo et destinations nommées (/Dests ou arbre /Names /Dests) sont reconnues.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Outline = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const textOf = (v) => { try { return v && v.decodeText ? v.decodeText() : ''; } catch { return ''; } };

  function namedDest(PDFLib, src, key) {
    const { PDFDict, PDFArray, PDFName } = PDFLib;
    const N = (s) => PDFName.of(s);
    const cat = src.catalog;
    const dests = cat.lookup(N('Dests'));
    if (dests instanceof PDFDict) { const v = dests.lookup(N(String(key.decodeText ? key.decodeText() : key.asString ? key.asString() : key).replace(/^\//, ''))); if (v) return v; }
    const names = cat.lookup(N('Names'));
    const tree = names instanceof PDFDict ? names.lookup(N('Dests')) : null;
    const want = key.decodeText ? key.decodeText() : String(key);
    const walk = (node, depth) => {
      if (!(node instanceof PDFDict) || depth > 12) return null;
      const arr = node.lookup(N('Names'));
      if (arr instanceof PDFArray) for (let i = 0; i + 1 < arr.size(); i += 2) if (textOf(arr.lookup(i)) === want) return arr.lookup(i + 1);
      const kids = node.lookup(N('Kids'));
      if (kids instanceof PDFArray) for (let i = 0; i < kids.size(); i++) { const r = walk(kids.lookup(i), depth + 1); if (r) return r; }
      return null;
    };
    return tree ? walk(tree, 0) : null;
  }

  function destOf(PDFLib, src, item) {
    const { PDFDict, PDFArray, PDFName } = PDFLib;
    const N = (s) => PDFName.of(s);
    let d = item.lookup(N('Dest'));
    if (!d) {
      const a = item.lookup(N('A'));
      if (a instanceof PDFDict && a.lookup(N('S')) && String(a.lookup(N('S'))) === '/GoTo') d = a.lookup(N('D'));
    }
    if (!d) return null;
    if (!(d instanceof PDFArray)) { const v = namedDest(PDFLib, src, d); d = v instanceof PDFDict ? v.lookup(N('D')) : v; }
    return d instanceof PDFArray && d.size() > 0 ? d : null;
  }

  // Arbre d'un document source → [{ title, pageIndex (indice de page source ou -1), rest (éléments de destination après la page), children }].
  function read(PDFLib, src) {
    const { PDFDict, PDFRef, PDFName } = PDFLib;
    const N = (s) => PDFName.of(s);
    const root = src.catalog.lookup(N('Outlines'));
    if (!(root instanceof PDFDict)) return [];
    const refIndex = new Map(src.getPages().map((p, i) => [p.ref.toString(), i]));
    const walk = (first, depth) => {
      const out = [];
      let node = first; let guard = 0;
      while (node instanceof PDFDict && guard++ < 20000) {
        const d = destOf(PDFLib, src, node);
        let pageIndex = -1; let rest = [];
        if (d) { const ref = d.get(0); const k = ref instanceof PDFRef ? refIndex.get(ref.toString()) : undefined; if (k !== undefined) pageIndex = k; rest = d.asArray().slice(1); }
        const kids = depth < 12 ? walk(node.lookup(N('First')), depth + 1) : [];
        out.push({ title: textOf(node.lookup(N('Title'))) || '(sans titre)', pageIndex, rest, children: kids });
        node = node.lookup(N('Next'));
      }
      return out;
    };
    return walk(root.lookup(N('First')), 0);
  }

  // Garde les signets dont la page est conservée (pageOf(indice) → PDFRef ou undefined) ; un signet sans page mais avec des descendants conservés
  // pointe sur le premier d'entre eux. → [{ title, ref, rest, children }]
  function prune(list, pageOf) {
    return list.map((n) => {
      const kids = prune(n.children, pageOf);
      const ref = n.pageIndex >= 0 ? pageOf(n.pageIndex) : undefined;
      return { title: n.title, ref, rest: n.rest, children: kids };
    }).filter((n) => n.ref || n.children.length).map((n) => { if (!n.ref) n.ref = n.children[0].ref; return n; });
  }

  // Écrit l'arbre (nœuds { title, ref, rest, children }) comme /Outlines de `out` ; renvoie le nombre de signets écrits.
  function write(PDFLib, out, top, opts) {
    const { PDFHexString, PDFNumber, PDFName } = PDFLib;
    const N = (s) => PDFName.of(s);
    if (!top.length) return 0;
    const ctx = out.context;
    const build = (list, parentRef) => {
      const refs = list.map(() => ctx.nextRef());
      let total = 0;
      list.forEach((n, i) => {
        const d = { Title: PDFHexString.fromText(n.title), Parent: parentRef, Dest: ctx.obj([n.ref, ...(n.rest.length ? n.rest : [N('Fit')])]) };
        if (i > 0) d.Prev = refs[i - 1];
        if (i < list.length - 1) d.Next = refs[i + 1];
        const dict = ctx.obj(d);
        if (n.children.length) {
          const sub = build(n.children, refs[i]);
          dict.set(N('First'), sub.first); dict.set(N('Last'), sub.last); dict.set(N('Count'), PDFNumber.of(sub.count));
          total += sub.count;
        }
        ctx.assign(refs[i], dict);
        total += 1;
      });
      return { first: refs[0], last: refs[refs.length - 1], count: total };
    };
    const rootRef = ctx.nextRef();
    const b = build(top, rootRef);
    ctx.assign(rootRef, ctx.obj({ Type: 'Outlines', First: b.first, Last: b.last, Count: b.count }));
    out.catalog.set(N('Outlines'), rootRef);
    if (!opts || opts.pageMode !== false) out.catalog.set(N('PageMode'), N('UseOutlines'));
    return b.count;
  }

  return { read, prune, write, destOf };
});
