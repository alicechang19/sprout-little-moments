// Minimal environments. Each supports its Sprout's story and never adds anything
// to the character itself.
import * as THREE from 'three';
import { mat, shadowed, glowTexture, bell, clamp, ease, smooth } from './util.js';

const SPHERE = new THREE.SphereGeometry(1, 28, 18);
const SPHERE_LO = new THREE.SphereGeometry(1, 12, 8);
const V = new THREE.Vector3();
const V2 = new THREE.Vector3();
let GLOW_TEX;
const glowTex = () => (GLOW_TEX ??= glowTexture());

/** Marks a decor object to scale in when the environment appears. */
const pop = (o) => { o.userData.pop = o.scale.clone(); return o; };

function cluster(parts, material) {
  const g = new THREE.Group();
  for (const [x, y, z, r] of parts) {
    const m = new THREE.Mesh(SPHERE, material);
    m.position.set(x, y, z);
    m.scale.setScalar(r);
    g.add(m);
  }
  return g;
}

function toEnv(env, obj, local, out = V) {
  obj.localToWorld(out.copy(local));
  return env.group.worldToLocal(out);
}

class Pool {
  constructor(parent, geo, material, count) {
    this.items = [];
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geo, material);
      mesh.visible = false;
      parent.add(mesh);
      this.items.push({ mesh, alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), age: 0, life: 1, size: 1 });
    }
  }
  spawn(init) {
    const it = this.items.find((i) => !i.alive);
    if (!it) return null;
    it.alive = true; it.age = 0; it.mesh.visible = true;
    init(it);
    return it;
  }
  update(dt, step) {
    for (const it of this.items) {
      if (!it.alive) continue;
      it.age += dt;
      if (step(it, dt) === false || it.age >= it.life) { it.alive = false; it.mesh.visible = false; }
    }
  }
}

export function buildEnv(id, rig) {
  const env = { id, group: new THREE.Group(), time: 0, lift: 0, update() {}, moment() {} };
  BUILDERS[id](env, rig);
  env.tick = (dt) => { env.time += dt; env.update(env.time, dt); };
  env.trigger = () => env.moment(env.time);
  return env;
}

/** Scales decor in, staggered. */
export function popIn(env, animate) {
  const items = [];
  env.group.traverse((o) => { if (o.userData.pop) items.push(o); });
  items.forEach((o) => o.scale.setScalar(1e-4));
  return Promise.all(items.map((o, i) => new Promise((res) => {
    setTimeout(() => animate(0.7, (e) => o.scale.copy(o.userData.pop).multiplyScalar(Math.max(1e-4, e)), ease.outBack).then(res), i * 90);
  })));
}

const headTop = (rig, env, out) => toEnv(env, rig.n.head, V2.set(0.06, 1.42, 0.05), out);

// ---------------------------------------------------------------- Daydream
function daydream(env, rig) {
  const cloudMat = mat(0xffffff, { roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.14 });
  const parts = [[0, 0, 0, 0.42], [0.4, -0.06, 0, 0.32], [-0.4, -0.08, 0.02, 0.3], [0.13, 0.2, -0.05, 0.32], [-0.17, 0.14, 0.06, 0.27]];
  const spots = [[-1.65, 2.35, -0.7, 0.9], [1.7, 2.85, -1.1, 1.1], [0.25, 3.4, -2.2, 0.8]];
  const clouds = spots.map(([x, y, z, s]) => {
    const c = cluster(parts, cloudMat);
    c.scale.set(s, s * 0.8, s);
    c.position.set(x, y, z);
    c.userData.home = [x, y, z];
    shadowed(c, true, false);
    env.group.add(pop(c));
    return c;
  });
  const sizes = [0.055, 0.085, 0.13];
  const puffs = sizes.map(() => { const m = new THREE.Mesh(SPHERE, cloudMat); m.visible = false; env.group.add(m); return m; });
  let at = -99;
  env.update = (t) => {
    clouds.forEach((c, i) => {
      const h = c.userData.home;
      c.position.x = h[0] + 0.2 * Math.sin(t * 0.17 + i * 2.1);
      c.position.y = h[1] + 0.05 * Math.sin(t * 0.5 + i);
    });
    const p = t - at;
    puffs.forEach((m, i) => {
      if (p > 2.6) { m.visible = false; return; }
      const q = clamp((p - 0.15 - i * 0.28) / 0.45, 0, 1);
      const out = clamp((p - 2.0) / 0.5, 0, 1);
      const s = sizes[i] * ease.outBack(q) * (1 - ease.inOut(out));
      m.visible = s > 0.002;
      const top = headTop(rig, env, V);
      m.position.set(top.x + 0.22 + i * 0.17, top.y + i * 0.17 + 0.06 * p, top.z + 0.12);
      m.scale.setScalar(Math.max(1e-4, s));
    });
  };
  env.moment = (t) => { at = t; };
}

