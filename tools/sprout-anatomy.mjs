// Sprout anatomy. Every pose in Series 01 is built from these exact parts, so the
// character stays consistent: teardrop leaf head, chunky torso, two leaf arms, two legs
// in ankle boots. No hands, fingers or extra limbs, ever. Poses only rotate the joints.
//
// Shapes and proportions follow the reference model (sprout-3d-source.html): a lathed,
// flattened teardrop head, one blended surface for torso, hips, legs and leaf stalks,
// puffy lathed leaves and layered boots. It's authored in the reference's units and
// scaled by S into ours. The body is skinned to a small skeleton so it bends without seams.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const S = 1.4 / 3.29; // reference head height -> ours
const V = (x, y, z = 0) => new THREE.Vector3(x * S, y * S, z * S);

export const PALETTE = {
  green: 0x56c969,
  vein: 0x3caa58,
  ink: 0x071322,
  white: 0xffffff,
  leather: 0x93561f,
  cuff: 0x825023,
  sole: 0x694019,
  // Little Light (secret)
  glow: 0xd4ff9c,
  glowLimb: 0xd4ff9c,
  glowVein: 0xeaffbc,
};

// Joint positions in the reference's units (ground = 0), resting stance.
const J = {
  hips: [0, 1.05, 0],
  hip: [0.1, 1.05, -0.02], knee: [0.24, 0.72, 0.02], ankle: [0.35, 0.43, 0.04],
  boot: [0.36, 0.24, 0.035],
  shoulder: [0.22, 1.26, 0.02], // high on the torso, just under the head
  neck: [0, 1.62, 0],
};
const P = (a, side = 1) => V(a[0] * side, a[1], a[2]);

// ---------- materials ----------
export function makeMaterials(light = false) {
  const skin = new THREE.MeshPhysicalMaterial({
    name: light ? 'glow_skin' : 'skin', color: light ? PALETTE.glow : PALETTE.green,
    roughness: light ? 0.42 : 0.57, clearcoat: 0.12, clearcoatRoughness: 0.6,
  });
  const limb = new THREE.MeshPhysicalMaterial({
    name: light ? 'glow_limb' : 'limb', color: light ? PALETTE.glowLimb : PALETTE.green,
    roughness: light ? 0.45 : 0.57, clearcoat: 0.12, clearcoatRoughness: 0.6,
  });
  const vein = new THREE.MeshStandardMaterial({ name: light ? 'glow_vein' : 'vein', color: light ? PALETTE.glowVein : PALETTE.vein, roughness: 0.72 });
  if (light) {
    skin.emissive = new THREE.Color(0xb8f27a); skin.emissiveIntensity = 0.75;
    limb.emissive = new THREE.Color(0xb8f27a); limb.emissiveIntensity = 0.75; // same as the head: one continuous glow
    vein.emissive = new THREE.Color(0xe4ffb0); vein.emissiveIntensity = 0.9;
  }
  const ink = new THREE.MeshPhysicalMaterial({ name: 'ink', color: PALETTE.ink, roughness: 0.2, clearcoat: 1 });
  const white = new THREE.MeshBasicMaterial({ name: 'eye_glint', color: PALETTE.white });
  const boot = new THREE.MeshPhysicalMaterial({ name: 'boot', color: PALETTE.leather, roughness: 0.53, clearcoat: 0.15 });
  const cuff = new THREE.MeshStandardMaterial({ name: 'boot_cuff', color: PALETTE.cuff, roughness: 0.67 });
  const sole = new THREE.MeshStandardMaterial({ name: 'boot_sole', color: PALETTE.sole, roughness: 0.8 });
  return { skin, limb, vein, ink, white, boot, cuff, sole, light };
}

