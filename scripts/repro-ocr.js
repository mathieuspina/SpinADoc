// Enquête : OCR de la page couchée (page 4 du scan « mixte » de test-ocr-ui) répétée N fois, chaque essai = un lancement À FROID de l'application
// (nouveau processus, nouveau profil), même parcours que test-ocr-ui (OCR de tout le document, mode texte, orientation, pages natives ignorées).
// Aucune relance : chaque essai est noté tel quel. Rapport : taux de mots justes, orientation retenue, passes (mots, confiance, score), nombre de
// workers, erreurs de console (chargement des données de langue…), durée. Les PDF des essais en échec sont gardés pour être rejoués.
// Usage : node scripts/repro-ocr.js [N=20] [--replay fichier.pdf]   (SPINADOC_EXE = application empaquetée à tester)
// Journal : test-logs/repro-ocr.log (une ligne JSON par essai) + résumé.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp, sleep } = require('../test/lib/app.js');
const { makeAll } = require('../test/lib/make-pdfs.js');
const { GEN } = require('../test/lib/ocr-scans.js');

const args = process.argv.slice(2);
const N = Number(args.find((a) => /^\d+$/.test(a)) || 20);
const replay = args.includes('--replay') ? path.resolve(args[args.indexOf('--replay') + 1]) : null;
const logDir = path.join(__dirname, '..', 'test-logs');
fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, 'repro-ocr.log');
const keepDir = path.join(logDir, 'repro-ocr-fails');
const norm = (s) => s.toLowerCase().split('').filter((ch) => /[a-z0-9àâçéèêëîïôûùüÿœ]/.test(ch)).join('');
// même mesure que test-ocr-ui : part des mots attendus retrouvés (avec multiplicité)
const recall = (truth, text) => { const got = new Map(); for (const t of text.split(' ').map(norm)) got.set(t, (got.get(t) || 0) + 1); let ok = 0; for (const t of truth.map(norm)) { if (got.get(t) > 0) { ok++; got.set(t, got.get(t) - 1); } } return Math.round(100 * ok / truth.length); };

async function trial(k, dir, f) {
  const t0 = Date.now();
  const c = await launchApp({ files: [f.d] });
  const doc = (expr) => c.ev(`import('./js/ui.js').then((m)=>{const d=m.store.active; return JSON.stringify(${expr})})`).then((x) => (x === undefined ? undefined : JSON.parse(x)));
  const setv = (id, v) => c.ev(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const radio = (id, v) => c.ev(`(()=>{const r=document.querySelector('input[name=pgf-${id}][value="${v}"]'); r.checked=true; r.dispatchEvent(new Event('input',{bubbles:true})); return 1})()`);
  const row = { k, cold: true };
  try {
    await c.waitFor(`document.querySelectorAll('.docview canvas').length>0`, 20000);
    let truth;
    const pdf = path.join(dir, `scan-mixte-${k}.pdf`);
    if (replay) { fs.copyFileSync(replay, pdf); truth = JSON.parse(fs.readFileSync(replay + '.truth.json', 'utf8')); }
    else { const gen = JSON.parse(await c.ev(GEN('mixte'))); fs.writeFileSync(pdf, Buffer.from(gen.b64, 'base64')); truth = gen.truth; fs.writeFileSync(pdf + '.truth.json', JSON.stringify(truth)); }
    await c.openMore(pdf);
    await c.waitFor(`document.querySelectorAll('.doctab').length===2`, 15000);
    await c.waitFor(`document.querySelectorAll('.docview.active canvas').length>0`, 15000); await sleep(800);
    row.launchMs = Date.now() - t0;
    await c.click('#rtab-document'); await sleep(200);
    await c.click('#rpanel-document [data-cmd=doc-ocr]');
    await c.waitFor(`!document.getElementById('pgdlg').hidden`, 5000);
    await radio('scope', 'all'); await setv('pgf-mode', 'text'); await setv('pgf-orientation', 'yes'); await setv('pgf-skip', 'yes');
    const t1 = Date.now();
    await c.click('#pgdlg-ok');
    await c.waitFor(`import('./js/ocr-ui.js').then((m)=>!!m.state.last && !m.state.running)`, 240000);
    row.ocrMs = Date.now() - t1;
    const last = JSON.parse(await c.ev(`import('./js/ocr-ui.js').then((m)=>JSON.stringify(m.state.last))`));
    const pageText = (i) => doc(`(()=>{ return (d.ocr[d.pages[${i}].u]||{words:[]}).words.map((w)=>w.t).join(' ') })()`);
    row.r4 = recall(truth[3], await pageText(3));
    row.r1 = recall(truth[0], await pageText(0));
    row.workers = last.workers; row.cores = await c.ev('navigator.hardwareConcurrency');
    row.done = last.done; row.failed = last.failed; row.error = last.error;
    row.p4 = last.trace && last.trace[3];
    row.logs = c.logs.slice(0, 5);
    if (row.r4 < 80 && !replay) { fs.mkdirSync(keepDir, { recursive: true }); fs.copyFileSync(pdf, path.join(keepDir, `essai-${k}.pdf`)); fs.copyFileSync(pdf + '.truth.json', path.join(keepDir, `essai-${k}.pdf.truth.json`)); }
  } catch (e) {
    row.exception = String(e && e.message || e);
  } finally {
    await c.close();
  }
  return row;
}

(async () => {
  const dir = path.join(os.tmpdir(), 'spinadoc-repro-ocr');
  fs.mkdirSync(dir, { recursive: true });
  const f = await makeAll(path.join(os.tmpdir(), 'spinadoc-ocr-pdfs'));
  const exe = process.env.SPINADOC_EXE || '(développement)';
  fs.appendFileSync(logFile, `\n# ${new Date().toISOString()} : ${N} essais, application ${exe}${replay ? ', REJEU de ' + path.basename(replay) : ''}\n`);
  const rows = [];
  for (let k = 1; k <= N; k++) {
    const r = await trial(k, dir, f);
    rows.push(r);
    fs.appendFileSync(logFile, JSON.stringify(r) + '\n');
    const p = r.p4 ? `θ=${r.p4.theta} passes=${r.p4.passes.map((q) => `${q.theta}°:${q.n}m/${q.avg}%/${q.score}${q.wrong ? '/mauvaise' : ''}`).join(' ')}` : '';
    console.log(`essai ${k}/${N} : page couchée ${r.r4} % ; page 1 ${r.r1} % ; workers ${r.workers}/${r.cores} cœurs ; ${p}${r.exception ? ' ; EXCEPTION ' + r.exception : ''}${r.logs && r.logs.length ? ' ; console : ' + r.logs.join(' | ') : ''}`);
  }
  const bad = rows.filter((r) => !(r.r4 >= 80));
  const summary = `RÉSUMÉ : page couchée < 80 % dans ${bad.length} / ${rows.length} essais` + (bad.length ? ` (essais ${bad.map((r) => r.k).join(', ')} ; premier essai à froid de la série : ${rows[0].r4} %)` : '');
  console.log(summary);
  fs.appendFileSync(logFile, summary + '\n');
})();
