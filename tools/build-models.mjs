// Builds the seven Series 01 kit Sprouts as optimized GLB files in ../models/archive.
// Run: npm run build:models
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, meshopt, quantize, simplify } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { writeFile, mkdir } from 'node:fs/promises';
import { buildSprout, poseArm } from './sprout-anatomy.mjs';

// GLTFExporter reads its binary output through FileReader, which Node lacks.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((b) => { this.result = b; this.onloadend?.(); this.onload?.({ target: this }); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then((b) => { this.result = `data:${blob.type};base64,${Buffer.from(b).toString('base64')}`; this.onloadend?.(); }); }
};

// ---------- props (held between the leaves, never in hands) ----------
function buildBook() {
  const book = new THREE.Group();
  book.name = 'book';
  const cover = new THREE.MeshPhysicalMaterial({ name: 'book_cover', color: 0x7a4527, roughness: 0.55, clearcoat: 0.2 });
  const paper = new THREE.MeshStandardMaterial({ name: 'book_paper', color: 0xf4e7cc, roughness: 0.9 });
  for (const side of [1, -1]) {
    const half = new THREE.Group();
    half.name = side > 0 ? 'book_half_L' : 'book_half_R';
    half.rotation.y = side * 0.5;
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.29, 0.014), cover);
    c.position.set(side * 0.105, 0, 0.012);
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.195, 0.272, 0.026), paper);
    p.position.set(side * 0.098, 0, -0.012);
    half.add(c, p);
    book.add(half);
  }
  const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.29, 16), cover);
  spine.position.z = 0.012;
  const page = new THREE.Group();
  page.name = 'book_page';
  page.rotation.y = 0.5;
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.265, 0.003), paper);
  leaf.position.set(0.096, 0, -0.027);
  page.add(leaf);
  book.add(spine, page);
  return book;
}

function buildCan() {
  const can = new THREE.Group();
  can.name = 'can';
  const cream = new THREE.MeshPhysicalMaterial({ name: 'can_body', color: 0xeee2c5, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.4 });
  const prof = [[0, 0], [0.085, 0], [0.1, 0.012], [0.106, 0.05], [0.104, 0.13], [0.092, 0.165], [0.06, 0.185], [0.046, 0.19], [0.046, 0.2], [0.0, 0.2]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const body = new THREE.Mesh(new THREE.LatheGeometry(new THREE.SplineCurve(prof).getPoints(40), 36), cream);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.009, 10, 28), cream);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.2;
  const spoutCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.08, 0.045, 0), new THREE.Vector3(0.17, 0.09, 0), new THREE.Vector3(0.26, 0.18, 0), new THREE.Vector3(0.3, 0.23, 0),
  ]);
  const spout = new THREE.Mesh(new THREE.TubeGeometry(spoutCurve, 24, 0.018, 12, false), cream);
  const tip = spoutCurve.getPointAt(1), dir = spoutCurve.getTangentAt(1);
  const rose = new THREE.Group();
  rose.name = 'can_rose_mount';
  rose.position.copy(tip);
  rose.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.02, 0.05, 20), cream);
  cone.position.y = 0.02;
  const marker = new THREE.Object3D();
  marker.name = 'can_rose';
  marker.position.y = 0.05;
  rose.add(cone, marker);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.016, 12, 28, Math.PI), cream);
  handle.rotation.z = Math.PI / 2;
  handle.position.set(-0.085, 0.11, 0);
  can.add(body, rim, spout, rose, handle);
  can.scale.setScalar(1.45);
  return can;
}

// ---------- poses ----------
const sitLegs = (r, lift = -1.42, splay = 0.1, knee = 0) => {
  r.legL.rotation.set(lift, 0, splay);
  r.legR.rotation.set(lift, 0, -splay);
  r.shinL.rotation.x = knee;
  r.shinR.rotation.x = knee;
};
const standLegs = (r, splay = 0.08) => {
  r.legL.rotation.set(0, 0, splay);
  r.legR.rotation.set(0, 0, -splay);
};

