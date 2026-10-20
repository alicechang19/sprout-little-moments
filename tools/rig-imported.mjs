// Rigs an imported, single-mesh Sprout (e.g. an image-to-3D export already run through
// import-model.mjs) with the same joint names the app animates, and writes the web files:
//   models/web/<id>-model.js      quantized, skinned GLB (no textures) as a base64 module
//   models/web/<id>-color.webp    base colour
//   models/web/<id>-normal.webp   normal map
//   models/web/<id>-orm.webp      glTF metallic/roughness map
// Textures ship as plain images because the artifact sandbox won't let GLTFLoader decode
// images embedded in a GLB (it fetches blob: URLs, which the page's policy blocks).
//
// Usage: node tools/rig-imported.mjs <id> [--blend]
// --blend: write the Blender source instead (models/blend/<id>/: full-precision rigged GLB and
// lossless PNG textures), for tools/blender/make_blend.py. models/web is left alone.
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, quantize, dedup, prune } from '@gltf-transform/functions';
import { writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((b) => { this.result = b; this.onloadend?.(); this.onload?.({ target: this }); }); }
};

// Per-model rig: joint positions measured from the mesh (in its own units), a head profile for
// telling head from leaf, and the scale into app units. Measured with height slices of the mesh.
// distance from point p to the segment a-b (for rig shapes)
const capsule = (a, b, p) => {
  const ab = [0, 1, 2].map((k) => b[k] - a[k]), ap = [0, 1, 2].map((k) => p[k] - a[k]);
  const t = Math.max(0, Math.min(1, (ab[0] * ap[0] + ab[1] * ap[1] + ab[2] * ap[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)));
  return Math.hypot(...[0, 1, 2].map((k) => ap[k] - ab[k] * t));
};

const TORSO = [[-0.02, 0.1, 0.03], [0.3, 0.06, 0.12]]; // Rest's torso, lying from its neck to its hips

const RIGS = {
  cheer: {
    src: 'cheer-a250000', // 250k triangles, simplified weighing normals too, so the vein grooves keep clean edges
    texSrc: 'cheer-original', // textures come from the untouched original (4K, same atlas)
    smooth: 0.05, smoothPasses: 16, // smoothing radius around the cut, and passes
    bake: [0.03, 0.065], // the generator baked a contact shadow around each leaf seam: repaint it, full to fade
    scale: 2.07 / 0.979, // app standing height / model height
    joints: {
      hips: [0, 0.12, 0],
      leg: [0.045, 0.115, 0], shin: [0.08, 0.06, 0],
      shoulder: [0.062, 0.215, 0.004],
      neck: [0, 0.26, 0],
    },
    // head cross-section by height, measured from the mesh: [y, half-width x, half-depth z, z centre]
    headProfile: [
      [0.29, 0.03, 0.03, 0.01], [0.30, 0.07, 0.058, 0.016], [0.32, 0.136, 0.1, 0.027], [0.34, 0.192, 0.144, 0.023],
      [0.36, 0.225, 0.175, 0.018], [0.38, 0.249, 0.199, 0.013], [0.40, 0.27, 0.221, 0.016], [0.44, 0.296, 0.239, 0.006],
      [0.50, 0.312, 0.255, 0],
    ],
    headAll: 0.46, // above this, only head (the leaf tips reach about 0.42)
    headMargin: 1.12, // the head is not a perfect ellipse; its surface can read slightly outside
    leafThick: 0.1, // thicker than this, and a vertex near the head belongs to the head
    // arms: each leaf and stalk is traced as one connected piece, outward of the stalk root
    armRoot: 0.058, armBend: 0.02, armLow: 0.165, armHigh: 0.46,
    neck: [0.255, 0.29], // below the head, the neck blends from body to head
    legTop: 0.13, bootTop: 0.065,
  },
  read: {
    src: 'read-a250000',
    texSrc: 'read-original',
    smooth: 0.05, smoothPasses: 16,
    bake: [0.03, 0.065],
    scale: (2.07 / 0.979) * (0.312 / 0.308), // same head size as Cheer
    joints: {
      hips: [0, 0.1, 0.02],
      leg: [0.045, 0.1, 0.05], shin: [0.07, 0.06, 0.12], // unused: it sits still
      shoulder: [0.12, 0.2, 0.05], // unused: its leaves hold the book, which stays put
      neck: [0, 0.29, 0],
    },
    arms: false,
    headAll: 0.34,
    neck: [0.27, 0.31], neckReach: 0.08,
    eyes: [{ near: [-0.13, 0.42, 0.17] }, { near: [0.13, 0.42, 0.17] }],
    headUp: [0, 1, 0],
    // the open book in its lap: the spine sits a little left of the pages' centre
    book: { below: 0.32, spineU: -0.045, edgeU: 0.14, halfHeight: 0.12, lift: 0.0015, flip: Math.PI - 0.06 },
    // the generator left the back of its head plain: a vein like the front one, a little softer.
    // Curves are [start, bend, end, width] in (x, y), seen from behind
    backVein: {
      box: [-0.2, 0.2, 0.45, 0.9], depth: 0.02, shade: 0.04,
      curves: [
        [[0.0, 0.83], [0.006, 0.7], [0.0, 0.555], 0.03], // the stem
        [[0.0, 0.6], [0.04, 0.612], [0.085, 0.68], 0.022], // a branch sweeping up to one side
        [[0.0, 0.625], [-0.035, 0.635], [-0.072, 0.7], 0.02], // and the other
      ],
    },
  },
  water: {
    src: 'water-a250000',
    texSrc: 'water-original',
    smooth: 0.05, smoothPasses: 16,
    bake: [0.03, 0.065],
    scale: (2.07 / 0.979) * (0.312 / 0.323), // same head size as Cheer
    joints: {
      hips: [0, 0.12, 0.02],
      leg: [0.04, 0.12, 0.02], shin: [0.06, 0.06, 0.04], // unused: it stands still
      shoulder: [0.066, 0.247, 0.014], shoulderR: [-0.075, 0.269, 0.009], // where each stalk leaves the body
      neck: [-0.02, 0.33, 0.02],
    },
    headAll: 0.42, headMargin: 1.12, leafThick: 0.07,
    grid: [0.1, 0.42, -1],
    thinArms: true, // its leaves curl across the front of its body, holding the can
    core: [0, 0.055, 0.06], // the body's middle: |x - 0| < 0.055 and behind z 0.06
    armRoot: 0.06, armBend: 0.02, armLow: 0.18, armHigh: 0.42, tipY: [0.19, 0.32],
    neck: [0.31, 0.35], neckReach: 0.1,
    // the watering can is its own piece of the mesh, held by its right leaf (-x)
    prop: { near: [0, 0.23, 0.12], arm: -1 },
    // that leaf came out of the generator floating beside the torso, about 0.04 away, joined to nothing
    // but the can. A stalk joins them, from the torso's side to the back of the hand where they face
    stalk: { torso: [-0.075, 0.269, 0.009], hand: [-0.101, 0.277, 0.041], sink: [0.012, 0.014], r: [0.021, 0.017], flare: 0.006, arm: -1 },
    rose: [0.178, 0.226, 0.198], // the spout's sprinkler head
    // the generator sculpted the water as a solid splash from the spout onto the seedling: cut it
    // (the page pours drops), keeping the pot and seedling, which are the model's own
    stream: { near: [0.27, 0.05, 0.17], above: 0.095, loose: 400 },
    ownPot: true,
    eyes: [{ near: [-0.209, 0.479, 0.166], r: 0.07 }, { near: [0.082, 0.455, 0.178], r: 0.07 }], // the mouth sits close
    headUp: [0, 1, 0],
    // its leaves' veins have extra branches and spiky hairlines. Replacing them with the series' clean
    // vein (Cheer's) in code isn't clean enough yet, so this is parked (renamed) until it is.
    // Curves in leaf units: u 0 at the stalk to 1 at the tip, v across
    leafVeinsParked: {
      groove: 0.0012, radius: 0.012, evenPasses: 30, rounds: 3, depth: 0.007, shade: 0.04,
      curves: [
        [[0.2, 0.0], [0.5, 0.06], [0.82, 0.04], 0.016], // the midrib, toward the tip
        [[0.22, 0.02], [0.45, 0.12], [0.62, 0.42], 0.012], // one branch, out toward the edge
      ],
    },
    // the back of its head is plain: the same vein as Read's, centred on this head (0.034 to one side)
    backVein: {
      box: [-0.24, 0.17, 0.45, 0.9], depth: 0.02, shade: 0.04,
      curves: [
        [[-0.034, 0.83], [-0.028, 0.7], [-0.034, 0.555], 0.03],
        [[-0.034, 0.6], [0.006, 0.612], [0.051, 0.68], 0.022],
        [[-0.034, 0.625], [-0.069, 0.635], [-0.106, 0.7], 0.02],
      ],
    },
  },
  daydream: {
    src: 'daydream-a250000',
    texSrc: 'daydream-original',
    smooth: 0.05, smoothPasses: 16,
    bake: [0.03, 0.065],
    scale: (2.07 / 0.979) * (0.312 / 0.328), // same head size as Cheer (his head is 0.328 wide, Cheer's 0.312)
    joints: {
      hips: [0.015, 0.12, 0.05],
      leg: [0.045, 0.12, 0.08], shin: [0.07, 0.12, 0.2], // unused: his legs stay put
      shoulder: [0.087, 0.15, 0.12], // where the leaf's base meets his side, beside the knee
      neck: [0.015, 0.23, 0.02],
    },
    headAll: 0.36, // above this, only head
    headMargin: 1.12,
    leafThick: 0.1,
    grid: [0.08, 0.4, 0.03],
    // inward of 0.09 the leaf presses on his thigh, so each leaf starts there
    armRoot: 0.09, armBend: 0.02, armLow: 0.09, armHigh: 0.36, tipY: [0.12, 0.26],
    neck: [0.2, 0.25], neckReach: 0.09, // his knees come up close under his head
    // Tripo painted a second smile on the back of his head
    // (carved as well as painted, so it's smoothed out much harder than a seam)
    erase: [{ c: [0.055, 0.426, -0.292], r: [0.065, 0.09], passes: 120 }],
    // its eyes are painted open, so it blinks
    eyes: [{ near: [-0.18, 0.44, 0.2] }, { near: [0.115, 0.52, 0.245] }],
    headUp: [-0.25, 1, -0.12], // its head tips back and to one side; eyes close along its axis
  },
  explore: {
    src: 'explore-a250000',
    texSrc: 'explore-original',
    smooth: 0.05, smoothPasses: 16,
    bake: [0.03, 0.065],
    scale: (2.07 / 0.979) * (0.312 / 0.289), // same head size as Cheer
    joints: {
      hips: [0, 0.15, 0.01],
      // mid-stride: left boot forward and lifted, right one back. Its legs are short stubs above the boots
      leg: [0.035, 0.15, 0.01], shin: [0.06, 0.11, 0.05],
      shoulder: [0.055, 0.23, 0.005], // where each leaf's stalk leaves the torso
      neck: [0, 0.28, 0.01],
    },
    // its leaves stand out flat to each side (|z| < 0.06), so the head is measured out of their plane
    headProfile: [
      [0.30, 0.04, 0.047, 0.022], [0.31, 0.07, 0.062, 0.035], [0.32, 0.104, 0.083, 0.038], [0.33, 0.14, 0.105, 0.033],
      [0.34, 0.165, 0.124, 0.028], [0.36, 0.2, 0.154, 0.018], [0.38, 0.229, 0.176, 0.01], [0.40, 0.248, 0.2, 0.014],
      [0.44, 0.276, 0.216, 0], [0.50, 0.289, 0.233, 0],
    ],
    headAll: 0.39, // its right leaf's tip curls up to about 0.37, against the head
    headMargin: 1.12,
    leafThick: 0.1,
    grid: [0.15, 0.4, 0.06],
    armRoot: 0.065, armBend: 0.02, armLow: 0.155, armHigh: 0.39, tipY: [0.2, 0.37],
    neck: [0.27, 0.31],
    legTop: 0.15, bootTop: 0.11,
    // its eyes are painted open, so it blinks (the smile sits 0.11 from each eye: keep the search tight)
    eyes: [{ near: [-0.154, 0.484, 0.19], r: 0.075 }, { near: [0.146, 0.482, 0.19], r: 0.075 }],
    headUp: [0, 1, 0],
  },
  rest: {
    src: 'rest-a250000',
    texSrc: 'rest-original',
    smooth: 0.05, smoothPasses: 16,
    bake: [0.03, 0.065],
    // its head leans about 20 degrees, so measured across its own axis it's 0.35 to Cheer's 0.312
    scale: (2.07 / 0.979) * (0.312 / 0.35),
    // It sits slumped asleep: its head rests low, the torso runs out sideways under it toward +x, and its
    // legs stretch forward from the torso's end. Its leaves lie low on each side: the left one (+x) props up
    // against its cheek, the right one rests on the ground.
    joints: {
      hips: [0.28, 0.07, 0.11],
      leg: [0.36, 0.07, 0.15], legR: [0.27, 0.07, 0.16],
      shin: [0.4, 0.07, 0.22], shinR: [0.27, 0.06, 0.24], // unused: nothing bends its knees
      shoulder: [0.025, 0.16, -0.015], shoulderR: [-0.04, 0.078, -0.035], // where each traced stalk meets the body
      neck: [0, 0.11, 0.04],
    },
    // its head is as low as its body, so height can't tell them apart: the head is everything that isn't
    // the torso (a capsule from the neck to the hips), the legs, or the leaf lying on the ground
    headWeight: (x, y, z) => (1 - sm(0.085, 0.06, capsule(TORSO[0], TORSO[1], [x, y, z]))) * sm(0.06, 0.1, y)
      * (1 - sm(0.17, 0.21, x) * sm(0.1, 0.14, z) * sm(0.2, 0.16, y)),
    keepRoot: 0.16, // its left leaf's stalk rises into the neck, which counts as head: don't cut it there
    headAll: 0.33, headMargin: 1.12, leafThick: 0.07,
    grid: [-1, 0.45, -1],
    thinArms: true, // traced from a point on each leaf, along the thin blade and stalk until the torso
    fillSpecks: 3, // the trace skips a few vertices inside each blade (around the veins): fill them in
    armSeed: { L: [0.36, 0.27, 0.08], R: [-0.34, 0.17, 0.2] },
    // its leaves' lower edges are fused to the torso and leg: bending into the body over 0.02 tore that strip
    // as the leaves swing, so they bend over 0.06
    armBend: 0.06, armLow: -1, armHigh: 0.33,
    neck: [0.1, 0.15],
    // the legs: beyond the torso's end and in front of it, below the boot tops. The left one is further out
    legZone: (x, y, z) => sm(0.19, 0.23, x) * sm(0.12, 0.16, z) * sm(0.19, 0.16, y),
    // (scaled down 3x so the split between them blends over ±0.03, not ±0.01: its stretch lifts the two legs by
    // different amounts, and the boots touch along x 0.325, so a hard split shears there)
    legSide: (x) => (x - 0.325) / 3,
    // its torso is as thin as a leaf stalk: the traces stop at a capsule around it (narrower under the left
    // leaf's blade, which rests on it), where it rises into the head (the two leaves' stalks almost meet
    // there), and at the legs. (A third, small leaf lies on the ground behind it: see drop.)
    armBlock: (x, y, z) => capsule(TORSO[0], TORSO[1], [x, y, z]) < (x > 0.08 ? 0.055 : 0.07) || Math.hypot(x - 0.02, y - 0.15, z - 0.06) < 0.07 || x > 0.2 && z > 0.12 && y < 0.17
      || x > 0.05 && y < 0.115 // the torso's top, under the left leaf's blade
      || x < 0 && y < 0.07, // the third leaf, on the ground
    // Rest has two leaves. The generator added a third, small one under its head, sloping from the ground at
    // its back up to where it sprouts beside the right leaf's base (0.095 high). The cut is a plane across that
    // base, 0.035 in toward the body so no stub of its stalk is left (at 0.05 in it would reach the right leaf)
    // The stalk left at the cut is smoothed within 0.03 of it into a rounded end, and the cap domes only a little
    drop: { seed: [-0.15, 0, -0.08], base: [-0.094, 0.082, 0.007], inset: 0.035, smooth: 0.03, dome: 0.12 },
    // headWeight counts the far end of the torso and the tops of the legs as head (it only has to keep them off
    // the hips). Cutting the left leaf free there left a ragged, capped seam along its leg and inside-out slits:
    // cut a leaf from the body only where it truly meets the head, which starts above 0.17 here
    seamZone: (x, y, z) => y > 0.17 && RIGS.rest.headWeight(x, y, z) > 0.5,
  },
  light: {
    src: 'light-a250000',
    texSrc: 'light-original',
    smooth: 0.05, smoothPasses: 16,
    bake: [0.03, 0.065],
    scale: (2.07 / 0.979) * (0.312 / 0.315), // same head size as Cheer
    // It sits with its knees up and its boots out in front. Its tall teardrop head sits straight on a
    // short torso; each leaf hangs from the top of the torso, down its side and over the knee.
    joints: {
      hips: [0, 0.08, -0.04],
      leg: [0.045, 0.08, 0], shin: [0.055, 0.1, 0.15], // unused: its legs stay put
      shoulder: [0.07, 0.205, -0.02], // where each leaf's stalk leaves the torso
      neck: [0, 0.245, -0.04],
    },
    // the head starts where the torso ends; the leaves (up to 0.24) never reach it
    headProfile: [[0.25, 0.06, 0.05, -0.04], [0.27, 0.14, 0.1, -0.03], [0.3, 0.2, 0.14, -0.03], [0.35, 0.27, 0.19, -0.04], [0.45, 0.313, 0.235, -0.04]],
    headAll: 0.26,
    headMargin: 1.12, leafThick: 0.1,
    // its leaves are plump, not thin blades. Each hangs down the torso's side (|x| 0.075), then folds
    // forward over its knee, where the two meet in the middle. So a leaf is everything on its side that's
    // outward of the torso, or in front of it (z 0.035) and above the shin tops (0.125). Where it rests on
    // the body (stalk, torso, knee, the other leaf) it stays put, bending away over armBend
    armZone: (x, y, z, s) => s * x > 0.004 && (s * x > 0.09 || (z > 0.035 && y > 0.125)),
    armBend: 0.03, armLow: 0.095, armHigh: 0.245, tipY: [0.12, 0.2],
    neck: [0.22, 0.27],
    // its eyes are painted closed (it doesn't blink). The back of its head is plain: Read's vein, sized
    // to this taller head
    backVein: {
      box: [-0.2, 0.2, 0.47, 0.86], depth: 0.02, shade: 0.04,
      curves: [
        [[0.0, 0.8], [0.006, 0.67], [0.0, 0.52], 0.03],
        [[0.0, 0.57], [0.045, 0.585], [0.095, 0.665], 0.022],
        [[0.0, 0.6], [-0.04, 0.61], [-0.085, 0.68], 0.02],
      ],
    },
  },
};

const id = process.argv[2];
const BLEND = process.argv.includes('--blend');
const R = RIGS[id];
if (!R) throw new Error(`No rig for "${id}". Known: ${Object.keys(RIGS).join(', ')}`);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(fileURLToPath(new URL(`../models/src/${R.src}.glb`, import.meta.url)));
await doc.transform(weld());
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const mat = prim.getMaterial();

// ---- textures: the full-quality originals (same atlas as the decimated mesh), written at the end
const outDir = new URL(BLEND ? `../models/blend/${id}/` : '../models/web/', import.meta.url);
if (BLEND) await (await import('node:fs/promises')).mkdir(outDir, { recursive: true });
const texDoc = await io.read(fileURLToPath(new URL(`../models/src/${R.texSrc}.glb`, import.meta.url)));
const texMat = texDoc.getRoot().listMaterials()[0];
const texIn = { color: texMat.getBaseColorTexture(), normal: texMat.getNormalTexture(), orm: texMat.getMetallicRoughnessTexture() };
const seams = []; // where each leaf was cut from the head: { c: centre in app units, side }

// ---- geometry into three.js, scaled into app units
const attr = (name) => prim.getAttribute(name).getArray();
const geo = new THREE.BufferGeometry();
let pos = Float32Array.from(attr('POSITION')).map((v) => v * R.scale);
geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
geo.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(attr('NORMAL')), 3));
geo.setAttribute('uv', new THREE.BufferAttribute(Float32Array.from(attr('TEXCOORD_0')), 2));
geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(prim.getIndices().getArray()), 1));

