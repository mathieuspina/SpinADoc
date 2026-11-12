const { app, BrowserWindow, ipcMain, dialog, Menu, clipboard, shell } = require('electron');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const Recents = require('./src/recents.js');
const PrintMain = require('./print-main.js');
const AppInfo = require('./app-info.js');

// Nom affiché dans toutes les boîtes natives, et dossier de données stable (dev et version installée).
// SPINADOC_USER_DATA : dossier alternatif, utilisé par les tests automatisés.
app.setName('Spin A Doc');
app.setPath('userData', process.env.SPINADOC_USER_DATA || path.join(app.getPath('appData'), 'Spin A Doc'));

const isDev = process.argv.includes('--dev');
let win = null;
let dirty = false; // au moins un document modifié
let forceClose = false;
let pending = []; // fichiers à ouvrir dès que la fenêtre est prête
let initialServed = false; // la fenêtre a lu `pending` : les fichiers suivants lui sont envoyés directement

// ---------- petit stockage JSON dans userData ----------
const userFile = (n) => path.join(app.getPath('userData'), n);
function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(userFile(name), 'utf8')); } catch { return fallback; }
}
function writeJson(name, data) {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(userFile(name), JSON.stringify(data, null, 2), 'utf8');
  } catch (e) { console.error('Écriture impossible :', name, e.message); }
}

function pdfsFromArgs(argv) {
  // Ignore l'exécutable, les options (--xxx) et, en dev, le chemin de l'app.
  const args = argv.slice(app.isPackaged ? 1 : 2);
  return args.filter((a) => !a.startsWith('--') && /\.pdf$/i.test(a) && fs.existsSync(a)).map((a) => path.resolve(a));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // Deuxième lancement : le fichier s'ouvre dans un onglet de la fenêtre existante.
  app.on('second-instance', (_e, argv) => {
    const files = pdfsFromArgs(argv);
    // Fenêtre pas encore prête (fichiers initiaux non lus) : les fichiers rejoignent `pending` au lieu d'être perdus.
    if (!win || !initialServed) { pending.push(...files); return; }
    if (process.env.SPIN_TEST_HEADLESS !== '1') { if (win.isMinimized()) win.restore(); win.focus(); } // tests : jamais de fenêtre affichée
    files.forEach((f) => win.webContents.send('open-file', f));
  });
}

function createWindow() {
  // SPIN_TEST_HEADLESS=1 (tests automatisés) : fenêtre jamais affichée, sans focus, rendu hors écran qui reste actif.
  const headless = process.env.SPIN_TEST_HEADLESS === '1';
  win = new BrowserWindow({
    show: !headless,
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 560,
    title: 'Spin A Doc',
    backgroundColor: '#0F0F11',
    // Barre de titre native masquée : l'en-tête de l'application (logo + onglets du ruban) en tient lieu. Les boutons natifs de
    // Windows (réduire, agrandir avec les dispositions d'ancrage de Windows 11, fermer) restent affichés par-dessus (overlay).
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0F0F11', symbolColor: '#EDEDED', height: 48 },
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !headless,
      offscreen: headless,
      devTools: isDev || headless,
    },
  });

  if (isDev) {
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) {
        win.webContents.toggleDevTools();
      }
    });
  }

  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Aucune navigation ni fenêtre externe depuis l'application.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Fermeture de la fenêtre : s'il y a des modifications, c'est l'interface qui pose la question
  // (boîte « Enregistrer / Ne pas enregistrer / Annuler »), puis elle confirme avec 'app:close-confirmed'.
  win.on('close', (e) => {
    if ((!dirty && !PrintMain.active()) || forceClose) return; // modifications non enregistrées ou impression en cours : l'interface demande
    e.preventDefault();
    win.webContents.send('app:request-close');
  });
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  AppInfo.installNetGuard(require('electron').session.defaultSession); // 100 % hors-ligne : toute requête réseau est bloquée et comptée
  pending = pdfsFromArgs(process.argv).concat(pending); // + fichiers d'un deuxième lancement arrivés avant que l'application soit prête
  createWindow();
});

app.on('window-all-closed', () => app.quit());

// ---------- IPC ----------
const toBuffer = (b) => Buffer.from(b.buffer ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : b);

ipcMain.handle('file:get-initial', () => {
  const f = pending;
  pending = [];
  initialServed = true;
  return f;
});

// opts.noRecent : lecture pour un usage interne (pages à insérer) : le fichier n'est pas ajouté aux récents.
ipcMain.handle('file:read', async (_e, filePath, opts) => {
  const buf = await fs.promises.readFile(filePath);
  if (!(opts && opts.noRecent)) writeJson('recents.json', Recents.addRecent(readJson('recents.json', []), filePath, Date.now()));
  return { path: filePath, name: path.basename(filePath), bytes: new Uint8Array(buf) };
});

