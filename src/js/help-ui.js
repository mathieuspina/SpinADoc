// Aide intégrée (bouton « Aide », F1) : vue plein écran sous la barre de titre (#helpws), sommaire cliquable, recherche simple (sans casse ni
// accents) qui filtre les rubriques, liens internes. Contenu statique : src/js/help-content.js. Aucun accès réseau (contenu dans le code).
import { $ } from './ui.js';
import { SECTIONS } from './help-content.js';

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
let built = false;
let lastFocus = null;

function build() {
  const nav = $('help-nav'), body = $('help-body');
  nav.replaceChildren(...SECTIONS.map((s) => {
    const a = document.createElement('a');
    a.href = '#aide-' + s.id; a.textContent = s.title; a.dataset.id = s.id;
    return a;
  }));
  body.innerHTML = SECTIONS.map((s) => `<section class="help-sec" id="aide-${s.id}" data-id="${s.id}"><h2>${s.title}</h2>${s.html}</section>`).join('');
  for (const sec of body.querySelectorAll('.help-sec')) sec.dataset.text = fold(sec.textContent);
  // liens du sommaire et liens internes : défilement dans la vue (jamais de navigation de la fenêtre)
  const go = (e) => {
    const a = e.target.closest('a[href^="#aide-"]');
    if (!a) return;
    e.preventDefault();
    show(a.getAttribute('href').slice(6));
  };
  nav.addEventListener('click', go);
  body.addEventListener('click', go);
  $('help-q').addEventListener('input', () => filter($('help-q').value));
  $('help-close').addEventListener('click', close);
  $('helpws').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if ($('help-q').value) { $('help-q').value = ''; filter(''); } else close(); }
    else if (e.key !== 'F1') e.stopPropagation(); // les raccourcis de l'application ne s'appliquent pas pendant la lecture
  });
  // version lue dans package.json par le processus principal (app.getVersion), jamais écrite en dur
  const api = window.spinadoc;
  if (api && api.getAbout) api.getAbout().then((i) => { $('help-version').textContent = 'Version ' + i.version; }).catch(() => {});
  built = true;
}

// Filtre : rubriques dont le texte contient tous les mots saisis. Renvoie le nombre de rubriques visibles.
export function filter(q) {
  const words = fold(q || '').split(/\s+/).filter(Boolean);
  let n = 0;
  for (const sec of $('help-body').querySelectorAll('.help-sec')) {
    const ok = words.every((w) => sec.dataset.text.includes(w));
    sec.hidden = !ok; if (ok) n++;
    const link = $('help-nav').querySelector(`a[data-id="${sec.dataset.id}"]`);
    if (link) link.hidden = !ok;
  }
  $('help-count').textContent = words.length ? (n ? `${n} rubrique${n > 1 ? 's' : ''}` : 'Aucune rubrique ne contient ces mots.') : '';
  return n;
}

export function show(id) {
  const sec = $('aide-' + id);
  if (!sec) return false;
  if (sec.hidden) { $('help-q').value = ''; filter(''); }
  sec.scrollIntoView({ block: 'start' });
  for (const a of $('help-nav').querySelectorAll('a')) a.classList.toggle('current', a.dataset.id === id);
  return true;
}

export const isOpen = () => !$('helpws').hidden;
export function open(id) {
  if (!built) build();
  lastFocus = document.activeElement;
  $('helpws').hidden = false;
  if (id) show(id); else $('help-body').scrollTop = 0;
  $('help-q').focus();
}
export function close() {
  $('helpws').hidden = true;
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}
export function initHelp() { $('btn-help').addEventListener('click', () => (isOpen() ? close() : open())); }