// ---- skeleton (same names and parenting as the code-built Sprouts)
const J = R.joints, S = R.scale;
const at = (p, side = 1) => new THREE.Vector3(p[0] * side * S, p[1] * S, p[2] * S);
const bone = (name, world, parentWorld, parent) => {
  const b = new THREE.Bone();
  b.name = name;
  b.position.copy(world.clone().sub(parentWorld));
  parent?.add(b);
  return b;
};
const origin = new THREE.Vector3();
// shoulders mirror unless the model gives the right one its own place
const shoulderAt = (s) => (s < 0 && J.shoulderR ? at(J.shoulderR) : at(J.shoulder, s));
// and legs likewise, for a Sprout whose legs aren't posed in mirror image
const legAt = (s) => (s < 0 && J.legR ? at(J.legR) : at(J.leg, s));
const shinAt = (s) => (s < 0 && J.shinR ? at(J.shinR) : at(J.shin, s));
const hipsW = at(J.hips);
const hips = bone('hips', hipsW, origin);
const legs = {}, shins = {}, arms = {};
for (const [s, k] of [[1, 'L'], [-1, 'R']]) {
  legs[k] = bone(`leg_${k}`, legAt(s), hipsW, hips);
  shins[k] = bone(`shin_${k}`, shinAt(s), legAt(s), legs[k]);
  arms[k] = bone(`arm_${k}`, shoulderAt(s), hipsW, hips);
}
const head = bone('head', at(J.neck), hipsW, hips);
// the watering can's spout, carried by the arm that holds the can (the page pours drops from it)
if (R.rose) {
  const rose = new THREE.Object3D();
  rose.name = 'can_rose';
  const side = R.prop.arm;
  rose.position.copy(at(R.rose).sub(shoulderAt(side)));
  arms[side > 0 ? 'L' : 'R'].add(rose);
}

// ---- skin weights, in model units
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
let nv = pos.length / 3;
const X = (i) => pos[i * 3] / S, Y = (i) => pos[i * 3 + 1] / S, Z = (i) => pos[i * 3 + 2] / S;

// head: elliptical cross-sections interpolated from the measured profile. rho < 1 is inside.
const rootOf = (s) => (typeof R.armRoot === 'number' ? R.armRoot : R.armRoot[s > 0 ? 'L' : 'R']);
const HP = R.headProfile;
const headRho = (x, y, z) => {
  if (y >= R.headAll) return 0;
  if (!HP) return 1; // no profile (a tilted head): thickness alone tells head from leaf
  if (y < HP[0][0]) return 9;
  let k = 0;
  while (k < HP.length - 2 && y > HP[k + 1][0]) k++;
  const [y0, ...a] = HP[k], [y1, ...b] = HP[k + 1];
  const t = Math.min(1, (y - y0) / (y1 - y0));
  const [rx, rz, zc] = a.map((v, j) => v + (b[j] - v) * t);
  return Math.hypot(x / rx, (z - zc) / rz);
};

// adjacency over positions (the mesh is split at UV seams, so weld by position first)
const same = new Map();
let pid = new Int32Array(nv);
for (let i = 0; i < nv; i++) {
  const k = `${Math.round(X(i) * 1e5)},${Math.round(Y(i) * 1e5)},${Math.round(Z(i) * 1e5)}`;
  if (!same.has(k)) same.set(k, i);
  pid[i] = same.get(k);
}
let idx = geo.index.array;
const nbr = new Map();
const link = (a, b) => { (nbr.get(a) ?? nbr.set(a, []).get(a)).push(b); };
for (let t = 0; t < idx.length; t += 3) {
  const [a, b, c] = [pid[idx[t]], pid[idx[t + 1]], pid[idx[t + 2]]];
  link(a, b); link(b, a); link(b, c); link(c, b); link(c, a); link(a, c);
}

// head or leaf? Near the head, the leaf's upper edge sits right against the head's surface, so
// distance alone can't tell them apart. Thickness can: step inward from a leaf vertex and you come
// out the other side of the blade almost at once; from a head vertex you're inside the whole head.
let nrm = geo.attributes.normal.array;
const CELL = 0.01;
const G = R.grid ?? [0.24, 0.5, 0.08]; // where leaves can be: [y min, y max, |x| min]
const grid = new Map();
const cellKey = (x, y, z) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
for (let t = 0; t < idx.length; t += 3) {
  const v = [idx[t], idx[t + 1], idx[t + 2]];
  if (!v.some((i) => Y(i) > G[0] && Y(i) < G[1] && Math.abs(X(i)) > G[2])) continue; // only near the leaves
  const lo = [0, 1, 2].map((k) => Math.min(...v.map((i) => pos[i * 3 + k] / S)));
  const hi = [0, 1, 2].map((k) => Math.max(...v.map((i) => pos[i * 3 + k] / S)));
  for (let gx = Math.floor(lo[0] / CELL); gx <= Math.floor(hi[0] / CELL); gx++)
    for (let gy = Math.floor(lo[1] / CELL); gy <= Math.floor(hi[1] / CELL); gy++)
      for (let gz = Math.floor(lo[2] / CELL); gz <= Math.floor(hi[2] / CELL); gz++) {
        const k = `${gx},${gy},${gz}`;
        (grid.get(k) ?? grid.set(k, []).get(k)).push(t);
      }
}
const hitDistance = (i, maxT, d = [-nrm[i * 3], -nrm[i * 3 + 1], -nrm[i * 3 + 2]]) => {
  const o = [X(i), Y(i), Z(i)];
  const tried = new Set();
  let best = Infinity;
  for (let t = 0; t <= maxT + CELL; t += CELL * 0.5) {
    const cell = grid.get(cellKey(o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t));
    if (!cell) continue;
    for (const tri of cell) {
      if (tried.has(tri)) continue;
      tried.add(tri);
      const [a, b, c] = [idx[tri], idx[tri + 1], idx[tri + 2]];
      if (pid[a] === pid[i] || pid[b] === pid[i] || pid[c] === pid[i]) continue;
      // Moller-Trumbore
      const A = [X(a), Y(a), Z(a)], e1 = [X(b) - A[0], Y(b) - A[1], Z(b) - A[2]], e2 = [X(c) - A[0], Y(c) - A[1], Z(c) - A[2]];
      const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
      const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
      if (Math.abs(det) < 1e-12) continue;
      const tv = [o[0] - A[0], o[1] - A[1], o[2] - A[2]];
      const u = (tv[0] * p[0] + tv[1] * p[1] + tv[2] * p[2]) / det;
      if (u < 0 || u > 1) continue;
      const q = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]];
      const w = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det;
      if (w < 0 || u + w > 1) continue;
      const dist = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
      if (dist > 1e-5 && dist < best) best = dist;
    }
    if (best <= t) break;
  }
  return best;
};
// shortest of a few inward rays: a ray straight in from a leaf's rim runs along the blade, but the
// tilted ones cross it
const thickness = (i) => {
  const n = [-nrm[i * 3], -nrm[i * 3 + 1], -nrm[i * 3 + 2]];
  const a = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]];
  const ul = Math.hypot(...u); for (let k = 0; k < 3; k++) u[k] /= ul;
  const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  let best = hitDistance(i, R.leafThick, n);
  const tilt = Math.tan(1.0); // about 57 degrees off the normal
  for (const [p, q] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
    if (best < R.leafThick) break;
    const d = [0, 1, 2].map((k) => n[k] + tilt * (p * u[k] + q * v[k]));
    const l = Math.hypot(...d);
    best = Math.min(best, hitDistance(i, R.leafThick, d.map((x) => x / l)));
  }
  return best;
};
const headCache = new Map();
const isHead = (i) => {
  const rho = headRho(X(i), Y(i), Z(i));
  if (rho > R.headMargin) return false;
  if (Y(i) >= R.headAll) return true;
  if (!headCache.has(i)) headCache.set(i, thickness(i) > R.leafThick);
  return headCache.get(i);
};