const POSES = {
  daydream: {
    eyes: 'open',
    pose(r) {
      sitLegs(r, -1.55, 0.16, 1.15); // knees up, boots planted
      // leaves rest on the ground either side, clear of the knees
      poseArm(r.armL, 1, { raise: -0.72, forward: 0.05, twist: 0.2 });
      poseArm(r.armR, -1, { raise: -0.7, forward: 0.0, twist: 0.2 });
      r.head.rotation.set(-0.14, 0.32, 0.2);
      r.root.rotation.y = 0.18;
    },
  },
  read: {
    eyes: 'open',
    pose(r) {
      sitLegs(r, -1.45, 0.16, 0.12);
      // leaves cradle the book's sides
      poseArm(r.armL, 1, { raise: 0.05, forward: 1.2, twist: 0.1 });
      poseArm(r.armR, -1, { raise: 0.05, forward: 1.2, twist: 0.1 });
      r.head.rotation.set(0.1, 0, 0.04);
      const book = buildBook();
      book.position.set(0, 0.22, 0.44);
      book.rotation.x = 0.4;
      book.scale.setScalar(1.25);
      r.hips.add(book);
    },
  },
  water: {
    eyes: 'open',
    pose(r) {
      standLegs(r, 0.0);
      poseArm(r.armL, 1, { raise: -0.35, forward: 0.8 });
      poseArm(r.armR, -1, { raise: -0.2, forward: 1.45 });
      r.head.rotation.set(0.3, 0.38, -0.04);
      const can = buildCan();
      can.position.set(0.08, -0.1, 0.34);
      can.rotation.z = -0.3;
      r.hips.add(can);
    },
  },
  rest: {
    eyes: 'closed',
    ground: 'center',
    pose(r) {
      r.root.rotation.set(-0.1, 0.15, 0.78);
      r.legL.rotation.set(-0.12, 0, 0.86);
      r.legR.rotation.set(0.1, 0, 0.7);
      poseArm(r.armR, -1, { raise: -0.15, forward: 0.3 });
      poseArm(r.armL, 1, { raise: -0.95, forward: 0.45, twist: -0.25 });
      r.head.rotation.set(0.04, 0.12, 0.1);
    },
  },
  explore: {
    eyes: 'open',
    pose(r) {
      r.legL.rotation.set(-0.42, 0, 0.05);
      r.legR.rotation.set(0.3, 0, -0.05);
      r.shinL.rotation.x = 0.08;
      r.shinR.rotation.x = 0.38; // trailing knee bends
      poseArm(r.armL, 1, { raise: 0.42, forward: 0.0, twist: 0.25 });
      poseArm(r.armR, -1, { raise: 0.42, forward: 0.45, twist: 0.25 });
      r.head.rotation.set(0.02, -0.14, 0.03);
      r.root.rotation.y = 0.28;
    },
  },
  cheer: {
    eyes: 'closed',
    pose(r) {
      standLegs(r, 0.03); // the resting stance is already splayed
      // leaves angled up like the reference, sitting just in front of the head's underside
      poseArm(r.armL, 1, { raise: 0.5, forward: 0.06, twist: 0.3 }); // tops tilt toward us, clear of the head
      poseArm(r.armR, -1, { raise: 0.5, forward: 0.06, twist: 0.3 });
      r.head.rotation.set(-0.04, 0, 0);
    },
  },
  light: {
    eyes: 'closed',
    light: true,
    pose(r) {
      sitLegs(r, -1.35, 0.08, 0.6);
      // leaves draped down beside the bent knees
      poseArm(r.armL, 1, { raise: -0.62, forward: 0.62 });
      poseArm(r.armR, -1, { raise: -0.62, forward: 0.62 });
      r.head.rotation.set(0.06, 0, 0.08);
    },
  },
};

// ---------- export ----------
const r4 = (v) => Math.round(v * 1e4) / 1e4;
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
// nodes whose transforms make up a pose
const POSE_NODES = ['root', 'hips', 'leg_L', 'shin_L', 'leg_R', 'shin_R', 'arm_L', 'arm_R', 'head', 'book', 'can'];
const webPoses = {};
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const outDir = new URL('../models/', import.meta.url);
// the app uses the sculpted models in web/; these kit GLBs are kept for reference only
const archiveDir = new URL('archive/', outDir);
await mkdir(new URL('web/', outDir), { recursive: true });
await mkdir(archiveDir, { recursive: true });
const exporter = new GLTFExporter();

