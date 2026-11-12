// Onglet « Formulaire » : création de champs (texte, case à cocher, boutons radio, liste déroulante, liste, date), propriétés, noms uniques,
// copies, mode « Prévisualiser / remplir » (calque du lot 3d, forms-ui.js), ordre de tabulation (fields-order.js), alignement (align.js).
// Un champ est un objet de l'historique (type 'field', voir src/fields.js) : sélection, déplacement, redimensionnement, Ctrl+D, suppression,
// annuler / rétablir sont ceux des autres objets. Outils persistants : un clic pose un champ à la taille par défaut, un glisser trace son cadre.
import { $, bus, store, toast } from './ui.js';
import * as V from './viewer.js';
import * as A from './annotate.js';

const { DocModel, Fields, Shapes } = window;
const rt = (doc) => doc.runtime;
export const TOOLS = Fields.FTYPES.map((t) => 'field-' + t);
const ftypeOf = (tool) => (tool && tool.startsWith('field-') ? tool.slice(6) : null);
const STYLE = ['font', 'fontSize', 'align', 'color', 'fill', 'border', 'borderWidth', 'multiline', 'required', 'readOnly', 'visible'];

// Noms déjà pris : champs créés + champs d'origine du PDF (calque du lot 3d).
export function takenNames(doc, except) {
  const s = Fields.namesOf(doc.edits);
  for (const f of rt(doc).formFields || []) s.add(f.name);
  if (except) s.delete(except);
  return s;
}
const fieldsOf = (doc) => doc.edits.filter(Fields.isField);

// ----------------------------------------------------------------------------- création
function baseFor(ftype) {
  const d = A.defaultsOf('field-' + ftype);
  const o = Fields.defaults(ftype);
  for (const k of STYLE) if (d[k] !== undefined) o[k] = d[k];
  return o;
}
function finish(doc, ftype, o) {
  const f = Object.assign(Fields.create(ftype, o.page, [o.cx - o.w / 2, o.cy - o.h / 2, o.cx + o.w / 2, o.cy + o.h / 2], takenNames(doc)), pick(o, STYLE));
  if (ftype === 'radio') {
    // les boutons posés à la suite rejoignent le groupe courant (« Nouveau groupe » en démarre un autre)
    const r = rt(doc);
    const g = r.radioGroup && fieldsOf(doc).some((e) => e.ftype === 'radio' && e.name === r.radioGroup) ? r.radioGroup : null;
    if (g) {
      f.name = g;
      const opts = new Set(fieldsOf(doc).filter((e) => e.ftype === 'radio' && e.name === g).map((e) => e.export));
      f.export = Fields.uniqueName('Choix1', opts);
      const first = fieldsOf(doc).find((e) => e.ftype === 'radio' && e.name === g);
      for (const k of Fields.GROUP_KEYS) if (k !== 'name') f[k] = first[k];
    } else { r.radioGroup = f.name; f.value = true; }
  }
  const tabs = fieldsOf(doc).map((e) => e.tab).filter(Number.isFinite);
  if (tabs.length) f.tab = Math.max(...tabs) + 1; // ordre déjà réglé à la main : le nouveau champ vient en dernier
  return f;
}
const pick = (o, keys) => { const r = {}; for (const k of keys) if (o[k] !== undefined) r[k] = o[k]; return r; };

function tool(ftype) {
  return {
    down(doc, rec, ev) {
      if (rt(doc).fieldPreview) return;
      ev.preventDefault();
      A.startCreateDrag(doc, rec, ev, {
        type: 'field', base: baseFor(ftype),
        click: (pt, base) => { const r = Fields.rectAt(ftype, pt[0], pt[1]); return Object.assign({}, base, { cx: (r[0] + r[2]) / 2, cy: (r[1] + r[3]) / 2, w: r[2] - r[0], h: r[3] - r[1], rot: 0 }); },
        finish: (o) => finish(doc, ftype, o),
      });
    },
    cancel() { return false; },
  };
}

