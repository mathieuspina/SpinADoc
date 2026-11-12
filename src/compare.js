// Comparaison de deux pages (logique pure, UMD : navigateur, Web Worker, Node).
// Images « d'encre » : Uint8Array w×h, 0 = blanc, 255 = noir (255 - luminance). Les deux pages sont rendues à la MÊME échelle (px par point PDF),
// donc 1 px = 25,4 / (72·k) mm sur les deux pages.
//  - align()    : translation de la page « nouvelle » sur l'« ancienne » (corrélation par FFT sur images réduites, puis affinage pixel par pixel) ;
//  - diffMaps() : classement de chaque pixel de la zone commune + regroupement des différences en zones numérotées ;
//  - tokenize() / diffWords() : comparaison des couches de texte (mots) ; defaultPairs() : correspondance des pages.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Compare = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Classes d'un pixel dans la carte de différences.
  const C = { NONE: 0, OLD: 1, NEW: 2, SAME: 3, OUT: 4, OUT_INK: 5 };
  const DEFAULTS = { thr: 40, tolMm: 0.5, gapMm: 4, minPx: 3 };
  const MAX_K = 4; // px par point : plafond pour les petites pages (≈ 288 dpi)
  const MM_PT = 25.4 / 72;

  // ---------------------------------------------------------------- résolution
  // k commun aux deux pages : le plus grand côté (des deux pages) ne dépasse pas maxSide px, l'aire de chaque page ne dépasse pas maxArea px.
  function planScale(sizes, maxSide, maxArea) {
    let k = MAX_K;
    for (const [w, h] of sizes) {
      if (!(w > 0 && h > 0)) continue;
      k = Math.min(k, maxSide / Math.max(w, h), Math.sqrt((maxArea || 1e9) / (w * h)));
    }
    return k;
  }
  const mmPerPx = (k) => MM_PT / k;
  const pxToMm = (px, k) => px * mmPerPx(k);
  const mmToPx = (mm, k) => Math.round(mm / mmPerPx(k));
  const dpiOf = (k) => k * 72;

  // Cadre commun : B (w×h) est posée en (dx, dy) dans le repère de A. Renvoie le cadre union, les origines de A et B dans ce cadre, la zone commune.
  function frameOf(wA, hA, wB, hB, dx, dy) {
    const x0 = Math.min(0, dx), y0 = Math.min(0, dy), x1 = Math.max(wA, dx + wB), y1 = Math.max(hA, dy + hB);
    const cx0 = Math.max(0, dx), cy0 = Math.max(0, dy), cx1 = Math.min(wA, dx + wB), cy1 = Math.min(hA, dy + hB);
    return {
      W: x1 - x0, H: y1 - y0, ax: -x0, ay: -y0, bx: dx - x0, by: dy - y0,
      common: { x0: cx0 - x0, y0: cy0 - y0, x1: cx1 - x0, y1: cy1 - y0 }, // dans le cadre union
      sameSize: wA === wB && hA === hB,
    };
  }

  const inkFromRGBA = (rgba, out, off, count) => {
    for (let i = 0, j = off; i < count; i++, j++) out[j] = 255 - ((rgba[i * 4] * 77 + rgba[i * 4 + 1] * 151 + rgba[i * 4 + 2] * 28) >> 8);
  };

  // ---------------------------------------------------------------- FFT (radix 2)
  function fft(re, im, n, inv) {
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (2 * Math.PI / len) * (inv ? -1 : 1);
      const wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let j = 0; j < half; j++) {
          const a = i + j, b = a + half;
          const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
    if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
  function fft2(re, im, N, inv) {
    const tr = new Float64Array(N), ti = new Float64Array(N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) { tr[x] = re[y * N + x]; ti[x] = im[y * N + x]; }
      fft(tr, ti, N, inv);
      for (let x = 0; x < N; x++) { re[y * N + x] = tr[x]; im[y * N + x] = ti[x]; }
    }
    for (let x = 0; x < N; x++) {
      for (let y = 0; y < N; y++) { tr[y] = re[y * N + x]; ti[y] = im[y * N + x]; }
      fft(tr, ti, N, inv);
      for (let y = 0; y < N; y++) { re[y * N + x] = tr[y]; im[y * N + x] = ti[y]; }
    }
  }

  // Réduction par moyenne de blocs f×f (Float32, 0..1).
  function downscale(ink, w, h, f) {
    const ow = Math.ceil(w / f), oh = Math.ceil(h / f);
    const out = new Float32Array(ow * oh);
    for (let y = 0; y < h; y++) {
      const row = y * w, orow = ((y / f) | 0) * ow;
      for (let x = 0; x < w; x++) out[orow + ((x / f) | 0)] += ink[row + x];
    }
    const norm = 1 / (255 * f * f);
    for (let i = 0; i < out.length; i++) out[i] *= norm;
    return { data: out, w: ow, h: oh };
  }

  function blur3(ink, w, h) {
    const tmp = new Uint16Array(w * h), out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const r = y * w;
      for (let x = 0; x < w; x++) tmp[r + x] = ink[r + (x > 0 ? x - 1 : x)] + ink[r + x] + ink[r + (x < w - 1 ? x + 1 : x)];
    }
    for (let y = 0; y < h; y++) {
      const r = y * w, ru = (y > 0 ? y - 1 : y) * w, rd = (y < h - 1 ? y + 1 : y) * w;
      for (let x = 0; x < w; x++) out[r + x] = ((tmp[ru + x] + tmp[r + x] + tmp[rd + x]) / 9) | 0;
    }
    return out;
  }

  // ---------------------------------------------------------------- alignement automatique
  // Renvoie { dx, dy, score, zeroScore, confident } : B(x, y) ≈ A(x + dx, y + dy), en pixels de rendu.
  function align(A, wA, hA, B, wB, hB, opts) {
    const o = Object.assign({ thr: DEFAULTS.thr, coarse: 256, maxPoints: 60000 }, opts || {});
    const none = { dx: 0, dy: 0, score: 0, zeroScore: 0, confident: false };
    const sample = collectPoints(A, wA, hA, o.thr, o.maxPoints);
    if (sample.n < 30) return none;
    const Bb = blur3(B, wB, hB);
    const score = (dx, dy) => {
      let s = 0;
      const { xs, ys, n } = sample;
      for (let i = 0; i < n; i++) {
        const x = xs[i] - dx, y = ys[i] - dy;
        if (x >= 0 && y >= 0 && x < wB && y < hB) s += Bb[y * wB + x];
      }
      return s / n;
    };
    const zeroScore = score(0, 0);
    if (zeroScore <= 0 && sample.n < 30) return none;
    // 1. corrélation grossière par FFT
    const f = Math.max(1, Math.ceil(Math.max(wA, hA, wB, hB) / o.coarse));
    const a = downscale(A, wA, hA, f), b = downscale(B, wB, hB, f);
    let N = 8;
    while (N < 2 * Math.max(a.w, a.h, b.w, b.h)) N <<= 1;
    const ar = new Float64Array(N * N), ai = new Float64Array(N * N), br = new Float64Array(N * N), bi = new Float64Array(N * N);
    for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) ar[y * N + x] = a.data[y * a.w + x];
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) br[y * N + x] = b.data[y * b.w + x];
    fft2(ar, ai, N, false); fft2(br, bi, N, false);
    for (let i = 0; i < N * N; i++) { // A · conj(B)
      const r = ar[i] * br[i] + ai[i] * bi[i], im = ai[i] * br[i] - ar[i] * bi[i];
      ar[i] = r; ai[i] = im;
    }
    fft2(ar, ai, N, true);
    let best = -Infinity, bx = 0, by = 0;
    const lim = Math.floor(N / 2);
    for (let y = 0; y < N; y++) {
      const ly = y < lim ? y : y - N;
      if (Math.abs(ly) > Math.max(a.h, b.h) - 1) continue;
      for (let x = 0; x < N; x++) {
        const lx = x < lim ? x : x - N;
        if (Math.abs(lx) > Math.max(a.w, b.w) - 1) continue;
        const v = ar[y * N + x];
        if (v > best || (v === best && Math.abs(lx) + Math.abs(ly) < Math.abs(bx) + Math.abs(by))) { best = v; bx = lx; by = ly; }
      }
    }
    // 2. affinage au pixel, autour de l'estimation grossière (et de zéro)
    const R = f + 2;
    let res = { dx: 0, dy: 0, score: zeroScore };
    for (const [cx, cy] of [[bx * f, by * f], [0, 0]]) {
      const r = cx === 0 && cy === 0 ? Math.min(R, 3) : R;
      for (let dy = cy - r; dy <= cy + r; dy++) {
        for (let dx = cx - r; dx <= cx + r; dx++) {
          const s = score(dx, dy);
          if (s > res.score + 1e-9 || (Math.abs(s - res.score) <= 1e-9 && Math.abs(dx) + Math.abs(dy) < Math.abs(res.dx) + Math.abs(res.dy))) res = { dx, dy, score: s };
        }
      }
    }
    // on ne s'écarte de « pas de décalage » que si le gain est net
    const confident = res.score > zeroScore * 1.03 + 0.05 || (res.dx === 0 && res.dy === 0);
    if (!confident) return { dx: 0, dy: 0, score: zeroScore, zeroScore, confident: false };
    return { dx: res.dx, dy: res.dy, score: res.score, zeroScore, confident: true };
  }

  function collectPoints(ink, w, h, thr, max) {
    let n = 0;
    for (let i = 0; i < ink.length; i++) if (ink[i] >= thr) n++;
    const stride = Math.max(1, Math.ceil(n / max));
    const xs = new Int32Array(Math.ceil(n / stride) + 1), ys = new Int32Array(xs.length);
    let c = 0, m = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (ink[y * w + x] < thr) continue;
        if (c++ % stride === 0) { xs[m] = x; ys[m] = y; m++; }
      }
    }
    return { xs, ys, n: m };
  }

  // ---------------------------------------------------------------- différences
  // Dilatation carrée de rayon r d'un masque 0/1 (fenêtre glissante, séparable).
  function dilate(bin, w, h, r) {
    if (r <= 0) return bin;
    const tmp = new Uint16Array(w * h), out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let cnt = 0;
      for (let x = 0; x < Math.min(r, w); x++) cnt += bin[row + x];
      for (let x = 0; x < w; x++) {
        if (x + r < w) cnt += bin[row + x + r];
        if (x - r - 1 >= 0) cnt -= bin[row + x - r - 1];
        tmp[row + x] = cnt;
      }
    }
    for (let x = 0; x < w; x++) {
      let cnt = 0;
      for (let y = 0; y < Math.min(r, h); y++) cnt += tmp[y * w + x];
      for (let y = 0; y < h; y++) {
        if (y + r < h) cnt += tmp[(y + r) * w + x];
        if (y - r - 1 >= 0) cnt -= tmp[(y - r - 1) * w + x];
        out[y * w + x] = cnt > 0 ? 1 : 0;
      }
    }
    return out;
  }
  const binarize = (ink, thr) => { const b = new Uint8Array(ink.length); for (let i = 0; i < ink.length; i++) b[i] = ink[i] >= thr ? 1 : 0; return b; };

  // A, B : encre ; (dx, dy) : décalage de B ; k : px par point. Options : thr, tolMm, gapMm, minPx.
  // Renvoie { frame, map (Uint8Array W×H, classes C), regions, stats, tolPx, mmPerPx }.
  function diffMaps(A, wA, hA, B, wB, hB, dx, dy, k, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const mm = mmPerPx(k);
    const r = Math.max(0, Math.round(o.tolMm / mm));
    const fr = frameOf(wA, hA, wB, hB, dx, dy);
    const { W, H, common: cm } = fr;
    const binA = binarize(A, o.thr), binB = binarize(B, o.thr);
    const dilA = dilate(binA, wA, hA, r), dilB = dilate(binB, wB, hB, r);
    const map = new Uint8Array(W * H);
    let nOld = 0, nNew = 0, nSame = 0;
    const S = 8, gw = Math.ceil(W / S), gh = Math.ceil(H / S);
    const bb = new Int32Array(gw * gh * 4).fill(-1); // minx, maxx, miny, maxy
    const bc = new Uint32Array(gw * gh * 2); // anciens, nouveaux
    // pixels des pages hors de la zone commune : fond teinté / encre grise
    const paintOut = (img, w, h, ox, oy) => {
      for (let y = 0; y < h; y++) {
        const fy = y + oy;
        for (let x = 0; x < w; x++) {
          const fx = x + ox;
          if (fx >= cm.x0 && fx < cm.x1 && fy >= cm.y0 && fy < cm.y1) continue;
          const i = fy * W + fx;
          map[i] = img[y * w + x] >= o.thr ? C.OUT_INK : (map[i] === C.OUT_INK ? C.OUT_INK : C.OUT);
        }
      }
    };
    map.fill(C.OUT);
    paintOut(A, wA, hA, fr.ax, fr.ay); paintOut(B, wB, hB, fr.bx, fr.by);
    for (let fy = cm.y0; fy < cm.y1; fy++) {
      const ya = fy - fr.ay, yb = fy - fr.by;
      for (let fx = cm.x0; fx < cm.x1; fx++) {
        const ia = ya * wA + (fx - fr.ax), ib = yb * wB + (fx - fr.bx);
        const a = binA[ia], b = binB[ib];
        let cls = 0;
        if (a) cls = b || dilB[ib] ? C.SAME : C.OLD;
        else if (b) cls = dilA[ia] ? C.SAME : C.NEW;
        map[fy * W + fx] = cls;
        if (cls === C.SAME) nSame++;
        else if (cls) {
          const g = ((fy / S) | 0) * gw + ((fx / S) | 0), q = g * 4;
          if (bb[q] < 0) { bb[q] = fx; bb[q + 1] = fx; bb[q + 2] = fy; bb[q + 3] = fy; }
          else { if (fx < bb[q]) bb[q] = fx; if (fx > bb[q + 1]) bb[q + 1] = fx; if (fy < bb[q + 2]) bb[q + 2] = fy; if (fy > bb[q + 3]) bb[q + 3] = fy; }
          bc[g * 2 + (cls === C.OLD ? 0 : 1)]++;
          if (cls === C.OLD) nOld++; else nNew++;
        }
      }
    }
    // zones : blocs 8×8 actifs, réunis s'ils sont à moins de gap (en blocs)
    const gapB = Math.max(1, Math.round(o.gapMm / mm / S));
    const parent = new Int32Array(gw * gh);
    for (let i = 0; i < parent.length; i++) parent[i] = i;
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const active = [];
    for (let g = 0; g < gw * gh; g++) if (bb[g * 4] >= 0) active.push(g);
    for (const g of active) {
      const gx = g % gw, gy = (g / gw) | 0;
      for (let y = gy; y <= Math.min(gh - 1, gy + gapB); y++) {
        for (let x = Math.max(0, gx - gapB); x <= Math.min(gw - 1, gx + gapB); x++) {
          const h = y * gw + x;
          if (h !== g && bb[h * 4] >= 0) { const a = find(g), b = find(h); if (a !== b) parent[a] = b; }
        }
      }
    }
    const comps = new Map();
    for (const g of active) {
      const root0 = find(g), q = g * 4;
      let c = comps.get(root0);
      if (!c) { c = { x0: bb[q], x1: bb[q + 1], y0: bb[q + 2], y1: bb[q + 3], old: 0, nu: 0 }; comps.set(root0, c); }
      else { c.x0 = Math.min(c.x0, bb[q]); c.x1 = Math.max(c.x1, bb[q + 1]); c.y0 = Math.min(c.y0, bb[q + 2]); c.y1 = Math.max(c.y1, bb[q + 3]); }
      c.old += bc[g * 2]; c.nu += bc[g * 2 + 1];
    }
    const regions = [];
    for (const c of comps.values()) {
      if (c.old + c.nu < o.minPx) { // bruit : effacé de la carte
        for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) { const i = y * W + x; if (map[i] === C.OLD || map[i] === C.NEW) { map[i] = C.SAME; nSame++; if (c.old) nOld--; else nNew--; } }
        continue;
      }
      regions.push({ x0: c.x0, y0: c.y0, x1: c.x1 + 1, y1: c.y1 + 1, old: c.old, nu: c.nu, kind: c.nu === 0 ? 'removed' : c.old === 0 ? 'added' : 'modified' });
    }
    const band = Math.max(1, H / 16);
    regions.sort((p, q) => Math.floor(p.y0 / band) - Math.floor(q.y0 / band) || p.x0 - q.x0 || p.y0 - q.y0);
    regions.forEach((g, i) => { g.id = i + 1; });
    const changed = regions.reduce((s, g) => s + g.old + g.nu, 0);
    const total = changed + nSame;
    return {
      frame: fr, map, regions, tolPx: r, mmPerPx: mm,
      stats: { old: nOld, nu: nNew, same: nSame, changed, percent: total ? (changed / total) * 100 : 0, regions: regions.length },
    };
  }

  // Colorie les lignes [y0, y1) de la carte dans out (RGBA, W×(y1-y0)×4). pal : { old, nu, same, out, outInk } = [r, g, b].
  function paintRows(map, W, y0, y1, pal, out) {
    const lut = [[255, 255, 255], pal.old, pal.nu, pal.same, pal.out || [240, 240, 244], pal.outInk || [200, 200, 205]];
    for (let y = y0, o = 0; y < y1; y++) {
      for (let x = 0, i = y * W; x < W; x++, i++, o += 4) { const c = lut[map[i]] || lut[0]; out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255; }
    }
  }
  const parseColor = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const toHex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const DEFAULT_PALETTE = { old: '#e0272f', nu: '#1f6feb', same: '#9a9aa2' };

  // ---------------------------------------------------------------- texte
  // items : contenu de getTextContent() de pdf.js. Renvoie des mots avec leur boîte en coordonnées PDF (points) : { w, x0, y0, x1, y1 }.
  function tokenize(items) {
    const out = [];
    for (const it of items || []) {
      const s = it.str;
      if (typeof s !== 'string' || !s.trim() || !it.transform) continue;
      const x = it.transform[4], y = it.transform[5];
      const w = it.width || 0, h = it.height || Math.abs(it.transform[3]) || Math.hypot(it.transform[2], it.transform[3]);
      const re = /\S+/g;
      let m;
      while ((m = re.exec(s))) {
        const f0 = m.index / s.length, f1 = (m.index + m[0].length) / s.length;
        out.push({ w: m[0], x0: x + w * f0, x1: x + w * f1, y0: y - h * 0.2, y1: y + h * 0.85 });
      }
    }
    return out;
  }

  // Différence de deux listes de mots (Myers). Renvoie { a: Uint8Array (1 = supprimé), b: Uint8Array (1 = ajouté), changes, capped }.
  function diffWords(wa, wb, maxD) {
    const n = wa.length, m = wb.length;
    const da = new Uint8Array(n), db = new Uint8Array(m);
    let s = 0;
    while (s < n && s < m && wa[s] === wb[s]) s++;
    let ea = n, eb = m;
    while (ea > s && eb > s && wa[ea - 1] === wb[eb - 1]) { ea--; eb--; }
    const a = wa.slice(s, ea), b = wb.slice(s, eb);
    const N = a.length, M = b.length, max = Math.min(N + M, maxD || 4000);
    let capped = false;
    if (N === 0) db.fill(1, s, eb);
    else if (M === 0) da.fill(1, s, ea);
    else {
      const off = max + 2;
      const v = new Int32Array(2 * max + 5);
      const trace = []; // trace[d] : valeurs de v pour k de -d à d, après le tour d
      let found = -1;
      for (let d = 0; d <= max && found < 0; d++) {
        for (let k = -d; k <= d; k += 2) {
          let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
          let y = x - k;
          while (x < N && y < M && a[x] === b[y]) { x++; y++; }
          v[off + k] = x;
          if (x >= N && y >= M) { found = d; break; }
        }
        trace.push(v.slice(off - d, off + d + 1));
      }
      if (found < 0) { capped = true; da.fill(1, s, ea); db.fill(1, s, eb); }
      else {
        let x = N, y = M;
        for (let d = found; d > 0; d--) {
          const prev = trace[d - 1], g = (kk) => prev[kk + d - 1];
          const k = x - y;
          const down = k === -d || (k !== d && g(k - 1) < g(k + 1));
          const prevK = down ? k + 1 : k - 1;
          const px = g(prevK), py = px - prevK;
          if (down) db[s + py] = 1; else da[s + px] = 1;
          x = px; y = py;
        }
      }
    }
    // regroupement en modifications : suites consécutives de mots supprimés / ajoutés
    const changes = [];
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && !da[i] && !db[j]) { i++; j++; continue; }
      const i0 = i, j0 = j;
      while (i < n && da[i]) i++;
      while (j < m && db[j]) j++;
      if (i === i0 && j === j0) { if (i < n && !da[i]) i++; else j++; continue; }
      changes.push({ a0: i0, a1: i, b0: j0, b1: j, type: i > i0 && j > j0 ? 'changed' : i > i0 ? 'removed' : 'added' });
    }
    return { a: da, b: db, changes, capped };
  }

  // ---------------------------------------------------------------- correspondance des pages
  // Par défaut page N contre page N ; les pages en trop sont « ajoutées » (nouveau) ou « supprimées » (ancien).
  function defaultPairs(nA, nB) {
    const out = [];
    for (let i = 0; i < Math.max(nA, nB); i++) out.push({ a: i < nA ? i : null, b: i < nB ? i : null });
    return out;
  }
  const pairKind = (p) => (p.a === null ? 'added' : p.b === null ? 'removed' : 'both');

  return {
    C, DEFAULTS, MAX_K, planScale, mmPerPx, pxToMm, mmToPx, dpiOf, frameOf, inkFromRGBA, downscale, blur3, fft2, align, dilate, diffMaps, paintRows,
    parseColor, toHex, DEFAULT_PALETTE, tokenize, diffWords, defaultPairs, pairKind,
  };
});
