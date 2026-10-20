// The Series 01 blind box: a paperboard carton with a hinged top and a perforated
// tear strip across the front. The strip runs along the tear line; the band of front
// panel above it belongs to the top, so once it's torn the top swings open on its
// back hinge. Then the walls open part-way like petals and the whole box sinks away, leaving the Sprout standing.
import * as THREE from 'three';
import { SERIES } from './data.js';
import { animate, ease, wait, shadowed, glowTexture, bell } from './util.js';

export const BOX = { W: 1.6, H: 2.0, T: 0.035 };
const BAND = 0.25; // front panel above the tear line, part of the top
const LID_OPEN = 1.95; // swung past upright, leaning back
const LID_CRACK = 0.04; // freed by the tear, lifted just enough to let light out
// a lid bursting open: a big overshoot, then it settles back
const popEase = (p) => { const c = 2.6, c3 = c + 1; return 1 + c3 * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); };
const INK = '#1b2046', LEAF = '#63cd84', PAPER = '#f4f0e6';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function spaced(g, text, x, y, spacing) {
  g.letterSpacing = `${spacing}px`;
  g.fillText(text, x, y);
  g.letterSpacing = '0px';
}

// ------------------------------------------------------------------ print: Garden at dawn
// Every face is drawn in a 200 x 260 design space (as in tools/box-mockups/garden.html), scaled to fill
// the 1024 x 1280 canvas by height and centred. Backgrounds bleed past the sides of the design space.
const DS = 1280 / 260, DX = (1024 - 200 * DS) / 2;
const SKY_INK = '#2c5f8a', MOSS_INK = '#24553a';
const DROP = 'M17 1C24 9 31 17 31 25.5A14 14 0 0 1 3 25.5C3 17 10 9 17 1Z'; // 34 x 42
const SERIF = 'Fraunces, Georgia, serif', MONO = '"DM Mono", ui-monospace, monospace', SANS = 'Figtree, system-ui, sans-serif';

// stills of the six models (rendered from models/blend), loaded once before the box is built
const STILLS = {};
export function loadBoxArt() {
  return Promise.all(SERIES.map((s) => new Promise((done) => {
    const im = new Image();
    im.onload = im.onerror = () => done();
    im.src = `models/web/box/${s.id}.webp`;
    STILLS[s.id] = im;
  })));
}

function face(draw) {
  const [c, g] = canvas(1024, 1280);
  g.setTransform(DS, 0, 0, DS, DX, 0);
  draw(g);
  return tex(c);
}
const fill = (g, d, color) => { g.fillStyle = color; g.fill(new Path2D(d)); };
function ellipse(g, x, y, rx, ry, color, alpha = 1) {
  g.save(); g.globalAlpha = alpha; g.fillStyle = color;
  g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); g.restore();
}
function label(g, text, x, y, font, color, align = 'center', spacing = 0) {
  g.font = font; g.fillStyle = color; g.textAlign = align;
  spaced(g, text, x, y, spacing);
}
function sky(g) {
  const grd = g.createLinearGradient(0, 0, 0, 260);
  grd.addColorStop(0, '#a9d6f5'); grd.addColorStop(0.62, '#fde6d3'); grd.addColorStop(1, '#fff1df');
  g.fillStyle = grd; g.fillRect(-20, 0, 240, 260);
}
function cloud(g, x, y, s = 1, alpha = 1) {
  g.save(); g.translate(x, y); g.scale(s, s);
  for (const [cx, cy, rx, ry] of [[0, 0, 22, 11], [14, -7, 14, 11], [-12, -4, 11, 9]]) ellipse(g, cx, cy, rx, ry, '#fff', alpha);
  g.restore();
}
function sun(g, x, y, r) {
  ellipse(g, x, y, r * 1.55, r * 1.55, '#ffe2a0', 0.35);
  ellipse(g, x, y, r, r, '#ffe2a0');
}
function hills(g, y1, y2) {
  fill(g, `M-20 ${y1} C60 ${y1 - 26} 120 ${y1 + 8} 220 ${y1 - 14} V260 H-20Z`, '#9edaa9');
  fill(g, `M-20 ${y2} C70 ${y2 - 18} 140 ${y2 + 14} 220 ${y2 - 6} V260 H-20Z`, '#5fbf7a');
}
/** A model still standing with its feet at (x, y), h tall. */
function still(g, id, x, y, h) {
  const im = STILLS[id], w = (h * 600) / 760;
  if (im?.naturalWidth) g.drawImage(im, x - w / 2, y - h, w, h);
}