if (process.env.DEBUG_THICK) {
  const buckets = {};
  for (let i = 0; i < nv; i += 7) {
    if (X(i) > -0.1 || Y(i) < 0.26 || Y(i) > 0.44) continue;
    const rho = headRho(X(i), Y(i), Z(i));
    const k = `x${(Math.floor(-X(i) * 20) / 20).toFixed(2)} rho${rho < 1 ? '<1' : rho < 1.12 ? '1-1.12' : '>1.12'}`;
    const d = hitDistance(i, 0.3);
    (buckets[k] ??= []).push(d);
  }
  for (const [k, ds] of Object.entries(buckets).sort()) { ds.sort((a, b) => a - b); const q = (f) => ds[Math.floor(f * (ds.length - 1))]; console.log(k, ds.length, 'p10', q(0.1).toFixed(3), 'p50', q(0.5).toFixed(3), 'p90', q(0.9).toFixed(3)); }
}
// each arm: flood from the leaf tip through everything outward of the stalk root that isn't head.
// The leaf's upper edge is fused to the head's underside, which this keeps on the head.
// separate pieces of the mesh (a held prop or a pot can be their own); leaves are only looked for on the
// body, the largest piece
const comp = new Int32Array(nv).map((_, i) => i);
const find = (a) => { while (comp[a] !== a) a = comp[a] = comp[comp[a]]; return a; };
for (let t = 0; t < idx.length; t += 3) { const a = find(pid[idx[t]]), b = find(pid[idx[t + 1]]), c = find(pid[idx[t + 2]]); comp[a] = b; comp[find(b)] = c; }
const pieceSize = new Map();
for (let i = 0; i < nv; i++) { const r = find(pid[i]); pieceSize.set(r, (pieceSize.get(r) ?? 0) + 1); }
const bodyPiece = [...pieceSize].sort((a, b) => b[1] - a[1])[0][0];
const onBody = (i) => find(pid[i]) === bodyPiece;
let armOf = new Int8Array(nv); // 0 none, 1 left (+x), -1 right
for (const s of R.arms === false ? [] : [1, -1].filter((q) => R.stalk?.arm !== q)) { // a stalked arm is its prop alone
  let tip = 0;
  const [tipLo, tipHi] = R.tipY ?? [R.armLow, R.armHigh]; // heights to look for the leaf tip in
  let best = -9;
  const seed = R.armSeed?.[s > 0 ? 'L' : 'R'];
  if (seed) { // a leaf that isn't the widest thing at its height (a Sprout not standing up): start nearest this point
    for (let i = 0; i < nv; i++) { if (!onBody(i)) continue; const d = -Math.hypot(X(i) - seed[0], Y(i) - seed[1], Z(i) - seed[2]); if (d > best) { best = d; tip = i; } }
  } else for (let i = 0; i < nv; i++) if (Y(i) > tipLo && Y(i) < tipHi && s * X(i) > best && onBody(i)) { best = s * X(i); tip = i; }
  const ok = R.thinArms
    // leaves that curl across the body: follow the thin leaf, stop where the thick torso begins
    // (and never through the body's core, the narrow neck and torso down its middle)
    ? (i) => onBody(i) && Y(i) > R.armLow && Y(i) < R.armHigh && !(R.core && Math.abs(X(i) - R.core[0]) < R.core[1] && Z(i) < R.core[2]) && !R.armBlock?.(X(i), Y(i), Z(i)) && !isHead(i) && thickness(i) < R.leafThick
    // (or, for leaves that don't simply stick out sideways, inside the zone the config gives)
    : (i) => onBody(i) && (R.armZone ? R.armZone(X(i), Y(i), Z(i), s) : s * X(i) > rootOf(s)) && Y(i) > R.armLow && Y(i) < R.armHigh && !isHead(i);
  const seen = new Uint8Array(nv), queue = [pid[tip]];
  seen[pid[tip]] = 1;
  while (queue.length) {
    const v = queue.pop();
    for (const u of nbr.get(v) ?? []) if (!seen[u] && ok(u)) { seen[u] = 1; queue.push(u); }
  }
  // specks the trace stepped around: a vertex mostly surrounded by leaf is leaf
  for (let pass = 0; pass < (R.fillSpecks ?? 0); pass++) {
    const add = [];
    for (const [v, ns] of nbr) if (!seen[v] && onBody(v) && ns.filter((u) => seen[u]).length >= ns.length * 0.75) add.push(v);
    for (const v of add) seen[v] = 1;
  }
  if (process.env.DEBUG_ARM_DUMP) await writeFile(`${process.env.DEBUG_ARM_DUMP}-${s > 0 ? 'L' : 'R'}.json`, JSON.stringify([...seen.keys()].filter((v) => seen[v]).filter((_, k) => k % 3 === 0).map((v) => [X(v), Y(v), Z(v)].map((q) => +q.toFixed(3)))));
  let count = 0, top = 0, inner = 1;
  for (let i = 0; i < nv; i++) if (seen[pid[i]]) { armOf[i] = s; count++; top = Math.max(top, Y(i)); inner = Math.min(inner, s * X(i)); }
  console.log(`arm ${s > 0 ? 'L' : 'R'}: ${count} verts, top ${top.toFixed(3)}, inner ${inner.toFixed(3)}`);
  { const c = [0, 0, 0]; let k = 0; for (let i = 0; i < nv; i++) if (armOf[i] === s && s * X(i) < inner + 0.012) { c[0] += X(i); c[1] += Y(i); c[2] += Z(i); k++; }
    const lo = [9, 9, 9], hi = [-9, -9, -9]; for (let i = 0; i < nv; i++) if (armOf[i] === s) { lo[0] = Math.min(lo[0], X(i)); lo[1] = Math.min(lo[1], Y(i)); lo[2] = Math.min(lo[2], Z(i)); hi[0] = Math.max(hi[0], X(i)); hi[1] = Math.max(hi[1], Y(i)); hi[2] = Math.max(hi[2], Z(i)); }
    console.log(`  root centre ${c.map((v) => (v / k).toFixed(3)).join(', ')} | bbox ${lo.map((v) => v.toFixed(3)).join(',')} .. ${hi.map((v) => v.toFixed(3)).join(',')}`); }
  if (process.env.DEBUG_ARM) {
    const miss = {};
    for (let i = 0; i < nv; i++) {
      if (armOf[i] || s * X(i) < 0.12 || Y(i) < 0.26 || Y(i) > 0.44) continue;
      const rho = headRho(X(i), Y(i), Z(i));
      if (rho < 1.3) continue; // clearly not head: why wasn't it reached?
      const b = (Math.floor(Y(i) * 50) / 50).toFixed(2);
      const h = miss[b] ??= { n: 0, x: [9, 0], z: [9, -9], rho: 9 };
      h.n++; h.x = [Math.min(h.x[0], s * X(i)), Math.max(h.x[1], s * X(i))]; h.z = [Math.min(h.z[0], Z(i)), Math.max(h.z[1], Z(i))]; h.rho = Math.min(h.rho, rho);
    }
    console.log('  unreached, well outside the head:'); for (const [b, h] of Object.entries(miss).sort()) console.log('   ', b, h.n, 'x', h.x.map((v) => v.toFixed(3)).join('-'), 'z', h.z.map((v) => v.toFixed(3)).join('-'), 'rho', h.rho.toFixed(2));
    const hist = {};
    for (let i = 0; i < nv; i++) if (armOf[i] === s) { const b = (Math.floor(Y(i) * 50) / 50).toFixed(2); const h = hist[b] ??= { n: 0, xmin: 9, xmax: 0, rho: 9, zmin: 9, zmax: -9 }; h.n++; h.xmin = Math.min(h.xmin, s * X(i)); h.xmax = Math.max(h.xmax, s * X(i)); h.zmin = Math.min(h.zmin, Z(i)); h.zmax = Math.max(h.zmax, Z(i)); h.rho = Math.min(h.rho, headRho(X(i), Y(i), Z(i))); }
    for (const [b, h] of Object.entries(hist).sort()) console.log(' ', b, h.n, 'x', h.xmin.toFixed(3), h.xmax.toFixed(3), 'z', h.zmin.toFixed(3), h.zmax.toFixed(3), 'minRho', h.rho.toFixed(2));
  }
}

// thin-traced leaves bend over a short distance from where they meet the body, measured along the surface
const bendW = new Float32Array(nv).fill(1);
// (how far a leaf vertex is from its shoulder: keepRoot leaves a stalk joined where it meets the body)
const fromRoot = (i) => { const j = armOf[i] < 0 && J.shoulderR ? J.shoulderR : [J.shoulder[0] * (armOf[i] || 1), J.shoulder[1], J.shoulder[2]]; return Math.hypot(X(i) - j[0], Y(i) - j[1], Z(i) - j[2]); };
// leaves traced inside an armZone touch the body all along it too, so they bend the same way
const traced = R.thinArms || !!R.armZone;
if (traced) {
  const dist = new Map(), queue = [];
  for (let i = 0; i < nv; i++) {
    if (!armOf[i] || pid[i] !== i) continue;
    if ((nbr.get(i) ?? []).some((u) => !armOf[u] && onBody(u))) { dist.set(i, 0); queue.push(i); }
  }
  for (let h = 0; h < queue.length; h++) { // breadth-first, keeping the shortest edge-length sum
    const v = queue[h], dv = dist.get(v);
    if (dv > R.armBend) continue;
    for (const u of nbr.get(v) ?? []) {
      if (!armOf[u]) continue;
      const d = dv + Math.hypot(X(u) - X(v), Y(u) - Y(v), Z(u) - Z(v));
      if (d < (dist.get(u) ?? Infinity)) { dist.set(u, d); queue.push(u); }
    }
  }
  for (let i = 0; i < nv; i++) if (armOf[i]) bendW[i] = sm(0, R.armBend, dist.get(pid[i]) ?? Infinity);
}

