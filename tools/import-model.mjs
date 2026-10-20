// Brings an outside GLB (e.g. an image-to-3D export) into the project at a web-friendly size.
// Usage: node tools/import-model.mjs <in.glb> <id> [targetTris=60000] [textureSize=2048] [normalWeight=1]
// The simplifier weighs surface direction as well as position, so narrow grooves (leaf veins,
// eye rims) keep their edges; position alone lets it collapse across them into jagged shading.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, prune, dedup, textureCompress, compactPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const [input, id, tris = '60000', size = '2048', normalWeight = '1'] = process.argv.slice(2);
await MeshoptSimplifier.ready;
MeshoptSimplifier.useExperimentalFeatures = true; // simplifyWithAttributes
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const count = () => doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);
const before = count();
await doc.transform(weld());
for (const prim of doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives())) {
  const indices = prim.getIndices();
  const target = Math.floor(Math.min(1, +tris / before) * indices.getCount() / 3) * 3;
  const [out, err] = MeshoptSimplifier.simplifyWithAttributes(
    Uint32Array.from(indices.getArray()),
    Float32Array.from(prim.getAttribute('POSITION').getArray()), 3,
    Float32Array.from(prim.getAttribute('NORMAL').getArray()), 3, [+normalWeight, +normalWeight, +normalWeight],
    null, target, 0.01,
  );
  console.log(`  simplified to ${out.length / 3} tris, error ${err.toFixed(5)}`);
  indices.setArray(out);
  compactPrimitive(prim);
}
await doc.transform(
  dedup(), prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [+size, +size], quality: 88 }),
);
const out = new URL(`../models/src/${id}.glb`, import.meta.url);
await io.write(fileURLToPath(out), doc);
console.log(`${id}: ${Math.round(before)} -> ${Math.round(count())} tris, written to models/src/${id}.glb`);