// ---------------------------------------------------------------- Read
function read(env, rig) {
  const paper = mat(0xf4e8cf);
  const stack = new THREE.Group();
  [[0.46, 0.09, 0.32, 0x9dbf9a, 0.25], [0.4, 0.08, 0.3, 0x9aaed6, -0.12]].forEach(([w, h, d, c, ry], i) => {
    const b = new THREE.Group();
    const cover = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c, { roughness: 0.7 }));
    const pages = new THREE.Mesh(new THREE.BoxGeometry(w - 0.03, h - 0.025, d - 0.012), paper);
    pages.position.x = 0.02;
    b.add(cover, pages);
    b.position.y = h / 2 + i * 0.09;
    b.rotation.y = ry;
    stack.add(b);
  });
  stack.position.set(1.0, 0, 0.45);
  env.group.add(pop(shadowed(stack)));
  const lamp = new THREE.PointLight(0xffd9a8, 3.2, 6, 1.6);
  lamp.position.set(1.3, 2.4, 1.3);
  env.group.add(lamp);
  const moteMat = mat(0xfff3d6, { emissive: 0xfff0cc, emissiveIntensity: 0.9 });
  const motes = [];
  for (let i = 0; i < 22; i++) {
    const m = new THREE.Mesh(SPHERE_LO, moteMat);
    const r = 1.6;
    m.userData.home = [(Math.random() - 0.5) * 2 * r, 0.4 + Math.random() * 2.4, (Math.random() - 0.5) * r];
    m.userData.speed = 0.04 + Math.random() * 0.06;
    m.scale.setScalar(0.01 + Math.random() * 0.008);
    env.group.add(m);
    motes.push(m);
  }
  const sparkMat = mat(0xffd76a, { emissive: 0xffc94a, emissiveIntensity: 0.7, roughness: 0.4 });
  const sparks = [0, 1, 2].map(() => { const m = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), sparkMat); m.visible = false; env.group.add(m); return m; });
  let at = -99;
  env.update = (t) => {
    for (const m of motes) {
      const h = m.userData.home;
      m.position.set(h[0] + 0.08 * Math.sin(t * 0.4 + h[2] * 3), 0.4 + ((h[1] - 0.4 + t * m.userData.speed) % 2.4), h[2]);
    }
    const p = t - at;
    sparks.forEach((m, i) => {
      if (p > 1.9) { m.visible = false; return; }
      const q = clamp((p - 0.35 - i * 0.12) / 1.1, 0, 1);
      const s = 0.055 * bell(q);
      m.visible = s > 0.001;
      const top = headTop(rig, env, V);
      m.position.set(top.x + (i - 1) * 0.3, top.y + 0.05 + q * 0.35 + (i === 1 ? 0.1 : 0), top.z + 0.1);
      m.scale.set(s * 0.7, s * 1.4, s * 0.35);
      m.rotation.y = t * 3;
    });
  };
  env.moment = (t) => { at = t; };
}

