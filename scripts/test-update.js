// Mise à jour d'un poste : l'installeur de la NOUVELLE version lancé par-dessus l'ancienne (comme le fera un collègue) dans un dossier
// temporaire. Vérifie : programme remplacé (version du fichier), une seule entrée de désinstallation à la nouvelle version, profil de
// l'utilisateur conservé à l'octet près (réglages, récents, bibliothèque), réglages relus par la nouvelle version, profil réel inchangé,
// registre et raccourcis revenus à l'état initial après désinstallation. Aucune relance : un code non nul est un échec.
// Le profil utilisé est un dossier temporaire (SPINADOC_USER_DATA) : le vrai %APPDATA%\Spin A Doc n'est jamais lu ni écrit.
// Refus si Spin A Doc est déjà installé sur le compte (même identité que l'installeur de test : on ne touche pas à une vraie installation).
// Usage : node scripts/test-update.js [ancien-setup.exe]   (par défaut : l'installeur de version inférieure le plus récent dans dist/)
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp, sleep } = require('../test/lib/app.js');
const { makeAll } = require('../test/lib/make-pdfs.js');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const version = require('../package.json').version;
const newSetup = path.join(dist, `SpinADoc-Setup-${version}.exe`);
const vnum = (v) => v.split('.').map(Number).reduce((s, x) => s * 1000 + x, 0);
const failures = [];
let passed = 0;
const check = (name, cond, detail) => { if (cond) { passed++; console.log('  ok   ', name); } else { failures.push(name); console.log('  ECHEC', name, detail !== undefined ? '→ ' + JSON.stringify(detail) : ''); } };
const BS = String.fromCharCode(92);
const UNINST = ['HKCU', 'Software', 'Microsoft', 'Windows', 'CurrentVersion', 'Uninstall'].join(BS);
const lnks = [path.join(process.env.USERPROFILE || '', 'Desktop', 'Spin A Doc.lnk'), path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Spin A Doc.lnk')];
const ps = (cmd) => (spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8' }).stdout || '').trim();
// Entrées de désinstallation « Spin A Doc » : [{ version, location }]
const entries = () => { const o = ps(`Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' | % { $p = Get-ItemProperty $_.PSPath; if ($p.DisplayName -like 'Spin A Doc*') { $p.DisplayVersion + '|' + $p.InstallLocation } }`); return o ? o.split(/\r?\n/).map((l) => { const [v, loc] = l.split('|'); return { version: v, location: loc }; }) : []; };
const fileVersion = (exe) => ps(`(Get-Item -LiteralPath '${exe.split("'").join("''")}').VersionInfo.ProductVersion`);
// Empreinte d'un dossier (noms + contenus), pour comparer le profil avant / après.
function treeHash(dir) {
  const h = crypto.createHash('sha256');
  const walk = (d, rel) => { for (const n of fs.readdirSync(d).sort()) { const p = path.join(d, n); const r = rel + '/' + n; if (fs.statSync(p).isDirectory()) { h.update('D' + r); walk(p, r); } else { h.update('F' + r); h.update(fs.readFileSync(p)); } } };
  if (fs.existsSync(dir)) walk(dir, ''); else h.update('(absent)');
  return h.digest('hex');
}

(async () => {
  // Ancien installeur
  let oldSetup = process.argv[2] ? path.resolve(process.argv[2]) : null;
  if (!oldSetup) {
    const older = fs.readdirSync(dist).map((n) => /^SpinADoc-Setup-(\d+\.\d+\.\d+)\.exe$/.exec(n)).filter((m) => m && vnum(m[1]) < vnum(version)).sort((a, b) => vnum(b[1]) - vnum(a[1]));
    if (older.length) oldSetup = path.join(dist, older[0][0]);
  }
  if (!fs.existsSync(newSetup) || !oldSetup || !fs.existsSync(oldSetup)) { console.error('Il faut dist/SpinADoc-Setup-' + version + '.exe et un installeur de version inférieure (argument ou dist/).'); process.exit(2); }
  const oldVersion = /(\d+\.\d+\.\d+)/.exec(path.basename(oldSetup))[1];
  // Garde : aucune vraie installation sur ce compte
  const pre = entries();
  if (pre.length || lnks.some((p) => fs.existsSync(p))) { console.error('REFUS : Spin A Doc est déjà installé sur ce compte (entrée de désinstallation ou raccourci) ; la mise à jour de test la toucherait.'); process.exit(3); }
  const realProfile = path.join(process.env.APPDATA || '', 'Spin A Doc');
  const realBefore = treeHash(realProfile);
  const dir = path.join(os.tmpdir(), 'spinadoc-update-test');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'spinadoc-update-profile-'));
  fs.rmSync(dir, { recursive: true, force: true });
  const f = await makeAll(path.join(os.tmpdir(), 'spinadoc-ui-pdfs'));
  const exe = path.join(dir, 'Spin A Doc.exe');
  console.log(`Mise à jour ${oldVersion} → ${version} dans ${dir}`);
  try {
    // 1. Ancienne version installée, utilisée : un réglage, un document récent, un élément de bibliothèque
    let r = spawnSync(oldSetup, ['/S', '/D=' + dir], { stdio: 'inherit' });
    check(`installation ${oldVersion} : code 0`, r.status === 0, r.status);
    for (let i = 0; i < 45 && !fs.existsSync(exe); i++) await sleep(1000);
    check(`programme ${oldVersion} installé (version du fichier)`, fs.existsSync(exe) && fileVersion(exe).startsWith(oldVersion), fs.existsSync(exe) && fileVersion(exe));
    let c = await launchApp({ exe, files: [f.a], env: { SPINADOC_USER_DATA: profile } });
    try {
      await c.waitFor(`document.querySelectorAll('.docview.active canvas').length>0`, 20000);
      await c.ev(`window.spinadoc.setSettings({ updateProbe: 'réglage conservé 42', zoomStep: 25 })`);
      fs.mkdirSync(path.join(profile, 'library'), { recursive: true });
      fs.writeFileSync(path.join(profile, 'library', 'tampon-exemple.json'), JSON.stringify({ name: 'Tampon exemple', text: 'VU' }));
      await sleep(500);
    } finally { await c.close(); }
    const before = treeHash(profile);
    check('profil de test rempli (réglages, récents, bibliothèque)', ['settings.json', 'recents.json', 'library'].every((n) => fs.existsSync(path.join(profile, n))), fs.readdirSync(profile));

    // 2. Nouvel installeur par-dessus (aucune désinstallation préalable)
    const t0 = Date.now();
    r = spawnSync(newSetup, ['/S', '/D=' + dir], { stdio: 'inherit' });
    console.log(`     installeur ${version} par-dessus : code ${r.status}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    check(`mise à jour ${version} : code 0 (aucune relance)`, r.status === 0, r.status);
    let v = '';
    for (let i = 0; i < 60 && !v.startsWith(version); i++) { await sleep(1000); v = fs.existsSync(exe) ? fileVersion(exe) : ''; }
    check(`programme remplacé par ${version} (version du fichier)`, v.startsWith(version), v);
    const e = entries();
    check(`une seule entrée de désinstallation, en version ${version}`, e.length === 1 && e[0].version === version, e);
    check('profil conservé à l\'octet près par la mise à jour', treeHash(profile) === before);

    // 3. La nouvelle version relit les réglages
    c = await launchApp({ exe, files: [f.b], env: { SPINADOC_USER_DATA: profile } });
    try {
      await c.waitFor(`document.querySelectorAll('.docview.active canvas').length>0`, 20000);
      const s = JSON.parse(await c.ev(`window.spinadoc.getSettings().then(JSON.stringify)`));
      check('réglages relus par la nouvelle version', s.updateProbe === 'réglage conservé 42' && s.zoomStep === 25, s);
      const rec = JSON.parse(await c.ev(`window.spinadoc.listRecents().then(JSON.stringify)`));
      check('document récent de l\'ancienne version toujours listé', JSON.stringify(rec).includes(path.basename(f.a)), rec);
      const about = JSON.parse(await c.ev(`window.spinadoc.getAbout().then(JSON.stringify)`));
      check(`À propos : version ${version}`, about && about.version === version, about && about.version);
      check('aucune erreur JavaScript', c.logs.length === 0, c.logs);
    } finally { await c.close(); }
    check('bibliothèque conservée', fs.existsSync(path.join(profile, 'library', 'tampon-exemple.json')));
  } catch (err) {
    check('exécution sans exception', false, String(err && err.stack || err));
  } finally {
    // 4. Désinstallation (données conservées : profil de test supprimé ensuite par le script)
    const un = path.join(dir, 'Uninstall Spin A Doc.exe');
    if (fs.existsSync(un)) { const u = spawnSync(un, ['/S', '_?=' + dir], { stdio: 'inherit' }); check('désinstallation : code 0', u.status === 0, u.status); }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(profile, { recursive: true, force: true });
    check('registre et raccourcis revenus à l\'état initial', entries().length === 0 && !lnks.some((p) => fs.existsSync(p)), { entries: entries(), lnk: lnks.filter((p) => fs.existsSync(p)) });
    check('profil réel %APPDATA%\\Spin A Doc inchangé', treeHash(realProfile) === realBefore);
  }
  console.log(failures.length ? `\n${failures.length} échec(s) / ${passed + failures.length}` : `\nOK : mise à jour (${passed} vérifications).`);
  process.exit(failures.length ? 1 : 0);
})();