for (const [id, def] of Object.entries(POSES)) {
  const rig = buildSprout({ eyes: def.eyes, light: !!def.light });
  def.pose(rig);
  rig.sprout.name = `sprout_${id}`;
  rig.sprout.userData = { id, eyes: def.eyes, series: '01' };
  // no textures anywhere, so UVs are dead weight
  rig.sprout.traverse((o) => { if (o.isMesh) o.geometry.deleteAttribute('uv'); });
  rig.sprout.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(rig.sprout, true); // precise: follows the skinned body
  rig.root.position.y -= box.min.y;
  if (def.ground === 'center') rig.root.position.x -= (box.min.x + box.max.x) / 2;

  const glb = await exporter.parseAsync(rig.sprout, { binary: true });
  const raw = glb.byteLength;
  const doc = await io.readBinary(new Uint8Array(glb));
  await doc.transform(dedup(), prune({ keepLeaves: true, keepAttributes: true }), weld(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const bytes = await io.writeBinary(doc);
  await writeFile(new URL(`sprout-${id}.glb`, archiveDir), bytes);
  // record the pose so the web kit can reproduce this exact model
  const nodes = {};
  for (const name of POSE_NODES) {
    const o = rig.sprout.getObjectByName(name);
    if (o) nodes[name] = [o.position.toArray().map(r4), o.quaternion.toArray().map(r4), o.scale.toArray().map(r4)];
  }
  webPoses[id] = { eyes: def.eyes, light: !!def.light, prop: rig.sprout.getObjectByName('book') ? 'book' : rig.sprout.getObjectByName('can') ? 'can' : null, nodes };
  let tris = 0;
  rig.sprout.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  console.log(`sprout-${id}.glb  ${(bytes.byteLength / 1024).toFixed(0)} KB (raw ${(raw / 1024).toFixed(0)} KB, ${Math.round(tris)} tris)`);
}

// ---------- web kit ----------
// Sandboxed hosts (claude.ai artifacts) serve neither .glb nor data: fetches and block WebAssembly,
// so meshopt can't decode there. The page instead gets ONE shared Sprout (both eye styles, both props,
// rest pose) as a quantized GLB inside a JS module, plus the seven poses above. The anatomy is shared
// by construction and the download is a seventh of the size.
{
  const kit = buildSprout({ eyes: 'both' });
  const book = buildBook(); kit.hips.add(book);
  const can = buildCan(); kit.hips.add(can);
  kit.sprout.name = 'sprout_kit';
  kit.sprout.traverse((o) => { if (o.isMesh) o.geometry.deleteAttribute('uv'); });
  const glb = await exporter.parseAsync(kit.sprout, { binary: true });
  const doc = await io.readBinary(new Uint8Array(glb));
  await doc.transform(
    dedup(), prune({ keepLeaves: true, keepAttributes: true }), weld(),
    // drop triangles only where the surface is nearly flat; curves and grooves stay put
    simplify({ simplifier: MeshoptSimplifier, ratio: 0.0, error: 0.00035, lockBorder: true }),
    quantize({ quantizeNormal: 12 }),
  );
  const bytes = await io.writeBinary(doc);
  await writeFile(new URL('web/sprout-kit.js', outDir), `// Generated by tools/build-models.mjs. One shared Sprout, quantized GLB, base64.\nexport default '${Buffer.from(bytes).toString('base64')}';\n`);
  await writeFile(new URL('web/poses.js', outDir), `// Generated by tools/build-models.mjs. Node transforms [position, quaternion, scale] per Sprout.\nexport const POSES = ${JSON.stringify(webPoses)};\n`);
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) tris += (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION').getCount()) / 3;
  console.log(`web/sprout-kit.js  ${(bytes.byteLength / 1024).toFixed(0)} KB binary, ${Math.round(tris)} tris after simplify`);
}