// ----------------------------------------------------------------------------- propriétés
const IS = (...t) => (o) => t.includes(o.ftype);
const ALLT = ['field', ...TOOLS];
export const PROPS = [
  { k: 'name', label: 'Nom du champ', kind: 'text', types: ALLT, group: 'Champ', when: (o) => !o._virtual },
  { k: 'export', label: 'Valeur de l\'option', kind: 'text', types: ALLT, group: 'Champ', when: IS('radio') },
  { k: 'tip', label: 'Infobulle', kind: 'text', empty: true, types: ALLT, group: 'Champ', when: (o) => !o._virtual },
  { k: 'value', label: 'Valeur par défaut', kind: 'text', empty: true, types: ALLT, group: 'Champ', when: (o) => !o._virtual && ['text', 'date', 'combo', 'list'].includes(o.ftype) },
  { k: 'value', label: 'Cochée par défaut', kind: 'bool', types: ALLT, group: 'Champ', when: (o) => !o._virtual && o.ftype === 'check' },
  { k: 'value', label: 'Choisie par défaut', kind: 'bool', types: ALLT, group: 'Champ', when: (o) => !o._virtual && o.ftype === 'radio' },
  { k: 'optionsText', label: 'Options (une par ligne)', kind: 'textarea', types: ALLT, group: 'Champ', when: IS('combo', 'list'), get: (o) => (o.options || []).join('\n') },
  { k: 'multiline', label: 'Plusieurs lignes', kind: 'bool', types: ALLT, group: 'Champ', when: IS('text') },
  { k: 'maxLen', label: 'Caractères max. (0 = libre)', kind: 'number', min: 0, max: 2000, step: 1, types: ALLT, group: 'Champ', when: IS('text', 'date') },
  { k: 'required', label: 'Obligatoire', kind: 'bool', types: ALLT, group: 'Champ' },
  { k: 'readOnly', label: 'Lecture seule', kind: 'bool', types: ALLT, group: 'Champ' },
  { k: 'visible', label: 'Visible', kind: 'bool', types: ALLT, group: 'Champ' },
  { k: 'font', label: 'Police', kind: 'select', options: [['Helvetica', 'Helvetica'], ['Times', 'Times'], ['Courier', 'Courier']], types: ALLT, group: 'Texte', when: IS('text', 'date', 'combo', 'list') },
  { k: 'fontSize', label: 'Taille (0 = auto)', kind: 'number', min: 0, max: 72, step: 1, types: ALLT, group: 'Texte', when: IS('text', 'date', 'combo', 'list') },
  { k: 'align', label: 'Alignement', kind: 'select', options: [['left', 'Gauche'], ['center', 'Centré'], ['right', 'Droite']], types: ALLT, group: 'Texte', when: IS('text', 'date') },
  { k: 'color', label: 'Couleur du texte', kind: 'color', types: ALLT, group: 'Texte' },
  { k: 'fill', label: 'Fond', kind: 'colorOrNone', types: ALLT, group: 'Aspect' },
  { k: 'border', label: 'Bordure', kind: 'colorOrNone', types: ALLT, group: 'Aspect' },
  { k: 'borderWidth', label: 'Épaisseur de la bordure', kind: 'number', min: 0, max: 6, step: 0.5, types: ALLT, group: 'Aspect' },
];

// Réglage d'une propriété sur la sélection (objets réels). Renvoie true (traité, UNE étape d'historique) ou false (refusé, rien n'est fait).
function setFieldProp(doc, objs, key, value) {
  const sel = objs.filter(Fields.isField);
  if (!sel.length) return false;
  const all = fieldsOf(doc);
  const groupOf = (o) => (o.ftype === 'radio' ? all.filter((e) => e.ftype === 'radio' && e.name === o.name) : [o]);
  const patches = new Map(); // id → patch
  const put = (o, p) => patches.set(o.id, Object.assign(patches.get(o.id) || {}, p));
  let values = null; // renommage : la saisie suit le nouveau nom

  if (key === 'name') {
    const n = String(value || '').trim();
    const err = Fields.nameError(n);
    if (err) { toast(err, 5000); return false; }
    const olds = [...new Set(sel.map((o) => o.name))];
    if (olds.length > 1) { toast('Renommez les champs un par un (un nom par champ).', 4000); return false; }
    if (n === olds[0]) return true;
    const radio = sel[0].ftype === 'radio';
    const clash = all.find((e) => e.name === n);
    if (clash && !(radio && clash.ftype === 'radio')) { toast(`Le nom « ${n} » est déjà utilisé par un autre champ.`, 5000); return false; }
    if ((rt(doc).formFields || []).some((f) => f.name === n)) { toast(`Le nom « ${n} » est déjà celui d'un champ du PDF d'origine.`, 5000); return false; }
    // bouton radio renommé vers un groupe existant : il rejoint ce groupe (option unique) ; sinon tout le groupe est renommé
    if (radio && clash) {
      const opts = new Set(all.filter((e) => e.ftype === 'radio' && e.name === n).map((e) => e.export));
      for (const o of sel) { put(o, { name: n, value: false, export: Fields.uniqueName(o.export, opts) }); opts.add(o.export); }
    } else for (const o of sel) for (const g of groupOf(o)) put(g, { name: n });
    const v = doc.form && doc.form.values;
    if (v && Object.prototype.hasOwnProperty.call(v, olds[0]) && !(radio && clash)) values = { [olds[0]]: undefined, [n]: v[olds[0]] };
  } else if (key === 'export') {
    const t = String(value || '').trim();
    if (!t) { toast('La valeur de l\'option ne peut pas être vide.', 4000); return false; }
    for (const o of sel) {
      if (o.ftype !== 'radio') continue;
      if (groupOf(o).some((g) => g.id !== o.id && g.export === t)) { toast(`L'option « ${t} » existe déjà dans le groupe « ${o.name} ».`, 5000); return false; }
      put(o, { export: t });
    }
  } else if (key === 'value') {
    for (const o of sel) {
      if (o.ftype === 'radio') { for (const g of groupOf(o)) put(g, { value: g.id === o.id ? !!value : (value ? false : g.value) }); }
      else if (o.ftype === 'check') put(o, { value: !!value });
      else if (o.ftype === 'combo' || o.ftype === 'list') {
        const t = String(value || '').trim();
        if (t && !(o.options || []).includes(t)) { toast(`« ${t} » n'est pas une des options du champ.`, 5000); return false; }
        put(o, { value: t });
      } else put(o, { value: o.maxLen > 0 ? String(value).slice(0, o.maxLen) : String(value) });
    }
  } else if (key === 'optionsText') {
    const opts = String(value || '').split(/\r?\n/).map((s) => s.trim()).filter((s, i, a) => s && a.indexOf(s) === i);
    if (!opts.length) { toast('Saisissez au moins une option.', 4000); return false; }
    for (const o of sel) put(o, { options: opts, value: opts.includes(o.value) ? o.value : '' });
  } else if (Fields.GROUP_KEYS.includes(key)) {
    for (const o of sel) for (const g of groupOf(o)) put(g, { [key]: value });
  } else for (const o of sel) put(o, { [key]: value });

  DocModel.commit(doc, (d) => {
    d.edits = d.edits.map((e) => (patches.has(e.id) ? Object.assign({}, e, patches.get(e.id)) : e));
    if (values) {
      const nv = Object.assign({}, d.form ? d.form.values : {});
      for (const [k, v] of Object.entries(values)) { if (v === undefined) delete nv[k]; else nv[k] = v; }
      d.form = Object.assign({}, d.form || {}, { values: nv });
    }
  });
  return true;
}

