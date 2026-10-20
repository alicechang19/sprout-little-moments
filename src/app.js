import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SERIES, BY_ID, SKY, LIGHTS } from './data.js';
import { animate, tickTweens, ease, wait, motionScale, reducedMotion, isDark, storage, clamp, bell, glowTexture, testParams, local } from './util.js';
import { needsAct, setupBreaks, showBreak } from './unlock.js';
import { BlindBox, BOX, loadBoxArt } from './box.js';
import { Rig } from './rig.js';
import { buildEnv, popIn } from './envs.js';
import { loadImported } from './kit.js';
import { Garden } from './garden.js';
import { Carousel, SLOTS } from './carousel.js';
import { skyLook, watchSky } from './sky.js';
import { Fx, beamMaterial, flood, floodable } from './fx.js';
import * as sound from './sound.js';
import { collectionCard, polaroidCard, pngOf, previewShare, closeShare } from './share.js';
import { inject } from '@vercel/analytics';
const STEP_HALF = Math.PI / SLOTS;

// Vercel Web Analytics. On this computer it loads the debug script, which logs to the console instead of counting visits.
inject({ mode: local ? 'development' : 'production' });

// The experience: a ring of blind boxes turns on a plinth in the real sky. Spin it, choose the one at the front,
// tear it open, meet the Sprout inside. Once all six are found they gather in the garden for a photo.

const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const ui = {
  boxDock: $('box-dock'), boxHint: $('box-hint'), boxWelcome: $('box-welcome'),
  card: $('card'), cardNo: $('card-no'), cardName: $('card-name'), cardDock: $('card-dock'),
  cardPrimary: $('card-primary'), cardFine: $('card-fine'), act: $('act'), mute: $('mute'),
  cardSticker: $('card-sticker'), cardLine: $('card-line'),
  chip: $('series-chip'), chipDots: $('chip-dots'), chipCount: $('chip-count'),
  lineup: $('lineup'), lineupClose: $('lineup-close'), slots: $('slots'),
  lineupShare: $('lineup-share'), share: $('share'), shareClose: $('share-close'),
  invite: $('invite'), lineupPhoto: $('lineup-photo'), countdown: $('countdown'), flash: $('flash'),
  photo: $('photo'), photoImg: $('photo-img'), photoShare: $('photo-share'), photoBack: $('photo-back'),
  toast: $('toast'), loading: $('loading'), loadingText: $('loading-text'), announce: $('announce'),
};
const show = (el, on) => el.classList.toggle('is-away', !on);

// ------------------------------------------------------------------ renderer
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
} catch {
  ui.loadingText.textContent = 'This experience needs WebGL, which this browser has turned off.';
  throw new Error('WebGL unavailable');
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const envTex = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

// ------------------------------------------------------------------ stage
const stage = new THREE.Scene();
stage.environment = envTex;
const lights = (() => {
  const hemi = new THREE.HemisphereLight(0xffffff, 0xe4d9c8, 1);
  const key = new THREE.DirectionalLight(0xfff1de, 2.2);
  key.position.set(3.2, 7, 4.6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 22 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  const fill = new THREE.DirectionalLight(0xe2ebff, 0.55);
  fill.position.set(-5, 3, 2.5);
  const rim = new THREE.DirectionalLight(0xffffff, 0.7);
  rim.position.set(-1, 4, -6);
  stage.add(hemi, key, fill, rim);
  return { hemi, key, fill, rim };
})();
const catcher = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.13 }));
catcher.rotation.x = -Math.PI / 2;
catcher.receiveShadow = true;
stage.add(catcher);
const floatG = new THREE.Group();
const tilt = new THREE.Group();
const turntable = new THREE.Group();
stage.add(floatG);
floatG.add(tilt);
tilt.add(turntable);
const carousel = new Carousel();
stage.add(carousel.group);
// the garden only comes out for the series-complete photo
const garden = new Garden();
garden.group.visible = false;
garden.alpha = 0;
stage.add(garden.group);
const fog = new THREE.Fog(0xfde6d3, 22, 75); // the far hills fade into the sky
// a box in each slot of the ring; the chosen one moves onto the turntable to be opened
const holders = carousel.slots;
let boxes = []; // built once the print fonts are ready
let box = null; // the one being opened
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
const view = { target: new THREE.Vector3(0, 1.0, 0), dist: 8.6, elev: 0.2, ox: 0, oy: 0 };

// ------------------------------------------------------------------ state
const store = storage();
const params = testParams; // ?sprout, ?tell and ?debug, on this computer only
const state = {
  mode: 'loading', // ring | box | opening | reveal | busy | finale
  current: null, rig: null, env: null, diorama: null,
  collection: store.load(),
  skyKey: 'box',
  forced: params.get('sprout'),
};

// ------------------------------------------------------------------ models
const loader = new GLTFLoader();
const loading = {};
/** The model for a Sprout, loaded the first time its box opens. */
function templateFor(id) {
  loading[id] ??= loadImported(id, loader);
  return loading[id];
}

// ------------------------------------------------------------------ theme: sky + light rig
let lightTarget = null;
function applySky(key, instant = false, seconds = 1.3) {
  state.skyKey = key;
  const def = SKY[key] || BY_ID[key].sky;
  const dark = isDark();
  const [top, bottom] = dark ? def.dark : def.light;
  const root = document.documentElement;
  const sky = $('sky');
  if (instant) sky.style.transition = 'none';
  else if (seconds > 1.3) sky.style.transitionDuration = `${seconds}s`;
  root.style.setProperty('--sky-top', top);
  root.style.setProperty('--sky-bottom', bottom);
  if (instant) { void sky.offsetWidth; sky.style.transition = ''; }
  else if (seconds > 1.3) setTimeout(() => { sky.style.transitionDuration = ''; }, seconds * 1000);
  // the chrome follows the sky behind it: light text on a night sky, dark text on the dawn garden even in dark mode
  root.classList.toggle('sky-dark', (key === 'light' || !!def.night) && !dark);
  root.classList.toggle('sky-day', !!def.day && dark);
  if (def.day || def.night) fog.color.set(bottom);
  setLights(LIGHTS[key] || LIGHTS.box, instant, seconds);
}

