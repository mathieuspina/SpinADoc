// Reproduction : N installations silencieuses (comme test:packaged) dans un dossier temporaire, désinstallation entre chaque.
// Usage : node scripts/repro-install.js <setup.exe> <N> <A|B|C|D> <journal>   (D = désinstallation puis réinstallation immédiate, voir seriesD)
//   A = même fichier à chaque fois ; B = copie à empreinte unique (octets ajoutés en fin de fichier) => analyse antivirus « première vue » ;
//   C = dossier fixe %TEMP%/spinadoc-installed (comme test:packaged). Relevé des processus en parallèle : scripts/watch-procs.ps1.
const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const [setupSrc, nStr, mode, logFile] = process.argv.slice(2);
const N = +nStr || 10;
const out = (s) => { fs.appendFileSync(logFile, s + '\n'); console.log(s); };
const wait = (ms) => spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},' + ms + ')']);
const running = (img) => /\.exe/i.test(spawnSync('tasklist', ['/FI', 'IMAGENAME eq ' + img, '/NH'], { encoding: 'utf8' }).stdout || '');
const ps = (cmd) => spawnSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).stdout.trim();
function events(t0, t1) {
  const f = (d) => d.toISOString();
  const cmd = `$s=[datetime]::Parse('${f(t0)}').ToLocalTime().AddSeconds(-2);$t=[datetime]::Parse('${f(t1)}').ToLocalTime().AddSeconds(5);` +
    `$a=Get-WinEvent -FilterHashtable @{LogName='Application';StartTime=$s;EndTime=$t} -EA SilentlyContinue | ?{ $_.Id -in 1000,1001,1002,1005,1026 };` +
    `$d=Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-Windows Defender/Operational';StartTime=$s;EndTime=$t} -EA SilentlyContinue | ?{ $_.Id -notin 1150,1151 };` +
    `$w=Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-WER-Diag/Operational';StartTime=$s;EndTime=$t} -EA SilentlyContinue;` +
    `@($a)+@($d)+@($w) | ?{$_} | %{ '  [' + $_.LogName + ' ' + $_.Id + ' ' + $_.TimeCreated.ToString('HH:mm:ss') + '] ' + (($_.Message -split "\`n" | select -first 8) -join ' / ') }`;
  return ps(cmd);
}
// Surveille l'apparition de « Spin A Doc.exe » pendant l'installation (application lancée à la fin ?)
function watchApp() {
  const w = spawn(process.execPath, ['-e', `const {spawnSync}=require('child_process');let seen=0;const t=setInterval(()=>{const o=spawnSync('tasklist',['/FI','IMAGENAME eq Spin A Doc.exe','/NH'],{encoding:'utf8'}).stdout||'';if(/Spin A Doc/i.test(o))seen++;},400);process.stdin.on('data',()=>{clearInterval(t);process.stdout.write(String(seen));process.exit(0);});`], { stdio: ['pipe', 'pipe', 'ignore'] });
  let buf = '';
  w.stdout.on('data', (d) => (buf += d));
  return { stop: () => new Promise((r) => { w.on('exit', () => r(+buf || 0)); w.stdin.write('x'); }) };
}
// Série D (motif vu en 0.12.2) : désinstallation puis RÉINSTALLATION IMMÉDIATE, N fois, dans le dossier fixe %TEMP%/spinadoc-installed, exactement
// comme test:packaged (stdio hérité, dossier vidé juste avant, attente que « Spin A Doc.exe » ne tourne plus, /DATADIR= d'un dossier témoin).
// Aucune relance : un code non nul est noté, puis une installation de RATTRAPAGE (comptée à part) remet l'application pour l'essai suivant.
// Refus si Spin A Doc est déjà installé sur le compte (même identité que l'installeur de test).
function seriesD() {
  const BS = String.fromCharCode(92);
  const q = spawnSync('reg', ['query', ['HKCU', 'Software', 'Microsoft', 'Windows', 'CurrentVersion', 'Uninstall'].join(BS), '/s', '/f', 'Spin A Doc', '/d'], { encoding: 'utf8' });
  const lnk = [path.join(process.env.USERPROFILE || '', 'Desktop', 'Spin A Doc.lnk'), path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Spin A Doc.lnk')].filter((p) => fs.existsSync(p));
  if (/Spin A Doc/.test(q.stdout || '') || lnk.length) { out('REFUS : Spin A Doc est installé sur ce compte (entrée de désinstallation ou raccourci) : série D non lancée.'); return; }
  const dir = path.join(os.tmpdir(), 'spinadoc-installed');
  const keep = fs.mkdtempSync(path.join(os.tmpdir(), 'spinadoc-uninst-repro-'));
  fs.writeFileSync(path.join(keep, '.spinadoc-test'), '');
  const hexOf = (c) => (c == null ? 'null' : '0x' + (c >>> 0).toString(16).toUpperCase());
  const install = (label) => {
    fs.rmSync(dir, { recursive: true, force: true });
    for (let k = 0; k < 30 && running('Spin A Doc.exe'); k++) wait(1000);
    const t0 = Date.now();
    const r = spawnSync(setupSrc, ['/S', '/D=' + dir], { stdio: 'inherit' });
    const ms = Date.now() - t0;
    let ok = fs.existsSync(path.join(dir, 'Spin A Doc.exe'));
    for (let k = 0; k < 45 && !ok && r.status === 0; k++) { wait(1000); ok = fs.existsSync(path.join(dir, 'Spin A Doc.exe')); }
    out(`${label} installeur : code ${r.status} (${hexOf(r.status)}), ${(ms / 1000).toFixed(1)} s, installé : ${ok}`);
    return { code: r.status, ok };
  };
  const uninstall = (label) => {
    const un = path.join(dir, 'Uninstall Spin A Doc.exe');
    for (let k = 0; k < 30 && running('Spin A Doc.exe'); k++) wait(1000);
    const t0 = Date.now();
    const u = spawnSync(un, ['/S', '/DATADIR=' + keep, '_?=' + dir], { stdio: 'inherit' });
    out(`${label} désinstalleur : code ${u.status} (${hexOf(u.status)}), ${((Date.now() - t0) / 1000).toFixed(1)} s, programme retiré : ${!fs.existsSync(path.join(dir, 'Spin A Doc.exe'))}`);
  };
  const t0 = new Date();
  out(`=== Série D : ${N} × (désinstallation → réinstallation immédiate) — ${t0.toISOString()} — ${path.basename(setupSrc)}`);
  let crashes = 0, rescue = 0;
  if (!install('#0 (installation initiale, non comptée)').ok) { out('Installation initiale impossible : série arrêtée.'); return; }
  for (let i = 1; i <= N; i++) {
    uninstall(`#${i}`);
    const r = install(`#${i}`);
    if (r.code !== 0) crashes++;
    if (!r.ok) { rescue++; install(`#${i} (rattrapage, non compté)`); }
  }
  uninstall('#fin');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(keep, { recursive: true, force: true });
  const ev = events(t0, new Date());
  out(ev ? `événements de la série :\n${ev}` : 'événements de la série : aucun (Application 1000/1001/1002/1005/1026, Defender hors 1150/1151, WER-Diag)');
  out(`=== Série D : ${crashes} code(s) non nul(s) de l'installeur sur ${N} réinstallations immédiates ; ${rescue} rattrapage(s)`);
}

(async () => {
  if (mode === 'D') { seriesD(); return; }
  out(`=== Série ${mode} : ${N} installations silencieuses — ${new Date().toISOString()} — ${path.basename(setupSrc)}`);
  let crashes = 0;
  for (let i = 1; i <= N; i++) {
    const dir = mode === 'C' ? path.join(os.tmpdir(), 'spinadoc-installed') : fs.mkdtempSync(path.join(os.tmpdir(), 'spinadoc-repro-'));
    if (mode === 'C') fs.rmSync(dir, { recursive: true, force: true });
    let setup = setupSrc;
    if (mode === 'B') {
      setup = path.join(os.tmpdir(), 'spinadoc-repro-setup-' + process.pid + '-' + i + '.exe');
      fs.copyFileSync(setupSrc, setup);
      fs.appendFileSync(setup, Buffer.from('SPINREPRO' + Date.now() + Math.random()));
    }
    for (let k = 0; k < 30 && running('Spin A Doc.exe'); k++) wait(1000);
    const watcher = watchApp();
    const t0 = new Date();
    const r = spawnSync(setup, ['/S', '/D=' + dir], { stdio: 'ignore' });
    const t1 = new Date();
    const appSeen = await watcher.stop();
    let installed = fs.existsSync(path.join(dir, 'Spin A Doc.exe'));
    for (let k = 0; k < 30 && !installed; k++) { wait(1000); installed = fs.existsSync(path.join(dir, 'Spin A Doc.exe')); }
    const code = r.status, hex = code == null ? String(r.signal || r.error) : '0x' + (code >>> 0).toString(16).toUpperCase();
    if (code !== 0) crashes++;
    out(`#${i} installeur : code ${code} (${hex}), ${((t1 - t0) / 1000).toFixed(1)} s, installé : ${installed}, application vue pendant l'installation : ${appSeen ? 'oui (' + appSeen + ')' : 'non'}`);
    // désinstallation silencieuse
    let ucode = '(pas de désinstalleur)', ut1 = new Date();
    const un = path.join(dir, 'Uninstall Spin A Doc.exe');
    if (fs.existsSync(un)) { const u = spawnSync(un, ['/S', '_?=' + dir], { stdio: 'ignore' }); ucode = u.status + ' (0x' + ((u.status >>> 0).toString(16).toUpperCase()) + ')'; ut1 = new Date(); }
    out(`#${i} désinstalleur : code ${ucode}`);
    const ev = events(t0, ut1);
    out(ev ? `#${i} événements :\n${ev}` : `#${i} événements : aucun (Application 1000/1001/1002/1005/1026, Defender hors 1150/1151, WER-Diag)`);
    fs.rmSync(dir, { recursive: true, force: true });
    if (mode === 'B') { try { fs.rmSync(setup, { force: true }); } catch (e) {} }
  }
  out(`=== Série ${mode} : ${crashes} code(s) non nul(s) sur ${N}`);
})();
