// Runtime rig for a loaded Sprout GLB. The GLB holds the pose; this adds small,
// looping offsets on the named pivots (idle) and a one-off "moment" on request.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { bell, clamp, ease } from './util.js';

const NODES = ['root', 'hips', 'head', 'head_shell', 'arm_L', 'arm_R', 'leg_L', 'leg_R', 'shin_L', 'shin_R', 'book_page'];

export const MOMENT_SECONDS = { daydream: 2.4, read: 1.9, rest: 2.8, explore: 1.5, cheer: 1.8, light: 2.6 };
/** How long a page takes to turn. */
export const PAGE_SECONDS = 1.7;
/** How long Read's idle nod (two dips) takes. */
const NOD_SECONDS = 1.3;

export class Rig {
  constructor(id, template) {
    this.id = id;
    // the body is skinned, so a plain clone would share the template's skeleton
    this.object = cloneSkinned(template);
    this.n = {};
    this.base = {};
    for (const k of NODES) {
      const o = this.object.getObjectByName(k);
      if (!o) continue;
      this.n[k] = o;
      this.base[k] = { p: o.position.clone(), r: o.rotation.clone(), s: o.scale.clone() };
    }
    this.glowMats = [];
    this.lids = []; // painted-eye Sprouts blink by swapping in closed eyes (src/kit.js closedEyes)
    this.lidShapes = [];
    const seen = new Set();
    this.object.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.isSkinnedMesh) o.frustumCulled = false; // bounds don't follow the pose
      if (o.material.userData.shut && !this.lids.includes(o.material.userData.shut)) this.lids.push(o.material.userData.shut);
      const lidShape = o.morphTargetDictionary?.lids; // and the eye's shape smoothed into a lid
      if (lidShape !== undefined) this.lidShapes.push({ mesh: o, i: lidShape });
      if (o.material.name.startsWith('glow') && !seen.has(o.material)) {
        seen.add(o.material);
        this.glowMats.push({ m: o.material, base: o.material.emissiveIntensity });
      }
    });
    this.time = Math.random() * 10;
    this.nextBlink = this.time + 1.5 + Math.random() * 2;
    this.moment = null;
    this.pageFlipAt = -99; // only tools/rig-preview.html turns pages now (&flip)
    this.nodAt = this.time - 5; // Read's first nod comes a few seconds in
    if (this.n.book_page?.userData.flip) this.page = bendablePage(this.n.book_page);
    this.glow = 1;
    this.walk = 0;
    this.onMoment = null;
  }

  get busy() { return !!this.moment; }

  play() {
    if (this.moment) return 0;
    const dur = MOMENT_SECONDS[this.id];
    this.moment = { start: this.time, dur };
    this.onMoment?.();
    return dur;
  }

  update(dt, amp = 1) {
    this.time += dt;
    const t = this.time, n = this.n;
    for (const k in this.base) {
      const b = this.base[k], o = n[k];
      o.position.copy(b.p); o.rotation.copy(b.r); o.scale.copy(b.s);
    }
    // breathing, shared by everyone
    const breath = Math.sin(t * (this.id === 'rest' ? 1.1 : 1.7));
    const bAmp = this.id === 'rest' ? 0.022 : 0.011;
    // breathe on the head joint, so the head shell and the skinned underside scale together
    n.head.scale.set(1 - bAmp * 0.5 * breath, 1 + bAmp * breath, 1 - bAmp * 0.5 * breath);

    IDLE[this.id]?.(this, t, amp);

    if (this.moment) {
      const p = (t - this.moment.start) / this.moment.dur;
      if (p >= 1) this.moment = null;
      else MOMENT[this.id]?.(this, p);
    }
    if (!this.moment) this.lidsDown = 0;

    // blink (open-eyed Sprouts only): swap the painted eyes for closed ones
    if (this.lids.length) {
      if (t > this.nextBlink + 0.16) this.nextBlink = t + 2.4 + Math.random() * 3.2;
      const bp = (t - this.nextBlink) / 0.16;
      const shut = Math.max(bp > 0 && bp < 1 ? bell(bp) : 0, this.lidsDown || 0);
      for (const l of this.lids) l.value = shut;
      for (const l of this.lidShapes) l.mesh.morphTargetInfluences[l.i] = shut;
    }
    for (const g of this.glowMats) g.m.emissiveIntensity = g.base * this.glow;
  }
}

