// Recherche de données personnelles ou professionnelles avant publication (lecture seule, ne modifie rien).
// Motifs GÉNÉRIQUES intégrés (e-mails, téléphones, adresses IP, chemins de lecteur et UNC, dossiers d'utilisateur, domaines internes) +
// motifs PRIVÉS lus dans un fichier HORS du dépôt (noms réels : jamais écrits dans le dépôt). Une ligne par motif : texte littéral (casse
// ignorée) ou « re:<expression régulière> ». Lignes vides et « # » ignorées.
// Usage :
//   node scripts/scan-private.js --patterns <fichier> [--tree <dépôt>] [--history <dépôt>] [--dir <dossier>]... [--asar <app.asar>]
//                                [--exe <fichier.exe>] [--json <sortie.json>]
//   --tree    : fichiers suivis par git (texte ligne par ligne ; images : métadonnées EXIF / XMP / PNG tEXt)
//   --history : git log -p --all (contenu de chaque version) + auteurs, e-mails et messages des commits
//   --dir     : tous les fichiers d'un dossier (ex. installeur extrait) ; --asar : contenu d'une archive app.asar (extraite en temporaire)
//   --exe     : propriétés de version de l'exécutable (société, copyright, description…)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const argv = process.argv.slice(2);
const many = (k) => argv.reduce((a, v, i) => (v === k && argv[i + 1] ? a.concat(argv[i + 1]) : a), []);
const one = (k) => many(k)[0];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const GENERIC = [
  ['e-mail', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g],
  ['téléphone', /(?:\+33\s?|\b0)[1-9](?:[ .-]?\d{2}){4}\b/g],
  ['adresse IP', /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g],
  ['chemin UNC', /\\\\{1,2}(?!\\)[A-Za-z0-9][A-Za-z0-9_.-]*\\{1,2}[A-Za-z0-9_$ .-]+/g],
  ['lecteur D:/P:/autre', /\b[ABD-Z]:[\\/]/g],
  ['dossier utilisateur', /C:[\\/]{1,2}Users[\\/]{1,2}[^\\/\s"'`]+/gi],
  ['domaine interne', /\b[a-z0-9-]+\.(?:local|lan|intra|internal|corp|priv)\b/gi],
];

function loadPrivate(file) {
  if (!file || !fs.existsSync(file)) { console.error('Fichier de motifs privés introuvable : ' + file); process.exit(2); }
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => (l.startsWith('re:') ? ['privé', new RegExp(l.slice(3), 'gi'), l.slice(3)] : ['privé', new RegExp(esc(l), 'gi'), l]));
}
const PRIVATE = loadPrivate(one('--patterns'));
const hits = [];
function scanText(source, where, text, opts = {}) {
  const lines = text.split(/\r?\n/);
  const pats = opts.privateOnly ? PRIVATE : PRIVATE.concat(GENERIC);
  lines.forEach((line, i) => {
    for (const [kind, re] of pats) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line))) {
        hits.push({ source, where: opts.noLine ? where : `${where}:${i + 1}`, kind, match: m[0], context: line.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40).trim() });
        if (!re.global) break;
      }
    }
  });
}
const isText = (buf) => !buf.subarray(0, 8000).includes(0);
const IMG = /\.(jpe?g|png|gif|webp|ico|tiff?)$/i;
// Métadonnées d'image : segments EXIF / XMP (JPEG) et blocs tEXt / iTXt / zTXt / eXIf (PNG), lus en texte latin1.
function imageMeta(buf) {
  const out = [];
  const s = buf.toString('latin1');
  for (const k of ['Exif\u0000\u0000', 'http://ns.adobe.com/xap', 'tEXt', 'iTXt', 'zTXt', 'eXIf']) {
    let i = s.indexOf(k);
    while (i >= 0 && out.length < 20) { out.push(s.slice(i, i + 300).replace(/[^\x20-\x7e\u00a0-\u00ff]+/g, ' ')); i = s.indexOf(k, i + 1); }
  }
  return out;
}
function scanFile(source, rel, abs, opts = {}) {
  let buf;
  try { buf = fs.readFileSync(abs); } catch { return; }
  if (IMG.test(rel)) {
    const meta = imageMeta(buf);
    if (meta.length) hits.push({ source, where: rel, kind: 'métadonnées image', match: 'EXIF/XMP/tEXt', context: meta.join(' | ').slice(0, 200) });
    meta.forEach((m) => scanText(source, rel + ' (métadonnées)', m, { noLine: true }));
    return;
  }
  if (isText(buf)) scanText(source, rel, buf.toString('utf8'), opts);
  else scanText(source, rel + ' (binaire)', buf.toString('latin1'), Object.assign({ privateOnly: true, noLine: true }, opts));
}
function walk(dir, base = dir, out = []) {
  for (const n of fs.readdirSync(dir)) { const p = path.join(dir, n); if (fs.statSync(p).isDirectory()) walk(p, base, out); else out.push(path.relative(base, p)); }
  return out;
}