function frontArt() {
  return face((g) => {
    sky(g);
    sun(g, 156, 150, 22);
    cloud(g, 38, 128, 0.8, 0.95);
    // the tear strip covers about y 22-43 here (texture y 108-212), so the print starts below it
    label(g, 'Sprout', 100, 80, `700 40px ${SERIF}`, SKY_INK);
    label(g, 'LITTLE MOMENTS · SERIES 01', 100, 95, `500 6.5px ${MONO}`, SKY_INK, 'center', 1.8);
    // somebody peeking over the hill
    still(g, 'daydream', 100, 268, 170);
    hills(g, 212, 230);
    label(g, 'Who’s growing inside?', 100, 246, `600 10px ${SANS}`, '#fff');
  });
}

function lineupArt() {
  return face((g) => {
    sky(g);
    label(g, 'Collect all six', 100, 64, `700 18px ${SERIF}`, SKY_INK);
    [116, 174, 232].forEach((y, r) => fill(g, `M-20 ${y} C60 ${y - 8} 140 ${y + 8} 220 ${y - 4} V260 H-20Z`, ['#b6e4bf', '#8fd19e', '#5fbf7a'][r]));
    SERIES.forEach((s, i) => {
      const x = i % 2 ? 144 : 56, y = [120, 178, 236][Math.floor(i / 2)];
      still(g, s.id, x, y, 40);
      label(g, `${s.no} ${s.name.toUpperCase()}`, x, y + 11, `500 6px ${MONO}`, '#244d33', 'center', 0.6);
    });
  });
}

/** The second side: one big Sprout sitting on the hill. */
function sproutSideArt() {
  return face((g) => {
    sky(g);
    cloud(g, 40, 78, 0.8, 0.95);
    cloud(g, 164, 108, 0.6, 0.9);
    hills(g, 196, 222);
    still(g, 'daydream', 100, 236, 150);
  });
}

/** The back: the six at home in the garden, each in its own spot. */
function backArt() {
  const trail = (g, d) => {
    const p = new Path2D(d);
    g.lineCap = g.lineJoin = 'round';
    g.strokeStyle = '#f4e3c3'; g.lineWidth = 9; g.stroke(p);
    g.setLineDash([3, 4]); g.strokeStyle = '#e2c99a'; g.lineWidth = 1; g.stroke(p); g.setLineDash([]);
  };
  const tree = (g, x, y, r) => { ellipse(g, x, y, r, r, '#93cf92'); ellipse(g, x - r * 0.3, y - r * 0.3, r * 0.45, r * 0.45, '#a9dba6'); };
  const flowers = (g, pts, color) => pts.forEach(([x, y]) => {
    for (const [dx, dy] of [[-1.4, 0], [1.4, 0], [0, -1.4], [0, 1.4]]) ellipse(g, x + dx, y + dy, 1.4, 1.4, color);
    ellipse(g, x, y, 1, 1, '#ffe2a0');
  });
  const home = (g, id, x, y, h = 32) => { ellipse(g, x, y, h * 0.38, h * 0.1, MOSS_INK, 0.16); still(g, id, x, y, h); };
  return face((g) => {
    g.fillStyle = '#c4e6bd'; g.fillRect(-20, 0, 240, 260);
    label(g, 'Where the Sprouts live', 100, 34, `700 15px ${SERIF}`, MOSS_INK);
    trail(g, 'M100 242 C100 214 112 204 100 184 S70 146 98 124 S160 112 170 80');
    tree(g, 116, 66, 10); tree(g, 22, 122, 9); tree(g, 184, 154, 9); tree(g, 186, 208, 6);
    ellipse(g, 136, 190, 16, 7, '#86bfdc'); ellipse(g, 132, 188, 5, 1.6, '#a9d3e8');
    flowers(g, [[30, 66], [72, 58], [150, 98], [16, 180], [80, 206], [176, 120]], '#f6b8c8');
    flowers(g, [[60, 118], [120, 154], [26, 232], [118, 228]], '#fff4e2');
    // Daydream: a bench in a patch of sun
    ellipse(g, 48, 86, 18, 18, '#fff3c4', 0.7);
    g.fillStyle = '#b07a48'; g.beginPath(); g.roundRect(34, 94, 28, 3, 1.5); g.fill();
    g.fillStyle = '#9a6a3c'; g.fillRect(36, 96, 2, 5); g.fillRect(58, 96, 2, 5);
    home(g, 'daydream', 48, 96);
    // Explore: where the path runs off the top of the garden
    home(g, 'explore', 166, 92);
    // Read: on a tree stump
    ellipse(g, 142, 138, 11, 4, '#9a6a3c'); g.fillStyle = '#b07a48'; g.fillRect(131, 132, 22, 6); ellipse(g, 142, 132, 11, 4, '#d9b07c');
    home(g, 'read', 142, 134);
    // Rest: curled up on a moss bed
    ellipse(g, 56, 166, 22, 8, '#7fbf74'); ellipse(g, 54, 164, 16, 5, '#93cf86');
    home(g, 'rest', 56, 168);
    // Cheer: a little shower of petals
    flowers(g, [[30, 196], [58, 192], [36, 210], [62, 212], [44, 186]], '#f9a8bd');
    home(g, 'cheer', 46, 228);
    // Little Light: a lantern glow
    const glow = g.createRadialGradient(154, 214, 0, 154, 214, 26);
    glow.addColorStop(0, 'rgba(233,255,184,0.9)'); glow.addColorStop(1, 'rgba(233,255,184,0)');
    g.fillStyle = glow; g.fillRect(128, 188, 52, 52);
    g.fillStyle = '#6b5a44'; g.fillRect(171, 198, 2, 30);
    g.fillStyle = '#ffe9a8'; g.strokeStyle = '#6b5a44'; g.lineWidth = 1;
    g.beginPath(); g.roundRect(167, 194, 10, 9, 2); g.fill(); g.stroke();
    home(g, 'light', 152, 230);
    // footer: barcode and collector code
    g.fillStyle = MOSS_INK; g.fillRect(-20, 240, 240, 20);
    g.fillStyle = '#e9f4e3';
    for (let i = 0; i < 18; i++) g.fillRect(14 + i * 3.4, 242, [1, 2, 1, 1.5][i % 4], 16);
    label(g, 'SPR-S01', 186, 252.5, `500 5px ${MONO}`, '#e9f4e3', 'right', 0.8);
  });
}

