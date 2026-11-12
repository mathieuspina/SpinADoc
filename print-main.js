// Impression (processus principal) : imprimantes et capacités, FILE D'IMPRESSION, envoi des tâches, propriétés de l'imprimante.
//
// Architecture (l'interface ne doit jamais geler) :
//   renderer (index.html)  → 'print:submit' : tâche FIGÉE (PDF édité + feuilles à composer + réglages), retour immédiat ; la boîte se ferme.
//   main (ce module)       → file d'attente (une tâche à la fois), notifications de progression vers l'interface, annulation.
//   fenêtre cachée         → src/print-worker.html : assemble le PDF d'impression (print-compose), rasterise par bandes (print-raster) dans
//                            son PROPRE processus de rendu ; rend chaque PDF de tâche à main.
//   main                   → écrit le PDF dans un dossier temporaire unique, nommé d'après le document, l'ouvre dans une fenêtre cachée (lecteur PDF
//                            de Chromium) et appelle webContents.print : Chromium n'a plus rien à mettre à l'échelle (A4, A3, A1 exacts à 0,1 mm).
// Choix : une fenêtre cachée (et non un Worker) parce que pdf.js, pdf-lib et les canvas y fonctionnent tels quels (mêmes scripts que
// l'interface), qu'elle isole la mémoire des grands formats et qu'elle se détruit à la fin de la file.
//
// Variables d'environnement de test :
//   SPINADOC_TEST_PRINT_DIR   : les tâches sont écrites dans ce dossier (job-1.pdf, jobs.json) au lieu d'être envoyées (aucune impression).
//   SPINADOC_TEST_PRINTERS    : JSON [{ name, isDefault?, caps?: { color, duplex, hardMarginMm, maxCopies, papers } }] : imprimantes simulées (avec le dossier ci-dessus).
//   SPINADOC_PRINT_ALLOW      : nom de l'unique imprimante autorisée ; toute autre est REFUSÉE (garde-fou des tests).
const { BrowserWindow, app } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ALLOW = () => process.env.SPINADOC_PRINT_ALLOW || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toBuffer = (b) => Buffer.from(b.buffer ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : b);
const testPrinters = () => {
  if (!process.env.SPINADOC_TEST_PRINT_DIR) return null;
  try { if (process.env.SPINADOC_TEST_PRINTERS) return JSON.parse(process.env.SPINADOC_TEST_PRINTERS); } catch { /* */ }
  return [{ name: 'Imprimante de test', isDefault: true }];
};

// Capacités d'une imprimante (formats de papier, recto-verso, couleur annoncée, marge matérielle) via .NET (PowerShell, hors ligne). null si indisponible.
// NB : « color » vient de PrinterSettings.SupportsColor, c'est-à-dire de ce que le PILOTE annonce. Des pilotes d'imprimante PDF virtuelle (PDFCreator)
// annoncent « pas de couleur » alors qu'ils enregistrent la couleur : c'est une information, pas un interdit (voir print-ui.js).
function capabilities(name) {
  return new Promise((resolve) => {
    const script = [
      'Add-Type -AssemblyName System.Drawing;',
      '$p = New-Object System.Drawing.Printing.PrinterSettings; $p.PrinterName = $env:SPIN_PRN;',
      'if (-not $p.IsValid) { "null"; exit }',
      '$d = $p.DefaultPageSettings;',
      '[pscustomobject]@{ duplex = $p.CanDuplex; color = $p.SupportsColor; maxCopies = $p.MaximumCopies; hx = $d.HardMarginX; hy = $d.HardMarginY;',
      'papers = @($p.PaperSizes | ForEach-Object { [pscustomobject]@{ name = $_.PaperName; w = $_.Width; h = $_.Height } }) } | ConvertTo-Json -Compress -Depth 4',
    ].join(' ');
    let out = '';
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env: Object.assign({}, process.env, { SPIN_PRN: name }), windowsHide: true });
      ps.stdout.on('data', (d) => { out += d; });
      ps.on('error', () => finish(null));
      ps.on('close', () => {
        try {
          const j = JSON.parse(out.trim());
          if (!j) return finish(null);
          const papers = (Array.isArray(j.papers) ? j.papers : []).filter((q) => q.w > 0 && q.h > 0).map((q) => ({ name: q.name, w: Math.round((q.w / 100) * 254) / 10, h: Math.round((q.h / 100) * 254) / 10 }));
          const hard = Math.max(Number(j.hx) || 0, Number(j.hy) || 0);
          finish({ duplex: !!j.duplex, color: j.color !== false, maxCopies: j.maxCopies || 1, papers, hardMarginMm: hard > 0 ? Math.round((hard / 100) * 254) / 10 : null });
        } catch { finish(null); }
      });
      setTimeout(() => { try { ps.kill(); } catch { /* */ } finish(null); }, 15000);
    } catch { finish(null); }
  });
}

