// Comparaison de deux documents (espace plein écran, lecture seule : aucun document modifié, rien dans l'historique).
// Orchestration : choix des documents et des paires de pages, rendu par bandes (compare-render), calculs dans un Web Worker (compare-worker),
// affichage (compare-view : superposition / fondu / côte à côte / texte), navigation entre les différences, export PDF (compare-report).
import { $, api, store, toast } from './ui.js';
import * as V from './viewer.js';
import { loadPdf } from './pdfjs-load.js';
import { askForm } from './pages-ui.js';
import { createView } from './compare-view.js';
import { renderInk, paintMap, pageSizePt } from './compare-render.js';

const { Compare, CompareReport, PdfEdit, PDFLib } = window;
const MM = 25.4 / 72;
const PREF = 'spinadoc.compare';
const S = {
  open: false, a: null, b: null, files: [], pairs: [], cur: -1, mode: 'overlay', maxSide: 4096, tolMm: 0.5,
  pal: Object.assign({}, Compare.DEFAULT_PALETTE), manual: null, sess: null, worker: null, job: null, seq: 0, view: null, blink: null, listCur: -1,
};
export const getState = () => S; // tests

const f1 = (n, d) => Number(n).toFixed(d === undefined ? 1 : d).replace('.', ',');
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const cancelErr = () => Object.assign(new Error('annulé'), { cancelled: true });
const clearEl = (e) => e.replaceChildren();

// ---------------------------------------------------------------- préférences
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREF) || '{}');
    for (const k of ['old', 'nu', 'same']) if (Compare.parseColor(p[k])) S.pal[k] = p[k];
    if (p.tol >= 0 && p.tol <= 10) S.tolMm = Number(p.tol);
    if ([2048, 4096, 6144].includes(p.res)) S.maxSide = p.res;
  } catch { /* préférences absentes */ }
}
function savePrefs() { try { localStorage.setItem(PREF, JSON.stringify({ old: S.pal.old, nu: S.pal.nu, same: S.pal.same, tol: S.tolMm, res: S.maxSide })); } catch { /* ignoré */ } }

// ---------------------------------------------------------------- travail (Web Worker) et progression
function startWorker() {
  const w = new Worker(new URL('./compare-worker.js', import.meta.url));
  const h = { w, id: 0, pend: new Map(), dead: false };
  const failAll = (err) => { for (const p of h.pend.values()) p.rej(err); h.pend.clear(); };
  w.onmessage = (e) => {
    const m = e.data, p = h.pend.get(m.id);
    if (!p) return;
    if (m.type === 'progress') { if (p.onp) p.onp(m.label); return; }
    h.pend.delete(m.id);
    if (m.type === 'error') p.rej(new Error(m.message)); else p.res(m);
  };
  w.onerror = (e) => failAll(new Error(e.message || 'Erreur du calcul de comparaison'));
  h.ask = (msg, onp) => new Promise((res, rej) => {
    if (h.dead) { rej(cancelErr()); return; }
    const id = ++h.id; h.pend.set(id, { res, rej, onp }); w.postMessage(Object.assign({ id }, msg));
  });
  h.set = (side, r) => { if (!h.dead) w.postMessage({ cmd: 'set', side, w: r.w, h: r.h, ink: r.ink.buffer }, [r.ink.buffer]); };
  h.kill = () => { h.dead = true; w.terminate(); failAll(cancelErr()); };
  return h;
}
function newJob() { const j = { cancelled: false, worker: null, cancel() { this.cancelled = true; if (this.worker) this.worker.kill(); } }; return j; }
function progress(label, frac) {
  $('cmp-progress').hidden = false;
  $('cmp-prog-label').textContent = label;
  $('cmp-progress').querySelector('.pq-bar > i').style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
}
const endProgress = () => { $('cmp-progress').hidden = true; };
function setMsg(html) { const m = $('cmp-msg'); m.hidden = !html; m.textContent = html || ''; }