const armRaise = (r, side, v) => { r.n[side > 0 ? 'arm_L' : 'arm_R'].rotation.z += side * v; };
const armSwing = (r, side, v) => { r.n[side > 0 ? 'arm_L' : 'arm_R'].rotation.y += -side * v; };

/**
 * An imported book's turning page (tools/rig-imported.mjs) bends as it turns: each point swings about
 * the spine by its own amount. Its geometry moves to plain floats in the page node's own space so it
 * can be rewritten every frame (a copy, as clones would otherwise share it).
 */
function bendablePage(node) {
  const mesh = node.children.find((o) => o.isMesh);
  mesh.updateMatrix();
  const geo = mesh.geometry.clone();
  const pos = geo.attributes.position, nrm = geo.attributes.normal, n = pos.count;
  const P0 = new Float32Array(n * 3), N0 = new Float32Array(n * 3), v = new THREE.Vector3();
  const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrix);
  let reach = 0;
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrix).toArray(P0, i * 3);
    reach = Math.max(reach, v.x);
    v.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize().toArray(N0, i * 3);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(P0.slice(), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(N0.slice(), 3));
  mesh.geometry = geo;
  mesh.position.set(0, 0, 0); mesh.quaternion.identity(); mesh.scale.set(1, 1, 1);
  mesh.frustumCulled = false;
  return { geo, P0, N0, reach };
}

function flipPage(r, t) {
  const page = r.n.book_page;
  if (!page) return;
  const p = clamp((t - r.pageFlipAt) / PAGE_SECONDS, 0, 1);
  const flip = page.userData.flip;
  // the book's page is a copy of the real one, so it only shows while it's turning
  page.visible = p > 0 && p < 1;
  if (!page.visible) return;
  // the outer edge leads as the page lifts (pulled by its corner) and trails as it settles, so the
  // page curls over and lands softly, edge last
  const { geo, P0, N0, reach } = r.page;
  const base = ease.inOut(p), lead = 0.24 * Math.sin(2 * Math.PI * p);
  const pos = geo.attributes.position.array, nrm = geo.attributes.normal.array;
  for (let i = 0; i < P0.length; i += 3) {
    const f = clamp(P0[i] / reach, 0, 1);
    const a = flip * clamp(base + lead * f, 0, 1), c = Math.cos(a), s = Math.sin(a);
    pos[i] = P0[i] * c + P0[i + 2] * s; pos[i + 1] = P0[i + 1]; pos[i + 2] = -P0[i] * s + P0[i + 2] * c;
    nrm[i] = N0[i] * c + N0[i + 2] * s; nrm[i + 1] = N0[i + 1]; nrm[i + 2] = -N0[i] * s + N0[i + 2] * c;
  }
  geo.attributes.position.needsUpdate = true;
  geo.attributes.normal.needsUpdate = true;
}

const IDLE = {
  daydream(r, t, a) {
    r.n.head.rotation.z += a * 0.07 * Math.sin(t * 0.55);
    r.n.head.rotation.y += a * 0.1 * Math.sin(t * 0.33);
    r.n.head.rotation.x += a * 0.03 * Math.sin(t * 0.71);
    armRaise(r, 1, a * 0.04 * Math.sin(t * 0.8));
    armRaise(r, -1, a * 0.04 * Math.sin(t * 0.8 + 1.3));
  },
  read(r, t, a) {
    r.n.head.rotation.x += a * 0.025 * Math.sin(t * 1.1);
    r.n.head.rotation.y += a * 0.05 * Math.sin(t * 0.4);
    // every 8 s a little nod at the book, a deeper dip then a smaller one, as if agreeing with a good line
    if (t - r.nodAt > 8) r.nodAt = t;
    const u = (t - r.nodAt) / NOD_SECONDS;
    if (u < 1) r.n.head.rotation.x += a * 0.13 * (1 - 0.4 * u) * (0.5 - 0.5 * Math.cos(4 * Math.PI * u));
    flipPage(r, t); // keeps the book's turning-page copy hidden
  },
  rest(r, t, a) {
    const b = Math.sin(t * 1.1);
    // Rest's left leaf lies against its cheek: it rises and falls forward, off the head
    armSwing(r, 1, a * 0.04 * b);
    r.n.root.position.y += a * 0.008 * b;
    r.n.head.rotation.z += a * 0.015 * Math.sin(t * 0.37);
  },
  explore(r, t, a) {
    const ph = t * 4.2;
    const s = Math.sin(ph);
    r.walk = a;
    r.n.leg_L.rotation.x += a * 0.42 * s;
    r.n.leg_R.rotation.x -= a * 0.42 * s;
    armSwing(r, 1, -a * 0.3 * s);
    armSwing(r, -1, a * 0.3 * s);
    r.n.root.position.y += a * 0.035 * Math.abs(Math.cos(ph));
    r.n.head.rotation.z += a * 0.03 * s;
    r.n.head.rotation.y += a * 0.16 * Math.sin(t * 0.4);
  },
  cheer(r, t, a) {
    const w = Math.sin(t * 3.2);
    armRaise(r, 1, a * 0.22 * w);
    armRaise(r, -1, a * 0.22 * w);
    const hop = Math.pow(Math.max(0, Math.sin(t * 1.6)), 2);
    r.n.root.position.y += a * 0.05 * hop;
    r.n.head.rotation.z += a * 0.05 * Math.sin(t * 1.6);
  },
  light(r, t, a) {
    r.n.root.position.y += 0.05 + a * 0.045 * Math.sin(t * 1.0);
    r.n.head.rotation.z += a * 0.03 * Math.sin(t * 0.6);
    r.glow = 0.9 + 0.18 * Math.sin(t * 1.4);
  },
};

