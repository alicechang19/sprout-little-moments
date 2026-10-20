// The garden the boxes are found in: the box print come to life, with rolling hills, a big leaf, flowers and a
// pebble path. It has two looks that follow the real sky (src/sky.js): dawn, and dusk with fireflies. Three nests
// hold the boxes; the flowers lean toward whichever one you point at, and the two you don't choose burrow away,
// leaving little mounds of soil.
import * as THREE from 'three';
import { animate, ease, bell, glowTexture, shadowed } from './util.js';
import { beamMaterial } from './fx.js';

const PALETTE = {
  dawn: { ground: 0x6cc884, near: 0x86d496, far: 0xa3dbab, farther: 0xbde4c3, leaf: 0x3f9d5d, rib: 0x9ddcac, stem: 0x3f9a5c, tuft: 0x58b874, pebble: 0xdcbf98, soil: 0x9c7048 },
  dusk: { ground: 0x4f8566, near: 0x5d8f70, far: 0x6f8f88, farther: 0x8a8fa6, leaf: 0x3a6e50, rib: 0x6f9f80, stem: 0x3a6e50, tuft: 0x467a5c, pebble: 0xa8907c, soil: 0x7a5a40 },
};
const PETALS = { dawn: [0xf6b8c8, 0xffd27a, 0xffffff, 0xf9a8bd], dusk: [0xd59ab2, 0xd8b679, 0xdcd8ee, 0xc99aba] };
const CENTRE = 0xffe2a0;

/**
 * Where the three nests sit (x, z), how big the boxes are in them and how they're turned, for this screen
 * shape; and, once the series is complete, where the six Sprouts live in the garden (`homes`, clear of the
 * nests, the leaf and the path) and how big they are there.
 */
export function nestLayout(aspect) {
  if (aspect >= 1.05) {
    return {
      nests: [[-2.55, -0.75], [0, 0.55], [2.5, -0.4]], scale: 0.78, yaw: [0.26, 0, -0.22],
      homes: [[-4.2, -2.5], [-1.35, -2.7], [1.3, -2.8], [4.05, -2.3], [-4.5, 1.3], [-1.3, 2.6]], homeScale: 0.62,
    };
  }
  // tall screens: a triangle, two at the back and one in front, so each box stays big enough to tap
  return {
    nests: [[-1.38, -1.7], [0, 0.75], [1.4, -1.3]], scale: 0.68, yaw: [0.2, 0, -0.18], tall: true,
    homes: [[-2.3, -3.7], [-0.75, -4.0], [0.8, -3.9], [2.35, -3.5], [-1.75, 1.45], [-2.45, -0.4]], homeScale: 0.56,
  };
}

