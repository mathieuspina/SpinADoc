// Impression : boîte de dialogue (réglages, aperçu des feuilles), assemblage du PDF d'impression et envoi (print-main.js).
// Principe : le PDF « édité » (annotations figées comme à l'enregistrement) est découpé en feuilles à la taille exacte du papier
// (src/print-compose.js, placement par src/print-layout.js) ; le lecteur PDF de Chromium l'imprime sans rien remettre à l'échelle.
// Couleur → niveaux de gris / noir et blanc et renforcement des traits fins passent par la rasterisation (print-raster.js).
import { $, api, toast, busy } from './ui.js';
import * as V from './viewer.js';
import * as Settings from './settings.js';
import { guardOutput } from './redact-guard.js';

const { PDFLib, PdfEdit, PrintLayout: L, PrintCompose: C, PageOps } = window;

const st = { margin: L.DEFAULT_MARGIN, hard: null, doc: null, printers: [], caps: {}, cache: null, previewIdx: 0, token: 0, plan: null, timer: 0 };
const val = (id) => $(id).value;
const chk = (id) => $(id).checked;

// ----------------------------------------------------------------------------- PDF « édité » (mis en cache par état du document)
async function editedOf(doc, annots, meas) {
  const key = `${doc.id}|${doc.stateId}|${annots}|${meas}`;
  if (st.cache && st.cache.key === key) return st.cache;
  const edits = doc.edits.filter((e) => (/^m-/.test(e.type) ? meas : annots));
  let bytes = doc.bytes;
  if (edits.length || (doc.numbering && doc.numbering.length) || doc.form || doc.runtime.flatten || !PageOps.isIdentity(doc.pages, V.getPdf(doc).numPages)) bytes = await V.exportBytes(doc, null, { edits, measure: { include: true } });
  st.cache = { key, bytes, infos: await C.pageInfos(PDFLib, bytes) };
  return st.cache;
}

// ----------------------------------------------------------------------------- réglages du formulaire
function paperChoice() {
  const v = val('pr-paper');
  if (!v || v === 'page') return { paperW: 0, paperH: 0, label: 'Format de la page' };
  const [w, h] = v.split('x').map(Number);
  return { paperW: w, paperH: h, label: $('pr-paper').selectedOptions[0].textContent };
}

function readOpts() {
  const m = L.normMargin(val('pr-margin'), st.margin); // jamais vide, jamais NaN : champ vide ou illisible = valeur précédente
  const p = paperChoice();
  return {
    device: val('pr-printer'), copies: Math.max(1, Math.min(99, Number(val('pr-copies')) || 1)), collate: chk('pr-collate'), duplex: val('pr-duplex'),
    pages: document.querySelector('input[name=pr-pages]:checked').value, range: val('pr-range'), nup: Number(val('pr-nup')),
    paper: val('pr-paper'), paperW: p.paperW, paperH: p.paperH, paperLabel: p.label, orientation: val('pr-orient'), mode: val('pr-scale'), percent: Number(val('pr-percent')) || 100,
    margins: { top: m, right: m, bottom: m, left: m }, margin: m, center: chk('pr-center'),
    color: val('pr-color'), thin: Math.max(0, Number(val('pr-thin')) || 0), dpi: Number(val('pr-dpi')), annots: chk('pr-annots'), meas: chk('pr-meas'),
  };
}
const needsRaster = (o) => o.color !== 'color' || o.thin > 0;