// ---- separate pieces of the mesh: a prop held in one leaf (a watering can) is carried rigidly by
// that arm; a sculpted water stream is cut away so the page can pour animated drops instead
const rigid = new Uint8Array(nv); // moves wholly with its arm, no bend at the root
const streamTri = new Set();
if (R.prop || R.stream) {
  const compAt = (p) => { let best = 0, bd = Infinity; for (let i = 0; i < nv; i++) { const d = Math.hypot(X(i) - p[0], Y(i) - p[1], Z(i) - p[2]); if (d < bd) { bd = d; best = i; } } return find(pid[best]); };
  if (R.prop) {
    const c = compAt(R.prop.near);
    let k = 0;
    for (let i = 0; i < nv; i++) if (find(pid[i]) === c) { armOf[i] = R.prop.arm; rigid[i] = 1; k++; }
    console.log(`prop: ${k} vertices carried by arm ${R.prop.arm > 0 ? 'L' : 'R'}`);
  }
  if (R.stream) {
    const c = compAt(R.stream.near);
    const sharp = (await import('sharp')).default;
    const ci = await sharp(Buffer.from(texIn.color.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const uvE = geo.attributes.uv.array, W = ci.info.width, H = ci.info.height;
    // the water is pale and nearly colourless; the seedling it falls on is clearly green
    const light = (i) => { const o = (Math.min(H - 1, Math.floor(uvE[i * 2 + 1] * H)) * W + Math.min(W - 1, Math.floor(uvE[i * 2] * W))) * 3; const c = [ci.data[o], ci.data[o + 1], ci.data[o + 2]], mx = Math.max(...c), mn = Math.min(...c); return mx > 55 && (mx - mn) / mx < 0.32; };
    for (let t = 0; t < idx.length; t += 3) {
      const v = [idx[t], idx[t + 1], idx[t + 2]];
      if (v.every((i) => find(pid[i]) === c && Y(i) > R.stream.above && light(i))) streamTri.add(t);
    }
    console.log(`stream: ${streamTri.size} triangles to cut`);
  }
}
// a piece the generator added that the figure shouldn't have (Rest's third leaf): everything joined to
// `seed` on its side of a plane across the piece's `base` (square to the line from the base to the seed,
// moved `inset` toward the body), cut away. Its opening is closed like the other cuts
const dropTri = new Set();
let dropOut = null; // the cut's outward direction, toward where the piece was
let dropAt = null; // the cut plane: a point on it, in model units
const dropRim = []; // the surface left along the cut, in model units (smoothed into a rounded end)
const capW = new Map(); // a drop cap's vertices follow their arm as much as the surface they close
if (R.drop) {
  const { seed, base, inset = 0 } = R.drop;
  let s = 0, bd = Infinity;
  for (let i = 0; i < nv; i++) { const d = Math.hypot(X(i) - seed[0], Y(i) - seed[1], Z(i) - seed[2]); if (d < bd) { bd = d; s = pid[i]; } }
  const ax = [X(s) - base[0], Y(s) - base[1], Z(s) - base[2]], al = Math.hypot(...ax);
  dropOut = ax.map((q) => q / al);
  dropAt = base.map((q, k) => q - dropOut[k] * inset);
  const out = (u) => ((X(u) - base[0]) * ax[0] + (Y(u) - base[1]) * ax[1] + (Z(u) - base[2]) * ax[2]) / al > -inset;
  const gone = new Uint8Array(nv), queue = [s];
  gone[s] = 1;
  while (queue.length) { const v = queue.pop(); for (const u of nbr.get(v) ?? []) if (!gone[u] && out(u)) { gone[u] = 1; queue.push(u); } }
  for (let t = 0; t < idx.length; t += 3) if (gone[pid[idx[t]]] && gone[pid[idx[t + 1]]] && gone[pid[idx[t + 2]]]) dropTri.add(t);
  for (let i = 0; i < nv; i++) if (pid[i] === i && !gone[i] && (nbr.get(i) ?? []).some((u) => gone[u])) dropRim.push([X(i), Y(i), Z(i)]);
  console.log(`drop: ${dropTri.size} triangles cut`);
}

// ---- separate each leaf from the head where the generator fused them
// The leaf's upper edge touches the head, and the mesh joins them there with a thin band of
// triangles. Left in, that band stretches as the arm waves. Cut it, then close the small opening
// on each side so the head and the leaf are both whole surfaces again.
{
  const uv = geo.attributes.uv.array;
  const keep = [], caps = [];
  const bridge = (v) => {
    const arm = v.map((i) => armOf[i]);
    const s = arm.find((a) => a);
    if (!s || arm.every((a) => a === s)) return 0;
    // leaves traced by thinness meet the body wherever their stalk does: only cut where one touches the head
    if (R.keepRoot && v.some((i) => armOf[i] && fromRoot(i) < R.keepRoot)) return 0;
    // (or, where the config says, only where one touches its seamZone)
    const touches = R.seamZone ?? (R.headWeight ? (x, y, z) => R.headWeight(x, y, z) > 0.5 : (x, y) => y > R.neck[1]);
    if (traced) return v.some((i) => !armOf[i] && touches(X(i), Y(i), Z(i))) ? s : 0;
    return v.every((i) => s * X(i) > rootOf(s) + R.armBend + 0.01) ? s : 0; // not the stalk root, which bends
  };
  let cutCount = 0, loops = 0;
  const edgeKey = (a, b) => (pid[a] < pid[b] ? `${pid[a]}|${pid[b]}` : `${pid[b]}|${pid[a]}`);
  const cutBy = new Map(); // edge -> what was cut next to it ('seam', 'stream' or 'drop')
  for (let t = 0; t < idx.length; t += 3) {
    const v = [idx[t], idx[t + 1], idx[t + 2]];
    const kind = bridge(v) ? 'seam' : streamTri.has(t) ? 'stream' : dropTri.has(t) ? 'drop' : null;
    if (!kind) { keep.push(...v); continue; }
    cutCount++;
    for (let k = 0; k < 3; k++) cutBy.set(edgeKey(v[k], v[(k + 1) % 3]), kind);
  }
  // the sculpted splash leaves loose droplets once it's cut: drop any small piece left floating above
  // the soil (they'd hang in the air)
  if (R.stream) {
    const up = new Map();
    const fu = (a) => { while (up.get(a) !== a) { const g = up.get(up.get(a)); up.set(a, g); a = g; } return a; };
    for (const i of keep) if (!up.has(pid[i])) up.set(pid[i], pid[i]);
    for (let t = 0; t < keep.length; t += 3) { up.set(fu(pid[keep[t]]), fu(pid[keep[t + 1]])); up.set(fu(pid[keep[t + 1]]), fu(pid[keep[t + 2]])); }
    const size = new Map(), low = new Map();
    for (let t = 0; t < keep.length; t += 3) { const r = fu(pid[keep[t]]); size.set(r, (size.get(r) ?? 0) + 1); low.set(r, Math.min(low.get(r) ?? 9, ...[0, 1, 2].map((k) => Y(keep[t + k])))); }
    const loose = new Set([...size].filter(([r, n]) => n < R.stream.loose && low.get(r) > R.stream.above).map(([r]) => r));
    const kept = [];
    let dropped = 0;
    for (let t = 0; t < keep.length; t += 3) { if (loose.has(fu(pid[keep[t]]))) { dropped++; continue; } kept.push(keep[t], keep[t + 1], keep[t + 2]); }
    keep.length = 0;
    for (const i of kept) keep.push(i);
    console.log(`stream: dropped ${loose.size} loose droplets (${dropped} triangles)`);
  }
  // smooth away the lump the fused seam leaves on each surface (fading out from the cut), then
  // re-derive the shading normals there from the smoothed surface
  {
    const cutPts = [];
    for (let t = 0; t < idx.length; t += 3) {
      const v = [idx[t], idx[t + 1], idx[t + 2]];
      if (bridge(v)) for (const i of v) cutPts.push([X(i), Y(i), Z(i)]);
    }
    const lo = cutPts.reduce((m, p) => p.map((q, k) => Math.min(m[k], q)), [9, 9, 9]);
    const hi = cutPts.reduce((m, p) => p.map((q, k) => Math.max(m[k], q)), [-9, -9, -9]);
    const r = R.smooth, fade = new Map(), passes = new Map();
    for (let i = 0; i < nv; i++) {
      if (pid[i] !== i) continue;
      const p = [X(i), Y(i), Z(i)];
      if (cutPts.length && !p.some((q, k) => q < lo[k] - r || q > hi[k] + r)) {
        let d = Infinity;
        for (const c of cutPts) d = Math.min(d, Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]));
        if (d < r) { fade.set(i, sm(r, r * 0.3, d)); passes.set(i, R.smoothPasses); }
      }
      // and round off the surface left where a dropped piece was cut, over a shorter reach (it's the end of a
      // thin stalk, which smoothing further would thin)
      const rd = R.drop?.smooth ?? 0;
      if (dropRim.length && rd) {
        let d = Infinity;
        for (const c of dropRim) d = Math.min(d, Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]));
        if (d < rd) { fade.set(i, Math.max(fade.get(i) ?? 0, sm(rd, rd * 0.3, d))); passes.set(i, Math.max(passes.get(i) ?? 0, R.smoothPasses)); }
      }
      // marks the generator invented (like a second mouth on the back of the head): level them too
      for (const e of R.erase ?? []) {
        const d = Math.hypot(p[0] - e.c[0], p[1] - e.c[1], p[2] - e.c[2]);
        if (d < e.r[1]) { fade.set(i, Math.max(fade.get(i) ?? 0, sm(e.r[1], e.r[0], d))); passes.set(i, Math.max(passes.get(i) ?? 0, e.passes ?? R.smoothPasses)); }
      }
    }
    // neighbours within the same surface (head stays with head, leaf with leaf), after the cut
    const nb = new Map();
    for (let t = 0; t < keep.length; t += 3) for (let k = 0; k < 3; k++) {
      const a = pid[keep[t + k]], b = pid[keep[t + (k + 1) % 3]];
      if (!fade.has(a) && !fade.has(b)) continue;
      (nb.get(a) ?? nb.set(a, new Set()).get(a)).add(b);
      (nb.get(b) ?? nb.set(b, new Set()).get(b)).add(a);
    }
    const P = new Map([...nb.keys()].map((i) => [i, [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]]));
    const most = Math.max(0, ...passes.values());
    for (let it = 0; it < (process.env.NO_SMOOTH ? 0 : most); it++) {
      const nextP = new Map();
      for (const [i, w] of fade) {
        if (it >= passes.get(i)) continue;
        const ns = [...(nb.get(i) ?? [])];
        if (!ns.length) continue;
        const avg = [0, 0, 0];
        for (const j of ns) for (let k = 0; k < 3; k++) avg[k] += P.get(j)[k] / ns.length;
        nextP.set(i, P.get(i).map((q, k) => q + (avg[k] - q) * 0.5 * w));
      }
      for (const [i, p] of nextP) P.set(i, p);
    }
    // an invented mark that was carved in: rebuild that patch from the head's own curve. Fit a gently
    // curved surface (a quadratic height field, in the spot's own frame) to the untouched ring around
    // it, then set the patch onto that surface.
    for (const e of R.erase ?? []) {
      const ring = [], nAvg = [0, 0, 0];
      for (let i = 0; i < nv; i++) {
        if (pid[i] !== i || armOf[i]) continue;
        const d = Math.hypot(X(i) - e.c[0], Y(i) - e.c[1], Z(i) - e.c[2]);
        if (d > e.r[1] && d < e.r[1] + 0.04) { ring.push([X(i), Y(i), Z(i)]); for (let k = 0; k < 3; k++) nAvg[k] += nrm[i * 3 + k]; }
      }
      const N = nAvg.map((v) => v / Math.hypot(...nAvg));
      const ax = Math.abs(N[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const U = [N[1] * ax[2] - N[2] * ax[1], N[2] * ax[0] - N[0] * ax[2], N[0] * ax[1] - N[1] * ax[0]];
      const ul = Math.hypot(...U); for (let k = 0; k < 3; k++) U[k] /= ul;
      const V = [N[1] * U[2] - N[2] * U[1], N[2] * U[0] - N[0] * U[2], N[0] * U[1] - N[1] * U[0]];
      const local = (p) => { const r = p.map((v, k) => v - e.c[k]); return [0, 1, 2].map((j) => r[0] * [U, V, N][j][0] + r[1] * [U, V, N][j][1] + r[2] * [U, V, N][j][2]); };
      const basis = (u, v) => [1, u, v, u * u, u * v, v * v];
      const M = Array.from({ length: 6 }, () => new Array(6).fill(0)), rhs = new Array(6).fill(0);
      for (const p of ring) {
        const [u, v, h] = local(p), row = basis(u, v);
        for (let i = 0; i < 6; i++) { rhs[i] += row[i] * h; for (let j = 0; j < 6; j++) M[i][j] += row[i] * row[j]; }
      }
      for (let c = 0; c < 6; c++) { // Gauss-Jordan
        let piv = c; for (let r = c + 1; r < 6; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
        [M[c], M[piv]] = [M[piv], M[c]]; [rhs[c], rhs[piv]] = [rhs[piv], rhs[c]];
        for (let r = 0; r < 6; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k < 6; k++) M[r][k] -= f * M[c][k]; rhs[r] -= f * rhs[c]; }
      }
      const coef = rhs.map((v, k) => v / M[k][k]);
      const height = (u, v) => basis(u, v).reduce((a, b, k) => a + b * coef[k], 0);
      let moved = 0, err = 0;
      for (const p of ring) { const [u, v, h] = local(p); err = Math.max(err, Math.abs(h - height(u, v))); }
      for (const [q] of fade) {
        if (armOf[q]) continue;
        const d = Math.hypot(X(q) - e.c[0], Y(q) - e.c[1], Z(q) - e.c[2]);
        if (d > e.r[1]) continue;
        const w = sm(e.r[1], e.r[0], d);
        const p = P.get(q).map((v) => v / S), [u, v, h] = local(p), h2 = height(u, v);
        P.set(q, p.map((val, k) => (val + N[k] * (h2 - h) * w) * S));
        moved++;
      }
      console.log(`erase at ${e.c.join(',')}: surface fit to ${ring.length} points (max miss ${err.toFixed(4)}), set ${moved} vertices onto it`);
    }
    for (let i = 0; i < nv; i++) {
      const p = fade.has(pid[i]) && P.get(pid[i]);
      if (p) for (let k = 0; k < 3; k++) pos[i * 3 + k] = p[k];
    }
    // area-weighted face normals over the kept triangles, blended in by the same fade
    const fn = new Map();
    for (let t = 0; t < keep.length; t += 3) {
      const v = [keep[t], keep[t + 1], keep[t + 2]];
      if (!v.some((i) => fade.has(pid[i]))) continue;
      const A = [0, 1, 2].map((k) => pos[v[0] * 3 + k]), e1 = [0, 1, 2].map((k) => pos[v[1] * 3 + k] - A[k]), e2 = [0, 1, 2].map((k) => pos[v[2] * 3 + k] - A[k]);
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      for (const i of v) { const q = fn.get(pid[i]) ?? fn.set(pid[i], [0, 0, 0]).get(pid[i]); for (let k = 0; k < 3; k++) q[k] += n[k]; }
    }
    for (let i = 0; i < nv; i++) {
      const w = fade.get(pid[i]), q = fn.get(pid[i]);
      if (!w || !q || process.env.NO_SMOOTH) continue;
      const l = Math.hypot(...q) || 1;
      const m = [0, 1, 2].map((k) => nrm[i * 3 + k] + (q[k] / l - nrm[i * 3 + k]) * w);
      const ml = Math.hypot(...m) || 1;
      for (let k = 0; k < 3; k++) nrm[i * 3 + k] = m[k] / ml;
    }
    console.log(`smoothed ${fade.size} vertices around the cut`);
  }
  // open edges, keyed by welded position, with the direction the triangle using it runs
  const openEdges = (list) => {
    const edges = new Map();
    for (let t = 0; t < list.length; t += 3) for (let k = 0; k < 3; k++) {
      const a = list[t + k], b = list[t + (k + 1) % 3];
      const key = pid[a] < pid[b] ? `${pid[a]}|${pid[b]}` : `${pid[b]}|${pid[a]}`;
      const e = edges.get(key);
      if (e) e.n++; else edges.set(key, { n: 1, a, b, key });
    }
    return [...edges.values()].filter((e) => e.n === 1);
  };
  const before = new Set(openEdges(idx).map((e) => e.key));
  // group the new openings: each connected hole (and each side of it: head, leaf) gets its own cap.
  // A dropped piece's opening is one cap, even where it runs from the body onto a leaf's stalk
  const fresh = openEdges(keep).filter((e) => !before.has(e.key));
  const hole = new Map();
  const findH = (a) => { while (hole.get(a) !== a) { const up = hole.get(hole.get(a)); hole.set(a, up); a = up; } return a; };
  for (const e of fresh) for (const q of [pid[e.a], pid[e.b]]) if (!hole.has(q)) hole.set(q, q);
  for (const e of fresh) hole.set(findH(pid[e.a]), findH(pid[e.b]));
  const groups = new Map();
  for (const e of fresh) {
    const g = `${findH(pid[e.a])}|${cutBy.get(e.key) === 'drop' ? 'drop' : armOf[e.a]}`;
    (groups.get(g) ?? groups.set(g, []).get(g)).push(e);
  }
  // close each opening with a fan from its centre. Order doesn't matter: each open edge gets one
  // triangle, facing the same way as the triangle it borders.
  const extra = { pos: [], nrm: [], uv: [], arm: [], pid: [] };
  for (const edgesOf of groups.values()) {
    const dropCap = edgesOf.some((e) => cutBy.get(e.key) === 'drop');
    const side = dropCap ? 0 : armOf[edgesOf[0].a];
    const ring = [...new Set(edgesOf.flatMap((e) => [e.a, e.b]))];
    // the cut follows whole triangles, so its rim zigzags across the plane: set the rim onto the plane (each
    // copy of a rim vertex alike), so the cap closes a clean edge instead of fanning over a saw-tooth
    if (dropCap) {
      const onRim = new Set(ring.map((i) => pid[i]));
      for (let i = 0; i < nv; i++) {
        if (!onRim.has(pid[i])) continue;
        const d = (X(i) - dropAt[0]) * dropOut[0] + (Y(i) - dropAt[1]) * dropOut[1] + (Z(i) - dropAt[2]) * dropOut[2];
        for (let k = 0; k < 3; k++) pos[i * 3 + k] -= d * dropOut[k] * S;
      }
    }
    const c = [0, 0, 0];
    for (const i of ring) for (let k = 0; k < 3; k++) c[k] += pos[i * 3 + k] / ring.length;
    // cap normal: the average of the (smoothed) surface around the opening, so it shades as one with it.
    // A dropped piece's opening is a cross-section (its surface normals point every way round it and
    // cancel), so that cap is flat, facing out of the cut
    const cn = dropCap ? [...dropOut] : [0, 0, 0];
    if (!dropCap) for (const i of ring) for (let k = 0; k < 3; k++) cn[k] += nrm[i * 3 + k];
    const cl = Math.hypot(...cn) || 1;
    for (let k = 0; k < 3; k++) cn[k] /= cl;
    // and its vertices follow an arm as the ring does: copies keep their vertex's weight, and the centre
    // takes the ring's average
    const ringArm = dropCap ? (ring.find((i) => armOf[i]) !== undefined ? armOf[ring.find((i) => armOf[i])] : 0) : side;
    const armW = (i) => (armOf[i] && armOf[i] === ringArm ? (traced ? (bendW[i] ?? 1) : 1) : 0);
    // one colour for the whole cap, from inside the repainted band (the ring can
    // straddle a texture seam, and interpolating across one smears in other parts of the atlas)
    let pick = ring[0], pickD = Infinity;
    const notHead = (i) => !(R.headWeight && R.headWeight(X(i), Y(i), Z(i)) > 0.5);
    const rimR = Math.max(...ring.map((i) => Math.hypot(pos[i * 3] - c[0], pos[i * 3 + 1] - c[1], pos[i * 3 + 2] - c[2]))) / S;
    for (let i = 0; i < nv; i++) {
      if (armOf[i] !== side || (dropCap && !notHead(i))) continue;
      const d = Math.hypot(pos[i * 3] - c[0], pos[i * 3 + 1] - c[1], pos[i * 3 + 2] - c[2]) / S;
      // well inside the fully repainted band: plain colour, flat normal (a drop cap's band runs from its rim)
      const off = Math.abs(d - (dropCap ? rimR : R.bake[0] * 0.7));
      if (d > 0.01 && off < pickD) { pickD = off; pick = i; }
    }
    const cu = [uv[pick * 2], uv[pick * 2 + 1]];
    // cap vertices: copies of the ring (same place and weights) plus the centre, all facing one way
    const base = nv + extra.pos.length / 3, at = new Map();
    // texture coordinates: the cap laid flat and shrunk into a few texels around the picked colour.
    // (Not a single point: three.js derives the normal map's direction from how they vary.)
    const ax = Math.abs(cn[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const tu = [cn[1] * ax[2] - cn[2] * ax[1], cn[2] * ax[0] - cn[0] * ax[2], cn[0] * ax[1] - cn[1] * ax[0]];
    const tl = Math.hypot(...tu); for (let k = 0; k < 3; k++) tu[k] /= tl;
    const tv = [cn[1] * tu[2] - cn[2] * tu[1], cn[2] * tu[0] - cn[0] * tu[2], cn[0] * tu[1] - cn[1] * tu[0]];
    const span = Math.max(...ring.map((i) => Math.hypot(pos[i * 3] - c[0], pos[i * 3 + 1] - c[1], pos[i * 3 + 2] - c[2])));
    const k2 = 0.0015 / span; // the whole cap fits in about 6 texels of a 4K map
    for (const i of [...ring, -1]) {
      const vi = base + at.size;
      at.set(i, vi);
      // (a dropped piece's cap domes out a little, so it shades as a rounded end rather than a flat disc)
      const p = i >= 0 ? [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]] : dropCap ? c.map((q, k) => q + cn[k] * span * (R.drop.dome ?? 0.35)) : c;
      const r = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
      extra.pos.push(...p); extra.nrm.push(...(i < 0 ? cn : [nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]]));
      extra.uv.push(cu[0] + k2 * (r[0] * tu[0] + r[1] * tu[1] + r[2] * tu[2]), cu[1] + k2 * (r[0] * tv[0] + r[1] * tv[1] + r[2] * tv[2]));
      if (dropCap && ringArm) {
        const w = i < 0 ? ring.reduce((a, j) => a + armW(j), 0) / ring.length : armW(i);
        extra.arm.push(w > 0 ? ringArm : 0);
        if (w > 0) capW.set(vi, w);
      } else extra.arm.push(side);
      extra.pid.push(i < 0 ? -1 : pid[i]);
    }
    for (const e of edgesOf) caps.push(at.get(e.b), at.get(e.a), at.get(-1));
    if (edgesOf.some((e) => cutBy.get(e.key) === 'seam')) seams.push({ c, side, r: R.bake }); // only seams had a contact shadow
    // a dropped piece's cap: repaint around it too, on each surface its rim runs over, so the cap and its
    // surroundings are the one plain colour of the surface just beyond (no dark junction, no pale fringe)
    // (the stalk and torso only: the head's underside close by is darker, and would darken the fill)
    // (side null: its rim runs across the body and a leaf's stalk, and the triangles straddling them need it most)
    if (dropCap) seams.push({ c, side: null, r: [rimR + 0.015, rimR + 0.05], only: notHead, fixed: true, orm: true });
    loops++;
  }
  const add = extra.pos.length / 3;
  pos = Float32Array.from([...pos, ...extra.pos]);
  nrm = Float32Array.from([...nrm, ...extra.nrm]);
  const uv2 = Float32Array.from([...uv, ...extra.uv]);
  armOf = Int8Array.from([...armOf, ...extra.arm]);
  pid = Int32Array.from([...pid, ...extra.pid.map((q, k) => (q < 0 ? nv + k : q))]);
  nv += add;
  idx = Uint32Array.from([...keep, ...caps]);
  // An opening whose rim is partly leaf and partly body is closed by two fans, one from each part's
  // centre, and a thin slot is left open between them (it shows the ground through the body, and widens
  // as the leaf moves). Fill whatever is still open that wasn't open in the scan: walk each such rim
  // against the direction of the triangles beside it, and fan it closed from its first vertex.
  {
    const count = new Map(), dir = new Map();
    for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) {
      const a = idx[t + k], b = idx[t + (k + 1) % 3], key = edgeKey(a, b);
      count.set(key, (count.get(key) ?? 0) + 1);
      dir.set(key, [a, b]);
    }
    const nxt = new Map(); // welded rim vertex -> the open edge leaving it, reversed: { from, to }
    for (const [key, n] of count) if (n === 1 && !before.has(key)) { const [a, b] = dir.get(key); nxt.set(pid[b], { from: b, to: a }); }
    const fill = [], done = new Set();
    let filled = 0, skipped = 0;
    for (const [start, e0] of nxt) {
      if (done.has(start)) continue;
      const poly = [e0.from], seen = new Set([start]);
      let e = e0, ok = true;
      while (pid[e.to] !== start) {
        const next = nxt.get(pid[e.to]);
        if (!next || seen.has(pid[e.to])) { ok = false; break; }
        seen.add(pid[e.to]); poly.push(next.from); e = next;
      }
      for (const q of seen) done.add(q);
      if (!ok || poly.length < 3) { skipped++; continue; }
      for (let i = 1; i < poly.length - 1; i++) fill.push(poly[0], poly[i], poly[i + 1]);
      filled++;
    }
    if (fill.length) idx = Uint32Array.from([...idx, ...fill]);
    console.log(`filled ${filled} slots left between caps (${fill.length / 3} triangles)${skipped ? `, ${skipped} rims not simple loops` : ''}`);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv2, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  console.log(`cut ${cutCount} fused triangles, closed ${loops} openings with ${caps.length / 3} triangles`);
}