function rng(seed) { // mulberry32: the same garden every visit
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SPHERE = new THREE.SphereGeometry(1, 40, 20);
const SPHERE_LO = new THREE.SphereGeometry(1, 10, 7);

export class Garden {
  constructor() {
    this.group = new THREE.Group();
    this.look = 'dawn';
    this.alpha = 1;
    this.focus = null;
    this.energy = [0, 0, 0];
    this.beamOn = 0; this.beamTarget = 0;
    this.gathering = false;
    const pal = PALETTE.dawn;
    const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 1, ...extra });
    this.mats = Object.fromEntries(Object.entries(pal).map(([k, c]) => [k, mat(c)]));
    this.mats.rib.side = this.mats.leaf.side = THREE.DoubleSide;
    this.petals = PETALS.dawn.map((c) => mat(c, { roughness: 0.8 }));
    this.centre = mat(CENTRE, { roughness: 0.7 });
    this.solid = [...Object.values(this.mats), ...this.petals, this.centre];

    // ground: a wide disc, its top a hair below the box bottoms so nothing fights for the same depth
    const ground = new THREE.Mesh(new THREE.CylinderGeometry(42, 42, 0.6, 96), this.mats.ground);
    ground.position.y = -0.31;
    ground.receiveShadow = true;
    this.group.add(ground);

    // rolling hills, fading into the sky with distance (the stage fog does the fading)
    const hill = (m, sx, sy, sz, x, y, z) => {
      const h = new THREE.Mesh(SPHERE, m);
      h.scale.set(sx, sy, sz); h.position.set(x, y, z); h.receiveShadow = true;
      this.group.add(h);
    };
    hill(this.mats.farther, 18, 5.2, 7, -10, -1.9, -30); hill(this.mats.farther, 16, 4.4, 7, 14, -1.6, -32);
    hill(this.mats.far, 12, 3.2, 5, -12, -1.3, -17); hill(this.mats.far, 13, 2.8, 5, 10, -1.2, -19);
    hill(this.mats.near, 5.8, 1.8, 3.2, -7, -0.85, -5.6); hill(this.mats.near, 6.5, 1.5, 3.4, 8.5, -0.8, -7.5);

    // the big leaf beside the middle nest
    const shape = new THREE.Shape();
    shape.moveTo(0, 0); shape.quadraticCurveTo(0.62, 0.55, 0, 1.6); shape.quadraticCurveTo(-0.62, 0.55, 0, 0);
    const leafGeo = new THREE.ShapeGeometry(shape, 24);
    const lp = leafGeo.attributes.position;
    for (let i = 0; i < lp.count; i++) { const y = lp.getY(i), x = lp.getX(i); lp.setZ(i, 0.22 * (y / 1.6) ** 2 + 0.12 * x * x); }
    leafGeo.computeVertexNormals();
    this.leaf = new THREE.Group();
    const blade = new THREE.Mesh(leafGeo, this.mats.leaf);
    const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 1.45, 6), this.mats.rib);
    rib.position.set(0, 0.72, 0.07); rib.rotation.x = -0.12;
    this.leafBlade = new THREE.Group();
    this.leafBlade.add(blade, rib);
    this.leafBlade.rotation.set(-0.42, -0.55, -0.32);
    this.leaf.add(this.leafBlade);
    shadowed(this.leaf);
    this.group.add(this.leaf);

    // pebbles curving away from the right-hand nest
    this.pebbles = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const p = new THREE.Mesh(SPHERE_LO, this.mats.pebble);
      const s = 0.13 + (i % 3) * 0.03;
      p.scale.set(s * 1.4, s * 0.45, s);
      p.userData.u = i / 8;
      p.receiveShadow = true;
      this.pebbles.add(p);
    }
    this.group.add(this.pebbles);

    // flowers and tufts of grass, kept clear of every nest in either layout
    const rand = rng(7);
    const clear = [...nestLayout(1.6).nests, ...nestLayout(0.5).nests];
    const free = (x, z, r) => clear.every(([nx, nz]) => Math.hypot(x - nx, z - nz) > r) && Math.hypot(x - 1.0, z - 1.2) > 0.7;
    this.flowers = [];
    for (let tries = 0; this.flowers.length < 26 && tries < 400; tries++) {
      const x = (rand() - 0.5) * 13, z = -6 + rand() * 10.5;
      if (!free(x, z, 1.3)) continue;
      const f = new THREE.Group();
      const h = 0.32 + rand() * 0.32;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.022, h, 5), this.mats.stem);
      stem.position.y = h / 2;
      const head = new THREE.Group();
      head.position.y = h;
      head.rotation.x = 0.55;
      const petal = this.petals[Math.floor(rand() * this.petals.length)];
      for (let k = 0; k < 5; k++) {
        const pm = new THREE.Mesh(SPHERE_LO, petal);
        const a = (k / 5) * Math.PI * 2;
        pm.position.set(Math.cos(a) * 0.06, 0, Math.sin(a) * 0.06);
        pm.scale.set(0.055, 0.02, 0.055);
        head.add(pm);
      }
      const c = new THREE.Mesh(SPHERE_LO, this.centre);
      c.scale.set(0.035, 0.025, 0.035);
      head.add(c);
      f.add(stem, head);
      f.position.set(x, 0, z);
      f.userData = { phase: rand() * Math.PI * 2, lx: 0, lz: 0 };
      shadowed(f, true, false);
      this.group.add(f);
      this.flowers.push(f);
    }
    const blade3 = new THREE.ConeGeometry(0.035, 0.26, 4);
    this.tufts = [];
    for (let tries = 0; this.tufts.length < 46 && tries < 600; tries++) {
      const x = (rand() - 0.5) * 15, z = -7 + rand() * 12;
      if (!free(x, z, 1.05)) continue;
      const t = new THREE.Group();
      for (let k = 0; k < 3; k++) {
        const b = new THREE.Mesh(blade3, this.mats.tuft);
        b.position.set((k - 1) * 0.04, 0.12, 0);
        b.rotation.z = (k - 1) * 0.35;
        t.add(b);
      }
      t.position.set(x, 0, z);
      t.rotation.y = rand() * Math.PI;
      t.userData = { phase: rand() * Math.PI * 2 };
      this.group.add(t);
      this.tufts.push(t);
    }

    // soil left behind where a box burrowed
    this.mounds = [0, 1, 2].map(() => {
      const m = new THREE.Group();
      const heap = new THREE.Mesh(SPHERE, this.mats.soil);
      heap.scale.set(0.62, 0.16, 0.5);
      m.add(heap);
      for (let k = 0; k < 5; k++) {
        const crumb = new THREE.Mesh(SPHERE_LO, this.mats.soil);
        const a = k * 1.3;
        crumb.position.set(Math.cos(a) * 0.62, 0.02, Math.sin(a) * 0.5);
        crumb.scale.setScalar(0.06 + (k % 2) * 0.03);
        m.add(crumb);
      }
      shadowed(m, false, true);
      m.visible = false;
      this.group.add(m);
      return m;
    });

    // puffs of soil when a box lands or burrows
    this.puffs = [];
    for (let i = 0; i < 60; i++) {
      const p = new THREE.Mesh(SPHERE_LO, this.mats.soil);
      p.visible = false;
      p.userData = { v: new THREE.Vector3(), age: 0, life: 1, size: 0.04 };
      this.group.add(p);
      this.puffs.push(p);
    }

    // fireflies, at dusk
    const glow = glowTexture('rgba(255,248,190,1)');
    this.flies = [];
    for (let i = 0; i < 30; i++) {
      const m = new THREE.SpriteMaterial({ map: glow, color: 0xfff3a8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      const s = new THREE.Sprite(m);
      s.scale.setScalar(0.16 + rand() * 0.1);
      s.userData = { home: new THREE.Vector3((rand() - 0.5) * 12, 0.4 + rand() * 2.6, -5 + rand() * 8), phase: rand() * 100, speed: 0.3 + rand() * 0.5 };
      s.position.copy(s.userData.home);
      this.group.add(s);
      this.flies.push(s);
    }
    this.fliesOn = 0;

    // a sunbeam that finds the chosen box: brightest where it lands, soft at its edges (it fades as the
    // surface turns side-on to the camera) and gone before it reaches the sky
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.3, 9, 48, 1, true), beamMaterial(0xfff3d6));
    this.beamDir = new THREE.Vector3(1.6, 7, 2.6).normalize();
    this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.beamDir);
    this.beam.visible = false;
    this.group.add(this.beam);

    // for fading: a depth-only twin of every solid mesh, drawn first, so the fading colour pass only ever
    // shows the nearest surface (no hill showing through another half-way)
    const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
    this.twins = [];
    this.group.traverse((o) => {
      if (!o.isMesh || !this.solid.includes(o.material)) return;
      const twin = new THREE.Mesh(o.geometry, depthOnly);
      twin.visible = false;
      twin.raycast = () => {};
      o.add(twin);
      this.twins.push(twin);
    });

    this.layout(1.6);
  }

  /** Re-seats the nest-side decor for a new screen shape. */
  layout(aspect) {
    this.lay = nestLayout(aspect);
    const [n0, n1, n2] = this.lay.nests, k = this.lay.scale / 0.78;
    // beside the middle box, on its right: the tear tab is on the left and must never be hidden.
    // On tall screens it moves round to the front so it doesn't hide the back row either.
    if (this.lay.tall) this.leaf.position.set(n1[0] + 1.0 * k, 0, n1[1] + 1.05 * k);
    else this.leaf.position.set(n1[0] + 0.95 * k, 0, n1[1] + 0.5 * k);
    this.leaf.scale.setScalar(k * (this.lay.tall ? 0.82 : 1));
    this.pebbles.children.forEach((p) => {
      const u = p.userData.u;
      p.position.set(n2[0] + (0.55 + 1.6 * u + 0.25 * Math.sin(u * 5)) * k, 0, n2[1] + (0.75 + 3.2 * u) * k);
    });
    this.mounds.forEach((m, i) => { m.position.set(this.lay.nests[i][0], 0, this.lay.nests[i][1]); m.scale.setScalar(k); });
  }

  /** Flowers within `r` of a point fold away (for the photo); `restore()` brings them back. */
  clearSpot(at, r) {
    for (const f of [...this.flowers, ...this.tufts]) {
      const near = Math.hypot(f.position.x - at.x, f.position.z - (at.z + 1)) < r;
      f.visible = !near;
    }
  }
  restore() { for (const f of [...this.flowers, ...this.tufts]) f.visible = true; }

  nestPos(i, out = new THREE.Vector3()) { const [x, z] = this.lay.nests[i]; return out.set(x, 0, z); }

  /** Lean toward a nest (or null for none). */
  react(i) { this.focus = i; if (i != null) this.energy[i] = Math.max(this.energy[i], 0.55); }
  /** The leaves around a nest stir, as when its box rattles. */
  rustle(i) { this.energy[i] = 1; }

  puff(pos, n = 10, power = 1) {
    for (let k = 0; k < n; k++) {
      const p = this.puffs.find((q) => !q.visible);
      if (!p) return;
      const a = Math.random() * Math.PI * 2, r = 0.25 + Math.random() * 0.35;
      p.position.set(pos.x + Math.cos(a) * r, 0.05, pos.z + Math.sin(a) * r * 0.8);
      p.userData.v.set(Math.cos(a) * (0.6 + Math.random()) * power, (1.4 + Math.random() * 1.4) * power, Math.sin(a) * (0.6 + Math.random()) * power);
      Object.assign(p.userData, { age: 0, life: 0.55 + Math.random() * 0.35, size: 0.03 + Math.random() * 0.04 });
      p.visible = true;
    }
  }

  /** Soil heaps up where a box burrowed. */
  async mound(i) {
    const m = this.mounds[i], k = this.lay.scale / 0.78;
    m.visible = true;
    await animate(0.45, (e) => m.scale.set(k, Math.max(1e-3, k * e), k), ease.outBack);
  }
  clearMounds() { this.mounds.forEach((m) => { m.visible = false; }); }

  /** Shows or hides the sunbeam (dawn) or gathers the fireflies (dusk) around the chosen box. */
  spotlight(on, at = null) {
    this.beamTarget = on && this.look === 'dawn' ? 1 : 0;
    this.gathering = on && this.look === 'dusk';
    if (at) { this.spot = at.clone(); this.beam.position.copy(this.beamDir).multiplyScalar(4.4).add(at); }
  }

  /** Colours and fireflies for dawn or dusk. */
  setLook(look, seconds = 1.3) {
    this.look = look;
    const pal = PALETTE[look], petals = PETALS[look];
    const from = this.solid.map((m) => m.color.clone());
    const to = [...Object.keys(this.mats).map((k) => new THREE.Color(pal[k])), ...petals.map((c) => new THREE.Color(c)), new THREE.Color(look === 'dusk' ? 0xe0c88a : CENTRE)];
    const token = (this.lookToken = {});
    return animate(seconds, (e) => {
      if (this.lookToken !== token) return;
      this.solid.forEach((m, i) => m.color.lerpColors(from[i], to[i], e));
    });
  }

  /** Fades the whole garden in or out (it steps aside for the reveal). */
  fade(on, seconds = 0.9) {
    const a0 = this.alpha, a1 = on ? 1 : 0;
    const token = (this.fadeToken = {});
    if (on) this.group.visible = true;
    this.twins.forEach((t) => { t.visible = true; });
    this.solid.forEach((m) => { m.transparent = true; m.needsUpdate = true; });
    return animate(seconds, (e) => {
      if (this.fadeToken !== token) return;
      this.alpha = a0 + (a1 - a0) * e;
      this.solid.forEach((m) => { m.opacity = this.alpha; });
    }).then(() => {
      if (this.fadeToken !== token) return;
      if (!on) this.group.visible = false;
      // plain opaque again once it's fully in
      else {
        this.twins.forEach((t) => { t.visible = false; });
        this.solid.forEach((m) => { m.transparent = false; m.needsUpdate = true; });
      }
    });
  }

  tick(dt, t, amp = 1) {
    if (!this.group.visible) return;
    const focus = this.focus != null ? this.nestPos(this.focus) : null;
    for (let i = 0; i < 3; i++) this.energy[i] *= Math.pow(0.12, dt);
    const near = new THREE.Vector3();
    for (const f of this.flowers) {
      const u = f.userData;
      let tx = 0, tz = 0, stir = 0;
      if (focus) {
        const dx = focus.x - f.position.x, dz = focus.z - f.position.z, d = Math.hypot(dx, dz);
        if (d < 4.5) { const a = 0.42 * (1 - d / 4.5); tx = (dx / d) * a; tz = (dz / d) * a; }
      }
      for (let i = 0; i < 3; i++) {
        if (this.energy[i] < 0.01) continue;
        const d = this.nestPos(i, near).distanceTo(f.position);
        stir += this.energy[i] * Math.max(0, 1 - d / 3.6);
      }
      u.lx += (tx - u.lx) * Math.min(1, dt * 5);
      u.lz += (tz - u.lz) * Math.min(1, dt * 5);
      const sway = (0.05 * Math.sin(t * 1.1 + u.phase) + 0.14 * stir * Math.sin(t * 17 + u.phase)) * amp;
      f.rotation.z = -u.lx + sway;
      f.rotation.x = u.lz + sway * 0.4;
    }
    for (const tf of this.tufts) tf.rotation.z = 0.04 * Math.sin(t * 1.3 + tf.userData.phase) * amp;
    // the big leaf rustles with the middle nest, and a little with its neighbours
    const e1 = this.energy[1] + 0.35 * (this.energy[0] + this.energy[2]);
    this.leafBlade.rotation.z = -0.32 + (0.025 * Math.sin(t * 0.9) + 0.07 * e1 * Math.sin(t * 15)) * amp;

    for (const p of this.puffs) {
      if (!p.visible) continue;
      const u = p.userData;
      u.age += dt;
      u.v.y -= 6 * dt;
      p.position.addScaledVector(u.v, dt);
      p.scale.setScalar(u.size * bell(u.age / u.life) + 1e-4);
      if (u.age >= u.life || p.position.y < -0.05) p.visible = false;
    }

    this.fliesOn += ((this.look === 'dusk' ? 1 : 0) - this.fliesOn) * Math.min(1, dt * 1.2);
    for (const s of this.flies) {
      const u = s.userData, ph = t * u.speed + u.phase;
      const sp = this.spot || u.home;
      const gx = this.gathering ? sp.x : u.home.x, gz = this.gathering ? sp.z + 0.3 : u.home.z, gy = this.gathering ? 1.1 : u.home.y;
      const r = this.gathering ? 1.1 : 0.5;
      const tx = gx + Math.sin(ph * 1.3) * r, ty = gy + Math.sin(ph * 0.9) * 0.3 * (this.gathering ? 1.6 : 1), tz = gz + Math.cos(ph * 1.1) * r;
      s.position.x += (tx - s.position.x) * Math.min(1, dt * (this.gathering ? 1.4 : 0.8));
      s.position.y += (ty - s.position.y) * Math.min(1, dt * 0.8);
      s.position.z += (tz - s.position.z) * Math.min(1, dt * (this.gathering ? 1.4 : 0.8));
      s.material.opacity = this.fliesOn * this.alpha * (0.45 + 0.55 * Math.max(0, Math.sin(ph * 2.3)));
    }

    this.beamOn += (this.beamTarget - this.beamOn) * Math.min(1, dt * 2.5);
    this.beam.visible = this.beamOn > 0.01;
    this.beam.material.uniforms.opacity.value = 0.22 * this.beamOn * this.alpha * (0.9 + 0.1 * Math.sin(t * 1.7));
  }
}
