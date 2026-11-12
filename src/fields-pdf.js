// Écriture des champs créés (src/fields.js) comme de VRAIS champs AcroForm (pdf-lib), apparences générées. UMD pur, appelé par pdf-edit
// (type 'field', passe « finish » après les objets dessinés). Même cadre que l'aperçu : le rectangle du widget est exactement le cadre de l'objet
// (coordonnées PDF de la page) ; sur une page pivotée, /MK /R = rotation de la page (texte droit à l'affichage, comme l'aperçu).
// Ordre de tabulation : les widgets sont ajoutés à /Annots dans l'ordre de tabulation (Fields.tabOrder).
// /NeedAppearances : false quand toutes les apparences ont été générées ; true (le lecteur les recalcule) si une génération a échoué.
// Noms en conflit avec un champ déjà présent dans le PDF : renommés (Fields.uniqueName), avec avertissement.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./fields.js'), require('./forms.js'));
  else root.FieldsPdf = factory(root.Fields, root.Forms);
})(typeof self !== 'undefined' ? self : this, function (Fields, Forms) {
  'use strict';

  const FONTS = { Helvetica: 'Helvetica', Times: 'TimesRoman', Courier: 'Courier' };
  const FLAG_HIDDEN = 2, FLAG_PRINT = 4;

  // fields : objets 'field' (page = indice de page de SORTIE) ; values : doc.form.values (saisies, prioritaires sur la valeur par défaut).
  // Renvoie { written, renamed: { ancien: nouveau }, needAppearances }.
  async function write(PDFLib, doc, fields, values, warn) {
    const { PDFName, PDFHexString, PDFBool, PDFRadioGroup, rgb, degrees, TextAlignment, StandardFonts } = PDFLib;
    const say = warn || (() => {});
    const pages = doc.getPages();
    const list = Fields.tabOrder(fields).filter((f) => pages[f.page] && f.w > 0.5 && f.h > 0.5);
    if (!list.length) return { written: 0, renamed: {}, needAppearances: false };
    const form = doc.getForm();
    const existing = new Set(form.getFields().map((f) => f.getName()));
    const renamed = {};
    const nameOf = (n) => {
      if (renamed[n]) return renamed[n];
      if (!existing.has(n)) { existing.add(n); renamed[n] = n; return n; }
      const m = Fields.uniqueName(n, existing); existing.add(m); renamed[n] = m;
      say(`Champ « ${n} » : ce nom existe déjà dans le PDF, écrit sous le nom « ${m} ».`);
      return m;
    };
    const fonts = {};
    const fontOf = async (f) => { const k = FONTS[f.font] || 'Helvetica'; return fonts[k] || (fonts[k] = await doc.embedFont(StandardFonts[k])); };
    const col = (c) => rgb(c[0], c[1], c[2]);
    const clean = (t) => { const c = Forms.cleanText(t === undefined || t === null ? '' : String(t)); if (c.changed) say('Champ : caractères non pris en charge par les polices du PDF remplacés par « ? ».'); return c.text; };
    const valueOf = (f) => (values && Object.prototype.hasOwnProperty.call(values, f.name) && values[f.name] !== undefined ? values[f.name] : Fields.defaultValue(fields, f.name));
    const groups = {};
    const made = [];
    let written = 0;

    for (const f of list) {
      const page = pages[f.page];
      const rot = ((page.getRotation().angle % 360) + 360) % 360;
      const [x0, y0] = Fields.rectOf(f);
      const side = rot % 180 !== 0;
      const font = await fontOf(f);
      const bw = f.border ? Math.max(0, f.borderWidth || 0) : 0;
      const opts = {
        x: x0, y: y0, width: side ? f.h : f.w, height: side ? f.w : f.h, rotate: degrees(rot), font,
        textColor: col(f.color || [0, 0, 0]), backgroundColor: f.fill ? col(f.fill) : undefined, borderColor: f.border ? col(f.border) : undefined, borderWidth: bw,
      };
      const name = nameOf(f.name);
      let field;
      if (f.ftype === 'radio') {
        field = groups[name];
        if (!field) { field = groups[name] = form.createRadioGroup(name); made.push({ field, f, font, kind: 'radio' }); }
        field.addOptionToPage(clean(f.export || 'Choix'), page, opts);
      } else if (f.ftype === 'check') {
        field = form.createCheckBox(name);
        field.addToPage(page, opts);
        made.push({ field, f, font, kind: 'check' });
      } else if (f.ftype === 'combo' || f.ftype === 'list') {
        field = f.ftype === 'combo' ? form.createDropdown(name) : form.createOptionList(name);
        const options = (f.options || []).map(clean).filter((o, i, a) => o !== '' && a.indexOf(o) === i);
        if (options.length) field.addOptions(options);
        field.addToPage(page, opts);
        made.push({ field, f, font, kind: f.ftype });
      } else {
        field = form.createTextField(name);
        if (f.ftype === 'text' && f.multiline) field.enableMultiline();
        if (f.maxLen > 0) field.setMaxLength(f.maxLen);
        field.setAlignment(f.align === 'center' ? TextAlignment.Center : f.align === 'right' ? TextAlignment.Right : TextAlignment.Left);
        field.addToPage(page, opts);
        made.push({ field, f, font, kind: 'text' });
      }
      // cadre exact (pdf-lib décale de la demi-épaisseur de bordure et attend un coin « vu ») ; visibilité
      const ws = field.acroField.getWidgets();
      const w = ws[ws.length - 1];
      w.setRectangle({ x: x0, y: y0, width: f.w, height: f.h });
      w.dict.set(PDFName.of('F'), PDFLib.PDFNumber.of(f.visible === false ? FLAG_HIDDEN : FLAG_PRINT));
      written++;
    }

    // valeurs, valeurs par défaut (/DV), drapeaux, infobulle, police ; puis apparences
    let need = false;
    const seen = new Set();
    for (const m of made) {
      const { field, f, font, kind } = m;
      if (seen.has(field)) continue;
      seen.add(field);
      const d = field.acroField.dict;
      const v = valueOf(f), dv = Fields.defaultValue(fields, f.name);
      try {
        if (kind === 'text') {
          const t = clean(v);
          if (t) field.setText(f.maxLen > 0 ? t.slice(0, f.maxLen) : t);
          if (dv) d.set(PDFName.of('DV'), PDFHexString.fromText(clean(dv)));
          if (f.fontSize > 0) field.setFontSize(f.fontSize);
        } else if (kind === 'check') {
          if (v) field.check(); else field.uncheck();
          d.set(PDFName.of('DV'), PDFName.of(dv ? 'Yes' : 'Off'));
        } else if (kind === 'radio') {
          const opts = field.getOptions();
          if (v && opts.includes(clean(v))) field.select(clean(v));
          if (dv && opts.includes(clean(dv))) { const i = opts.indexOf(clean(dv)); d.set(PDFName.of('DV'), PDFName.of(String(i))); }
        } else {
          const want = (Array.isArray(v) ? v : v ? [v] : []).map(clean).filter((x) => field.getOptions().includes(x));
          if (want.length) field.select(kind === 'list' ? want.slice(0, 1) : want[0]);
          const dvs = (Array.isArray(dv) ? dv : dv ? [dv] : []).map(clean);
          if (dvs.length) d.set(PDFName.of('DV'), PDFHexString.fromText(dvs[0]));
          if (f.fontSize > 0) field.setFontSize(f.fontSize);
        }
      } catch (e) { say(`Champ « ${f.name} » : valeur non écrite (${e && e.message ? e.message : e}).`); }
      const tip = f.tip || (f.ftype === 'date' ? 'Date (' + Fields.DATE_FORMAT + ')' : '');
      if (tip) { // sur le champ (norme) et sur ses widgets (lu là par certains lecteurs, dont pdf.js)
        d.set(PDFName.of('TU'), PDFHexString.fromText(clean(tip)));
        for (const w of field.acroField.getWidgets()) w.dict.set(PDFName.of('TU'), PDFHexString.fromText(clean(tip)));
      }
      if (f.required) field.enableRequired();
      if (f.readOnly) field.enableReadOnly();
      try {
        if (kind === 'check' || kind === 'radio') field.updateAppearances(); else field.updateAppearances(font);
      } catch (e) { need = true; say(`Champ « ${f.name} » : apparence non générée, le lecteur la recalculera (${e && e.message ? e.message : e}).`); }
      void PDFRadioGroup;
    }
    const af = doc.catalog.lookup(PDFName.of('AcroForm'));
    if (af) af.set(PDFName.of('NeedAppearances'), need ? PDFBool.True : PDFBool.False);
    return { written, renamed, needAppearances: need };
  }

  // Document reconstruit (opération de pages) : les widgets d'origine recopiés avec leurs pages n'appartiennent plus à aucun formulaire
  // (limite connue : champs d'origine non conservés). Avant d'ajouter les champs créés (et donc un /AcroForm), ils sont figés : apparence
  // conservée, clés de champ retirées, pour qu'aucun lecteur ne les prenne pour des champs du nouveau formulaire. Renvoie le nombre de widgets figés.
  const FIELD_KEYS = ['Parent', 'T', 'TU', 'TM', 'V', 'DV', 'Kids', 'FT', 'Ff', 'Opt', 'TI', 'I', 'MaxLen', 'AA', 'A', 'RV', 'DS'];
  function freezeOrphans(PDFLib, doc) {
    const { PDFName, PDFArray, PDFDict } = PDFLib;
    let n = 0;
    for (const page of doc.getPages()) {
      const annots = page.node.lookup(PDFName.of('Annots'));
      if (!(annots instanceof PDFArray)) continue;
      for (let i = 0; i < annots.size(); i++) {
        const a = annots.lookup(i);
        if (!(a instanceof PDFDict) || a.get(PDFName.of('Subtype')) !== PDFName.of('Widget')) continue;
        if (!FIELD_KEYS.some((k) => a.has(PDFName.of(k)))) continue;
        for (const k of FIELD_KEYS) a.delete(PDFName.of(k));
        n++;
      }
    }
    return n;
  }

  return { write, freezeOrphans };
});
