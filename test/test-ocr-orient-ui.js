// OCR, détection d'orientation (interface, hors écran, tesseract.js réel, mode texte) sur des scans DÉTERMINISTES (graine fixe) :
// texte droit / 90° / 180° / 270°, scans médiocres (flou, faible contraste, JPEG dégradé) droit / 90° / 180°, fond gris très bruité
// (illisible : aucune rotation), texte clairsemé droit et couché, manuscrit simulé, et la page fautive de 0.12.3 (fixture JPEG : confiance
// 60 % pile à 0°, qui n'était pas redressée). Vérifie : mots justes, orientation essayée seulement si la lecture à 0° est douteuse (aucune
// passe en plus sur une page droite), essais sur un échantillon puis UNE relecture de la page entière, scans identiques à graine égale.
// Usage : node test/test-ocr-orient-ui.js   (SPINADOC_EXE pour tester l'application empaquetée)
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp, sleep } = require('./lib/app.js');
const { makeAll } = require('./lib/make-pdfs.js');
const { GEN } = require('./lib/ocr-scans.js');

const failures = [];
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   ', name); }
  else { failures.push(name); console.log('  ECHEC', name, detail !== undefined ? '→ ' + JSON.stringify(detail).slice(0, 400) : ''); }
}
const norm = (s) => s.toLowerCase().split('').filter((ch) => /[a-z0-9àâçéèêëîïôûùüÿœ]/.test(ch)).join('');
const recall = (truth, text) => { const got = new Map(); for (const t of text.split(' ').map(norm)) got.set(t, (got.get(t) || 0) + 1); let ok = 0; for (const t of truth.map(norm)) { if ((got.get(t) || 0) > 0) { ok++; got.set(t, got.get(t) - 1); } } return Math.round(100 * ok / truth.length); };
const LINES = ['La poutre principale repose sur deux poteaux en béton armé.', 'Les charges permanentes sont cumulées avec les charges variables.', 'Vérifier la flèche maximale admissible avant la livraison.', 'The secondary beams are connected by bolted steel plates.', 'Contact : bureau d études structure, indice B du chantier.'];
const JPG_PDF = (b64) => `(async () => {
  const { PDFDocument } = window.PDFLib; const bin = atob(${JSON.stringify(b64)}); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const d = await PDFDocument.create(); const p = d.addPage([595, 842]); p.drawImage(await d.embedJpg(u), { x: 0, y: 0, width: 595, height: 842 });
  const bytes = await d.save(); let s = ''; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768)); return btoa(s);
})()`;
const RUN = (pages) => `(async () => {
  const E = await import('./js/ocr-engine.js'); const V = await import('./js/viewer.js'); const U = await import('./js/ui.js');
  const recs = V.getPages(U.store.active);
  const pool = await E.createPool({ lang: 'fra+eng', psm: 3, size: E.poolSize(), dpi: 300 });
  const out = [];
  try {
    for (const i of ${JSON.stringify(pages)}) {
      const t0 = performance.now();
      const r = await E.recognizePage(pool, recs[i].page, { quality: 'standard', mode: 'text', orientation: true });
      out.push({ i, ms: Math.round(performance.now() - t0), theta: r.theta, trace: r.trace, text: r.words.map((w) => w.t).join(' ') });
    }
  } finally { pool.kill(); }
  return JSON.stringify(out);
})()`;
// Attendus : droit = aucune passe en plus ; couché = essais sur échantillon (4) + 1 relecture, rotation appliquée ; illisible = essais, aucune rotation.
const EXPECT = {
  'droit': 'droit', '90': 'tourne', '180': 'tourne', '270': 'droit', 'médiocre droit': 'droit', 'médiocre 90': 'tourne', 'médiocre 180': 'tourne',
  'fond gris bruité 90': 'illisible', 'clairsemé droit': 'droit', 'clairsemé 90': 'tourne', 'manuscrit simulé droit': 'droit',
};

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spinadoc-orient-'));
  const f = await makeAll(path.join(os.tmpdir(), 'spinadoc-ocr-pdfs'));
  const c = await launchApp({ files: [f.d] });
  const open = async (file, n) => { await c.openMore(file); await c.waitFor(`document.querySelectorAll('.doctab').length===${n}`, 20000); await c.waitFor(`document.querySelectorAll('.docview.active canvas').length>0`, 20000); await sleep(600); };
  const verify = (label, r, truth, kind) => {
    const rc = recall(truth, r.text);
    const samples = r.trace.filter((q) => q.sample).length, full = r.trace.filter((q) => !q.sample).length;
    const info = { θ: r.theta, justes: rc, ms: r.ms, passes: r.trace.map((q) => `${q.theta}${q.sample ? 'e' : ''}:${q.n}/${q.avg}`).join(' ') };
    console.log(`     ${label} : θ=${r.theta}, ${rc} % de mots justes, ${r.ms} ms, passes ${info.passes}`);
    if (kind === 'droit') check(`${label} : lue à 0° sans aucune passe en plus`, r.theta === 0 && r.trace.length === 1, info);
    if (kind === 'tourne') check(`${label} : rotation appliquée après 4 essais sur échantillon + 1 relecture`, r.theta !== 0 && samples === 4 && full === 2, info);
    if (kind === 'illisible') check(`${label} : essais faits, aucune rotation, pas de relecture`, r.theta === 0 && samples === 4 && full === 1, info);
    if (kind !== 'illisible') check(`${label} : au moins ${kind === 'manuscrit' ? 70 : 90} % de mots justes`, rc >= (label.startsWith('manuscrit') ? 70 : 90), info);
  };
  try {
    await c.waitFor(`document.querySelectorAll('.docview canvas').length>0`, 20000);
    console.log('1. Scans déterministes');
    const g = JSON.parse(await c.ev(GEN('orient', 1)));
    const g2 = JSON.parse(await c.ev(GEN('orient', 1)));
    const h = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
    check('même graine → PDF identique à l\'octet près', h(g.b64) === h(g2.b64), [h(g.b64), h(g2.b64)]);
    check(`${g.labels.length} pages : ${g.labels.join(', ')}`, g.labels.length === Object.keys(EXPECT).length && g.labels.every((l) => EXPECT[l]), g.labels);
    const fo = path.join(dir, 'orient.pdf'); fs.writeFileSync(fo, Buffer.from(g.b64, 'base64'));
    await open(fo, 2);
    console.log('2. Orientation page par page');
    const res = JSON.parse(await c.ev(RUN(g.labels.map((_, i) => i))));
    for (const r of res) verify(g.labels[r.i], r, g.truth[r.i], EXPECT[g.labels[r.i]]);
    console.log('3. Page fautive de 0.12.3 (fixture : confiance 60 % pile à 0°)');
    const jb64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'ocr-page-couchee-seuil.jpg')).toString('base64');
    const ff = path.join(dir, 'fixture.pdf'); fs.writeFileSync(ff, Buffer.from(await c.ev(JPG_PDF(jb64)), 'base64'));
    await open(ff, 3);
    const [rf] = JSON.parse(await c.ev(RUN([0])));
    check('fixture : confiance à 0° entre 55 et 65 % (le cas limite est bien reproduit)', rf.trace[0].avg >= 55 && rf.trace[0].avg <= 65, rf.trace[0]);
    verify('page fautive', rf, LINES.join(' ').split(' '), 'tourne');
    check('aucune erreur JavaScript', c.logs.length === 0, c.logs);
  } catch (e) {
    check('exécution sans exception', false, String(e && e.stack || e));
  } finally {
    await c.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : orientation de l\'OCR.');
})();