// ---------------------------------------------------------------- documents
async function openPdfWithPassword(name, bytes) {
  let password = '', msg = '';
  for (;;) {
    try { return await loadPdf(bytes, password ? { password } : {}); }
    catch (e) {
      if (!(e && e.name === 'PasswordException')) throw e;
      const v = await askForm({ title: 'PDF protégé', intro: `« ${name} » est protégé par un mot de passe.${msg ? ' ' + msg : ''}`, fields: [{ id: 'pw', label: 'Mot de passe', type: 'password', value: '' }], okLabel: 'Ouvrir' });
      if (!v) return null;
      password = v.pw; msg = 'Mot de passe incorrect, réessayez.';
    }
  }
}
function fillSelect(side) {
  const sel = $('cmp-doc-' + side), keep = sel.value;
  clearEl(sel);
  const add = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.append(o); };
  add('', '— choisir —');
  store.docs.forEach((d, i) => add('tab:' + d.id, d.name + (d.dirty ? ' (modifié)' : '')));
  S.files.forEach((f, i) => add('file:' + i, f.name));
  add('__open', 'Ouvrir un fichier…');
  sel.value = [...sel.options].some((o) => o.value === keep) ? keep : '';
}
function dropSide(side) {
  const cur = S[side];
  if (cur && cur.own && cur.pdf) { try { cur.pdf.destroy(); } catch { /* déjà détruit */ } }
  S[side] = null;
}
async function loadSide(side, value) {
  if (value === '__open') {
    const paths = await api.openDialog();
    if (!paths || !paths.length) { $('cmp-doc-' + side).value = S[side] ? S[side].value : ''; return; }
    try {
      const f = await api.readFile(paths[0], { noRecent: true });
      const pdf = await openPdfWithPassword(f.name, f.bytes);
      if (!pdf) { $('cmp-doc-' + side).value = S[side] ? S[side].value : ''; return; }
      S.files.push({ name: f.name, pdf });
      fillSelect('a'); fillSelect('b');
      value = 'file:' + (S.files.length - 1);
      $('cmp-doc-' + side).value = value;
    } catch (err) { toast('Impossible d\'ouvrir ce fichier : ' + (err && err.message || err), 6000); $('cmp-doc-' + side).value = S[side] ? S[side].value : ''; return; }
  }
  cancelAll();
  dropSide(side);
  if (value) {
    try {
      if (value.startsWith('tab:')) {
        const doc = store.docs.find((d) => 'tab:' + d.id === value);
        if (!doc) throw new Error('document fermé');
        if (doc.dirty) S[side] = { name: doc.name + ' (avec modifications)', pdf: await loadPdf(await V.exportBytes(doc, null, { encrypt: null })), own: true, value };
        else S[side] = { name: doc.name, pdf: V.getPdf(doc) || await loadPdf(doc.bytes), own: !V.getPdf(doc), value };
      } else {
        const f = S.files[Number(value.slice(5))];
        S[side] = { name: f.name, pdf: f.pdf, own: false, value };
      }
      S[side].n = S[side].pdf.numPages;
    } catch (err) { S[side] = null; toast('Impossible de lire ce document : ' + (err && err.message || err), 6000); }
  }
  resetPairs();
}
function resetPairs() {
  S.sess = null; S.cur = -1; S.manual = null;
  S.view.setPage(null);
  if (S.a && S.b) { S.pairs = Compare.defaultPairs(S.a.n, S.b.n); renderPairs(); renderAll(); if (S.pairs.some((p) => Compare.pairKind(p) === 'both')) openPair(S.pairs.findIndex((p) => Compare.pairKind(p) === 'both')); else setMsg('Aucune page à comparer.'); }
  else { S.pairs = []; renderPairs(); renderAll(); setMsg(S.a || S.b ? 'Choisissez aussi l\'autre document (listes « Ancien » et « Nouveau »).' : 'Choisissez les deux documents à comparer (listes « Ancien » et « Nouveau »).'); }
}

// ---------------------------------------------------------------- paires de pages
function renderPairs() {
  const ul = $('cmp-pages');
  clearEl(ul);
  S.pairs.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = 'cmp-row' + (i === S.cur ? ' sel' : '');
    li.dataset.i = i;
    const open = document.createElement('button');
    open.type = 'button'; open.className = 'cmp-open';
    const kind = Compare.pairKind(p);
    const lab = document.createElement('span');
    lab.textContent = kind === 'both' ? `Ancien p. ${p.a + 1} ↔ nouveau p. ${p.b + 1}` : kind === 'added' ? `Page ${p.b + 1} ajoutée` : `Page ${p.a + 1} supprimée`;
    const pct = document.createElement('span');
    pct.className = 'cmp-pct' + (p.res && p.res.pct >= 5 ? ' hot' : '');
    pct.textContent = kind !== 'both' ? '—' : p.res ? f1(p.res.pct) + ' %' : '…';
    open.append(lab, pct);
    open.disabled = kind !== 'both';
    open.addEventListener('click', () => openPair(i));
    const sel = (key, n) => {
      const s = document.createElement('select');
      s.setAttribute('aria-label', key === 'a' ? `Page de l'ancien, ligne ${i + 1}` : `Page du nouveau, ligne ${i + 1}`);
      const o0 = document.createElement('option'); o0.value = ''; o0.textContent = '—'; s.append(o0);
      for (let q = 0; q < n; q++) { const o = document.createElement('option'); o.value = String(q); o.textContent = 'p. ' + (q + 1); s.append(o); }
      s.value = p[key] === null ? '' : String(p[key]);
      s.addEventListener('change', () => { p[key] = s.value === '' ? null : Number(s.value); p.res = null; renderPairs(); if (i === S.cur) { if (Compare.pairKind(p) === 'both') openPair(i); else { S.sess = null; S.view.setPage(null); setMsg('Cette ligne n\'a pas de page de chaque côté : rien à comparer.'); renderAll(); } } });
      return s;
    };
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'icon-btn'; del.title = 'Retirer cette ligne'; del.setAttribute('aria-label', 'Retirer la ligne ' + (i + 1));
    del.innerHTML = '<span class="ico" data-icon="x"></span>';
    del.addEventListener('click', () => { S.pairs.splice(i, 1); if (S.cur === i) { S.cur = -1; S.sess = null; S.view.setPage(null); setMsg('Choisissez une paire de pages.'); } else if (S.cur > i) S.cur--; renderPairs(); renderAll(); });
    li.append(open, sel('a', S.a.n), sel('b', S.b.n), del);
    ul.append(li);
  });
  $('cmp-all').disabled = !S.pairs.some((p) => Compare.pairKind(p) === 'both');
  $('cmp-add-pair').disabled = !(S.a && S.b);
}

