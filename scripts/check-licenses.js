// Vérifie les licences des dépendances de production (échec si GPL/AGPL/LGPL).
// Avec --generate : écrit aussi THIRD_PARTY_LICENSES à la racine.
const fs = require('fs');
const path = require('path');
const checker = require('license-checker');

const root = path.join(__dirname, '..');
const generate = process.argv.includes('--generate');
const FORBIDDEN = /(^|[^L])GPL|AGPL|LGPL/i;

checker.init({ start: root, production: true, excludePrivatePackages: true }, (err, pkgs) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  const bad = [];
  const entries = Object.entries(pkgs).sort(([a], [b]) => a.localeCompare(b));
  for (const [name, info] of entries) {
    const lic = [].concat(info.licenses).join(' ');
    // Une expression « (MIT OR GPL-3.0) » reste refusée : on reste strict.
    if (FORBIDDEN.test(lic)) bad.push(`${name} : ${lic}`);
  }

  console.log(`${entries.length} dépendance(s) de production analysée(s).`);
  entries.forEach(([n, i]) => console.log(`  ${n} — ${[].concat(i.licenses).join(', ')}`));

  if (generate) {
    let out = 'Spin A Doc — licences tierces\n';
    out += '================================\n\n';
    out += 'Spin A Doc embarque les composants suivants. Aucune licence copyleft (GPL/AGPL/LGPL).\n\n';
    out += '- Electron (MIT) — https://www.electronjs.org — Copyright (c) Electron contributors, GitHub Inc.\n';
    out += '  Les licences de Chromium et de ses composants sont fournies avec l\'application (LICENSES.chromium.html).\n';
    out += '- Données de langue de l\'OCR (français, anglais) : modèles « tessdata_best » du projet Tesseract OCR (Apache-2.0,\n';
    out += '  https://github.com/tesseract-ocr/tessdata_best), empaquetés par @tesseract.js-data (MIT, ci-dessous).\n';
    out += '- Polices Inter, Caveat, Dancing Script, Homemade Apple : SIL Open Font License 1.1 (paquets @fontsource ci-dessous).\n';
    out += '- Icônes Lucide : ISC (paquet lucide-static ci-dessous).\n\n';
    for (const [name, info] of entries) {
      out += '--------------------------------------------------------------------------------\n';
      out += `${name}\nLicence : ${[].concat(info.licenses).join(', ')}\n`;
      if (info.repository) out += `Dépôt : ${info.repository}\n`;
      if (info.publisher) out += `Auteur : ${info.publisher}\n`;
      out += '\n';
      if (info.licenseFile && fs.existsSync(info.licenseFile) && /licen[cs]e/i.test(path.basename(info.licenseFile))) {
        out += fs.readFileSync(info.licenseFile, 'utf8').trim() + '\n\n';
      }
    }
    fs.writeFileSync(path.join(root, 'THIRD_PARTY_LICENSES'), out, 'utf8');
    console.log('THIRD_PARTY_LICENSES écrit.');
  }

  if (bad.length) {
    console.error('\nLicence interdite détectée :\n  ' + bad.join('\n  '));
    process.exit(1);
  }
  console.log('OK : aucune licence GPL/AGPL/LGPL en production.');
});
