// Impression non bloquante : pendant l'impression d'un A1 dense en noir et blanc 600 dpi (composition + rasterisation + envoi, dans la fenêtre
// de travail cachée), l'interface reste réactive (retard de la boucle d'événements < 100 ms), on peut ouvrir un document, ajouter une annotation et
// défiler. File d'impression, progression, annulation. Aucune impression réelle (SPINADOC_TEST_PRINT_DIR). Usage : node test/test-print-async-ui.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const PDFLib = require('@cantoo/pdf-lib');
const { launchApp, sleep } = require('./lib/app.js');
const { makeAll } = require('./lib/make-pdfs.js');

const failures = [];
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   ', name); }
  else { failures.push(name); console.log('  ECHEC', name, detail !== undefined ? '→ ' + JSON.stringify(detail) : ''); }
}
const MM = 72 / 25.4;

(async () => {
  const dir = path.join(os.tmpdir(), 'spinadoc-ui-pdfs');
  const f = await makeAll(dir);
  // A1 dense : 6 000 traits fins + du texte (un plan)
  const a1 = path.join(dir, 'plan-A1-dense.pdf');
  {
    const d = await PDFLib.PDFDocument.create();
    const font = await d.embedFont(PDFLib.StandardFonts.Helvetica);
    const p = d.addPage([594 * MM, 841 * MM]);
    for (let i = 0; i < 6000; i++) p.drawLine({ start: { x: (i * 37) % 1650, y: (i * 53) % 2350 }, end: { x: (i * 91 + 300) % 1650, y: (i * 17 + 200) % 2350 }, thickness: 0.4 });
    for (let i = 0; i < 80; i++) p.drawText('COTE ' + i, { x: 100 + (i % 8) * 190, y: 200 + Math.floor(i / 8) * 200, size: 18, font });
    fs.writeFileSync(a1, await d.save());
  }
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spinadoc-print-async-'));
  const c = await launchApp({ files: [a1], env: { SPINADOC_TEST_PRINT_DIR: out, SPINADOC_TEST_OPEN: JSON.stringify([f.b]) } });
  const key = (k, code, vk, mods = 0) => c.key(k, { code, windowsVirtualKeyCode: vk, modifiers: mods });
  const setv = (id, v) => c.ev(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const txt = (id) => c.ev(`document.getElementById(${JSON.stringify(id)}).textContent`);
  const q = () => c.ev(`JSON.stringify([...document.querySelectorAll('#printq .pq-item')].map(e=>({id:e.dataset.id,state:e.dataset.state,name:e.querySelector('.pq-name').textContent,status:e.querySelector('.pq-status').textContent})))`).then(JSON.parse);
  try {
    await c.waitFor(`document.querySelectorAll('.docview.active canvas').length>0`, 20000);
    await sleep(1500);

    console.log('1. Envoi : la boîte se ferme aussitôt');
    await c.ev(`document.body.click()`);
    await key('p', 'KeyP', 80, 2); await sleep(2500);
    await setv('pr-paper', '594x841'); await setv('pr-color', 'bw'); await setv('pr-dpi', '600'); await setv('pr-margin', '0');
    await sleep(2500);
    check('A1, noir et blanc, 600 dpi : mention de rasterisation', /600 dpi/.test(await txt('pr-rnote')), await txt('pr-rnote'));
    // moniteur de retard de la boucle d'événements de l'interface
    await c.ev(`(()=>{window.__lag={max:0,n:0,last:performance.now()}; window.__lagT=setInterval(()=>{const t=performance.now(); const d=t-window.__lag.last-20; if(d>window.__lag.max) window.__lag.max=d; window.__lag.n++; window.__lag.last=t;},20); return 1})()`);
    const t0 = Date.now();
    await c.click('#pr-ok');
    await sleep(400);
    check('la boîte d\'impression est fermée', (await c.ev(`document.getElementById('printdlg').hidden`)) === true);
    let items = await q();
    check('notification non bloquante : « Impression en cours »', items.length === 1 && /Impression : plan-A1-dense\.pdf/.test(items[0].name), items);

    console.log('2. Pendant l\'impression : l\'interface reste utilisable');
    await sleep(1500);
    items = await q();
    check('progression affichée (page x / y)', items.length === 1 && /page \d+ \/ \d+/.test(items[0].status) && items[0].state === 'running', items);
    // ouvrir un document
    await c.click('[data-cmd=open]'); await sleep(1500);
    check('un autre document s\'ouvre pendant l\'impression', (await c.ev(`document.querySelectorAll('.doctab').length`)) === 2);
    // ajouter une annotation et défiler
    await c.ev(`import('./js/ui.js').then(async (m)=>{const A=await import('./js/annotate.js'); const d=m.store.active; window.DocModel.addEdit(d,Object.assign(window.Shapes.defaultsFor('add'),{type:'add',page:0,x:80,y:500,text:'PENDANT-IMPRESSION',font:'Helvetica',size:20,rot:0})); A.changed(d); return 1})`);
    await sleep(300);
    check('annotation ajoutée pendant l\'impression', (await c.ev(`import('./js/ui.js').then(m=>m.store.active.edits.length)`)) === 1);
    for (let i = 0; i < 5; i++) { await c.ev(`(()=>{const v=document.querySelector('.docview.active .viewer'); v.scrollTop+=300; return v.scrollTop})()`); await sleep(120); }
    check('défilement traité', (await c.ev(`document.querySelector('.docview.active .viewer').scrollTop`)) > 0);
    await c.click('#rtab-annotate'); await c.click('#rpanel-annotate [data-cmd=tool-select]'); await sleep(200);
    check('clics du ruban traités', (await c.ev(`document.getElementById('rpanel-annotate').hidden`)) === false);

    console.log('3. Fin du travail');
    let done = false;
    for (let i = 0; i < 360 && !done; i++) { await sleep(500); done = fs.existsSync(path.join(out, 'jobs.json')) && (await q()).every((x) => x.state !== 'running') ; }
    const dt = (Date.now() - t0) / 1000;
    const lag = await c.ev(`JSON.stringify(window.__lag)`).then(JSON.parse);
    check(`PDF d'impression A1 produit (${dt.toFixed(0)} s au total)`, fs.existsSync(path.join(out, 'job-1.pdf')), fs.readdirSync(out));
    check(`retard maximal de la boucle d'événements pendant tout le travail : ${Math.round(lag.max)} ms (< 100 ms, ${lag.n} mesures)`, lag.max < 100 && lag.n > 100, lag);
    const jd = await PDFLib.PDFDocument.load(fs.readFileSync(path.join(out, 'job-1.pdf')));
    const sz = jd.getPage(0).getSize();
    check('le PDF est bien une feuille A1 rasterisée', Math.abs(sz.width / MM - 594) < 0.5 && Math.abs(sz.height / MM - 841) < 0.5 && jd.getTitle() === 'plan-A1-dense.pdf', { w: sz.width / MM, h: sz.height / MM, t: jd.getTitle() });
    await sleep(500);
    items = await q();
    check('notification terminée (puis retirée)', items.length === 0 || items[0].state === 'done', items);

    console.log('4. File d\'attente et annulation');
    fs.rmSync(path.join(out, 'jobs.json'), { force: true });
    await c.click('.doctab:first-child'); await sleep(800);
    await c.ev(`document.body.click()`);
    await key('p', 'KeyP', 80, 2); await sleep(2000);
    await setv('pr-paper', '594x841'); await setv('pr-color', 'bw'); await setv('pr-dpi', '600'); await setv('pr-margin', '0'); await sleep(2500);
    await c.click('#pr-ok'); await sleep(300);
    await key('p', 'KeyP', 80, 2); await sleep(2000);
    await c.click('#pr-ok'); await sleep(600);
    items = await q();
    check('deux impressions successives forment une file', items.length === 2 && items[0].state === 'running' && items[1].state === 'queued' && /En attente/.test(items[1].status), items);
    await c.ev(`document.querySelector('#printq .pq-item[data-state=queued] button').click()`); await sleep(500);
    items = await q();
    check('annuler une impression en attente : elle disparaît de la file', items.length === 1 || items.every((x) => x.state !== 'queued'), items);
    await c.ev(`document.querySelector('#printq .pq-item[data-state=running] button').click()`);
    let cancelled = false;
    for (let i = 0; i < 40 && !cancelled; i++) { await sleep(500); cancelled = (await q()).some((x) => x.state === 'cancelled') || (await q()).length === 0; }
    check('annuler l\'impression en cours : « Impression annulée »', cancelled);
    check('aucune tâche produite par l\'impression annulée', !fs.existsSync(path.join(out, 'jobs.json')), fs.readdirSync(out));
    check('aucune erreur JavaScript', c.logs.length === 0, c.logs.slice(0, 3));
  } catch (e) {
    check('exécution sans exception', false, String(e && e.stack || e));
  } finally {
    await c.close();
    try { fs.rmSync(out, { recursive: true, force: true }); } catch { /* */ }
  }
  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : impression non bloquante (interface).');
})();
