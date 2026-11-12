// Génère build/icon.ico (16, 24, 32, 48, 64, 128, 256) et build/icon-512.png en rasterisant le logo avec Electron.
// Tailles <= 32 px : version allégée (build/logo-small.svg : 2 feuilles fantômes, traits épais) ; à partir de 48 px : build/logo.svg.
// Usage : npx electron scripts/make-icon.js [--preview dossier]   (--preview écrit aussi chaque taille en PNG)
// Aucune dépendance supplémentaire : l'ICO est assemblé à la main (entrées PNG).
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const build = path.join(__dirname, '..', 'build');
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const SMALL_MAX = 32;
const previewIdx = process.argv.indexOf('--preview');
const previewDir = previewIdx > 0 ? process.argv[previewIdx + 1] : null;

// Une seule fenêtre hors-écran réutilisée pour toutes les rasterisations.
let win = null;
async function rasterize(svgFile, big) {
  const svg = fs.readFileSync(path.join(build, svgFile), 'utf8');
  const uri = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  if (!win) {
    win = new BrowserWindow({
      show: false, width: big, height: big, useContentSize: true, transparent: true, frame: false,
      webPreferences: { offscreen: true },
    });
    const html = `<html><body style="margin:0;background:transparent;overflow:hidden"><img id="i" style="width:${big}px;height:${big}px;display:block"></body></html>`;
    await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
  }
  await win.webContents.executeJavaScript(`new Promise((res, rej) => { const i = document.getElementById('i'); i.onload = () => res(); i.onerror = () => rej(new Error('image')); i.src = ${JSON.stringify(uri)}; })`);
  await new Promise((r) => setTimeout(r, 500));
  return win.webContents.capturePage({ x: 0, y: 0, width: big, height: big });
}

async function main() {
  const full = await rasterize('logo.svg', 1024);
  const small = await rasterize('logo-small.svg', 1024);
  const png = (n) => (n <= SMALL_MAX ? small : full).resize({ width: n, height: n, quality: 'best' }).toPNG();

  const images = SIZES.map(png);
  if (previewDir) {
    fs.mkdirSync(previewDir, { recursive: true });
    SIZES.forEach((s, i) => fs.writeFileSync(path.join(previewDir, `icon-${s}.png`), images[i]));
  }
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(SIZES.length, 4);
  let offset = 6 + 16 * SIZES.length;
  const entries = SIZES.map((s, i) => {
    const e = Buffer.alloc(16);
    e[0] = s === 256 ? 0 : s;
    e[1] = s === 256 ? 0 : s;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(images[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += images[i].length;
    return e;
  });
  fs.writeFileSync(path.join(build, 'icon.ico'), Buffer.concat([header, ...entries, ...images]));
  fs.writeFileSync(path.join(build, 'icon-512.png'), png(512));
  console.log('build/icon.ico et build/icon-512.png générés.');
}

app.whenReady().then(main).then(() => app.quit()).catch((e) => { console.error(e); app.exit(1); });