// Points d'entrée réservés aux tests automatisés (variables d'environnement, absentes en usage normal) :
//   SPINADOC_TEST_OPEN = JSON ["chemin", …] : remplace la boîte « Ouvrir »
//   SPINADOC_TEST_SAVE_DIR = dossier : « Enregistrer sous » écrit directement dedans (sans boîte)
ipcMain.handle('file:open-dialog', async () => {
  if (process.env.SPINADOC_TEST_OPEN) return JSON.parse(process.env.SPINADOC_TEST_OPEN);
  const r = await dialog.showOpenDialog(win, {
    title: 'Ouvrir un PDF',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Documents PDF', extensions: ['pdf'] }],
  });
  return r.canceled ? [] : r.filePaths;
});

// forbid : chemin qui ne doit jamais être remplacé (document caviardé : son fichier d'origine) → { saved: false, refused: true }, rien n'est écrit.
ipcMain.handle('file:save-as', async (_e, { bytes, suggestedName, originalPath, forbid }) => {
  const defaultPath = originalPath ? path.join(path.dirname(originalPath), suggestedName) : suggestedName;
  const r = process.env.SPINADOC_TEST_SAVE_DIR
    ? { canceled: false, filePath: path.join(process.env.SPINADOC_TEST_SAVE_DIR, suggestedName) }
    : await dialog.showSaveDialog(win, {
      title: 'Enregistrer sous',
      defaultPath,
      filters: [{ name: 'Documents PDF', extensions: ['pdf'] }],
    });
  if (r.canceled || !r.filePath) return { saved: false };
  if (forbid && path.resolve(r.filePath).toLowerCase() === path.resolve(forbid).toLowerCase()) return { saved: false, refused: true };

  // Le remplacement d'un fichier existant est confirmé par la boîte native « Enregistrer sous » de Windows :
  // pas de seconde confirmation de l'application.
  await fs.promises.writeFile(r.filePath, toBuffer(bytes));
  writeJson('recents.json', Recents.addRecent(readJson('recents.json', []), r.filePath, Date.now()));
  return { saved: true, path: r.filePath, name: path.basename(r.filePath) };
});

// Division d'un PDF : choix du dossier de destination, puis écriture de plusieurs fichiers (jamais d'écrasement : « nom (2).pdf »).
// SPINADOC_TEST_SAVE_DIR : dossier imposé, sans boîte.
ipcMain.handle('file:pick-dir', async (_e, startDir) => {
  if (process.env.SPINADOC_TEST_SAVE_DIR) return process.env.SPINADOC_TEST_SAVE_DIR;
  const r = await dialog.showOpenDialog(win, { title: 'Dossier de destination', defaultPath: startDir || undefined, properties: ['openDirectory', 'createDirectory'] });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
});
ipcMain.handle('file:write-many', async (_e, { dir, files }) => {
  const written = [];
  for (const f of files) {
    const base = path.basename(f.name); // jamais de sous-dossier
    let target = path.join(dir, base);
    for (let k = 2; fs.existsSync(target); k++) target = path.join(dir, base.replace(/(\.[A-Za-z0-9]{1,5})?$/, ` (${k})$1`));
    await fs.promises.writeFile(target, toBuffer(f.bytes));
    written.push(path.basename(target));
  }
  return { dir, written };
});

// Enregistre un fichier texte (export CSV des mesures…). SPINADOC_TEST_SAVE_DIR : écrit directement dans ce dossier.
ipcMain.handle('file:save-text', async (_e, { text, suggestedName, filterName, ext }) => {
  const r = process.env.SPINADOC_TEST_SAVE_DIR
    ? { canceled: false, filePath: path.join(process.env.SPINADOC_TEST_SAVE_DIR, suggestedName) }
    : await dialog.showSaveDialog(win, { title: 'Exporter', defaultPath: suggestedName, filters: [{ name: filterName || 'Fichier', extensions: [ext || 'txt'] }] });
  if (r.canceled || !r.filePath) return { saved: false };
  await fs.promises.writeFile(r.filePath, text, 'utf8');
  return { saved: true, path: r.filePath };
});

PrintMain.register(ipcMain, () => win); // impression : imprimantes, capacités, envoi des tâches

// Échelles de mesure mémorisées par fichier (userData/measure-scales.json) : { [chemin en minuscules]: { scales, unit, precision } }
ipcMain.handle('measure:load', (_e, p) => (readJson('measure-scales.json', {})[String(p).toLowerCase()] || null));
ipcMain.handle('measure:save', (_e, { path: p, data }) => {
  const all = readJson('measure-scales.json', {});
  all[String(p).toLowerCase()] = data;
  writeJson('measure-scales.json', all);
  return true;
});

// ---------- bibliothèque de tampons et de signatures (dossier userData/library) ----------
// index.json : [{ id, kind: 'stamp-image' | 'stamp-text' | 'sig-ink' | 'sig-image', name, ext?, ...paramètres }] ; images : <id>.<ext>
const libDir = () => path.join(app.getPath('userData'), 'library');
const libIndex = () => path.join(libDir(), 'index.json');
function readLib() { try { return JSON.parse(fs.readFileSync(libIndex(), 'utf8')); } catch { return []; } }
function writeLib(list) { fs.mkdirSync(libDir(), { recursive: true }); fs.writeFileSync(libIndex(), JSON.stringify(list, null, 2), 'utf8'); }

