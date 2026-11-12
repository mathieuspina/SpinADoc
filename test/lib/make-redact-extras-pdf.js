// PDF « piège » n° 2 pour le caviardage : un secret DIFFÉRENT dans chaque structure hors du contenu des pages, pour savoir précisément ce qui
// subsiste après application et enregistrement. Page 1 = page caviardée (la zone couvre toute la page), page 2 = page conservée, page 3 = publique.
//  - signets : un vers la page 1, un vers la page 2 (titres secrets) ;
//  - pièce jointe du document (EmbeddedFiles) ; JavaScript du document (arbre /Names /JavaScript) ; action à l'ouverture (OpenAction JavaScript) ;
//  - destination nommée (arbre /Names /Dests) au nom secret, utilisée par un lien de la page 2 ;
//  - formulaire : parent « client » avec « client.iban » (page 1, valeur secrète), « client.cache » (page 2, widget MASQUÉ, valeur secrète),
//    « client.nom » (page 2, visible, valeur publique) ;
//  - page 2 : action de page /AA (JavaScript), lien à action JavaScript, annotation pièce jointe (fichier secret), note (texte secret).
const PDFLib = require('@cantoo/pdf-lib');

const S = {
  outline1: 'QZSIGNETUN', outline2: 'QZSIGNETDEUX', embed: 'QZPIECEJOINTE', js: 'QZJAVASCRIPT', open: 'QZOUVERTURE', dest: 'QZDESTINATION',
  field: 'QZCHAMPIBAN', hidden: 'QZCHAMPCACHE', pageAA: 'QZACTIONPAGE', linkJS: 'QZLIENJS', annotFile: 'QZFICHIERANNOT', note: 'QZNOTEPAGEDEUX',
  text1: 'QZTEXTEPAGEUN',
};
const PUBLIC2 = 'Page deux conservee';

async function makeRedactExtrasPdf() {
  const { PDFDocument, PDFName, PDFString, PDFHexString, PDFArray, StandardFonts } = PDFLib;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const ctx = doc.context;
  const p1 = doc.addPage([595, 842]), p2 = doc.addPage([595, 842]), p3 = doc.addPage([595, 842]);
  p1.drawText('Page un ' + S.text1, { x: 72, y: 760, size: 14, font });
  p2.drawText(PUBLIC2, { x: 72, y: 760, size: 14, font });
  p3.drawText('Page trois publique', { x: 72, y: 760, size: 14, font });
  const js = (code) => ctx.obj({ Type: 'Action', S: 'JavaScript', JS: PDFString.of(code) });

  // Signets
  const outlines = ctx.nextRef(), o1 = ctx.nextRef(), o2 = ctx.nextRef();
  ctx.assign(o1, ctx.obj({ Title: PDFHexString.fromText('Signet ' + S.outline1), Parent: outlines, Next: o2, Dest: [p1.ref, 'Fit'] }));
  ctx.assign(o2, ctx.obj({ Title: PDFHexString.fromText('Signet ' + S.outline2), Parent: outlines, Prev: o1, Dest: [p2.ref, 'Fit'] }));
  ctx.assign(outlines, ctx.obj({ Type: 'Outlines', First: o1, Last: o2, Count: 2 }));
  doc.catalog.set(PDFName.of('Outlines'), outlines);

  // Pièce jointe du document, JavaScript, destination nommée
  await doc.attach(Buffer.from('Contenu ' + S.embed), 'annexe.txt', { mimeType: 'text/plain', description: 'Annexe' });
  await doc.flush();
  const names = doc.catalog.lookup(PDFName.of('Names'));
  names.set(PDFName.of('JavaScript'), ctx.obj({ Names: [PDFString.of('init'), ctx.register(js('var s = "' + S.js + '";'))] }));
  names.set(PDFName.of('Dests'), ctx.obj({ Names: [PDFString.of('dest-' + S.dest), ctx.obj([p2.ref, 'Fit'])] }));
  doc.catalog.set(PDFName.of('OpenAction'), ctx.register(js('app.alert("' + S.open + '");')));

  // Formulaire hiérarchique
  const form = doc.getForm();
  const iban = form.createTextField('client.iban'); iban.setText(S.field); iban.addToPage(p1, { x: 72, y: 600, width: 300, height: 24, font });
  const cache = form.createTextField('client.cache'); cache.setText(S.hidden); cache.addToPage(p2, { x: 72, y: 600, width: 300, height: 24, font });
  cache.acroField.getWidgets()[0].dict.set(PDFName.of('F'), ctx.obj(2)); // masqué
  const nom = form.createTextField('client.nom'); nom.setText('Dupont'); nom.addToPage(p2, { x: 72, y: 540, width: 300, height: 24, font });

  // Page 2 : action de page, lien JavaScript, lien vers la destination nommée, pièce jointe en annotation, note
  p2.node.set(PDFName.of('AA'), ctx.obj({ O: ctx.register(js('app.alert("' + S.pageAA + '");')) }));
  const ef = ctx.register(ctx.flateStream(Buffer.from('Fichier ' + S.annotFile), { Type: 'EmbeddedFile' }));
  const annots = [
    ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [72, 400, 250, 420], Border: [0, 0, 0], A: js('app.alert("' + S.linkJS + '");') }),
    ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [72, 370, 250, 390], Border: [0, 0, 0], Dest: PDFString.of('dest-' + S.dest) }),
    ctx.obj({ Type: 'Annot', Subtype: 'FileAttachment', Rect: [300, 400, 320, 420], Name: 'PushPin', Contents: PDFHexString.fromText('pièce jointe'), FS: ctx.obj({ Type: 'Filespec', F: PDFString.of('rapport.txt'), EF: ctx.obj({ F: ef }) }) }),
    ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [400, 400, 420, 420], Contents: PDFHexString.fromText('Note ' + S.note), Name: 'Comment' }),
  ].map((a) => ctx.register(a));
  let arr = p2.node.lookup(PDFName.of('Annots'));
  if (!(arr instanceof PDFArray)) { arr = ctx.obj([]); p2.node.set(PDFName.of('Annots'), arr); }
  for (const a of annots) arr.push(a);
  return doc.save({ useObjectStreams: false });
}

module.exports = { makeRedactExtrasPdf, S, PUBLIC2 };
