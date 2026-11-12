// PDF de formulaire de test : un champ de chaque type (texte, texte multiligne, case à cocher, boutons radio, liste déroulante, liste à choix multiple),
// un champ en lecture seule, un champ obligatoire, des champs « date » et « nombre » (texte simple), sur 2 pages.
const fs = require('fs');
const PDFLib = require('@cantoo/pdf-lib');

async function makeForm(file) {
  const d = await PDFLib.PDFDocument.create();
  const font = await d.embedFont(PDFLib.StandardFonts.Helvetica);
  const p1 = d.addPage([595, 842]);
  const p2 = d.addPage([595, 842]);
  const form = d.getForm();
  p1.drawText('Formulaire de test', { x: 50, y: 790, size: 18, font });
  const lab = (p, t, y) => p.drawText(t, { x: 50, y: y + 5, size: 10, font });
  let y = 740;
  const row = (p, label, make) => { lab(p, label, y); make(y); y -= 40; };
  row(p1, 'Nom', (yy) => { const f = form.createTextField('nom'); f.addToPage(p1, { x: 200, y: yy, width: 250, height: 22 }); });
  row(p1, 'Commentaire', (yy) => { const f = form.createTextField('commentaire'); f.enableMultiline(); f.addToPage(p1, { x: 200, y: yy - 30, width: 250, height: 50 }); y -= 30; });
  row(p1, 'Accepte', (yy) => { const f = form.createCheckBox('accepte'); f.addToPage(p1, { x: 200, y: yy, width: 18, height: 18 }); });
  row(p1, 'Civilité', (yy) => { const r = form.createRadioGroup('civilite'); r.addOptionToPage('Mme', p1, { x: 200, y: yy, width: 16, height: 16 }); r.addOptionToPage('M', p1, { x: 260, y: yy, width: 16, height: 16 }); });
  row(p1, 'Pays', (yy) => { const f = form.createDropdown('pays'); f.addOptions(['France', 'Belgique', 'Suisse']); f.addToPage(p1, { x: 200, y: yy, width: 150, height: 22 }); });
  row(p1, 'Matériaux', (yy) => { const f = form.createOptionList('materiaux'); f.addOptions(['Béton', 'Acier', 'Bois', 'Verre']); f.enableMultiselect(); f.addToPage(p1, { x: 200, y: yy - 40, width: 150, height: 60 }); y -= 40; });
  row(p1, 'Référence (lecture seule)', (yy) => { const f = form.createTextField('reference'); f.setText('REF-001'); f.enableReadOnly(); f.addToPage(p1, { x: 200, y: yy, width: 150, height: 22 }); });
  row(p1, 'Obligatoire', (yy) => { const f = form.createTextField('obligatoire'); f.enableRequired(); f.addToPage(p1, { x: 200, y: yy, width: 150, height: 22 }); });
  p2.drawText('Page 2', { x: 50, y: 790, size: 18, font });
  let y2 = 740;
  for (const [n, l] of [['date', 'Date (jj/mm/aaaa)'], ['montant', 'Montant']]) {
    p2.drawText(l, { x: 50, y: y2 + 5, size: 10, font });
    const f = form.createTextField(n); f.addToPage(p2, { x: 200, y: y2, width: 150, height: 22 }); y2 -= 40;
  }
  form.getTextField('date').setText('01/02/2026');
  fs.writeFileSync(file, await d.save());
  return file;
}
module.exports = { makeForm };