// ---- a stalk for a leaf the generator left floating beside the body (Water's hand on its can):
// a tube from inside the torso to inside the hand, narrowing toward the hand like a leaf's stalk and
// flared where it leaves the torso, both ends buried in the surfaces. It bends from the body into the arm, so the hand stays joined as the arm moves.
const stalkW = new Map(); // vertex -> how much it follows the arm
if (R.stalk) {
  const { torso, hand, sink, r: [rT, rH], flare, arm: s } = R.stalk;
  const N = (i) => [nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]];
  const normV = (q) => { const l = Math.hypot(...q) || 1; return q.map((c) => c / l); };
  const near = (p, ok, reach) => {
    const n = [0, 0, 0];
    let best = -1, bd = Infinity;
    for (let i = 0; i < nv; i++) {
      if (!ok(i)) continue;
      const d = Math.hypot(X(i) - p[0], Y(i) - p[1], Z(i) - p[2]);
      if (d < bd) { bd = d; best = i; }
      if (d < reach) N(i).forEach((q, k) => { n[k] += q; });
    }
    const l = Math.hypot(...n);
    return { i: best, n: l ? n.map((q) => q / l) : N(best) };
  };
  // each end goes in along its surface's inward normal
  const tn = near(torso, (i) => !armOf[i] && onBody(i), 0.012).n, hn = near(hand, (i) => rigid[i], 0.012).n;
  const A = torso.map((q, k) => q - tn[k] * sink[0]), B = hand.map((q, k) => q - hn[k] * sink[1]);
  const axis = B.map((q, k) => q - A[k]), len = Math.hypot(...axis), ax = axis.map((q) => q / len);
  const ref = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = normV([ax[1] * ref[2] - ax[2] * ref[1], ax[2] * ref[0] - ax[0] * ref[2], ax[0] * ref[1] - ax[1] * ref[0]]);
  const v = [ax[1] * u[2] - ax[2] * u[1], ax[2] * u[0] - ax[0] * u[2], ax[0] * u[1] - ax[1] * u[0]];
  // where the stalk leaves the torso surface and enters the hand, as fractions along it
  const tOut = sink[0] / len, tIn = 1 - sink[1] / len;
  const radius = (t) => rT + (rH - rT) * sm(tOut, tIn, t) + flare * sm(tOut + 0.3, tOut - 0.05, t);
  // colour: a few texels of the torso's own green, next to where the stalk meets it
  const uvA = geo.attributes.uv.array, pick = near(torso, (i) => !armOf[i] && onBody(i), 0).i;
  const cu = [uvA[pick * 2], uvA[pick * 2 + 1]];
  const SEG = 28, RINGS = 16, base = nv;
  const P = [], Nn = [], UV = [], tri = [];
  for (let j = 0; j <= RINGS; j++) {
    const t = j / RINGS, rr = radius(t), dr = (radius(t + 0.01) - radius(t - 0.01)) / (0.02 * len); // slope, for the normal
    for (let k = 0; k < SEG; k++) {
      const a = (k / SEG) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      const out = [0, 1, 2].map((m) => c * u[m] + sn * v[m]);
      P.push(...[0, 1, 2].map((m) => (A[m] + axis[m] * t + out[m] * rr) * S));
      Nn.push(...normV([0, 1, 2].map((m) => out[m] - ax[m] * dr)));
      UV.push(cu[0] + 0.0004 * c, cu[1] + 0.0004 * sn + 0.0008 * t);
      // body at the torso end, all arm by the middle, so the bend happens where the stalk meets the torso
      stalkW.set(base + j * SEG + k, sm(tOut, 0.55, t));
    }
  }
  for (let j = 0; j < RINGS; j++) for (let k = 0; k < SEG; k++) {
    const a = base + j * SEG + k, b = base + j * SEG + (k + 1) % SEG, c = a + SEG, d = b + SEG;
    tri.push(a, b, d, a, d, c); // facing outward: u, v, axis is right-handed
  }
  const add = P.length / 3;
  pos = Float32Array.from([...pos, ...P]);
  nrm = Float32Array.from([...nrm, ...Nn]);
  armOf = Int8Array.from([...armOf, ...new Array(add).fill(s)]);
  pid = Int32Array.from([...pid, ...Array.from({ length: add }, (_, k) => nv + k)]);
  nv += add;
  idx = Uint32Array.from([...idx, ...tri]);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(Float32Array.from([...uvA, ...UV]), 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  console.log(`stalk: ${len.toFixed(3)} long, ${add} vertices, torso normal ${tn.map((q) => q.toFixed(2))}, hand normal ${hn.map((q) => q.toFixed(2))}`);
}

const order = [hips, legs.L, shins.L, legs.R, shins.R, arms.L, arms.R, head];
const si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4);
for (let i = 0; i < nv; i++) {
  const x = X(i), y = Y(i), z = Z(i);
  const w = new Array(8).fill(0);
  if (armOf[i]) {
    // rigid leaf and stalk; only the first bit of stalk bends into the body
    const a = rigid[i] ? 1 : stalkW.has(i) ? stalkW.get(i) : capW.has(i) ? capW.get(i) : traced ? (bendW[i] ?? 1) : sm(rootOf(armOf[i]), rootOf(armOf[i]) + R.armBend, armOf[i] * x);
    w[armOf[i] > 0 ? 5 : 6] = a;
  } else {
    // anything above the neck that isn't leaf is head (or, for a Sprout not standing up, the head's own shape)
    w[7] = R.headWeight ? R.headWeight(x, y, z)
      : sm(R.neck[0], R.neck[1], y) * (R.neckReach ? Math.max(sm(R.neck[1], R.neck[1] + 0.03, y), sm(R.neckReach + 0.03, R.neckReach, Math.hypot(x - R.joints.neck[0], z - R.joints.neck[2]))) : 1);
    const notHead = 1 - w[7];
    // legs that don't hang straight down: the config says where they are and which side each is on
    if (R.legZone) for (const [s, iLeg, iShin] of [[1, 1, 2], [-1, 3, 4]]) {
      const leg = R.legZone(x, y, z) * sm(-0.01, 0.01, s * R.legSide(x, y, z)) * notHead;
      const boot = R.bootZone?.(x, y, z) ?? 0;
      w[iLeg] = leg * (1 - boot);
      w[iShin] = leg * boot;
    }
    else if (R.legTop != null) for (const [s, iLeg, iShin] of [[1, 1, 2], [-1, 3, 4]]) {
      const side = sm(-0.01, 0.01, s * x);
      const leg = sm(R.legTop + 0.02, R.legTop - 0.02, y) * side * notHead;
      const boot = sm(R.bootTop + 0.015, R.bootTop - 0.015, y);
      w[iLeg] = leg * (1 - boot);
      w[iShin] = leg * boot;
    }
  }
  const used = w.slice(1).reduce((a, b) => a + b, 0);
  w[0] = Math.max(0, 1 - used);
  const top = w.map((v, k) => [k, v]).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = top.reduce((a, [, v]) => a + v, 0) || 1;
  top.forEach(([k, v], j) => { si[i * 4 + j] = k; sw[i * 4 + j] = v / sum; });
}
geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));

