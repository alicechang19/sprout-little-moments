// Sharing: the collection card (the whole lineup, from the lineup sheet), drawn here at 1080 x 1350, a shape that
// fits feeds and chats without cropping, and the series-complete Polaroid. Neither carries names. They open in a
// preview with the phone's share sheet, or Download and Copy image on a desktop.
import { SERIES } from './data.js';

const W = 1080, H = 1350;
const INK = '#1b2046', INK_SOFT = '#565c7c';
const SERIF = 'Fraunces, Georgia, serif', MONO = '"DM Mono", ui-monospace, monospace', SANS = 'Figtree, system-ui, sans-serif';
const DROP = 'M17 1C24 9 31 17 31 25.5A14 14 0 0 1 3 25.5C3 17 10 9 17 1Z'; // 34 x 42

const fontsReady = () => Promise.race([
  Promise.all(['600 96px Fraunces', '700 44px Fraunces', '500 26px "DM Mono"', '600 30px Figtree'].map((f) => document.fonts.load(f))),
  new Promise((r) => setTimeout(r, 1500)),
]);

const today = () => new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase();

function canvas() {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  return [c, c.getContext('2d')];
}
function text(g, s, x, y, font, color, { align = 'left', spacing = 0 } = {}) {
  g.font = font; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'alphabetic';
  g.letterSpacing = `${spacing}px`;
  g.fillText(s, x, y);
  g.letterSpacing = '0px';
}
/** The small "Sprout / Little Moments · Series 01" lockup in the top-left corner. */
function lockup(g, color) {
  g.save(); g.translate(84, 78); g.scale(1.15, 1.15); g.fillStyle = '#63cd84'; g.fill(new Path2D(DROP)); g.restore();
  text(g, 'Sprout', 140, 116, `700 46px ${SERIF}`, color);
  text(g, 'LITTLE MOMENTS · SERIES 01', 312, 114, `500 22px ${MONO}`, color, { spacing: 3 });
}
const toBlob = (c) => new Promise((r) => c.toBlob(r, 'image/png'));
/** Mixes two #rrggbb colours: t of `a`, the rest `b`. */
function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `rgb(${x.map((v, i) => Math.round(v * t + y[i] * (1 - t))).join(',')})`;
}

const STILLS = {};
function still(id) {
  STILLS[id] ??= new Promise((done) => { const im = new Image(); im.onload = () => done(im); im.onerror = () => done(null); im.src = `models/web/box/${id}.webp`; });
  return STILLS[id];
}

/** The collection card: the whole lineup, found ones in colour, the rest as silhouettes, on the dawn garden. */
export async function collectionCard(counts) {
  await fontsReady();
  const ims = await Promise.all(SERIES.map((s) => still(s.id)));
  const [c, g] = canvas();
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#a9d6f5'); bg.addColorStop(0.55, '#fde6d3'); bg.addColorStop(1, '#fff1df');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  // hills along the bottom, as on the box
  g.fillStyle = '#9edaa9'; g.fill(new Path2D(`M0 1150 C300 1060 640 1180 1080 1100 V1350 H0Z`));
  g.fillStyle = '#5fbf7a'; g.fill(new Path2D(`M0 1240 C360 1190 700 1290 1080 1230 V1350 H0Z`));
  lockup(g, INK);
  const found = SERIES.filter((s) => counts[s.id]).length;
  text(g, 'Little Moments', 84, 268, `600 92px ${SERIF}`, INK);
  text(g, `${found} OF ${SERIES.length} FOUND`, 88, 326, `500 26px ${MONO}`, INK_SOFT, { spacing: 4 });
  // six tiles, three across
  const tw = 288, th = 360, gap = 24, x0 = (W - (tw * 3 + gap * 2)) / 2, y0 = 384;
  SERIES.forEach((s, i) => {
    const x = x0 + (i % 3) * (tw + gap), y = y0 + Math.floor(i / 3) * (th + gap), n = counts[s.id] || 0, im = ims[i];
    g.fillStyle = n ? mix(s.tint, '#fbf9f4', 0.55) : 'rgba(27,32,70,0.07)';
    g.beginPath(); g.roundRect(x, y, tw, th, 28); g.fill();
    if (im) {
      const ih = 270, iw = (ih * im.width) / im.height, ix = x + (tw - iw) / 2, iy = y + 14;
      if (n) g.drawImage(im, ix, iy, iw, ih);
      else { // silhouette: the still's shape, filled with a faint ink
        const sc = document.createElement('canvas');
        sc.width = Math.ceil(iw); sc.height = ih;
        const sx = sc.getContext('2d');
        sx.drawImage(im, 0, 0, iw, ih);
        sx.globalCompositeOperation = 'source-in'; sx.fillStyle = 'rgba(27,32,70,0.17)'; sx.fillRect(0, 0, sc.width, sc.height);
        g.drawImage(sc, ix, iy);
      }
    }
    text(g, `NO. ${s.no}`, x + tw / 2, y + th - 50, `500 20px ${MONO}`, INK_SOFT, { align: 'center', spacing: 2 });
    text(g, n ? s.name : '???', x + tw / 2, y + th - 18, `600 28px ${SANS}`, n ? INK : INK_SOFT, { align: 'center', spacing: n ? 0 : 3 });
    if (n > 1) {
      g.fillStyle = INK; g.beginPath(); g.roundRect(x + tw - 74, y + 14, 60, 36, 18); g.fill();
      text(g, `×${n}`, x + tw - 44, y + 39, `600 20px ${MONO}`, '#fbf9f4', { align: 'center' });
    }
  });
  text(g, today(), W - 84, 1306, `500 24px ${MONO}`, '#1e4d33', { align: 'right', spacing: 3 });
  return toBlob(c);
}