function setLights(preset, instant, seconds = 1.3) {
  const dim = isDark() && !preset.fixed && preset !== LIGHTS.light ? 0.7 : 1;
  const from = {
    hs: lights.hemi.color.clone(), hg: lights.hemi.groundColor.clone(), hi: lights.hemi.intensity,
    kc: lights.key.color.clone(), ki: lights.key.intensity, fc: lights.fill.color.clone(), fi: lights.fill.intensity, ei: stage.environmentIntensity ?? 1,
  };
  const to = {
    hs: new THREE.Color(preset.hemi[0]), hg: new THREE.Color(preset.hemi[1]), hi: preset.hemi[2] * dim,
    kc: new THREE.Color(preset.key[0]), ki: preset.key[1] * dim, fc: new THREE.Color(preset.fill[0]), fi: preset.fill[1] * dim, ei: preset.env * dim,
  };
  const token = (lightTarget = {});
  animate(instant ? 0 : seconds, (e) => {
    if (lightTarget !== token) return;
    lights.hemi.color.lerpColors(from.hs, to.hs, e);
    lights.hemi.groundColor.lerpColors(from.hg, to.hg, e);
    lights.hemi.intensity = THREE.MathUtils.lerp(from.hi, to.hi, e);
    lights.key.color.lerpColors(from.kc, to.kc, e);
    lights.key.intensity = THREE.MathUtils.lerp(from.ki, to.ki, e);
    lights.fill.color.lerpColors(from.fc, to.fc, e);
    lights.fill.intensity = THREE.MathUtils.lerp(from.fi, to.fi, e);
    stage.environmentIntensity = THREE.MathUtils.lerp(from.ei, to.ei, e);
  });
}
const onTheme = () => applySky(state.skyKey);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onTheme);
new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// ------------------------------------------------------------------ sizing + framing
const wide = () => innerWidth >= 860;
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  applyViewOffset();
}
function applyViewOffset() {
  const w = innerWidth, h = innerHeight;
  if (Math.abs(view.ox) < 0.5 && Math.abs(view.oy) < 0.5) camera.clearViewOffset();
  else camera.setViewOffset(w, h, view.ox, view.oy, w, h);
}
/** Where the subject should sit, given which UI is covering the screen. */
function frameFor(mode) {
  // the reveal's buttons sit in a dock along the bottom (the name tag in the corner is small enough to ignore)
  if (mode === 'card') return { ox: 0, oy: ui.cardDock.offsetHeight / 2 + (wide() ? 0 : 6) };
  return { ox: 0, oy: wide() ? 30 : 46 };
}
function flyView(to, seconds = 1.2) {
  const from = { t: view.target.clone(), dist: Number.isFinite(view.dist) ? view.dist : to.dist ?? 8.6, elev: view.elev, ox: view.ox, oy: view.oy };
  return animate(seconds, (e) => {
    view.target.lerpVectors(from.t, to.target ?? from.t, e);
    view.dist = THREE.MathUtils.lerp(from.dist, to.dist ?? from.dist, e);
    view.elev = THREE.MathUtils.lerp(from.elev, to.elev ?? from.elev, e);
    view.ox = THREE.MathUtils.lerp(from.ox, to.ox ?? from.ox, e);
    view.oy = THREE.MathUtils.lerp(from.oy, to.oy ?? from.oy, e);
    applyViewOffset();
  });
}
// zoom on the reveal stage (scroll, pinch, +/-): a multiplier on the framed distance, eased toward its target
const ZOOM_MIN = 0.5, ZOOM_MAX = 1.6;
let zoom = 1, zoomTarget = 1;
const zoomBy = (f) => { if (state.mode === 'reveal') zoomTarget = clamp(zoomTarget * f, ZOOM_MIN, ZOOM_MAX); };
function placeCamera() {
  const dist = view.dist * zoom;
  camera.position.set(view.target.x, view.target.y + Math.sin(view.elev) * dist, view.target.z + Math.cos(view.elev) * dist);
  camera.lookAt(view.target);
  if (shakeAmt > 0.001) { // a handheld jolt, for the trembles and the pop
    const n = performance.now() / 1000;
    camera.position.x += Math.sin(n * 61) * shakeAmt;
    camera.position.y += Math.sin(n * 47 + 1) * shakeAmt * 0.7;
  }
}
// fit the box by height on landscape screens and by width on tall ones
// (a page loaded in a hidden pane has no size yet: treat that as square rather than dividing by zero)
// the box is opened where it stands at the front of the ring; the stage (floatG) sits there, and so does the camera's target
const boxView = () => ({ target: new THREE.Vector3(floatG.position.x, 1.0, floatG.position.z), dist: Math.max(8.4, 1.55 / (Math.tan(THREE.MathUtils.degToRad(15)) * (innerWidth / innerHeight || 1))), elev: 0.2, ...frameFor('dock') });
// the whole ring, looking down enough that the back of it shows over the front; on tall screens the sides
// run off the edges, so the box at the front stays big enough to tap
function ringView() {
  const aspect = innerWidth / innerHeight || 1, landscape = aspect >= 1.05, { R, base } = carousel.lay;
  const tan = Math.tan(THREE.MathUtils.degToRad(15));
  const dist = Math.max(landscape ? 10.5 : 9.5, (landscape ? base * 0.92 : R * 1.05) / (tan * aspect));
  return { target: new THREE.Vector3(0, landscape ? 0.2 : 0.45, landscape ? 0.3 : 0.3), dist, elev: landscape ? 0.36 : 0.4, ...frameFor('dock') };
}
// the whole garden, for the finale: all three nests in frame, looking down a little more on tall screens
function gardenView() {
  const aspect = innerWidth / innerHeight || 1, landscape = aspect >= 1.05;
  const tan = Math.tan(THREE.MathUtils.degToRad(15));
  const dist = Math.max(landscape ? 9 : 8.5, (landscape ? 3.85 : 2.0) / (tan * aspect));
  return { target: new THREE.Vector3(0, landscape ? 1.05 : 1.25, landscape ? -0.15 : -0.4), dist, elev: landscape ? 0.19 : 0.24, ...frameFor('dock') };
}
function revealView(bounds) {
  const size = bounds.getSize(new THREE.Vector3());
  const c = bounds.getCenter(new THREE.Vector3());
  const aspect = innerWidth / innerHeight;
  let fit = Math.max(size.y * 3.3, (size.x * 3.3) / Math.min(aspect, 1.4));
  if (!wide()) fit *= 1.35;
  return { target: new THREE.Vector3(floatG.position.x, c.y + 0.05, floatG.position.z), dist: clamp(fit, 6.2, 12), elev: 0.16, ...frameFor('card') };
}

// ------------------------------------------------------------------ helpers
let toastTimer;
function toast(msg) {
  ui.toast.textContent = msg;
  ui.toast.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('is-on'), 2600);
}
const say = (msg) => { ui.announce.textContent = msg; };

/**
 * What's in the box, and whether it shows the rare tell, is decided by the server (api/pick.js) once the
 * strip is torn, so neither the odds nor the contents show up in the page or its network requests beforehand. ?sprout=<id> still forces one (for
 * testing, on this computer only). If the server can't be reached, the box still opens with an even pick of the
 * others: never the rare one, so blocking the request can't be used to fish for it.
 */
async function pickSprout() {
  if (state.forced && BY_ID[state.forced]) {
    // testing: ?sprout=<id>, and ?tell=1 to make any box show the tell (a fake-out)
    const id = state.forced;
    state.forced = null;
    return { id, tell: id === 'light' || params.get('tell') === '1' };
  }
  try {
    const res = await fetch('/api/pick', { method: 'POST', cache: 'no-store' });
    const { id, tell } = await res.json();
    if (BY_ID[id]) return { id, tell: !!tell };
    throw new Error(`unexpected answer: ${id}`);
  } catch (err) {
    console.warn('Could not reach /api/pick, picking evenly instead.', err);
    const pool = SERIES.filter((s) => s.id !== 'light');
    return { id: pool[Math.floor(Math.random() * pool.length)].id, tell: Math.random() < 0.1 };
  }
}

function record(id) {
  const c = state.collection;
  const isNew = !c.counts[id];
  c.counts[id] = (c.counts[id] || 0) + 1;
  c.last = id; // the break before the next box goes with it
  store.save(c);
  return isNew;
}

/** The name card, and its payoff: a sticker and a line for a first find, a repeat, or the rare one. */
function fillCard(id, count) {
  const s = BY_ID[id], rare = id === 'light', first = count === 1;
  ui.cardNo.textContent = `No. ${s.no} / ${String(SERIES.length).padStart(2, '0')}${rare ? ' · Rare' : ''}`;
  ui.cardName.textContent = s.name;
  ui.cardLine.textContent = rare
    ? `Only a few boxes hold this one.${first ? '' : ` You have ${count}.`}`
    : first ? 'First one! It joins your lineup.' : `You have ${count} of these now.`;
  ui.card.classList.toggle('is-rare', rare);
  const [text, kind] = rare ? [first ? 'RARE' : `RARE ×${count}`, 'rare'] : first ? ['NEW!', 'new'] : [`Again ×${count}`, 'again'];
  ui.cardSticker.textContent = text;
  ui.cardSticker.className = `sticker ${kind}`;
  ui.cardSticker.hidden = true; // slapped on just after the card lands
}