function fillPapers(caps) {
  const sel = $('pr-paper');
  const keep = sel.value;
  sel.replaceChildren();
  const add = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.append(o); };
  add('page', 'Format de la page');
  const seen = new Set();
  const list = [];
  if (caps && caps.papers && caps.papers.length) for (const p of caps.papers) list.push([p.name, Math.min(p.w, p.h), Math.max(p.w, p.h)]);
  else for (const [n, d] of Object.entries(L.PAPERS)) list.push([n, d[0], d[1]]);
  for (const [n, w, h] of list) {
    if (w < 50 || h < 50) continue;
    const k = Math.round(w) + 'x' + Math.round(h);
    if (seen.has(k)) continue;
    seen.add(k);
    add(w + 'x' + h, `${n} (${Math.round(w)} × ${Math.round(h)} mm)`);
  }
  if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
  else { const a4 = [...sel.options].find((o) => /^A4\b/.test(o.textContent)); sel.value = a4 ? a4.value : (sel.options[1] ? sel.options[1].value : 'page'); }
}

async function loadCaps(name) {
  if (!(name in st.caps)) st.caps[name] = await api.printCaps(name).catch(() => null);
  const caps = st.caps[name];
  fillPapers(caps);
  $('pr-duplex').disabled = !!caps && !caps.duplex;
  if ($('pr-duplex').disabled) $('pr-duplex').value = 'simplex';
  // « pas de couleur » annoncé par le pilote : simple information (note sous « Rendu »). « Couleur » reste sélectionnable, jamais de bascule automatique.
  $('pr-color').querySelector('option[value=color]').disabled = false;
  st.hard = caps && caps.hardMarginMm > 0 ? caps.hardMarginMm : null;
  $('pr-copies').max = String((caps && caps.maxCopies) || 99);
}

// Pages sélectionnées dans le panneau de miniatures (indices triés).
const selectedPages = (doc) => Array.from((doc.runtime.pageSel || new Set())).sort((a, b) => a - b);

// ----------------------------------------------------------------------------- plan d'impression
async function computePlan() {
  const o = readOpts();
  const doc = st.doc;
  const ed = await editedOf(doc, o.annots, o.meas);
  const n = ed.infos.length;
  let idx;
  if (o.pages === 'all') idx = Array.from({ length: n }, (_, i) => i);
  else if (o.pages === 'current') idx = [Math.min(doc.page, n - 1)];
  else if (o.pages === 'selected') { idx = selectedPages(doc).filter((k) => k < n); if (!idx.length) return { o, ed, error: 'Aucune miniature sélectionnée : sélectionnez des pages dans le panneau de miniatures (Ctrl ou Maj + clic).' }; }
  else { const r = L.parseRanges(o.range, n); if (r.error) return { o, ed, error: r.error }; idx = r.pages; }
  const sheets = [];
  const per = o.nup;
  for (let i = 0; i < idx.length; i += per) {
    const group = idx.slice(i, i + per);
    const plan = L.planSheet(group.map((p) => ed.infos[p]), Object.assign({}, o, { nup: per }));
    sheets.push({ pages: group, sheet: plan.sheet, plan });
  }
  return { o, ed, idx, sheets, groups: L.groupBySize(sheets) };
}

const sheetOf = (s) => ({
  w: s.sheet.w, h: s.sheet.h,
  items: s.plan.items.map((it, i) => ({ page: s.pages[i], scale: it.scale, rotate: it.rotate, x: it.x, y: it.y, w: it.w, h: it.h, clip: s.plan.cells[i] || s.plan.area })),
});

