import * as THREE from 'three';

// The URL switches for testing (?sprout, ?tell, ?break, ?sky, ?demo, ?debug) only work on this computer,
// so nobody can use them on the live site to pick a Sprout or skip a break.
const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
export const testParams = new URLSearchParams(local ? location.search : '');

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
export const motionScale = () => (reducedMotion.matches ? 0.45 : 1);

export const ease = {
  linear: (p) => p,
  inOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  out: (p) => 1 - Math.pow(1 - p, 3),
  in: (p) => p * p * p,
  // a small, soft overshoot
  outBack: (p) => { const c = 1.35, c3 = c + 1; return 1 + c3 * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); },
  // a card panel landing on a table: falls, then one tiny bounce
  land: (p) => {
    if (p < 0.72) { const q = p / 0.72; return q * q; }
    const q = (p - 0.72) / 0.28;
    return 1 - Math.sin(q * Math.PI) * 0.035;
  },
};

const tweens = new Set();
/** Runs fn(easedProgress, rawProgress) over `seconds`. Resolves when done. */
export function animate(seconds, fn, easing = ease.inOut) {
  const duration = seconds * (reducedMotion.matches ? 0.55 : 1);
  return new Promise((resolve) => {
    if (duration <= 0) { fn(1, 1); resolve(); return; }
    tweens.add({ t: 0, duration, fn, easing, resolve });
  });
}
export const wait = (seconds) => animate(seconds, () => {}, ease.linear);
export function tickTweens(dt) {
  for (const tw of [...tweens]) {
    tw.t += dt;
    const p = Math.min(1, tw.t / tw.duration);
    tw.fn(tw.easing(p), p);
    if (p >= 1) { tweens.delete(tw); tw.resolve(); }
  }
}

export const clamp = THREE.MathUtils.clamp;
export const smooth = THREE.MathUtils.smoothstep;
export const bell = (p) => Math.sin(Math.PI * clamp(p, 0, 1));

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...opts }));
  return matCache.get(key);
}

export function shadowed(obj, cast = true, receive = true) {
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = receive; } });
  return obj;
}

/** Radial glow texture for halos and light pools. */
export function glowTexture(inner = 'rgba(255,255,255,1)', size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  // eased falloff so the halo never shows an edge
  for (let i = 1; i <= 8; i++) { const u = i / 8; grd.addColorStop(u, `rgba(255,255,255,${Math.pow(1 - u, 2.2).toFixed(3)})`); }
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Teardrop silhouette (Sprout's head) as a 2D path, for printed box art. */
export function dropPath(ctx, cx, cy, h) {
  const m = 1.45;
  let max = 0;
  for (let i = 0; i <= 200; i++) { const t = (i / 200) * Math.PI; max = Math.max(max, Math.sin(t) * Math.pow(Math.sin(t / 2), m)); }
  const w = h * 0.8;
  ctx.beginPath();
  for (let i = 0; i <= 120; i++) {
    const t = (i / 120) * Math.PI * 2;
    const tt = t <= Math.PI ? t : 2 * Math.PI - t;
    const r = (Math.sin(tt) * Math.pow(Math.sin(tt / 2), m)) / max;
    const x = cx + (t <= Math.PI ? 1 : -1) * r * w / 2;
    const y = cy - (Math.cos(tt) * h) / 2;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
}

export function isDark() {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

export function storage() {
  const KEY = 'sprout-little-moments-s01', PHOTO_KEY = 'sprout-s01-photo';
  // ?demo: a fresh collection with no breaks, kept only in memory, so trying things never touches the real one
  if (testParams.has('demo')) {
    let photo = null;
    return { load: () => ({ counts: {}, unlocks: 999 }), save() {}, photo: () => photo, savePhoto(url) { photo = url; } };
  }
  return {
    load() {
      try { return JSON.parse(localStorage.getItem(KEY)) || { counts: {} }; } catch { return { counts: {} }; }
    },
    save(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode: keep it in memory */ } },
    photo() { try { return localStorage.getItem(PHOTO_KEY); } catch { return null; } },
    savePhoto(url) { try { localStorage.setItem(PHOTO_KEY, url); } catch { /* storage full or private: it still shows, just isn't kept */ } },
  };
}
