// Effects for the opening: paper fibres from the tear, confetti when the lid pops, petals (starlight for the
// rare one) when the colour floods in, a column of light, and the silhouette that floods with colour from the
// top down.
import * as THREE from 'three';
import { glowTexture, bell } from './util.js';

/**
 * Additive light for beams and columns: brightest at the bottom, soft at its edges (it fades as the surface
 * turns side-on to the camera), gone before it reaches the top.
 */
export function beamMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, opacity: { value: 0 } },
    vertexShader: `varying float vUp; varying float vFace;
      void main() {
        vUp = uv.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFace = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 color; uniform float opacity; varying float vUp; varying float vFace;
      void main() { gl_FragColor = vec4(color, opacity * pow(vFace, 2.2) * pow(1.0 - vUp, 1.6)); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

// ------------------------------------------------------------------ the silhouette flood
/**
 * Shared by whichever Sprout is on stage: below `uSilLine` (a world height) it's a flat, dark silhouette;
 * above it, its own colours. Sweeping the line from above the head to below the feet floods it with colour.
 */
export const flood = {
  uSilLine: { value: 99 },
  uSilAmt: { value: 0 },
  uSilColor: { value: new THREE.Color(0x151935) },
};

/** Gives a model's materials the silhouette, once each, alongside any patch they already carry. */
export function floodable(object) {
  object.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      if (m.userData.flood) continue;
      m.userData.flood = true;
      const before = m.onBeforeCompile;
      // three.js caches shaders by patch source; key on the patch already there too, so two materials with
      // different earlier patches never share a program
      const key = m.customProgramCacheKey.call(m);
      m.onBeforeCompile = (sh, r) => {
        before?.call(m, sh, r);
        Object.assign(sh.uniforms, flood);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying float vSilY;')
          .replace('#include <project_vertex>', '#include <project_vertex>\nvSilY = (modelMatrix * vec4(transformed, 1.0)).y;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying float vSilY;\nuniform float uSilLine, uSilAmt;\nuniform vec3 uSilColor;')
          .replace('#include <tonemapping_fragment>', `{
            float dark = uSilAmt * (1.0 - smoothstep(uSilLine - 0.14, uSilLine + 0.14, vSilY));
            gl_FragColor.rgb = mix(gl_FragColor.rgb, uSilColor, dark);
          }
          #include <tonemapping_fragment>`);
      };
      m.customProgramCacheKey = () => `${key}|flood`;
      m.needsUpdate = true;
    }
  });
}

// ------------------------------------------------------------------ particles
const PLANE = new THREE.PlaneGeometry(1, 1);
const ROUND = new THREE.SphereGeometry(1, 8, 6);
const KINDS = {
  // [count, geometry, size range, gravity, drag, life range]
  fibre: { count: 50, geo: PLANE, size: [0.02, 0.035], gravity: -2.2, drag: 2.5, life: [0.45, 0.8], shape: [1, 0.22, 1] },
  paper: { count: 70, geo: PLANE, size: [0.05, 0.085], gravity: -4.2, drag: 0.9, life: [1.5, 2.1], shape: [1, 0.6, 1] },
  petal: { count: 60, geo: ROUND, size: [0.045, 0.07], gravity: -1.3, drag: 1.4, life: [2.0, 2.8], shape: [1, 0.25, 0.7] },
};

