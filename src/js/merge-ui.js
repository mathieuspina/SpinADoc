// Espace de fusion (plein écran) : cartes de fichiers (miniature, nom, nombre de pages, plage, rotation), réordonnées par glisser-déposer ;
// bouton « Fusionner » : le travail se fait dans un Web Worker (merge-worker.js), le résultat s'ouvre dans un nouvel onglet non enregistré.
import { $, api, store, toast } from './ui.js';
import { loadPdf } from './pdfjs-load.js';
import * as V from './viewer.js';
import { askForm } from './pages-ui.js';
import { getAnim } from './anim.js';
import { playMerge } from './merge-anim.js';
import { guardOutput } from './redact-guard.js';

const { PrintLayout: L } = window;
const THUMB_W = 132;
const DND = 'application/x-spinadoc-merge';

// Branché par app.js : ouvre les octets fusionnés dans un nouvel onglet.
export const hooks = { openResult: async () => {} };
const st = { items: [], seq: 0, running: false, worker: null };

export const isOpen = () => !$('mergews').hidden;
export const isRunning = () => st.running;
export const items = () => st.items; // lecture seule (tests)

export function open() {
  if (isOpen()) return;
  $('mergews').hidden = false;
  render();
  $('mw-add').focus();
}
export function close() {
  if (st.running) return;
  $('mergews').hidden = true;
  $('mw-menu').hidden = true;
  st.items = [];
  render();
}

// ---------------------------------------------------------------- ajout de fichiers
// Sonde un PDF (mot de passe si chiffré), rend la miniature de sa première page.
async function probe(name, bytes) {
  let password = '';
  let msg = '';
  for (;;) {
    try {
      const pdf = await loadPdf(bytes, password ? { password } : {});
      const page = await pdf.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const k = (THUMB_W * (window.devicePixelRatio || 1)) / base.width;
      const vp = page.getViewport({ scale: k });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      canvas.style.width = '100%'; canvas.style.height = '100%';
      const n = pdf.numPages;
      pdf.destroy();
      return { n, canvas, ratio: base.height / base.width, password };
    } catch (e) {
      if (e && e.name === 'PasswordException') {
        const v = await askForm({
          title: 'PDF protégé', intro: `« ${name} » est protégé par un mot de passe.${msg ? ' ' + msg : ''}`,
          fields: [{ id: 'pw', label: 'Mot de passe', type: 'password', value: '' }], okLabel: 'Ouvrir',
        });
        if (!v) return { error: `« ${name} » ignoré : protégé par un mot de passe.` };
        password = v.pw;
        msg = 'Mot de passe incorrect, réessayez.';
        continue;
      }
      return { error: `« ${name} » ignoré : fichier illisible ou abîmé.` };
    }
  }
}

export async function addBytes(name, bytes) {
  const p = await probe(name, bytes);
  if (p.error) { toast(p.error, 6000); return false; }
  st.items.push({ id: ++st.seq, name, bytes, n: p.n, thumb: p.canvas, ratio: p.ratio, password: p.password, range: '', rotate: 0 });
  render();
  return true;
}

export async function addPaths(paths) {
  for (const p of paths) {
    try { const f = await api.readFile(p, { noRecent: true }); await addBytes(f.name, f.bytes); }
    catch { toast(`Impossible de lire « ${String(p).split(/[\\/]/).pop()} ».`, 5000); }
  }
}

async function addFromDialog() { const paths = await api.openDialog(); if (paths && paths.length) await addPaths(paths); }

// Depuis les onglets ouverts : avec ou sans leurs modifications non enregistrées.
function openTabsMenu(btn) {
  const m = $('mw-menu');
  if (!m.hidden) { m.hidden = true; return; }
  m.replaceChildren();
  if (!store.docs.length) { const e = document.createElement('div'); e.className = 'menu-empty'; e.textContent = 'Aucun document ouvert.'; m.append(e); }
  const lab = document.createElement('label');
  lab.className = 'chk';
  lab.style.cssText = 'display:flex;gap:6px;padding:8px 12px;color:var(--text-2)';
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.id = 'mw-incl'; cb.checked = true;
  lab.append(cb, ' Inclure les modifications non enregistrées');
  for (const doc of store.docs) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'recent-item'; b.setAttribute('role', 'menuitem');
    b.textContent = doc.name + (doc.dirty ? ' (modifié)' : '');
    b.addEventListener('click', async () => {
      m.hidden = true;
      const incl = cb.checked;
      const g = await guardOutput(doc, 'La fusion');
      if (!g) return;
      // caviardage appliqué à l'instant : le document modifié est TOUJOURS celui qui est ajouté (l'original contient encore le texte)
      try { await addBytes(doc.name, (incl && doc.dirty) || g === 'applied' ? await V.exportBytes(doc) : doc.bytes.slice()); } catch (err) { toast('Impossible d\'ajouter ce document : ' + (err && err.message || err), 6000); }
    });
    m.append(b);
  }
  m.append(lab);
  const r = btn.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 360)) + 'px';
  m.style.top = r.bottom + 6 + 'px';
  m.hidden = false;
}