// ------------------------------------------------------------------ the lineup
const foundCount = () => SERIES.filter((s) => state.collection.counts[s.id]).length;
/** The chip's six dots; `fresh` pops the dot that's just been found. */
function renderChip(fresh = null) {
  const c = state.collection.counts;
  ui.chipDots.innerHTML = SERIES.map((s, i) => `<i style="--i:${i}" class="${c[s.id] ? 'on' : ''}${s.id === fresh ? ' fresh' : ''}"></i>`).join('');
  if (foundCount() < SERIES.length) ui.chip.classList.remove('complete');
  ui.chipCount.textContent = foundCount();
  ui.chip.setAttribute('aria-label', `Series 01 lineup: ${foundCount()} of ${SERIES.length} found`);
}
/** Found Sprouts in colour (with a count for repeats), the rest as silhouettes. No odds, anywhere. */
function renderLineup() {
  const c = state.collection.counts;
  ui.slots.innerHTML = SERIES.map((s) => {
    const n = c[s.id] || 0;
    return `<li class="slot${n ? '' : ' locked'}" style="--tint: color-mix(in srgb, ${s.tint} 50%, var(--paper))">
      <img src="models/web/box/${s.id}.webp" alt="${n ? s.name : `Number ${s.no}, not found yet`}">
      <span class="no">No. ${s.no}</span><span class="nm"${n ? '' : ' aria-hidden="true"'}>${n ? s.name : '???'}</span>
      ${n > 1 ? `<span class="ct" aria-label="${n} found">×${n}</span>` : ''}</li>`;
  }).join('');
  ui.lineupShare.hidden = foundCount() === 0;
  // all six: the Series 01 photo lives here, or the invite to take it if it was skipped
  const done = foundCount() === SERIES.length, photo = done && savedPhoto();
  ui.lineupPhoto.hidden = !done;
  ui.lineupPhoto.innerHTML = !done ? '' : photo
    ? `<button type="button" class="photo-thumb" id="lineup-photo-open"><img src="${photo}" alt=""><span>Your Series 01 photo<small>All six, squished in together. Tap to see or share it.</small></span></button>`
    : `<button type="button" class="btn invite take" id="lineup-photo-take">✦ Take the Series 01 photo</button>`;
  $('lineup-photo-open')?.addEventListener('click', () => { closeLineup(); setTimeout(() => showPhoto(photo), 300); });
  $('lineup-photo-take')?.addEventListener('click', startFinale);
}
function openLineup() {
  if (ui.lineup.open || state.mode === 'opening') return;
  renderLineup();
  ui.lineup.showModal();
  requestAnimationFrame(() => ui.lineup.classList.add('is-shown'));
}
function closeLineup() {
  if (!ui.lineup.open) return;
  ui.lineup.classList.remove('is-shown');
  setTimeout(() => ui.lineup.close(), 280);
}
ui.chip.addEventListener('click', openLineup);
ui.lineupClose.addEventListener('click', closeLineup);
ui.lineup.addEventListener('cancel', (e) => { e.preventDefault(); closeLineup(); }); // Esc
ui.lineup.addEventListener('click', (e) => { // a click outside the panel
  const r = ui.lineup.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeLineup();
});

// ------------------------------------------------------------------ box → reveal
const bursts = [];
// shared by every burst, so opening box after box doesn't keep making new ones
const burstMat = new THREE.MeshStandardMaterial({ color: 0xfffbe8, emissive: 0xfff4c8, emissiveIntensity: 0.8 });
const burstGeo = new THREE.SphereGeometry(1, 10, 8);
function burst(origin) {
  for (let i = 0; i < 16; i++) {
    const s = new THREE.Mesh(burstGeo, burstMat);
    const a = Math.random() * Math.PI * 2, r = 0.2 + Math.random() * 0.5;
    s.position.set(origin.x + Math.cos(a) * r, origin.y + Math.random() * 0.3, origin.z + Math.sin(a) * r);
    s.userData = { v: 0.35 + Math.random() * 0.5, life: 1.4 + Math.random() * 0.8, age: 0, size: 0.014 + Math.random() * 0.014 };
    turntable.add(s);
    bursts.push(s);
  }
}

// the opening's own effects: fibres, confetti, petals and starlight; a column of light when the lid pops
const fx = new Fx();
stage.add(fx.group);
const column = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.15, 7, 48, 1, true), beamMaterial(0xffffff));
column.position.y = BOX.H - 0.35 + 3.5; // rising out of the open top
column.visible = false;
turntable.add(column);
const glowSprite = (color) => new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));

/** The held breath before the drop: everything slows, the light dims a little. */
let hushed = false;
function hush(on) {
  hushed = on;
  document.documentElement.classList.toggle('is-hushed', on);
  if (!on) return;
  const from = { h: lights.hemi.intensity, k: lights.key.intensity, f: lights.fill.intensity };
  animate(0.8, (e) => {
    const k = 1 - 0.2 * e;
    lights.hemi.intensity = from.h * k; lights.key.intensity = from.k * k; lights.fill.intensity = from.f * k;
  });
}

let shakeAmt = 0;
const shake = (k) => { shakeAmt = Math.max(shakeAmt, k * motionScale()); };

/**
 * The opening, once a flick has started the rip: rip → hush → tremble (and the tell) → pop → silhouette
 * rise → colour flood → name stamp. What's inside is asked for as the strip rips; the tell comes with it.
 */