export class Fx {
  constructor() {
    this.group = new THREE.Group();
    this.items = {};
    this.mats = new Map();
    for (const [kind, k] of Object.entries(KINDS)) {
      this.items[kind] = Array.from({ length: k.count }, () => {
        const m = new THREE.Mesh(k.geo, this.mat(0xffffff));
        m.visible = false;
        m.userData = { v: new THREE.Vector3(), w: new THREE.Vector3(), age: 0, life: 1, size: 0.05, phase: 0 };
        this.group.add(m);
        return m;
      });
    }
    const glow = glowTexture('rgba(255,255,255,1)');
    this.stars = Array.from({ length: 46 }, () => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xe6ecff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.visible = false;
      s.userData = { v: new THREE.Vector3(), age: 0, life: 2, size: 0.1, phase: 0 };
      this.group.add(s);
      return s;
    });
  }

  mat(color) {
    if (!this.mats.has(color)) this.mats.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.75, side: THREE.DoubleSide }));
    return this.mats.get(color);
  }

  /** Throws `n` pieces of a kind from `origin` (world space). `spread` widens the source, `power` the throw. */
  burst(kind, origin, n, { colors = [0xffffff], power = 1, spread = 0.3, up = 1 } = {}) {
    const k = KINDS[kind];
    for (let i = 0; i < n; i++) {
      const m = this.items[kind].find((q) => !q.visible);
      if (!m) return;
      const u = m.userData, a = Math.random() * Math.PI * 2, r = Math.random() * spread;
      m.material = this.mat(colors[i % colors.length]);
      m.position.set(origin.x + Math.cos(a) * r, origin.y + Math.random() * 0.1, origin.z + Math.sin(a) * r);
      const out = (0.6 + Math.random() * 1.2) * power;
      u.v.set(Math.cos(a) * out, (1.8 + Math.random() * 2.2) * power * up, Math.sin(a) * out);
      u.w.set(Math.random() * 12 - 6, Math.random() * 12 - 6, Math.random() * 12 - 6);
      u.age = 0;
      u.life = k.life[0] + Math.random() * (k.life[1] - k.life[0]);
      u.size = k.size[0] + Math.random() * (k.size[1] - k.size[0]);
      u.phase = Math.random() * 10;
      m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      m.visible = true;
    }
  }

  /** Starlight for the rare one: soft points that drift up and twinkle. */
  starlight(origin, n, spread = 1.4) {
    for (let i = 0; i < n; i++) {
      const s = this.stars.find((q) => !q.visible);
      if (!s) return;
      const u = s.userData, a = Math.random() * Math.PI * 2, r = 0.2 + Math.random() * spread;
      s.position.set(origin.x + Math.cos(a) * r, origin.y + Math.random() * 1.6, origin.z + Math.sin(a) * r * 0.7);
      u.v.set((Math.random() - 0.5) * 0.3, 0.2 + Math.random() * 0.45, (Math.random() - 0.5) * 0.3);
      Object.assign(u, { age: 0, life: 1.8 + Math.random() * 1.4, size: 0.12 + Math.random() * 0.16, phase: Math.random() * 10 });
      s.visible = true;
    }
  }

  tick(dt) {
    for (const [kind, list] of Object.entries(this.items)) {
      const k = KINDS[kind];
      for (const m of list) {
        if (!m.visible) continue;
        const u = m.userData;
        u.age += dt;
        u.v.y += k.gravity * dt;
        u.v.multiplyScalar(Math.exp(-k.drag * dt));
        if (kind === 'petal') m.position.x += Math.sin(u.age * 4 + u.phase) * 0.25 * dt; // flutter
        m.position.addScaledVector(u.v, dt);
        m.rotation.x += u.w.x * dt; m.rotation.y += u.w.y * dt; m.rotation.z += u.w.z * dt;
        const fade = Math.min(1, (u.life - u.age) / (u.life * 0.25));
        m.scale.set(k.shape[0], k.shape[1], k.shape[2]).multiplyScalar(u.size * Math.max(1e-3, fade));
        if (u.age >= u.life || m.position.y < -0.2) m.visible = false;
      }
    }
    for (const s of this.stars) {
      if (!s.visible) continue;
      const u = s.userData;
      u.age += dt;
      s.position.addScaledVector(u.v, dt);
      s.material.opacity = bell(u.age / u.life) * (0.55 + 0.45 * Math.sin(u.age * 9 + u.phase));
      s.scale.setScalar(u.size);
      if (u.age >= u.life) { s.visible = false; s.material.opacity = 0; }
    }
  }
}