// ---------- helpers ----------
/** Tube with rounded ends; `thin` narrows it toward the end so veins fade out like real ones. */
function tubeGeo(points, r, segs = 48, radial = 12, thin = 0) {
  const curve = new THREE.CatmullRomCurve3(points);
  const g = new THREE.TubeGeometry(curve, segs, r, radial, false);
  const pos = g.attributes.position, L = curve.getLength();
  const c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    curve.getPointAt(u, c);
    const e = Math.min(u, 1 - u) * L;
    const k = (e < r ? Math.sqrt(Math.max(0, 1 - ((r - e) / r) ** 2)) : 1) * (1 - thin * u);
    for (let j = 0; j <= radial; j++) {
      const id = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, id).sub(c).multiplyScalar(k).add(c);
      pos.setXYZ(id, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}
function ballGeo(detail = [48, 32]) { return new THREE.SphereGeometry(1, detail[0], detail[1]); }
/** Places geometry authored in root space into a bone whose rest origin is `origin` (bones are unrotated at rest). */
const into = (geo, origin) => geo.translate(-origin.x, -origin.y, -origin.z);

// ---------- head ----------
const HEAD_PROFILE = new THREE.SplineCurve([[0, 1.58], [0.36, 1.67], [0.93, 1.82], [1.30, 2.15], [1.40, 2.62], [1.29, 3.12], [0.97, 3.65], [0.57, 4.17], [0.23, 4.64], [0.07, 4.84], [0, 4.87]]
  .map(([x, y]) => new THREE.Vector2(x, y))).getPoints(150).map((p) => { p.x = Math.max(0, p.x); return p; });
const HEAD_DEPTH = 0.62;
// Below this height the head's underside is part of the smooth body surface (see headUnderside).
const HEAD_SEAM = 1.84;
function headRadius(y) {
  const pp = HEAD_PROFILE;
  for (let i = 1; i < pp.length; i++) if (pp[i].y >= y) { const a = pp[i - 1], b = pp[i]; return THREE.MathUtils.lerp(a.x, b.x, (y - a.y) / (b.y - a.y)); }
  return 0.01;
}
/** z of the head's front surface at (x, y), in reference units. */
const front = (x, y, offset = 0.014) => { const r = headRadius(y); return HEAD_DEPTH * Math.sqrt(Math.max(0.001, r * r - x * x)) + offset; };

export function buildHead(M, { eyes = 'open' } = {}) {
  const origin = P(J.neck);
  const head = new THREE.Bone();
  head.name = 'head';
  // the shell's origin sits at the bottom of the head, so breathing squash grows upward
  const shell = new THREE.Group();
  shell.name = 'head_shell';
  const shellOrigin = V(0, 1.58);
  shell.position.copy(shellOrigin.clone().sub(origin));
  const place = (geo) => into(geo, shellOrigin);

  // the shell covers the head above the seam; the body surface continues it below, into the torso
  // it reaches a little below the seam and overlaps the body surface, so there's never a crack
  const upper = HEAD_PROFILE.filter((p) => p.y > HEAD_SEAM - 0.05);
  upper.unshift(new THREE.Vector2(headRadius(HEAD_SEAM - 0.05), HEAD_SEAM - 0.05));
  const headGeo = new THREE.LatheGeometry(upper, 112);
  headGeo.scale(S, S, S * HEAD_DEPTH);
  const skin = new THREE.Mesh(place(headGeo), M.skin);
  skin.name = 'head_skin';
  shell.add(skin);

  // raised leaf veins on the upper forehead
  const veinLines = [
    [[0.11, 3.03], [0.10, 3.28], [0.035, 3.58], [-0.04, 4.10]],
    [[0.075, 3.43], [-0.14, 3.60], [-0.39, 3.72]],
    [[0.09, 3.28], [0.27, 3.53], [0.43, 3.68]],
  ];
  const veinGeos = veinLines.map((line, i) => tubeGeo(line.map(([x, y]) => V(x, y, front(x, y, 0.002))), 0.019 * S, 48, 12, i === 0 ? 0.25 : 0.45));
  // a quieter echo on the back of the head: thinner and half sunk into the surface
  const backLines = [
    [[-0.08, 2.95], [-0.07, 3.25], [-0.02, 3.6], [0.04, 4.02]],
    [[-0.06, 3.38], [0.14, 3.54], [0.34, 3.64]],
    [[-0.07, 3.2], [-0.24, 3.43], [-0.38, 3.56]],
  ];
  for (const [i, line] of backLines.entries()) veinGeos.push(tubeGeo(line.map(([x, y]) => V(x, y, -front(x, y, -0.006))), 0.013 * S, 48, 10, i === 0 ? 0.3 : 0.5));
  const veins = new THREE.Mesh(place(mergeGeometries(veinGeos)), M.vein);
  veins.name = 'head_veins';
  shell.add(veins);

  const face = new THREE.Group();
  face.name = 'face';
  // smile, with rounded ends
  const smile = [];
  for (let i = 0; i <= 24; i++) { const t = i / 24, x = (t - 0.5) * 0.4, y = 2.235 - 0.082 * Math.sin(Math.PI * t); smile.push(V(x, y, front(x, y, 0.034))); }
  const capR = 0.035 * S;
  const cap = (p, r = capR) => ballGeo([16, 12]).scale(r, r, r).translate(p.x, p.y, p.z);
  const mouth = new THREE.Mesh(place(mergeGeometries([tubeGeo(smile, capR), cap(smile[0]), cap(smile[24])])), M.ink);
  mouth.name = 'mouth';
  face.add(mouth);

  if (eyes === 'open' || eyes === 'both') {
    for (const x of [-0.69, 0.69]) {
      const y = 2.51;
      const center = V(x, y, front(x, y, 0.025));
      const eye = new THREE.Group();
      eye.name = x > 0 ? 'eye_L' : 'eye_R';
      eye.position.copy(center.clone().sub(shellOrigin));
      const ball = new THREE.Mesh(ballGeo(), M.ink);
      ball.name = 'eye_ball';
      ball.scale.set(0.193 * S, 0.262 * S, 0.083 * S);
      ball.rotation.set(0, x * 0.42, -x * 0.12);
      const glint = new THREE.Mesh(ballGeo([24, 16]), M.white);
      glint.name = 'eye_glint';
      glint.scale.set(0.049 * S, 0.063 * S, 0.021 * S);
      glint.position.set(0.052 * S, 0.112 * S, 0.076 * S);
      glint.rotation.y = x * 0.42;
      eye.add(ball, glint);
      face.add(eye);
    }
  }
  if (eyes === 'closed' || eyes === 'both') {
    // happy closed eyes: upturned arcs in the same stroke as the smile
    const parts = [];
    const r = 0.04 * S;
    for (const x0 of [-0.69, 0.69]) {
      const arc = [];
      for (let i = 0; i <= 24; i++) { const t = i / 24, x = x0 + (t - 0.5) * 0.36, y = 2.47 + 0.1 * Math.sin(Math.PI * t); arc.push(V(x, y, front(x, y, 0.036))); }
      parts.push(tubeGeo(arc, r), cap(arc[0], r), cap(arc[24], r));
    }
    const closed = new THREE.Mesh(place(mergeGeometries(parts)), M.ink);
    closed.name = 'eyes_closed';
    face.add(closed);
  }
  shell.add(face);
  head.add(shell);
  return head;
}

// ---------- the body: one blended surface ----------
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
function capsule(x, y, z, a, b, r) {
  const ax = x - a[0], ay = y - a[1], az = z - a[2], bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
  const h = Math.max(0, Math.min(1, (ax * bx + ay * by + az * bz) / (bx * bx + by * by + bz * bz)));
  return Math.hypot(ax - bx * h, ay - by * h, az - bz * h) - r;
}
const mirror = (a, s) => [a[0] * s, a[1], a[2]];

// head radius lookup, so the body field can flare into the underside of the head
const RADIUS_LUT = (() => { const a = new Float32Array(801); for (let i = 0; i <= 800; i++) a[i] = headRadius(1.58 + (i / 800) * 3.29); return a; })();
const radiusAt = (y) => { const f = ((y - 1.58) / 3.29) * 800; if (f <= 0) return 0; if (f >= 800) return 0; const i = Math.floor(f); return RADIUS_LUT[i] + (RADIUS_LUT[i + 1] - RADIUS_LUT[i]) * (f - i); };

/**
 * A slightly shrunk copy of the head's underside, only near the middle. Blending the torso into it
 * gives a smooth flare that tucks under the real head instead of a crease where two shapes cross.
 */
function headUnderside(x, y, z) {
  // the head's lower surface, a hair beneath the shell so the overlap never flickers,
  // running a little past the seam where the head shell takes over
  const d = (Math.hypot(x, z / HEAD_DEPTH) - radiusAt(y)) * HEAD_DEPTH + 0.004;
  return Math.max(d, y - HEAD_SEAM - 0.03);
}

// leaf profile lookup: radius of the lathed leaf at distance y along its axis
const LEAF_LEN = 1.37, LEAF_FLAT = 0.4;
const LEAF_LUT = (() => {
  const pts = new THREE.SplineCurve([[0, 0], [0.22, 0.16], [0.35, 0.43], [0.33, 0.65], [0.23, 0.91], [0.10, 1.18], [0, 1.37]].map(([x, y]) => new THREE.Vector2(x, y))).getPoints(400);
  const a = new Float32Array(401);
  let j = 0;
  for (let i = 0; i <= 400; i++) {
    const y = (i / 400) * LEAF_LEN;
    while (j < pts.length - 2 && pts[j + 1].y < y) j++;
    const p = pts[j], q = pts[j + 1], t = q.y > p.y ? (y - p.y) / (q.y - p.y) : 0;
    a[i] = Math.max(0, p.x + (q.x - p.x) * THREE.MathUtils.clamp(t, 0, 1));
  }
  return a;
})();
const leafR = (y) => { if (y <= 0 || y >= LEAF_LEN) return 0; const f = (y / LEAF_LEN) * 400, i = Math.floor(f); return LEAF_LUT[i] + (LEAF_LUT[i + 1] - LEAF_LUT[i]) * (f - i); };
const leafBase = (s) => [s * 0.42, J.shoulder[1] + 0.03, 0.24]; // forward of the torso, so raised leaves clear the head
/** Puffy lathed leaf pointing out along ±x from the end of the stalk (rest pose). */
function leafSDF(x, y, z, s) {
  const b = leafBase(s);
  const ly = s * (x - b[0]), lx = y - b[1], lz = z - b[2];
  const d = (Math.hypot(lx, lz / LEAF_FLAT) - leafR(ly)) * LEAF_FLAT;
  return Math.max(d, -ly - 0.02, ly - LEAF_LEN - 0.02);
}

/** Reference units. Torso ellipsoid flaring into the head, two bent legs, two leaf arms (stalk and leaf as one). */
export function bodySDF(x, y, z) {
  const yy = y - 1.38;
  const k0 = Math.hypot(x / 0.245, yy / 0.46, z / 0.23), k1 = Math.hypot(x / (0.245 * 0.245), yy / (0.46 * 0.46), z / (0.23 * 0.23));
  let d = k1 > 1e-8 ? (k0 * (k0 - 1)) / k1 : -0.23;
  d = smin(d, headUnderside(x, y, z), 0.24);
  for (const s of [1, -1]) {
    const leg = smin(capsule(x, y, z, mirror(J.hip, s), mirror(J.knee, s), 0.147), capsule(x, y, z, mirror(J.knee, s), mirror(J.ankle, s), 0.147), 0.045);
    d = smin(d, leg, 0.105);
    const sy = J.shoulder[1];
    const stalk = Math.min(
      capsule(x, y, z, [s * 0.13, sy, 0.02], [s * 0.35, sy + 0.02, 0.13], 0.092),
      capsule(x, y, z, [s * 0.35, sy + 0.02, 0.13], [s * 0.52, sy + 0.05, 0.22], 0.08),
    );
    d = smin(d, smin(stalk, leafSDF(x, y, z, s), 0.09), 0.07); // stalk grows into the leaf with no seam
  }
  return d;
}

/** Naive surface nets; each vertex is pulled onto the true surface and gets the field's normal. */
function meshSDF(sdf, min, max, step) {
  const nx = Math.ceil((max.x - min.x) / step) + 1, ny = Math.ceil((max.y - min.y) / step) + 1, nz = Math.ceil((max.z - min.z) / step) + 1;
  const vals = new Float32Array(nx * ny * nz);
  const id = (i, j, k) => i + nx * (j + ny * k);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) vals[id(i, j, k)] = sdf(min.x + i * step, min.y + j * step, min.z + k * step);
  const cellId = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k);
  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const e = 1e-4;
  const grad = (x, y, z) => {
    const gx = sdf(x + e, y, z) - sdf(x - e, y, z), gy = sdf(x, y + e, z) - sdf(x, y - e, z), gz = sdf(x, y, z + e) - sdf(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    return [gx / l, gy / l, gz / l];
  };
  const pos = [], nor = [];
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const v = corners.map(([a, b, c]) => vals[id(i + a, j + b, k + c)]);
    let inside = 0;
    for (const q of v) if (q < 0) inside++;
    if (inside === 0 || inside === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of edges) {
      if ((v[a] < 0) === (v[b] < 0)) continue;
      const t = v[a] / (v[a] - v[b]);
      const ca = corners[a], cb = corners[b];
      sx += ca[0] + (cb[0] - ca[0]) * t; sy += ca[1] + (cb[1] - ca[1]) * t; sz += ca[2] + (cb[2] - ca[2]) * t; n++;
    }
    let x = min.x + (i + sx / n) * step, y = min.y + (j + sy / n) * step, z = min.z + (k + sz / n) * step;
    for (let it = 0; it < 4; it++) { const d = sdf(x, y, z), g = grad(x, y, z); x -= d * g[0]; y -= d * g[1]; z -= d * g[2]; }
    cellVert[cellId(i, j, k)] = pos.length / 3;
    pos.push(x, y, z);
    nor.push(...grad(x, y, z));
  }
  const idx = [];
  const quad = (a, b, c, d) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; idx.push(a, b, c, a, c, d); };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const v0 = vals[id(i, j, k)] < 0;
    if (v0 !== (vals[id(i + 1, j, k)] < 0)) quad(cellVert[cellId(i, j - 1, k - 1)], cellVert[cellId(i, j, k - 1)], cellVert[cellId(i, j, k)], cellVert[cellId(i, j - 1, k)]);
    if (v0 !== (vals[id(i, j + 1, k)] < 0)) quad(cellVert[cellId(i - 1, j, k - 1)], cellVert[cellId(i - 1, j, k)], cellVert[cellId(i, j, k)], cellVert[cellId(i, j, k - 1)]);
    if (v0 !== (vals[id(i, j, k + 1)] < 0)) quad(cellVert[cellId(i - 1, j - 1, k)], cellVert[cellId(i, j - 1, k)], cellVert[cellId(i, j, k)], cellVert[cellId(i - 1, j, k)]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  // make every triangle agree with the field's outward direction
  const Pa = g.attributes.position, N = g.attributes.normal, ix = g.index.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), fn = new THREE.Vector3();
  for (let t = 0; t < ix.length; t += 3) {
    a.fromBufferAttribute(Pa, ix[t]); b.fromBufferAttribute(Pa, ix[t + 1]); c.fromBufferAttribute(Pa, ix[t + 2]);
    fn.subVectors(b, a).cross(c.sub(a));
    if (fn.x * N.getX(ix[t]) + fn.y * N.getY(ix[t]) + fn.z * N.getZ(ix[t]) < 0) { const tmp = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = tmp; }
  }
  return g;
}