async function openBox() {
  if (state.mode !== 'box') return;
  if (needsAct(state.collection)) { showBreak(state.collection.last); return; }
  ui.boxWelcome.hidden = true;
  state.mode = 'opening';
  show(ui.boxDock, false);
  show(ui.chip, false);
  canvas.classList.remove('is-pointing');
  const picked = pickSprout(); // asked for now, while the strip rips
  say('Opening the box…');

  // the rip: one quick, accelerating zip, fibres puffing out of each perforation
  const yaw0 = turntable.rotation.y, yaw1 = Math.round(yaw0 / (Math.PI * 2)) * Math.PI * 2;
  const tilt0 = tilt.rotation.x;
  spin = 0; tiltTarget = 0;
  const settle = animate(0.55, (e) => { turntable.rotation.y = THREE.MathUtils.lerp(yaw0, yaw1, e); tilt.rotation.x = tilt0 * (1 - e); });
  flyView({ ...boxView(), dist: boxView().dist + 1.6, target: new THREE.Vector3(floatG.position.x, 1.7, floatG.position.z) }, 1.6);
  sound.play('zip', 0, 0.08 + 0.4 * (1 - box.tear.p));
  sound.buzz([6, 30, 6, 22, 6, 14, 6, 8, 20]);
  await box.rip((at) => fx.burst('fibre', at, 3, { colors: [0xf4f0e6, 0xece1cb, 0x63cd84], power: 0.45, spread: 0.02 }));
  const stripGone = box.detachStrip();
  await settle;
  turntable.rotation.y = 0;

  // hush: everything stops, the light dims, the freed lid lifts a crack and holds
  hush(true);
  sound.play('hush');
  await box.crack();
  const { id, tell } = await picked; // usually back long before now
  const def = BY_ID[id];
  state.current = id;
  // the model loads while the box trembles
  let ready = false;
  const template = templateFor(id).then((t) => { ready = true; return t; });
  await Promise.all([wait(0.6), stripGone]);

  // tremble, and light through the seams: warm and low for most boxes; cold rays, a dimming sky and a
  // shimmer for the rare one (and for its fake-outs, identically, right up until the pop)
  const WARM = 0xfff0c4, COLD = 0xe2e8ff;
  const leakColor = tell ? COLD : WARM, leakMax = tell ? 1 : 0.5;
  if (tell) { applySky('tell', false, 2.4); sound.play('shimmer', 0.1, 2.8); }
  const leaking = animate(tell ? 1.4 : 1.0, (e) => box.setLeak(e * leakMax, leakColor, tell ? e : 0));
  await wait(0.15);
  sound.play('creak'); sound.buzz(30);
  await box.tremble(0.7);
  await wait(tell ? 0.5 : 0.3);
  sound.play('creak'); sound.buzz(45); shake(0.035);
  await box.tremble(1.3);
  if (tell) {
    await wait(0.4);
    sound.play('creak'); sound.buzz(60); shake(0.05);
    await box.tremble(1.7);
  }
  await leaking;
  await wait(0.2);
  while (!ready) { sound.play('creak'); await box.tremble(1); if (!ready) await wait(0.35); }

  // the Sprout waits inside, small, as a silhouette
  const rig = new Rig(id, await template);
  floodable(rig.object);
  const env = buildEnv(id, rig);
  const diorama = new THREE.Group();
  diorama.position.y = BOX.T;
  rig.object.position.y = env.lift;
  diorama.add(env.group, rig.object);
  turntable.add(diorama);
  rig.object.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(rig.object);
  flood.uSilAmt.value = 1;
  flood.uSilLine.value = bounds.max.y + 1;
  rig.object.scale.setScalar(0.55);
  rig.object.position.y = env.lift - 0.9;
  env.group.visible = false;
  rig.onMoment = () => env.trigger();
  box.setInnerTint(def.tint);
  const backlight = glowSprite(new THREE.Color(def.sky.light[0]).lerp(new THREE.Color(0xffffff), 0.55));
  backlight.position.set(0, 1.1, -0.7);
  backlight.scale.setScalar(3.6);
  diorama.add(backlight);
  Object.assign(state, { rig, env, diorama });

  // pop: the lid bursts open, the light shoots up, paper confetti
  sound.play('lidpop'); sound.buzz(25); shake(0.04);
  const popping = box.popLid();
  animate(0.3, (e) => box.setLeak((1 - e) * leakMax, leakColor, tell ? 1 - e : 0));
  column.material.uniforms.color.value.set(def.sky.light[0]).lerp(new THREE.Color(0xffffff), 0.5);
  column.visible = true;
  animate(1.7, (e, p) => { column.material.uniforms.opacity.value = 0.24 * Math.pow(bell(Math.min(1, p * 1.6)), 0.6) * (1 - p * 0.4); }, ease.linear)
    .then(() => { column.visible = false; });
  fx.burst('paper', turntable.localToWorld(new THREE.Vector3(0, BOX.H, 0)), 28, { colors: [0xf4f0e6, 0x63cd84, 0xa9d6f5, 0xfde6d3, 0xffe2a0], power: 1.1, spread: 0.55 });
  await popping;

  // silhouette rise: the walls fall like petals while it comes up out of the box, backlit
  sound.play('rise', 0, 1.0);
  const walls = box.fallWalls();
  animate(0.5, (e) => { backlight.material.opacity = 0.9 * e; });
  await animate(1.0, (e) => {
    rig.object.position.y = env.lift - 0.9 * (1 - e);
    rig.object.scale.setScalar(0.55 + 0.45 * e);
  }, ease.outBack);

  // colour flood: from the top down, as the plinth dissolves into its own sky
  hush(false);
  applySky(id);
  leaveRing();
  sound.play(id === 'light' ? 'fanfare' : 'chime');
  sound.buzz([12, 40, 12, 40, 12]);
  const centre = turntable.localToWorld(new THREE.Vector3(0, 0.6, 0));
  const firstFind = !state.collection.counts[id];
  if (id === 'light') fx.starlight(centre, firstFind ? 40 : 24);
  else fx.burst('petal', centre, firstFind ? 30 : 14, { colors: [new THREE.Color(def.tint).getHex(), 0xffffff, 0xf6b8c8, 0x9ddcac], power: 0.75, spread: 0.9, up: 1.1 });
  burst(new THREE.Vector3(0, BOX.T + 0.3, 0));
  env.group.visible = true;
  popIn(env, animate);
  const top = bounds.max.y + 0.2, bottom = bounds.min.y - 0.2;
  await animate(0.6, (e) => {
    flood.uSilLine.value = top + (bottom - top) * e;
    backlight.material.opacity = 0.9 * (1 - e);
  }, ease.inOut);
  flood.uSilAmt.value = 0;
  diorama.remove(backlight);
  await walls;

  // the name stamps in, and the camera leans in for the hero shot
  record(id);
  const count = state.collection.counts[id];
  fillCard(id, count);
  const hero = revealView(bounds);
  flyView({ ...hero, dist: hero.dist * 0.92 }, 1.8);
  ui.card.classList.remove('stamp');
  void ui.card.offsetWidth;
  ui.card.classList.add('stamp');
  show(ui.card, true);
  sound.play('stamp', 0.12);
  sound.buzz(15);
  await wait(0.4);
  // then the sticker: NEW!, Again ×2, or RARE
  ui.cardSticker.hidden = false;
  ui.cardSticker.classList.remove('slap');
  void ui.cardSticker.offsetWidth;
  ui.cardSticker.classList.add('slap');
  sound.play(count === 1 ? 'newsting' : 'again');
  sound.buzz(10);
  show(ui.cardDock, true);
  show(ui.chip, true);
  state.mode = 'reveal';
  say(`You found ${def.name}. ${count === 1 ? 'It’s new to your lineup.' : `You have ${count} now.`}`);
  // a first find joins the lineup: its dot fills on the chip with a little click
  await wait(0.45);
  renderChip(count === 1 ? id : null);
  if (count === 1) {
    ui.chip.classList.remove('bump');
    void ui.chip.offsetWidth;
    ui.chip.classList.add('bump');
    sound.play('slot');
    if (complete() && !savedPhoto()) offerInvite();
  }
  // the rare one gets a slow turn on the stage (until someone grabs it)
  if (id === 'light') {
    const token = (orbit = {}), y0 = turntable.rotation.y;
    animate(8, (e) => { if (orbit === token) turntable.rotation.y = y0 + Math.PI * 2 * e; }, ease.inOut);
  }
  await wait(0.1);
  if (state.rig === rig) rig.play();
}
let orbit = null;

async function newBox() {
  if (state.mode === 'busy' || state.mode === 'opening') return;
  state.mode = 'busy';
  orbit = null;
  closeLineup();
  ui.invite.hidden = true; // if it was skipped, the lineup keeps it
  zoomTarget = 1;
  show(ui.card, false);
  show(ui.cardDock, false);
  if (state.diorama) {
    const d = state.diorama;
    await Promise.all([
      animate(0.55, (e) => d.scale.setScalar(Math.max(1e-4, 1 - e)), ease.in),
      box.clear(),
    ]);
    turntable.remove(d);
    Object.assign(state, { rig: null, env: null, diorama: null, current: null });
  }
  await enterRing();
}

// ------------------------------------------------------------------ the ring
const HINT = {
  ring: 'Spin the boxes, then tap the one at the front.',
  box: 'Flick the green tab to tear the box open. Drag anywhere else to turn it.',
};
const LABEL = {
  ring: `A turning ring of ${SLOTS} Sprout boxes. Use the left and right arrow keys to turn it and Enter to choose the box at the front.`,
  box: 'Sprout stage. Drag or use the arrow keys to turn. Press Enter to tear the box open or play a moment. Once it’s open, plus and minus zoom.',
};
function setHint(mode) {
  ui.boxHint.querySelector('.when-free').textContent = HINT[mode];
  canvas.setAttribute('aria-label', LABEL[mode]);
}

/** Sizes the ring for the current screen shape; the opening spot is the front of it. */
function seatRing() {
  carousel.layout(innerWidth / innerHeight || 1);
  const at = carousel.frontPos();
  floatG.position.x = at.x; floatG.position.z = at.z;
}

let hovered = null, rattleIn = 3;
/** A little lift for the box you're pointing at, or none. */
function point(i) {
  if (hovered === i) return;
  hovered = i;
  carousel.hovered = i;
  canvas.classList.toggle('is-pointing', i != null);
}

/** The boxes drop onto the ring one after another, in today's sky, and it starts to turn. */
async function enterRing(first = false) {
  state.mode = 'busy';
  const look = skyLook();
  applySky(look, first);
  carousel.setLook(look, first ? 0 : 1.3);
  carousel.spotlight(false);
  carousel.spin(false);
  carousel.reset();
  if (garden.group.visible) garden.fade(false, 0.8); // back from the photo
  stage.fog = null;
  catcher.visible = false;
  turntable.rotation.set(0, 0, 0);
  tilt.rotation.x = tiltTarget = 0;
  seatRing();
  boxes.forEach((b, i) => { holders[i].add(b.group); b.reset(); b.group.visible = false; });
  box = null;
  point(null);
  const settled = showResidents(); // once the series is complete, the six live here
  if (first) { carousel.fade(true, 0); Object.assign(view, ringView()); applyViewOffset(); }
  else { carousel.fade(true, 0.8); flyView(ringView(), 1.1); }
  await wait(first ? 0.25 : 0.5);
  // front first, then round both sides to the back
  const order = [0, 1, SLOTS - 1, 2, SLOTS - 2, 3].slice(0, SLOTS);
  const landAt = new THREE.Vector3();
  await Promise.all(order.map((i, n) => wait(n * 0.11).then(() => {
    boxes[i].group.visible = true;
    return boxes[i].drop(() => {
      carousel.puff(holders[i].getWorldPosition(landAt), 6, 0.55);
      if (n % 2 === 0) sound.play('thunk');
      sound.buzz(6);
    });
  })));
  setHint('ring');
  state.mode = 'ring';
  carousel.spin(true);
  rattleIn = 2.5 + Math.random() * 2;
  show(ui.boxDock, true);
  show(ui.chip, true);
  if (complete()) ui.chip.classList.add('complete');
  // back from a box: they're all here, and the one you just found again does its moment
  await settled;
  const again = residents[state.collection.last];
  if (again && !first) again.play();
}

