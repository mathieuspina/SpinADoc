// Légende : clic posé PENDANT l'analyse des tracés de la page (aimantation en tâche de fond). L'analyse est ralentie artificiellement
// (getOperatorList retardé) ; on vérifie l'indicateur « Analyse du plan en cours… », que l'interface reste réactive, que le premier clic
// patiente puis s'aimante, et qu'Échap abandonne proprement un clic en attente.
// Puis : largeur fixe + texte long (polices, tailles, mots longs) → mêmes coupures à l'écran (SVG) et dans le PDF enregistré relu par pdf.js.
// Usage : node test/test-callout-fix-ui.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp, sleep } = require('./lib/app.js');
const { makeAll } = require('./lib/make-pdfs.js');

const failures = [];
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   ', name); }
  else { failures.push(name); console.log('  ECHEC', name, detail !== undefined ? '→ ' + JSON.stringify(detail) : ''); }
}

(async () => {
  const f = await makeAll(path.join(os.tmpdir(), 'spinadoc-ui-pdfs'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spinadoc-callout-wait-'));
  const c = await launchApp({ files: [f.a], env: { SPINADOC_TEST_SAVE_DIR: out } });
  const doc = (expr) => c.ev(`import('./js/ui.js').then((m)=>{const d=m.store.active; return JSON.stringify(${expr})})`).then((x) => (x === undefined ? undefined : JSON.parse(x)));
  const SC = 4 / 3;
  const P = async (x, y) => { const [l, t] = await c.rect('.docview.active .page'); return [l + x * SC, t + y * SC]; };
  const mouse = (type, x, y) => c.mouse(type, x, y, {});
  const drag = async (x1, y1, x2, y2) => {
    await mouse('mouseMoved', x1, y1); await mouse('mousePressed', x1, y1);
    for (let i = 1; i <= 4; i++) { await mouse('mouseMoved', x1 + ((x2 - x1) * i) / 4, y1 + ((y2 - y1) * i) / 4); await sleep(10); }
    await mouse('mouseReleased', x2, y2);
  };
  const busy = () => c.ev(`!document.getElementById('snap-busy').hidden`);
  // Retarde l'analyse des tracés de la page affichée et vide le cache d'aimantation : l'outil devra la relancer.
  const slowDown = (ms) => c.ev(`Promise.all([import('./js/ui.js'), import('./js/viewer.js')]).then(([u, V]) => { const d = u.store.active; d.runtime.mxSnap = {};
    for (const rec of V.getPages(d)) { const p = rec.page; if (!p.__orig) p.__orig = p.getOperatorList.bind(p); p.getOperatorList = (...a) => new Promise((res) => setTimeout(res, ${ms})).then(() => p.__orig(...a)); } return true; })`);
  try {
    await c.waitFor(`document.querySelectorAll('.docview.active canvas').length>0`);
    await sleep(700);
    await c.click('#rtab-annotate'); await sleep(150);
    check('indicateur présent et masqué au repos', (await c.ev(`!!document.getElementById('snap-busy')`)) && !(await busy()));

    console.log('1. Clic-glisser posé avant la fin de l\'analyse : il patiente puis s\'aimante');
    await slowDown(1500);
    await c.click('#rpanel-annotate [data-cmd=tool-callout]');
    await sleep(100);
    check('« Analyse du plan en cours… » affiché dans la barre d\'état', (await busy()) && (await c.ev(`document.getElementById('snap-busy').textContent`)).includes('Analyse du plan'));
    const [tx, ty] = await P(43, 73), [bx, by] = await P(200, 40);
    const t0 = Date.now();
    await drag(tx, ty, bx, by);
    await sleep(100);
    check('interface réactive pendant l\'attente (évaluation immédiate, éditeur pas encore ouvert)', (await c.ev(`!document.querySelector('textarea.editor')`)) === true && Date.now() - t0 < 1400);
    await c.waitFor(`!!document.querySelector('textarea.editor')`, 5000);
    check('éditeur ouvert à la fin de l\'analyse', true);
    check('indicateur masqué une fois l\'analyse terminée', !(await busy()));
    await c.type('Attente'); await c.key('Enter', { code: 'Enter', windowsVirtualKeyCode: 13 }); await sleep(250);
    const e = await doc(`d.edits.filter((e)=>e.type==='callout')`);
    check('légende créée', e.length === 1 && e[0].text === 'Attente', e);
    check('pointe aimantée malgré le clic précoce : (40 ; 772) à 0,05 pt', e.length === 1 && Math.abs(e[0].tip[0] - 40) < 0.05 && Math.abs(e[0].tip[1] - 772) < 0.05, e[0] && e[0].tip);

    console.log('2. Échap pendant l\'attente : le clic est abandonné, rien n\'est créé');
    await slowDown(1200);
    await c.click('#rpanel-annotate [data-cmd=tool-select]').catch(() => {});
    await c.click('#rpanel-annotate [data-cmd=tool-callout]');
    await sleep(80);
    await drag(tx + 30, ty + 30, bx, by + 60);
    await sleep(80);
    await c.key('Escape', { code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(1800);
    check('aucun éditeur ouvert après Échap', (await c.ev(`!document.querySelector('textarea.editor')`)) === true);
    check('toujours une seule légende', (await doc(`d.edits.filter((e)=>e.type==='callout').length`)) === 1);

    console.log('3. Largeur fixe et texte long : mêmes coupures à l\'écran (SVG affiché) et dans le PDF enregistré relu par pdf.js');
    const T1 = 'Le poteau P12 en béton armé C30/37 doit être renforcé par un chemisage métallique avant la reprise des charges.';
    const T2 = 'Anticonstitutionnellement superlongmotsansaucunespacequidepasse, puis des mots courts à la suite.';
    const T3 = 'Ligne 1 courte\nParagraphe deux : élévation, façade nord-est, cote +12,45 NGF.\n\nAprès une ligne vide : fin.';
    const CFG = [
      { x: 40, y: 560, font: 'Helvetica', size: 10.5, width: 180, text: T1 },
      { x: 320, y: 560, font: 'Times', bold: true, italic: true, size: 9, width: 150, align: 'center', text: T2 },
      { x: 40, y: 330, font: 'Courier', size: 8, width: 200, text: T3 },
      { x: 320, y: 330, font: 'Helvetica', bold: true, size: 13, width: 95.5, text: T1 },
    ];
    const scr = JSON.parse(await c.ev(`Promise.all([import('./js/ui.js'), import('./js/annotate.js'), import('./js/viewer.js')]).then(([u, A, V]) => {
      const d = u.store.active, DM = window.DocModel, S = window.Shapes;
      const rec = V.getPages(d)[0];
      const base = d.edits.find((e) => e.type === 'callout');
      const res = [];
      for (const cf of ${JSON.stringify(CFG)}) {
        const o = Object.assign({}, base, { bold: false, italic: false, align: 'left', tip: [cf.x + 5, cf.y - 150] }, cf); delete o.id;
        const id = DM.addEdit(d, o);
        A.renderAll(d);
        const g = rec.div.querySelector('.objs g[data-id="' + id + '"]') || document.querySelector('.docview.active .objs g[data-id="' + id + '"]');
        const texts = [...g.querySelectorAll('text')];
        const L = S.layoutText(d.edits.find((e) => e.id === id), A.measure);
        // écart entre la largeur affichée (police CSS) et la largeur de la police écrite dans le PDF, en % de la largeur de la boîte
        const dev = Math.max(0, ...texts.map((t) => Math.abs(t.getComputedTextLength() - A.measure(L.fn, t.textContent, L.size) * rec.vp.scale) / (L.W * rec.vp.scale) * 100));
        res.push({ id, svg: texts.map((t) => t.textContent), want: L.lines.filter((l) => l.text).map((l) => ({ t: l.text, y: l.y })), box: L.box, dev });
      }
      return JSON.stringify(res);
    })`));
    check('écran : chaque ligne SVG affichée = ligne de la mise en page partagée (4 polices/styles, mots longs, paragraphes)', scr.every((r) => JSON.stringify(r.svg) === JSON.stringify(r.want.map((w) => w.t))), scr.map((r) => [r.svg.length, r.want.length]));
    check('le test couvre bien des légendes de plusieurs lignes (≥ 3 lignes chacune)', scr.every((r) => r.svg.length >= 3), scr.map((r) => r.svg.length));
    const maxDev = Math.max(...scr.map((r) => r.dev));
    console.log(`        (écart de largeur affichée / police PDF : ${maxDev.toFixed(2)} % de la largeur de la boîte au plus)`);
    check('largeur des lignes affichées ≈ largeur écrite (police d\'écran métriquement compatible, écart < 2 % de la boîte)', maxDev < 2, maxDev);
    await c.click('#rpanel-annotate [data-cmd=tool-select]').catch(() => {});
    await c.ev(`document.body.click()`); await c.key('s', { code: 'KeyS', windowsVirtualKeyCode: 83, modifiers: 2 }); await sleep(2500);
    const saved = path.join(out, 'a-huit-pages.pdf');
    check('fichier enregistré', fs.existsSync(saved));
    if (fs.existsSync(saved)) {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(saved)), verbosity: 0 }).promise;
      const items = (await (await pdf.getPage(1)).getTextContent()).items.filter((i) => i.str !== '');
      const okAll = scr.map((r) => {
        const its = items.filter((i) => i.transform[4] >= r.box.x0 - 1 && i.transform[4] <= r.box.x1 + 1 && i.transform[5] >= r.box.y0 - 1 && i.transform[5] <= r.box.y1 + 1);
        const rows = new Map();
        for (const i of its) { const k = Math.round(i.transform[5] * 100) / 100; if (!rows.has(k)) rows.set(k, []); rows.get(k).push(i); }
        const got = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([y, v]) => ({ y, t: v.sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str).join('') }));
        return got.length === r.want.length && r.want.every((w, k) => got[k].t.trimEnd() === w.t.trimEnd() && Math.abs(got[k].y - w.y) < 0.05) ? true : { want: r.want.map((w) => w.t), got: got.map((g) => g.t) };
      });
      check('PDF relu par pdf.js : mêmes lignes, même ordre, mêmes lignes de base que l\'écran', okAll.every((x) => x === true), okAll.filter((x) => x !== true).slice(0, 1));
    }
    check('aucune erreur JavaScript', c.logs.length === 0, c.logs.slice(0, 3));
  } catch (err) {
    failures.push('exception : ' + (err && err.stack || err));
    console.log('  ECHEC exception', err && err.stack || err);
  } finally {
    await c.close();
  }
  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('ÉCHECS :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : correctif légende (aimantation pendant l\'analyse, retour à la ligne).');
})();
