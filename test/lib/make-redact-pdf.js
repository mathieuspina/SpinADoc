// PDF « piège » pour le caviardage : un secret connu (SECRET) présent de toutes les manières possibles sur la page 1, et une page 2 publique
// qui partage le dictionnaire de ressources de la page 1 (le formulaire et l'image secrets y sont référencés sans être dessinés).
//  - texte vectoriel en Helvetica, Times-Roman et Courier (3 lignes) ;
//  - XObject de formulaire contenant le secret (texte), dessiné sur la page 1 ;
//  - image (PNG) où le secret est écrit en pixels (largeur distinctive IMG_W) ;
//  - annotation « note » (/Contents = secret, chaîne UTF-16) ;
//  - champ de formulaire texte (valeur = secret, apparence générée) ;
//  - lien de la page 2 vers la page 1 ;
//  - métadonnées (titre, auteur, sujet, mots-clés, créateur, producteur) et XMP contenant le secret.
// Toutes les positions secrètes sont dans ZONE (page 1) ; PUBLIC1 (page 1, hors zone) et PUBLIC2 (page 2) doivent rester.
const PDFLib = require('@cantoo/pdf-lib');
const { createCanvas } = require('@napi-rs/canvas');

const SECRET = 'ZQXSECRET42';
const PUBLIC1 = 'Mention publique page un';
const PUBLIC2 = 'Texte public conserve page deux';
const ZONE = [60, 440, 430, 800];
const IMG_W = 301;

async function makeRedactPdf() {
  const { PDFDocument, StandardFonts, PDFName, PDFString, PDFHexString, rgb } = PDFLib;
  const d = await PDFDocument.create();
  const helv = await d.embedFont(StandardFonts.Helvetica);
  const times = await d.embedFont(StandardFonts.TimesRoman);
  const cour = await d.embedFont(StandardFonts.Courier);
  const p1 = d.addPage([595, 842]);
  const p2 = d.addPage([595, 842]);
  p1.drawText('Nom : ' + SECRET, { x: 72, y: 760, size: 16, font: helv });
  p1.drawText('Contrat ' + SECRET + ' (Times)', { x: 72, y: 725, size: 16, font: times });
  p1.drawText('Ref ' + SECRET, { x: 72, y: 690, size: 14, font: cour });
  p1.drawText(PUBLIC1, { x: 72, y: 200, size: 14, font: helv });
  // XObject de formulaire (une page embarquée) contenant le secret
  const src = await PDFDocument.create();
  const sf = await src.embedFont(StandardFonts.Helvetica);
  const sp = src.addPage([300, 40]);
  sp.drawText('Formulaire ' + SECRET, { x: 5, y: 12, size: 14, font: sf });
  const [emb] = await d.embedPdf(src, [0]);
  p1.drawPage(emb, { x: 72, y: 620 });
  // image : le secret écrit en pixels
  const cv = createCanvas(IMG_W, 50);
  const cx = cv.getContext('2d');
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, IMG_W, 50);
  cx.fillStyle = '#000'; cx.font = 'bold 28px sans-serif'; cx.fillText(SECRET, 8, 36);
  const png = await d.embedPng(cv.toBuffer('image/png'));
  p1.drawImage(png, { x: 72, y: 555, width: IMG_W * 0.9, height: 45 });
  // champ de formulaire
  const form = d.getForm();
  const tf = form.createTextField('nom.secret');
  tf.setText(SECRET);
  tf.addToPage(p1, { x: 72, y: 455, width: 250, height: 24, font: helv });
  // p2 : texte public
  p2.drawText(PUBLIC2, { x: 72, y: 760, size: 16, font: helv });
  // annotation « note » sur p1 (dans la zone) ; lien de p2 vers p1
  const ctx = d.context;
  const note = ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [380, 500, 400, 520], Contents: PDFHexString.fromText('Note : ' + SECRET), T: PDFString.of('Auteur ' + SECRET), Open: false });
  const noteRef = ctx.register(note);
  const ann1 = p1.node.lookup(PDFName.of('Annots'));
  if (ann1) ann1.push(noteRef); else p1.node.set(PDFName.of('Annots'), ctx.obj([noteRef]));
  const link = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [72, 700, 300, 720], Border: [0, 0, 0], Dest: [p1.ref, 'XYZ', 0, 842, 0] }));
  p2.node.set(PDFName.of('Annots'), ctx.obj([link]));
  // ressources partagées : la page 2 reçoit le dictionnaire de ressources de la page 1 (qui contient le formulaire et l'image secrets)
  const r1 = p1.node.lookup(PDFName.of('Resources'));
  const r2 = p2.node.lookup(PDFName.of('Resources'));
  for (const cat of ['Font', 'XObject']) {
    const a = r1.lookup(PDFName.of(cat)), b = r2.lookup(PDFName.of(cat));
    if (a && b) for (const k of b.keys()) a.set(k, b.get(k));
  }
  const shared = ctx.register(r1);
  p1.node.set(PDFName.of('Resources'), shared);
  p2.node.set(PDFName.of('Resources'), shared);
  // métadonnées
  d.setTitle('Rapport ' + SECRET); d.setAuthor('Auteur ' + SECRET); d.setSubject('Sujet ' + SECRET); d.setKeywords([SECRET, 'mot']);
  d.setCreator('Traitement de texte - ' + SECRET + '.docx'); d.setProducer('Producteur ' + SECRET);
  const xmp = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${SECRET}</dc:title></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
  const meta = ctx.stream(xmp, { Type: 'Metadata', Subtype: 'XML' });
  d.catalog.set(PDFName.of('Metadata'), ctx.register(meta));
  void rgb;
  return d.save({ useObjectStreams: true });
}

module.exports = { makeRedactPdf, SECRET, PUBLIC1, PUBLIC2, ZONE, IMG_W };