// ---------------------------------------------------------------- Rest
function crescentShape(r1 = 0.36, r2 = 0.31, ox = 0.17, oy = 0.09) {
  const c2 = new THREE.Vector2(ox, oy), d = c2.length(), dir = c2.clone().divideScalar(d);
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d), h = Math.sqrt(r1 * r1 - a * a);
  const P = dir.clone().multiplyScalar(a), perp = new THREE.Vector2(-dir.y, dir.x);
  const I1 = P.clone().addScaledVector(perp, h), I2 = P.clone().addScaledVector(perp, -h);
  const s = new THREE.Shape();
  const a1 = Math.atan2(I1.y, I1.x);
  let a2 = Math.atan2(I2.y, I2.x);
  while (a2 < a1) a2 += Math.PI * 2;
  for (let i = 0; i <= 40; i++) { const th = a1 + (a2 - a1) * (i / 40); i ? s.lineTo(r1 * Math.cos(th), r1 * Math.sin(th)) : s.moveTo(r1 * Math.cos(th), r1 * Math.sin(th)); }
  const b2 = Math.atan2(I2.y - oy, I2.x - ox);
  let b1 = Math.atan2(I1.y - oy, I1.x - ox);
  // walk the inner circle back through the side that faces the outer centre
  while (b1 > b2) b1 -= Math.PI * 2;
  const mid = (b1 + b2) / 2;
  if (Math.hypot(ox + r2 * Math.cos(mid), oy + r2 * Math.sin(mid)) > r1) b1 += Math.PI * 2;
  for (let i = 1; i <= 40; i++) { const th = b2 + (b1 - b2) * (i / 40); s.lineTo(ox + r2 * Math.cos(th), oy + r2 * Math.sin(th)); }
  return s;
}

function rest(env, rig) {
  const cushion = new THREE.Mesh(SPHERE, mat(0xa3c78e, { roughness: 1 }));
  cushion.scale.set(1.15, 0.26, 0.78);
  cushion.position.set(0.05, 0.08, -0.05);
  env.group.add(pop(shadowed(cushion, false, true)));
  const tufts = cluster([[-0.9, 0.12, 0.35, 0.12], [-0.75, 0.1, 0.45, 0.09], [0.95, 0.1, -0.3, 0.1]], mat(0x93bd7e, { roughness: 1 }));
  env.group.add(pop(shadowed(tufts)));
  env.lift = 0.2;
  const moon = new THREE.Mesh(
    new THREE.ExtrudeGeometry(crescentShape(), { depth: 0.04, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.03, bevelSegments: 5, curveSegments: 24 }),
    mat(0xf5e6b2, { emissive: 0xf5e0a0, emissiveIntensity: 0.45, roughness: 0.6 }),
  );
  moon.position.set(-1.55, 2.45, -1.4);
  moon.rotation.z = 0.5;
  env.group.add(pop(moon));
  const starMat = mat(0xfff6d8, { emissive: 0xfff2c8, emissiveIntensity: 1 });
  [[-1.7, 3.0, -1.6], [-0.9, 3.5, -2.2], [0.4, 3.7, -2.4], [2.2, 3.4, -2.0], [-2.3, 2.3, -1.8], [0.9, 3.1, -1.9]].forEach(([x, y, z], i) => {
    const s = new THREE.Mesh(SPHERE_LO, starMat);
    s.position.set(x, y, z);
    s.scale.setScalar(0.025 + (i % 3) * 0.008);
    s.userData.tw = i;
    env.group.add(pop(s));
  });
  const bubbleMat = new THREE.MeshStandardMaterial({ color: 0xf6f4ff, roughness: 0.15, transparent: true, opacity: 0.55 });
  const bubbles = new Pool(env.group, SPHERE, bubbleMat, 5);
  let next = 1;
  const spawn = (big = 1) => bubbles.spawn((b) => {
    b.pos.copy(toEnv(env, rig.n.head, V2.set(0.3, 0.95, 0.35), new THREE.Vector3()));
    b.vel.set(0.06, 0.22, 0.02);
    b.life = 2.6;
    b.size = (0.05 + Math.random() * 0.03) * big;
  });
  env.update = (t, dt) => {
    moon.position.y = 2.45 + 0.06 * Math.sin(t * 0.6); moon.rotation.z = 0.5 + 0.05 * Math.sin(t * 0.4);
    if (t > next) { spawn(); next = t + 2.6; }
    bubbles.update(dt, (b) => {
      b.pos.addScaledVector(b.vel, dt);
      b.pos.x += 0.05 * Math.sin(t * 2 + b.size * 50) * dt;
      const p = b.age / b.life;
      const s = b.size * smooth(p, 0, 0.25) * (p > 0.92 ? 1 - (p - 0.92) / 0.08 : 1);
      b.mesh.position.copy(b.pos);
      b.mesh.scale.setScalar(Math.max(1e-4, s * (0.7 + 0.5 * p)));
    });
  };
  env.moment = (t) => { setTimeout(() => spawn(1.7), 900); next = t + 3.2; };
}

