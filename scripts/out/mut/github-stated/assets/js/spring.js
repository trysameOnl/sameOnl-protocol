// Damped-spring solver. One shared rAF loop integrates every active simulation
// with a fixed sub-step (semi-implicit Euler), so behaviour does not depend on frame rate.
export const prefersReduced = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const active = new Set();
let raf = 0;
let last = 0;
const SUB = 1 / 240;

function frame(t) {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  for (const sim of [...active]) if (sim.step(dt)) active.delete(sim);
  raf = active.size ? requestAnimationFrame(frame) : 0;
}
function schedule(sim) {
  active.add(sim);
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
}

export function integrate(state, to, k, c, m, dt) {
  const n = Math.max(1, Math.ceil(dt / SUB));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const a = (-k * (state.x - to) - c * state.v) / m;
    state.v += a * h;
    state.x += state.v * h;
  }
}

// One-shot spring from -> to.
export function spring({ from = 0, to = 1, stiffness = 170, damping = 22, mass = 1, delay = 0, rest = 0.001, onUpdate, onDone }) {
  if (prefersReduced()) { onUpdate?.(to); onDone?.(); return { stop() {} }; }
  const s = { x: from, v: 0 };
  let wait = delay / 1000;
  const sim = {
    step(dt) {
      if (wait > 0) { wait -= dt; return false; }
      integrate(s, to, stiffness, damping, mass, dt);
      if (Math.abs(s.x - to) < rest && Math.abs(s.v) < rest) { onUpdate(to); onDone?.(); return true; }
      onUpdate(s.x);
      return false;
    },
  };
  schedule(sim);
  return { stop() { active.delete(sim); } };
}

export const critical = (stiffness) => 2 * Math.sqrt(stiffness);

// Count a number toward a target with a critically damped spring (no overshoot).
export function countTo({ from, to, format, apply, stiffness = 90, delay = 0 }) {
  if (from === to || prefersReduced()) { apply(format(to)); return { stop() {} }; }
  return spring({
    from: 0, to: 1, stiffness, damping: critical(stiffness), delay, rest: 0.0005,
    onUpdate: (p) => apply(format(from + (to - from) * Math.min(1, Math.max(0, p)))),
  });
}

// A value that chases a moving target (used for pointer / scroll parallax).
export function follower({ stiffness = 90, damping = 16, mass = 1, onUpdate }) {
  const sx = { x: 0, v: 0 };
  const sy = { x: 0, v: 0 };
  let tx = 0;
  let ty = 0;
  let live = false;
  const sim = {
    step(dt) {
      integrate(sx, tx, stiffness, damping, mass, dt);
      integrate(sy, ty, stiffness, damping, mass, dt);
      onUpdate(sx.x, sy.x);
      const done = Math.abs(sx.x - tx) < 0.01 && Math.abs(sy.x - ty) < 0.01 && Math.abs(sx.v) < 0.01 && Math.abs(sy.v) < 0.01;
      if (done) live = false;
      return done;
    },
  };
  return {
    set(x, y) {
      tx = x; ty = y;
      if (prefersReduced()) { onUpdate(0, 0); return; }
      if (!live) { live = true; schedule(sim); }
    },
  };
}
