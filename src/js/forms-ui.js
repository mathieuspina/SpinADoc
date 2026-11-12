// Formulaires AcroForm (interface) : les champs détectés par pdf.js sont affichés comme champs remplissables par-dessus la page (calque HTML), avec
// surbrillance (affichable / masquable), tabulation clavier (Tab, Maj+Tab), marquage des champs obligatoires et en lecture seule. Les saisies sont des
// étapes d'historique (DocModel.setFormValues) ; elles sont écrites dans le PDF à l'enregistrement (src/forms.js), avec aplatissement en option.
// Limite connue : une opération de pages reconstruit le document et fait perdre les champs d'origine (on prévient avant, voir guard()).
import { $, bus, store, toast, askChoice } from './ui.js';
import * as V from './viewer.js';
import * as A from './annotate.js';

const { DocModel, Forms, PageOps, Fields } = window;
const rt = (doc) => doc.runtime;

// Branché par app.js : ouvre des octets dans un nouvel onglet non enregistré.
export const hooks = { openResult: async () => {} };

// ----------------------------------------------------------------------------- détection
export async function scan(doc) {
  const pdf = V.getPdf(doc);
  const r = rt(doc);
  r.formFields = [];
  let has = null;
  try { has = await pdf.getFieldObjects(); } catch { has = null; }
  if (!has) return 0;
  const per = [];
  for (let i = 1; i <= pdf.numPages; i++) per.push(await (await pdf.getPage(i)).getAnnotations());
  r.formFields = Forms.fromAnnotations(per);
  r.formInit = {};
  for (const n of Forms.names(r.formFields)) r.formInit[n] = Forms.initialValue(r.formFields, n);
  if (!r.formFields.length) return 0;
  renderForms(doc);
  bus.emit('doc-changed', doc);
  const n = Forms.names(r.formFields).length;
  toast(`Formulaire détecté : ${n} champ${n > 1 ? 's' : ''}. Remplissez-le directement sur la page (Tab pour passer au suivant).`, 6000);
  return n;
}

export const hasFields = (doc) => !!(rt(doc).formFields && rt(doc).formFields.length);
const identity = (doc) => !!doc.pages && V.getPdf(doc) && PageOps.isIdentity(doc.pages, V.getPdf(doc).numPages);
const active = (doc) => hasFields(doc) && identity(doc);

// Pages dont le canevas est dessiné SANS les widgets (le calque HTML les remplace) ; recalculé quand l'état « champs actifs » change.
function syncMode(doc) {
  const r = rt(doc);
  const on = active(doc);
  if (!!r.formActive === on) return;
  r.formActive = on;
  r.formUids = on ? new Set(doc.pages.filter((d) => r.formFields.some((f) => f.page === Number(d.i)) && d.src === '0').map((d) => d.u)) : null;
  for (const rec of r.pages || []) rec.rendered = false;
  V.refreshVisible(doc);
}