/** The plinth steps aside as the walls fall and the Sprout's own sky comes in. */
function leaveRing() {
  carousel.spotlight(false);
  home.visible = false;
  carousel.fade(false, 1.0).then(() => {
    if (carousel.group.visible) return;
    stage.fog = null;
    catcher.visible = true;
  });
}

/** The box at the front: the others duck away into the plinth and it grows to full size where it stands. */
async function chooseBox(i) {
  if (state.mode !== 'ring' || !boxes[i]?.group.visible) return;
  if (needsAct(state.collection)) { showBreak(state.collection.last); return; }
  state.mode = 'busy';
  show(ui.boxDock, false);
  point(null);
  const chosen = (box = boxes[i]);
  say('You chose a box. Pull the green tab to open it.');
  sound.play('whoosh', 0.15);
  await carousel.settleOn(i);
  // the rest go nearest first, out to the back of the ring
  const rest = boxes.map((b, k) => k).filter((k) => k !== i).sort((a, b) => Math.abs(carousel.offset(a)) - Math.abs(carousel.offset(b)));
  const going = rest.map((k, n) => wait(0.04 + n * 0.07).then(async () => {
    const g = boxes[k].group;
    if (n < 2) sound.play('burrow');
    await animate(0.18, (e, p) => { g.rotation.z = 0.06 * Math.sin(p * Math.PI * 3); }, ease.linear);
    g.rotation.z = 0;
    await animate(0.42, (e) => { g.position.y = -0.5 * e; g.scale.setScalar(Math.max(1e-4, 1 - e)); }, ease.in);
    g.visible = false;
  }));
  // onto the turntable, keeping where it is, then a hop as it grows to full size
  stage.updateMatrixWorld(true);
  turntable.attach(chosen.group);
  const p0 = chosen.group.position.clone(), q0 = chosen.group.quaternion.clone(), s0 = chosen.group.scale.x;
  const q1 = new THREE.Quaternion();
  carousel.spotlight(true);
  flyView(boxView(), 1.2);
  await wait(0.2);
  await animate(0.75, (e, p) => {
    chosen.group.position.set(p0.x * (1 - e), p0.y * (1 - e) + 0.75 * Math.sin(Math.PI * p), p0.z * (1 - e));
    chosen.group.quaternion.slerpQuaternions(q0, q1, e);
    chosen.group.scale.setScalar(s0 + (1 - s0) * e);
  }, ease.inOut);
  chosen.group.position.set(0, 0, 0);
  chosen.group.quaternion.identity();
  chosen.group.scale.setScalar(1);
  carousel.puff(carousel.frontPos(), 9, 0.7);
  sound.play('thunk'); sound.buzz(12);
  await Promise.all(going);
  setHint('box');
  state.mode = 'box';
  show(ui.boxDock, true);
  // the tab pops out to say "pull me"
  await wait(0.25);
  sound.play('tabpop');
  box.presentTab();
}

/** The box under a pointer: the one it hits, or failing that the front one if it's close enough. */
function boxAt(e) {
  rayFrom(e);
  const live = boxes.filter((b, i) => b.group.visible && b.group.parent === holders[i]).map((b) => b.group);
  const hit = raycaster.intersectObjects(live, true)[0];
  if (hit) {
    let o = hit.object;
    while (o && !live.includes(o)) o = o.parent;
    const i = boxes.findIndex((b) => b.group === o);
    if (i >= 0) return i;
  }
  const f = carousel.front();
  if (!live.includes(boxes[f]?.group)) return null;
  const r = canvas.getBoundingClientRect();
  const toScreen = (v) => { v.project(camera); return [(v.x * 0.5 + 0.5) * r.width, (-v.y * 0.5 + 0.5) * r.height]; };
  const h = holders[f], k = h.getWorldScale(new THREE.Vector3()).x;
  const base = h.getWorldPosition(new THREE.Vector3());
  const [cx, cy] = toScreen(base.clone().setY(BOX.H * k * 0.5));
  const [, ty] = toScreen(base.clone().setY(BOX.H * k));
  return Math.hypot(e.clientX - r.left - cx, e.clientY - r.top - cy) < Math.abs(cy - ty) * 1.4 ? f : null;
}

// ------------------------------------------------------------------ input
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let drag = null, spin = 0, tiltTarget = 0;

function rayFrom(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
}
const draggable = () => state.mode === 'box' || state.mode === 'reveal';
const touches = new Map(); // pointerId -> [x, y], for pinching
let pinch = null;
const spread = () => { const [a, b] = [...touches.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]) || 1; };

