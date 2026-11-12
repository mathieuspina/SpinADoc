// Panneau de propriétés (à droite) : réglages de l'objet sélectionné, ou de l'outil actif pour la prochaine création.
import { $, bus, store } from './ui.js';
import * as A from './annotate.js';
import * as Settings from './settings.js';

const { Shapes } = window;
// Le panneau ne s'ouvre tout seul (à la sélection d'un objet / au choix d'un outil) que si l'utilisateur
// l'a activé avec le bouton « Propriétés » du ruban (réglage mémorisé, désactivé par défaut).
export const isManualOpen = () => !!Settings.get('propsAuto');
export function toggle() { Settings.set('propsAuto', !Settings.get('propsAuto')); refresh(); }

const toHex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
const fromHex = (h) => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

// Valeur affichée : celle du premier objet concerné.
function valueOf(ctx, f) {
  const o = ctx.objs.find((x) => f.types.includes(x.type));
  if (o && f.k === 'bgColor') return o.bgColor || o.bgAuto;
  if (o && (f.k === 'withDate' || f.k === 'withUser') && !ctx.virtual) return f.k === 'withDate' ? !!o.date : !!o.user;
  return o ? (f.get ? f.get(o) : o[f.k]) : undefined;
}

function row(label, control, extraClass) {
  const r = document.createElement('div');
  r.className = 'prop-row' + (extraClass ? ' ' + extraClass : '');
  const l = document.createElement('label');
  l.textContent = label;
  r.append(l, control);
  if (control.id) l.htmlFor = control.id;
  return r;
}

let seq = 0;
function control(doc, f, val) {
  const id = `prop-${++seq}`;
  const apply = (v) => A.setProp(doc, f.k, v, f.types);
  const mark = (el) => { el.dataset.fkey = f.k + (f.label || ''); return el; };
  const wrap = (...els) => { const d = document.createElement('div'); d.className = 'prop-ctl'; d.append(...els); return d; };
  const input = (type, extra) => { const i = document.createElement('input'); i.type = type; i.id = id; Object.assign(i, extra || {}); return mark(i); };

  if (f.kind === 'color') {
    const i = input('color', { value: toHex(val || [0, 0, 0]) });
    i.addEventListener('change', () => apply(fromHex(i.value)));
    return i;
  }
  if (f.kind === 'colorOrNone') {
    const none = document.createElement('label');
    none.className = 'chk';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !val;
    cb.dataset.fkey = f.k + f.label + 'none';
    none.append(cb, document.createTextNode(' Aucun'));
    const i = input('color', { value: toHex(val || [1, 1, 0.6]) });
    i.disabled = !val;
    cb.addEventListener('change', () => apply(cb.checked ? null : fromHex(i.value)));
    i.addEventListener('change', () => apply(fromHex(i.value)));
    return wrap(i, none);
  }
  if (f.kind === 'text') {
    const i = input('text', { value: val === undefined || val === null ? '' : val, maxLength: 40 });
    i.addEventListener('change', () => { if (i.value.trim() || f.empty) apply(i.value.trim()); });
    return i;
  }
  if (f.kind === 'textarea') {
    const t = document.createElement('textarea');
    t.id = id; t.rows = 3; t.value = val === undefined || val === null ? '' : val; mark(t);
    t.addEventListener('change', () => apply(t.value));
    return t;
  }
  if (f.kind === 'number') {
    const i = input('number', { min: f.min, max: f.max, step: f.step, value: val === undefined || val === null ? '' : val });
    i.addEventListener('change', () => { const n = Number(i.value); if (!Number.isNaN(n)) apply(Math.min(f.max, Math.max(f.min, n))); });
    return i;
  }
  if (f.kind === 'optnum') {
    const none = document.createElement('label');
    none.className = 'chk';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !(val > 0);
    cb.dataset.fkey = f.k + f.label + 'auto';
    none.append(cb, document.createTextNode(' Auto'));
    const i = input('number', { min: f.min, max: f.max, step: f.step, value: val > 0 ? val : f.def });
    i.disabled = !(val > 0);
    cb.addEventListener('change', () => apply(cb.checked ? null : Number(i.value) || f.def));
    i.addEventListener('change', () => apply(Math.min(f.max, Math.max(f.min, Number(i.value) || f.def))));
    return wrap(i, none);
  }
  if (f.kind === 'range') {
    const i = input('range', { min: 5, max: 100, step: 5, value: Math.round((val === undefined ? 1 : val) * 100) });
    const out = document.createElement('span');
    out.className = 'muted';
    out.textContent = i.value + ' %'; // insécable : « 100 % » ne se coupe jamais
    i.addEventListener('input', () => { out.textContent = i.value + ' %'; });
    i.addEventListener('change', () => apply(Number(i.value) / 100));
    return wrap(i, out);
  }
  if (f.kind === 'select') {
    const s = document.createElement('select');
    s.id = id;
    mark(s);
    for (const [v, t] of f.options) { const o = document.createElement('option'); o.value = v; o.textContent = t; if (v === (val || f.options[0][0])) o.selected = true; s.append(o); }
    s.addEventListener('change', () => apply(s.value));
    return s;
  }
  if (f.kind === 'bool') {
    const i = input('checkbox', { checked: !!val });
    i.addEventListener('change', () => apply(i.checked));
    return i;
  }
  return document.createElement('span');
}

