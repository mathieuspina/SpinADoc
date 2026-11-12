// Copie les fichiers tiers nécessaires dans vendor/ et src/ (chargés en local, aucun CDN).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const vendor = path.join(root, 'vendor');
const nm = path.join(root, 'node_modules');

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name);
    const d = path.join(to, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

const pdfjs = path.join(nm, 'pdfjs-dist');
const pdflib = path.join(nm, '@cantoo', 'pdf-lib');
const inter = path.join(nm, '@fontsource', 'inter');
const lucide = path.join(nm, 'lucide-static');

if (![pdfjs, pdflib, inter, lucide].every((p) => fs.existsSync(p))) {
  console.error('copy-vendor : dépendances absentes, lancez « npm install » d\'abord.');
  process.exit(1);
}

fs.rmSync(vendor, { recursive: true, force: true });

// PDF.js + pdf-lib
copyFile(path.join(pdfjs, 'build', 'pdf.mjs'), path.join(vendor, 'pdfjs', 'pdf.mjs'));
copyFile(path.join(pdfjs, 'build', 'pdf.worker.mjs'), path.join(vendor, 'pdfjs', 'pdf.worker.mjs'));
copyDir(path.join(pdfjs, 'cmaps'), path.join(vendor, 'pdfjs', 'cmaps'));
copyDir(path.join(pdfjs, 'standard_fonts'), path.join(vendor, 'pdfjs', 'standard_fonts'));
copyFile(path.join(pdflib, 'dist', 'pdf-lib.min.js'), path.join(vendor, 'pdf-lib', 'pdf-lib.min.js'));
copyFile(path.join(pdfjs, 'LICENSE'), path.join(vendor, 'pdfjs', 'LICENSE'));
copyFile(path.join(pdflib, 'LICENSE.md'), path.join(vendor, 'pdf-lib', 'LICENSE.md'));

// Police Inter (OFL) : sous-ensemble latin, 4 graisses
for (const w of [400, 500, 600, 700]) {
  const f = `inter-latin-${w}-normal.woff2`;
  copyFile(path.join(inter, 'files', f), path.join(vendor, 'fonts', f));
}
copyFile(path.join(inter, 'LICENSE'), path.join(vendor, 'fonts', 'LICENSE-Inter-OFL.txt'));
// OCR hors ligne (Apache-2.0) : tesseract.js (bibliothèque + worker), tesseract.js-core (WASM avec SIMD, moteur LSTM seul), données de langue
// français et anglais (tessdata_best, entiers : @tesseract.js-data, Apache-2.0). Tout est chargé depuis vendor/tesseract/ (aucun téléchargement).
{
  const tj = path.join(nm, 'tesseract.js'), core = path.join(nm, 'tesseract.js-core');
  const out = path.join(vendor, 'tesseract');
  copyFile(path.join(tj, 'dist', 'tesseract.esm.min.js'), path.join(out, 'tesseract.esm.min.js'));
  copyFile(path.join(tj, 'dist', 'worker.min.js'), path.join(out, 'worker.min.js'));
  copyFile(path.join(tj, 'LICENSE.md'), path.join(out, 'LICENSE-tesseract.js.txt'));
  for (const n of ['tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js']) copyFile(path.join(core, n), path.join(out, 'core', n));
  copyFile(path.join(core, 'LICENSE'), path.join(out, 'LICENSE-tesseract.js-core.txt'));
  for (const l of ['eng', 'fra']) copyFile(path.join(nm, '@tesseract.js-data', l, '4.0.0_best_int', l + '.traineddata.gz'), path.join(out, 'lang', l + '.traineddata.gz'));
  fs.writeFileSync(path.join(out, "LICENSE-tessdata.txt"), "Donnees de langue Tesseract (tessdata_best, entiers), anglais et francais : licence Apache 2.0 (texte ci-dessous, identique a celui de tesseract.js-core). Paquets npm @tesseract.js-data/eng et fra (MIT pour emballage).\n\n" + fs.readFileSync(path.join(core, "LICENSE"), "utf8"));
}

// Polices manuscrites des signatures tapées (OFL) : Caveat, Dancing Script, Homemade Apple
for (const [pkg, files] of [['caveat', ['caveat-latin-700-normal.woff2']], ['dancing-script', ['dancing-script-latin-700-normal.woff2']], ['homemade-apple', ['homemade-apple-latin-400-normal.woff2']]]) {
  const dir = path.join(nm, '@fontsource', pkg);
  for (const f of files) copyFile(path.join(dir, 'files', f), path.join(vendor, 'fonts', f));
  copyFile(path.join(dir, 'LICENSE'), path.join(vendor, 'fonts', 'LICENSE-' + pkg + '-OFL.txt'));
}

// Icônes Lucide (ISC) : uniquement celles utilisées, dans src/icons/
const ICONS = [
  'folder-open', 'clock', 'save', 'mouse-pointer-2', 'search', 'type', 'text-cursor-input', 'settings',
  'zoom-in', 'zoom-out', 'maximize', 'unfold-horizontal', 'columns-2', 'square', 'rotate-cw', 'rotate-ccw',
  'fullscreen', 'panel-left', 'undo-2', 'redo-2', 'chevron-up', 'chevron-down', 'chevron-right', 'chevron-left',
  'plus', 'x', 'file-text', 'layers', 'trash-2', 'layout-grid', 'list', 'bookmark', 'gallery-vertical',
  'minus', 'file', 'copy-plus', 'scan-line',
  'slash', 'move-up-right', 'circle', 'pentagon', 'activity', 'cloud', 'pencil', 'eraser', 'highlighter', 'underline',
  'sticky-note', 'stamp', 'image', 'signature',
  'pin', 'strikethrough', 'brush', 'copy', 'clipboard-paste', 'bring-to-front', 'send-to-back', 'sliders-horizontal', 'message-square-text',
  'ruler', 'ruler-dimension-line', 'triangle-right', 'magnet', 'table-2', 'file-down', 'lock', 'lock-open', 'scaling', 'square-minus', 'diameter', 'crosshair', 'printer',
  'file-plus', 'file-input', 'files', 'file-output', 'crop', 'split', 'list-ordered', 'eye', 'file-image', 'info',
  'git-compare', 'scan-text', 'arrow-left', 'arrow-right', 'arrow-up', 'arrow-down',
  'circle-help', 'square-check', 'circle-dot', 'calendar', 'form-input', 'align-start-vertical', 'align-center-vertical', 'align-end-vertical',
  'align-start-horizontal', 'align-center-horizontal', 'align-end-horizontal',
];
const iconsDir = path.join(root, 'src', 'icons');
fs.rmSync(iconsDir, { recursive: true, force: true });
for (const n of ICONS) {
  const from = path.join(lucide, 'icons', n + '.svg');
  if (!fs.existsSync(from)) { console.error('Icône Lucide introuvable : ' + n); process.exit(1); }
  copyFile(from, path.join(iconsDir, n + '.svg'));
}
copyFile(path.join(lucide, 'LICENSE'), path.join(iconsDir, 'LICENSE-lucide.txt'));
// Feuille de style des icônes (masques), générée à partir de la liste ci-dessus.
fs.writeFileSync(
  path.join(iconsDir, 'icons.css'),
  '/* Généré par scripts/copy-vendor.js — ne pas modifier. Icônes Lucide (ISC). */\n' +
    ICONS.map((n) => `.ico[data-icon="${n}"]{-webkit-mask-image:url("${n}.svg");mask-image:url("${n}.svg")}`).join('\n') + '\n'
);

// Logo (source : build/)
for (const f of ['logo.svg', 'logo-mark.svg', 'logo-mark-small.svg']) {
  copyFile(path.join(root, 'build', f), path.join(root, 'src', 'assets', f));
}
console.log('vendor/, src/icons/ et src/assets/ mis à jour.');