let press = null; // a touch on the ring: a tap chooses, a drag spins it
/** Radians of turn per pixel of drag, so the box at the front keeps up with the finger. */
function ringPerPx() {
  const r = canvas.getBoundingClientRect(), R = carousel.lay.R;
  const a = new THREE.Vector3(-R, 0, R * 0.2).project(camera), b = new THREE.Vector3(R, 0, R * 0.2).project(camera);
  return 2 / Math.max(80, (Math.abs(b.x - a.x) * r.width) / 2);
}
canvas.addEventListener('pointerdown', (e) => {
  if (state.mode === 'ring') {
    if (press) return;
    press = { x: e.clientX, y: e.clientY, lx: e.clientX, at: performance.now(), id: e.pointerId, moved: 0, k: ringPerPx() };
    carousel.grab(); // a touch stops it turning
    canvas.setPointerCapture(e.pointerId);
    point(boxAt(e)); // on a phone, touching down is where the box lifts
    return;
  }
  if (!draggable()) return;
  touches.set(e.pointerId, [e.clientX, e.clientY]);
  if (touches.size === 2 && state.mode === 'reveal') {
    // a second finger turns the drag into a pinch
    drag = null;
    pinch = { d0: spread(), z0: zoomTarget };
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  if (touches.size > 1) return;
  orbit = null; // the rare one's slow turn stops when you take hold
  drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: 0 };
  if (state.mode === 'box') {
    rayFrom(e);
    drag.tear = box.canGrab(raycaster.intersectObject(box.group, true)[0]);
    if (drag.tear) {
      // measure the strip on screen, so a pull is judged in pixels whatever the zoom
      const r = canvas.getBoundingClientRect();
      const a = box.strip.localToWorld(new THREE.Vector3(0, 0, 0)).project(camera);
      const b = box.strip.localToWorld(new THREE.Vector3(box.tear.L, 0, 0)).project(camera);
      Object.assign(drag, { s0: box.pointerAlongStrip(ndc, camera), stripPx: Math.hypot((b.x - a.x) * r.width / 2, (b.y - a.y) * r.height / 2), px: 0, vel: 0, at: performance.now() });
    }
    if (drag.tear && needsAct(state.collection)) {
      // this box waits for a break, even after a reload
      drag = null;
      touches.delete(e.pointerId);
      showBreak(state.collection.last);
      return;
    }
    if (drag.tear) { spin = 0; show(ui.boxDock, false); }
  }
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('is-dragging');
});
canvas.addEventListener('pointermove', (e) => {
  if (state.mode === 'ring') {
    if (press?.id === e.pointerId) {
      const dx = e.clientX - press.lx, now = performance.now();
      press.moved += Math.abs(dx);
      press.lx = e.clientX;
      if (press.moved > 8 || Math.abs(e.clientY - press.y) > 8) {
        if (!press.spun) { press.spun = true; point(null); canvas.classList.add('is-dragging'); }
        carousel.drag(dx * press.k, (now - press.at) / 1000);
      }
      press.at = now;
    } else if (!press && e.pointerType === 'mouse') point(boxAt(e));
    return;
  }
  if (touches.has(e.pointerId)) touches.set(e.pointerId, [e.clientX, e.clientY]);
  if (pinch && touches.size === 2) {
    zoomTarget = clamp(pinch.z0 * (pinch.d0 / spread()), ZOOM_MIN, ZOOM_MAX);
    return;
  }
  if (drag?.tear) {
    // a short pull peels the tab; past 40 px, or a quick flick, and the strip rips itself
    drag.moved += Math.abs(e.clientX - drag.lx) + Math.abs(e.clientY - drag.ly);
    drag.lx = e.clientX; drag.ly = e.clientY;
    rayFrom(e);
    const s = box.pointerAlongStrip(ndc, camera), now = performance.now();
    const px = (s - drag.s0) * drag.stripPx;
    drag.vel = 0.6 * drag.vel + 0.4 * ((px - drag.px) / Math.max(1, now - drag.at)); // px per ms
    drag.px = px; drag.at = now;
    if (px > 40 || (px > 10 && drag.vel > 0.8)) { drag = null; canvas.classList.remove('is-dragging'); openBox(); return; }
    box.pullTo(s, 0.1);
    return;
  }
  if (drag) {
    const dx = e.clientX - drag.lx, dy = e.clientY - drag.ly;
    drag.lx = e.clientX; drag.ly = e.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    turntable.rotation.y += dx * 0.009;
    spin = dx * 0.009 * 60;
    tiltTarget = clamp(tiltTarget + dy * 0.003, -0.22, 0.28);
    return;
  }
  // hover affordances
  rayFrom(e);
  let pointing = false;
  if (state.mode === 'box') pointing = box.canGrab(raycaster.intersectObject(box.group, true)[0]);
  else if (state.mode === 'reveal' && state.rig) pointing = raycaster.intersectObject(state.rig.object, true).length > 0;
  canvas.classList.toggle('is-pointing', pointing);
});
function endDrag(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  canvas.classList.remove('is-dragging');
  if (d.tear && state.mode === 'box') {
    // let go part way: the strip stays torn where it is
    if (box.tear.p < 0.02) toast('Flick the green tab to the right to tear it open.');
    show(ui.boxDock, true);
    return;
  }
  if (d.moved > 6) return;
  rayFrom(e);
  if (state.mode === 'box') {
    if (raycaster.intersectObject(box.group, true).length) { box.wobble(); toast('Flick the green tab to the right to tear it open.'); }
  } else if (state.mode === 'reveal' && state.rig) {
    if (raycaster.intersectObject(state.rig.object, true).length) state.rig.play();
  }
}
const lift = (e) => { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; };
canvas.addEventListener('pointerup', (e) => {
  if (state.mode === 'ring' && press?.id === e.pointerId) {
    const tap = !press.spun && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 12;
    press = null;
    canvas.classList.remove('is-dragging');
    const i = tap ? boxAt(e) : null;
    // the one at the front is chosen; tapping one further round brings it to the front
    if (i != null && Math.abs(carousel.offset(i)) < STEP_HALF) chooseBox(i);
    else if (i != null) { carousel.turnTo(i); sound.play('whoosh'); }
    else carousel.release();
    if (i == null && e.pointerType !== 'mouse') point(null);
    return;
  }
  lift(e); endDrag(e);
});
canvas.addEventListener('pointercancel', (e) => {
  if (press?.id === e.pointerId) { press = null; carousel.release(); }
  lift(e); drag = null; canvas.classList.remove('is-dragging');
});
canvas.addEventListener('pointerleave', () => { if (state.mode === 'ring' && !press) point(null); });
// scroll wheels zoom in steps; trackpad pinches arrive as wheel events with ctrlKey and fine deltas
canvas.addEventListener('wheel', (e) => {
  if (state.mode !== 'reveal') return;
  e.preventDefault();
  zoomBy(Math.exp(clamp(e.deltaY, -100, 100) * (e.ctrlKey ? 0.01 : 0.0015)));
}, { passive: false });
canvas.addEventListener('keydown', (e) => {
  if (state.mode === 'ring') {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const k = carousel.nudge(e.key === 'ArrowLeft' ? -1 : 1);
      sound.play('tick');
      say(`Box ${k + 1} of ${SLOTS} is at the front.`);
      e.preventDefault();
    }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chooseBox(carousel.target != null ? carousel.slotAt(carousel.target) : carousel.front()); }
    return;
  }
  if (!draggable()) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const dir = e.key === 'ArrowLeft' ? -1 : 1;
    if (state.mode === 'box') turntable.rotation.y += dir * 0.15; // step, no momentum
    else spin += dir * 2.2;
    e.preventDefault();
  }
  if (e.key === '+' || e.key === '=') { zoomBy(1 / 1.15); e.preventDefault(); }
  if (e.key === '-' || e.key === '_') { zoomBy(1.15); e.preventDefault(); }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { tiltTarget = clamp(tiltTarget + (e.key === 'ArrowDown' ? 0.08 : -0.08), -0.22, 0.28); e.preventDefault(); }
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (state.mode === 'box') openBox();
    else state.rig?.play();
  }
});

// ------------------------------------------------------------------ completing the series
// Once all six are found, an invite: the six gather in the garden, squish in for a selfie and the photo takes
// itself. It lands as a Polaroid (kept for good, in the lineup) and from then on the six stand round the ring,
// with new boxes arriving on it.
const complete = () => foundCount() === SERIES.length;
const savedPhoto = () => store.photo();
const home = new THREE.Group(); // the six, once they live round the ring (or are in the garden for the photo)
home.visible = false;
stage.add(home);
const residents = {}; // id -> Rig
let finaleCam = null, frozen = false, momentIn = 10;

/** Loads all six (once), hidden. */
function moveIn() {
  return Promise.all(SERIES.map(async (s) => {
    if (residents[s.id]) return;
    const rig = new Rig(s.id, await templateFor(s.id));
    rig.object.visible = false;
    home.add(rig.object);
    residents[s.id] = rig;
  }));
}
/** Each in its own spot for this screen shape (round the ring, or in the garden), turned toward the middle. */
function seatResidents(lay = carousel.lay) {
  SERIES.forEach((s, i) => {
    const r = residents[s.id];
    if (!r) return;
    const [x, z] = lay.homes[i];
    r.object.position.set(x, lay.homeY ?? 0, z);
    r.object.rotation.set(0, lay === carousel.lay ? Math.atan2(-x, -z) * 0.35 : -x * 0.07, 0);
    r.object.scale.setScalar(lay.homeScale);
  });
}
/** After the series is complete, the six live round the ring: all six are there whenever it is. */
async function showResidents() {
  if (!complete()) return;
  await moveIn();
  seatResidents();
  Object.values(residents).forEach((r) => { r.object.visible = true; });
  home.visible = carousel.group.visible;
}

/** The sixth find: the chip's dots go gold one by one, and the invite rises in the dock. */
function offerInvite() {
  ui.chip.classList.add('complete');
  ui.invite.hidden = false;
  sound.play('invite', 0.3);
  sound.buzz([10, 60, 10]);
  say('Series complete! All six found. The invite to see your garden is in the buttons below.');
}

function renderSquare(cam, size = 1080, hide = []) {
  const prev = { size: renderer.getSize(new THREE.Vector2()), ratio: renderer.getPixelRatio(), aspect: cam.aspect };
  const hidden = hide.filter((o) => o?.visible);
  hidden.forEach((o) => { o.visible = false; });
  cam.aspect = 1; cam.updateProjectionMatrix();
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.render(stage, cam);
  const out = document.createElement('canvas');
  out.width = out.height = size;
  out.getContext('2d').drawImage(renderer.domElement, 0, 0);
  renderer.setPixelRatio(prev.ratio);
  renderer.setSize(prev.size.x, prev.size.y, false);
  cam.aspect = prev.aspect; cam.updateProjectionMatrix();
  hidden.forEach((o) => { o.visible = true; });
  return out;
}

const countdownTick = (n) => {
  ui.countdown.textContent = n;
  ui.countdown.classList.remove('tick');
  void ui.countdown.offsetWidth;
  ui.countdown.classList.add('tick');
};