// ---- textures
// The generator painted a contact shadow where each leaf pressed on the head. Now the leaf lifts
// away, so repaint that band with the plain colour around it, fading out with distance from the seam.
const sharp = (await import('sharp')).default;
const raw = async (t) => sharp(Buffer.from(t.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const color = await raw(texIn.color), normalImg = await raw(texIn.normal), ormImg = await raw(texIn.orm);
for (const e of R.erase ?? []) seams.push({ c: e.c.map((v) => v * S), side: 0, r: e.r });
// Which texels any triangle actually uses. Everything else is gutter between atlas islands, which
// the GPU still blends in at island edges; repainted areas extend into it so seams don't show.
const TW = color.info.width, TH = color.info.height;
const uvA = geo.attributes.uv.array;
const rasterise = (v, fn) => {
  const T = v.map((i) => [uvA[i * 2] * TW, uvA[i * 2 + 1] * TH]);
  const den = (T[1][1] - T[2][1]) * (T[0][0] - T[2][0]) + (T[2][0] - T[1][0]) * (T[0][1] - T[2][1]);
  if (Math.abs(den) < 1e-9) return;
  const x0 = Math.max(0, Math.floor(Math.min(...T.map((q) => q[0])))), x1 = Math.min(TW - 1, Math.ceil(Math.max(...T.map((q) => q[0]))));
  const y0 = Math.max(0, Math.floor(Math.min(...T.map((q) => q[1])))), y1 = Math.min(TH - 1, Math.ceil(Math.max(...T.map((q) => q[1]))));
  const pad = 0.75 / Math.sqrt(Math.abs(den)); // texels the triangle's edge touches
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const px = x + 0.5, py = y + 0.5;
    const b0 = ((T[1][1] - T[2][1]) * (px - T[2][0]) + (T[2][0] - T[1][0]) * (py - T[2][1])) / den;
    const b1 = ((T[2][1] - T[0][1]) * (px - T[2][0]) + (T[0][0] - T[2][0]) * (py - T[2][1])) / den;
    const b2 = 1 - b0 - b1;
    if (b0 >= -pad && b1 >= -pad && b2 >= -pad) fn(x, y, b0, b1, b2);
  }
};
const used = new Uint8Array(TW * TH);
for (let t = 0; t < idx.length; t += 3) rasterise([idx[t], idx[t + 1], idx[t + 2]], (x, y) => { used[y * TW + x] = 1; });

const repaint = (img, targetOf, which = () => true) => {
  const { data } = img, C = img.info.channels;
  const texel = (u, v) => (Math.min(TH - 1, Math.max(0, Math.floor(v * TH))) * TW + Math.min(TW - 1, Math.max(0, Math.floor(u * TW)))) * C;
  const painted = new Uint8Array(TW * TH);
  let count = 0;
  for (const { c, side, r: [near, far], only = () => true, fixed = false } of seams.filter(which)) {
    const dist = (p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) / S;
    // the average of the same surface just beyond the band
    const acc = [0, 0, 0]; let n = 0;
    for (let i = 0; i < nv; i++) {
      if ((side !== null && armOf[i] !== side) || !only(i)) continue;
      const d = dist([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
      if (d < far || d > far + 0.03) continue;
      const o = texel(uvA[i * 2], uvA[i * 2 + 1]);
      for (let k = 0; k < 3; k++) acc[k] += data[o + k];
      n++;
    }
    // (`fixed`: one plain colour, measured from `only` surfaces, painted over every surface in the band)
    const target = targetOf ? targetOf(acc.map((v) => v / n)) : fixed && n ? acc.map((v) => v / n) : null;
    // no fixed target: fill from the surrounding surface instead, letting its colours diffuse inward
    // over the mesh, so a gradient (lighter towards the top of the head, say) carries straight through
    let fill = null;
    if (!target) {
      const zone = [];
      const col = new Map();
      for (let i = 0; i < nv; i++) {
        const q = pid[i];
        if (col.has(q) || (side !== null && armOf[i] !== side) || !only(i)) continue;
        const d = dist([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
        if (d > far + 0.02) continue;
        const o = texel(uvA[i * 2], uvA[i * 2 + 1]);
        // inside starts from the surrounding average (not its own, possibly dark, colour)
        col.set(q, d < far ? acc.map((v) => v / n) : [data[o], data[o + 1], data[o + 2]]);
        if (d < far) zone.push(q);
      }
      const inZone = new Set(zone);
      const adj = new Map();
      for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) {
        const a = pid[idx[t + k]], b = pid[idx[t + (k + 1) % 3]];
        if (!inZone.has(a) || !col.has(b)) continue;
        (adj.get(a) ?? adj.set(a, new Set()).get(a)).add(b);
      }
      for (let it = 0; it < 600; it++) for (const q of zone) {
        const ns = adj.get(q);
        if (!ns?.size) continue;
        const c = [0, 0, 0];
        for (const j of ns) for (let k = 0; k < 3; k++) c[k] += col.get(j)[k] / ns.size;
        col.set(q, c);
      }
      fill = (i) => col.get(pid[i]);
    }
    for (let t = 0; t < idx.length; t += 3) {
      const v = [idx[t], idx[t + 1], idx[t + 2]];
      if (v.some((i) => (side !== null && armOf[i] !== side) || (!fixed && !only(i)))) continue;
      const D = v.map((i) => dist([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]));
      if (Math.min(...D) > far) continue;
      const F = fill && v.map(fill);
      if (F && F.some((f) => !f)) continue;
      rasterise(v, (x, y, b0, b1, b2) => {
        const w = sm(far, near, b0 * D[0] + b1 * D[1] + b2 * D[2]);
        if (w <= 0) return;
        const o = (y * TW + x) * C;
        const tc = target ?? [0, 1, 2].map((k) => b0 * F[0][k] + b1 * F[1][k] + b2 * F[2][k]);
        for (let k = 0; k < 3; k++) data[o + k] = Math.round(data[o + k] + (tc[k] - data[o + k]) * w);
        if (!painted[y * TW + x]) { painted[y * TW + x] = 1; count++; }
      });
    }
  }
  // grow the repaint a few texels into the unused gutter around it
  for (let pass = 0; pass < 4; pass++) {
    const grown = [];
    for (let y = 1; y < TH - 1; y++) for (let x = 1; x < TW - 1; x++) {
      const j = y * TW + x;
      if (used[j] || painted[j]) continue;
      const acc = [0, 0, 0]; let n = 0;
      for (const q of [j - 1, j + 1, j - TW, j + TW]) if (painted[q]) { for (let k = 0; k < 3; k++) acc[k] += data[q * C + k]; n++; }
      if (n) grown.push([j, acc.map((v) => Math.round(v / n))]);
    }
    for (const [j, col] of grown) { for (let k = 0; k < 3; k++) data[j * C + k] = col[k]; painted[j] = 1; }
  }
  return count;
};
if (!process.env.NO_PAINT_COLOR) console.log(`repainted ${repaint(color, null)} texels of baked contact shadow and invented marks`);
// and the crease in the normal map: flat (straight out of the surface) in the same band
if (!process.env.NO_PAINT_NORMAL) repaint(normalImg, () => [128, 128, 255]);
// and the roughness and metalness around a dropped piece's cap: the generator's junction there is shinier
// than the surface around it, and shows as a grey sheen round the cap
repaint(ormImg, null, (seam) => seam.orm);

// ---- veins painted into the normal map (light catches them just as it would a carved groove), with a
// faint shadow in the colour. Curves are drawn in a flat 2D frame laid over the surface: `project`
// maps a point to (x, y) in that frame, `ex`/`ey` are the frame's directions in 3D.
const veinMask = new Uint8Array(TW * TH);
const dotV = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normV = (v) => { const l = Math.hypot(...v) || 1; return v.map((q) => q / l); };
// groove depth at (x, y) for a set of curves: deepest along each curve, easing out to its edge. Each
// curve is a quadratic from a through b to c, tapering to points at both ends.
const veinDepth = (V) => {
  const at = (cv, t) => [0, 1].map((k) => (1 - t) ** 2 * cv[0][k] + 2 * (1 - t) * t * cv[1][k] + t * t * cv[2][k]);
  const samples = V.curves.map((cv) => Array.from({ length: 65 }, (_, j) => ({ t: j / 64, p: at(cv, j / 64), w: cv[3] })));
  return (x, y) => {
    let d = 0;
    for (const ss of samples) for (let j = 0; j < ss.length - 1; j++) {
      const p0 = ss[j].p, p1 = ss[j + 1].p, dx = p1[0] - p0[0], dy = p1[1] - p0[1];
      const f = Math.max(0, Math.min(1, ((x - p0[0]) * dx + (y - p0[1]) * dy) / (dx * dx + dy * dy)));
      const dist = Math.hypot(x - p0[0] - f * dx, y - p0[1] - f * dy);
      const t = ss[j].t + f * (ss[j + 1].t - ss[j].t);
      const half = ss[j].w * Math.pow(Math.sin(Math.PI * t), 0.6) / 2; // pointed ends
      if (dist < half) d = Math.max(d, (1 - (dist / half) ** 2) ** 2 * (half / (ss[j].w / 2)));
    }
    return d * V.depth;
  };
};
const paintVein = (V, project, ex, ey, triOk) => {
  const C = color.info.channels;
  const depth = veinDepth(V);
  let painted = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const v = [idx[t], idx[t + 1], idx[t + 2]];
    if (!triOk(v)) continue;
    // the texture's directions across this triangle (how u and v run over the surface)
    const P = v.map((i) => [X(i), Y(i), Z(i)]), Uv = v.map((i) => [uvA[i * 2], uvA[i * 2 + 1]]);
    const e1 = P[1].map((q, k) => q - P[0][k]), e2 = P[2].map((q, k) => q - P[0][k]);
    const d1 = [Uv[1][0] - Uv[0][0], Uv[1][1] - Uv[0][1]], d2 = [Uv[2][0] - Uv[0][0], Uv[2][1] - Uv[0][1]];
    const det = d1[0] * d2[1] - d2[0] * d1[1];
    if (Math.abs(det) < 1e-12) continue;
    const Tu = normV(e1.map((q, k) => (q * d2[1] - e2[k] * d1[1]) / det)), Tv = normV(e2.map((q, k) => (q * d1[0] - e1[k] * d2[0]) / det));
    const Nn = v.map((i) => [nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]]);
    rasterise(v, (x, y, b0, b1, b2) => {
      const p = [0, 1, 2].map((k) => b0 * P[0][k] + b1 * P[1][k] + b2 * P[2][k]);
      const [qx, qy] = project(p);
      const g = depth(qx, qy);
      if (g <= 0) return;
      const e = 0.0006;
      const gx = (depth(qx + e, qy) - depth(qx - e, qy)) / (2 * e), gy = (depth(qx, qy + e) - depth(qx, qy - e)) / (2 * e);
      const n = normV([0, 1, 2].map((k) => b0 * Nn[0][k] + b1 * Nn[1][k] + b2 * Nn[2][k]));
      // tilt the normal toward the groove's centre line (its walls face inward)
      const g3 = [0, 1, 2].map((k) => ex[k] * gx + ey[k] * gy), gn = dotV(g3, n);
      const np = normV(n.map((q, k) => q + g3[k] - q * gn));
      // into this texel's tangent space (three.js reads glTF normal maps with green flipped)
      const tn = [dotV(np, Tu), -dotV(np, Tv), dotV(np, n)];
      const o = (y * TW + x) * C, m = Math.min(1, g / (V.depth * 0.15));
      for (let k = 0; k < 3; k++) {
        normalImg.data[o + k] = Math.round(normalImg.data[o + k] + ((tn[k] * 0.5 + 0.5) * 255 - normalImg.data[o + k]) * m);
        color.data[o + k] = Math.round(color.data[o + k] * (1 - V.shade * (g / V.depth)));
      }
      veinMask[y * TW + x] = 1;
      painted++;
    });
  }
  return painted;
};

// A vein for the back of the head, where the generator left none (too coarse there to carve one).
// Drawn as curves seen from behind.
if (R.backVein) {
  const V = R.backVein, [x0, x1, y0, y1] = V.box;
  const n = paintVein(V, (p) => [p[0], p[1]], [1, 0, 0], [0, 1, 0],
    (v) => !v.some((i) => armOf[i] || nrm[i * 3 + 2] > -0.15 || X(i) < x0 || X(i) > x1 || Y(i) < y0 || Y(i) > y1));
  console.log(`back vein: ${n} texels`);
}

// Leaves whose veins don't match the series (extra branches, spiky hairlines): smooth the generator's
// grooves out of both faces of each leaf blade, repaint what was baked into them, and give every face
// the series' clean vein instead.
if (R.leafVeins) {
  const L = R.leafVeins, C = color.info.channels;
  const copies = new Map(); // welded position -> every vertex at it
  for (let i = 0; i < nv; i++) (copies.get(pid[i]) ?? copies.set(pid[i], []).get(pid[i])).push(i);
  const P3 = (i) => [X(i), Y(i), Z(i)];
  for (const s of [1, -1]) {
    // the blade: this arm's leaf away from its stalk. A leaf fused into a held prop's piece (Water's,
    // wrapped round the can handle) is the green part of that piece.
    const texC = (i) => { const o = (Math.min(TH - 1, Math.floor(uvA[i * 2 + 1] * TH)) * TW + Math.min(TW - 1, Math.floor(uvA[i * 2] * TW))) * C; return [color.data[o], color.data[o + 1], color.data[o + 2]]; };
    const green = (i) => { const [r, g, b] = texC(i); return g > r * 1.08 && g > b * 1.12; };
    const blade = [];
    for (let i = 0; i < nv; i++) if (pid[i] === i && armOf[i] === s && (rigid[i] ? green(i) : (bendW[i] ?? 1) > 0.999)) blade.push(i);
    if (blade.length < 500) continue;
    // the leaf's own frame: along it (stalk to tip), across it, and through it
    const c = [0, 1, 2].map((k) => blade.reduce((a, i) => a + P3(i)[k], 0) / blade.length);
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const i of blade) { const r = P3(i).map((q, k) => q - c[k]); for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) M[x][y] += r[x] * r[y]; }
    const Vv = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let sweep = 0; sweep < 50; sweep++) for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(M[p][q]) < 1e-15) continue;
      const th = (M[q][q] - M[p][p]) / (2 * M[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), cs = 1 / Math.sqrt(t * t + 1), sn = t * cs;
      for (let k = 0; k < 3; k++) { const a = M[k][p], b = M[k][q]; M[k][p] = cs * a - sn * b; M[k][q] = sn * a + cs * b; }
      for (let k = 0; k < 3; k++) { const a = M[p][k], b = M[q][k]; M[p][k] = cs * a - sn * b; M[q][k] = sn * a + cs * b; }
      for (let k = 0; k < 3; k++) { const a = Vv[k][p], b = Vv[k][q]; Vv[k][p] = cs * a - sn * b; Vv[k][q] = sn * a + cs * b; }
    }
    const [a1, a2, a3] = [0, 1, 2].map((i) => ({ val: M[i][i], vec: [Vv[0][i], Vv[1][i], Vv[2][i]] })).sort((x, y) => y.val - x.val).map((e) => e.vec);
    const sh = shoulderAt(s).toArray().map((q) => q / S);
    if (dotV(sh.map((q, k) => q - c[k]), a1) > 0) a1.forEach((q, k) => (a1[k] = -q)); // stalk end at low u
    const uv = (p) => { const r = p.map((q, k) => q - c[k]); return [dotV(r, a1), dotV(r, a2), dotV(r, a3)]; };
    const us = blade.map((i) => uv(P3(i))[0]), vs = blade.map((i) => Math.abs(uv(P3(i))[1]));
    const u0 = Math.min(...us), len = Math.max(...us) - u0, half = Math.max(...vs);
    const liftW = new Map();
    const basis = (u, v) => [1, u, v, u * u, u * v, v * v];
    const solve = (rows) => { // least squares for a quadratic's six coefficients
      const A = Array.from({ length: 6 }, () => new Array(6).fill(0)), rhs = new Array(6).fill(0);
      for (const q of rows) { const row = basis(q[0], q[1]); for (let x = 0; x < 6; x++) { rhs[x] += row[x] * q[2]; for (let y = 0; y < 6; y++) A[x][y] += row[x] * row[y]; } }
      for (let col = 0; col < 6; col++) {
        let piv = col; for (let r = col + 1; r < 6; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
        [A[col], A[piv]] = [A[piv], A[col]]; [rhs[col], rhs[piv]] = [rhs[piv], rhs[col]];
        for (let r = 0; r < 6; r++) if (r !== col) { const f = A[r][col] / A[col][col]; for (let k = col; k < 6; k++) A[r][k] -= f * A[col][k]; rhs[r] -= f * rhs[col]; }
      }
      return rhs.map((v, k) => v / A[k][k]);
    };
    // the leaf's middle surface, between its two faces (used to tell front from back when painting)
    const midC = solve(blade.map((i) => uv(P3(i))));
    const mid = (q) => basis(q[0], q[1]).reduce((a, b, k) => a + b * midC[k], 0);
    // fill the grooves: around each point, fit a small curved patch to the surface nearby (ignoring
    // whatever dips below it), and lift the point onto it if it sits in a dip. A small patch follows
    // even a tightly curled leaf; the leaf's own rounded shape, rim and outline aren't dips, so stay.
    // ease off only right at the blade's own boundary (where it meets the stalk or the rest of the piece)
    const edgeDist = new Map(), q0 = [];
    const bladeHas = new Set(blade);
    for (const i of blade) if ((nbr.get(i) ?? []).some((u) => !bladeHas.has(u))) { edgeDist.set(i, 0); q0.push(i); }
    for (let h = 0; h < q0.length; h++) {
      const v = q0[h], dv = edgeDist.get(v);
      if (dv > 0.02) continue;
      for (const u of nbr.get(v) ?? []) {
        if (!bladeHas.has(u)) continue;
        const d = dv + Math.hypot(X(u) - X(v), Y(u) - Y(v), Z(u) - Z(v));
        if (d < (edgeDist.get(u) ?? Infinity)) { edgeDist.set(u, d); q0.push(u); }
      }
    }
    const fade = new Map(blade.map((i) => [i, sm(0.002, 0.014, edgeDist.get(i) ?? Infinity)]));
    const Pm = new Map(blade.map((i) => [i, P3(i)]));
    const Nm = new Map(blade.map((i) => [i, [nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]]]));
    const bladeAll = new Set(blade), inBladeSet = (u) => bladeAll.has(u);
    for (let round = 0; round < L.rounds; round++) {
    const cell = L.radius, hash = new Map(), hk = (p) => p.map((q) => Math.floor(q / cell)).join(',');
    for (const i of blade) { const k = hk(Pm.get(i)); (hash.get(k) ?? hash.set(k, []).get(k)).push(i); }
    const lift = new Map();
    for (const i of blade) {
      const p = Pm.get(i), n = Nm.get(i);
      const ax = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const t1 = normV([n[1] * ax[2] - n[2] * ax[1], n[2] * ax[0] - n[0] * ax[2], n[0] * ax[1] - n[1] * ax[0]]);
      const t2 = [n[1] * t1[2] - n[2] * t1[1], n[2] * t1[0] - n[0] * t1[2], n[0] * t1[1] - n[1] * t1[0]];
      const near = [];
      const [cx, cy, cz] = p.map((q) => Math.floor(q / cell));
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++)
        for (const j of hash.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
          const r = Pm.get(j).map((q, k) => q - p[k]);
          if (Math.hypot(...r) > L.radius || dotV(Nm.get(j), n) < 0.2) continue; // same face only
          near.push([dotV(r, t1), dotV(r, t2), dotV(r, n)]);
        }
      if (near.length < 15) continue;
      let use = near, coef = null;
      for (let it = 0; it < 4; it++) {
        coef = solve(use);
        const f = (q) => basis(q[0], q[1]).reduce((a, b, k) => a + b * coef[k], 0);
        use = near.filter((q) => q[2] - f(q) > -L.groove);
        if (use.length < 12) break;
      }
      const up = coef[0]; // the patch's height right here, above this point if it sits in a dip
      if (up > L.groove * 0.25) lift.set(i, p.map((q, k) => q + n[k] * up * fade.get(i)));
    }
    for (const [i, q] of lift) Pm.set(i, q);
    // then even out the filled lines, where the old grooves were (a light smoothing around them only)
    const filledSet = new Set(blade.filter((i) => { const a = Pm.get(i), b = P3(i); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 1e-6; }));
    const around = new Map();
    for (const i of filledSet) { around.set(i, 1); for (const u of nbr.get(i) ?? []) if (inBladeSet(u)) { if (!around.has(u)) around.set(u, 0.6); for (const w of nbr.get(u) ?? []) if (inBladeSet(w) && !around.has(w)) around.set(w, 0.3); } }
    for (let it = 0; it < L.evenPasses; it++) {
      const next = new Map();
      for (const [i, wgt] of around) {
        const ns = (nbr.get(i) ?? []).filter(inBladeSet);
        if (ns.length < 3) continue;
        const p = Pm.get(i), avg = [0, 1, 2].map((k) => ns.reduce((a, u) => a + Pm.get(u)[k], 0) / ns.length);
        next.set(i, p.map((q, k) => q + (avg[k] - q) * 0.5 * wgt * fade.get(i)));
      }
      for (const [i, p] of next) Pm.set(i, p);
    }
    }
    let lifted = 0;
    for (const i of blade) {
      const p = Pm.get(i), o = P3(i), d = Math.hypot(p[0] - o[0], p[1] - o[1], p[2] - o[2]);
      if (d < 1e-6) continue;
      for (const j of copies.get(i)) for (let k = 0; k < 3; k++) pos[j * 3 + k] = p[k] * S;
      liftW.set(i, sm(0, L.groove, d));
      lifted++;
    }
    // shading normals from the filled surface (area-weighted face normals), wherever it moved
    const fn = new Map();
    for (let t = 0; t < idx.length; t += 3) {
      const v = [idx[t], idx[t + 1], idx[t + 2]];
      if (!v.some((i) => liftW.has(pid[i]))) continue;
      const A = [0, 1, 2].map((k) => pos[v[0] * 3 + k]), e1 = [0, 1, 2].map((k) => pos[v[1] * 3 + k] - A[k]), e2 = [0, 1, 2].map((k) => pos[v[2] * 3 + k] - A[k]);
      const nn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      for (const i of v) { const q = fn.get(pid[i]) ?? fn.set(pid[i], [0, 0, 0]).get(pid[i]); for (let k = 0; k < 3; k++) q[k] += nn[k]; }
    }
    for (const [q, w] of liftW) {
      const f = fn.get(q); if (!f) continue;
      const nf = normV(f);
      for (const j of copies.get(q)) { const nb = normV([0, 1, 2].map((k) => nrm[j * 3 + k] + (nf[k] - nrm[j * 3 + k]) * Math.max(w, 0.5))); for (let k = 0; k < 3; k++) nrm[j * 3 + k] = nb[k]; }
    }
    console.log(`leaf ${s > 0 ? 'L' : 'R'}: filled grooves, moved ${lifted} vertices`);
    // repaint what was baked into the old grooves: colour from the surface around them (diffused over
    // the mesh), normal map flat
    // the blade's colour, smoothed right across it so nothing baked into the old grooves survives (a
    // leaf is one soft green; the faces get it fully, easing back to the original at the rim)
    const fill = new Map();
    const texAt = (img, i) => { const o = (Math.min(TH - 1, Math.floor(uvA[i * 2 + 1] * TH)) * TW + Math.min(TW - 1, Math.floor(uvA[i * 2] * TW))) * C; return [img[o], img[o + 1], img[o + 2]]; };
    // start from the lighter, untouched-looking texels: the old grooves are dark
    const lumOf = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    const bladeLum = blade.map((i) => lumOf(texAt(color.data, i))).sort((a, b) => a - b), cut = bladeLum[Math.floor(bladeLum.length * 0.35)];
    const plain = blade.filter((i) => lumOf(texAt(color.data, i)) >= cut);
    const avg = [0, 1, 2].map((k) => plain.reduce((a, i) => a + texAt(color.data, i)[k], 0) / plain.length);
    for (const i of blade) { const c = texAt(color.data, i); fill.set(i, lumOf(c) >= cut ? c : avg); }
    // and how shiny it is: the generator painted the old grooves into the roughness map too
    const ormTypical = [0, 1, 2].map((k) => { const vals = plain.map((i) => texAt(ormImg.data, i)[k]).sort((a, b) => a - b); return vals[Math.floor(vals.length / 2)]; });
    let repaintedTris = 0, skippedEdge = 0;
    for (let it = 0; it < 80; it++) for (const i of blade) {
      const ns = (nbr.get(i) ?? []).filter((u) => fill.has(u));
      if (!ns.length) continue;
      fill.set(i, [0, 1, 2].map((k) => ns.reduce((a, u) => a + fill.get(u)[k], 0) / ns.length));
    }
    for (let t = 0; t < idx.length; t += 3) {
      const v = [idx[t], idx[t + 1], idx[t + 2]];
      if (v.some((i) => !fill.has(pid[i]))) { if (v.some((i) => fill.has(pid[i]))) skippedEdge++; continue; }
      repaintedTris++;
      const F = v.map((i) => fill.get(pid[i]));
      rasterise(v, (x, y, b0, b1, b2) => {
        const w = 1, wc = 1; // the whole blade: one soft green, and no detail left from the old grooves
        const o = (y * TW + x) * C;
        for (let k = 0; k < 3; k++) {
          color.data[o + k] = Math.round(color.data[o + k] + (b0 * F[0][k] + b1 * F[1][k] + b2 * F[2][k] - color.data[o + k]) * wc);
          normalImg.data[o + k] = Math.round(normalImg.data[o + k] + ([128, 128, 255][k] - normalImg.data[o + k]) * w);
          ormImg.data[o + k] = ormTypical[k];
        }
      });
    }
    console.log(`leaf ${s > 0 ? 'L' : 'R'}: repainted ${repaintedTris} triangles (${skippedEdge} at the blade's edge left)`);
    if (process.env.DEBUG_LEAF) {
      const sd = (img) => { const vals = blade.map((i) => lumOf(texAt(img, i))); const m = vals.reduce((a, b) => a + b, 0) / vals.length; return [m.toFixed(1), Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length).toFixed(2)]; };
      console.log('   texel lum mean/sd after repaint: colour', sd(color.data), 'normal', sd(normalImg.data), 'orm', sd(ormImg.data));
      const sample = blade.slice(0, 5).map((i) => [uvA[i * 2].toFixed(4), uvA[i * 2 + 1].toFixed(4)]);
      console.log('   sample uvs', JSON.stringify(sample));
    }
    // the series' clean vein on both faces, laid along the leaf (u from stalk to tip, v across)
    const toFrame = ([uf, vf]) => [u0 + uf * len, vf * half];
    const V = { depth: L.depth, shade: L.shade, curves: L.curves.map(([a, b, cc, w]) => [toFrame(a), toFrame(b), toFrame(cc), w]) };
    const bladeSet = new Set(blade);
    // carved into the shape (the leaf mesh is dense; a painted groove would break up across the leaf's
    // many small texture pieces), with a faint shadow in the colour
    const depth = veinDepth(V);
    const carved = new Map();
    for (const i of blade) {
      const q = uv(P3(i)), d = depth(q[0], q[1]) * fade.get(i);
      if (d <= 0) continue;
      const n = [nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]];
      // the groove's walls tilt toward its centre line: from the groove shape itself, so the vein
      // shades smoothly however uneven the mesh under it is
      const e = 0.0006, gx = (depth(q[0] + e, q[1]) - depth(q[0] - e, q[1])) / (2 * e), gy = (depth(q[0], q[1] + e) - depth(q[0], q[1] - e)) / (2 * e);
      const g3 = [0, 1, 2].map((k) => (a1[k] * gx + a2[k] * gy) * fade.get(i)), gn = dotV(g3, n);
      const nt = normV(n.map((v, k) => v + g3[k] - v * gn));
      for (const j of copies.get(i)) for (let k = 0; k < 3; k++) { pos[j * 3 + k] -= n[k] * d * S; nrm[j * 3 + k] = nt[k]; }
      carved.set(i, d);
    }
    for (let t = 0; t < idx.length; t += 3) {
      const v = [idx[t], idx[t + 1], idx[t + 2]];
      if (!v.some((i) => carved.has(pid[i])) || !v.every((i) => bladeSet.has(pid[i]))) continue;
      const Q = v.map((i) => uv(P3(i)));
      rasterise(v, (x, y, b0, b1, b2) => {
        const g = depth(b0 * Q[0][0] + b1 * Q[1][0] + b2 * Q[2][0], b0 * Q[0][1] + b1 * Q[1][1] + b2 * Q[2][1]);
        if (g <= 0) return;
        const o = (y * TW + x) * C;
        for (let k = 0; k < 3; k++) color.data[o + k] = Math.round(color.data[o + k] * (1 - V.shade * (g / V.depth)));
      });
    }
    console.log(`leaf ${s > 0 ? 'L' : 'R'}: carved the vein into ${carved.size} vertices`);
  }
}

