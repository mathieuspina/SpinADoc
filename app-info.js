// Processus principal : garde réseau, informations « À propos » et diagnostic.
//  - installNetGuard : toute requête http(s) / ws(s) / ftp de la session est BLOQUÉE et comptée (l'application est 100 % hors-ligne ; ce
//    compteur prouve qu'aucune donnée n'est envoyée). Seuls les schémas locaux (file, data, blob, devtools, chrome-extension) passent.
//  - about : nom, version, date de build (build-info.json écrit par scripts/build-info.js avant electron-builder), licences tierces.
//  - diagnostic : version, Windows, mémoire, écrans (résolution, mise à l'échelle), noms des imprimantes. AUCUN nom de fichier, chemin ni
//    contenu de document ; le nom d'utilisateur Windows est masqué s'il apparaît dans un nom d'imprimante.
const fs = require('fs');
const os = require('os');
const path = require('path');

const net = { blocked: 0, schemes: {} };
const LOCAL = /^(file|data|blob|devtools|chrome-extension|chrome|about):/i;
function installNetGuard(session) {
  session.webRequest.onBeforeRequest((d, cb) => {
    if (LOCAL.test(d.url)) { cb({}); return; }
    const scheme = (/^([a-z][a-z0-9+.-]*):/i.exec(d.url) || [])[1] || '?';
    net.blocked++; net.schemes[scheme] = (net.schemes[scheme] || 0) + 1;
    cb({ cancel: true });
  });
}
const netStats = () => ({ blocked: net.blocked, schemes: Object.assign({}, net.schemes) });

function buildInfo(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'build-info.json'), 'utf8')); } catch { return null; }
}

function about(app, dir) {
  let licenses = '';
  try { licenses = fs.readFileSync(path.join(dir, 'THIRD_PARTY_LICENSES'), 'utf8'); } catch { licenses = 'Fichier THIRD_PARTY_LICENSES introuvable.'; }
  const b = buildInfo(dir);
  const year = b && b.date ? b.date.slice(0, 4) : String(new Date().getFullYear());
  return {
    name: 'Spin A Doc', version: app.getVersion(), buildDate: b && b.date ? b.date : null,
    copyright: `© ${year} SpinASoft. Tous droits réservés.`, licenses, net: netStats(),
  };
}

// Version de Windows lisible (numéro de build → 10 / 11).
function windowsName() {
  const r = os.release(); // ex. 10.0.22631
  const build = Number(r.split('.')[2] || 0);
  const v = typeof os.version === 'function' ? os.version() : 'Windows';
  return `${v.replace(/\s+/g, ' ').trim()} (${r}${build >= 22000 ? ', Windows 11' : build ? ', Windows 10' : ''})`;
}

async function diagnostic(app, screen, webContents, dir) {
  const b = buildInfo(dir);
  const gib = (n) => (n / 1024 ** 3).toFixed(1).replace('.', ',') + ' Go';
  const displays = screen.getAllDisplays().map((d, i) => `  écran ${i + 1} : ${d.size.width} × ${d.size.height} px, mise à l'échelle ${Math.round(d.scaleFactor * 100)} %${d.id === screen.getPrimaryDisplay().id ? ' (principal)' : ''}`);
  let printers = [];
  try { printers = (await webContents.getPrintersAsync()).map((p) => p.name); } catch { printers = []; }
  const user = (() => { try { return os.userInfo().username; } catch { return ''; } })();
  const mask = (s) => (user && user.length > 2 ? s.split(user).join('<utilisateur>') : s);
  const lines = [
    'Spin A Doc — informations de diagnostic',
    `Version : ${app.getVersion()}${b && b.date ? ' (build du ' + b.date + ')' : ' (développement)'}`,
    `Electron ${process.versions.electron}, Chromium ${process.versions.chrome}, Node ${process.versions.node}`,
    `Système : ${windowsName()}, ${os.arch()}`,
    `Processeur : ${os.cpus().length} cœurs`,
    `Mémoire : ${gib(os.totalmem())} au total, ${gib(os.freemem())} libres`,
    `Mémoire de l'application : ${Math.round(process.memoryUsage().rss / 1024 ** 2)} Mo`,
    'Écrans :', ...displays,
    `Imprimantes (${printers.length}) :`, ...printers.map((p) => '  ' + mask(p)),
    `Requêtes réseau bloquées depuis le démarrage : ${net.blocked}`,
  ];
  return lines.join('\n');
}

module.exports = { installNetGuard, netStats, about, diagnostic };
