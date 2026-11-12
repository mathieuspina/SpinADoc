// Mesures : calculs avec valeurs connues, échelle, unités, CSV (pur). Usage : node test/test-measure.js
const assert = require('assert');
const M = require('../src/measure.js');

const close = (a, b, tol = 1e-9) => assert(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);
const measure = (font, text, size) => text.length * size * 0.5; // largeur fictive suffisante pour les primitives

// --- unités et échelle
close(M.MM_PER_PT, 0.352777777778, 1e-9);
assert.strictEqual(M.fmtNum(5, 2), '5,00');
assert.strictEqual(M.fmtNum(-0.0001, 2), '0,00', 'pas de -0,00');
assert.strictEqual(M.fmtNum(1234.5678, 3), '1234,568');
// échelle 1:50 sur une page A3 : un trait de 100 mm sur le papier = 5 m
const pt100mm = 100 / M.MM_PER_PT; // 283,46 pt
const s50 = M.scaleFromRatio(50);
const ctx50 = { scales: { 0: s50 }, unit: 'm', precision: 2 };
const dist = { type: 'm-dist', page: 0, points: [[0, 0], [pt100mm, 0]] };
close(M.valuesOf(dist, ctx50).length, 5000, 1e-6);
assert.strictEqual(M.describe(dist, ctx50), '5,00 m');
assert.strictEqual(M.describe(dist, Object.assign({}, ctx50, { unit: 'cm' })), '500,00 cm');
assert.strictEqual(M.describe(dist, Object.assign({}, ctx50, { unit: 'mm', precision: 0 })), '5000 mm');
assert.strictEqual(M.describe(dist, { scales: {}, unit: 'mm', precision: 1 }), '100,0 mm *', 'sans échelle : papier 1:1 et étoile');
// changement d'échelle : les valeurs se recalculent
assert.strictEqual(M.describe(dist, { scales: { 0: M.scaleFromRatio(100) }, unit: 'm', precision: 2 }), '10,00 m');
// la page 1 n'a pas la même échelle que la page 0
assert.strictEqual(M.describe(Object.assign({}, dist, { page: 1 }), ctx50), '100,00 m *'.replace('100,00 m', '0,10 m'));
// calibrage par deux points : 200 pt mesurés = 6 m réels
const sc = M.scaleFromTwoPoints(200, 6, 'm');
close(sc.mmPerPt, 30, 1e-9);
assert.strictEqual(M.scaleLabel(M.scaleFromRatio(50)), '1:50');
assert.strictEqual(M.scaleLabel(sc).startsWith('≈ 1:'), true);
assert.strictEqual(M.scaleLabel(null), 'non définie');
assert.strictEqual(M.scaleFromTwoPoints(0, 5, 'm'), null);
// conversions sans dérive : toujours depuis le millimètre
let mm = 1234.5678;
for (let i = 0; i < 1000; i++) { mm = M.toMm(M.fromMm(mm, 'm'), 'm'); mm = M.toMm(M.fromMm(mm, 'cm'), 'cm'); }
close(mm, 1234.5678, 1e-6);
// --- surface : rectangle 10 m × 4 m à 1:100 → 40 m², périmètre 28 m
const k100 = 100 * M.MM_PER_PT; // mm par pt
const W = (10000 / k100), H = (4000 / k100);
const rect = { type: 'm-area', page: 0, points: [[0, 0], [W, 0], [W, H], [0, H]], holes: [] };
const ctx100 = { scales: { 0: M.scaleFromRatio(100) }, unit: 'm', precision: 2 };
const va = M.valuesOf(rect, ctx100);
close(va.area / 1e6, 40, 1e-6); close(va.perimeter / 1000, 28, 1e-9);
assert.strictEqual(M.describe(rect, ctx100), 'S = 40,00 m² · P = 28,00 m');
// trou 2 m × 2 m : 36 m², périmètre total 28 + 8 = 36 m
const sq = 2000 / k100;
const holed = Object.assign({}, rect, { holes: [[[1000 / k100, 1000 / k100], [1000 / k100 + sq, 1000 / k100], [1000 / k100 + sq, 1000 / k100 + sq], [1000 / k100, 1000 / k100 + sq]]] });
close(M.valuesOf(holed, ctx100).area / 1e6, 36, 1e-6); close(M.valuesOf(holed, ctx100).perimeter / 1000, 36, 1e-9);
assert.strictEqual(M.describe(rect, Object.assign({}, ctx100, { unit: 'cm', precision: 0 })), 'S = 400000 cm² · P = 2800 cm');
// --- angles
close(M.angleDeg([1, 0], [0, 0], [0, 1]), 90, 1e-9);
close(M.angleDeg([1, 0], [0, 0], [1, 1]), 45, 1e-9);
close(M.angleDeg([1, 0], [0, 0], [-1, 0]), 180, 1e-9);
assert.strictEqual(M.describe({ type: 'm-angle', page: 0, points: [[1, 0], [0, 0], [0, 1]] }, ctx100), '90,00°');
assert.strictEqual(M.describe({ type: 'm-angle', page: 0, points: [[1, 0], [0, 0], [1, 1]] }, { scales: {}, unit: 'm', precision: 0 }), '45°');
// --- cercle par 3 points, polyligne, centroïde
const cc = M.circumcircle([1, 0], [0, 1], [-1, 0]);
close(cc.cx, 0); close(cc.cy, 0); close(cc.r, 1);
assert.strictEqual(M.circumcircle([0, 0], [1, 1], [2, 2]), null);
const pl = { type: 'm-poly', page: 0, points: [[0, 0], [3, 0], [3, 4]] };
close(M.valuesOf(pl, { scales: {} }).length, 7 * M.MM_PER_PT, 1e-9);
assert.deepStrictEqual(M.valuesOf(pl, { scales: {} }).segments.map((x) => Math.round(x / M.MM_PER_PT)), [3, 4]);
const c = M.centroid([[0, 0], [4, 0], [4, 2], [0, 2]]); close(c[0], 2); close(c[1], 1);
// --- valeur verrouillée : ne suit plus l'échelle
const locked = Object.assign({}, dist, { lockedText: '5,00 m' });
assert.strictEqual(M.describe(locked, { scales: { 0: M.scaleFromRatio(200) }, unit: 'm', precision: 2 }), '5,00 m');
assert.strictEqual(M.describe(Object.assign({}, dist, { label: 'Mur A' }), ctx50), 'Mur A : 5,00 m');
// --- tableau, totaux, CSV
const rows = [M.rowOf(Object.assign({ id: 1 }, dist), ctx50), M.rowOf(Object.assign({ id: 2 }, rect), ctx100), M.rowOf(Object.assign({ id: 3, label: 'A; "B"' }, { type: 'm-angle', page: 2, points: [[1, 0], [0, 0], [0, 1]] }), ctx100)];
close(rows[0].value, 5); assert.strictEqual(rows[0].unit, 'm'); close(rows[1].value, 40); assert.strictEqual(rows[1].unit, 'm²'); assert.strictEqual(rows[2].unit, '°');
const tot = M.totalsByType(rows.concat([M.rowOf(Object.assign({ id: 4 }, dist), ctx50)]));
assert.strictEqual(tot.find((t) => t.typeId === undefined && t.type === 'Distance').count, 2);
close(tot.find((t) => t.type === 'Distance').total, 10);
const csv = M.toCsv(rows, 2);
assert.strictEqual(M.CSV_BOM, '﻿');
assert(csv.startsWith('Page;Type;Libellé;Valeur;Unité\r\n'), 'en-tête, séparateur point-virgule');
assert(csv.includes('1;Distance;;5,00;m\r\n'), 'virgule décimale : ' + csv);
assert(csv.includes('1;Surface;;40,00;m²'), 'unité m²');
assert(csv.includes('"A; ""B"""'), 'guillemets et point-virgule échappés');
assert(!csv.includes('.'), 'aucun séparateur décimal point');
// --- primitives (géométrie sanity)
const prim = (o, ctx) => M.primitives(Object.assign(M.defaultsFor(o.type), o), measure, ctx);
const pd = prim(dist, ctx50);
assert(pd.some((p) => p.kind === 'text' && p.text === '5,00 m') && pd.filter((p) => p.kind === 'path').length >= 4, 'distance : trait, 2 traits d\'extrémité, valeur');
assert(prim(Object.assign({}, dist, { showDelta: false, points: [[0, 0], [100, 50]] }), ctx50).every((p) => p.kind !== 'text' || !/^d[XY] /.test(p.text)));
assert(prim(Object.assign({}, dist, { showDelta: true, points: [[0, 0], [100, 50]] }), ctx50).filter((p) => p.kind === 'text' && /^d[XY] /.test(p.text)).length === 2, 'dX et dY');
const dim = prim({ type: 'm-dim', page: 0, points: [[0, 0], [pt100mm, 0]], offset: 30 }, ctx50);
assert(dim.filter((p) => p.kind === 'path' && p.fill && !p.stroke).length === 2, 'cote : deux flèches');
assert(dim.some((p) => p.kind === 'text' && p.text === '5,00 m' && p.y > 25), 'cote : valeur au-dessus du trait décalé');
assert(dim.filter((p) => p.kind === 'path' && p.stroke).length === 3, 'cote : 2 traits d\'attache + ligne de cote');
const pa = prim(holed, ctx100);
assert(pa.some((p) => p.fill && p.segs.filter((s) => s[0] === 'M').length === 2), 'surface avec trou : un seul tracé à 2 contours');
const ps = prim({ type: 'm-poly', page: 0, points: [[0, 0], [30, 0], [30, 40]], showSegments: true }, { scales: {}, unit: 'mm', precision: 0 });
assert(ps.filter((p) => p.kind === 'text').length === 3, 'polyligne : total + 2 segments');
const pc = prim({ type: 'm-circle', page: 0, points: [[1, 0], [0, 1], [-1, 0]].map((p) => [p[0] * 50, p[1] * 50]) }, { scales: {}, unit: 'mm', precision: 1 });
assert(pc.some((p) => p.kind === 'text' && /Ø 35,3 mm \* · R 17,6 mm \*|Ø/.test(p.text)), 'cercle : Ø et R');
// texte jamais à l'envers
const back = prim({ type: 'm-dist', page: 0, points: [[100, 0], [0, 0]] }, ctx50).find((p) => p.kind === 'text');
assert(back.rot > -90 && back.rot <= 90, 'texte lisible (angle ' + back.rot + ')');

console.log('OK : mesures (échelle, unités, surface, angle, cercle, CSV, primitives).');
