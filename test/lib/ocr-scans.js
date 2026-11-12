// Scans fabriqués DANS l'application (canevas + pdf-lib) pour les tests OCR : partagé par test-ocr-ui.js, test-ocr-orient-ui.js,
// scripts/repro-ocr.js et scripts/bench-ocr-orient.js. Bruit DÉTERMINISTE : générateur pseudo-aléatoire à graine (mulberry32), même graine =
// mêmes pixels (même version de Chromium). Renvoie { b64, truth, labels } : PDF en base64, mots attendus et libellé de chaque page.
//   GEN('mixte', graine)  : scan de texte, page à texte natif, plan A3, page couchée (test-ocr-ui).
//   GEN('orient', graine) : orientation : texte droit / 90° / 180° / 270°, scans médiocres (flou, faible contraste, bruit fort, JPEG
//                           dégradé) droit, couché et à l'envers, fond gris très bruité (illisible), texte clairsemé droit et couché, petit texte manuscrit simulé (écriture inclinée).
const GEN = (kind, seed = 1) => `(async () => {
  const { PDFDocument, StandardFonts } = window.PDFLib;
  let sd = ${Number(seed) >>> 0};
  const rnd = () => { sd = (sd + 0x6D2B79F5) >>> 0; let t = sd; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const noisy = (cv, amt) => { const x = cv.getContext('2d'); const d = x.getImageData(0, 0, cv.width, cv.height); for (let i = 0; i < d.data.length; i += 4) { const n = (rnd() - 0.5) * amt; d.data[i] = d.data[i + 1] = d.data[i + 2] = Math.max(0, Math.min(255, d.data[i] + n)); } x.putImageData(d, 0, 0); };
  const jpg = async (cv, q = 0.85) => new Uint8Array(await (await new Promise((r) => cv.toBlob(r, 'image/jpeg', q))).arrayBuffer());
  const blank = (w, h, bg = '#fff', ink = '#111') => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = bg; x.fillRect(0, 0, w, h); x.fillStyle = ink; return [c, x]; };
  const LINES = ['La poutre principale repose sur deux poteaux en béton armé.', 'Les charges permanentes sont cumulées avec les charges variables.', 'Vérifier la flèche maximale admissible avant la livraison.', 'The secondary beams are connected by bolted steel plates.', 'Contact : bureau d études structure, indice B du chantier.'];
  const doc = await PDFDocument.create({ updateMetadata: false }); // sans date : même graine = mêmes octets
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const truth = [], labels = [];
  const addScan = async (cv, w, h, q) => { const p = doc.addPage([w, h]); p.drawImage(await doc.embedJpg(await jpg(cv, q)), { x: 0, y: 0, width: w, height: h }); return p; };
  // Page A4 300 dpi dont le texte est tourné de « rot » (radians) dans l'image ; draw(x, words) dessine dans le repère du texte (fw × fh).
  const turnedPage = (rot, draw, o = {}) => {
    const [c, x] = blank(2480, 3508, o.bg, o.ink);
    const side = Math.abs(Math.sin(rot)) > 0.5;
    const fw = side ? 3508 : 2480, fh = side ? 2480 : 3508;
    if (o.blur) x.filter = 'blur(' + o.blur + 'px)';
    x.save(); x.translate(1240, 1754); x.rotate(rot); x.translate(-fw / 2, -fh / 2);
    const words = []; draw(x, words, fw, fh); x.restore(); x.filter = 'none';
    noisy(c, o.noise == null ? 40 : o.noise);
    return [c, words];
  };
  const paragraph = (x, words) => { for (let b = 0; b < 2; b++) LINES.forEach((l, i) => { x.font = (i % 2 ? '44px Times New Roman' : '46px Arial'); x.fillText(l, 200, 300 + (b * 5 + i) * 95); words.push(...l.split(' ')); }); };
  const SPARSE = ['Repère A3', 'Niveau 2', 'Coupe B', 'Échelle 1/50', 'Indice C', 'Ferme F4', 'Pente 35°', 'Lot charpente', 'Vu le', 'Visa BE'];
  const sparse = (x, words, fw, fh) => { SPARSE.forEach((s, i) => { x.font = '48px Arial'; x.fillText(s, 180 + (i % 3) * (fw - 400) / 3, 260 + Math.floor(i / 3) * (fh - 500) / 3); words.push(...s.split(' ')); }); };
  const hand = (x, words) => { ['Reprendre la cote', 'voir avec le bureau', 'avant lundi'].forEach((s, i) => { x.save(); x.translate(260, 400 + i * 120); x.rotate(-0.04); x.font = 'italic 52px Comic Sans MS'; x.fillText(s, 0, 0); x.restore(); words.push(...s.split(' ')); }); };
  const add = async (label, rot, draw, o = {}) => { const [c, w] = turnedPage(rot, draw, o); await addScan(c, 595, 842, o.q); truth.push(w); labels.push(label); };
  if (${JSON.stringify(kind)} === 'mixte') {
    // 1. scan de texte A4 300 dpi, légèrement incliné
    let [c, x] = blank(2480, 3508); x.save(); x.translate(1240, 1754); x.rotate(0.005); x.translate(-1240, -1754);
    const t1 = []; for (let b = 0; b < 4; b++) LINES.forEach((l, i) => { x.font = (i % 2 ? '44px Times New Roman' : '46px Arial'); x.fillText(l, 200, 300 + (b * 5 + i) * 95); t1.push(...l.split(' ')); });
    x.restore(); noisy(c, 40); await addScan(c, 595, 842); truth.push(t1); labels.push('texte');
    // 2. page à texte natif
    const p2 = doc.addPage([595, 842]); p2.drawText('Page avec du texte natif : rapport de visite numero 42 du chantier.', { x: 40, y: 780, size: 12, font }); truth.push(['natif']); labels.push('natif');
    // 3. plan A3 paysage : cotes, petits textes, texte pivoté, titre
    [c, x] = blank(4000, 2830); x.strokeStyle = '#000'; x.lineWidth = 3;
    const t3 = []; const put = (s, px, py, rot, size) => { x.save(); x.translate(px, py); x.rotate(rot); x.font = size + 'px Arial'; x.fillText(s, 0, 0); x.restore(); t3.push(...s.split(' ')); };
    for (let i = 0; i < 30; i++) { x.beginPath(); x.moveTo(200 + i * 100, 1800); x.lineTo(240 + i * 100, 2100); x.stroke(); }
    ['2450', 'IPE 200', 'P12 300x500', 'Ech 1/50', 'Poutre B7', 'HEA 240'].forEach((s, i) => put(s, 300 + (i % 3) * 1200, 400 + Math.floor(i / 3) * 700, 0, 40));
    ['3600', 'Axe C'].forEach((s, i) => put(s, 500 + i * 1400, 1700, -Math.PI / 2, 38));
    put('Indice B - Plan de charpente niveau 2', 1200, 2600, 0, 70);
    noisy(c, 30); await addScan(c, 1191, 842); truth.push(t3); labels.push('plan');
    // 4. page A4 scannée couchée (texte tourné de 90° dans l'image)
    [c, x] = blank(2480, 3508); x.save(); x.translate(1240, 1754); x.rotate(-Math.PI / 2); x.translate(-1754, -1240);
    const t4 = []; LINES.forEach((l, i) => { x.font = '46px Arial'; x.fillText(l, 200, 300 + i * 95); t4.push(...l.split(' ')); });
    x.restore(); noisy(c, 40); await addScan(c, 595, 842); truth.push(t4); labels.push('couchée 90');
  }
  if (${JSON.stringify(kind)} === 'orient') {
    const P = Math.PI;
    await add('droit', 0, paragraph);
    await add('90', -P / 2, paragraph);
    await add('180', P, paragraph);
    await add('270', P / 2, paragraph);
    const bad = { bg: '#e2e2e2', ink: '#555555', blur: 1.0, noise: 30, q: 0.5 };
    await add('médiocre droit', 0, paragraph, bad);
    await add('médiocre 90', -P / 2, paragraph, bad);
    await add('médiocre 180', P, paragraph, bad);
    // fond gris très bruité : illisible pour tesseract (le bruit est pris pour de l'encre) : aucune rotation ne doit être appliquée
    await add('fond gris bruité 90', -P / 2, paragraph, { bg: '#e2e2e2', ink: '#555555', blur: 0.9, noise: 70, q: 0.5 });
    await add('clairsemé droit', 0, sparse, { noise: 30 });
    await add('clairsemé 90', -P / 2, sparse, { noise: 30 });
    await add('manuscrit simulé droit', 0, hand, { noise: 30 });
  }
  const bytes = await doc.save();
  let s = ''; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
  return JSON.stringify({ b64: btoa(s), truth, labels });
})()`;

