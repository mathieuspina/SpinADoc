// Lance un script de test en arrière-plan (processus détaché) et écrit sa sortie dans test-logs/<nom>.log.
// Usage : node scripts/bg.js test/test-measure-ui.js   → affiche le chemin du journal ; lire le journal ensuite (fin de fichier).
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const script = process.argv[2];
if (!script) { console.error('Usage : node scripts/bg.js <script> [args]'); process.exit(2); }
const dir = path.join(__dirname, '..', 'test-logs');
fs.mkdirSync(dir, { recursive: true });
const log = path.join(dir, path.basename(script, '.js') + '.log');
const out = fs.openSync(log, 'w');
const child = spawn(process.execPath, [script, ...process.argv.slice(3)], { cwd: path.join(__dirname, '..'), detached: true, stdio: ['ignore', out, out], env: Object.assign({ SPIN_TEST_HEADLESS: '1' }, process.env) });
child.unref();
console.log('Lancé en arrière-plan (pid ' + child.pid + ') → ' + log);