// Une tâche : fichier PDF dont toutes les pages ont la taille du papier. Résout { ok, message }.
// Le nom du travail vu par le spouleur vient du titre du document : nom du fichier temporaire, /Title du PDF et titre de la fenêtre sont tous trois
// le nom du document (voir print-layout.js jobTitle / jobFileName).
async function printOne(file, job, opts, title) {
  const win = new BrowserWindow({ show: false, title, webPreferences: { plugins: true, backgroundThrottling: false } });
  let keepAlive = false;
  try {
    win.on('page-title-updated', (e) => { e.preventDefault(); win.setTitle(title); });
    await win.loadURL('file:///' + file.replace(/\\/g, '/'));
    win.setTitle(title);
    await sleep(2000); // le lecteur PDF a besoin d'un court instant pour charger le document
    const o = {
      silent: !opts.dialog, deviceName: opts.device, printBackground: true, margins: { marginType: 'none' },
      copies: Math.max(1, Math.min(999, opts.copies || 1)), collate: !!opts.collate,
      color: opts.color !== false, duplexMode: opts.duplex || 'simplex',
      pageSize: { width: Math.round(job.wMm * 1000), height: Math.round(job.hMm * 1000) },
    };
    if (ALLOW() && o.deviceName !== ALLOW()) throw new Error('Imprimante refusée par le garde-fou de test : ' + o.deviceName);
    let finished = false;
    const cb = new Promise((res) => win.webContents.print(o, (success, reason) => { finished = true; res({ success, reason }); }));
    // Certains pilotes (imprimantes virtuelles à port fichier) ne rappellent pas : après 8 s la tâche est considérée comme envoyée ; la fenêtre
    // reste vivante (jusqu'au rappel, ou 10 min) pour ne pas interrompre un gros travail en cours d'envoi.
    const r = await Promise.race([cb, sleep(opts.dialog ? 600000 : 8000).then(() => ({ success: true, reason: '', pending: true }))]);
    if (r.pending && !finished) {
      keepAlive = true;
      const kill = () => { try { win.destroy(); } catch { /* */ } };
      cb.then(kill);
      setTimeout(kill, 600000);
    }
    return r.success ? { ok: true } : { ok: false, message: r.reason || 'Échec de l\'impression' };
  } catch (e) { return { ok: false, message: String((e && e.message) || e) };
  } finally { if (!keepAlive) { try { win.destroy(); } catch { /* */ } } }
}

// ---------------------------------------------------------------- file d'impression
let ipc = null;
let getMain = () => null;
let seq = 0;
const queue = [];      // tâches en attente
let running = null;    // tâche en cours
let worker = null;     // fenêtre de travail cachée
let workerReady = null;
let idleTimer = null;

const publicView = (t) => ({ id: t.id, name: t.name, state: t.state, label: t.label || '', fraction: t.fraction || 0, sheet: t.sheet || 0, total: t.total || 0, message: t.message || '', device: t.opts.device });
function notify(t) { const w = getMain(); if (w && !w.isDestroyed()) w.webContents.send('print:progress', publicView(t)); }
const active = () => queue.length + (running ? 1 : 0);

function ensureWorker() {
  clearTimeout(idleTimer);
  if (worker && !worker.isDestroyed()) return workerReady;
  worker = new BrowserWindow({
    show: false, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  workerReady = new Promise((res) => { worker._ready = res; });
  worker.webContents.on('will-navigate', (e) => e.preventDefault());
  worker.loadFile(path.join(__dirname, 'src', 'print-worker.html'));
  worker.on('closed', () => { worker = null; });
  return workerReady;
}
function releaseWorker() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (!running && worker && !worker.isDestroyed()) { worker.destroy(); worker = null; } }, 15000);
}

async function pump() {
  if (running || !queue.length) return;
  const t = queue.shift();
  running = t;
  t.state = 'running'; t.label = 'Préparation'; t.chain = Promise.resolve(); t.jobs = [];
  notify(t);
  try {
    await ensureWorker();
    await new Promise((resolve) => {
      t.finish = resolve;
      worker.webContents.send('pw:run', { id: t.id, edBytes: t.edBytes, groups: t.groups, raster: t.raster, name: t.name });
    });
    await t.chain; // envois à l'imprimante terminés
    if (t.cancelled) { t.state = 'cancelled'; t.message = 'Impression annulée.'; }
    else if (t.error) t.state = 'error';
    else { t.state = 'done'; t.fraction = 1; }
  } catch (e) { t.state = 'error'; t.error = String((e && e.message) || e); t.message = t.error; }
  t.edBytes = null; // libère la copie figée
  notify(t);
  running = null;
  if (queue.length) pump(); else releaseWorker();
}

