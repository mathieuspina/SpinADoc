// Notes de version : extrait la section « ## x.y.z » de CHANGELOG.md et écrit dist/RELEASE-NOTES-x.y.z.md (texte de la Release GitHub),
// suivi de la vérification des empreintes. Usage : npm run release-notes   (version de package.json)
const fs = require('fs');
const path = require('path');

// Section de la version dans le texte du CHANGELOG (sans le titre), ou null.
function section(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const i = lines.findIndex((l) => l.startsWith('## ' + version + ' ') || l === '## ' + version);
  if (i < 0) return null;
  let j = i + 1;
  while (j < lines.length && !lines[j].startsWith('## ')) j++;
  return lines.slice(i + 1, j).join('\n').trim();
}

function notes(changelog, version) {
  const s = section(changelog, version);
  if (!s) return null;
  return `${s}\n\n### Installation\n- \`SpinADoc-Setup-${version}.exe\` : installeur par utilisateur, sans droits administrateur. Mise à jour : lancer le nouvel installeur par-dessus l'ancien (réglages et bibliothèque conservés).\n` +
    `- \`SpinADoc-Portable-${version}.exe\` : version portable, sans installation.\n\n### Vérifier le fichier téléchargé\nComparer à la ligne correspondante de \`SHA256SUMS.txt\` :\n\n\`\`\`powershell\nGet-FileHash .\\SpinADoc-Setup-${version}.exe -Algorithm SHA256\n\`\`\`\n\nFichiers non signés numériquement : SmartScreen peut afficher un avertissement (« Informations complémentaires » > « Exécuter quand même »).\n`;
}

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const version = require('../package.json').version;
  const text = notes(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), version);
  if (!text) { console.error(`CHANGELOG.md : aucune section « ## ${version} ».`); process.exit(2); }
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  const out = path.join(root, 'dist', `RELEASE-NOTES-${version}.md`);
  fs.writeFileSync(out, text);
  console.log('Écrit : ' + path.relative(root, out));
}

module.exports = { section, notes };