// ---------------------------------------------------------------- Explore
function explore(env, rig) {
  const path = new THREE.Group();
  path.rotation.y = 0.28;
  env.group.add(path);
  const stoneGeo = new THREE.CylinderGeometry(1, 1.08, 1, 24);
  const stoneMats = [mat(0xe4ddcf, { roughness: 0.95 }), mat(0xd8d0c0, { roughness: 0.95 })];
  const N = 10, span = 5.2;
  const stones = [];
  for (let i = 0; i < N; i++) {
    const s = new THREE.Mesh(stoneGeo, stoneMats[i % 2]);
    s.userData.z = -span / 2 + (i + 0.5) * (span / N);
    s.userData.k = 0.85 + Math.random() * 0.3;
    s.receiveShadow = true;
    path.add(s);
    stones.push(s);
  }
  env.lift = 0.05;
  const leafy = [mat(0x9ccf8e, { roughness: 1 }), mat(0x86c07c, { roughness: 1 })];
  const shrub1 = cluster([[0, 0.22, 0, 0.26], [0.22, 0.15, 0.05, 0.18], [-0.2, 0.14, 0.02, 0.17]], leafy[0]);
  shrub1.position.set(-1.25, 0, -0.7);
  const shrub2 = cluster([[0, 0.18, 0, 0.2], [0.16, 0.12, 0.06, 0.14]], leafy[1]);
  shrub2.position.set(1.35, 0, -1.25);
  const mush = new THREE.Group();
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.14, 16), mat(0xf3ead8));
  stalk.position.y = 0.07;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xeea58c, { roughness: 0.7 }));
  cap.position.y = 0.13;
  cap.scale.y = 0.7;
  mush.add(stalk, cap);
  mush.position.set(0.95, 0, 0.75);
  [shrub1, shrub2, mush].forEach((o) => env.group.add(pop(shadowed(o))));
  const dustMat = mat(0xf1ece2, { roughness: 1 });
  const dust = new Pool(env.group, SPHERE_LO, dustMat, 8);
  let landAt = -1;
  env.update = (t, dt) => {
    for (const s of stones) {
      s.userData.z -= 0.62 * dt * rig.walk;
      if (s.userData.z < -span / 2) { s.userData.z += span; s.userData.k = 0.85 + Math.random() * 0.3; }
      const z = s.userData.z;
      const fade = smooth(span / 2 - Math.abs(z), 0, 0.9);
      const k = s.userData.k * Math.max(1e-4, fade);
      s.position.set(0.16 * Math.sin(z * 1.25), 0.025, z);
      s.scale.set(0.25 * k, 0.05, 0.22 * k);
    }
    if (landAt > 0 && t > landAt) {
      landAt = -1;
      for (let i = 0; i < 6; i++) dust.spawn((d) => {
        const a = (i / 6) * Math.PI * 2;
        d.pos.set(Math.cos(a) * 0.12, 0.05, Math.sin(a) * 0.12);
        d.vel.set(Math.cos(a) * 0.5, 0.15, Math.sin(a) * 0.5);
        d.life = 0.7;
      });
    }
    dust.update(dt, (d) => {
      d.pos.addScaledVector(d.vel, dt);
      d.vel.multiplyScalar(0.92);
      d.mesh.position.copy(d.pos);
      d.mesh.scale.setScalar(0.05 * bell(d.age / d.life) + 1e-4);
    });
  };
  env.moment = (t) => { landAt = t + 1.35; };
}

