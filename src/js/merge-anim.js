// Animation de fusion (signature visuelle) : les miniatures se détachent, tournent en spirale autour du centre en rétrécissant, puis se
// rejoignent dans la page rouge du logo (la feuille du dessus, avec ses trois lignes blanches) qui se pose et devient la carte du résultat.
// Web Animations API uniquement (aucune bibliothèque), ~1,2 s. Réglage « Animations » : full = spirale ; reduced = simple fondu ; none = aucun effet.
const NS = 'http://www.w3.org/2000/svg';
const DURATION = 1200;
const STAGGER = 160;

// La page rouge du logo (build/logo.svg : rect 80 × 116, pli en haut à droite, trois lignes blanches), en SVG autonome.
export function redPageSvg() {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '82 64 92 128');
  svg.setAttribute('width', '120'); svg.setAttribute('height', '167');
  svg.innerHTML = '<defs><linearGradient id="mwdeep" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E0272F"/><stop offset="1" stop-color="#5E0710"/></linearGradient></defs>'
    + '<rect x="88" y="70" width="80" height="116" rx="9" fill="url(#mwdeep)"/><path d="M142 70 L168 96 H142 Z" fill="#fff" fill-opacity="0.28"/>'
    + '<rect x="102" y="116" width="52" height="7" rx="3.5" fill="#F5F5F5" fill-opacity="0.92"/><rect x="102" y="134" width="52" height="7" rx="3.5" fill="#F5F5F5" fill-opacity="0.92"/>'
    + '<rect x="102" y="152" width="32" height="7" rx="3.5" fill="#F5F5F5" fill-opacity="0.92"/>';
  return svg;
}

const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);

// stage : conteneur (position: relative, plein écran) ; sources : [{ rect (DOMRect), node (élément à cloner : canvas / img), rotate }].
// Renvoie { done: Promise (animation terminée), result: élément de la page rouge, finish(label) }.
export function playMerge(stage, sources, mode, label) {
  stage.replaceChildren();
  stage.hidden = false;
  stage.dataset.mode = mode;
  const sr = stage.getBoundingClientRect();
  const cx = sr.width / 2, cy = sr.height / 2;

  const result = document.createElement('div');
  result.className = 'mw-result';
  result.append(redPageSvg());
  const cap = document.createElement('div');
  cap.className = 'mw-result-label';
  cap.textContent = label || 'Fusion en cours…';
  result.append(cap);
  const ring = document.createElement('i');
  ring.className = 'mw-ring';
  result.append(ring);
  stage.append(result);
  result.dataset.state = 'working';

  const ghosts = sources.map((s) => {
    const g = document.createElement('div');
    g.className = 'mw-ghost';
    const w = s.rect.width, h = s.rect.height;
    g.style.width = w + 'px'; g.style.height = h + 'px';
    g.style.left = cx - w / 2 + 'px'; g.style.top = cy - h / 2 + 'px';
    if (s.node) { const n = s.node.cloneNode(true); if (s.node.tagName === 'CANVAS') n.getContext('2d').drawImage(s.node, 0, 0); n.style.cssText = 'width:100%;height:100%;display:block'; g.append(n); }
    stage.append(g);
    return { g, dx: s.rect.left + w / 2 - sr.left - cx, dy: s.rect.top + h / 2 - sr.top - cy, rot: s.rotate || 0 };
  });

  const anims = [];
  let done;
  if (mode === 'none') {
    ghosts.forEach((x) => x.g.remove());
    result.dataset.state = 'working';
    done = Promise.resolve();
  } else if (mode === 'reduced') {
    ghosts.forEach((x) => { x.g.style.transform = `translate(${x.dx}px, ${x.dy}px) rotate(${x.rot}deg)`; anims.push(x.g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease-out', fill: 'forwards' })); });
    anims.push(result.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 140, easing: 'ease-out', fill: 'backwards' }));
    done = Promise.all(anims.map((a) => a.finished.catch(() => {}))).then(() => {});
  } else {
    const n = ghosts.length;
    ghosts.forEach((x, i) => {
      const r0 = Math.hypot(x.dx, x.dy);
      const a0 = Math.atan2(x.dy, x.dx);
      const bulge = Math.max(150, r0 * 0.35);
      const frames = [];
      const K = 24;
      for (let k = 0; k <= K; k++) {
        const u = k / K, e = ease(u);
        const ang = a0 + e * Math.PI * 3;                 // une fois et demie autour du centre
        const rad = r0 * (1 - e) + bulge * Math.sin(Math.PI * e) * 0.5 * (1 - e);
        const sc = 1 - 0.78 * e;
        frames.push({
          transform: `translate(${(rad * Math.cos(ang)).toFixed(1)}px, ${(rad * Math.sin(ang)).toFixed(1)}px) rotate(${(x.rot + e * 540).toFixed(1)}deg) scale(${sc.toFixed(3)})`,
          opacity: u < 0.82 ? 1 : 1 - (u - 0.82) / 0.18,
          offset: u,
        });
      }
      const delay = n > 1 ? (i / (n - 1)) * STAGGER : 0;
      anims.push(x.g.animate(frames, { duration: DURATION - STAGGER, delay, easing: 'linear', fill: 'both' }));
    });
    // la page rouge se pose au centre à la fin de la spirale
    anims.push(result.animate([
      { opacity: 0, transform: 'scale(.55) rotate(-14deg)' }, { opacity: 0, transform: 'scale(.55) rotate(-14deg)', offset: 0.6 },
      { opacity: 1, transform: 'scale(1.08) rotate(2deg)', offset: 0.88 }, { opacity: 1, transform: 'scale(1) rotate(0deg)' },
    ], { duration: DURATION, easing: 'ease-out', fill: 'backwards' }));
    done = Promise.all(anims.map((a) => a.finished.catch(() => {}))).then(() => { ghosts.forEach((x) => x.g.remove()); });
  }
  return {
    done,
    result,
    // calcul terminé : on retire l'indicateur de chargement
    finish(text) { result.dataset.state = 'done'; if (text) cap.textContent = text; },
    setLabel(text) { cap.textContent = text; },
    // le calcul dépasse l'animation : la page respire sobrement (boucle) tant que le travail continue
    loop() { if (mode !== 'none' && result.dataset.state === 'working') result.dataset.loop = '1'; },
    stop() { stage.replaceChildren(); stage.hidden = true; delete stage.dataset.mode; },
  };
}