/**
 * The Series 01 photo, as a Polaroid: the selfie the six took, in a white instant-photo frame with a
 * handwritten caption, the date, and a small stamp teasing Series 02 (which promises nothing more).
 */
export async function polaroidCard(photo, sky = ['#a9d6f5', '#fde6d3']) {
  await Promise.race([Promise.all([fontsReady(), document.fonts.load('600 72px Caveat')]), new Promise((r) => setTimeout(r, 1500))]);
  const [c, g] = canvas();
  g.fillStyle = '#fdfcf8'; g.fillRect(0, 0, W, H);
  // a whisper of paper grain
  for (let i = 0; i < 1600; i++) { g.fillStyle = `rgba(27,32,70,${Math.random() * 0.025})`; g.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
  const px = 70, py = 70, ps = W - 140;
  // the sky they were standing under (the 3D render is see-through where the sky is)
  const air = g.createLinearGradient(0, py, 0, py + ps);
  air.addColorStop(0, sky[0]); air.addColorStop(0.65, sky[1]);
  g.fillStyle = air; g.fillRect(px, py, ps, ps);
  if (photo) g.drawImage(photo, px, py, ps, ps);
  g.strokeStyle = 'rgba(27,32,70,0.08)'; g.lineWidth = 2; g.strokeRect(px, py, ps, ps);
  text(g, 'Series 01 · all six!', W / 2, 1124, `600 78px Caveat, ${SERIF}`, '#2b2f55', { align: 'center' });
  text(g, today(), W / 2, 1182, `500 26px ${MONO}`, INK_SOFT, { align: 'center', spacing: 4 });
  // the stamp, pressed slightly crooked
  g.save(); g.translate(W / 2, 1262); g.rotate(-0.06);
  g.font = `500 26px ${MONO}`; g.letterSpacing = '5px';
  const label = 'SERIES 02 · GROWING', tw = g.measureText(label).width;
  g.strokeStyle = 'rgba(60,154,90,0.85)'; g.lineWidth = 3; g.beginPath(); g.roundRect(-tw / 2 - 22, -34, tw + 44, 56, 8); g.stroke();
  g.fillStyle = 'rgba(60,154,90,0.9)'; g.textAlign = 'center'; g.fillText(label, 0, 3);
  g.letterSpacing = '0px';
  g.restore();
  return c;
}
export const pngOf = toBlob;

// ------------------------------------------------------------------ the preview
const $ = (id) => document.getElementById(id);
const phone = () => matchMedia('(pointer: coarse)').matches;
let current = null;

/**
 * Shows a drawn card with the ways to send it: the share sheet on phones, Download and Copy image on a
 * desktop (and the share sheet there too, where the browser has one).
 */
export function previewShare({ blob, filename, title, text: message, alt }) {
  const dialog = $('share'), img = $('share-img'), status = $('share-status');
  const toast = (msg) => { status.textContent = msg; };
  status.textContent = '';
  const file = new File([blob], filename, { type: 'image/png' });
  const canShare = !!navigator.canShare?.({ files: [file] });
  const canCopy = !!(navigator.clipboard?.write && window.ClipboardItem);
  if (current) URL.revokeObjectURL(current);
  current = URL.createObjectURL(blob);
  img.src = current;
  img.alt = alt;
  $('share-title').textContent = title;
  $('share-native').hidden = !canShare;
  $('share-download').hidden = phone() && canShare; // phones save from the share sheet
  $('share-copy').hidden = phone() || !canCopy;
  $('share-native').onclick = async () => {
    try { await navigator.share({ files: [file], title, text: message }); } catch (err) { if (err?.name !== 'AbortError') toast('Sharing didn’t work here. Try Download instead.'); }
  };
  $('share-download').onclick = () => {
    const a = document.createElement('a');
    a.href = current; a.download = filename;
    document.body.append(a); a.click(); a.remove();
  };
  $('share-copy').onclick = async () => {
    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); toast('Image copied. Paste it anywhere.'); }
    catch { toast('This browser won’t copy images. Try Download instead.'); }
  };
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(() => dialog.classList.add('is-shown'));
  ($('share-native').hidden ? $('share-download').hidden ? $('share-copy') : $('share-download') : $('share-native')).focus();
}

export function closeShare() {
  const dialog = $('share');
  if (!dialog.open) return;
  dialog.classList.remove('is-shown');
  setTimeout(() => dialog.close(), 250);
}
