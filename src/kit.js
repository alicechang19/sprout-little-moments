// Loads each Series 01 Sprout: a sculpted, rigged model with its textures, painted-eye blinks,
// and Little Light's glow.
import * as THREE from 'three';

// Little Light's glow, matching tools/sprout-anatomy.mjs makeMaterials(true)
const GLOW = { emissive: 0xb8f27a, emissiveIntensity: 0.75, name: 'glow_skin' };

/**
 * Blinking for painted, open eyes: while `material.userData.shut.value` is past half, the eye texels
 * come from a closed-eye crop of the colour, roughness/metalness and normal textures. The crop's alpha marks
 * the texels that change, so nothing else in it ever shows. (Built by tools/rig-imported.mjs.)
 */
function closedEyes(m, { shutMap, shutOrm, shutNrm, rect }) {
  m.userData.shut = { value: 0 };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      uShut: m.userData.shut, uShutMap: { value: shutMap }, uShutOrm: { value: shutOrm }, uShutNrm: { value: shutNrm },
      uShutRect: { value: new THREE.Vector4(...rect) },
    });
    // sample a texture, swapping in the closed crop where its alpha says so
    const pick = (sampler, crop, uv) => `shutPick(texture2D(${sampler}, ${uv}), ${crop}, ${uv})`;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uShut;
        uniform sampler2D uShutMap, uShutOrm, uShutNrm;
        uniform vec4 uShutRect;
        vec4 shutPick(vec4 open, sampler2D crop, vec2 uv) {
          vec2 c = (uv - uShutRect.xy) / uShutRect.zw;
          if (uShut < 0.5 || any(lessThan(c, vec2(0.0))) || any(greaterThan(c, vec2(1.0)))) return open;
          vec4 shut = texture2D(crop, c);
          return vec4(mix(open.rgb, shut.rgb, shut.a), open.a);
        }`)
      .replace('#include <map_fragment>', `diffuseColor *= ${pick('map', 'uShutMap', 'vMapUv')};`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = roughness * ${pick('roughnessMap', 'uShutOrm', 'vRoughnessMapUv')}.g;`)
      .replace('#include <metalnessmap_fragment>', `float metalnessFactor = metalness * ${pick('metalnessMap', 'uShutOrm', 'vMetalnessMapUv')}.b;`)
      .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps
        .replaceAll('texture2D( normalMap, vNormalMapUv )', pick('normalMap', 'uShutNrm', 'vNormalMapUv')));
  };
}

/**
 * Little Light's glow on a textured body, only where the texture is its green skin.
 * The boots don't glow, and the painted face lines (near black) stay dark. Named glow_* so the rig
 * pulses it (src/rig.js).
 * Skin, its pale highlights included, has linear red/green under 1.1; the boots and their shadows are 1.5
 * and up, with almost nothing between. So the ramp sits in that gap: a tighter test (green over red) left
 * the pale, slightly warm highlights near the head's tip unlit, which showed as grey, texel-sized blocks.
 */
function textureGlow(m) {
  m.name = GLOW.name;
  m.emissive = new THREE.Color(GLOW.emissive);
  m.emissiveIntensity = GLOW.emissiveIntensity;
  const before = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    before?.call(m, sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `{
      vec3 skin = texture2D(map, vMapUv).rgb; // linear
      totalEmissiveRadiance *= smoothstep(1.45, 1.15, skin.r / max(skin.g, 1e-3)) * smoothstep(0.02, 0.3, skin.g);
    }`);
  };
}

/**
 * Loads a Sprout (exported by tools/blend.mjs): skinned geometry from a JS module, textures as plain
 * images. `bust`, for local tools: a query added to texture URLs so a rebuilt model's images aren't
 * served from cache.
 */
export async function loadImported(id, loader, base = '', bust = '') {
  const mod = await import(`../models/web/${id}-model.js`);
  let bytes = Uint8Array.from(atob(mod.default), (c) => c.charCodeAt(0));
  if (mod.gzip) bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const scene = (await loader.parseAsync(bytes.buffer, '')).scene;
  const tl = new THREE.TextureLoader();
  const tex = (k) => tl.loadAsync(`${base}models/web/${id}-${k}.webp${bust}`).then((t) => { t.flipY = false; t.anisotropy = 8; return t; });
  const [map, normalMap, orm] = await Promise.all(['color', 'normal', 'orm'].map(tex));
  map.colorSpace = THREE.SRGBColorSpace;
  // open-eyed Sprouts ship a closed-eye crop of their textures to blink with
  let rect = null;
  scene.traverse((o) => { rect ??= o.userData.closedRect; });
  let closed = null;
  if (rect) {
    const [shutMap, shutOrm, shutNrm] = await Promise.all(['closed', 'closed-orm', 'closed-normal'].map(tex));
    shutMap.colorSpace = THREE.SRGBColorSpace;
    closed = { shutMap, shutOrm, shutNrm, rect };
  }
  const glows = id === 'light';
  scene.traverse((o) => {
    // the body, and the turning page (a copy of the book's page, same texture)
    if (!o.isMesh || (o.material.name !== `${id}_textured` && o.material.name !== `${id}_page`)) return;
    Object.assign(o.material, { map, normalMap, roughnessMap: orm, metalnessMap: orm });
    o.material.normalScale.set(1, -1); // glTF normal maps, no tangents
    if (closed && o.material.name === `${id}_textured`) closedEyes(o.material, closed);
    if (glows && o.material.name === `${id}_textured`) textureGlow(o.material);
    o.material.needsUpdate = true;
  });
  scene.updateMatrixWorld(true);
  return scene;
}