// ---------------------------------------------------------------- calcul d'une paire
// display : conserve les canevas d'affichage et le worker (changement de décalage / tolérance sans nouveau rendu).
async function computePair(p, job, { display, manual, label = '', base = 0, span = 1 }) {
  const pr = (t, f) => progress(label + t, base + f * span);
  const [wa, ha] = await pageSizePt(S.a.pdf, p.a + 1), [wb, hb] = await pageSizePt(S.b.pdf, p.b + 1);
  if (job.cancelled) throw cancelErr();
  const k = Compare.planScale([[wa, ha], [wb, hb]], S.maxSide, S.maxSide * S.maxSide * 0.75);
  const ra = await renderInk(S.a.pdf, p.a + 1, k, { job, keepCanvas: display, onProgress: (f) => pr('Rendu de l\'ancien document…', f * 0.4) });
  const rb = await renderInk(S.b.pdf, p.b + 1, k, { job, keepCanvas: display, onProgress: (f) => pr('Rendu du nouveau document…', 0.4 + f * 0.4) });
  if (job.cancelled) throw cancelErr();
  const w = startWorker();
  job.worker = w;
  const pages = { a: { w: ra.w, h: ra.h, page: ra.page, vp: ra.vp, canvas: ra.canvas }, b: { w: rb.w, h: rb.h, page: rb.page, vp: rb.vp, canvas: rb.canvas } };
  w.set('a', ra); w.set('b', rb);
  try {
    let sh = manual;
    if (!sh) { const r = await w.ask({ cmd: 'align', thr: Compare.DEFAULTS.thr }, (t) => pr(t, 0.85)); sh = { dx: r.dx, dy: r.dy, auto: true, confident: r.confident }; }
    const d = await w.ask({ cmd: 'diff', dx: sh.dx, dy: sh.dy, k, opts: { tolMm: S.tolMm } }, (t) => pr(t, 0.95));
    return { k, sizes: { wa, ha, wb, hb }, pages, shift: sh, diff: d, worker: w };
  } catch (err) { w.kill(); throw err; }
  finally { if (!display) for (const pg of [ra.page, rb.page]) { try { pg.cleanup(); } catch { /* ignoré */ } } }
}
function releaseSess(s) {
  if (!s) return;
  for (const c of [s.cvA, s.cvB, s.cvMap]) if (c) { c.width = 0; c.height = 0; }
  for (const pg of [s.pageA, s.pageB]) { try { pg && pg.cleanup(); } catch { /* ignoré */ } }
}
function cancelAll() {
  S.seq++;
  if (S.job) { S.job.cancel(); S.job = null; }
  stopBlink();
}

async function openPair(i) {
  const p = S.pairs[i];
  if (!p || Compare.pairKind(p) !== 'both') return;
  cancelAll();
  if (S.worker) { S.worker.kill(); S.worker = null; }
  releaseSess(S.sess); S.sess = null; S.view.setPage(null);
  S.cur = i; S.manual = null; renderPairs(); renderAll();
  setMsg('');
  const job = newJob();
  S.job = job;
  try {
    const r = await computePair(p, job, { display: true, manual: null });
    if (job.cancelled || S.job !== job) { r.worker.kill(); return; }
    S.worker = r.worker;
    const s = {
      pair: p, k: r.k, sizes: r.sizes, cvA: r.pages.a.canvas, cvB: r.pages.b.canvas, cvMap: document.createElement('canvas'),
      pageA: r.pages.a.page, pageB: r.pages.b.page, vpA: r.pages.a.vp, vpB: r.pages.b.vp, dimsA: [r.pages.a.w, r.pages.a.h], dimsB: [r.pages.b.w, r.pages.b.h],
      frame: r.diff.frame, regions: r.diff.regions, stats: r.diff.stats, mmPerPx: r.diff.mmPerPx, shift: r.shift, map: new Uint8Array(r.diff.map), text: null,
    };
    await paintMap(s.cvMap, s.map, s.frame.W, s.frame.H, S.pal);
    if (job.cancelled || S.job !== job) { releaseSess(s); return; }
    S.sess = s;
    p.res = { pct: s.stats.percent, n: s.stats.regions };
    S.view.setPage(s);
    S.view.setMode(S.mode);
    endProgress();
    renderPairs(); renderAll();
    loadText(s);
  } catch (err) {
    endProgress();
    if (err && err.cancelled) { if (S.job === job) setMsg('Calcul annulé. Choisissez une page pour relancer la comparaison.'); }
    else { console.error(err); setMsg('Comparaison impossible : ' + (err && err.message || err)); toast('Comparaison impossible : ' + (err && err.message || err), 8000); }
    renderAll();
  } finally { if (S.job === job) S.job = null; }
}

