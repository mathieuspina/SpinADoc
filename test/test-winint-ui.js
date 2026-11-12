// Intégration à Windows (interface, hors écran ; aucune fenêtre des Paramètres de Windows ouverte : SPINADOC_TEST_EXTERNAL) :
// Réglages → boîte « Intégration à Windows » (lecteur PDF seulement, plus d'imprimante), page « Applications par défaut », Échap,
// cliquabilité et débordement ; deuxième lancement avec un PDF en argument → onglet ouvert dans la fenêtre existante.
// Usage : node test/test-winint-ui.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { launchApp, sleep } = require('./lib/app.js');
const { makeAll } = require('./lib/make-pdfs.js');
const { SCRIPT: OVERFLOW } = require('./lib/overflow.js');
const { SCRIPT: CLICKABLE } = require('./lib/clickable.js');

const failures = [];
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   ', name); }
  else { failures.push(name); console.log('  ECHEC', name, detail !== undefined ? '→ ' + JSON.stringify(detail).slice(0, 400) : ''); }
}

(async () => {
  const f = await makeAll(path.join(os.tmpdir(), 'spinadoc-ui-pdfs'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spinadoc-winint-'));
  const ext = path.join(tmp, 'external.log');
  const c = await launchApp({ files: [f.a], env: { SPINADOC_TEST_EXTERNAL: ext } });
  const vis = (id) => c.ev(`!document.getElementById('${id}').hidden`);
  try {
    await c.waitFor(`document.querySelectorAll('.docview.active canvas').length>0`, 15000);
    console.log('1. Boîte « Intégration à Windows »');
    await c.click('#btn-settings'); await sleep(250); await c.click('#btn-winint'); await sleep(300);
    check('ouverte depuis Réglages (Réglages refermés)', await vis('winint') && !(await vis('settings')));
    const txt = await c.ev(`document.getElementById('winint').textContent`);
    check('lecteur PDF seulement : « Ouvrir avec », aucune mention d\'imprimante', /Ouvrir avec/.test(txt) && !/imprim/i.test(txt) && !(await c.ev(`!!document.querySelector('[id^=vp-]')`)), txt.replace(/\s+/g, ' '));
    const ck = JSON.parse(await c.ev(CLICKABLE('#winint')));
    const ov = JSON.parse(await c.ev(OVERFLOW('#winint .dialog')));
    check(`boîte : cliquable (${ck.n}) et sans débordement (${ov.n})`, ck.n >= 2 && ck.bad.length === 0 && ov.bad.length === 0, [ck.bad, ov.bad].map((x) => x.slice(0, 3)));
    await c.click('#winint-defaults'); await sleep(300);
    const e = fs.existsSync(ext) ? fs.readFileSync(ext, 'utf8') : '';
    check('« Applications par défaut » : ms-settings:defaultapps?registeredAppUser=Spin%20A%20Doc', e.includes('uri\tms-settings:defaultapps?registeredAppUser=Spin%20A%20Doc'), e);
    await c.key('Escape', { code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(150);
    check('Échap ferme la boîte', !(await vis('winint')));

    console.log('2. Deuxième lancement avec un PDF en argument');
    const n0 = await c.ev(`document.querySelectorAll('.doctab').length`);
    const electron = require(path.join(__dirname, '..', 'node_modules', 'electron'));
    const second = spawn(electron, [path.join(__dirname, '..'), f.b], { stdio: 'ignore', env: Object.assign({}, process.env, { SPIN_TEST_HEADLESS: '1', SPINADOC_USER_DATA: c.userData }) });
    const code = await new Promise((r) => { const t = setTimeout(() => { second.kill(); r('délai'); }, 20000); second.on('exit', (x) => { clearTimeout(t); r(x); }); });
    check('le deuxième processus se termine aussitôt (instance unique)', code === 0, code);
    await c.waitFor(`document.querySelectorAll('.doctab').length>${n0}`, 8000);
    const names = JSON.parse(await c.ev(`JSON.stringify([...document.querySelectorAll('.doctab .doctab-name')].map(e=>e.textContent))`));
    check('le PDF passé en argument s\'ouvre dans un onglet de la fenêtre existante', names.length === n0 + 1 && names.includes(path.basename(f.b)), names);
    check('aucune erreur JavaScript', c.logs.length === 0, c.logs);
  } catch (err) {
    failures.push('exception : ' + err.message); console.log('  ECHEC exception', err.message);
  } finally {
    await c.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failures.length ? `\n${failures.length} échec(s) / ${passed + failures.length}` : `\nOK : ${passed} vérifications.`);
  process.exit(failures.length ? 1 : 0);
})();
