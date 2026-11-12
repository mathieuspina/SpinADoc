// Mesure de la détection d'orientation de l'OCR (mode texte) : pour chaque page de test, confiance moyenne à 0°, passes essayées,
// orientation retenue, taux de mots justes et DURÉE (pages reconnues une par une, moteur déjà chargé). Scans déterministes (graine fixe).
// Pages : jeu « orient » (droit, 90°, 180°, 270°, médiocres, clairsemés, manuscrit simulé), page fautive (fixture JPEG), plan A3 clairsemé
// et A0 en mode TEXTE. Usage : node scripts/bench-ocr-orient.js [--no-a0] [--seed N]   (SPINADOC_EXE = application empaquetée)
// Sortie : test-logs/bench-ocr-orient.json + tableau à l'écran.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp, sleep } = require('../test/lib/app.js');
const { makeAll } = require('../test/lib/make-pdfs.js');
const { GEN, GEN_A0 } = require('../test/lib/ocr-scans.js');

const args = process.argv.slice(2);
const seed = args.includes('--seed') ? Number(args[args.indexOf('--seed') + 1]) : 1;
const root = path.join(__dirname, '..');
const norm = (s) => s.toLowerCase().split('').filter((ch) => /[a-z0-9àâçéèêëîïôûùüÿœ]/.test(ch)).join('');
const recall = (truth, text) => { const got = new Map(); for (const t of text.split(' ').map(norm)) got.set(t, (got.get(t) || 0) + 1); let ok = 0; for (const t of truth.map(norm)) { if ((got.get(t) || 0) > 0) { ok++; got.set(t, got.get(t) - 1); } } return Math.round(100 * ok / truth.length); };
const LINES = ['La poutre principale repose sur deux poteaux en béton armé.', 'Les charges permanentes sont cumulées avec les charges variables.', 'Vérifier la flèche maximale admissible avant la livraison.', 'The secondary beams are connected by bolted steel plates.', 'Contact : bureau d études structure, indice B du chantier.'];

// PDF d'une page A4 à partir d'une image JPEG (octets inchangés), fabriqué dans l'application.
const JPG_PDF = (b64) => `(async () => {
  const { PDFDocument } = window.PDFLib; const bin = atob(${JSON.stringify(b64)}); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const d = await PDFDocument.create(); const p = d.addPage([595, 842]); p.drawImage(await d.embedJpg(u), { x: 0, y: 0, width: 595, height: 842 });
  const bytes = await d.save(); let s = ''; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768)); return btoa(s);
})()`;
// Reconnaissance page par page du document actif ; renvoie [{ i, ms, theta, trace, text }].
const RUN = (pages) => `(async () => {
  const E = await import('./js/ocr-engine.js'); const V = await import('./js/viewer.js'); const U = await import('./js/ui.js');
  const recs = V.getPages(U.store.active);
  const pool = await E.createPool({ lang: 'fra+eng', psm: 3, size: E.poolSize(), dpi: 300 });
  const out = [];
  try {
    for (const i of ${JSON.stringify(pages)}) {
      const t0 = performance.now();
      const r = await E.recognizePage(pool, recs[i].page, { quality: 'standard', mode: 'text', orientation: true });
      out.push({ i, ms: Math.round(performance.now() - t0), theta: r.theta, trace: r.trace, tiles: r.plan.tiles.length, text: r.words.map((w) => w.t).join(' ') });
    }
  } finally { pool.kill(); }
  return JSON.stringify(out);
})()`;

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spinadoc-bench-orient-'));
  const f = await makeAll(path.join(os.tmpdir(), 'spinadoc-ocr-pdfs'));
  const c = await launchApp({ files: [f.d] });
  const rows = [];
  const open = async (file, n) => { await c.openMore(file); await c.waitFor(`document.querySelectorAll('.doctab').length===${n}`, 20000); await c.waitFor(`document.querySelectorAll('.docview.active canvas').length>0`, 20000); await sleep(600); };
  const measure = async (label, truths, labels, pages) => {
    const res = JSON.parse(await c.ev(RUN(pages)));
    for (const r of res) {
      const p0 = r.trace[0] || {};
      const row = { doc: label, page: labels[r.i], avg0: p0.avg, n0: p0.n, passes: r.trace.map((q) => `${q.theta}${q.sample ? 'e' : ''}:${q.n}/${q.avg}`).join(' '), theta: r.theta, tiles: r.tiles, recall: truths ? recall(truths[r.i], r.text) : null, ms: r.ms };
      rows.push(row);
      console.log(`${label.padEnd(9)} ${String(labels[r.i]).padEnd(24)} 0°: ${String(p0.avg).padStart(3)} % (${String(p0.n).padStart(3)} mots)  θ=${String(r.theta).padStart(3)}  justes ${String(row.recall).padStart(3)} %  ${String(r.ms).padStart(6)} ms  passes ${row.passes}`);
    }
  };
  try {
    await c.waitFor(`document.querySelectorAll('.docview canvas').length>0`, 20000);
    let tabs = 1;
    // 1. jeu « orient »
    const g = JSON.parse(await c.ev(GEN('orient', seed)));
    const fo = path.join(dir, 'orient.pdf'); fs.writeFileSync(fo, Buffer.from(g.b64, 'base64'));
    await open(fo, ++tabs);
    await measure('orient', g.truth, g.labels, g.labels.map((_, i) => i));
    // 2. page fautive (fixture : confiance 60 % pile à 0°)
    const jb64 = fs.readFileSync(path.join(root, 'test', 'fixtures', 'ocr-page-couchee-seuil.jpg')).toString('base64');
    const ff = path.join(dir, 'fixture.pdf'); fs.writeFileSync(ff, Buffer.from(await c.ev(JPG_PDF(jb64)), 'base64'));
    await open(ff, ++tabs);
    await measure('fixture', [LINES.join(' ').split(' ')], ['couchée seuil 60'], [0]);
    // 3. plan A3 clairsemé (page 3 du jeu « mixte ») en mode texte
    const m = JSON.parse(await c.ev(GEN('mixte', seed)));
    const fm = path.join(dir, 'mixte.pdf'); fs.writeFileSync(fm, Buffer.from(m.b64, 'base64'));
    await open(fm, ++tabs);
    await measure('mixte', m.truth, m.labels, [0, 2]);
    // 4. A0 en mode texte
    if (!args.includes('--no-a0')) {
      const fa = path.join(dir, 'a0.pdf'); fs.writeFileSync(fa, Buffer.from(await c.ev(GEN_A0), 'base64'));
      await open(fa, ++tabs);
      await measure('A0', null, ['A0 plan (texte)'], [0]);
    }
    if (c.logs.length) console.log('console : ' + c.logs.slice(0, 5).join(' | '));
  } finally {
    await c.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(root, 'test-logs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'test-logs', 'bench-ocr-orient.json'), JSON.stringify({ date: new Date().toISOString(), seed, exe: process.env.SPINADOC_EXE || 'dev', rows }, null, 1));
  console.log('Écrit : test-logs/bench-ocr-orient.json');
})();
