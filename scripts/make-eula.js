// Page de licence de l'installeur (NSIS) : écrit build/eula.txt (texte brut UTF-8 avec BOM) à partir de EULA.fr.md.
// Appelé par « npm run dist » ; build/eula.txt est généré (ignoré par git). Usage : node scripts/make-eula.js
const fs = require('fs');
const path = require('path');

// Markdown → texte brut lisible dans la boîte de licence : titres, gras, citations et liens simplifiés, lignes conservées.
function toText(md) {
  return md.split(/\r?\n/).map((l) => l
    .replace(/^#{1,6}\s*/, '')
    .replace(/^>\s?/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')).join('\r\n').replace(/(\r\n){3,}/g, '\r\n\r\n').trim() + '\r\n';
}

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const text = toText(fs.readFileSync(path.join(root, 'EULA.fr.md'), 'utf8'));
  fs.writeFileSync(path.join(root, 'build', 'eula.txt'), '﻿' + text, 'utf8');
  console.log('Écrit : build/eula.txt');
}

module.exports = { toText };