/** The finale: gather, squish in, 3-2-1, flash, and the Polaroid lands. */
async function startFinale() {
  if (!complete() || !['reveal', 'ring', 'box'].includes(state.mode) || ui.act.open) return;
  const from = state.mode, last = state.collection.last;
  state.mode = 'finale';
  closeLineup();
  closeShare();
  orbit = null;
  ui.invite.hidden = true;
  [ui.card, ui.cardDock, ui.boxDock, ui.chip].forEach((el) => show(el, false));
  say('Series complete. The six are gathering in the garden.');
  carousel.spin(false);
  home.visible = false;
  const loading = moveIn();
  // the stage clears: the revealed Sprout and its box step aside, or the waiting boxes
  if (from === 'reveal' && state.diorama) {
    const d = state.diorama;
    await Promise.all([animate(0.55, (e) => d.scale.setScalar(Math.max(1e-4, 1 - e)), ease.in), box.clear()]);
    turntable.remove(d);
    Object.assign(state, { rig: null, env: null, diorama: null, current: null });
  } else {
    await Promise.all(boxes.filter((b) => b.group.visible).map((b) => animate(0.4, (e) => b.group.scale.setScalar(Math.max(1e-4, 1 - e)), ease.in)));
  }
  boxes.forEach((b, i) => { holders[i].add(b.group); b.reset(); b.group.visible = false; });
  box = null;
  // the garden, in today's sky, with nobody in it yet
  const look = skyLook();
  applySky(look);
  garden.setLook(look, 0);
  garden.clearMounds();
  garden.spotlight(false);
  stage.fog = fog;
  catcher.visible = false;
  turntable.rotation.set(0, 0, 0);
  garden.layout(innerWidth / innerHeight || 1);
  if (carousel.group.visible) carousel.fade(false, 0.6);
  garden.fade(true, 0.8);
  flyView(gardenView(), 1.4);
  await Promise.all([loading, wait(1.3)]);
  seatResidents(garden.lay);
  Object.values(residents).forEach((r) => { r.object.visible = false; });
  home.visible = true;

  // they pop up out of the soil one at a time; the one you just found comes last
  const order = SERIES.map((s) => s.id).filter((id) => id !== last).concat(last && residents[last] ? [last] : []);
  for (const [k, id] of order.entries()) {
    const r = residents[id], i = SERIES.findIndex((s) => s.id === id), [x, z] = garden.lay.homes[i], s1 = garden.lay.homeScale;
    garden.puff(new THREE.Vector3(x, 0, z), 12, 0.9);
    sound.play('popup', 0, k);
    sound.buzz(8);
    r.object.visible = true;
    animate(0.55, (e) => { r.object.position.y = -1 * (1 - e); r.object.scale.setScalar(s1 * (0.35 + 0.65 * e)); }, ease.outBack);
    await wait(0.34);
  }
  await wait(0.7);

  // squish in: they rush the camera, which drops to their eye level and widens like a phone's selfie lens
  const S = garden.nestPos(1);
  garden.clearSpot(S, 2.2); // the flowers right there bow out of the shot
  finaleCam = new THREE.PerspectiveCamera(camera.fov, innerWidth / innerHeight, 0.1, 100);
  finaleCam.position.copy(camera.position);
  finaleCam.quaternion.copy(camera.quaternion);
  const camTo = new THREE.Vector3(S.x, 1.05, S.z + 3.4), lookTo = new THREE.Vector3(S.x, 0.98, S.z);
  // the photo is square and close; on a tall screen the live view steps back until all six fit across it
  const liveCam = () => {
    const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(26)) * Math.min(1, innerWidth / innerHeight || 1));
    const back = Math.max(0, 1.5 / Math.tan(half) - camTo.distanceTo(lookTo));
    return camTo.clone().addScaledVector(camTo.clone().sub(lookTo).normalize(), back);
  };
  const camFrom = finaleCam.position.clone(), qFrom = finaleCam.quaternion.clone(), camLive = liveCam();
  const qTo = new THREE.PerspectiveCamera(); qTo.position.copy(camTo); qTo.lookAt(lookTo); // a camera, so it faces the target
  // front row big and close, back row peeking over; the one just found in the middle at the front
  const spots = [[0, 1.2, 0], [-0.8, 1.08, 0], [0.82, 1.1, 0], [-1.1, 0.12, 0.88], [0.0, -0.05, 1.05], [1.12, 0.16, 0.82]];
  const cast = [...order].reverse();
  sound.play('squish');
  residents.cheer?.play(); // Cheer hops to get in the shot
  const moves = cast.map((id, k) => {
    const r = residents[id], p0 = r.object.position.clone(), s0 = r.object.scale.x, r0 = r.object.rotation.y;
    const [dx, dz, lift] = spots[k];
    const p1 = new THREE.Vector3(S.x + dx, lift, S.z + dz);
    const r1 = Math.atan2(camTo.x - p1.x, camTo.z - p1.z);
    return wait(k * 0.06).then(() => animate(1.1, (e, p) => {
      r.object.position.lerpVectors(p0, p1, e);
      r.object.position.y += 0.35 * Math.sin(Math.PI * p); // a hop on the way
      r.object.scale.setScalar(s0 + (0.82 - s0) * e);
      r.object.rotation.y = r0 + (r1 - r0) * e;
    }, ease.inOut));
  });
  await animate(1.3, (e) => {
    finaleCam.position.lerpVectors(camFrom, camLive, e);
    finaleCam.quaternion.slerpQuaternions(qFrom, qTo.quaternion, e);
    finaleCam.fov = THREE.MathUtils.lerp(camera.fov, 52, e);
    finaleCam.updateProjectionMatrix();
  }, ease.inOut);
  await Promise.all(moves);
  await wait(0.3);

  // 3, 2, 1, and the flash: the frame at that instant is the photo
  for (const n of ['3', '2', '1']) { countdownTick(n); sound.play('count'); await wait(0.6); }
  frozen = true;
  const live = finaleCam.position.clone();
  finaleCam.position.copy(camTo); // the photo itself is the close, square selfie
  const photo = renderSquare(finaleCam, 1080, [fx.group]);
  finaleCam.position.copy(live);
  ui.flash.classList.remove('go');
  void ui.flash.offsetWidth;
  ui.flash.classList.add('go');
  sound.play('shutter');
  sound.buzz(20);
  const card = await polaroidCard(photo, (SKY[state.skyKey] || SKY.dawn).light);
  const keep = card.toDataURL('image/jpeg', 0.88);
  store.savePhoto(keep);
  state.collection.completeAt ??= Date.now();
  store.save(state.collection);
  await wait(0.5);
  showPhoto(keep, true);
}

/** The Polaroid, landing over the dimmed garden (or reopened from the lineup). */
function showPhoto(src, landing = false) {
  ui.photoImg.src = src;
  ui.photo.classList.toggle('landing', landing);
  if (!ui.photo.open) ui.photo.showModal();
  if (landing) sound.play('develop', 0.3);
  ui.photoShare.focus();
}
async function sharePhoto() {
  const src = savedPhoto() || ui.photoImg.src;
  const im = new Image();
  await new Promise((r) => { im.onload = im.onerror = r; im.src = src; });
  const c = document.createElement('canvas');
  c.width = im.naturalWidth || 1080; c.height = im.naturalHeight || 1350;
  c.getContext('2d').drawImage(im, 0, 0);
  previewShare({
    blob: await pngOf(c), filename: 'sprout-series-01-photo.png', title: 'Share your photo',
    text: 'All six Sprouts of Little Moments, Series 01, found.',
    alt: 'A Polaroid of all six Series 01 Sprouts squished in together for a selfie.',
  });
}
async function closePhoto() {
  if (!ui.photo.open) return;
  ui.photo.close();
  if (state.mode !== 'finale') return;
  // back to the ring: the six take their places round it, and boxes arrive on it
  frozen = false;
  finaleCam = null;
  garden.restore();
  await enterRing();
}
ui.invite.addEventListener('click', startFinale);
ui.photoShare.addEventListener('click', sharePhoto);
ui.photoBack.addEventListener('click', closePhoto);
ui.photo.addEventListener('cancel', (e) => { e.preventDefault(); closePhoto(); });