// ----------------------------------------------------------------------------- prévisualiser / remplir
export const isPreview = (doc) => !!(doc && rt(doc).fieldPreview);
export function togglePreview(doc, on) {
  const r = rt(doc);
  const next = on === undefined ? !r.fieldPreview : !!on;
  if (next && !fieldsOf(doc).length) { toast('Aucun champ créé : tracez d\'abord des champs (outils de l\'onglet Formulaire).', 4500); return false; }
  r.fieldPreview = next;
  if (next) { A.setTool(doc, 'select'); doc.selection = []; }
  V.hooks.renderAll(doc);
  bus.emit('doc-changed', doc);
  if (next) toast('Prévisualisation : remplissez les champs comme un lecteur (Tab pour passer au suivant). Les saisies sont enregistrées dans le PDF ; « Prévisualiser » à nouveau pour revenir à la conception.', 6500);
  return true;
}

// ----------------------------------------------------------------------------- commandes
export const commands = {
  'fld-preview': (d) => togglePreview(d),
  'fld-radio-new': (d) => { rt(d).radioGroup = null; A.setTool(d, 'field-radio'); toast('Le prochain bouton radio commencera un nouveau groupe.', 3000); },
};
export function ribbonState(cmd, doc) {
  if (cmd === 'fld-preview') return { disabled: !doc || !fieldsOf(doc).length, pressed: isPreview(doc) };
  if (cmd === 'fld-radio-new') return { disabled: !doc || isPreview(doc) };
  if (TOOLS.includes(cmd.replace(/^tool-/, '')) && cmd.startsWith('tool-')) return { disabled: !doc || isPreview(doc) };
  return null;
}

export function initFields() {
  for (const t of Fields.FTYPES) {
    A.registerTool('field-' + t, Fields.LABELS[t], tool(t));
    Shapes.LABELS['field-' + t] = Fields.LABELS[t];
    A.defaultsByType['field-' + t] = Object.assign(Fields.defaults(t), { _virtual: true });
  }
  A.FIELDS.push(...PROPS);
  A.propHooks.field = setFieldProp;
  // copies (Ctrl+D, collage) : noms uniques ; un bouton radio copié rejoint son groupe avec une nouvelle option
  A.hooks.beforeAdd.push((doc, list) => Fields.renameCopies(list, doc.edits, true, [...(rt(doc).formFields || []).map((f) => f.name)]));
  // un outil radio repris depuis un autre outil démarre un nouveau groupe
  let last = null;
  bus.on('tool', (doc) => { if (!doc) return; if (doc.tool === 'field-radio' && last !== 'field-radio') rt(doc).radioGroup = null; last = doc.tool; if (doc.tool !== 'select' && rt(doc).fieldPreview && TOOLS.includes(doc.tool)) togglePreview(doc, false); });
  void store; void $; void ftypeOf;
}
