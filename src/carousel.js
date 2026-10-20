// Where the boxes wait: a ring of six on a round two-tier plinth, standing in the real sky (src/sky.js). The
// ring drifts round on its own; drag it to spin it, and it settles with a box at the front. That box is the one
// you choose, and it's opened right where it stands. Once the series is complete, the six live on the lower tier.
import * as THREE from 'three';
import { animate, ease, bell } from './util.js';
import { beamMaterial } from './fx.js';

export const SLOTS = 6;
const STEP = (Math.PI * 2) / SLOTS;
const DRIFT = 0.16; // rad/s while nobody is touching it

const PALETTE = {
  dawn: { dais: 0xf7f1e4, band: 0x63cd84, track: 0xe6dcc6, base: 0xc4e6c9, skirt: 0xa9d8b2, dust: 0xe9dfca },
  dusk: { dais: 0xd8c9c2, band: 0x4f8f68, track: 0xbfaea8, base: 0x6f8a86, skirt: 0x5c7474, dust: 0xbfaea8 },
};
const BEAM = { dawn: 0xfff3d6, dusk: 0xffdcc0 };

/**
 * How big the ring is, how big the boxes are on it and how much the front one swells, for this screen shape;
 * and, once the series is complete, where the six stand on the lower tier (x, z), and how big they are there.
 */
export function ringLayout(aspect) {
  const tall = aspect < 1.05;
  const R = tall ? 1.75 : 2.4, scale = tall ? 0.5 : 0.54;
  const dais = R + (tall ? 0.6 : 0.7), base = dais + (tall ? 1.0 : 1.15);
  // round the back and sides of the dais, clear of the front box and the camera
  const angles = tall ? [-2.0, -2.45, -2.9, 2.9, 2.45, 2.0] : [-1.85, -2.35, -2.85, 2.85, 2.35, 1.85];
  const at = dais + (tall ? 0.5 : 0.58);
  return {
    R, scale, dais, base, tall, front: 0.22,
    homes: angles.map((a) => [at * Math.sin(a), at * Math.cos(a)]), homeScale: tall ? 0.44 : 0.48, homeY: -BASE_DROP,
  };
}
const DAIS_H = 0.24, BASE_DROP = 0.24, BASE_H = 0.5;

/** A round slab with a softly rounded top edge, its top at y = 0. */
function slab(radius, height, round, segments = 96) {
  const pts = [new THREE.Vector2(0, 0)];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    pts.push(new THREE.Vector2(radius - round + Math.sin(a) * round, -round + Math.cos(a) * round));
  }
  pts.push(new THREE.Vector2(radius * 0.985, -height), new THREE.Vector2(0, -height));
  return new THREE.LatheGeometry(pts, segments);
}

const SPHERE_LO = new THREE.SphereGeometry(1, 10, 7);