const MOMENT = {
  daydream(r, p) {
    const e = bell(p);
    r.n.head.rotation.x -= 0.24 * e;
    r.n.head.rotation.z -= 0.1 * e;
    r.lidsDown = p > 0.3 && p < 0.7 ? bell((p - 0.3) / 0.4) : 0;
    if (p > 0.95) r.lidsDown = 0;
    // the leaves stay put: lifting one pulled it away from the body at its base
  },
  read(r, p) {
    const e = bell(p);
    r.n.head.rotation.x -= 0.2 * e;
    r.n.root.position.y += 0.035 * bell(p * 2);
    armRaise(r, 1, 0.08 * e);
    armRaise(r, -1, 0.08 * e);
  },
  rest(r, p) {
    const e = bell(p);
    // Rest sits slumped, its leaves against its head and the ground: it stretches forward,
    // lifting its feet and straightening its head a little
    armSwing(r, 1, 0.12 * e);
    armSwing(r, -1, 0.18 * e); // more and its fused edges smear
    r.n.leg_L.rotation.x -= 0.22 * e;
    r.n.leg_R.rotation.x -= 0.16 * e;
    r.n.head.rotation.z -= 0.06 * e;
    r.n.head.scale.y *= 1 + 0.05 * e;
  },
  explore(r, p) {
    const h = Math.sin(Math.PI * p);
    r.n.root.position.y += 0.26 * h;
    r.n.leg_L.rotation.x -= 0.35 * h;
    r.n.leg_R.rotation.x += 0.2 * h;
    armRaise(r, 1, 0.5 * h);
    armRaise(r, -1, 0.5 * h);
    r.n.head.rotation.y += 0.45 * Math.sin(2 * Math.PI * p);
    const squash = p < 0.12 ? bell(p / 0.12) : p > 0.88 ? bell((p - 0.88) / 0.12) : 0;
    r.n.root.scale.set(1 + 0.05 * squash, 1 - 0.08 * squash, 1 + 0.05 * squash);
  },
  cheer(r, p) {
    const h = Math.sin(Math.PI * p);
    r.n.root.position.y += 0.3 * h;
    // quick, excited flaps in the air. His leaves pivot just under his head, so they stay below
    // about 0.3 rad of lift or they'd swing into it; blend over from the idle wave and back.
    const flap = 0.1 + 0.2 * Math.sin(p * Math.PI * 6);
    for (const [k, side] of [['arm_L', 1], ['arm_R', -1]]) {
      const o = r.n[k], to = r.base[k].r.z + side * flap;
      o.rotation.z += (to - o.rotation.z) * h;
    }
    r.n.head.rotation.z += 0.08 * Math.sin(p * Math.PI * 4) * h;
    const squash = p < 0.12 ? bell(p / 0.12) : p > 0.88 ? bell((p - 0.88) / 0.12) : 0;
    r.n.root.scale.set(1 + 0.05 * squash, 1 - 0.08 * squash, 1 + 0.05 * squash);
  },
  light(r, p) {
    const e = bell(p);
    r.n.root.position.y += 0.14 * e;
    r.glow += 0.9 * e;
    armRaise(r, 1, 0.3 * e);
    armRaise(r, -1, 0.3 * e);
  },
};
