import { spring, follower, prefersReduced } from './spring.js';

const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function initProgress() {
  const bar = document.getElementById('progress');
  if (!bar) return;
  let queued = false;
  const paint = () => {
    queued = false;
    const max = document.documentElement.scrollHeight - innerHeight;
    const p = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
    bar.style.transform = `scaleX(${p})`;
  };
  const on = () => { if (!queued) { queued = true; requestAnimationFrame(paint); } };
  addEventListener('scroll', on, { passive: true });
  addEventListener('resize', on, { passive: true });
  paint();
}

// Scroll-reveal: spring entrance. Sections reveal on arrival; [data-stagger] groups reveal
// their [data-item] children one after another.
export function initReveal() {
  const sections = $$('[data-reveal]');
  const groups = $$('[data-stagger]');
  if (prefersReduced() || !('IntersectionObserver' in window)) {
    sections.forEach((t) => t.classList.add('is-in'));
    $$('[data-item]').forEach((t) => t.classList.add('is-in'));
    return;
  }
  const play = (el, delay) => {
    el.classList.add('is-run');
    spring({
      from: 0, to: 1, stiffness: 140, damping: 16, delay,
      onUpdate: (p) => {
        el.style.opacity = String(Math.min(1, Math.max(0, p * 1.2)));
        el.style.transform = `translate3d(0,${(1 - p) * 28}px,0)`;
      },
      onDone: () => { el.style.opacity = ''; el.style.transform = ''; el.classList.add('is-in'); },
    });
  };
  const opts = { threshold: 0.12, rootMargin: '0px 0px -6% 0px' };
  const secIo = new IntersectionObserver((entries) => {
    let n = 0;
    for (const e of entries) if (e.isIntersecting) { secIo.unobserve(e.target); play(e.target, n++ * 70); }
  }, opts);
  const grpIo = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      grpIo.unobserve(e.target);
      $$('[data-item]', e.target).forEach((k, i) => play(k, 80 + i * 70));
    }
  }, opts);
  sections.forEach((t) => secIo.observe(t));
  groups.forEach((t) => grpIo.observe(t));
}

// Hero parallax: pointer + scroll feed spring followers, one per depth layer.
export function initParallax() {
  const hero = document.querySelector('[data-parallax]');
  if (!hero || prefersReduced()) return;
  const layers = $$('[data-depth]', hero).map((el) => {
    const depth = parseFloat(el.dataset.depth);
    const f = follower({
      stiffness: 70 + depth * 40, damping: 14 + depth * 4,
      onUpdate: (x, y) => { el.style.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0)`; },
    });
    return { depth, f };
  });
  let px = 0;
  let py = 0;
  const aim = () => {
    const rect = hero.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > innerHeight) return;
    const sy = Math.min(0, -rect.top) * -1;
    for (const l of layers) l.f.set(px * l.depth * 22, py * l.depth * 16 + sy * l.depth * 0.18);
  };
  hero.addEventListener('pointermove', (e) => {
    const r = hero.getBoundingClientRect();
    px = ((e.clientX - r.left) / r.width - 0.5) * 2;
    py = ((e.clientY - r.top) / r.height - 0.5) * 2;
    aim();
  });
  hero.addEventListener('pointerleave', () => { px = 0; py = 0; aim(); });
  addEventListener('scroll', aim, { passive: true });
  aim();
}

// Spotlight: one delegated listener writes pointer coordinates onto the hovered surface.
export function initSpotlight() {
  if (prefersReduced()) return;
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest?.('[data-spotlight]');
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${(e.clientX - r.left).toFixed(1)}px`);
    el.style.setProperty('--my', `${(e.clientY - r.top).toFixed(1)}px`);
  }, { passive: true });
}