// ----------------------------------------------------------------------------- aperçu
async function refresh() {
  const token = ++st.token;
  let p;
  try { p = await computePlan(); } catch (e) { $('pr-warn').textContent = 'Erreur : ' + (e && e.message || e); return; }
  if (token !== st.token) return;
  st.plan = p;
  const ok = !p.error && !!p.o.device && p.sheets.length > 0;
  $('pr-ok').disabled = !ok; $('pr-winprint').disabled = !ok;
  $('pr-range').disabled = p.o.pages !== 'range';
  $('pr-percent').disabled = p.o.mode !== 'percent';
  $('pr-thin').disabled = false;
  { // notes : pilote sans couleur annoncée, imprimante PDF
    const caps = st.caps[val('pr-printer')];
    const notes = [];
    if (caps && caps.color === false) notes.push('Ce pilote n\'annonce pas la couleur.');
    if (L.isPdfPrinter(val('pr-printer')) && !needsRaster(p.o)) notes.push('Imprimante PDF : le résultat reste vectoriel.');
    $('pr-cnote').textContent = notes.join(' ');
  }
  $('pr-rnote').textContent = needsRaster(p.o) ? `Ce réglage rasterise l'impression à ${p.o.dpi} dpi : les traits vectoriels deviennent des pixels (plus lourd et plus lent, surtout en A1/A0).` : 'Impression vectorielle : les traits restent nets à toute échelle.';
  if (p.error) { $('pr-warn').textContent = p.error; $('pr-info').textContent = ''; $('pr-sheet').textContent = '–'; return; }
  st.previewIdx = Math.min(st.previewIdx, p.sheets.length - 1);
  const s = p.sheets[st.previewIdx];
  const it = s.plan.items[0];
  const sz = (pt) => Math.round(L.toMm(pt));
  const first = p.ed.infos[s.pages[0]];
  $('pr-sheet').textContent = `Feuille ${st.previewIdx + 1} / ${p.sheets.length}`;
  $('pr-info').textContent = `Papier : ${sz(s.sheet.w)} × ${sz(s.sheet.h)} mm · Page ${s.pages[0] + 1} : ${sz(first.w)} × ${sz(first.h)} mm · Échelle : ${it ? (it.scale * 100).toFixed(1).replace('.', ',') + ' %' : '–'}`
    + (p.groups.length > 1 ? ` · ${p.groups.length} tâches (formats de feuille différents)` : '');
  const warns = [...new Set(p.sheets.flatMap((x) => x.plan.warnings))];
  const hardMsg = hardwareMessage(p);
  if (hardMsg) warns.push(hardMsg);
  $('pr-warn').textContent = warns.join(' ');
  try {
    const bytes = await C.compose(PDFLib, p.ed.bytes, [sheetOf(s)]);
    if (token !== st.token) return;
    const pdf = await V.loadPdf(bytes);
    const page = await pdf.getPage(1);
    const box = $('pr-preview');
    const base = page.getViewport({ scale: 1 });
    const k = Math.min((box.clientWidth - 8) / base.width, (box.clientHeight - 8) / base.height);
    const vp = page.getViewport({ scale: k * (window.devicePixelRatio || 1) });
    const cv = $('pr-canvas');
    cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    cv.style.width = Math.ceil(base.width * k) + 'px'; cv.style.height = Math.ceil(base.height * k) + 'px';
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    pdf.destroy();
    cv.style.filter = p.o.color === 'gray' ? 'grayscale(1)' : p.o.color === 'bw' ? 'grayscale(1) contrast(100)' : '';
    // zone imprimable (marges) en pointillés
    const a = s.plan.area, m = $('pr-area');
    const cr = cv.getBoundingClientRect(), br = box.getBoundingClientRect();
    m.style.display = p.o.margin > 0 ? 'block' : 'none';
    m.style.left = cr.left - br.left + (a.x / s.sheet.w) * cr.width + 'px';
    m.style.top = cr.top - br.top + (1 - (a.y + a.h) / s.sheet.h) * cr.height + 'px';
    m.style.width = (a.w / s.sheet.w) * cr.width + 'px';
    m.style.height = (a.h / s.sheet.h) * cr.height + 'px';
    drawHard(p, s, cr, br);
  } catch (e) { $('pr-warn').textContent = 'Aperçu indisponible : ' + (e && e.message || e); }
}
// Marge matérielle de l'imprimante (bande non imprimable sur le pourtour de la feuille) : message chiffré si la marge choisie est trop petite
// ou si du contenu y entre (il serait coupé).
function hardwareMessage(p) {
  const hard = st.hard;
  if (!(hard > 0)) return '';
  const cut = Math.max(0, ...p.sheets.map((s) => L.hardwareCut(s.sheet, s.plan.items, hard).cutMm));
  const fmt = (v) => String(Math.round(v * 10) / 10).replace('.', ',');
  const low = p.o.margin < hard;
  if (!low && !cut) return '';
  return (low ? `La marge (${fmt(p.o.margin)} mm) est inférieure à la marge matérielle de l'imprimante (${fmt(hard)} mm). ` : '')
    + (cut ? `Jusqu'à ${fmt(cut)} mm de contenu seront coupés sur les bords (zone hachurée).` : 'Les bords de la feuille ne seront pas imprimés (zone hachurée).');
}
function drawHard(p, s, cr, br) {
  const el = $('pr-hard');
  const hard = st.hard;
  const show = hard > 0 && (p.o.margin < hard || L.hardwareCut(s.sheet, s.plan.items, hard).cutMm > 0);
  el.hidden = !show;
  if (!show) return;
  el.replaceChildren();
  el.style.left = cr.left - br.left + 'px'; el.style.top = cr.top - br.top + 'px'; el.style.width = cr.width + 'px'; el.style.height = cr.height + 'px';
  const kx = cr.width / L.toMm(s.sheet.w), ky = cr.height / L.toMm(s.sheet.h);
  const band = (l, t, w, h) => { const i = document.createElement('i'); Object.assign(i.style, { left: l + 'px', top: t + 'px', width: w + 'px', height: h + 'px' }); el.append(i); };
  const hx = hard * kx, hy = hard * ky;
  band(0, 0, cr.width, hy); band(0, cr.height - hy, cr.width, hy); band(0, hy, hx, cr.height - 2 * hy); band(cr.width - hx, hy, hx, cr.height - 2 * hy);
}

