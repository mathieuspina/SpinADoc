// Réglage des animations (Complètes / Réduites / Aucune) et animation de démarrage « Spin ».
import { $, api } from './ui.js';

let mode = 'full';

function apply() { document.body.dataset.anim = mode; }

export async function initAnim() {
  const s = await api.getSettings();
  mode = s.anim || (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full');
  apply();
}

export const getAnim = () => mode;

export function setAnim(m) {
  mode = m;
  apply();
  api.setSettings({ anim: m });
}

// Démarrage (~900 ms, non bloquant) : les feuilles s'ouvrent en éventail depuis la page du dessus, puis se posent.
// Chaque feuille fantôme est dans un groupe déjà tourné de son angle final ; on anime donc la feuille
// de -angle vers 0 autour de son centre (= centre du logo), ce qui l'amène de « empilée » à « en éventail ».
export function startupSpin() {
  if (mode !== 'full') return;
  const mark = $('brand-mark');
  mark.querySelectorAll('.ghost').forEach((g, i) => {
    const a = Number(g.dataset.angle);
    g.animate(
      [{ transform: `rotate(${-a}deg)`, opacity: 0 }, { transform: 'rotate(0deg)', opacity: 1 }],
      { duration: 650, delay: i * 120, easing: 'cubic-bezier(.2, .8, .2, 1)', fill: 'backwards' }
    );
  });
  mark.querySelector('.top').animate(
    [{ transform: 'scale(.8)' }, { transform: 'scale(1.08)', offset: 0.5 }, { transform: 'scale(1)' }],
    { duration: 900, easing: 'ease-out' }
  );
}
