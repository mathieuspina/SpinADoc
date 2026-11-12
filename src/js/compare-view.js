// Zone d'affichage de la comparaison : une ou deux fenêtres défilantes (côte à côte), zoom commun, calques de cadres.
// Les canevas (page ancienne, page nouvelle, superposition colorée) sont posés dans le repère « cadre » (px de rendu) et ne sont jamais recopiés :
// changer de mode ne fait que les déplacer d'un conteneur à l'autre (bascule instantanée).
import { $ } from './ui.js';

const el = (cls, tag) => { const e = document.createElement(tag || 'div'); if (cls) e.className = cls; return e; };

export function createView() {
  const paneA = $('cmp-pane-a'), paneB = $('cmp-pane-b');
  const mk = (pane) => {
    const sizer = el('cmp-sizer'), world = el('cmp-world'), layer = el('cmp-layer');
    sizer.append(world); pane.replaceChildren(sizer);
    return { pane, sizer, world, layer };
  };
  const A = mk(paneA), B = mk(paneB);
  const v = { mode: 'overlay', z: 1, page: null, cur: -1, fade: 1, boxes: [], textA: [], textB: [] };

  const place = (cv, x, y) => { cv.style.left = x + 'px'; cv.style.top = y + 'px'; cv.style.width = cv.width + 'px'; cv.style.height = cv.height + 'px'; };

  function applyZoom() {
    const p = v.page;
    for (const s of [A, B]) {
      const W = p ? p.frame.W : 0, H = p ? p.frame.H : 0;
      s.sizer.style.width = Math.ceil(W * v.z) + 'px'; s.sizer.style.height = Math.ceil(H * v.z) + 'px';
      s.world.style.width = W + 'px'; s.world.style.height = H + 'px';
      s.world.style.transform = `scale(${v.z})`;
      s.layer.style.setProperty('--bw', Math.max(1, 2 / v.z) + 'px');
      s.layer.style.setProperty('--fs', Math.max(10, 13 / v.z) + 'px');
    }
  }

  function boxDiv(cls, g, pad, label) {
    const d = el('cmp-box ' + cls);
    d.style.left = g.x0 - pad + 'px'; d.style.top = g.y0 - pad + 'px';
    d.style.width = g.x1 - g.x0 + 2 * pad + 'px'; d.style.height = g.y1 - g.y0 + 2 * pad + 'px';
    if (label) { const b = el('cmp-badge'); b.textContent = label; d.append(b); }
    return d;
  }
  function drawLayers() {
    A.layer.replaceChildren(); B.layer.replaceChildren();
    const p = v.page;
    if (!p) return;
    const pad = Math.max(3, Math.round(2 / (p.mmPerPx || 0.3)));
    if (v.mode === 'text') {
      const txt = (cls, t, ox, oy) => { const d = boxDiv(cls, { x0: t.x0 + ox, y0: t.y0 + oy, x1: t.x1 + ox, y1: t.y1 + oy }, 1); d.dataset.i = t.change; A.layer.append(d); };
      for (const t of v.textA) txt('del', t, p.frame.ax, p.frame.ay);
      for (const t of v.textB) txt('add', t, p.frame.bx, p.frame.by);
      return;
    }
    v.boxes.forEach((g, i) => {
      for (const s of v.mode === 'side' ? [A, B] : [A]) { const d = boxDiv('region' + (i === v.cur ? ' cur' : ''), g, pad, String(g.id)); d.dataset.i = i; s.layer.append(d); }
    });
  }

  function mount() {
    const p = v.page;
    A.world.replaceChildren(); B.world.replaceChildren();
    if (!p) { paneB.hidden = true; return; }
    const { frame: f } = p;
    place(p.cvA, f.ax, f.ay); place(p.cvB, f.bx, f.by); place(p.cvMap, 0, 0);
    for (const c of [p.cvA, p.cvB, p.cvMap]) c.style.opacity = '';
    paneB.hidden = v.mode !== 'side';
    if (v.mode === 'overlay') A.world.append(p.cvMap, A.layer);
    else if (v.mode === 'fade') { A.world.append(p.cvB, p.cvA, A.layer); p.cvA.style.opacity = String(1 - v.fade); }
    else if (v.mode === 'side') { A.world.append(p.cvA, A.layer); B.world.append(p.cvB, B.layer); }
    else { p.cvB.style.opacity = '0.45'; A.world.append(p.cvB, A.layer); }
    A.world.classList.toggle('cmp-dark', v.mode !== 'overlay'); B.world.classList.add('cmp-dark');
    drawLayers(); applyZoom();
  }

  // synchronisation du défilement (côte à côte)
  let syncing = false;
  for (const [src, dst] of [[paneA, paneB], [paneB, paneA]]) {
    src.addEventListener('scroll', () => {
      if (syncing || v.mode !== 'side') return;
      syncing = true; dst.scrollLeft = src.scrollLeft; dst.scrollTop = src.scrollTop;
      requestAnimationFrame(() => { syncing = false; });
    });
  }
  // déplacement à la souris, zoom Ctrl + molette
  for (const pane of [paneA, paneB]) {
    let drag = null;
    pane.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.cmp-box')) return;
      drag = { x: e.clientX, y: e.clientY, sl: pane.scrollLeft, st: pane.scrollTop };
      pane.setPointerCapture(e.pointerId); pane.classList.add('panning');
    });
    pane.addEventListener('pointermove', (e) => { if (drag) { pane.scrollLeft = drag.sl - (e.clientX - drag.x); pane.scrollTop = drag.st - (e.clientY - drag.y); } });
    const end = () => { drag = null; pane.classList.remove('panning'); };
    pane.addEventListener('pointerup', end); pane.addEventListener('pointercancel', end);
    pane.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const r = pane.getBoundingClientRect();
      v.setZoom(v.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15), { x: e.clientX - r.left, y: e.clientY - r.top }, pane);
    }, { passive: false });
    pane.addEventListener('click', (e) => { const b = e.target.closest('.cmp-box'); if (b && v.onBox) v.onBox(b.dataset); });
  }

  // ---- API
  v.setPage = (page) => { v.page = page; v.cur = -1; v.boxes = page ? page.regions : []; v.textA = []; v.textB = []; mount(); if (page) v.fit(); };
  v.setMode = (m) => { v.mode = m; mount(); };
  v.setFade = (t) => { v.fade = t; if (v.page && v.mode === 'fade') v.page.cvA.style.opacity = String(1 - t); };
  v.setText = (a, b) => { v.textA = a; v.textB = b; if (v.mode === 'text') drawLayers(); };
  v.relayout = (frame, regions, mmPerPx) => { Object.assign(v.page, { frame, regions, mmPerPx }); v.boxes = regions; v.cur = -1; mount(); };
  v.setZoom = (z, anchor, pane) => {
    const p0 = pane || paneA;
    const nz = Math.min(8, Math.max(0.03, z));
    const ax = anchor ? anchor.x : p0.clientWidth / 2, ay = anchor ? anchor.y : p0.clientHeight / 2;
    const wx = (p0.scrollLeft + ax) / v.z, wy = (p0.scrollTop + ay) / v.z;
    v.z = nz; applyZoom();
    for (const pn of [paneA, paneB]) { pn.scrollLeft = wx * nz - ax; pn.scrollTop = wy * nz - ay; }
    if (v.onZoom) v.onZoom(nz);
  };
  v.fit = () => {
    if (!v.page) return;
    const w = (v.mode === 'side' ? paneA.clientWidth : paneA.clientWidth) - 4, h = paneA.clientHeight - 4;
    v.setZoom(Math.min(w / v.page.frame.W, h / v.page.frame.H, 4), { x: 0, y: 0 }, paneA);
    paneA.scrollLeft = 0; paneA.scrollTop = 0; paneB.scrollLeft = 0; paneB.scrollTop = 0;
  };
  // Centre une zone (repère cadre) dans la fenêtre et la met en évidence.
  v.focusBox = (i, rect) => {
    v.cur = i;
    for (const s of [A, B]) s.layer.querySelectorAll('.cmp-box').forEach((d) => d.classList.toggle('cur', Number(d.dataset.i) === i && v.mode !== 'text'));
    if (!rect) return;
    for (const pn of [paneA, paneB]) {
      pn.scrollLeft = ((rect.x0 + rect.x1) / 2) * v.z - pn.clientWidth / 2;
      pn.scrollTop = ((rect.y0 + rect.y1) / 2) * v.z - pn.clientHeight / 2;
    }
  };
  v.markText = (idx) => { for (const d of A.layer.querySelectorAll('.cmp-box')) d.classList.toggle('cur', Number(d.dataset.i) === idx); };
  v.panes = { a: paneA, b: paneB };
  return v;
}