ipcMain.handle('lib:list', () => readLib().map((e) => {
  if (!e.ext) return e;
  try { return Object.assign({}, e, { bytes: new Uint8Array(fs.readFileSync(path.join(libDir(), e.id + '.' + e.ext))) }); } catch { return e; }
}));
ipcMain.handle('lib:add', (_e, { entry, bytes }) => {
  const id = crypto.randomUUID();
  const e = Object.assign({}, entry, { id });
  fs.mkdirSync(libDir(), { recursive: true });
  if (bytes) { e.ext = entry.ext || 'png'; fs.writeFileSync(path.join(libDir(), id + '.' + e.ext), toBuffer(bytes)); }
  const list = readLib();
  list.push(e);
  writeLib(list);
  return e;
});
ipcMain.handle('lib:rename', (_e, { id, name }) => {
  const list = readLib();
  const e = list.find((x) => x.id === id);
  if (e) { e.name = String(name).slice(0, 80); writeLib(list); }
  return list.length;
});
ipcMain.handle('lib:remove', (_e, id) => {
  const list = readLib();
  const e = list.find((x) => x.id === id);
  if (e && e.ext) fs.rmSync(path.join(libDir(), id + '.' + e.ext), { force: true });
  writeLib(list.filter((x) => x.id !== id));
  return true;
});

// ---------- images : sélection de fichiers, presse-papiers ----------
//   SPINADOC_TEST_IMAGES = JSON ["chemin", …] / SPINADOC_TEST_CLIPBOARD_IMAGE = chemin : points d'entrée de test
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
const readImageFile = (p) => ({ name: path.basename(p), mime: MIME[path.extname(p).toLowerCase()] || 'image/png', bytes: new Uint8Array(fs.readFileSync(p)) });
ipcMain.handle('file:open-images', async () => {
  let paths;
  if (process.env.SPINADOC_TEST_IMAGES) paths = JSON.parse(process.env.SPINADOC_TEST_IMAGES);
  else {
    const r = await dialog.showOpenDialog(win, { title: 'Insérer une image', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images PNG / JPEG', extensions: ['png', 'jpg', 'jpeg'] }] });
    paths = r.canceled ? [] : r.filePaths;
  }
  return paths.map(readImageFile);
});
ipcMain.handle('file:read-image', (_e, p) => readImageFile(p));
ipcMain.handle('clipboard:image', () => {
  if (process.env.SPINADOC_TEST_CLIPBOARD_IMAGE) return readImageFile(process.env.SPINADOC_TEST_CLIPBOARD_IMAGE);
  const img = clipboard.readImage();
  if (img.isEmpty()) return null;
  return { name: 'presse-papiers.png', mime: 'image/png', bytes: new Uint8Array(img.toPNG()) };
});

ipcMain.handle('recents:list', () => readJson('recents.json', []));
ipcMain.handle('recents:clear', () => { writeJson('recents.json', []); return []; });
ipcMain.handle('recents:remove', (_e, p) => {
  const l = Recents.removeRecent(readJson('recents.json', []), p);
  writeJson('recents.json', l);
  return l;
});

ipcMain.handle('settings:get', () => readJson('settings.json', {}));
ipcMain.handle('settings:set', (_e, patch) => {
  const s = Object.assign(readJson('settings.json', {}), patch);
  writeJson('settings.json', s);
  return s;
});

ipcMain.handle('win:toggle-fullscreen', () => {
  if (!win) return false;
  win.setFullScreen(!win.isFullScreen());
  return win.isFullScreen();
});
ipcMain.handle('win:is-fullscreen', () => !!win && win.isFullScreen());

ipcMain.handle('app:about', () => AppInfo.about(app, __dirname));
// Diagnostic (sans nom de fichier, chemin ni contenu) : copié dans le presse-papiers et renvoyé.
ipcMain.handle('app:diag', async () => {
  const text = await AppInfo.diagnostic(app, require('electron').screen, win.webContents, __dirname);
  clipboard.writeText(text);
  return text;
});
ipcMain.handle('app:net', () => AppInfo.netStats());
// Windows 11 : page « Applications par défaut » de Spin A Doc (nom inscrit dans RegisteredApplications par l'installeur).
// SPINADOC_TEST_EXTERNAL : l'adresse est notée dans ce fichier au lieu d'ouvrir les Paramètres de Windows (tests).
ipcMain.handle('app:default-apps', () => {
  const uri = 'ms-settings:defaultapps?registeredAppUser=' + encodeURIComponent('Spin A Doc');
  if (process.env.SPINADOC_TEST_EXTERNAL) { fs.appendFileSync(process.env.SPINADOC_TEST_EXTERNAL, 'uri\t' + uri + '\n'); return true; }
  return shell.openExternal(uri).then(() => true, () => false);
});

ipcMain.on('doc:dirty', (_e, value) => { dirty = !!value; });
ipcMain.on('app:close-confirmed', () => { forceClose = true; if (win) win.close(); });