// ---------------------------------------------------------------- Cheer
function cheer(env, rig) {
  const COLORS = [0xf7b9a6, 0xffe08a, 0xbfe6c8, 0xc9c3f0, 0xf9d3e0, 0xfff4e6];
  const FALL = 40, BURST = 20;
  const petals = new THREE.InstancedMesh(new THREE.CircleGeometry(0.048, 14), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8 }), FALL + BURST);
  const c = new THREE.Color();
  const state = [];
  const R = 1.8, TOP = 3.5;
  for (let i = 0; i < FALL + BURST; i++) {
    petals.setColorAt(i, c.setHex(COLORS[i % COLORS.length]));
    const a = Math.random() * Math.PI * 2, r = 0.35 + Math.random() * (R - 0.35);
    state.push({
      pos: new THREE.Vector3(Math.cos(a) * r, Math.random() * TOP, Math.sin(a) * r - 0.2),
      vel: new THREE.Vector3(), speed: 0.22 + Math.random() * 0.18, phase: Math.random() * 10,
      spin: new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize(), burst: i >= FALL, alive: i < FALL,
    });
  }
  petals.instanceColor.needsUpdate = true;
  env.group.add(petals);
  const q = new THREE.Quaternion(), m = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1), zero = new THREE.Vector3(0, 0, 0);
  env.update = (t, dt) => {
    state.forEach((s, i) => {
      if (!s.alive) { m.compose(s.pos, q, zero); petals.setMatrixAt(i, m); return; }
      if (s.burst) {
        s.vel.y -= 2.4 * dt;
        s.vel.multiplyScalar(s.vel.y < 0 ? 0.9 : 0.985);
        if (s.vel.y < -0.35) s.vel.y = -0.35;
        s.pos.addScaledVector(s.vel, dt);
        s.pos.x += 0.15 * Math.sin(t * 3 + s.phase) * dt;
        if (s.pos.y < 0.02) s.alive = false;
      } else {
        s.pos.y -= s.speed * dt;
        s.pos.x += 0.12 * Math.sin(t * 0.9 + s.phase) * dt;
        if (s.pos.y < 0.02) s.pos.y = TOP;
      }
      q.setFromAxisAngle(s.spin, t * 1.6 + s.phase);
      m.compose(s.pos, q, one);
      petals.setMatrixAt(i, m);
    });
    petals.instanceMatrix.needsUpdate = true;
  };
  env.moment = () => {
    setTimeout(() => {
      state.filter((s) => s.burst).forEach((s, k) => {
        const side = k % 2 ? 1 : -1;
        const from = toEnv(env, rig.n[side > 0 ? 'arm_L' : 'arm_R'], V2.set(side * 0.45, 0.1, 0), V);
        s.pos.copy(from);
        s.vel.set(side * (0.3 + Math.random() * 0.6), 1.6 + Math.random() * 1.2, (Math.random() - 0.2) * 0.6);
        s.alive = true;
      });
    }, 500);
  };
}

// ---------------------------------------------------------------- Little Light
function light(env, rig) {
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xdfff9c, transparent: true, opacity: 0.5, depthWrite: false }));
  halo.scale.setScalar(3.4);
  env.group.add(halo);
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: glowTex(), color: 0xc8f58a, transparent: true, opacity: 0.5, depthWrite: false }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.012;
  pool.scale.setScalar(3.4);
  env.group.add(pool);
  const lamp = new THREE.PointLight(0xd8ff9c, 3.6, 6, 1.4);
  env.group.add(lamp);
  const flyMat = new THREE.MeshBasicMaterial({ color: 0xf0ffc0 });
  const flies = [];
  for (let i = 0; i < 16; i++) {
    const f = new THREE.Mesh(SPHERE_LO, flyMat);
    f.userData = { r: 0.9 + Math.random() * 1.1, h: 0.4 + Math.random() * 2.3, s: (0.15 + Math.random() * 0.25) * (i % 2 ? 1 : -1), ph: Math.random() * 10 };
    env.group.add(f);
    flies.push(f);
  }
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xe8ffb0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 8, 120), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  env.group.add(ring);
  let at = -99;
  env.update = (t) => {
    const c = toEnv(env, rig.n.head, V2.set(0, 0.62, 0), V);
    halo.position.copy(c);
    lamp.position.copy(c);
    const g = rig.glow;
    halo.material.opacity = 0.34 * g;
    lamp.intensity = 3.6 * g;
    pool.material.opacity = 0.4 * g;
    for (const f of flies) {
      const u = f.userData, a = t * u.s + u.ph;
      f.position.set(Math.cos(a) * u.r, u.h + 0.15 * Math.sin(t * 0.7 + u.ph), Math.sin(a) * u.r);
      f.scale.setScalar(0.018 + 0.008 * Math.sin(t * 3 + u.ph * 5));
    }
    const p = (t - at) / 2.4;
    ringMat.opacity = p >= 0 && p <= 1 ? 0.7 * (1 - p) : 0;
    ring.scale.setScalar(0.4 + ease.out(clamp(p, 0, 1)) * 2.8);
  };
  env.moment = (t) => { at = t + 0.3; };
}

const BUILDERS = { daydream, read, rest, explore, cheer, light };