// Scan A0 (mémoire) : image 7000 × 4950 px sur une page 3370 × 2384 pt, texte proportionnellement grand.
const GEN_A0 = `(async () => {
  const { PDFDocument } = window.PDFLib;
  const c = document.createElement('canvas'); c.width = 7000; c.height = 4950; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 7000, 4950); x.fillStyle = '#000';
  const words = ['IPE 200', '2450', 'Poutre B7', 'HEA 240', 'Axe C', 'Niveau 3.20', 'P12 300x500', 'Ech 1/50'];
  for (let i = 0; i < 90; i++) { x.font = '56px Arial'; x.fillText(words[i % words.length], 300 + (i % 9) * 700, 400 + Math.floor(i / 9) * 420); }
  x.font = '110px Arial'; x.fillText('Indice B - Plan de fondations', 2200, 4700);
  for (let i = 0; i < 200; i++) { x.fillRect(300 + (i * 31) % 6000, 4300 + (i * 17) % 120, 2, 80); }
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
  const doc = await PDFDocument.create(); const p = doc.addPage([3370, 2384]); p.drawImage(await doc.embedJpg(new Uint8Array(await blob.arrayBuffer())), { x: 0, y: 0, width: 3370, height: 2384 });
  const bytes = await doc.save(); let s = ''; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
  return btoa(s);
})()`;

module.exports = { GEN, GEN_A0 };
