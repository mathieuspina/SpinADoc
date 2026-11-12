// Ruban (logique, lecture de src/index.html) : 7 onglets au plus, chaque onglet a son panneau, aucune commande perdue par rapport à la liste de
// référence d'avant le regroupement (test/lib/ribbon-before.json, 0.11.0), ids uniques. Imprime le tableau avant / après.
// Usage : node test/test-ribbon.js
const fs = require('fs');
const path = require('path');

const failures = [];
let passed = 0;
const check = (name, cond, detail) => { if (cond) { passed++; console.log('  ok   ', name); } else { failures.push(name); console.log('  ECHEC', name, detail !== undefined ? '→ ' + JSON.stringify(detail) : ''); } };

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
const before = require('./lib/ribbon-before.json');
const tabs = [...html.matchAll(/<button role="tab" id="rtab-([a-z]+)" aria-controls="rpanel-([a-z]+)"[^>]*>([^<]+)</g)].map((m) => ({ id: m[1], panel: m[2], label: m[3] }));
const after = {};
for (const t of tabs) {
  const start = html.indexOf(`id="rpanel-${t.id}"`);
  const next = html.indexOf('role="tabpanel"', start + 10);
  const chunk = start < 0 ? '' : html.slice(start, next < 0 ? undefined : next);
  after[t.id] = { label: t.label, found: start >= 0, cmds: [...new Set([...chunk.matchAll(/data-cmd="([a-z0-9-]+)"/g)].map((m) => m[1]))] };
}
check(`${tabs.length} onglets (7 au plus)`, tabs.length <= 7, tabs.map((t) => t.label));
check('chaque onglet pilote son panneau (aria-controls = rpanel-<id>)', tabs.every((t) => t.panel === t.id && after[t.id].found));
const where = {};
for (const [id, t] of Object.entries(after)) for (const c of t.cmds) (where[c] = where[c] || []).push(t.label);
const all = Object.values(before.tabs).flatMap((t) => t.cmds);
const lost = all.filter((c) => !where[c]);
check(`aucune commande perdue (${new Set(all).size} commandes de référence)`, lost.length === 0, lost);
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
check('ids uniques dans index.html', dup.length === 0, dup);

console.log('\nAvant → après (commandes qui changent d\'onglet) :');
for (const [id, t] of Object.entries(before.tabs)) for (const c of t.cmds) {
  const now = where[c] || [];
  if (!now.includes(t.label)) console.log(`  ${c} : ${t.label} → ${now.join(', ')}`);
}
console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
console.log('OK : ruban (regroupement sans perte).');