// ---------------------------------------------------------------- cartes
// Pages retenues d'un fichier : { pages: [indices] } ou { error }.
function pagesOf(it) {
  if (!it.range.trim()) return { pages: Array.from({ length: it.n }, (_, i) => i) };
  const r = L.parseRanges(it.range, it.n);
  return r.error ? { error: r.error } : { pages: r.pages };
}

function summary() {
  const ok = st.items.length && st.items.every((it) => !pagesOf(it).error);
  const total = st.items.reduce((a, it) => a + (pagesOf(it).pages || []).length, 0);
  $('mw-summary').textContent = st.items.length ? `${st.items.length} fichier${st.items.length > 1 ? 's' : ''} · ${total} page${total > 1 ? 's' : ''}` : '';
  $('mw-go').disabled = !ok || st.running;
  $('mw-empty').hidden = st.items.length > 0;
}

function render() {
  const host = $('mw-cards');
  host.replaceChildren();
  st.items.forEach((it, i) => {
    const card = document.createElement('div');
    card.className = 'mw-card';
    card.draggable = true;
    card.dataset.id = it.id;
    const frame = document.createElement('div');
    frame.className = 'mw-thumb';
    const rotated = it.rotate % 180 !== 0;
    const w = THUMB_W, h = Math.round(THUMB_W * it.ratio);
    frame.style.width = Math.max(w, h) + 'px'; frame.style.height = Math.max(w, h) + 'px';
    const inner = document.createElement('div');
    inner.className = 'mw-thumb-in';
    inner.style.width = w + 'px'; inner.style.height = h + 'px';
    inner.style.transform = `rotate(${it.rotate}deg)`;
    inner.append(it.thumb);
    frame.append(inner);
    const num = document.createElement('span');
    num.className = 'mw-num'; num.textContent = String(i + 1);
    frame.append(num);
    const name = document.createElement('div');
    name.className = 'mw-name'; name.textContent = it.name; name.title = it.name;
    const info = document.createElement('div');
    info.className = 'mw-info small muted';
    const range = document.createElement('input');
    range.type = 'text'; range.className = 'mw-range'; range.placeholder = `Toutes (1-${it.n})`; range.value = it.range;
    range.setAttribute('aria-label', `Pages de ${it.name}`);
    const refreshInfo = () => {
      const r = pagesOf(it);
      range.classList.toggle('invalid', !!r.error);
      info.textContent = r.error ? r.error : `${it.n} page${it.n > 1 ? 's' : ''}` + (it.range.trim() ? ` · ${r.pages.length} retenue${r.pages.length > 1 ? 's' : ''}` : '') + (it.password ? ' · protégé' : '');
      info.classList.toggle('err', !!r.error);
      summary();
    };
    range.addEventListener('input', () => { it.range = range.value; refreshInfo(); });
    range.addEventListener('mousedown', (e) => e.stopPropagation());
    const tools = document.createElement('div');
    tools.className = 'mw-tools';
    const btn = (icon, label, fn) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'icon-btn'; b.title = label; b.setAttribute('aria-label', label);
      const ic = document.createElement('span'); ic.className = 'ico'; ic.dataset.icon = icon;
      b.append(ic);
      b.addEventListener('click', fn);
      return b;
    };
    tools.append(
      btn('rotate-ccw', 'Pivoter à gauche', () => { it.rotate = (it.rotate + 270) % 360; render(); }),
      btn('rotate-cw', 'Pivoter à droite', () => { it.rotate = (it.rotate + 90) % 360; render(); }),
      btn('trash-2', 'Retirer de la fusion', () => { st.items = st.items.filter((x) => x !== it); render(); }),
    );
    card.append(frame, name, info, range, tools);
    refreshInfo();
    // réordonnancement par glisser-déposer
    card.addEventListener('dragstart', (e) => { e.dataTransfer.setData(DND, String(it.id)); e.dataTransfer.effectAllowed = 'move'; card.classList.add('dragging'); });
    card.addEventListener('dragend', () => host.querySelectorAll('.mw-card').forEach((c) => c.classList.remove('dragging', 'drop-before', 'drop-after')));
    card.addEventListener('dragover', (e) => {
      if (!Array.from(e.dataTransfer.types).includes(DND)) return;
      e.preventDefault();
      const r = card.getBoundingClientRect();
      host.querySelectorAll('.mw-card').forEach((c) => c.classList.remove('drop-before', 'drop-after'));
      card.classList.add(e.clientX > r.left + r.width / 2 ? 'drop-after' : 'drop-before');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drop-before', 'drop-after'));
    card.addEventListener('drop', (e) => {
      const id = Number(e.dataTransfer.getData(DND));
      if (!id) return;
      e.preventDefault();
      const r = card.getBoundingClientRect();
      const after = e.clientX > r.left + r.width / 2;
      const moving = st.items.find((x) => x.id === id);
      if (!moving || moving === it) { render(); return; }
      st.items = st.items.filter((x) => x !== moving);
      const at = st.items.indexOf(it) + (after ? 1 : 0);
      st.items.splice(at, 0, moving);
      render();
    });
    host.append(card);
  });
  summary();
}

// ---------------------------------------------------------------- fusion
async function go() {
  if (st.running || !st.items.length) return;
  const items = st.items.slice();
  const files = items.map((it) => ({ name: it.name, title: L.cleanName(it.name), bytes: it.bytes.slice().buffer, password: it.password, pages: pagesOf(it).pages, rotate: it.rotate }));
  const total = files.reduce((a, f) => a + f.pages.length, 0);
  st.running = true;
  $('mw-go').disabled = true; $('mw-add').disabled = true; $('mw-tabs').disabled = true; $('mw-cancel').disabled = true;
  const mode = getAnim();
  const cards = Array.from($('mw-cards').querySelectorAll('.mw-card'));
  const sources = cards.map((c, i) => ({ rect: c.querySelector('.mw-thumb-in').getBoundingClientRect(), node: c.querySelector('canvas'), rotate: items[i].rotate }));
  const stage = $('mw-stage');
  $('mw-body').style.visibility = 'hidden';
  const anim = playMerge(stage, sources, mode, 'Fusion en cours…');
  const work = new Promise((resolve, reject) => {
    const w = new Worker(new URL('./merge-worker.js', import.meta.url));
    st.worker = w;
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') anim.setLabel(m.label);
      else if (m.type === 'done') { w.terminate(); resolve(m); } else if (m.type === 'error') { w.terminate(); reject(new Error(m.message)); }
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'Erreur du worker de fusion')); };
    w.postMessage({ files, bookmarks: true, title: 'Fusion' }, files.map((f) => f.bytes));
  });
  anim.done.then(() => { if (st.running) anim.loop(); });
  try {
    const m = await work;
    await anim.done; // l'animation va toujours à son terme
    anim.finish(`Fusion terminée : ${m.stats.pages} pages`);
    await new Promise((r) => setTimeout(r, mode === 'none' ? 0 : 350));
    const bytes = new Uint8Array(m.bytes);
    st.running = false;
    st.items = [];
    $('mergews').hidden = true;
    anim.stop();
    await hooks.openResult('Fusion.pdf', bytes, m.stats);
  } catch (err) {
    st.running = false;
    anim.stop();
    toast('Fusion impossible : ' + (err && err.message || err), 9000);
  } finally {
    st.running = false;
    $('mw-body').style.visibility = '';
    $('mw-add').disabled = false; $('mw-tabs').disabled = false; $('mw-cancel').disabled = false;
    summary();
  }
}