for (const repo of many('--tree')) {
  const files = spawnSync('git', ['ls-files', '-z'], { cwd: repo, encoding: 'utf8' }).stdout.split('\0').filter(Boolean);
  for (const f of files) scanFile('fichiers suivis', f, path.join(repo, f));
}
for (const repo of many('--history')) {
  const meta = spawnSync('git', ['log', '--all', '--format=%H%x09%an%x09%ae%x09%cn%x09%ce%x09%s%x09%b%x1e'], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 30 }).stdout;
  for (const rec of meta.split('\x1e').map((r) => r.trim()).filter(Boolean)) { const [h, ...rest] = rec.split('\t'); scanText('historique (commits)', 'commit ' + h.slice(0, 7), rest.join(' | '), { noLine: true }); }
  const log = spawnSync('git', ['log', '--all', '-p', '--format=commit %h'], { cwd: repo, encoding: 'latin1', maxBuffer: 2 ** 31 - 1 }).stdout;
  let cur = '?', file = '?';
  const before = hits.length;
  for (const line of log.split('\n')) {
    if (line.startsWith('commit ')) { cur = line.slice(7, 14); continue; }
    if (line.startsWith('+++ b/')) { file = line.slice(6); continue; }
    if (line.startsWith('+') && !line.startsWith('+++')) scanText('historique (contenu)', `${cur} ${file}`, Buffer.from(line.slice(1), 'latin1').toString('utf8'), { noLine: true });
  }
  void before;
}
for (const dir of many('--dir')) for (const f of walk(dir)) scanFile('dossier ' + path.basename(dir), f, path.join(dir, f), { privateOnly: !/\.(js|json|html|css|md|txt|yml|yaml|nsh|xml)$/i.test(f) });
for (const asar of many('--asar')) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-asar-'));
  require(path.join(__dirname, '..', 'node_modules', '@electron', 'asar')).extractAll(asar, tmp);
  for (const f of walk(tmp)) scanFile('app.asar', f, path.join(tmp, f));
  fs.rmSync(tmp, { recursive: true, force: true });
}
for (const exe of many('--exe')) {
  const ps = `$v=(Get-Item -LiteralPath '${exe.split("'").join("''")}').VersionInfo; 'CompanyName='+$v.CompanyName; 'LegalCopyright='+$v.LegalCopyright; 'FileDescription='+$v.FileDescription; 'ProductName='+$v.ProductName; 'Comments='+$v.Comments; 'InternalName='+$v.InternalName; 'OriginalFilename='+$v.OriginalFilename; 'LegalTrademarks='+$v.LegalTrademarks`;
  const out = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' }).stdout;
  console.log(`Propriétés de ${path.basename(exe)} :\n  ` + out.trim().split(/\r?\n/).join('\n  '));
  scanText('propriétés exe', path.basename(exe), out, { noLine: true });
}

// Rapport : regroupé par motif et par source
const byKey = new Map();
for (const h of hits) { const k = `${h.kind}\t${h.match.toLowerCase()}`; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(h); }
console.log(`\n${hits.length} occurrence(s), ${byKey.size} motif(s) distinct(s)\n`);
for (const [k, list] of [...byKey.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const [kind, m] = k.split('\t');
  const srcs = [...new Set(list.map((h) => h.source))].join(', ');
  console.log(`[${kind}] « ${m} » : ${list.length} (${srcs})`);
  for (const h of list.slice(0, 6)) console.log(`    ${h.where} : ${h.context.slice(0, 140)}`);
  if (list.length > 6) console.log(`    … ${list.length - 6} autre(s)`);
}
if (one('--json')) fs.writeFileSync(one('--json'), JSON.stringify(hits, null, 1));
process.exit(0);
