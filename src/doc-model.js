// Modèle de données : un état par document + magasin d'onglets.
// Aucun accès au DOM ni à Electron : utilisable dans le renderer (global DocModel) et dans Node (tests).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./numbering.js'), require('./ocr.js'));
  else root.DocModel = factory(root.Numbering, root.Ocr);
})(typeof self !== 'undefined' ? self : this, function (Numbering, Ocr) {
  'use strict';

  let counter = 0;
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // État d'un document (= un onglet).
  //  - edits : liste de modifications (voir src/pdf-edit.js, champ `type`) ; sérialisable en JSON.
  //  - undo/redo : instantanés JSON de `edits`.
  //  - runtime : tout ce qui n'est pas sérialisable (document PDF.js, DOM, observateurs…), géré par le viewer.
  function createDoc(init) {
    const o = init || {};
    return {
      id: 'd' + ++counter,
      path: o.path || null,
      name: o.name || 'document.pdf',
      bytes: o.bytes || null, // octets d'origine, jamais modifiés
      edits: [],
      measure: { scales: {}, unit: 'm', precision: 2, include: true }, // mesures : échelle par page (mm par point), unité, décimales (dans l'historique)
      assets: { images: {} }, // fichiers image du document : { [imgId]: { mime, bytes, w, h, url } } (hors historique)
      clean: null, // métadonnées à retirer à l'enregistrement { title, author, subject, keywords, creator, producer, dates, xmp } (dans l'historique)
      info: null, // informations du document {title, author, subject, keywords} ; null = celles du fichier, inchangées (dans l'historique)
      form: null, // valeurs saisies dans les champs de formulaire { values: { [nom]: valeur } } ; null = aucune (dans l'historique)
      protect: null, // protection à l'enregistrement {userPassword, ownerPassword?, permissions?} ; null = aucune (hors historique)
      ocr: {}, // texte reconnu par uid de page { [uid]: enregistrement (voir src/ocr.js, immuable) }, dans l'historique
      numbering: [], // règles de numérotation des pages (voir src/numbering.js), dans l'historique
      pages: null, // liste de pages (voir src/page-ops.js), dans l'historique ; null tant que le visionneur ne l'a pas initialisée
      sources: {}, // octets des sources de pages ajoutées ({ [src]: { bytes, name } }) ; la source '0' est doc.bytes (hors historique, jamais retirées)
      nextUid: 1,
      undo: [],
      redo: [],
      selection: [], // ids des objets sélectionnés (sélection multiple)
      nextId: 1,
      view: { zoom: 4 / 3, fit: null, mode: 'continuous', spread: 1, rotation: 0 },
      page: 0,
      tool: 'select',
      // Position dans l'historique : chaque état a un identifiant unique ; « modifié » = état courant
      // différent de l'état au dernier enregistrement (ou à l'ouverture).
      stateId: 0,
      stateCounter: 0,
      savedStateId: 0,
      dirty: false,
      runtime: {},
    };
  }

  // Applique `mutator(doc)` en sauvegardant l'état précédent pour Annuler.
  // Les piles contiennent { edits, sid } : instantané des modifications et identifiant de cet état.
  const snapshot = (doc) => ({ edits: clone(doc.edits), measure: clone(doc.measure), numbering: clone(doc.numbering), ocr: Object.assign({}, doc.ocr), info: doc.info ? clone(doc.info) : null, clean: doc.clean ? clone(doc.clean) : null, form: doc.form ? clone(doc.form) : null, pages: doc.pages ? clone(doc.pages) : null, sid: doc.stateId });

  function commit(doc, mutator) {
    doc.undo.push(snapshot(doc));
    doc.redo = [];
    mutator(doc);
    doc.stateId = ++doc.stateCounter;
    refreshDirty(doc);
  }

  function undo(doc) {
    if (!doc.undo.length) return false;
    doc.redo.push(snapshot(doc));
    jump(doc, doc.undo.pop());
    return true;
  }

  function redo(doc) {
    if (!doc.redo.length) return false;
    doc.undo.push(snapshot(doc));
    jump(doc, doc.redo.pop());
    return true;
  }

  function jump(doc, entry) {
    doc.edits = entry.edits;
    if (entry.measure) doc.measure = entry.measure;
    if (entry.numbering) doc.numbering = entry.numbering;
    if (entry.ocr) doc.ocr = entry.ocr;
    if ('info' in entry) doc.info = entry.info;
    if ('clean' in entry) doc.clean = entry.clean;
    if ('form' in entry) doc.form = entry.form;
    if (entry.pages) doc.pages = entry.pages;
    doc.stateId = entry.sid;
    pruneSelection(doc);
    refreshDirty(doc);
  }

  function refreshDirty(doc) { doc.dirty = doc.stateId !== doc.savedStateId; }

  const getEdit = (doc, id) => doc.edits.find((e) => e.id === id);
  function pruneSelection(doc) {
    const ids = new Set(doc.edits.map((e) => e.id));
    doc.selection = doc.selection.filter((i) => ids.has(i));
  }

  // Ajoute une modification (avec historique) et renvoie son id.
  function addEdit(doc, edit) {
    const id = doc.nextId++;
    commit(doc, () => { doc.edits.push(Object.assign({}, edit, { id })); });
    return id;
  }

  // Ajoute plusieurs modifications en UNE étape d'historique ; renvoie leurs ids.
  function addEdits(doc, list) {
    const ids = [];
    commit(doc, () => {
      for (const e of list) { const id = doc.nextId++; ids.push(id); doc.edits.push(Object.assign({}, e, { id })); }
    });
    return ids;
  }

  function removeEdits(doc, ids) {
    const set = new Set(ids);
    commit(doc, () => { doc.edits = doc.edits.filter((e) => !set.has(e.id)); });
    pruneSelection(doc);
  }
  const removeEdit = (doc, id) => removeEdits(doc, [id]);

  // patch : objet fusionné dans chaque modification, ou fonction (edit) => objet.
  function updateEdits(doc, ids, patch) {
    const set = new Set(ids);
    commit(doc, () => {
      for (const e of doc.edits) if (set.has(e.id)) Object.assign(e, typeof patch === 'function' ? patch(e) : patch);
    });
  }
  const updateEdit = (doc, id, patch) => updateEdits(doc, [id], patch);

  // Remplace l'ordre / le contenu de la liste (ordre d'empilement) en une étape d'historique.
  function setEdits(doc, list) {
    commit(doc, () => { doc.edits = list; });
    pruneSelection(doc);
  }

  // Réglages de mesure (échelles, unité, décimales, inclusion dans le PDF) : une étape d'historique. patch : objet ou fonction (measure) => objet.
  function setMeasure(doc, patch) {
    commit(doc, () => { Object.assign(doc.measure, typeof patch === 'function' ? patch(doc.measure) : patch); });
  }

  // Règles de numérotation : remplacées en UNE étape d'historique.
  function setNumbering(doc, rules) { commit(doc, () => { doc.numbering = JSON.parse(JSON.stringify(rules)); }); }

  // Texte reconnu : entries = { [uid]: enregistrement | null } (null retire le texte d'une page) ; UNE étape d'historique pour tout le lot.
  function setOcr(doc, entries) { commit(doc, () => { const next = Object.assign({}, doc.ocr); for (const [u, rec] of Object.entries(entries)) { if (rec) next[u] = rec; else delete next[u]; } doc.ocr = next; }); }

  // Informations du document (titre, auteur, sujet, mots-clés) : une étape d'historique. info : objet complet, ou null (valeurs du fichier).
  function setInfo(doc, info) { commit(doc, () => { doc.info = info ? { title: info.title || '', author: info.author || '', subject: info.subject || '', keywords: info.keywords || '' } : null; }); }

  // Valeurs de champs de formulaire (une étape d'historique). patch : { nom: valeur } fusionné ; une valeur `undefined` retire la saisie du champ.
  function setFormValues(doc, patch) {
    commit(doc, () => {
      const values = Object.assign({}, doc.form ? doc.form.values : {});
      for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete values[k]; else values[k] = v; }
      doc.form = Object.keys(values).length ? { values } : null;
    });
  }

  // Liste de pages (voir src/page-ops.js). initPages : état de départ, hors historique.
  function initPages(doc, list, nextUid) { doc.pages = list; doc.nextUid = nextUid; }
  const pageState = (doc) => ({ pages: doc.pages, edits: doc.edits, scales: doc.measure.scales, nextId: doc.nextId, nextUid: doc.nextUid });
  // Applique un état issu de PageOps (pages, objets, échelles) en UNE étape d'historique.
  function setPagesState(doc, st) {
    commit(doc, () => { if (doc.numbering.length && doc.pages) doc.numbering = Numbering.remap(doc.numbering, doc.pages, st.pages); if (doc.pages) doc.ocr = Ocr.remap(doc.ocr, doc.pages, st.pages); doc.pages = st.pages; doc.edits = st.edits; doc.measure.scales = st.scales; doc.nextId = st.nextId; doc.nextUid = st.nextUid; });
    pruneSelection(doc);
  }
  // Enregistre une source de pages (PDF inséré, page vierge) ; sans effet si elle existe déjà.
  function addSource(doc, id, src) { if (!doc.sources[id]) doc.sources[id] = src; }

  function markSaved(doc) { doc.savedStateId = doc.stateId; refreshDirty(doc); }

  // Magasin des documents ouverts (ordre = ordre des onglets).
  function createStore() {
    const store = {
      docs: [],
      activeId: null,
      get active() { return store.docs.find((d) => d.id === store.activeId) || null; },
      add(doc) { store.docs.push(doc); store.activeId = doc.id; return doc; },
      findByPath(p) {
        if (!p) return null;
        const k = p.toLowerCase();
        return store.docs.find((d) => d.path && d.path.toLowerCase() === k) || null;
      },
      activate(id) { if (store.docs.some((d) => d.id === id)) store.activeId = id; },
      // Ferme un onglet ; l'onglet voisin devient actif si c'était l'actif.
      close(id) {
        const i = store.docs.findIndex((d) => d.id === id);
        if (i < 0) return null;
        const [removed] = store.docs.splice(i, 1);
        if (store.activeId === id) {
          const next = store.docs[Math.min(i, store.docs.length - 1)];
          store.activeId = next ? next.id : null;
        }
        return removed;
      },
      move(from, to) {
        if (from === to || from < 0 || to < 0 || from >= store.docs.length || to >= store.docs.length) return;
        const [d] = store.docs.splice(from, 1);
        store.docs.splice(to, 0, d);
      },
      // Onglet suivant (dir = 1) ou précédent (dir = -1), circulaire.
      cycle(dir) {
        if (!store.docs.length) return;
        const i = store.docs.findIndex((d) => d.id === store.activeId);
        store.activeId = store.docs[(i + dir + store.docs.length) % store.docs.length].id;
      },
      anyDirty() { return store.docs.some((d) => d.dirty); },
    };
    return store;
  }

  return { createDoc, commit, undo, redo, addEdit, addEdits, removeEdit, removeEdits, updateEdit, updateEdits, setEdits, setMeasure, setNumbering, setOcr, setInfo, setFormValues, initPages, pageState, setPagesState, addSource, getEdit, markSaved, createStore };
});