// Nouveau décalage ou nouvelle tolérance : seul le calcul des différences est refait (les pages restent en mémoire du worker).
async function rediff(manual) {
  const s = S.sess;
  if (!s || !S.worker) return;
  const my = ++S.seq;
  try {
    let sh = manual || S.manual || s.shift;
    if (manual === 'auto') {
      progress('Alignement automatique…', 0.3);
      const r = await S.worker.ask({ cmd: 'align', thr: Compare.DEFAULTS.thr });
      if (my !== S.seq) return;
      sh = { dx: r.dx, dy: r.dy, auto: true, confident: r.confident };
      S.manual = null;
    }
    const d = await S.worker.ask({ cmd: 'diff', dx: sh.dx, dy: sh.dy, k: s.k, opts: { tolMm: S.tolMm } });
    if (my !== S.seq || S.sess !== s) return;
    s.shift = sh; s.frame = d.frame; s.regions = d.regions; s.stats = d.stats; s.mmPerPx = d.mmPerPx; s.map = new Uint8Array(d.map);
    await paintMap(s.cvMap, s.map, s.frame.W, s.frame.H, S.pal);
    if (my !== S.seq || S.sess !== s) return;
    s.pair.res = { pct: s.stats.percent, n: s.stats.regions };
    S.view.relayout(s.frame, s.regions, s.mmPerPx);
    if (s.text) placeText(s);
    S.listCur = -1;
    endProgress(); renderPairs(); renderAll();
  } catch (err) { endProgress(); if (!(err && err.cancelled)) { console.error(err); toast('Calcul impossible : ' + (err && err.message || err), 6000); } }
}
let rediffTimer = null;
const rediffSoon = (manual) => { clearTimeout(rediffTimer); rediffTimer = setTimeout(() => rediff(manual), 220); };

// ---------------------------------------------------------------- texte
async function loadText(s) {
  try {
    const [ca, cb] = await Promise.all([s.pageA.getTextContent(), s.pageB.getTextContent()]);
    if (S.sess !== s) return;
    const ta = Compare.tokenize(ca.items), tb = Compare.tokenize(cb.items);
    const d = Compare.diffWords(ta.map((t) => t.w), tb.map((t) => t.w));
    const rectOf = (vp, t) => { const r = vp.convertToViewportRectangle([t.x0, t.y0, t.x1, t.y1]); return { x0: Math.min(r[0], r[2]), x1: Math.max(r[0], r[2]), y0: Math.min(r[1], r[3]), y1: Math.max(r[1], r[3]) }; };
    const boxesA = [], boxesB = [];
    const changes = d.changes.map((c, ci) => {
      const bA = [], bB = [];
      for (let i = c.a0; i < c.a1; i++) { const r = rectOf(s.vpA, ta[i]); r.change = ci; boxesA.push(r); bA.push(r); }
      for (let j = c.b0; j < c.b1; j++) { const r = rectOf(s.vpB, tb[j]); r.change = ci; boxesB.push(r); bB.push(r); }
      const cut = (arr, a, b) => arr.slice(a, b).map((t) => t.w).join(' ');
      return { type: c.type, old: cut(ta, c.a0, c.a1), nu: cut(tb, c.b0, c.b1), bA, bB };
    });
    s.text = { hasA: ta.length > 0, hasB: tb.length > 0, nA: ta.length, nB: tb.length, changes, boxesA, boxesB, capped: d.capped };
    placeText(s);
    renderAll();
  } catch (err) { console.error(err); s.text = { error: String(err && err.message || err), changes: [], hasA: false, hasB: false }; renderAll(); }
}
const placeText = (s) => S.view.setText(s.text.boxesA, s.text.boxesB);

