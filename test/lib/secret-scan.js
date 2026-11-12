// Recherche d'une chaîne secrète dans les OCTETS d'un PDF : brut, et dans chaque flux décompressé (FlateDecode, y compris les flux d'objets),
// sous plusieurs encodages : latin-1, UTF-16 BE/LE (avec ou sans BOM), hexadécimal (majuscules/minuscules) du latin-1 et de l'UTF-16 BE.
// Renvoie la liste des endroits trouvés ([] = introuvable). Utilisé avec un témoin positif (le fichier d'origine DOIT être détecté).
const zlib = require('zlib');

function variants(secret) {
  const l1 = Buffer.from(secret, 'latin1');
  const be = Buffer.from(secret, 'utf16le').swap16();
  const le = Buffer.from(secret, 'utf16le');
  const hex = (b) => b.toString('hex');
  return [
    ['latin1', l1], ['utf16be', be], ['utf16le', le],
    ['hex', Buffer.from(hex(l1))], ['HEX', Buffer.from(hex(l1).toUpperCase())],
    ['hex-utf16be', Buffer.from(hex(be))], ['HEX-utf16be', Buffer.from(hex(be).toUpperCase())],
  ];
}

// Flux du fichier : contenu entre « stream » et « endstream ».
function streams(buf) {
  const out = [];
  let pos = 0;
  for (;;) {
    const s = buf.indexOf('stream', pos, 'latin1');
    if (s < 0) break;
    if (buf.slice(Math.max(0, s - 3), s).toString('latin1') === 'end') { pos = s + 6; continue; }
    let start = s + 6;
    if (buf[start] === 0x0d) start++;
    if (buf[start] === 0x0a) start++;
    const e = buf.indexOf('endstream', start, 'latin1');
    if (e < 0) break;
    out.push(buf.slice(start, e));
    pos = e + 9;
  }
  return out;
}

function inflate(b) {
  for (const f of [() => zlib.inflateSync(b), () => zlib.inflateSync(b, { finishFlush: zlib.constants.Z_SYNC_FLUSH }), () => zlib.inflateRawSync(b, { finishFlush: zlib.constants.Z_SYNC_FLUSH })]) {
    try { const r = f(); if (r && r.length) return r; } catch { /* essai suivant */ }
  }
  return null;
}

function scan(bytes, secret) {
  const buf = Buffer.from(bytes);
  const vs = variants(secret);
  const hits = [];
  const look = (b, where) => { for (const [name, v] of vs) if (b.indexOf(v) >= 0) hits.push(where + ':' + name); };
  look(buf, 'brut');
  let n = 0, inflated = 0;
  for (const s of streams(buf)) {
    n++;
    const d = inflate(s);
    if (!d) continue;
    inflated++;
    look(d, 'flux' + n);
  }
  return { hits, streams: n, inflated };
}

module.exports = { scan, streams, inflate };