/** Same crop for a plane. */
function cropPlane(geo, v0, v1) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, v0 + uv.getY(i) * (v1 - v0));
  return geo;
}

/** Crops a box face's UVs to a vertical slice of its texture (v0..v1). */
function cropFace(geo, face, v0, v1) {
  const uv = geo.attributes.uv;
  for (let i = face * 4; i < face * 4 + 4; i++) uv.setY(i, v0 + uv.getY(i) * (v1 - v0));
  uv.needsUpdate = true;
  return geo;
}

function lidArt() {
  const [c, g] = canvas(1024, 1024);
  g.fillStyle = '#cfe6f7';
  g.fillRect(0, 0, 1024, 1024);
  g.save(); g.translate(512 - 85, 512 - 105); g.scale(5, 5); g.globalAlpha = 0.5; g.fillStyle = '#fff'; g.fill(new Path2D(DROP)); g.restore();
  g.fillStyle = 'rgba(44,95,138,0.75)';
  g.textAlign = 'center';
  g.font = `500 30px ${MONO}`;
  spaced(g, 'TEAR THE FRONT STRIP TO OPEN', 512, 860, 5);
  return tex(c);
}

/** The tear strip, pull tab at the left. Transparent outside the tab's rounded end. */
function stripArt(L, tab, h) {
  const W = 2048, H = Math.round((2048 * h) / (L + tab));
  const [c, g] = canvas(W, H);
  const tabPx = (tab / (L + tab)) * W, r = H / 2;
  g.fillStyle = LEAF;
  g.beginPath();
  g.moveTo(r, 0); g.lineTo(W, 0); g.lineTo(W, H); g.lineTo(r, H);
  g.arc(r, r, r, Math.PI / 2, (Math.PI * 3) / 2);
  g.fill();
  // grip ridges on the tab
  g.strokeStyle = 'rgba(27,32,70,0.35)'; g.lineWidth = 5; g.lineCap = 'round';
  for (let i = 0; i < 3; i++) { const x = tabPx * 0.38 + i * 16; g.beginPath(); g.moveTo(x, H * 0.3); g.lineTo(x, H * 0.7); g.stroke(); }
  // fold line where the tab meets the box
  g.setLineDash([6, 8]); g.strokeStyle = 'rgba(27,32,70,0.3)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(tabPx, 8); g.lineTo(tabPx, H - 8); g.stroke(); g.setLineDash([]);
  // perforations along both long edges
  g.fillStyle = PAPER;
  for (let x = tabPx + 14; x < W - 6; x += 22) { g.fillRect(x, 5, 10, 5); g.fillRect(x, H - 10, 10, 5); }
  g.fillStyle = INK;
  g.textBaseline = 'middle';
  g.font = `500 ${Math.round(H * 0.34)}px "DM Mono", ui-monospace, monospace`;
  const words = ['TEAR HERE', '›  ›  ›', 'PULL TO OPEN', '›  ›  ›', 'TEAR HERE', '›  ›  ›'];
  const span = (W - tabPx) / words.length;
  g.textAlign = 'center';
  words.forEach((w, i) => spaced(g, w, tabPx + span * (i + 0.5), H / 2 + 1, 5));
  // same outline as a plain mask, for the unprinted back of the strip
  const [mc, m] = canvas(W, H);
  m.fillStyle = '#000'; m.fillRect(0, 0, W, H);
  m.fillStyle = '#fff';
  m.beginPath(); m.moveTo(r, 0); m.lineTo(W, 0); m.lineTo(W, H); m.lineTo(r, H); m.arc(r, r, r, Math.PI / 2, (Math.PI * 3) / 2); m.fill();
  return { front: tex(c), mask: new THREE.CanvasTexture(mc) };
}