// ----------------------------------------------------------------------------- valeurs
const current = (doc, name) => {
  const v = doc.form && doc.form.values;
  return v && Object.prototype.hasOwnProperty.call(v, name) ? v[name] : rt(doc).formInit[name];
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function commit(doc, name, value) {
  if (same(current(doc, name), value)) return;
  // retour à la valeur d'origine : la saisie est retirée
  DocModel.setFormValues(doc, { [name]: same(rt(doc).formInit[name], value) ? undefined : value });
  const c = Forms.cleanText(Array.isArray(value) ? value.join('') : typeof value === 'string' ? value : '');
  if (c.changed) toast('Certains caractères ne sont pas pris en charge par les polices du PDF : ils seront remplacés par « ? » à l\'enregistrement.', 6000);
  bus.emit('doc-changed', doc);
}

// ----------------------------------------------------------------------------- calque HTML par page
function build(doc, rec, fields, sig) {
  const layer = document.createElement('div');
  layer.className = 'form-layer';
  layer.dataset.sig = sig;
  for (const ev of ['mousedown', 'dblclick', 'contextmenu', 'pointerdown']) layer.addEventListener(ev, (e) => e.stopPropagation());
  for (const f of fields) {
    const [x1, y1, x2, y2] = rec.vp.convertToViewportRectangle(f.rect);
    const left = Math.min(x1, x2), top = Math.min(y1, y2), w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
    let el;
    if (f.type === 'text') {
      el = f.multiline ? document.createElement('textarea') : document.createElement('input');
      if (!f.multiline) el.type = f.password ? 'password' : 'text';
      if (f.maxLen) el.maxLength = f.maxLen;
      el.spellcheck = false;
      if (f.placeholder) el.placeholder = f.placeholder;
    } else if (f.type === 'check' || f.type === 'radio') {
      el = document.createElement('input'); el.type = f.type === 'check' ? 'checkbox' : 'radio';
      if (f.type === 'radio') el.name = 'ffr-' + doc.id + '-' + f.name;
    } else {
      el = document.createElement('select');
      if (f.type === 'list') { el.multiple = true; } else { const o = document.createElement('option'); o.value = ''; o.textContent = ''; el.append(o); }
      for (const o of f.options) { const op = document.createElement('option'); op.value = o.v; op.textContent = o.t; el.append(op); }
    }
    el.classList.add('ff');
    el.dataset.field = f.name; el.dataset.ftype = f.type;
    if (f.type === 'radio') el.dataset.export = f.exportValue;
    if (f.readOnly) { el.dataset.ro = '1'; if (f.type === 'text') el.readOnly = true; else el.disabled = true; }
    if (f.required) { el.dataset.required = '1'; el.title = 'Champ obligatoire'; el.setAttribute('aria-required', 'true'); }
    el.setAttribute('aria-label', f.name + (f.required ? ' (obligatoire)' : '') + (f.readOnly ? ' (lecture seule)' : ''));
    el.style.cssText = `left:${left}px;top:${top}px;width:${w}px;height:${h}px;font-size:${Math.max(8, Math.min(h * 0.62, 20))}px`;
    setValue(el, current(doc, f.name));
    el.addEventListener('change', () => commit(doc, f.name, readEl(el)));
    layer.append(el);
  }
  return layer;
}
const sigOf = (rec) => `${rec.uid}|${rec.vp.scale}|${rec.vp.rotation}|${rec.vp.width}`;

function setValue(el, v) {
  const t = el.dataset.ftype;
  if (t === 'check') el.checked = !!v;
  else if (t === 'radio') el.checked = v !== undefined && v !== '' && v === el.dataset.export;
  else if (t === 'list') { const s = new Set(Array.isArray(v) ? v : v ? [v] : []); for (const o of el.options) o.selected = s.has(o.value); }
  else el.value = v === undefined || v === null ? '' : v;
}
function readEl(el) {
  const t = el.dataset.ftype;
  if (t === 'check') return el.checked;
  if (t === 'radio') return el.checked ? el.dataset.export : undefined;
  if (t === 'list') return [...el.selectedOptions].map((o) => o.value);
  return el.value;
}

// Dessine ou met à jour les calques de toutes les pages (appelé à chaque redessin des annotations : zoom, pages, annuler / rétablir).
export function renderForms(doc) {
  const r = rt(doc);
  syncMode(doc);
  const on = r.formActive;
  // champs créés (onglet Formulaire) en mode « Prévisualiser / remplir » : mêmes contrôles, page = indice de sortie, valeur initiale = défaut
  const created = r.fieldPreview ? Fields.descriptors(doc.edits) : [];
  if (created.length) { r.formInit = r.formInit || {}; for (const f of created) r.formInit[f.name] = Fields.defaultValue(doc.edits, f.name); }
  for (const rec of r.pages || []) {
    const old = rec.formLayer;
    const fields = (on ? r.formFields.filter((f) => f.page === Number(rec.desc.i) && rec.desc.src === '0') : []).concat(created.filter((f) => f.page === rec.index));
    if (!fields.length) { if (old) { old.remove(); rec.formLayer = null; } continue; }
    const sig = sigOf(rec) + '|' + JSON.stringify(fields.map((f) => [f.name, f.type, f.rect, f.exportValue, f.options, f.readOnly, f.required, f.maxLen, f.multiline]));
    if (old && old.dataset.sig === sig) {
      for (const el of old.querySelectorAll('.ff')) setValue(el, current(doc, el.dataset.field)); // même disposition : valeurs seules (le focus est conservé)
    } else {
      const layer = build(doc, rec, fields, sig);
      if (old) old.replaceWith(layer); else rec.div.append(layer);
      rec.formLayer = layer;
    }
    rec.formLayer.classList.toggle('hl', r.formHL !== false);
  }
}

// ----------------------------------------------------------------------------- commandes
export function toggleHighlight(doc) { rt(doc).formHL = rt(doc).formHL === false; renderForms(doc); bus.emit('doc-changed', doc); }
export function toggleFlatten(doc) {
  rt(doc).flatten = !rt(doc).flatten;
  toast(rt(doc).flatten ? 'À l\'enregistrement, le formulaire sera aplati : les champs deviennent du contenu figé.' : 'Le formulaire restera remplissable à l\'enregistrement.', 4500);
  bus.emit('doc-changed', doc);
}
// Exemplaire aplati dans un nouvel onglet (non enregistré) : sert à poursuivre avec des opérations de pages sans perdre le contenu des champs.
export async function flattenToTab(doc) {
  A.closeEditor(doc, true);
  const warns = [];
  const bytes = await V.exportBytes(doc, null, { form: { values: doc.form ? doc.form.values : {}, flatten: true }, warn: (m) => warns.push(m) });
  await hooks.openResult(doc.name.replace(/\.pdf$/i, '') + ' (aplati).pdf', bytes);
  toast('Exemplaire aplati ouvert dans un nouvel onglet (non enregistré).' + (warns.length ? ' ' + warns[0] : ''), 6000);
}

// Avant une opération de pages qui reconstruit le document : prévient de la perte des champs (renvoie true si on peut continuer).
export async function guard(doc, newPages) {
  if (!active(doc)) return true;
  if (PageOps.isIdentity(newPages, V.getPdf(doc).numPages)) return true;
  const filled = !!(doc.form && Object.keys(doc.form.values).length);
  const ch = await askChoice({
    title: 'Champs de formulaire',
    message: `Cette opération reconstruit le document : les champs de formulaire d'origine ne seront plus remplissables${filled ? ' et vos saisies ne seront pas conservées' : ''}. Vous pouvez d'abord remplir le formulaire puis l'aplatir (ses champs deviennent du contenu figé, dans un nouvel onglet), ou continuer sans les champs.`,
    buttons: [{ id: 'cancel', label: 'Annuler' }, { id: 'flat', label: 'Aplatir d\'abord' }, { id: 'go', label: 'Continuer sans les champs', primary: true }],
  });
  if (ch === 'flat') { await flattenToTab(doc); return false; }
  return ch === 'go';
}

export const commands = {
  'form-highlight': (d) => toggleHighlight(d),
  'form-flatten': (d) => toggleFlatten(d),
  'form-flatten-now': (d) => flattenToTab(d),
};
export const isFormCmd = (c) => Object.prototype.hasOwnProperty.call(commands, c);
export const exec = (c, d) => (d && commands[c] ? commands[c](d) : undefined);
export function ribbonState(cmd, doc) {
  if (!isFormCmd(cmd)) return null;
  if (!doc || !hasFields(doc)) return { disabled: true, pressed: cmd === 'form-highlight' ? false : cmd === 'form-flatten' ? false : undefined };
  if (cmd === 'form-highlight') return { disabled: false, pressed: rt(doc).formHL !== false };
  if (cmd === 'form-flatten') return { disabled: false, pressed: !!rt(doc).flatten };
  return { disabled: false };
}

export function init() {
  const prev = V.hooks.renderAll;
  V.hooks.renderAll = (doc) => { prev(doc); renderForms(doc); };
  // Annuler / rétablir, opérations de pages, saisies : valeurs et présence des calques remises à jour (le focus est conservé : même disposition).
  bus.on('doc-changed', (doc) => { if (doc && doc.runtime && doc.runtime.pages) renderForms(doc); });
  bus.on('pages', (doc) => { if (doc && doc.runtime && doc.runtime.pages) renderForms(doc); });
}