// ---------------------------------------------------------------- panneaux
const mmOf = (px, s) => f1(px * s.mmPerPx, 0);
function infoLines(s) {
  const out = [];
  const [wa, ha, wb, hb] = [s.sizes.wa, s.sizes.ha, s.sizes.wb, s.sizes.hb].map((v) => v * MM);
  out.push(`Ancien : page ${s.pair.a + 1}, ${f1(wa, 0)} × ${f1(ha, 0)} mm`);
  out.push(`Nouveau : page ${s.pair.b + 1}, ${f1(wb, 0)} × ${f1(hb, 0)} mm`);
  if (!s.frame.sameSize) {
    const c = s.frame.common;
    out.push({ warn: `Formats différents : comparaison sur la zone commune (${f1((c.x1 - c.x0) * s.mmPerPx, 0)} × ${f1((c.y1 - c.y0) * s.mmPerPx, 0)} mm). Le reste est grisé.` });
  }
  out.push(`Résolution : ${f1(s.mmPerPx, 2)} mm par pixel (${Math.round(Compare.dpiOf(s.k))} dpi), tolérance ${f1(S.tolMm)} mm`);
  const sh = s.shift;
  const mmx = sh.dx * s.mmPerPx, mmy = sh.dy * s.mmPerPx;
  out.push(S.manual ? `Alignement manuel : décalage ${f1(mmx)} ; ${f1(mmy)} mm` : sh.confident === false ? { warn: 'Alignement automatique peu fiable : aucun décalage appliqué. Ajustez à la main (flèches) si besoin.' } : `Alignement automatique : décalage ${f1(mmx)} ; ${f1(mmy)} mm`);
  return out;
}
function renderAll() {
  const s = S.sess;
  $('cmp-export').disabled = !(S.pairs.some((p) => Compare.pairKind(p) === 'both'));
  const info = $('cmp-info'), list = $('cmp-list');
  clearEl(info); clearEl(list);
  const nav = (n) => { $('cmp-prev').disabled = !n; $('cmp-next').disabled = !n; };
  if (!s) { $('cmp-count').textContent = ''; nav(0); $('cmp-dx').value = '0'; $('cmp-dy').value = '0'; return; }
  for (const l of infoLines(s)) { const d = document.createElement('div'); if (typeof l === 'object') { d.className = 'warn'; d.textContent = l.warn; } else d.textContent = l; info.append(d); }
  $('cmp-dx').value = f1(s.shift.dx * s.mmPerPx).replace(',', '.'); $('cmp-dy').value = f1(s.shift.dy * s.mmPerPx).replace(',', '.');
  if (S.mode === 'text') {
    const t = s.text;
    if (!t) { $('cmp-count').textContent = 'Lecture du texte…'; nav(0); return; }
    if (t.error) { $('cmp-count').textContent = ''; setMsg('Texte illisible : ' + t.error); nav(0); return; }
    if (!t.hasA && !t.hasB) { setMsg('Ces pages ne contiennent pas de texte exploitable (scan ou plan vectorisé). Utilisez la superposition, le fondu ou le côte à côte.'); $('cmp-count').textContent = 'Pas de texte'; nav(0); return; }
    setMsg('');
    if (!t.hasA || !t.hasB) { const d = document.createElement('div'); d.className = 'warn'; d.textContent = `Aucun texte dans ${t.hasA ? 'la page nouvelle' : 'la page ancienne'} : tout le texte de l'autre page apparaît comme ${t.hasA ? 'supprimé' : 'ajouté'}.`; info.append(d); }
    if (t.capped) { const d = document.createElement('div'); d.className = 'warn'; d.textContent = 'Texte très différent : comparaison simplifiée.'; info.append(d); }
    $('cmp-count').textContent = t.changes.length ? plural(t.changes.length, 'modification de texte', 'modifications de texte') + ' sur cette page' : 'Aucune modification de texte';
    t.changes.forEach((c, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'cmp-li' + (i === S.listCur ? ' cur' : ''); b.dataset.i = i;
      const n = document.createElement('span'); n.className = 'n'; n.textContent = String(i + 1);
      const body = document.createElement('span');
      if (c.old) { const o = document.createElement('span'); o.className = 'del'; o.textContent = c.old.slice(0, 90); body.append(o, ' '); }
      if (c.nu) { const a = document.createElement('span'); a.className = 'add'; a.textContent = c.nu.slice(0, 90); body.append(a); }
      b.append(n, body);
      b.addEventListener('click', () => focusItem(i));
      const li = document.createElement('li'); li.append(b); list.append(li);
    });
    nav(t.changes.length);
    return;
  }
  setMsg('');
  $('cmp-count').textContent = s.regions.length ? plural(s.regions.length, 'différence', 'différences') + ' sur cette page · ' + f1(s.stats.percent) + ' %' : 'Aucune différence sur cette page';
  const kinds = { added: 'ajoutée', removed: 'supprimée', modified: 'modifiée' };
  s.regions.forEach((g, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'cmp-li' + (i === S.listCur ? ' cur' : ''); b.dataset.i = i;
    const n = document.createElement('span'); n.className = 'n'; n.textContent = String(g.id);
    const body = document.createElement('span'); body.textContent = `${kinds[g.kind]} · ${mmOf(g.x1 - g.x0, s)} × ${mmOf(g.y1 - g.y0, s)} mm`;
    b.append(n, body);
    b.addEventListener('click', () => focusItem(i));
    const li = document.createElement('li'); li.append(b); list.append(li);
  });
  nav(s.regions.length);
}
function itemCount() { const s = S.sess; if (!s) return 0; return S.mode === 'text' ? (s.text ? s.text.changes.length : 0) : s.regions.length; }
function focusItem(i) {
  const s = S.sess;
  if (!s) return;
  S.listCur = i;
  if (S.mode === 'text') {
    const c = s.text.changes[i];
    const rects = [...c.bA.map((r) => ({ x0: r.x0 + s.frame.ax, x1: r.x1 + s.frame.ax, y0: r.y0 + s.frame.ay, y1: r.y1 + s.frame.ay })), ...c.bB.map((r) => ({ x0: r.x0 + s.frame.bx, x1: r.x1 + s.frame.bx, y0: r.y0 + s.frame.by, y1: r.y1 + s.frame.by }))];
    const u = { x0: Math.min(...rects.map((r) => r.x0)), x1: Math.max(...rects.map((r) => r.x1)), y0: Math.min(...rects.map((r) => r.y0)), y1: Math.max(...rects.map((r) => r.y1)) };
    S.view.focusBox(i, u); S.view.markText(i);
  } else S.view.focusBox(i, s.regions[i]);
  document.querySelectorAll('#cmp-list .cmp-li').forEach((b) => b.classList.toggle('cur', Number(b.dataset.i) === i));
}
function step(dir) {
  const n = itemCount();
  if (!n) return;
  focusItem(S.listCur < 0 ? (dir > 0 ? 0 : n - 1) : (S.listCur + dir + n) % n);
}

