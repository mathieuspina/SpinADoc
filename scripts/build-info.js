// Écrit build-info.json (date de build, version) à la racine avant electron-builder (« npm run dist ») : affiché dans « À propos » et le diagnostic.
// Fichier généré, ignoré par git. En développement il est absent : « développement » est affiché.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const info = { version: pkg.version, date: new Date().toISOString().slice(0, 10) };
fs.writeFileSync(path.join(root, 'build-info.json'), JSON.stringify(info, null, 1) + '\n');
console.log('build-info.json : ' + info.version + ' du ' + info.date);
