// Teste l'application construite (dist/) : app dépaquetée, version portable, version installée (installation silencieuse dans
// un dossier temporaire, puis désinstallation). Lance les tests d'accueil sur chaque variante (+ mise en page sur l'app dépaquetée).
// Usage : npm run dist && node scripts/test-packaged.js
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const version = require('../package.json').version;
const dist = path.join(root, 'dist');
const node = process.execPath;
let failed = 0;

function run(label, exe, tests) {
  for (const t of tests) {
    console.log(`\n===== ${label} — ${t} =====`);
    const r = spawnSync(node, [path.join(root, 'test', t)], { stdio: 'inherit', env: Object.assign({}, process.env, { SPINADOC_EXE: exe }) });
    if (r.status !== 0) failed++;
  }
}

const unpacked = path.join(dist, 'win-unpacked', 'Spin A Doc.exe');
const portable = path.join(dist, `SpinADoc-Portable-${version}.exe`);
const setup = path.join(dist, `SpinADoc-Setup-${version}.exe`);
for (const f of [unpacked, portable, setup]) if (!fs.existsSync(f)) { console.error('Introuvable : ' + f + ' (lancez « npm run dist »)'); process.exit(2); }
// Garde : l'installeur de test a la même identité (appId) qu'une vraie installation ; sa désinstallation retirerait les raccourcis et la clé
// de désinstallation de l'installation de l'utilisateur. Si Spin A Doc est déjà installé sur ce compte, on refuse de lancer le test.
{
  const lnk = [path.join(process.env.USERPROFILE || '', 'Desktop', 'Spin A Doc.lnk'), path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Spin A Doc.lnk')].filter((p) => fs.existsSync(p));
  const unKey = String.fromCharCode(92);
  const q = spawnSync('reg', ['query', ['HKCU', 'Software', 'Microsoft', 'Windows', 'CurrentVersion', 'Uninstall'].join(unKey), '/s', '/f', 'Spin A Doc', '/d'], { encoding: 'utf8' });
  const registered = /Spin A Doc/.test(q.stdout || '');
  if (lnk.length || registered) {
    console.error('REFUS : Spin A Doc est déjà installé sur ce compte (' + [registered ? 'entrée de désinstallation' : '', ...lnk.map((p) => path.basename(path.dirname(p)) + '\\' + path.basename(p))].filter(Boolean).join(', ') +
      ').\nLa désinstallation de test les retirerait. Désinstallez Spin A Doc (Paramètres > Applications) puis relancez « npm run test:packaged ».');
    process.exit(3);
  }
}

run('app dépaquetée', unpacked, ['test-home-ui.js', 'test-layout-ui.js', 'test-stamps-ui.js', 'test-ocr-ui.js']);
run('portable', portable, ['test-home-ui.js']);

// Version installée : installation silencieuse (NSIS /S, /D= en dernier argument) dans un dossier temporaire, deux cycles :
//  1. tests sur la version installée, puis désinstallation SANS option : le dossier de données de test est conservé ;
//  2. réinstallation, puis désinstallation avec /DELETEDATA=1 : le dossier de données de test est supprimé.
// Le dossier de données de test (/DATADIR=, avec le fichier témoin .spinadoc-test exigé par l'installeur) remplace le profil réel, qui n'est
// jamais touché : son contenu est comparé avant / après. La désinstallation doit avoir retiré « Spin A Doc.exe » elle-même.
const dir = path.join(os.tmpdir(), 'spinadoc-installed');
const running = () => { const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq Spin A Doc.exe', '/NH'], { encoding: 'utf8' }); return /Spin A Doc\.exe/i.test(r.stdout || ''); };
const wait = (s) => spawnSync(node, ['-e', 'setTimeout(()=>{},' + s * 1000 + ')']);
const candidates = [dir, path.join(dir, 'Spin A Doc')];
const findInstalled = () => candidates.find((d) => fs.existsSync(path.join(d, 'Spin A Doc.exe')));
// Plantage sporadique de l'INSTALLEUR (le processus SpinADoc-Setup-x.y.z.exe lui-même ; code 0xC0000005 = violation d'accès) vu une fois en
// 0.12.0 au 1er essai ; NON reproduit en 40 installations silencieuses (enquête 5b : même fichier, empreinte unique = analyse antivirus
// « première vue », ordre exact de test:packaged, dossier fixe). Cause inconnue. Il n'est PAS masqué : chaque code non nul est décrit (code,
// durée, état du dossier, événements Application / Defender), ajouté au journal cumulatif test-logs/installer-crashes.log et rappelé en fin
// de rapport. Les processus lancés par Node héritent du mode « pas de rapport d'erreur » : leur plantage n'apparaît PAS dans l'Observateur
// d'événements (vérifié : rundll32 → DebugBreak, code 0x80000003, aucun événement 1000). Une seule relance, signalée.
const warnings = [];
const STATUS = { 0xC0000005: "violation d'accès", 0xC0000409: 'dépassement de tampon détecté', 0xC00000FD: 'dépassement de pile', 0x80000003: "point d'arrêt" };
const hex = (c) => '0x' + ((c >>> 0).toString(16).toUpperCase());
function eventsBetween(t0, t1) {
  const iso = (d) => d.toISOString();
  const cmd = "$s=[datetime]::Parse('" + iso(t0) + "').ToLocalTime().AddSeconds(-2);$t=[datetime]::Parse('" + iso(t1) + "').ToLocalTime().AddSeconds(5);" +
    "$a=Get-WinEvent -FilterHashtable @{LogName='Application';StartTime=$s;EndTime=$t} -EA SilentlyContinue | ?{ $_.Id -in 1000,1001,1002,1005,1026 };" +
    "$d=Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-Windows Defender/Operational';StartTime=$s;EndTime=$t} -EA SilentlyContinue | ?{ $_.Id -notin 1150,1151 };" +
    "@($a)+@($d) | ?{$_} | %{ $_.LogName + ' ' + $_.Id + ' : ' + (($_.Message -split [char]10 | select -first 4) -join ' / ') }";
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8' });
  return (r.stdout || '').trim() || 'aucun';
}
function reportCrash(what, exe, r, t0, t1, attempt) {
  const code = r.status == null ? -1 : r.status;
  const lines = [
    '!!!!! ' + what + ' : code ' + code + ' (' + hex(code) + (STATUS[code >>> 0] ? ' = ' + STATUS[code >>> 0] : '') + '), essai ' + attempt + ', ' + ((t1 - t0) / 1000).toFixed(1) + ' s',
    '      processus : ' + path.basename(exe) + ' (version ' + version + ') ; « Spin A Doc.exe » en cours : ' + running(),
    '      dossier cible : ' + (fs.existsSync(dir) ? fs.readdirSync(dir).length : 0) + ' élément(s), application ' + (findInstalled() ? 'présente' : 'absente') +
      ', désinstalleur ' + (fs.existsSync(path.join(dir, 'Uninstall Spin A Doc.exe')) ? 'présent' : 'absent'),
    '      événements (Application 1000/1001/1002/1005/1026, Defender hors 1150/1151) : ' + eventsBetween(t0, t1),
  ];
  lines.forEach((l) => console.log(l));
  fs.mkdirSync(path.join(root, 'test-logs'), { recursive: true });
  fs.appendFileSync(path.join(root, 'test-logs', 'installer-crashes.log'), new Date().toISOString() + '\n' + lines.join('\n') + '\n');
  warnings.push(what + ' : ' + hex(code) + " à l'essai " + attempt + ' (détails : test-logs/installer-crashes.log)');
}
function install() {
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('\nInstallation silencieuse dans ' + dir);
  for (let i = 0; i < 30 && running(); i++) wait(1);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const t0 = new Date();
    const r = spawnSync(setup, ['/S', '/D=' + dir], { stdio: 'inherit' });
    const t1 = new Date();
    console.log('Installeur : code de sortie ' + r.status + ' (essai ' + attempt + ', ' + ((t1 - t0) / 1000).toFixed(1) + ' s)');
    if (r.status !== 0) reportCrash('INSTALLEUR', setup, r, t0, t1, attempt);
    for (let i = 0; i < 45 && !findInstalled(); i++) wait(1);
    if (findInstalled()) break;
  }
  for (let i = 0; i < 60 && !findInstalled(); i++) wait(1); // l'installation peut finir après le retour du processus
  return findInstalled();
}
const realProfile = path.join(process.env.APPDATA || '', 'Spin A Doc');
const snapshot = () => (fs.existsSync(realProfile) ? fs.readdirSync(realProfile).sort().join('|') : '(absent)');
const fakeData = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'spinadoc-uninst-' + tag + '-')); fs.writeFileSync(path.join(d, '.spinadoc-test'), ''); fs.writeFileSync(path.join(d, 'settings.json'), '{}'); fs.mkdirSync(path.join(d, 'library')); return d; };
function uninstall(home, args) {
  const un = path.join(home, 'Uninstall Spin A Doc.exe');
  if (!fs.existsSync(un)) { console.error('Désinstalleur absent : ' + un); failed++; return false; }
  for (let i = 0; i < 30 && running(); i++) wait(1);
  const t0 = new Date();
  const r = spawnSync(un, ['/S', ...args, '_?=' + home], { stdio: 'inherit' });
  if (r.status !== 0) { reportCrash('DÉSINSTALLEUR', un, r, t0, new Date(), 1); failed++; }
  const gone = !fs.existsSync(path.join(home, 'Spin A Doc.exe'));
  console.log('Désinstallée (programme retiré par le désinstalleur) : ' + gone);
  if (!gone) failed++;
  return gone;
}
// Trace du registre et des raccourcis (lecture seule) : valeur par défaut de .pdf, « Ouvrir avec », clé de désinstallation, raccourcis.
const BS = String.fromCharCode(92); // barre oblique inverse (chemins du registre)
const key = (...parts) => parts.join(BS);
const regQuery = (k, extra) => { const r = spawnSync('reg', ['query', k, ...(extra || [])], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('HKEY_')).join(' ; ') : '(absent)'; };
function systemTrace(label) {
  const desk = path.join(process.env.USERPROFILE || '', 'Desktop', 'Spin A Doc.lnk');
  const start = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Spin A Doc.lnk');
  const un = spawnSync('reg', ['query', key('HKCU', 'Software', 'Microsoft', 'Windows', 'CurrentVersion', 'Uninstall'), '/s', '/f', 'Spin A Doc', '/d'], { encoding: 'utf8' });
  const t = { pdfDefault: regQuery(key('HKCU', 'Software', 'Classes', '.pdf'), ['/ve']), openWith: regQuery(key('HKCU', 'Software', 'Classes', '.pdf', 'OpenWithProgids')), uninstallKey: /Spin A Doc/.test(un.stdout || ''), desktopLnk: fs.existsSync(desk), startLnk: fs.existsSync(start),
    progId: regQuery(key('HKCU', 'Software', 'Classes', 'SpinADoc.pdf', 'shell', 'open', 'command'), ['/ve']), app: regQuery(key('HKCU', 'Software', 'Classes', 'Applications', 'Spin A Doc.exe', 'SupportedTypes')),
    registered: regQuery(key('HKCU', 'Software', 'RegisteredApplications'), ['/v', 'Spin A Doc']), caps: regQuery(key('HKCU', 'Software', 'SpinADoc', 'Capabilities', 'FileAssociations')) };
  console.log('Registre et raccourcis (' + label + ') : ' + JSON.stringify(t));
  return t;
}
const before = snapshot();
const sysBefore = systemTrace('avant installation');
let home = install();
if (home) {
  // Association 0.12.1 : « Ouvrir avec » seulement ; la valeur par défaut de HKCU\Software\Classes\.pdf ne doit PAS changer.
  const t = systemTrace('après installation');
  const exe = path.join(home, 'Spin A Doc.exe');
  const assoc = [
    ['valeur par défaut de .pdf inchangée', t.pdfDefault === sysBefore.pdfDefault],
    ['« Ouvrir avec » : SpinADoc.pdf ajouté, entrées existantes conservées', /SpinADoc\.pdf/.test(t.openWith) && sysBefore.openWith.split(' ; ').filter((l) => l !== '(absent)').every((l) => t.openWith.includes(l))],
    ['classe SpinADoc.pdf : commande = application installée "%1"', t.progId.includes('"' + exe + '" "%1"')],
    ['Applications\\Spin A Doc.exe : type .pdf', /\.pdf/.test(t.app)],
    ['RegisteredApplications + Capabilities (page « Applications par défaut »)', /SpinADoc/.test(t.registered) && /SpinADoc\.pdf/.test(t.caps)],
  ];
  for (const [n, ok] of assoc) { console.log('Association : ' + n + ' : ' + ok); if (!ok) failed++; }
}
if (!home) { console.error('Installation échouée : Spin A Doc.exe absent de ' + dir); failed++; }
else {
  run('installée', path.join(home, 'Spin A Doc.exe'), ['test-home-ui.js', 'test-ocr-ui.js']);
  const keep = fakeData('garde');
  uninstall(home, ['/DATADIR=' + keep]);
  const kept = fs.existsSync(path.join(keep, 'settings.json'));
  console.log('Sans option : données conservées : ' + kept);
  if (!kept) failed++;
  fs.rmSync(keep, { recursive: true, force: true });
  home = install();
  if (!home) { console.error('Réinstallation échouée'); failed++; }
  else {
    const del = fakeData('supprime');
    uninstall(home, ['/DELETEDATA=1', '/DATADIR=' + del]);
    const deleted = !fs.existsSync(del);
    console.log('Avec /DELETEDATA=1 : données supprimées : ' + deleted);
    if (!deleted) { failed++; fs.rmSync(del, { recursive: true, force: true }); }
  }
}
fs.rmSync(dir, { recursive: true, force: true });
const sysAfter = systemTrace('après désinstallation');
const same = ['pdfDefault', 'openWith', 'uninstallKey', 'desktopLnk', 'startLnk', 'progId', 'app', 'registered', 'caps'].every((k) => JSON.stringify(sysBefore[k]) === JSON.stringify(sysAfter[k]));
console.log("Registre et raccourcis revenus à l'état d'avant installation : " + same);
if (!same) failed++;
const after = snapshot();
console.log('Profil réel (' + realProfile.replace(process.env.USERPROFILE || '\u0000', '%USERPROFILE%') + ') inchangé : ' + (before === after));
if (before !== after) failed++;
if (warnings.length) console.log('\n!!!!! AVERTISSEMENT : relance après plantage (NON masqué) :\n' + warnings.map((w) => '  - ' + w).join('\n'));
console.log(failed ? `\n${failed} série(s) en échec.` : '\nOK : toutes les variantes empaquetées' + (warnings.length ? " (APRÈS RELANCE : voir l'avertissement ci-dessus)." : '.'));
process.exit(failed ? 1 : 0);
