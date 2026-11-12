// Caviardage, sorties protégées (interface, hors écran) : avec une zone non appliquée, l'impression, l'export en images, l'extraction, la division
// et la fusion posent la question « Appliquer d'abord » / « Continuer quand même » / « Annuler ». Annuler n'ouvre rien ; Continuer ouvre la sortie ;
// Appliquer d'abord (depuis la fusion) applique le caviardage puis ajoute le document CAVIARDÉ. Boîte « Appliquer » : liste « Éléments à vérifier »
// (PDF piège n° 2) sans débordement.
// Usage : node test/test-redact-guard-ui.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp, sleep } = require('./lib/app.js');
const { makeRedactExtrasPdf, S } = require('./lib/make-redact-extras-pdf.js');
const { SCRIPT } = require('./lib/overflow.js');

const failures = [];
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   ', name); }
  else { failures.push(name); console.log('  ECHEC', name, detail !== undefined ? '→ ' + JSON.stringify(detail) : ''); }
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spinadoc-guard-'));
  const file = path.join(dir, 'piege2.pdf');
  fs.writeFileSync(file, await makeRedactExtrasPdf());
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spinadoc-guard-out-'));
  const c = await launchApp({ files: [file], env: { SPINADOC_TEST_SAVE_DIR: out } });
  const run = (mod, fn) => c.ev(`(()=>{ import('./js/ui.js').then((u)=>import('./js/${mod}').then((m)=>{ window.__r = m.${fn}(u.store.active); })); return 1 })()`);
  const choice = () => c.ev(`(()=>{const d=document.getElementById('choice'); return d.hidden ? null : JSON.stringify({ title: document.getElementById('choice-title').textContent, msg: document.getElementById('choice-msg').textContent, buttons: [...document.querySelectorAll('#choice-actions button')].map(b=>b.textContent) })})()`).then((x) => (x ? JSON.parse(x) : null));
  const answer = async (label) => { await c.ev(`(()=>{const b=[...document.querySelectorAll('#choice-actions button')].find(b=>b.textContent===${JSON.stringify(label)}); b.click(); return 1})()`); await sleep(300); };
  const shown = (id) => c.ev(`!document.getElementById(${JSON.stringify(id)}).hidden`);
  const doc = (expr) => c.ev(`import('./js/ui.js').then((m)=>{const d=m.store.active; return JSON.stringify(${expr})})`).then(JSON.parse);
  try {
    await c.waitFor(`document.querySelectorAll('.docview.active canvas').length>0`, 15000);
    await sleep(800);
    await c.ev(`import('./js/ui.js').then((m)=>{const d=m.store.active; window.DocModel.addEdit(d, window.Redact.zoneFromRect(0, [60, 700, 400, 800])); m.bus.emit('doc-changed', d); return 1})`);
    check('une zone à caviarder non appliquée (page 1)', (await doc(`d.edits.filter(e=>e.type==='redact').length`)) === 1);

    console.log('1. Impression');
    await c.key('p', { code: 'KeyP', windowsVirtualKeyCode: 80, modifiers: 2 }); await sleep(400);
    let q = await choice();
    check('Ctrl+P : question posée, 3 choix dans l\'ordre', !!q && q.buttons.join('|') === 'Appliquer d\'abord|Continuer quand même|Annuler', q);
    check('le message dit que l\'impression sortirait le texte EN CLAIR', !!q && /L'impression/.test(q.msg) && /EN CLAIR/.test(q.msg), q && q.msg);
    await answer('Annuler');
    check('Annuler : la boîte d\'impression ne s\'ouvre pas', !(await shown('printdlg')));
    await c.key('p', { code: 'KeyP', windowsVirtualKeyCode: 80, modifiers: 2 }); await sleep(400);
    await answer('Continuer quand même'); await sleep(300);
    check('Continuer quand même : la boîte d\'impression s\'ouvre', await shown('printdlg'));
    await c.click('#pr-cancel'); await sleep(300);

    console.log('2. Export en images, extraction, division');
    await run('docs-ui.js', 'exportImages'); await sleep(400);
    q = await choice();
    check('export en images : question posée', !!q && /L'export en images/.test(q.msg), q);
    await answer('Annuler');
    check('Annuler : la boîte d\'export ne s\'ouvre pas', !(await shown('pgdlg')));
    await run('pages-ui.js', 'extract'); await sleep(400);
    q = await choice();
    check('extraction de la page 1 (avec zone) : question posée', !!q && /L'extraction/.test(q.msg), q);
    await answer('Annuler');
    check('Annuler : rien n\'est écrit', fs.readdirSync(out).length === 0, fs.readdirSync(out));
    await c.ev(`import('./js/ui.js').then((m)=>{m.store.active.page=1; return 1})`);
    await run('pages-ui.js', 'extract'); await sleep(1500);
    check('extraction de la page 2 (sans zone) : aucune question, fichier écrit', !(await choice()) && fs.readdirSync(out).length === 1, fs.readdirSync(out));
    await c.ev(`import('./js/ui.js').then((m)=>{m.store.active.page=0; return 1})`);
    await run('pages-ui.js', 'split'); await sleep(400);
    q = await choice();
    check('division : question posée', !!q && /La division/.test(q.msg), q);
    await answer('Annuler');

    console.log('3. Fusion : Annuler, puis Appliquer d\'abord');
    await c.click('#rtab-home'); await c.click('#rpanel-home [data-cmd=merge-open]'); await sleep(500);
    const addFromTabs = async () => { await c.click('#mw-tabs'); await sleep(250); await c.ev(`(()=>{document.querySelector('#mw-menu button.recent-item').click(); return 1})()`); await sleep(400); };
    const nItems = () => c.ev(`import('./js/merge-ui.js').then((m)=>m.items().length)`);
    await addFromTabs();
    q = await choice();
    check('ajout du document ouvert : question posée par-dessus l\'espace de fusion', !!q && /La fusion/.test(q.msg), q);
    check('la question est au premier plan (cliquable)', await c.ev(`(()=>{const b=document.querySelector('#choice-actions button'); const r=b.getBoundingClientRect(); const e=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2); return e===b || b.contains(e)})()`));
    await answer('Annuler');
    check('Annuler : rien n\'est ajouté', (await nItems()) === 0);
    await addFromTabs();
    await answer('Appliquer d\'abord'); await sleep(400);
    check('Appliquer d\'abord : la boîte « Appliquer le caviardage » s\'ouvre', await shown('rdx-apply'));
    await c.waitFor(`import('./js/redact-ui.js').then((m)=>m.state.check).then(()=>!/Analyse/.test(document.getElementById('rdx-apply-check-list').textContent))`, 8000);
    const list = await c.ev(`JSON.stringify([...document.querySelectorAll('#rdx-apply-check-list li')].map(l=>[l.className, l.textContent]))`).then(JSON.parse);
    check('« Éléments à vérifier » : 11 lignes (PDF piège n° 2)', list.length === 11, list);
    check('les commentaires conservés sont signalés « Subsiste », en tête de liste', list.length > 0 && list[0][0] === 'kept' && /^Subsiste : Texte des commentaires/.test(list[0][1]), list);
    check('signets, pièces jointes, JavaScript, champs : « Supprimé »', ['Signets', 'Pièces jointes du document', 'JavaScript et actions automatiques', 'Champs de formulaire'].every((w) => list.some(([cl, t]) => cl === 'removed' && t.includes(w))), list);
    const ov = JSON.parse(await c.ev(SCRIPT('#rdx-apply')));
    check(`boîte « Appliquer » avec la liste : aucun débordement (${ov.n} éléments)`, ov.bad.length === 0, ov.bad.slice(0, 4));
    await c.ev(`(()=>{const cb=document.getElementById('rdx-confirm'); cb.checked=true; cb.dispatchEvent(new Event('change')); document.getElementById('rdx-dpi').value='150'; return 1})()`);
    await c.click('#rdx-apply-ok');
    await c.waitFor(`!document.getElementById('choice').hidden && /appliqué/.test(document.getElementById('choice-title').textContent)`, 30000);
    await answer('Plus tard'); await sleep(1500);
    check('caviardage appliqué : plus de zone, page 1 remplacée (rd1)', (await doc(`[d.edits.filter(e=>e.type==='redact').length, d.pages[0].src]`)).join() === '0,rd1');
    await c.waitFor(`import('./js/merge-ui.js').then((m)=>m.items().length===1)`, 8000);
    const txt = await c.ev(`import('./js/merge-ui.js').then(async (m)=>{ const it=m.items()[0]; const V=await import('./js/viewer.js'); const pdf=await V.loadPdf(it.bytes.slice()); const p=await pdf.getPage(1); return (await p.getTextContent()).items.map(t=>t.str).join(' ') })`);
    check('le document ajouté à la fusion est la version CAVIARDÉE (secret absent du texte de la page 1)', !txt.includes(S.text1), txt);
    await c.click('#mw-cancel'); await sleep(300);
    check('aucune erreur JavaScript', c.logs.length === 0, c.logs.slice(0, 3));
  } catch (e) {
    check('exécution sans exception', false, String(e && e.stack || e));
  } finally {
    await c.close();
  }
  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : sorties protégées (caviardage).');
})();