/** Torn cardboard revealed under the strip: corrugated core with ragged paper edges. */
function slitArt() {
  const [c, g] = canvas(1024, 64);
  g.fillStyle = '#8f6440'; g.fillRect(0, 0, 1024, 64);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let x = 0; x < 1024; x += 9) g.fillRect(x, 0, 4, 64);
  g.fillStyle = '#ece1cb';
  for (const top of [true, false]) {
    g.beginPath();
    g.moveTo(0, top ? 0 : 64);
    for (let x = 0; x <= 1024; x += 6) g.lineTo(x, top ? 6 + Math.random() * 9 : 58 - Math.random() * 9);
    g.lineTo(1024, top ? 0 : 64);
    g.fill();
  }
  return tex(c);
}

/** One ray of light leaking from a seam: soft across, fading out along its length. */
function rayArt() {
  const [c, g] = canvas(32, 256);
  const img = g.createImageData(32, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 32; x++) {
    const across = Math.exp(-(((x - 15.5) / 7) ** 2)), along = Math.pow(y / 255, 1.8);
    const i = (y * 32 + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = Math.round(255 * across * along);
  }
  g.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

function innerArt() {
  const [c, g] = canvas(512, 640);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 512, 640);
  g.fillStyle = 'rgba(0,0,0,0.07)';
  for (let y = 24; y < 640; y += 48) for (let x = (y / 48) % 2 ? 24 : 48; x < 512; x += 48) { g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill(); }
  return tex(c);
}

// the tear strip: length along the front, height, and the pull tab past the box edge
const STRIP = { L: BOX.W - 0.06, h: 0.13, tab: 0.14 };

// every box carries the same print, so the artwork is drawn once and shared between them
let PRINT = null;
function printed() {
  if (PRINT) return PRINT;
  const top = lidArt();
  top.center.set(0.5, 0.5);
  top.rotation = Math.PI; // the back wall's frame faces the other way
  const material = (map) => new THREE.MeshStandardMaterial({ map, roughness: 0.82 });
  // the lineup faces right, the side you see first; one big Sprout sits on the left
  PRINT = {
    front: material(frontArt()), back: material(backArt()), right: material(lineupArt()), left: material(sproutSideArt()), top: material(top),
    innerMap: innerArt(), strip: stripArt(STRIP.L, STRIP.tab, STRIP.h), ray: rayArt(), glow: glowTexture(),
    slit: new THREE.MeshStandardMaterial({ map: slitArt(), roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  };
  return PRINT;
}

export class BlindBox {
  constructor() {
    const { W, H, T } = BOX;
    const art = printed();
    this.group = new THREE.Group();
    this.edge = new THREE.MeshStandardMaterial({ color: 0xe7e0d0, roughness: 0.9 });
    this.inner = new THREE.MeshStandardMaterial({ color: 0xdfe9df, roughness: 0.95, map: art.innerMap });

    this.base = new THREE.Mesh(new THREE.BoxGeometry(W, T, W), [this.edge, this.edge, this.inner, this.edge, this.edge, this.edge]);
    this.base.position.y = T / 2;
    this.group.add(this.base);

    this.panels = [];
    const sides = [
      { name: 'front', ry: 0, pos: [0, T, W / 2], w: W },
      { name: 'right', ry: Math.PI / 2, pos: [W / 2, T, 0], w: W - 2 * T },
      { name: 'back', ry: Math.PI, pos: [0, T, -W / 2], w: W },
      { name: 'left', ry: -Math.PI / 2, pos: [-W / 2, T, 0], w: W - 2 * T },
    ];
    const frontH = H - BAND;
    for (const s of sides) {
      const pivot = new THREE.Group();
      pivot.rotation.order = 'YXZ';
      pivot.rotation.y = s.ry;
      pivot.position.set(...s.pos);
      // the front panel stops at the tear line; its top band travels with the lid
      const h = s.name === 'front' ? frontH : H;
      const geo = new THREE.BoxGeometry(s.w, h, T);
      if (s.name === 'front') cropFace(geo, 4, 0, frontH / H);
      const mesh = new THREE.Mesh(geo, [this.edge, this.edge, this.edge, this.edge, art[s.name], this.inner]);
      mesh.position.set(0, h / 2, -T / 2);
      pivot.add(mesh);
      this.group.add(pivot);
      this.panels.push(pivot);
    }

    // perforated tear strip across the top of the front panel, pull tab on the left
    const front = this.panels[0];
    const { L, h, tab } = STRIP, y = frontH;
    this.tear = { L, h, tab, p: 0, done: false, ticks: 0 };
    // torn cardboard, split along the tear line: bottom half on the panel, top half on the lid's band
    const slitMat = art.slit;
    const sh = h * 0.36;
    const slitLo = new THREE.Mesh(cropPlane(new THREE.PlaneGeometry(L, sh), 0, 0.5), slitMat);
    slitLo.position.set(0, y - sh / 2, 0.002);
    front.add(slitLo);
    const stripGeo = new THREE.PlaneGeometry(L + tab, h, 140, 1);
    stripGeo.translate((L + tab) / 2 - tab, 0, 0); // local x = distance along the strip from the box edge; tab is x < 0
    this.stripBase = stripGeo.attributes.position.array.slice();
    this.strip = new THREE.Mesh(stripGeo, new THREE.MeshStandardMaterial({
      map: art.strip.front, roughness: 0.6, alphaTest: 0.5,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    this.strip.name = 'tear_strip';
    // the back of the strip is unprinted, which is what you see once it folds back
    const back = new THREE.Mesh(stripGeo, new THREE.MeshStandardMaterial({
      color: 0x55bd76, alphaMap: art.strip.mask, roughness: 0.75, alphaTest: 0.5, side: THREE.BackSide,
    }));
    back.name = 'tear_strip';
    this.strip.add(back);
    this.stripHome = new THREE.Vector3(-L / 2, y, 0.005);
    this.strip.position.copy(this.stripHome);
    front.add(this.strip);

    // hinged top, part of the carton: it hangs off the top edge of the back wall.
    // In the back wall's frame, local -z points into the box and +x opens it.
    const backWall = this.panels[2];
    this.lid = new THREE.Group();
    this.lid.position.set(0, H, 0);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(W, T, W), [this.edge, this.edge, art.top, this.inner, this.edge, this.edge]);
    plate.position.set(0, T / 2, -W / 2);
    const band = new THREE.Mesh(cropFace(new THREE.BoxGeometry(W, BAND + T, T), 5, frontH / H, 1),
      [this.edge, this.edge, this.edge, this.edge, this.inner, art.front]);
    band.position.set(0, (T - BAND) / 2, -W + T / 2);
    const slitHi = new THREE.Mesh(cropPlane(new THREE.PlaneGeometry(L, sh), 0.5, 1), slitMat);
    slitHi.rotation.y = Math.PI;
    slitHi.position.set(0, -BAND + sh / 2, -W - 0.002);
    this.lid.add(plate, band, slitHi);
    backWall.add(this.lid);

    // light leaking out once the lid is freed: a glowing seam along the tear, a halo, and for the rare tell
    // (or a fake-out) rays fanning up from it; all on the front panel, so they fall away with it
    const additive = (extra) => ({ transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, ...extra });
    this.seam = new THREE.Mesh(new THREE.PlaneGeometry(W, 0.05), new THREE.MeshBasicMaterial(additive({ color: 0xfff2c8 })));
    this.seam.position.set(0, frontH + 0.012, 0.008);
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial(additive({ map: art.glow, color: 0xfff2c8 })));
    this.halo.position.set(0, frontH + 0.08, 0.3);
    this.halo.scale.set(W * 2.6, 1.3, 1);
    this.rays = new THREE.Group();
    this.rays.position.set(0, frontH + 0.01, 0.02);
    this.rays.rotation.x = 0.42; // leaning out toward you
    const rayMat = new THREE.MeshBasicMaterial(additive({ map: art.ray, color: 0xdfe4ff, side: THREE.DoubleSide }));
    const rayGeo = new THREE.PlaneGeometry(0.2, 2.2).translate(0, 1.1, 0);
    for (let i = 0; i < 11; i++) {
      const u = i / 10 - 0.5, r = new THREE.Mesh(rayGeo, rayMat);
      r.position.x = u * W * 0.9;
      r.rotation.z = -u * 1.7 + Math.sin(i * 7.3) * 0.12;
      r.scale.y = 0.75 + 0.4 * Math.abs(Math.sin(i * 3.1));
      this.rays.add(r);
    }
    this.leakLight = new THREE.PointLight(0xfff2c8, 0, 6, 2);
    this.leakLight.position.set(0, frontH + 0.15, 0.45);
    front.add(this.seam, this.halo, this.rays, this.leakLight);
    this.present = 0;

    shadowed(this.group);
    this.strip.receiveShadow = false;
    slitLo.castShadow = slitHi.castShadow = false;
    for (const o of [this.seam, this.halo, ...this.rays.children]) {
      o.castShadow = o.receiveShadow = false;
      o.raycast = () => {}; // light, not cardboard: taps go through it to the tab
    }
    this.reset();
  }

  /**
   * Where the pointer sits along the strip, as a fraction of its length (can run past 1).
   * Measured in screen space so it works at any box angle.
   */
  pointerAlongStrip(ndc, camera) {
    const a = this.strip.localToWorld(new THREE.Vector3(0, 0, 0)).project(camera);
    const b = this.strip.localToWorld(new THREE.Vector3(this.tear.L, 0, 0)).project(camera);
    const asp = camera.aspect;
    const abx = (b.x - a.x) * asp, aby = b.y - a.y;
    return (((ndc.x - a.x) * asp) * abx + (ndc.y - a.y) * aby) / (abx * abx + aby * aby);
  }

  /** Can a drag start at this hit? Only on the tab or what's already peeled, not ahead of the tear. */
  canGrab(hit) {
    if (hit?.object.name !== 'tear_strip' || this.tear.done) return false;
    const local = this.strip.worldToLocal(hit.point.clone());
    return local.x < this.tear.p * this.tear.L + 0.16 || local.z > 0.02;
  }

  /**
   * The peeled strip folds back over itself, so the tab ends up ahead of the tear front.
   * Solve for the tear front that puts the tab under the pointer.
   */
  pullTo(s, max = 1) {
    const { L, tab } = this.tear;
    this.setTear(Math.min(max, (s * L - 0.8 * tab) / 1.8 / L), true);
  }

  /** Where the tear has got to, in world space. */
  tearFront(out = new THREE.Vector3()) {
    return this.strip.localToWorld(out.set(this.tear.p * this.tear.L, 0, 0.03));
  }

  /** Once a flick starts it, the rest of the strip rips in one quick, accelerating zip. `onTooth` per perforation. */
  rip(onTooth) {
    const p0 = this.tear.p;
    if (p0 >= 1) return Promise.resolve();
    let last = this.tear.ticks;
    return animate(0.08 + 0.4 * (1 - p0), (e) => {
      this.setTear(p0 + (1 - p0) * e);
      if (this.tear.ticks > last) { last = this.tear.ticks; onTooth?.(this.tearFront()); }
    }, ease.in);
  }

  /** The tab pops out a little further, to say "pull me". */
  presentTab() {
    return animate(0.75, (e, p) => { this.present = bell(p) * (1 - p * 0.3); }, ease.linear).then(() => { this.present = 0; });
  }

  setTear(p, haptic = false) {
    const t = this.tear;
    t.p = Math.max(t.p, THREE.MathUtils.clamp(p, 0, 1));
    // a tiny tick for each perforation, where phones support it
    const ticks = Math.floor(t.p * 28);
    if (ticks > t.ticks) {
      t.ticks = ticks;
      // only while a finger is actually pulling; browsers refuse vibration without a gesture
      if (haptic) try { navigator.vibrate?.(4); } catch { /* not allowed here */ }
    }
  }

  /** Bends the strip: flat ahead of the tear, curled back over itself behind it. */
  updateStrip(t) {
    if (!this.strip.visible) return;
    const { L, p } = this.tear;
    const pos = this.strip.geometry.attributes.position, base = this.stripBase;
    const ap = p * L, R = 0.06, thMax = 2.5, arc = R * thMax;
    const cx = -Math.cos(thMax), cz = Math.sin(thMax);
    const endX = ap - R * Math.sin(thMax), endZ = R * (1 - Math.cos(thMax));
    const peel = Math.min(1, p / 0.035);
    // before the first pull, the tab lifts now and then to invite a tug
    const invite = p === 0 ? 0.28 * Math.pow(Math.max(0, Math.sin(t * 2.1)), 8) : 0;
    const rest = 0.42 + invite + 0.8 * this.present;
    for (let i = 0; i < pos.count; i++) {
      const a = base[i * 3], y = base[i * 3 + 1];
      let x = a, z = 0, yy = y;
      if (a < 0) { x = a * Math.cos(rest); z = -a * Math.sin(rest); }
      if (a < ap && peel > 0) {
        const d = ap - a;
        let px, pz, py = y;
        if (d <= arc) { const th = d / R; px = ap - R * Math.sin(th); pz = R * (1 - Math.cos(th)); }
        else { const e = d - arc; px = endX + e * cx; pz = endZ + e * cz; py = y - 0.05 * e * e; }
        x += (px - x) * peel; z += (pz - z) * peel; yy += (py - yy) * peel;
      }
      pos.setXYZ(i, x, yy, z);
    }
    pos.needsUpdate = true;
    this.strip.geometry.computeVertexNormals();
    this.strip.geometry.computeBoundingSphere();
  }

  async detachStrip() {
    if (!this.strip.visible) return;
    this.tear.done = true;
    const p0 = this.strip.position.clone();
    await animate(0.45, (e) => {
      this.strip.position.set(p0.x + 0.7 * e, p0.y + 0.5 * e - 1.4 * e * e, p0.z + 0.6 * e);
      this.strip.rotation.z = -1.4 * e;
      this.strip.rotation.y = 0.8 * e;
      this.strip.scale.setScalar(Math.max(1e-4, 1 - e * e));
    }, ease.linear);
    this.strip.visible = false;
  }

  setInnerTint(hex) { this.inner.color.set(hex); }

  /** Light through the seams: `a` from 0 to 1, its colour, and how strongly it fans out in rays. */
  setLeak(a, color = 0xfff2c8, rays = 0) {
    this.seam.material.color.set(color);
    this.seam.material.opacity = a;
    this.halo.material.color.set(color);
    this.halo.material.opacity = a * 0.55;
    this.rays.children[0].material.color.set(color);
    this.rays.children[0].material.opacity = a * rays * 0.6;
    this.rays.visible = a * rays > 0.005;
    this.leakLight.color.set(color);
    this.leakLight.intensity = a * (rays ? 9 : 3);
  }

  /** The freed lid lifts a crack and holds. */
  crack() { return animate(0.4, (e) => { this.lid.rotation.x = LID_CRACK * e; }, ease.out); }

  /** A shiver, small or big, as if something inside is pushing. */
  tremble(k = 1) {
    return animate(0.46, (e, p) => {
      const d = 1 - p;
      this.group.rotation.z = 0.028 * k * Math.sin(p * Math.PI * 7) * d;
      this.group.rotation.x = 0.012 * k * Math.sin(p * Math.PI * 5 + 1) * d;
      this.lid.rotation.x = LID_CRACK * (1 + 0.6 * k * Math.abs(Math.sin(p * Math.PI * 4)) * d);
    }, ease.linear).then(() => { this.group.rotation.set(0, 0, 0); this.lid.rotation.x = LID_CRACK; });
  }

  /** The lid bursts back on its hinge, overshooting before it settles. */
  popLid() {
    const r0 = this.lid.rotation.x;
    return animate(0.55, (e) => { this.lid.rotation.x = r0 + (LID_OPEN - r0) * e; }, popEase);
  }

  /**
   * The walls open part-way like petals (the top rides along with the back one), sway once, then unfold further
   * as the whole box shrinks and sinks away under the Sprout.
   */
  fallWalls() {
    const lid0 = this.lid.rotation.x, P = this.panels;
    const OPEN = 1.05, LID = LID_OPEN - 0.55;
    return Promise.all(P.map((p, i) => wait(i * 0.06).then(() => animate(0.7, (e) => {
      p.rotation.x = OPEN * e;
      if (p === P[2]) this.lid.rotation.x = lid0 + (LID - lid0) * e;
    }, ease.outBack))))
      .then(() => animate(0.35, (e, q) => { // the breath: the petals sway open a touch and back
        P.forEach((p, i) => { p.rotation.x = OPEN + 0.06 * Math.sin(Math.PI * q) * (i % 2 ? 1 : 0.7); });
      }, ease.linear))
      .then(() => animate(0.6, (e) => {
        P.forEach((p) => { p.rotation.x = OPEN + 0.45 * e; });
        this.lid.rotation.x = LID + 0.3 * e;
        this.group.position.y = -0.35 * e;
        this.group.scale.setScalar(Math.max(1e-4, 1 - e));
      }, ease.in))
      .then(() => { this.group.visible = false; });
  }

  reset() {
    this.panels.forEach((p) => { p.rotation.x = 0; });
    this.lid.rotation.set(0, 0, 0);
    Object.assign(this.tear, { p: 0, done: false, ticks: 0 });
    this.strip.visible = true;
    this.strip.position.copy(this.stripHome);
    this.strip.rotation.set(0, 0, 0);
    this.strip.scale.setScalar(1);
    this.updateStrip(0);
    this.inner.color.set(0xdfe9df);
    this.setLeak(0);
    this.present = 0;
    this.group.position.set(0, 0, 0);
    this.group.rotation.set(0, 0, 0);
    this.group.scale.setScalar(1);
    this.group.visible = true;
  }

  /** Drops into its place: a fall, a squash on landing, a springy recovery. */
  async drop(onLand) {
    this.group.position.y = 2.6;
    await animate(0.62, (e) => { this.group.position.y = 2.6 * (1 - e); }, ease.in);
    this.group.position.y = 0;
    onLand?.();
    await animate(0.5, (e, p) => {
      const s = 0.13 * Math.sin(p * Math.PI * 1.6) * (1 - p);
      this.group.scale.set(1 + s * 0.5, 1 - s, 1 + s * 0.5);
    }, ease.linear);
    this.group.scale.setScalar(1);
  }

  /** Something inside knocks about: a quick shiver and a tiny hop. */
  async rattle() {
    const r0 = this.group.rotation.z;
    await animate(0.42, (e, p) => {
      this.group.rotation.z = r0 + 0.045 * Math.sin(p * Math.PI * 7) * (1 - p);
      this.group.position.y = 0.035 * Math.abs(Math.sin(p * Math.PI * 3.5)) * (1 - p);
    }, ease.linear);
    this.group.rotation.z = r0;
    this.group.position.y = 0;
  }

  /** Not this one: a wriggle, then it sinks into the soil. `onSink` fires as it starts to go down. */
  async burrow(onSink) {
    await animate(0.34, (e, p) => { this.group.rotation.z = 0.07 * Math.sin(p * Math.PI * 5); }, ease.linear);
    this.group.rotation.z = 0;
    onSink?.();
    await animate(0.62, (e) => {
      this.group.position.y = -BOX.H * 1.15 * e;
      this.group.scale.set(1 - 0.12 * e, 1, 1 - 0.12 * e);
    }, ease.in);
    this.group.visible = false;
  }

  async wobble() {
    const r0 = this.group.rotation.z;
    await animate(0.45, (e, p) => { this.group.rotation.z = r0 + 0.035 * Math.sin(p * Math.PI * 4) * (1 - p); }, ease.linear);
  }

  /** Box leaves before the next one arrives. */
  async clear() {
    await animate(0.5, (e) => { this.group.scale.setScalar(Math.max(1e-4, 1 - e)); }, ease.in);
    this.group.scale.setScalar(1);
    this.reset();
  }
}