const smooth01 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const segT = (p, a, b) => { const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2]; return ((p[0] - a[0]) * bx + (p[1] - a[1]) * by + (p[2] - a[2]) * bz) / (bx * bx + by * by + bz * bz); };

/** Skin weights for a body vertex (reference units). Bone order matches the skeleton in buildSprout. */
function bodyWeights(x, y, z) {
  const p = [x, y, z];
  const w = { hips: 0, legL: 0, shinL: 0, legR: 0, shinR: 0, armL: 0, armR: 0, head: 0 };
  const side = smooth01(-0.03, 0.03, x); // 1 on the character's left (+x)
  const segDist = (a, b) => { const t = Math.min(1, Math.max(0, segT(p, a, b))); return Math.hypot(x - (a[0] + (b[0] - a[0]) * t), y - (a[1] + (b[1] - a[1]) * t), z - (a[2] + (b[2] - a[2]) * t)); };
  const legDist = (s) => Math.min(segDist(mirror(J.hip, s), mirror(J.knee, s)), segDist(mirror(J.knee, s), mirror(J.ankle, s)));
  for (const [s, leg, shin] of [[1, 'legL', 'shinL'], [-1, 'legR', 'shinR']]) {
    const hip = mirror(J.hip, s), knee = mirror(J.knee, s), ankle = mirror(J.ankle, s);
    // only points that are actually on the leg: along it and close to it (leaves must never follow a knee)
    const onLeg = smooth01(-0.05, 0.25, segT(p, hip, knee)) * (s > 0 ? side : 1 - side) * smooth01(0.3, 0.2, legDist(s));
    const pastKnee = smooth01(-0.2, 0.2, segT(p, knee, ankle));
    w[leg] = onLeg * (1 - pastKnee);
    w[shin] = onLeg * pastKnee;
  }
  // the head's underside belongs to the head, however far out it reaches
  const headZone = smooth01(1.5, 1.6, y) * smooth01(0.14, 0.03, Math.hypot(x, z / HEAD_DEPTH) - radiusAt(y));
  // everything outboard of the torso that isn't leg or head is arm: stalk and leaf move as one.
  // The ramp is long so the shoulder bends without pinching, and ends before the leaf starts.
  w.armL = smooth01(0.14, 0.36, x) * smooth01(0.2, 0.3, legDist(1)) * (1 - headZone);
  w.armR = smooth01(0.14, 0.36, -x) * smooth01(0.2, 0.3, legDist(-1)) * (1 - headZone);
  // fully on the head by the time the surface reaches the head's underside, so it never lags when he nods
  w.head = Math.max(smooth01(1.3, 1.56, y), headZone) * (1 - w.armL - w.armR);
  const used = w.legL + w.shinL + w.legR + w.shinR + w.armL + w.armR + w.head;
  w.hips = Math.max(0, 1 - used);
  const order = ['hips', 'legL', 'shinL', 'legR', 'shinR', 'armL', 'armR', 'head'];
  const top = order.map((k, i) => [i, w[k]]).sort((m, n) => n[1] - m[1]).slice(0, 4);
  const sum = top.reduce((acc, [, v]) => acc + v, 0) || 1;
  return { index: top.map(([i]) => i), weight: top.map(([, v]) => v / sum) };
}