// ---------------------------------------------------------------- affichage
function setMode(m) {
  S.mode = m;
  stopBlink();
  for (const b of document.querySelectorAll('.cmp-mode')) b.setAttribute('aria-pressed', String(b.dataset.mode === m));
  $('cmp-colors').hidden = m !== 'overlay';
  $('cmp-fadebox').hidden = m !== 'fade';
  S.listCur = -1;
  S.view.setMode(m);
  if (S.sess && S.sess.text && m === 'text') placeText(S.sess);
  renderAll();
}
function stopBlink() { if (S.blink) { clearInterval(S.blink); S.blink = null; } $('cmp-blink').setAttribute('aria-pressed', 'false'); }
function toggleBlink() {
  if (S.blink) { stopBlink(); return; }
  if (S.mode !== 'fade') return;
  $('cmp-blink').setAttribute('aria-pressed', 'true');
  let on = false;
  S.blink = setInterval(() => { on = !on; const t = on ? 0 : 1; $('cmp-fade').value = String(t * 100); S.view.setFade(t); }, 650);
}
function nudge(ddx, ddy) {
  const s = S.sess;
  if (!s) return;
  const stepMm = Math.max(0.1, Number($('cmp-step').value) || 1);
  const px = Math.max(1, Math.round(stepMm / s.mmPerPx));
  S.manual = { dx: s.shift.dx + ddx * px, dy: s.shift.dy + ddy * px, auto: false };
  s.shift = S.manual; renderAll(); rediffSoon(S.manual);
}
function typedShift() {
  const s = S.sess;
  if (!s) return;
  const dx = Math.round((Number($('cmp-dx').value) || 0) / s.mmPerPx), dy = Math.round((Number($('cmp-dy').value) || 0) / s.mmPerPx);
  S.manual = { dx, dy, auto: false };
  s.shift = S.manual; rediffSoon(S.manual);
}
async function recolor() {
  const s = S.sess;
  S.pal = { old: $('cmp-c-old').value, nu: $('cmp-c-new').value, same: $('cmp-c-same').value };
  savePrefs();
  if (s) await paintMap(s.cvMap, s.map, s.frame.W, s.frame.H, S.pal);
}

