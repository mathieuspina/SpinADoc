// Publication (logique, sans réseau ni binaire) : empreintes SHA-256 (format sha256sum, valeurs connues), notes de version extraites du
// CHANGELOG, CHANGELOG à jour pour la version de package.json, RELEASING.md complet, aucun binaire suivi par git, aucun nom réel connu.
// Usage : node test/test-release.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { sha256, writeSums, releaseFiles } = require('../scripts/checksums.js');
const { section, notes } = require('../scripts/release-notes.js');

const failures = [];
let passed = 0;
const check = (name, cond, detail) => { if (cond) { passed++; console.log('  ok   ', name); } else { failures.push(name); console.log('  ECHEC', name, detail !== undefined ? '→ ' + JSON.stringify(detail) : ''); } };
const root = path.join(__dirname, '..');
const version = require('../package.json').version;

// 1. Empreintes
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spinadoc-release-'));
fs.writeFileSync(path.join(tmp, 'a.exe'), 'abc');
fs.writeFileSync(path.join(tmp, 'b.exe'), Buffer.alloc(3 << 20, 7)); // > 1 Mo : lecture par blocs
check('SHA-256 de « abc » (valeur de référence)', sha256(path.join(tmp, 'a.exe')) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
const txt = writeSums(tmp, ['a.exe', 'b.exe']);
const lines = fs.readFileSync(path.join(tmp, 'SHA256SUMS.txt'), 'utf8').trim().split('\n');
check('SHA256SUMS.txt : une ligne « empreinte  nom » par fichier', lines.length === 2 && lines.every((l) => /^[0-9a-f]{64} {2}\S+\.exe$/.test(l)) && txt.endsWith('\n'), lines);
check('gros fichier lu par blocs = même empreinte que d\'un coup', lines[1].startsWith(require('crypto').createHash('sha256').update(fs.readFileSync(path.join(tmp, 'b.exe'))).digest('hex')));
check('fichiers de la Release : installeur et portable de la version', JSON.stringify(releaseFiles('1.2.3')) === JSON.stringify(['SpinADoc-Setup-1.2.3.exe', 'SpinADoc-Portable-1.2.3.exe']));
fs.rmSync(tmp, { recursive: true, force: true });

// 2. CHANGELOG et notes de version
const cl = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
check(`CHANGELOG : section de la version courante (${version})`, !!section(cl, version));
check('CHANGELOG : de 0.1.0 à la version courante, sans trou dans les versions publiées du dépôt', ['0.1.0', '0.2.0', '0.3.0', '0.4.0', '0.5.0', '0.6.0', '0.7.0', '0.8.0', '0.9.0', '0.10.0', '0.11.0', '0.12.0', '0.12.1', '0.12.2'].every((v) => !!section(cl, v)));
const n = notes(cl, version);
check('notes de version : section + installation + vérification des empreintes', n && n.includes(section(cl, version)) && n.includes(`SpinADoc-Setup-${version}.exe`) && n.includes('SHA256SUMS.txt') && n.includes('Get-FileHash'));
check('notes : version inconnue → null', notes(cl, '99.0.0') === null);

// 3. RELEASING.md
const rel = fs.readFileSync(path.join(root, 'RELEASING.md'), 'utf8');
const steps = ['npm version', 'npm test', 'npm run test:ui', 'npm run licences', 'npm run dist', 'npm run test:packaged', 'npm run test:update', 'npm run checksums', 'npm run release-notes', 'git tag -a', 'gh release create', '--draft', 'Mettre à jour un poste'];
check('RELEASING.md : toutes les étapes', steps.every((s) => rel.includes(s)), steps.filter((s) => !rel.includes(s)));
const pkg = require('../package.json');
check('package.json : scripts checksums, release-notes, test:update', ['checksums', 'release-notes', 'test:update'].every((s) => pkg.scripts[s]));

// 4. Dépôt : aucun binaire suivi, dist/ ignoré
const tracked = spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).stdout.split('\n');
check('git : aucun .exe / .msi / .7z suivi', !tracked.some((f) => /\.(exe|msi|7z|blockmap)$/i.test(f)), tracked.filter((f) => /\.(exe|msi|7z)$/i.test(f)));
check('git : dist/ ignoré', /^dist\/?$/m.test(fs.readFileSync(path.join(root, '.gitignore'), 'utf8')));

console.log(failures.length ? `\n${failures.length} échec(s) / ${passed + failures.length}` : `\nOK : ${passed} vérifications.`);
process.exit(failures.length ? 1 : 0);