// Réglages par imprimante (marge, échelle, orientation, centrage) : userData/settings.json → printPrinters[nom].
function savePrinterSettings() {
  const name = val('pr-printer');
  if (!name) return;
  const all = Object.assign({}, Settings.get('printPrinters'));
  all[name] = { margin: L.normMargin(val('pr-margin'), st.margin), mode: val('pr-scale'), percent: Number(val('pr-percent')) || 100, orientation: val('pr-orient'), center: chk('pr-center') };
  Settings.set('printPrinters', all);
}
function applyPrinterSettings(name) {
  const s = (Settings.get('printPrinters') || {})[name] || {};
  const margin = L.normMargin(s.margin, L.defaultMargin(st.hard)); // défaut : 2 mm, jamais sous la marge matérielle connue
  st.margin = margin;
  $('pr-margin').value = String(margin);
  $('pr-scale').value = s.mode || 'fit';
  $('pr-percent').value = String(s.percent || 100);
  $('pr-orient').value = s.orientation || 'auto';
  $('pr-center').checked = s.center !== false;
}

const later = () => { clearTimeout(st.timer); st.timer = setTimeout(refresh, 120); };

// ----------------------------------------------------------------------------- impression
// La boîte se ferme tout de suite : une COPIE FIGÉE (PDF édité, feuilles, réglages) est confiée au processus principal, qui la compose, la
// rasterise (si demandé) et l'envoie dans une fenêtre cachée (voir print-main.js). L'interface n'attend rien et reste utilisable.
async function print(dialog) {
  const p = st.plan;
  if (!p || p.error || !p.sheets.length) return;
  const o = p.o;
  savePrinterSettings();
  Settings.set('print', { printer: o.device, copies: o.copies, collate: o.collate, duplex: o.duplex, nup: o.nup, paper: o.paper, orientation: o.orientation, mode: o.mode, percent: o.percent, margin: o.margin, center: o.center, color: o.color, thin: o.thin, dpi: o.dpi, annots: o.annots, meas: o.meas });
  const task = {
    name: st.doc.name,
    edBytes: p.ed.bytes,
    groups: p.groups.map((g) => ({ w: g.w, h: g.h, sheets: g.sheets.map(sheetOf) })),
    raster: needsRaster(o) ? { mode: o.color, dpi: o.dpi, thin: o.thin } : null,
    opts: { device: o.device, copies: o.copies, collate: o.collate, duplex: o.duplex, color: o.color === 'color', dialog: !!dialog },
  };
  let r;
  try { r = await api.printSubmit(task); } catch (e) { r = { ok: false, message: e && e.message || String(e) }; }
  if (r && r.ok) close();
  else toast('Impression impossible : ' + ((r && r.message) || 'erreur inconnue'), 7000);
}

