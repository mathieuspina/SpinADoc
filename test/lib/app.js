// Outillage de test d'interface : lance l'application Electron et la pilote via le protocole CDP.
// Nécessite un affichage (fenêtre réelle). Node >= 22 (WebSocket global).
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (u) => new Promise((res, rej) => http.get(u, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));

// exe : exécutable de l'application empaquetée (sinon Electron + dossier du projet = version de développement).
// userDataFiles : { 'recents.json': contenu } écrits dans le dossier de données avant le démarrage.
async function launchApp({ files = [], port = 9300 + Math.floor(Math.random() * 500), env = {}, exe = process.env.SPINADOC_EXE || null, userDataFiles = {} } = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'spinadoc-test-'));
  for (const [name, content] of Object.entries(userDataFiles)) {
    fs.mkdirSync(path.dirname(path.join(userData, name)), { recursive: true }); // « sous-dossier/fichier » accepté
    fs.writeFileSync(path.join(userData, name), typeof content === 'string' || Buffer.isBuffer(content) ? content : JSON.stringify(content));
  }
  const electron = exe || require(path.join(root, 'node_modules', 'electron'));
  // Par défaut les tests tournent hors écran (SPIN_TEST_HEADLESS=1) : aucune fenêtre visible, aucun focus volé. SPIN_TEST_HEADLESS=0 pour voir.
  // Garde-fou DUR : aucun test ne peut imprimer ailleurs que sur « SpinADoc Test PDF » (ou écrire les tâches dans un dossier, sans impression).
  const allow = (env && env.SPINADOC_PRINT_ALLOW) || process.env.SPINADOC_PRINT_ALLOW;
  if (allow && allow !== 'SpinADoc Test PDF') throw new Error('Test refusé : SPINADOC_PRINT_ALLOW doit valoir « SpinADoc Test PDF » (reçu : ' + allow + ')');
  if (!(env && env.SPINADOC_TEST_PRINT_DIR) && !allow) env = Object.assign({}, env, { SPINADOC_PRINT_ALLOW: 'SpinADoc Test PDF' });
  const headlessEnv = { SPIN_TEST_HEADLESS: process.env.SPIN_TEST_HEADLESS === '0' ? '0' : '1' };
  const proc = spawn(electron, [
    ...(exe ? [] : [root]), `--remote-debugging-port=${port}`, '--disable-features=CalculateNativeWinOcclusion',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', ...files,
  ], { stdio: 'ignore', env: Object.assign({}, process.env, headlessEnv, { SPINADOC_USER_DATA: userData }, env) });

  let page = null;
  for (let i = 0; i < 80 && !page; i++) {
    await sleep(250);
    try { page = (await getJson(`http://127.0.0.1:${port}/json`)).find((p) => p.type === 'page'); } catch { /* pas encore prêt */ }
  }
  if (!page) { proc.kill(); throw new Error('Application non démarrée'); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    else if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('console.error ' + d.params.args.map((a) => a.value ?? a.description).join(' '));
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
  await send('Page.enable');
  if (headlessEnv.SPIN_TEST_HEADLESS === '0') await send('Page.bringToFront');

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error('Évaluation : ' + JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result.result.value;
  };
  const rect = async (sel) => JSON.parse(await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)throw new Error('introuvable: '+${JSON.stringify(sel)}); if(e.closest('#ribbon')||e.closest('#doctabs')) e.scrollIntoView({block:'nearest',inline:'nearest'}); const r=e.getBoundingClientRect();return JSON.stringify([r.left,r.top,r.width,r.height])})()`));
  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, buttons: type === 'mouseReleased' || type === 'mouseMoved' ? 0 : 1, ...extra });
  const clickXY = async (x, y) => { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); await sleep(120); };
  const click = async (sel) => { const [x, y, w, h] = await rect(sel); await clickXY(x + w / 2, y + h / 2); };
  const hover = async (sel) => { const [x, y, w, h] = await rect(sel); await mouse('mouseMoved', x + w / 2, y + h / 2); await sleep(250); };
  const wheel = async (x, y, deltaY, modifiers = 0) => { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY, modifiers }); };
  const key = async (k, extra = {}) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, ...extra });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, ...extra });
    await sleep(80);
  };
  const type = (text) => send('Input.insertText', { text });
  const shot = async (file) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.result.data, 'base64')); };
  const waitFor = async (expr, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(100); }
    return false;
  };
  // Deuxième lancement : le fichier doit s'ouvrir dans un nouvel onglet de la fenêtre existante.
  const openMore = async (file) => {
    const p = spawn(electron, [...(exe ? [] : [root]), file], { stdio: 'ignore', env: Object.assign({}, process.env, { SPIN_TEST_HEADLESS: process.env.SPIN_TEST_HEADLESS === '0' ? '0' : '1', SPINADOC_USER_DATA: userData }) });
    await new Promise((r) => p.on('exit', r));
  };
  const close = async () => {
    try { ws.close(); } catch { /* */ }
    // Arbre de processus complet (la version portable lance l'application dans un processus fils).
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F']); else proc.kill(); await sleep(300); try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* */ } };
  return { send, ev, rect, mouse, click, clickXY, hover, wheel, key, type, shot, waitFor, logs, close, openMore, proc, userData, sleep };
}

module.exports = { launchApp, sleep };