// carry painted veins a few texels into the gutters around atlas islands, so seams don't show in them
for (let pass = 0; pass < 4; pass++) {
  const C = color.info.channels, grown = [];
  for (let y = 1; y < TH - 1; y++) for (let x = 1; x < TW - 1; x++) {
    const j = y * TW + x;
    if (used[j] || veinMask[j]) continue;
    const ns = [j - 1, j + 1, j - TW, j + TW].filter((q) => veinMask[q]);
    if (ns.length) grown.push([j, ns]);
  }
  for (const [j, ns] of grown) {
    for (const img of [normalImg.data, color.data]) for (let k = 0; k < 3; k++) img[j * C + k] = Math.round(ns.reduce((a, q) => a + img[q * C + k], 0) / ns.length);
    veinMask[j] = 1;
  }
}
const encode = async (img, quality) => (BLEND
  ? sharp(img.data, { raw: img.info }).png({ compressionLevel: 9 }) // lossless: Blender is the source now
  : sharp(img.data, { raw: img.info }).webp({ quality, effort: 6 })).toBuffer();
const texFiles = {
  color: await encode(color, 90),
  normal: await encode(normalImg, 94), // normal maps show compression as blotchy shading
  orm: await encode(ormImg, 88),
};
for (const [k, buf] of Object.entries(texFiles)) await writeFile(new URL(`${id}-${k}.${BLEND ? 'png' : 'webp'}`, outDir), buf);
console.log('textures', Object.entries(texFiles).map(([k, b]) => `${k} ${(b.byteLength / 1024).toFixed(0)} KB`).join(', '));

// ---- a page to turn, for a Sprout holding an open book. It's a copy of the book's own right-hand
// page (shape and print), hinged on the spine and hidden until it flips across onto the left page.
let pageNode = null;
if (R.book) {
  const { data } = color, C = color.info.channels;
  const texAt = (i) => { const o = (Math.min(TH - 1, Math.floor(uvA[i * 2 + 1] * TH)) * TW + Math.min(TW - 1, Math.floor(uvA[i * 2] * TW))) * C; return [data[o], data[o + 1], data[o + 2]]; };
  const isGreen = (c) => c[1] > c[0] * 1.15 && c[1] > c[2] * 1.2;
  const isCream = (c) => c[0] > 190 && c[1] > 170 && c[2] > 120;
  const isCover = (c) => !isCream(c) && c[0] > c[2] * 1.3 && c[0] + c[1] + c[2] > 150;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const P3 = (i) => [X(i), Y(i), Z(i)];
  // the pages' frame: principal axes of the cream (page-coloured) surface
  const cream = [];
  for (let i = 0; i < nv; i++) if (!armOf[i] && Y(i) < R.book.below && isCream(texAt(i))) cream.push(P3(i));
  const c = [0, 1, 2].map((k) => cream.reduce((a, p) => a + p[k], 0) / cream.length);
  const Cv = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of cream) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) Cv[a][b] += (p[a] - c[a]) * (p[b] - c[b]);
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) { // Jacobi
    if (Math.abs(Cv[p][q]) < 1e-15) continue;
    const th = (Cv[q][q] - Cv[p][p]) / (2 * Cv[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), cs = 1 / Math.sqrt(t * t + 1), sn = t * cs;
    for (let k = 0; k < 3; k++) { const a = Cv[k][p], b = Cv[k][q]; Cv[k][p] = cs * a - sn * b; Cv[k][q] = sn * a + cs * b; }
    for (let k = 0; k < 3; k++) { const a = Cv[p][k], b = Cv[q][k]; Cv[p][k] = cs * a - sn * b; Cv[q][k] = sn * a + cs * b; }
    for (let k = 0; k < 3; k++) { const a = V[k][p], b = V[k][q]; V[k][p] = cs * a - sn * b; V[k][q] = sn * a + cs * b; }
  }
  const axes = [0, 1, 2].map((i) => ({ val: Cv[i][i], vec: [V[0][i], V[1][i], V[2][i]] })).sort((a, b) => b.val - a.val).map((e) => e.vec);
  const [across, spine, normal] = axes;
  if (across[0] < 0) across.forEach((v, k) => (across[k] = -v)); // toward the right-hand page (+x)
  if (normal[1] < 0) normal.forEach((v, k) => (normal[k] = -v)); // out of the pages, toward the reader
  const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  // hinge axis, chosen so turning +y lifts the page up out of the book and over: with x = across,
  // y = hinge and z = x × y, a +y turn swings +x toward -z, so z must point into the pages
  const hinge = cr(across, normal);
  const origin = c.map((v, k) => v + across[k] * R.book.spineU);
  const toLocal = (p) => { const r = p.map((v, k) => v - origin[k]); return [dot(r, across), dot(r, hinge), dot(r, cr(across, hinge))]; };
  // the right-hand page: top-facing, page-coloured or printed (not leaf, not cover), past the spine
  const onPage = (i) => {
    const u = dot(P3(i).map((v, k) => v - origin[k]), across);
    const col = texAt(i);
    return !armOf[i] && Y(i) < R.book.below && u > 0.004 && u < R.book.edgeU && !isGreen(col) && !isCover(col)
      && dot([nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]], normal) > 0.55 && Math.abs(dot(P3(i).map((v, k) => v - origin[k]), spine)) < R.book.halfHeight;
  };
  const map = new Map(), pp = [], pn = [], pu = [], pi = [];
  for (let t = 0; t < idx.length; t += 3) {
    const v = [idx[t], idx[t + 1], idx[t + 2]];
    if (!v.every(onPage)) continue;
    for (const i of v) {
      if (!map.has(i)) {
        map.set(i, pp.length / 3);
        const n = [nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]];
        pp.push(...toLocal(P3(i).map((q, k) => q + normal[k] * R.book.lift)).map((q) => q * S));
        pn.push(dot(n, across), dot(n, hinge), dot(n, cr(across, hinge)));
        pu.push(uvA[i * 2], uvA[i * 2 + 1]);
      }
      pi.push(map.get(i));
    }
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3));
  pg.setAttribute('normal', new THREE.Float32BufferAttribute(pn, 3));
  pg.setAttribute('uv', new THREE.Float32BufferAttribute(pu, 2));
  pg.setIndex(pi);
  const pageMesh = new THREE.Mesh(pg, new THREE.MeshStandardMaterial({ name: `${id}_page`, side: THREE.DoubleSide, roughness: 1, metalness: 1 }));
  pageMesh.name = 'page';
  // frame node carries the book's orientation; the page node inside it turns about its own y
  const frame = new THREE.Group();
  frame.name = 'book_frame';
  frame.position.set(...origin.map((v) => v * S));
  frame.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...across), new THREE.Vector3(...hinge), new THREE.Vector3(...cr(across, hinge))));
  pageNode = new THREE.Group();
  pageNode.name = 'book_page';
  pageNode.userData = { flip: R.book.flip };
  pageNode.add(pageMesh);
  frame.add(pageNode);
  console.log(`page: ${map.size} vertices, ${pi.length / 3} triangles; pages centre ${c.map((v) => v.toFixed(3))}, across ${across.map((v) => v.toFixed(2))}, hinge ${hinge.map((v) => v.toFixed(2))}`);
}