// Notifications de la file d'impression (non bloquantes).
const pq = new Map();
function onPrintProgress(d) {
  const host = $('printq');
  let it = pq.get(d.id);
  if (!it) {
    const el = document.createElement('div');
    el.className = 'pq-item'; el.dataset.id = d.id;
    const name = document.createElement('div'); name.className = 'pq-name';
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'secondary';
    const status = document.createElement('div'); status.className = 'pq-status';
    const bar = document.createElement('div'); bar.className = 'pq-bar'; bar.append(document.createElement('i'));
    el.append(name, btn, status, bar);
    btn.addEventListener('click', () => { if (el.dataset.state === 'error' || el.dataset.state === 'done' || el.dataset.state === 'cancelled') { el.remove(); pq.delete(d.id); } else { btn.disabled = true; api.printCancel(d.id); } });
    host.append(el);
    it = { el, name, btn, status, bar };
    pq.set(d.id, it);
  }
  it.el.dataset.state = d.state;
  it.name.textContent = 'Impression : ' + d.name;
  it.name.title = d.name + (d.device ? ' → ' + d.device : '');
  const fin = d.state === 'done' || d.state === 'error' || d.state === 'cancelled';
  it.btn.textContent = fin ? 'Fermer' : 'Annuler';
  it.btn.disabled = false;
  it.bar.hidden = fin;
  it.bar.firstChild.style.width = Math.round((d.fraction || 0) * 100) + '%';
  let t;
  if (d.state === 'queued') t = 'En attente dans la file d\'impression…';
  else if (d.state === 'running') t = `Impression en cours : page ${d.sheet || 1} / ${d.total || '…'}` + (d.label ? ` (${d.label.toLowerCase()})` : '');
  else if (d.state === 'done') t = 'Envoyé à « ' + d.device + ' ».';
  else if (d.state === 'cancelled') t = 'Impression annulée.';
  else t = 'Impression impossible : ' + (d.message || 'erreur inconnue');
  it.status.textContent = t;
  if (d.state === 'done' || d.state === 'cancelled') setTimeout(() => { it.el.remove(); pq.delete(d.id); }, 4000);
}

// ----------------------------------------------------------------------------- ouverture
function restore(saved) {
  const s = saved || {};
  const set = (id, v) => { if (v !== undefined && v !== null) $(id).value = String(v); };
  set('pr-copies', s.copies); set('pr-duplex', s.duplex); set('pr-nup', s.nup);
  set('pr-color', s.color); set('pr-thin', s.thin); set('pr-dpi', s.dpi);
  if (s.collate !== undefined) $('pr-collate').checked = !!s.collate;
  if (s.annots !== undefined) $('pr-annots').checked = !!s.annots;
  if (s.meas !== undefined) $('pr-meas').checked = !!s.meas;
}

