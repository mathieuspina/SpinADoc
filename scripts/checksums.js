// Empreintes SHA-256 de l'installeur et de la version portable : écrit dist/SHA256SUMS.txt (format de sha256sum : « empreinte  nom »),
// à joindre à la Release pour que chacun (collègues, service informatique) vérifie le fichier téléchargé :
//   PowerShell : Get-FileHash .\SpinADoc-Setup-x.y.z.exe -Algorithm SHA256   (comparer à la ligne du fichier)
// Usage : npm run checksums   (version de package.json ; les fichiers doivent exister dans dist/)
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function sha256(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(1 << 20);
  try { let n; while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n)); } finally { fs.closeSync(fd); }
  return h.digest('hex');
}

// Écrit <dir>/SHA256SUMS.txt pour les fichiers donnés (noms relatifs à dir) ; renvoie le texte.
function writeSums(dir, names) {
  const lines = names.map((n) => `${sha256(path.join(dir, n))}  ${n}`);
  const text = lines.join('\n') + '\n';
  fs.writeFileSync(path.join(dir, 'SHA256SUMS.txt'), text);
  return text;
}

const releaseFiles = (version) => [`SpinADoc-Setup-${version}.exe`, `SpinADoc-Portable-${version}.exe`];

if (require.main === module) {
  const version = require('../package.json').version;
  const dist = path.join(__dirname, '..', 'dist');
  const names = releaseFiles(version);
  const missing = names.filter((n) => !fs.existsSync(path.join(dist, n)));
  if (missing.length) { console.error('Introuvable dans dist/ : ' + missing.join(', ') + ' (lancez « npm run dist »)'); process.exit(2); }
  process.stdout.write(writeSums(dist, names));
  console.log('Écrit : dist/SHA256SUMS.txt');
}

module.exports = { sha256, writeSums, releaseFiles };