function onJob(t, j) {
  const dir = process.env.SPINADOC_TEST_PRINT_DIR;
  if (dir) { // test : aucune impression, le PDF d'impression est écrit dans le dossier
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `job-${j.index + 1}.pdf`), toBuffer(j.bytes));
    t.jobs.push({ wMm: j.wMm, hMm: j.hMm, title: j.title, fileName: j.fileName });
    fs.writeFileSync(path.join(dir, 'jobs.json'), JSON.stringify({ opts: t.opts, name: t.name, jobs: t.jobs }));
    return;
  }
  // dossier temporaire UNIQUE par travail (pas de collision entre files), fichier nommé d'après le document
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spinadoc-print-'));
  const f = path.join(tmp, j.fileName);
  fs.writeFileSync(f, toBuffer(j.bytes));
  t.chain = t.chain.then(async () => {
    if (t.cancelled || t.error) return;
    t.label = 'Envoi'; t.sheet = t.total; notify(t);
    if (ALLOW() && t.opts.device !== ALLOW()) { t.error = 'Imprimante refusée par le garde-fou de test.'; t.message = t.error; return; }
    const r = await printOne(f, j, t.opts, j.title);
    if (!r.ok) { t.error = r.message; t.message = r.message; }
  }).finally(() => { setTimeout(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }, 120000); });
}

function register(ipcMain, mainGetter) {
  ipc = ipcMain;
  if (mainGetter) getMain = mainGetter;

  ipcMain.handle('print:printers', async () => {
    const tp = testPrinters();
    if (tp) return tp.map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault, status: 0 }));
    const w = getMain() || BrowserWindow.getAllWindows()[0];
    if (!w) return [];
    let list = [];
    try { list = await w.webContents.getPrintersAsync(); } catch { list = []; }
    if (ALLOW()) list = list.filter((p) => p.name === ALLOW());
    return list.map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault, status: p.status }));
  });

  ipcMain.handle('print:caps', async (_e, name) => {
    const tp = testPrinters();
    if (tp) { const p = tp.find((x) => x.name === name); return (p && p.caps) || null; }
    return capabilities(String(name));
  });

  // task : { name, edBytes, groups: [{ w, h, sheets }], raster: null | { mode, dpi, thin }, opts: { device, copies, collate, duplex, color, dialog } }
  // Retour immédiat : { id }. La tâche travaille sur la copie figée reçue ici (fermer l'onglet ou modifier le document ne change rien).
  ipcMain.handle('print:submit', (_e, task) => {
    if (ALLOW() && !process.env.SPINADOC_TEST_PRINT_DIR && task.opts.device !== ALLOW()) return { ok: false, message: 'Imprimante refusée par le garde-fou de test.' };
    const t = { id: ++seq, name: task.name || 'Sans titre', edBytes: task.edBytes, groups: task.groups, raster: task.raster || null, opts: task.opts, state: 'queued', label: 'En attente', fraction: 0 };
    queue.push(t);
    notify(t);
    pump();
    return { ok: true, id: t.id, test: !!process.env.SPINADOC_TEST_PRINT_DIR };
  });

  ipcMain.handle('print:cancel', (_e, id) => {
    const qi = queue.findIndex((t) => t.id === id);
    if (qi >= 0) { const [t] = queue.splice(qi, 1); t.state = 'cancelled'; t.message = 'Impression annulée.'; t.edBytes = null; notify(t); return true; }
    if (running && running.id === id) {
      running.cancelled = true;
      if (worker && !worker.isDestroyed()) worker.webContents.send('pw:cancel', id);
      return true;
    }
    return false;
  });
  ipcMain.handle('print:active', () => active());

  // messages de la fenêtre de travail
  ipcMain.on('pw:ready', () => { if (worker && worker._ready) worker._ready(); });
  ipcMain.on('pw:progress', (_e, d) => {
    if (!running || running.id !== d.id) return;
    Object.assign(running, { fraction: d.fraction, sheet: d.sheet, total: d.total, label: d.label });
    notify(running);
  });
  ipcMain.handle('pw:job', (_e, j) => { if (running && running.id === j.id && !running.cancelled) onJob(running, j); return true; });
  ipcMain.on('pw:done', (_e, d) => {
    if (!running || running.id !== d.id) return;
    if (d.error && !running.cancelled) { running.error = d.error; running.message = d.error; }
    if (running.finish) running.finish();
  });

  // Propriétés de l'imprimante : la boîte de préférences de Windows (printui.dll). Elle règle les valeurs par défaut du pilote.
  ipcMain.handle('print:props', async (_e, name) => {
    if (process.env.SPINADOC_TEST_PRINT_DIR) return { ok: true, test: true };
    if (ALLOW() && name !== ALLOW()) return { ok: false };
    try { spawn('rundll32.exe', ['printui.dll,PrintUIEntry', '/e', '/n', String(name)], { detached: true, stdio: 'ignore' }).unref(); return { ok: true }; } catch { return { ok: false }; }
  });
}

module.exports = { register, active };