// ---- closed eyes, for Sprouts whose eyes are painted open. Moving the surface to blink squashes the
// face (big glossy eyes crease the skin around them), so instead the page swaps in a closed version
// of just the eye area for the instant they shut: the eye painted over with the skin around it, a
// soft lash line across, and matte skin in place of the glossy eye. Only a crop of the texture that
// covers the eyes ships (<id>-closed.webp, -closed-orm.webp, -closed-normal.webp); see closedEyes in src/kit.js.
let closedRect = null, lidShape = null;
if (R.eyes) {
  lidShape = new Float32Array(nv * 3);
  var lidNormals = new Float32Array(nv * 3); // shading has to follow the smoothed lid too
  const { data } = color, C = color.info.channels;
  const shutNrm = Buffer.from(normalImg.data); // (normalImg was already encoded above; this copy is only for the crop)
  const shutCol = Buffer.from(data), shutOrm = Buffer.from(ormImg.data), mask = new Uint8Array(TW * TH);
  const texAt = (img, i) => { const o = (Math.min(TH - 1, Math.floor(uvA[i * 2 + 1] * TH)) * TW + Math.min(TW - 1, Math.floor(uvA[i * 2] * TW))) * C; return [img[o], img[o + 1], img[o + 2]]; };
  const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  const norm = (v) => { const l = Math.hypot(...v); return v.map((q) => q / l); };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const P3 = (i) => [X(i), Y(i), Z(i)];
  const up = norm(R.headUp ?? [0, 1, 0]);
  let u0 = 1, v0 = 1, u1 = 0, v1 = 0;
  for (const e of R.eyes) {
    // the painted eye: its dark texels near the given point
    const dark = [];
    for (let i = 0; i < nv; i++) {
      if (armOf[i] || Math.hypot(...P3(i).map((q, k) => q - e.near[k])) > (e.r ?? 0.1)) continue;
      if (lum(texAt(data, i)) < 70) dark.push(i);
    }
    const lo = [9, 9, 9], hi = [-9, -9, -9];
    for (const i of dark) P3(i).forEach((q, k) => { lo[k] = Math.min(lo[k], q); hi[k] = Math.max(hi[k], q); });
    const ctr = lo.map((q, k) => (q + hi[k]) / 2);
    const nE = norm(dark.reduce((acc, i) => acc.map((q, k) => q + nrm[i * 3 + k]), [0, 0, 0]));
    const upE = norm(up.map((q, k) => q - nE[k] * dot(up, nE)));
    const acrossE = [upE[1] * nE[2] - upE[2] * nE[1], upE[2] * nE[0] - upE[0] * nE[2], upE[0] * nE[1] - upE[1] * nE[0]];
    const local = (p) => { const r = p.map((q, k) => q - ctr[k]); return [dot(r, acrossE), dot(r, upE)]; };
    const hs = dark.map((i) => local(P3(i))[1]), as = dark.map((i) => local(P3(i))[0]);
    const top = Math.max(...hs), bottom = Math.min(...hs);
    const halfW = (Math.max(...as) - Math.min(...as)) / 2, halfH = (top - bottom) / 2, midH = (top + bottom) / 2, midA = (Math.max(...as) + Math.min(...as)) / 2;
    const dnOf = ([a, h]) => Math.hypot((a - midA) / halfW, (h - midH) / halfH); // 1 = the painted eye's edge
    const lashCol = [0, 1, 2].map((k) => dark.reduce((acc, i) => acc + texAt(data, i)[k], 0) / dark.length);
    // skin to paint over the eye: let the colour around it diffuse inward over the mesh (keeps any
    // gradient), and the same for roughness/metalness
    const fillCol = new Map(), fillOrm = new Map(), zone = [];
    for (let i = 0; i < nv; i++) {
      if (armOf[i] || Math.hypot(...P3(i).map((q, k) => q - ctr[k])) > Math.max(halfW, halfH) * 2) continue;
      const dn = dnOf(local(P3(i))), q = pid[i];
      if (dn > 1.45 || fillCol.has(q)) continue;
      fillCol.set(q, texAt(data, i)); fillOrm.set(q, texAt(ormImg.data, i));
      if (dn < 1.12) zone.push(q);
    }
    const ringCol = [0, 0, 0], ringOrm = [0, 0, 0]; let rn = 0;
    for (const [q, c] of fillCol) if (!zone.includes(q)) { for (let k = 0; k < 3; k++) { ringCol[k] += c[k]; ringOrm[k] += fillOrm.get(q)[k]; } rn++; }
    for (const q of zone) { fillCol.set(q, ringCol.map((v) => v / rn)); fillOrm.set(q, ringOrm.map((v) => v / rn)); }
    const inZone = new Set(zone), adj = new Map();
    for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) {
      const x = pid[idx[t + k]], y = pid[idx[t + (k + 1) % 3]];
      if (inZone.has(x) && fillCol.has(y)) (adj.get(x) ?? adj.set(x, new Set()).get(x)).add(y);
    }
    for (let it = 0; it < 500; it++) for (const q of zone) {
      const ns = adj.get(q); if (!ns?.size) continue;
      const c = [0, 0, 0], o = [0, 0, 0];
      for (const j of ns) for (let k = 0; k < 3; k++) { c[k] += fillCol.get(j)[k] / ns.size; o[k] += fillOrm.get(j)[k] / ns.size; }
      fillCol.set(q, c); fillOrm.set(q, o);
    }
    // the closed lash line: low on the eye, dipping a little in the middle (a relaxed close)
    const line = bottom + (top - bottom) * 0.3, thick = (top - bottom) * 0.045;
    const lashAt = (a) => { const t = Math.min(1, Math.abs(a - midA) / halfW); return line - (top - bottom) * 0.12 * (1 - t * t); };
    for (let t = 0; t < idx.length; t += 3) {
      const v = [idx[t], idx[t + 1], idx[t + 2]];
      if (v.some((i) => armOf[i] || !fillCol.has(pid[i]))) continue;
      const L = v.map((i) => local(P3(i)));
      if (Math.min(...L.map(dnOf)) > 1.2) continue;
      const F = v.map((i) => fillCol.get(pid[i])), O = v.map((i) => fillOrm.get(pid[i]));
      rasterise(v, (x, y, b0, b1, b2) => {
        const al = [0, 1].map((k) => b0 * L[0][k] + b1 * L[1][k] + b2 * L[2][k]);
        const w = sm(1.2, 1.06, dnOf(al));
        if (w <= 0) return;
        const o = (y * TW + x) * C;
        const skin = [0, 1, 2].map((k) => b0 * F[0][k] + b1 * F[1][k] + b2 * F[2][k]);
        const lash = sm(thick, thick * 0.35, Math.abs(al[1] - lashAt(al[0]))) * sm(halfW * 0.98, halfW * 0.7, Math.abs(al[0] - midA));
        for (let k = 0; k < 3; k++) {
          const c = skin[k] + (lashCol[k] - skin[k]) * lash;
          shutCol[o + k] = Math.round(shutCol[o + k] + (c - shutCol[o + k]) * w);
          const om = b0 * O[0][k] + b1 * O[1][k] + b2 * O[2][k];
          shutOrm[o + k] = Math.round(shutOrm[o + k] + (om - shutOrm[o + k]) * w);
          shutNrm[o + k] = Math.round(shutNrm[o + k] + ([128, 128, 255][k] - shutNrm[o + k]) * w); // smooth lid
        }
        mask[y * TW + x] = Math.max(mask[y * TW + x], Math.round(w * 255));
        u0 = Math.min(u0, x / TW); v0 = Math.min(v0, y / TH); u1 = Math.max(u1, (x + 1) / TW); v1 = Math.max(v1, (y + 1) / TH);
      });
    }
    // the lid's shape: the eye's dip (and its raised highlight) lifted onto a smooth surface fitted to
    // the skin around it, domed a touch as a lid over an eyeball. Only the eye itself moves.
    const ring = [];
    for (const q of fillCol.keys()) { const p = P3(q), dn = dnOf(local(p)); if (dn > 1.2 && dn < 1.45) ring.push(p); }
    const frame = (p) => { const r = p.map((v, k) => v - ctr[k]); return [dot(r, acrossE), dot(r, upE), dot(r, nE)]; };
    const basis = (u, v) => [1, u, v, u * u, u * v, v * v];
    const M = Array.from({ length: 6 }, () => new Array(6).fill(0)), rhs = new Array(6).fill(0);
    for (const p of ring) { const [u, v, h] = frame(p), row = basis(u, v); for (let i = 0; i < 6; i++) { rhs[i] += row[i] * h; for (let j = 0; j < 6; j++) M[i][j] += row[i] * row[j]; } }
    for (let c = 0; c < 6; c++) {
      let piv = c; for (let r = c + 1; r < 6; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]]; [rhs[c], rhs[piv]] = [rhs[piv], rhs[c]];
      for (let r = 0; r < 6; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k < 6; k++) M[r][k] -= f * M[c][k]; rhs[r] -= f * rhs[c]; }
    }
    const coef = rhs.map((v, k) => v / M[k][k]);
    const dome = Math.min(halfW, halfH) * 0.08;
    let lifted = 0;
    for (let i = 0; i < nv; i++) {
      if (armOf[i] || !fillCol.has(pid[i])) continue;
      const [u, v, h] = frame(P3(i)), dn = dnOf(local(P3(i)));
      const w = sm(1.22, 1.05, dn);
      if (w <= 0) continue;
      const target = basis(u, v).reduce((a, b, k) => a + b * coef[k], 0) + dome * Math.max(0, 1 - dn * dn);
      for (let k = 0; k < 3; k++) lidShape[i * 3 + k] += nE[k] * (target - h) * w * S;
      // the fitted surface's normal (its slope across and up the eye), blended in by the same weight
      const du = coef[1] + 2 * coef[3] * u + coef[4] * v, dv = coef[2] + coef[4] * u + 2 * coef[5] * v;
      const nf = norm([0, 1, 2].map((k) => nE[k] - du * acrossE[k] - dv * upE[k]));
      const n0 = [nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]];
      const nb = norm(n0.map((q, k) => q + (nf[k] - q) * w));
      for (let k = 0; k < 3; k++) lidNormals[i * 3 + k] = nb[k] - n0[k];
      lifted++;
    }
    console.log(`closed eye at ${ctr.map((q) => q.toFixed(3)).join(',')}: ${(halfW * 2).toFixed(3)} x ${(halfH * 2).toFixed(3)}, lid lifts ${lifted} vertices`);
  }
  // crop to the texels the eyes use (a few texels of margin for filtering). Alpha marks which texels
  // change, so the swap touches the eyes only and the rest of the crop never shows
  const px = [Math.max(0, Math.floor(u0 * TW) - 4), Math.max(0, Math.floor(v0 * TH) - 4), Math.min(TW, Math.ceil(u1 * TW) + 4), Math.min(TH, Math.ceil(v1 * TH) + 4)];
  const withMask = (buf) => { const out = Buffer.alloc(TW * TH * 4); for (let j = 0; j < TW * TH; j++) { out[j * 4] = buf[j * C]; out[j * 4 + 1] = buf[j * C + 1]; out[j * 4 + 2] = buf[j * C + 2]; out[j * 4 + 3] = mask[j]; } return out; };
  const crop = (buf) => sharp(withMask(buf), { raw: { width: TW, height: TH, channels: 4 } }).extract({ left: px[0], top: px[1], width: px[2] - px[0], height: px[3] - px[1] });
  const cc = await crop(shutCol).webp({ quality: 90, alphaQuality: 100, exact: true, effort: 6 }).toBuffer();
  const co = await crop(shutOrm).webp({ quality: 88, alphaQuality: 100, exact: true, effort: 6 }).toBuffer();
  await writeFile(new URL(`${id}-closed.webp`, outDir), cc);
  await writeFile(new URL(`${id}-closed-orm.webp`, outDir), co);
  const cn = await crop(shutNrm).webp({ quality: 94, alphaQuality: 100, exact: true, effort: 6 }).toBuffer();
  await writeFile(new URL(`${id}-closed-normal.webp`, outDir), cn);
  geo.morphAttributes.position = [new THREE.Float32BufferAttribute(lidShape, 3)];
  geo.morphAttributes.normal = [new THREE.Float32BufferAttribute(lidNormals, 3)];
  geo.morphTargetsRelative = true;
  closedRect = [px[0] / TW, px[1] / TH, (px[2] - px[0]) / TW, (px[3] - px[1]) / TH];
  console.log(`closed eyes: crop ${px[2] - px[0]} x ${px[3] - px[1]} texels, ${[cc, co, cn].map((b) => (b.byteLength / 1024).toFixed(0)).join(' + ')} KB`);
}

// ---- assemble in the app's hierarchy: sprout > root > [body, hips]
const material = new THREE.MeshStandardMaterial({ name: `${id}_textured`, roughness: 1, metalness: 1 });
const body = new THREE.SkinnedMesh(geo, material);
body.name = 'body';
const root = new THREE.Group();
root.name = 'root';
const sprout = new THREE.Group();
sprout.name = `sprout_${id}`;
sprout.userData = { id, imported: R.src, textures: Object.keys(texFiles), ...(closedRect && { closedRect }), ...(R.ownPot && { ownPot: true }), ...(R.prop && { heldBy: R.prop.arm }) };
root.add(hips, body);
if (lidShape) { body.updateMorphTargets(); body.morphTargetDictionary = { lids: 0 }; }
sprout.add(root);
if (pageNode) root.add(pageNode.parent);
sprout.updateMatrixWorld(true);
body.bind(new THREE.Skeleton(order));

const glb = await new GLTFExporter().parseAsync(sprout, { binary: true });
const out = await io.readBinary(new Uint8Array(glb));
if (BLEND) {
  await out.transform(dedup(), prune({ keepLeaves: true, keepAttributes: true }));
  await io.write(fileURLToPath(new URL(`${id}-rigged.glb`, outDir)), out);
  console.log(`${id}: Blender source written to models/blend/${id}/`);
  process.exit(0);
}
await out.transform(dedup(), prune({ keepLeaves: true, keepAttributes: true }), quantize({ quantizePosition: 16, quantizeNormal: 12, quantizeTexcoord: 16 }));
const bytes = await io.writeBinary(out);
// gzip, decoded in the page with the browser's own DecompressionStream (no WebAssembly needed)
const packed = gzipSync(bytes, { level: 9 });
await writeFile(new URL(`${id}-model.js`, outDir), `// Generated by tools/rig-imported.mjs from models/src/${R.src}.glb. Skinned, quantized GLB, gzip, base64.\nexport const gzip = true;\nexport default '${packed.toString('base64')}';\n`);
// a preview copy with textures re-attached isn't needed; the model sheet loads models/src directly
console.log(`${id}: ${(bytes.byteLength / 1024).toFixed(0)} KB skinned model, ${(packed.byteLength / 1024).toFixed(0)} KB gzipped, textures: ${sprout.userData.textures.join(', ')}`);