function buildBody(M) {
  const g = meshSDF(bodySDF, new THREE.Vector3(-1.9, 0.2, -0.62), new THREE.Vector3(1.9, 2.0, 0.62), 0.017);
  const Pa = g.attributes.position;
  const si = new Uint16Array(Pa.count * 4), sw = new Float32Array(Pa.count * 4);
  for (let i = 0; i < Pa.count; i++) {
    const { index, weight } = bodyWeights(Pa.getX(i), Pa.getY(i), Pa.getZ(i));
    si.set(index, i * 4); sw.set(weight, i * 4);
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.scale(S, S, S); // reference units -> root space
  const body = new THREE.SkinnedMesh(g, M.limb);
  body.name = 'body';
  return body;
}

// ---------- leaf arms ----------

/** Leaf arm. side 1 = character's left (+x), -1 = character's right (-x). The leaf points along ±x at rest. */
export function buildArm(M, side) {
  const origin = P(J.shoulder, side);
  const arm = new THREE.Bone();
  arm.name = side > 0 ? 'arm_L' : 'arm_R';
  // The leaf itself is part of the body surface (see leafSDF), so stalk and leaf are one smooth piece.
  // Only its raised veins live here, authored pointing up (+y) on the leaf's front.
  const v3 = (pts) => pts.map((p) => new THREE.Vector3(...p));
  const veins = mergeGeometries([
    tubeGeo(v3([[0, 0.14, 0.073], [0, 0.46, 0.145], [0, 0.80, 0.114], [0, 1.15, 0.046]]), 0.012, 40, 8, 0.55),
    tubeGeo(v3([[0, 0.46, 0.145], [-0.16, 0.62, 0.121], [-0.23, 0.75, 0.074]]), 0.011, 24, 8, 0.5),
    tubeGeo(v3([[0, 0.67, 0.132], [0.13, 0.85, 0.100], [0.17, 0.95, 0.060]]), 0.011, 24, 8, 0.5),
  ]);
  // lay it along ±x at the leaf's base, then into the arm bone's frame
  const base = V(...leafBase(side));
  veins.rotateZ(-side * Math.PI / 2);
  veins.scale(S, S, S);
  veins.translate(base.x, base.y, base.z);
  into(veins, origin);
  const vein = new THREE.Mesh(veins, M.vein);
  vein.name = 'leaf_vein';
  arm.add(vein);
  return arm;
}

// ---------- boots ----------
function buildBoot(M, side) {
  const boot = new THREE.Group();
  boot.name = side > 0 ? 'boot_L' : 'boot_R';
  boot.rotation.y = side * 0.18; // toes out a little
  const part = (geo, mat, name) => { const m = new THREE.Mesh(geo, mat); m.name = name; boot.add(m); return m; };
  part(ballGeo().scale(0.29 * S, 0.1 * S, 0.4 * S).translate(0, -0.085 * S, 0.13 * S), M.sole, 'boot_sole');
  part(ballGeo().scale(0.285 * S, 0.235 * S, 0.38 * S).translate(0, 0.025 * S, 0.16 * S), M.boot, 'boot_shoe');
  part(new THREE.CylinderGeometry(0.208 * S, 0.23 * S, 0.29 * S, 48).translate(0, 0.175 * S, -0.02 * S), M.boot, 'boot_shaft');
  part(new THREE.TorusGeometry(0.19 * S, 0.048 * S, 16, 48).rotateX(Math.PI / 2).translate(0, 0.322 * S, -0.02 * S), M.cuff, 'boot_cuff');
  const seam = [];
  for (let i = 0; i <= 24; i++) { const a = (Math.PI * i) / 24; seam.push(V(0.268 * Math.cos(a), -0.041, 0.14 + 0.35 * Math.sin(a))); }
  part(tubeGeo(seam, 0.009 * S, 48, 6), M.cuff, 'boot_seam');
  return boot;
}

export function buildLeg(M, side) {
  const hip = P(J.hip, side), knee = P(J.knee, side);
  const leg = new THREE.Bone();
  leg.name = side > 0 ? 'leg_L' : 'leg_R';
  const shin = new THREE.Bone();
  shin.name = side > 0 ? 'shin_L' : 'shin_R';
  shin.position.copy(knee.clone().sub(hip));
  const boot = buildBoot(M, side);
  boot.position.copy(P(J.boot, side).sub(knee));
  shin.add(boot);
  leg.add(shin);
  return { leg, shin, hip };
}

/**
 * Full Sprout rig. Hierarchy (names are the animation contract used at runtime):
 * sprout > root > [body (skinned), hips > [leg_L > shin_L, leg_R > shin_R, arm_L, arm_R, head > head_shell > face]]
 */
export function buildSprout({ eyes = 'open', light = false } = {}) {
  const M = makeMaterials(light);
  const sprout = new THREE.Group();
  const root = new THREE.Group();
  root.name = 'root';
  const hipsAt = P(J.hips);
  const hips = new THREE.Bone();
  hips.name = 'hips';
  hips.position.copy(hipsAt);
  const L = buildLeg(M, 1), R = buildLeg(M, -1);
  L.leg.position.copy(L.hip.clone().sub(hipsAt));
  R.leg.position.copy(R.hip.clone().sub(hipsAt));
  const armL = buildArm(M, 1), armR = buildArm(M, -1);
  armL.position.copy(P(J.shoulder, 1).sub(hipsAt));
  armR.position.copy(P(J.shoulder, -1).sub(hipsAt));
  const head = buildHead(M, { eyes });
  head.position.copy(P(J.neck).sub(hipsAt));
  hips.add(L.leg, R.leg, armL, armR, head);
  root.add(hips);
  sprout.add(root);
  sprout.updateMatrixWorld(true);
  const bones = [hips, L.leg, L.shin, R.leg, R.shin, armL, armR, head];
  const body = buildBody(M);
  root.add(body);
  body.bind(new THREE.Skeleton(bones));
  return { sprout, root, hips, head, armL, armR, legL: L.leg, legR: R.leg, shinL: L.shin, shinR: R.shin, body, M };
}

/** Mirrored arm pose: raise lifts the leaf, forward swings it toward +z, twist turns the blade. */
export function poseArm(arm, side, { raise = 0, forward = 0, twist = 0 } = {}) {
  arm.rotation.set(twist, -side * forward, side * raise);
}