// ---------------------------------------------------------------- lot et export
async function computeAll() {
  const todo = S.pairs.filter((p) => Compare.pairKind(p) === 'both' && !p.res);
  if (!todo.length) { toast('Toutes les paires sont déjà calculées.', 2500); return; }
  const keep = S.cur;
  cancelAll();
  const job = newJob(); S.job = job;
  try {
    for (let n = 0; n < todo.length; n++) {
      if (job.cancelled) break;
      const p = todo[n];
      const r = await computePair(p, job, { display: false, manual: null, label: `Page ${p.a + 1} ↔ ${p.b + 1} (${n + 1} / ${todo.length}) : `, base: n / todo.length, span: 1 / todo.length });
      r.worker.kill();
      p.res = { pct: r.diff.stats.percent, n: r.diff.stats.regions };
      renderPairs();
    }
    toast(job.cancelled ? 'Calcul annulé.' : 'Pourcentages calculés pour toutes les paires.', 3500);
  } catch (err) { if (!(err && err.cancelled)) { console.error(err); toast('Calcul impossible : ' + (err && err.message || err), 7000); } }
  finally { endProgress(); if (S.job === job) S.job = null; if (keep >= 0 && !S.sess && S.pairs[keep]) openPair(keep); }
}

const toBlob = (canvas) => new Promise((res) => canvas.toBlob(res, 'image/png'));
async function exportReport() {
  const both = S.pairs.map((p, i) => [p, i]).filter(([p]) => Compare.pairKind(p) === 'both');
  if (!both.length) return;
  const base = (n) => n.replace(/\.pdf( \(avec modifications\))?$/i, '').replace(/[\\/:*?"<>|]+/g, '_');
  const v = await askForm({
    title: 'Enregistrer la comparaison en PDF',
    intro: 'Une page par page comparée : superposition colorée, zones numérotées et légende. Le fichier n\'écrase jamais un fichier existant.',
    fields: [{ id: 'scope', label: 'Pages', type: 'radio', value: S.cur >= 0 ? 'cur' : 'all', options: [...(S.cur >= 0 ? [{ v: 'cur', t: 'Page affichée' }] : []), { v: 'all', t: `Toutes les paires comparables (${both.length})` }] }],
    okLabel: 'Choisir le dossier…',
  });
  if (!v) return;
  const list = v.scope === 'cur' ? both.filter(([, i]) => i === S.cur) : both;
  const dir = await api.pickDir(undefined);
  if (!dir) return;
  const keepCur = S.cur, hadSess = !!S.sess;
  cancelAll();
  const job = newJob(); S.job = job;
  const pages = [];
  try {
    for (let n = 0; n < list.length; n++) {
      if (job.cancelled) break;
      const [p, i] = list[n];
      const manual = i === keepCur && S.manual ? S.manual : null;
      const r = await computePair(p, job, { display: false, manual, label: `Export, page ${p.a + 1} ↔ ${p.b + 1} (${n + 1} / ${list.length}) : `, base: n / list.length, span: 0.9 / list.length });
      r.worker.kill();
      const d = r.diff, cv = document.createElement('canvas');
      await paintMap(cv, new Uint8Array(d.map), d.frame.W, d.frame.H, S.pal);
      const blob = await toBlob(cv);
      cv.width = 0; cv.height = 0;
      if (!blob) throw new Error('image trop grande pour être encodée (réduisez la résolution).');
      p.res = { pct: d.stats.percent, n: d.stats.regions };
      pages.push({
        png: new Uint8Array(await blob.arrayBuffer()), W: d.frame.W, H: d.frame.H, k: r.k, regions: d.regions, pal: S.pal, mmPerPx: d.mmPerPx, tolMm: S.tolMm, stats: d.stats,
        title: `Ancien : ${S.a.name}, p. ${p.a + 1} — Nouveau : ${S.b.name}, p. ${p.b + 1}`, shiftMm: [r.shift.dx * d.mmPerPx, r.shift.dy * d.mmPerPx],
        note: d.frame.sameSize ? '' : 'formats différents : zone commune seulement',
      });
      renderPairs();
    }
    if (job.cancelled) { toast('Export annulé : rien n\'a été écrit.', 4000); return; }
    progress('Écriture du PDF…', 0.95);
    const bytes = await CompareReport.buildReport(PDFLib, PdfEdit, pages);
    const res = await api.writeMany(dir, [{ name: `Comparaison ${base(S.a.name)} et ${base(S.b.name)}.pdf`, bytes }]);
    toast(`Comparaison enregistrée : « ${res.written[0]} » (${plural(pages.length, 'page', 'pages')}).`, 8000);
    S.lastExport = { dir, name: res.written[0], pages: pages.length };
  } catch (err) { console.error(err); toast('Export impossible : ' + (err && err.message || err), 9000); }
  finally { endProgress(); if (S.job === job) S.job = null; if (hadSess && !S.sess && S.pairs[keepCur]) openPair(keepCur); }
}

// ---------------------------------------------------------------- ouverture / fermeture
export function isOpen() { return S.open; }
export async function open(active) {
  if (S.open) return;
  loadPrefs();
  S.open = true;
  $('cmpws').hidden = false;
  $('cmp-c-old').value = S.pal.old; $('cmp-c-new').value = S.pal.nu; $('cmp-c-same').value = S.pal.same;
  $('cmp-tol').value = String(S.tolMm); $('cmp-res').value = String(S.maxSide);
  fillSelect('a'); fillSelect('b');
  setMode('overlay');
  S.view.setPage(null); renderPairs(); renderAll();
  const docs = store.docs;
  const ai = active ? docs.findIndex((d) => d.id === active.id) : -1;
  if (docs.length >= 2 && ai >= 0) {
    const oldDoc = docs[ai > 0 ? ai - 1 : 1];
    $('cmp-doc-a').value = 'tab:' + oldDoc.id; $('cmp-doc-b').value = 'tab:' + active.id;
    await loadSide('a', 'tab:' + oldDoc.id);
    await loadSide('b', 'tab:' + active.id);
  } else {
    if (active) { $('cmp-doc-a').value = 'tab:' + active.id; await loadSide('a', 'tab:' + active.id); }
    else resetPairs();
  }
  $('cmp-doc-a').focus();
}
export function close() {
  if (!S.open) return;
  cancelAll();
  clearTimeout(rediffTimer);
  if (S.worker) { S.worker.kill(); S.worker = null; }
  releaseSess(S.sess); S.sess = null;
  S.view.setPage(null);
  dropSide('a'); dropSide('b');
  for (const f of S.files) { try { f.pdf.destroy(); } catch { /* ignoré */ } }
  S.files = []; S.pairs = []; S.cur = -1; S.manual = null;
  endProgress(); setMsg('');
  S.open = false;
  $('cmpws').hidden = true;
}

export function initCompare() {
  S.view = createView();
  S.view.onZoom = (z) => { $('cmp-zoomval').textContent = Math.round(z * 100) + ' %'; };
  S.view.onBox = (d) => { if (d.i !== undefined) focusItem(Number(d.i)); };
  for (const side of ['a', 'b']) $('cmp-doc-' + side).addEventListener('change', (e) => loadSide(side, e.target.value));
  for (const b of document.querySelectorAll('.cmp-mode')) b.addEventListener('click', () => setMode(b.dataset.mode));
  for (const id of ['cmp-c-old', 'cmp-c-new', 'cmp-c-same']) $(id).addEventListener('input', recolor);
  $('cmp-fade').addEventListener('input', (e) => { if (S.blink) stopBlink(); S.view.setFade(Number(e.target.value) / 100); });
  $('cmp-blink').addEventListener('click', toggleBlink);
  $('cmp-tol').addEventListener('input', (e) => { const v = Number(e.target.value); if (v >= 0 && v <= 10) { S.tolMm = v; savePrefs(); rediffSoon(); } });
  $('cmp-res').addEventListener('change', (e) => { S.maxSide = Number(e.target.value); savePrefs(); S.pairs.forEach((p) => { p.res = null; }); if (S.cur >= 0) openPair(S.cur); });
  $('cmp-sh-l').addEventListener('click', () => nudge(-1, 0)); $('cmp-sh-r').addEventListener('click', () => nudge(1, 0));
  $('cmp-sh-u').addEventListener('click', () => nudge(0, -1)); $('cmp-sh-d').addEventListener('click', () => nudge(0, 1));
  $('cmp-dx').addEventListener('change', typedShift); $('cmp-dy').addEventListener('change', typedShift);
  $('cmp-auto').addEventListener('click', () => { S.manual = null; rediff('auto'); });
  $('cmp-zero').addEventListener('click', () => { const s = S.sess; if (!s) return; S.manual = { dx: 0, dy: 0, auto: false }; s.shift = S.manual; rediff(S.manual); });
  $('cmp-prev').addEventListener('click', () => step(-1)); $('cmp-next').addEventListener('click', () => step(1));
  $('cmp-zin').addEventListener('click', () => S.view.setZoom(S.view.z * 1.25)); $('cmp-zout').addEventListener('click', () => S.view.setZoom(S.view.z / 1.25));
  $('cmp-fit').addEventListener('click', () => S.view.fit());
  $('cmp-cancel').addEventListener('click', () => { if (S.job) S.job.cancel(); else endProgress(); });
  $('cmp-all').addEventListener('click', computeAll);
  $('cmp-add-pair').addEventListener('click', () => { if (!(S.a && S.b)) return; S.pairs.push({ a: Math.min(S.a.n - 1, 0), b: Math.min(S.b.n - 1, 0) }); renderPairs(); renderAll(); });
  $('cmp-export').addEventListener('click', exportReport);
  $('cmp-close').addEventListener('click', close);
  $('cmpws').addEventListener('keydown', (e) => {
    const t = e.target;
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (S.job) S.job.cancel(); else if (document.getElementById('pgdlg').hidden) close();
      return;
    }
    if (e.key === 'F3') { e.preventDefault(); step(e.shiftKey ? -1 : 1); return; }
    if (!(t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA'))) e.stopPropagation();
  });
}