export function initMerge() {
  $('mw-add').addEventListener('click', addFromDialog);
  $('mw-tabs').addEventListener('click', (e) => openTabsMenu(e.currentTarget));
  $('mw-cancel').addEventListener('click', close);
  $('mw-go').addEventListener('click', go);
  $('mergews').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!$('mw-menu').hidden) $('mw-menu').hidden = true; else close(); } else e.stopPropagation(); });
  document.addEventListener('mousedown', (e) => { if (!$('mw-menu').hidden && !e.target.closest('#mw-menu') && e.target !== $('mw-tabs')) $('mw-menu').hidden = true; });
  // dépôt de fichiers directement sur l'espace de fusion
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
  $('mergews').addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); $('mw-body').classList.add('dropping'); } });
  $('mergews').addEventListener('dragleave', (e) => { if (!e.relatedTarget || !$('mergews').contains(e.relatedTarget)) $('mw-body').classList.remove('dropping'); });
  $('mergews').addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); e.stopPropagation();
    $('mw-body').classList.remove('dropping');
    const paths = Array.from(e.dataTransfer.files).filter((f) => /\.pdf$/i.test(f.name)).map((f) => api.getPathForFile(f)).filter(Boolean);
    if (!paths.length) { toast('Déposez des fichiers PDF.'); return; }
    await addPaths(paths);
  });
}