export class Carousel {
  constructor() {
    this.group = new THREE.Group();
    this.look = 'dawn';
    this.alpha = 1;
    this.theta = 0; this.vel = 0;
    this.held = false; this.target = null; this.calm = 0; this.spinning = false;
    this.hovered = null;
    this.beamOn = 0; this.beamTarget = 0;
    const pal = PALETTE.dawn;
    const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.92, ...extra });
    this.mats = Object.fromEntries(Object.entries(pal).map(([k, c]) => [k, mat(c)]));
    this.solid = Object.values(this.mats);

    this.dais = new THREE.Mesh(undefined, this.mats.dais);
    this.band = new THREE.Mesh(undefined, this.mats.band);
    this.track = new THREE.Mesh(undefined, this.mats.track);
    this.base = new THREE.Mesh(undefined, this.mats.base);
    this.skirt = new THREE.Mesh(undefined, this.mats.skirt);
    for (const m of [this.dais, this.track, this.base]) m.receiveShadow = true;
    this.dais.castShadow = true;
    this.group.add(this.dais, this.band, this.track, this.base, this.skirt);

    // the ring itself: a slot per box, each facing out
    this.ring = new THREE.Group();
    this.group.add(this.ring);
    this.slots = Array.from({ length: SLOTS }, () => { const s = new THREE.Group(); this.ring.add(s); return s; });

    // little puffs of dust as a box lands
    this.puffs = [];
    for (let i = 0; i < 48; i++) {
      const p = new THREE.Mesh(SPHERE_LO, this.mats.dust);
      p.visible = false;
      p.userData = { v: new THREE.Vector3(), age: 0, life: 1, size: 0.04 };
      this.group.add(p);
      this.puffs.push(p);
    }

    // a soft beam that finds the chosen box
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.3, 9, 48, 1, true), beamMaterial(BEAM.dawn));
    this.beamDir = new THREE.Vector3(1.6, 7, 2.6).normalize();
    this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.beamDir);
    this.beam.visible = false;
    this.group.add(this.beam);

    this.layout(1.6);
  }

  /** Rebuilds the plinth and re-seats the slots for a new screen shape. */
  layout(aspect) {
    const lay = (this.lay = ringLayout(aspect));
    if (this.built === lay.tall) return this.seat();
    this.built = lay.tall;
    for (const m of [this.dais, this.band, this.track, this.base, this.skirt]) m.geometry?.dispose();
    this.dais.geometry = slab(lay.dais, DAIS_H, 0.07);
    // a green band round the dais, like the strip on the box
    this.band.geometry = new THREE.CylinderGeometry(lay.dais * 0.992, lay.dais * 0.99, 0.06, 96, 1, true);
    this.band.position.y = -DAIS_H * 0.55;
    // the groove the boxes ride in
    this.track.geometry = new THREE.TorusGeometry(lay.R, 0.03, 8, 128);
    this.track.rotation.x = Math.PI / 2;
    this.track.position.y = 0.002;
    this.track.scale.z = 0.25;
    this.base.geometry = slab(lay.base, 0.16, 0.06);
    this.base.position.y = -BASE_DROP;
    this.skirt.geometry = new THREE.CylinderGeometry(lay.base * 0.97, lay.base * 0.9, BASE_H, 96, 1, true);
    this.skirt.position.y = -BASE_DROP - 0.16 - BASE_H / 2;
    this.twinUp();
    return this.seat();
  }

  seat() {
    const { R, scale } = this.lay;
    this.slots.forEach((s, k) => {
      const a = k * STEP;
      s.position.set(R * Math.sin(a), s.position.y, R * Math.cos(a));
      s.rotation.y = a;
      s.scale.setScalar(scale);
    });
  }

  /** Where the box at the front stands: where it's opened. */
  frontPos(out = new THREE.Vector3()) { return out.set(0, 0, this.lay.R); }

  /** Which slot is nearest the front (with the ring turned to `theta`). */
  slotAt(theta) { return ((Math.round(-theta / STEP) % SLOTS) + SLOTS) % SLOTS; }
  front() { return this.slotAt(this.theta); }
  /** How far round slot k is from the front, in radians (-π..π). */
  offset(k) { return Math.atan2(Math.sin(k * STEP + this.theta), Math.cos(k * STEP + this.theta)); }

  /** Starts (or stops) the ring turning by itself. */
  spin(on) { this.spinning = on; if (!on) { this.vel = 0; this.target = null; } this.calm = on ? 1.2 : 0; }
  reset() { this.theta = 0; this.vel = 0; this.target = null; this.held = false; }
  grab() { this.held = true; this.target = null; this.vel = 0; }
  /** Dragged by `d` radians this frame, over `dt` seconds. */
  drag(d, dt) {
    this.theta += d;
    this.vel = 0.65 * this.vel + 0.35 * (d / Math.max(dt, 1 / 120));
  }
  /** Let go: it coasts, then settles with a box at the front. */
  release() { this.held = false; this.calm = 3.5; }
  /** Turns slot k (the short way round) to the front. */
  turnTo(k, seconds = 0.6) {
    this.held = false;
    this.target = this.theta - this.offset(k);
    this.calm = 4;
    if (seconds <= 0) { this.theta = this.target; this.vel = 0; }
  }
  /** Brings the next box round from the left (-1) or right (+1); returns which slot that is. */
  nudge(dir) {
    const k = (this.slotAt(this.target ?? this.theta) + dir + SLOTS) % SLOTS;
    this.turnTo(k);
    return k;
  }
  /** Resolves once slot k stands exactly at the front. */
  async settleOn(k) {
    this.spinning = false;
    this.held = false;
    this.target = null;
    const from = this.theta, to = this.theta - this.offset(k);
    this.vel = 0;
    await animate(Math.min(0.5, 0.15 + Math.abs(to - from) * 0.5), (e) => { this.theta = from + (to - from) * e; }, ease.inOut);
  }

  puff(pos, n = 8, power = 1) {
    for (let k = 0; k < n; k++) {
      const p = this.puffs.find((q) => !q.visible);
      if (!p) return;
      const a = Math.random() * Math.PI * 2, r = 0.2 + Math.random() * 0.3;
      p.position.set(pos.x + Math.cos(a) * r, 0.04, pos.z + Math.sin(a) * r * 0.8);
      p.userData.v.set(Math.cos(a) * (0.5 + Math.random()) * power, (1.0 + Math.random()) * power, Math.sin(a) * (0.5 + Math.random()) * power);
      Object.assign(p.userData, { age: 0, life: 0.45 + Math.random() * 0.3, size: 0.025 + Math.random() * 0.03 });
      p.visible = true;
    }
  }

  /** Shows or hides the beam on the box at the front. */
  spotlight(on) {
    this.beamTarget = on ? 1 : 0;
    if (on) this.beam.position.copy(this.beamDir).multiplyScalar(4.4).add(this.frontPos());
  }

  /** Colours for dawn or dusk. */
  setLook(look, seconds = 1.3) {
    this.look = look;
    const pal = PALETTE[look];
    const keys = Object.keys(this.mats);
    const from = keys.map((k) => this.mats[k].color.clone()), to = keys.map((k) => new THREE.Color(pal[k]));
    const beam0 = this.beam.material.uniforms.color.value.clone(), beam1 = new THREE.Color(BEAM[look]);
    const token = (this.lookToken = {});
    return animate(seconds, (e) => {
      if (this.lookToken !== token) return;
      keys.forEach((k, i) => this.mats[k].color.lerpColors(from[i], to[i], e));
      this.beam.material.uniforms.color.value.lerpColors(beam0, beam1, e);
    });
  }

  // for fading: a depth-only twin of every plinth mesh, drawn first, so the fading pass only shows the nearest
  // surface (the base never shows through the dais half-way)
  twinUp() {
    this.twins?.forEach((t) => t.removeFromParent());
    const depthOnly = (this.depthOnly ??= new THREE.MeshBasicMaterial({ colorWrite: false }));
    this.twins = [this.dais, this.band, this.track, this.base, this.skirt].map((o) => {
      const twin = new THREE.Mesh(o.geometry, depthOnly);
      twin.visible = this.alpha < 1;
      twin.raycast = () => {};
      o.add(twin);
      return twin;
    });
  }

  /** Fades the plinth in or out (it steps aside for the reveal). The boxes look after themselves. */
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
      else {
        this.twins.forEach((t) => { t.visible = false; });
        this.solid.forEach((m) => { m.transparent = false; m.needsUpdate = true; });
      }
    });
  }

  /** Turns the ring; returns true when a different box has come round to the front. */
  tick(dt, t, amp = 1) {
    if (!this.group.visible) return false;
    const was = this.front();
    if (!this.held) {
      if (this.target != null) {
        // a spring onto the slot it was sent to
        this.vel += ((this.target - this.theta) * 60 - this.vel * 13) * dt;
        if (Math.abs(this.target - this.theta) < 1e-3 && Math.abs(this.vel) < 0.01) { this.theta = this.target; this.vel = 0; this.target = null; }
      } else if (this.calm > 0) {
        // let go: coast, then settle on the nearest box once it's slow enough
        this.vel *= Math.pow(0.08, dt);
        if (Math.abs(this.vel) < 0.9) this.target = this.theta - this.offset(this.front());
      } else if (this.spinning && amp >= 1) {
        // nobody's touching it: the ring drifts round by itself
        this.vel += (DRIFT - this.vel) * Math.min(1, dt * 0.8);
      } else this.vel *= Math.pow(0.05, dt);
      this.theta += this.vel * dt;
      if (this.target == null && this.calm > 0) this.calm -= dt;
    }
    this.ring.rotation.y = this.theta;

    // the box coming round to the front swells a little and stands up out of the groove; the one you point at lifts
    const { scale, front } = this.lay;
    this.slots.forEach((s, k) => {
      const f = Math.max(0, Math.cos(this.offset(k))) ** 6;
      s.scale.setScalar(scale * (1 + front * f));
      const y = this.hovered === k ? 0.08 : 0;
      s.position.y += (y - s.position.y) * Math.min(1, dt * 9);
    });

    for (const p of this.puffs) {
      if (!p.visible) continue;
      const u = p.userData;
      u.age += dt;
      u.v.y -= 6 * dt;
      p.position.addScaledVector(u.v, dt);
      p.scale.setScalar(u.size * bell(u.age / u.life) + 1e-4);
      if (u.age >= u.life || p.position.y < -0.05) p.visible = false;
    }

    this.beamOn += (this.beamTarget - this.beamOn) * Math.min(1, dt * 2.5);
    this.beam.visible = this.beamOn > 0.01;
    this.beam.material.uniforms.opacity.value = 0.22 * this.beamOn * this.alpha * (0.9 + 0.1 * Math.sin(t * 1.7));
    return this.front() !== was;
  }
}