function render(doc, ctx) {
  const focus = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fkey : null;
  const body = $('props-body');
  body.replaceChildren();
  const title = ctx.virtual
    ? `Outil : ${Shapes.LABELS[[...ctx.types][0]] || ''}`
    : ctx.objs.length === 1 ? Shapes.LABELS[ctx.objs[0].type] || 'Objet' : `${ctx.objs.length} objets`;
  $('props-title').textContent = title;
  // Lignes regroupées par rubrique (ordre de première apparition) : une rubrique n'apparaît qu'une fois.
  const groups = new Map();
  for (const f of A.FIELDS) {
    if (!f.types.some((t) => ctx.types.has(t))) continue;
    if (f.when) { const rel = ctx.objs.filter((o) => f.types.includes(o.type)); if (!rel.length || !rel.every(f.when)) continue; } // champ propre à un sous-type
    const isText = ['text', 'font', 'bold', 'italic', 'size', 'align', 'bgMode', 'bgColor'].includes(f.k) || (f.k === 'width' && f.kind === 'optnum');
    const group = f.group || (isText ? 'Texte' : 'Aspect');
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(row(f.label, control(doc, f, valueOf(ctx, f)), f.kind === 'bool' ? 'inline' : ''));
  }
  for (const [group, rows] of groups) { const h = document.createElement('h3'); h.textContent = group; body.append(h, ...rows); }
  // Texte remplacé : police d'origine → police standard retenue (modifiable ci-dessus)
  const rep = !ctx.virtual && ctx.objs.length === 1 && ctx.objs[0].type === 'replace' ? ctx.objs[0] : null;
  if (rep && rep.origFont) {
    const p = document.createElement('p');
    p.className = 'prop-note';
    const now = window.TextInfo.fontLabel(rep);
    p.textContent = `Police d'origine : ${rep.origFont} → remplacée par ${now}.` + (rep.origEmbedded ? ' La police d\'origine est incorporée en sous-ensemble : elle ne peut pas être réutilisée.' : '');
    body.append(p);
  }
  if (!body.children.length) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'Aucun réglage pour cet objet.'; body.append(p); }
  if (focus) { const el = body.querySelector(`[data-fkey="${CSS.escape(focus)}"]`); if (el) el.focus(); }
}

export function refresh() {
  const doc = store.active;
  const ctx = doc ? A.propsContext(doc) : null;
  const open = !!ctx && isManualOpen();
  $('props').hidden = !open;
  if (open) render(doc, ctx);
  bus.emit('view', doc);
}

// Largeur du panneau : glisser le bord gauche (#props-resize), flèches gauche / droite au clavier, double-clic = largeur par défaut.
// Bornes = min-width / max-width du CSS (et 60 % de la fenêtre) ; largeur mémorisée dans le réglage propsWidth.
function initResize() {
  const panel = $('props'), grip = $('props-resize');
  const bounds = () => { const s = getComputedStyle(panel); return [parseFloat(s.minWidth) || 240, Math.max(parseFloat(s.minWidth) || 240, Math.min(parseFloat(s.maxWidth) || 520, window.innerWidth * 0.6))]; };
  const setW = (w, save) => {
    const [lo, hi] = bounds();
    const v = Math.round(Math.min(hi, Math.max(lo, w)));
    panel.style.width = v + 'px';
    if (save) { Settings.set('propsWidth', v); bus.emit('view', store.active); }
    return v;
  };
  const saved = Number(Settings.get('propsWidth'));
  if (saved > 0) setW(saved, false);
  let drag = null;
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    drag = { x: e.clientX, w: panel.getBoundingClientRect().width };
    grip.setPointerCapture(e.pointerId);
    grip.classList.add('active');
  });
  grip.addEventListener('pointermove', (e) => { if (drag) setW(drag.w + (drag.x - e.clientX), false); });
  const end = () => { if (!drag) return; drag = null; grip.classList.remove('active'); setW(panel.getBoundingClientRect().width, true); };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('lostpointercapture', end);
  grip.addEventListener('dblclick', () => { panel.style.width = ''; Settings.set('propsWidth', null); bus.emit('view', store.active); });
  grip.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setW(panel.getBoundingClientRect().width + (e.key === 'ArrowLeft' ? 16 : -16), true);
  });
}

export function initProps() {
  initResize();
  const applyPin = () => {
    const pinned = !!Settings.get('pinProps');
    $('props').classList.toggle('pinned', pinned);
    $('props-pin').setAttribute('aria-pressed', String(pinned));
  };
  applyPin();
  $('props-pin').addEventListener('click', () => { Settings.set('pinProps', !Settings.get('pinProps')); applyPin(); bus.emit('view', store.active); });
  bus.on('doc-changed', () => refresh());
  bus.on('tool', () => refresh());
  refresh();
}
