// Formulaires AcroForm : description des champs (depuis les annotations « widget » de pdf.js) et écriture des valeurs / aplatissement (pdf-lib). Pur, UMD.
// Valeurs d'un champ (par nom) : texte → chaîne ; case à cocher → booléen ; boutons radio → valeur d'export choisie ('' = aucune) ; liste déroulante →
// chaîne ; liste à choix multiple → tableau de chaînes. Les valeurs modifiées sont dans doc.form.values (historique) ; l'écriture ne touche que les champs
// présents dans cette table, les autres gardent leur apparence d'origine.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./shapes.js'));
  else root.Forms = factory(root.Shapes);
})(typeof self !== 'undefined' ? self : this, function (Shapes) {
  'use strict';

  const FLAG_READONLY = 1, FLAG_REQUIRED = 2;

  // annotationsParPage : [[annotation pdf.js, …], …] (une liste par page, dans l'ordre du fichier). Renvoie les widgets exploitables, triés par page,
  // puis de haut en bas et de gauche à droite (ordre de la tabulation).
  function fromAnnotations(perPage) {
    const out = [];
    perPage.forEach((anns, page) => {
      for (const a of anns || []) {
        if (a.subtype !== 'Widget' || !a.fieldName) continue;
        let type = null;
        if (a.fieldType === 'Tx') type = 'text';
        else if (a.fieldType === 'Btn') type = a.checkBox ? 'check' : a.radioButton ? 'radio' : null;
        else if (a.fieldType === 'Ch') type = a.combo ? 'combo' : 'list';
        if (!type || !a.rect) continue;
        const flags = a.fieldFlags || 0;
        const f = {
          name: a.fieldName, type, page, rect: a.rect.slice(), id: a.id,
          readOnly: !!a.readOnly || !!(flags & FLAG_READONLY), required: !!(flags & FLAG_REQUIRED),
          multiline: !!a.multiLine, maxLen: a.maxLen || 0, password: !!a.password, comb: !!a.comb,
        };
        if (type === 'check') { f.exportValue = a.exportValue || 'Yes'; f.checked = a.fieldValue !== undefined && a.fieldValue !== null && a.fieldValue !== 'Off' && a.fieldValue !== '' && (a.fieldValue === f.exportValue || a.fieldValue === true || a.fieldValue === 'Yes'); }
        else if (type === 'radio') { f.exportValue = a.buttonValue || a.exportValue || ''; f.selected = a.fieldValue === f.exportValue && f.exportValue !== ''; }
        else if (type === 'combo' || type === 'list') {
          f.options = (a.options || []).map((o) => ({ v: o.exportValue !== undefined ? o.exportValue : o.displayValue, t: o.displayValue !== undefined ? o.displayValue : o.exportValue }));
          f.multiSelect = !!a.multiSelect;
          const v = a.fieldValue;
          f.value = type === 'list' ? (Array.isArray(v) ? v.slice() : v ? [v] : []) : Array.isArray(v) ? (v[0] || '') : (v || '');
        } else f.value = Array.isArray(a.fieldValue) ? a.fieldValue.join('\n') : (a.fieldValue || '');
        out.push(f);
      }
    });
    out.sort((p, q) => p.page - q.page || (q.rect[3] - p.rect[3]) || (p.rect[0] - q.rect[0]));
    return out;
  }

  // Valeur initiale (celle du fichier) d'un champ, tous widgets d'un même nom confondus.
  function initialValue(fields, name) {
    const ws = fields.filter((f) => f.name === name);
    if (!ws.length) return undefined;
    const f = ws[0];
    if (f.type === 'check') return ws.some((w) => w.checked);
    if (f.type === 'radio') { const s = ws.find((w) => w.selected); return s ? s.exportValue : ''; }
    return f.value;
  }
  const names = (fields) => [...new Set(fields.map((f) => f.name))];

  // Texte propre aux polices standard (WinAnsi) : le reste est remplacé par « ? ». changed = true si quelque chose a été remplacé.
  function cleanText(t) { const s = Shapes.sanitize(t); return { text: s, changed: s !== String(t) }; }

  // Écrit les valeurs dans le formulaire de `doc` (PDFDocument) puis l'aplatit si demandé. form = { values, flatten }. warn(message) : avertissements.
  // Sans AcroForm : rien n'est fait (jamais d'AcroForm créé dans un PDF qui n'en a pas).
  function apply(PDFLib, doc, form, warn) {
    if (!form) return { set: 0, flattened: false };
    const { PDFName, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList } = PDFLib;
    if (!doc.catalog.lookup(PDFName.of('AcroForm'))) return { set: 0, flattened: false };
    const pf = doc.getForm();
    const say = warn || (() => {});
    let set = 0;
    for (const [name, v] of Object.entries(form.values || {})) {
      let fld = null;
      try { fld = pf.getField(name); } catch { say(`Champ « ${name} » introuvable : valeur ignorée.`); continue; }
      try {
        if (fld instanceof PDFTextField) {
          const c = cleanText(v === undefined || v === null ? '' : v);
          if (c.changed) say(`Champ « ${name} » : caractères non pris en charge remplacés par « ? ».`);
          if (c.text === '') fld.setText(undefined); else fld.setText(c.text);
        } else if (fld instanceof PDFCheckBox) { if (v) fld.check(); else fld.uncheck(); }
        else if (fld instanceof PDFRadioGroup) {
          if (!v) fld.clear();
          else { // valeur d'export lue par pdf.js (souvent l'indice « 0 », « 1 » de l'état) → libellé d'option de pdf-lib
            const opts = fld.getOptions();
            let sel = String(v);
            if (!opts.includes(sel) && /^\d+$/.test(sel) && opts[Number(sel)] !== undefined) sel = opts[Number(sel)];
            fld.select(sel);
          }
        }
        else if (fld instanceof PDFDropdown) {
          const c = cleanText(v || '');
          if (c.text === '') fld.clear();
          else { if (!fld.getOptions().includes(c.text)) fld.addOptions([c.text]); fld.select(c.text); }
        } else if (fld instanceof PDFOptionList) {
          const arr = (Array.isArray(v) ? v : v ? [v] : []).map((x) => cleanText(x).text);
          if (!arr.length) fld.clear(); else { const have = fld.getOptions(); const add = arr.filter((x) => !have.includes(x)); if (add.length) fld.addOptions(add); fld.select(arr); }
        } else continue;
        set++;
      } catch (e) { say(`Champ « ${name} » : valeur non écrite (${e && e.message ? e.message : e}).`); }
    }
    let flattened = false;
    if (form.flatten) { pf.flatten(); flattened = true; }
    return { set, flattened };
  }

  return { fromAnnotations, initialValue, names, cleanText, apply };
});