// ------------------------------------------------------------------ sharing
ui.lineupShare.addEventListener('click', async () => {
  const blob = await collectionCard(state.collection.counts);
  const n = foundCount();
  previewShare({
    blob, filename: 'sprout-series-01.png', title: 'Share your collection',
    text: `I’ve found ${n} of ${SERIES.length} Sprouts in Little Moments, Series 01.`,
    alt: `The Series 01 lineup with ${n} of ${SERIES.length} Sprouts found.`,
  });
});
ui.shareClose.addEventListener('click', closeShare);
ui.share.addEventListener('cancel', (e) => { e.preventDefault(); closeShare(); });
ui.share.addEventListener('click', (e) => {
  const r = ui.share.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeShare();
});

// sound starts with the first tap or key press; the button (and M) mutes it, and that's remembered
addEventListener('pointerdown', sound.unlock, { capture: true });
addEventListener('keydown', sound.unlock, { capture: true });
function showMute(off) {
  ui.mute.setAttribute('aria-pressed', String(off));
  ui.mute.setAttribute('aria-label', off ? 'Sound off. Turn sound on' : 'Sound on. Turn sound off');
  ui.mute.classList.toggle('is-off', off);
}
showMute(sound.isMuted());
sound.onMute(showMute);
ui.mute.addEventListener('click', () => { sound.setMuted(!sound.isMuted()); if (!sound.isMuted()) sound.play('tick'); });
addEventListener('keydown', (e) => {
  if ((e.key === 'm' || e.key === 'M') && !e.metaKey && !e.ctrlKey && !e.altKey && !ui.act.open) sound.setMuted(!sound.isMuted());
});

// after the first box, each new one asks for a five-minute break first (src/unlock.js)
ui.cardPrimary.addEventListener('click', () => {
  if (state.mode !== 'reveal' || ui.act.open) return;
  if (needsAct(state.collection)) showBreak(state.current);
  else newBox();
});
// when the break is over the next box comes out on its own, with a welcome back
setupBreaks({
  dialog: ui.act, collection: state.collection, save: () => store.save(state.collection),
  pills: [...document.querySelectorAll('[data-break-pill]')],
  onReady() {
    ui.boxWelcome.hidden = false;
    say('Glad you had a good break. Ready to open another box?');
    if (state.mode === 'reveal') newBox();
  },
});
addEventListener('resize', () => {
  resize();
  if (state.mode === 'reveal' && state.rig) {
    const s = state.rig.object.scale.x;
    state.rig.object.scale.setScalar(1);
    state.rig.object.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(state.rig.object);
    state.rig.object.scale.setScalar(s);
    flyView(revealView(b), 0.4);
  } else if (state.mode === 'box') flyView(boxView(), 0.4);
  else if (state.mode === 'ring') { seatRing(); seatResidents(); flyView(ringView(), 0.4); }
  if (finaleCam) { finaleCam.aspect = innerWidth / innerHeight; finaleCam.updateProjectionMatrix(); }
});
// the sky turns from dawn to dusk (and back) while the ring is out, slowly
watchSky((look) => {
  if (!carousel.group.visible || !['ring', 'box', 'busy'].includes(state.mode) || state.skyKey === look || state.current) return;
  applySky(look, false, 20);
  carousel.setLook(look, 20);
});

if (params.has('debug')) {
  window.__sprout = {
    state, turntable, tilt, view, garden, carousel, holders, chooseBox, sound, startFinale, residents, get boxes() { return boxes; }, get box() { return box; }, get zoom() { return zoom; },
    /** client-space position of a point on the strip (a = metres along it; negative is the tab) */
    stripPoint(a = -0.07) {
      stage.updateMatrixWorld(true);
      const v = box.strip.localToWorld(new THREE.Vector3(a, 0, 0.02)).project(camera);
      return [(v.x * 0.5 + 0.5) * innerWidth, (-v.y * 0.5 + 0.5) * innerHeight];
    },
    /** Runs the scene forward by hand (a hidden tab gets no animation frames). */
    async advance(seconds, fps = 30) {
      for (let i = 0; i < seconds * fps; i++) {
        step(1 / fps);
        // let anything awaiting this frame carry on, network callbacks included (a message tick isn't throttled)
        await new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = r; ch.port2.postMessage(0); });
      }
      clock.getDelta();
    },
    probe(clientX, clientY) {
      rayFrom({ clientX, clientY });
      const h = raycaster.intersectObject(box.group, true)[0];
      return [h?.object.name || h?.object.type, box.canGrab(h)];
    },
  };
}

// ------------------------------------------------------------------ loop
const clock = new THREE.Clock();
let t = 0;
function frame() {
  requestAnimationFrame(frame);
  step(Math.min(clock.getDelta(), 1 / 20));
}
function step(dt) {
  t += dt;
  tickTweens(dt);
  const amp = motionScale();
  if (!drag) {
    // the box only turns while you hold it; Sprout keeps a little momentum on the reveal stage
    if (state.mode === 'box') spin = 0;
    turntable.rotation.y += spin * dt;
    spin *= Math.pow(0.04, dt);
    tiltTarget *= Math.pow(0.08, dt);
  }
  tilt.rotation.x += (tiltTarget - tilt.rotation.x) * Math.min(1, dt * 8);
  zoom += (zoomTarget - zoom) * Math.min(1, dt * 10);
  if (carousel.group.visible || garden.group.visible) {
    // sitting on the plinth: no float, and lifted just enough that a tilted box rocks on its edge instead of sinking in
    floatG.position.y = Math.abs(Math.sin(tilt.rotation.x)) * BOX.W * 0.5;
  } else floatG.position.y = state.mode === 'box' ? 0.035 * Math.sin(t * 1.3) * amp : floatG.position.y * 0.9;
  boxes.forEach((b) => { if (b.group.visible) b.updateStrip(t); });
  // now and then a box rattles by itself, as if something inside is stirring (the front ones, where you'd see it)
  if (state.mode === 'ring' && !reducedMotion.matches && (rattleIn -= dt) <= 0) {
    const pick = boxes.map((b, k) => k).filter((k) => k !== hovered && boxes[k].group.visible && Math.abs(carousel.offset(k)) < 1.6);
    const k = pick[Math.floor(Math.random() * pick.length)];
    if (k != null) { boxes[k].rattle(); sound.play('rattle', 0, 0.55); }
    rattleIn = 4 + Math.random() * 2;
  }
  // a click each time a box comes round to the front while you spin it
  if (carousel.tick(dt, t, amp) && state.mode === 'ring' && (carousel.held || carousel.calm > 0)) { sound.play('tick'); sound.buzz(4); }
  garden.tick(dt, t, hushed ? amp * 0.15 : amp);
  fx.tick(dt);
  shakeAmt *= Math.pow(0.002, dt);
  if (state.rig) { state.rig.update(dt, amp); state.env.tick(dt); }
  if (home.visible && !frozen) {
    for (const r of Object.values(residents)) r.update(dt, amp);
    // now and then one of them does its moment
    if (state.mode === 'ring' && (momentIn -= dt) <= 0) {
      const all = Object.values(residents);
      all[Math.floor(Math.random() * all.length)]?.play();
      momentIn = 9 + Math.random() * 6;
    }
  }
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i], u = b.userData;
    u.age += dt;
    b.position.y += u.v * dt;
    b.scale.setScalar(u.size * bell(u.age / u.life) + 1e-4);
    if (u.age > u.life) { turntable.remove(b); bursts.splice(i, 1); }
  }
  placeCamera();
  renderer.render(stage, finaleCam || camera);
}

// ------------------------------------------------------------------ boot
async function boot() {
  resize();
  applySky('box', true);
  const fonts = Promise.race([
    Promise.all(['600 100px Fraunces', '700 100px Fraunces', 'italic 500 60px Fraunces', '500 30px "DM Mono"', '400 38px Figtree', '600 38px Figtree'].map((f) => document.fonts.load(f))),
    wait(2.5),
  ]);
  const boxArt = loadBoxArt(); // the model stills printed on the box
  frame();
  await Promise.all([fonts, boxArt]);
  boxes = holders.map(() => new BlindBox());
  renderChip();
  if (foundCount() === SERIES.length) ui.chip.classList.add('complete');
  ui.loading.classList.add('is-done');
  const ready = enterRing(true);
  if (needsAct(state.collection)) showBreak(state.collection.last); // a break is still due from last time
  await ready;
}
boot().catch((err) => {
  console.error(err);
  ui.loadingText.textContent = `The Sprouts could not load (${err?.message || err}). Refresh to try again.`;
});