export async function openPrint(doc) {
  if (!doc) return;
  if (!(await guardOutput(doc, "L'impression"))) return; // zones à caviarder non appliquées : le texte dessous serait imprimé
  st.doc = doc; st.previewIdx = 0;
  const saved = Settings.get('print');
  restore(saved);
  $('pr-range').value = '';
  const nsel = selectedPages(doc).length;
  $('pr-sel-n').textContent = String(nsel);
  document.querySelector('input[name=pr-pages][value=selected]').disabled = nsel === 0;
  document.querySelector(`input[name=pr-pages][value=${nsel > 1 ? 'selected' : 'all'}]`).checked = true;
  $('printdlg').hidden = false;
  $('pr-ok').disabled = true;
  $('pr-warn').textContent = 'Recherche des imprimantes…';
  const list = await api.printPrinters().catch(() => []);
  st.printers = list;
  const sel = $('pr-printer');
  sel.replaceChildren();
  for (const pr of list) { const o = document.createElement('option'); o.value = pr.name; o.textContent = pr.displayName + (pr.isDefault ? ' (par défaut)' : ''); sel.append(o); }
  const want = (saved && saved.printer && list.some((x) => x.name === saved.printer)) ? saved.printer : (list.find((x) => x.isDefault) || list[0] || {}).name;
  if (want) sel.value = want;
  $('pr-warn').textContent = list.length ? '' : 'Aucune imprimante installée.';
  if (want) { await loadCaps(want); applyPrinterSettings(want); } else fillPapers(null);
  if (saved && saved.paper && [...$('pr-paper').options].some((o) => o.value === saved.paper)) $('pr-paper').value = saved.paper;
  refresh();
  $('pr-ok').focus();
}

function close() { $('printdlg').hidden = true; st.cache = null; }

export function initPrint() {
  const watch = ['pr-copies', 'pr-collate', 'pr-duplex', 'pr-range', 'pr-nup', 'pr-paper', 'pr-orient', 'pr-scale', 'pr-percent', 'pr-margin', 'pr-center', 'pr-color', 'pr-thin', 'pr-dpi', 'pr-annots', 'pr-meas'];
  for (const id of watch) { $(id).addEventListener('change', () => { st.previewIdx = 0; later(); }); $(id).addEventListener('input', later); }
  for (const r of document.querySelectorAll('input[name=pr-pages]')) r.addEventListener('change', () => { st.previewIdx = 0; later(); });
  $('pr-printer').addEventListener('change', async () => { const n = val('pr-printer'); await loadCaps(n); applyPrinterSettings(n); st.previewIdx = 0; later(); });
  // marge : un champ vidé ou illisible revient à la valeur précédente (jamais vide, jamais NaN)
  $('pr-margin').addEventListener('input', () => { const v = L.normMargin(val('pr-margin'), null); if (v !== null) st.margin = v; });
  $('pr-margin').addEventListener('change', () => { const v = L.normMargin(val('pr-margin'), st.margin); st.margin = v; $('pr-margin').value = String(v); savePrinterSettings(); });
  $('pr-margin').addEventListener('blur', () => { $('pr-margin').value = String(L.normMargin(val('pr-margin'), st.margin)); });
  for (const id of ['pr-scale', 'pr-percent', 'pr-orient', 'pr-center']) $(id).addEventListener('change', savePrinterSettings);
  api.onPrintProgress(onPrintProgress);
  $('pr-prev').addEventListener('click', () => { if (st.previewIdx > 0) { st.previewIdx--; refresh(); } });
  $('pr-next').addEventListener('click', () => { if (st.plan && st.plan.sheets && st.previewIdx < st.plan.sheets.length - 1) { st.previewIdx++; refresh(); } });
  $('pr-cancel').addEventListener('click', close);
  $('pr-ok').addEventListener('click', () => print(false));
  $('pr-winprint').addEventListener('click', () => print(true));
  $('pr-props').addEventListener('click', async () => { const r = await api.printProps(val('pr-printer')); if (!r || !r.ok) toast('Impossible d\'ouvrir les propriétés de l\'imprimante.', 4000); });
  $('printdlg').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'SELECT' && !$('pr-ok').disabled) { e.preventDefault(); e.stopPropagation(); print(false); }
    else e.stopPropagation();
  }, true);
}
