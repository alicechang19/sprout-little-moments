// After the first box, each new one asks for a five-minute break first, with a small task that goes with the
// Sprout you just opened. Each break opens exactly one more box. The break takes the whole screen, washed in that
// Sprout's sky, and the timer is the sky's sun (a moon for Rest, a star for Little Light) crossing from one side
// to the other. Before it starts there's only "Start my break"; once it's running, "Close for now" goes back to
// the Sprout and a small timer takes the place of "Open another box". The timer is saved, so it outlasts a
// reload. When it runs out there's a soft chime, the screen fades and the next box comes out on its own; the tab
// title says so if they're elsewhere. ?break=10 makes every break 10 seconds long, for testing.
import { BY_ID } from './data.js';
import { isDark } from './util.js';

export const FREE_BOXES = 1;
const testSeconds = Number(new URLSearchParams(location.search).get('break'));
const FULL_SECONDS = 5 * 60, BREAK_SECONDS = testSeconds > 0 ? testSeconds : FULL_SECONDS;

// body: what crosses the sky. extra: something small from the Sprout's own scene. sun: [core, glow] if not the usual.
const BREAKS = {
  daydream: {
    title: 'Time to daydream', body: 'sun', extra: 'clouds',
    task: 'Get a glass of water, find a window or step outside, and look at the sky. Let your mind wander wherever it likes.',
  },
  read: {
    title: 'Time to read', body: 'sun', extra: 'birds', sun: ['#efa94e', '#ffd9a0'],
    task: 'Read something just for fun: a few pages of a book, a poem, or that article you saved for later.',
  },
  rest: {
    title: 'Time to rest', body: 'moon', extra: 'stars',
    task: 'Step away from your screen. Close your eyes, take a few slow breaths, and let your shoulders drop.',
  },
  explore: {
    title: 'Time to explore', body: 'sun', extra: 'hills',
    task: 'Take a short walk somewhere a little different, and notice one thing you’ve never noticed before.',
  },
  cheer: {
    title: 'Time to cheer someone on', body: 'sun', extra: 'sparkles', sun: ['#f39a7c', '#ffd0bf'],
    task: 'Send a teammate a quick thank-you, or celebrate one of their wins out loud.',
  },
  light: {
    title: 'Time to find a little light', body: 'star', extra: 'stars',
    task: 'Step into some daylight or open the blinds, and think of one bright spot in your day.',
  },
};

const opened = (c) => Object.values(c.counts).reduce((a, b) => a + b, 0);
/** True when the next box needs a break first. */
export const needsAct = (c) => opened(c) >= FREE_BOXES + (c.unlocks || 0);

// ------------------------------------------------------------------ the timer
const TITLE = document.title;
const READY_TITLE = 'Your box is ready · Sprout';
/** Whole seconds left on the break, 0 once it's over, null if none has started. */
// Under ?break, a break counts from when it started, so a five-minute one that's already running ends early.
const endsAt = (p) => (testSeconds > 0 ? Math.min(p.endsAt, (p.startedAt ?? p.endsAt - FULL_SECONDS * 1000) + BREAK_SECONDS * 1000) : p.endsAt);
const secondsLeft = (c) => (c.pause ? Math.max(0, Math.ceil((endsAt(c.pause) - Date.now()) / 1000)) : null);
const clockText = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const clockLabel = (s) => {
  const m = Math.floor(s / 60), r = s % 60;
  const part = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  return `${[m && part(m, 'minute'), r && part(r, 'second')].filter(Boolean).join(' ') || '0 seconds'} left`;
};

let audio = null; // unlocked by the click that starts the break; after a reload there's no chime, only the title
function chime() {
  if (!audio) return;
  const now = audio.currentTime;
  [[784, 0], [1047, 0.18]].forEach(([hz, at]) => {
    const osc = audio.createOscillator(), gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = hz;
    gain.gain.setValueAtTime(0.0001, now + at);
    gain.gain.exponentialRampToValueAtTime(0.12, now + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 1.6);
    osc.connect(gain).connect(audio.destination);
    osc.start(now + at);
    osc.stop(now + at + 1.7);
  });
}

let ctx = null; // { dialog, collection, save, onReady, sprout, pills }
let watch = 0;
function stopWatching() {
  clearInterval(watch);
  document.removeEventListener('visibilitychange', check);
}
function check() {
  const s = secondsLeft(ctx.collection);
  if (s === null) return stopWatching();
  if (s) tick(s);
  else end(true);
}
/** Watches a running break, with the screen open or not. */
function arm() {
  stopWatching();
  const s = secondsLeft(ctx.collection);
  onBreak(!!s);
  if (s === null) return;
  if (s === 0) return end(false); // it ran out while the page was closed
  tick(s);
  watch = setInterval(check, 1000);
  // hidden tabs run timers late, so check again the moment they come back
  document.addEventListener('visibilitychange', check);
}
/** The break is over: it counts as one more box, and the app brings that box out. */
async function end(live) {
  stopWatching();
  const c = ctx.collection;
  delete c.pause;
  c.unlocks = (c.unlocks || 0) + 1;
  ctx.save();
  if (live) {
    chime();
    if (!document.hasFocus()) {
      document.title = READY_TITLE;
      addEventListener('focus', () => { document.title = TITLE; }, { once: true });
    }
  }
  await hide();
  onBreak(false);
  ctx.onReady();
}
/** While a break runs, the small timers stand in for "Open another box" (see .on-break in index.html). */
function onBreak(on) {
  document.documentElement.classList.toggle('on-break', on);
}

// ------------------------------------------------------------------ the sky
const sparkle = (x, y, r, fill) => `<path d="M${x} ${y - r}Q${x + r * .18} ${y - r * .18} ${x + r} ${y}Q${x + r * .18} ${y + r * .18} ${x} ${y + r}Q${x - r * .18} ${y + r * .18} ${x - r} ${y}Q${x - r * .18} ${y - r * .18} ${x} ${y - r}Z" fill="${fill}"/>`;
const cloud = (x, y, k, o) => `<g fill="#fff" opacity="${o}"><ellipse cx="${x}" cy="${y}" rx="${46 * k}" ry="${17 * k}"/><ellipse cx="${x + 26 * k}" cy="${y - 11 * k}" rx="${30 * k}" ry="${20 * k}"/><ellipse cx="${x - 22 * k}" cy="${y - 6 * k}" rx="${22 * k}" ry="${14 * k}"/></g>`;
const bodyColors = (b, night) => b.sun || (b.body === 'moon' ? [night ? '#c9c4f2' : '#8b84cf', '#ffffff'] : b.body === 'star' ? ['#ffe9a8', '#ffe9a8'] : ['#f8cf6a', '#ffe7a6']);
const isNight = (sprout) => sprout === 'light' || isDark();
const breakFor = (sprout) => BREAKS[sprout] ?? BREAKS.daydream;

/** Where the sun's path sits, measured from the laid-out screen: centred on the horizon line. */
let geo = null;
function layout() {
  const { dialog } = ctx;
  const W = dialog.clientWidth;
  let r = Math.max(120, Math.min(W / 2 - 30, 430, dialog.clientHeight * 0.5)); // room for the sun's glow at the edges
  const size = () => {
    dialog.style.setProperty('--r', `${r}px`);
    dialog.classList.toggle('is-compact', r < 330); // too narrow for the title to fit under the sun's path
  };
  size();
  // on short screens, shrink the path until everything fits (the stage is about 1.2 r tall)
  const over = dialog.scrollHeight - dialog.clientHeight;
  if (over > 0 && r > 240) { r = Math.max(240, r - over / 1.2); size(); }
  const H = Math.max(dialog.clientHeight, dialog.scrollHeight);
  const cy = dialog.querySelector('.break-horizon').getBoundingClientRect().top - dialog.getBoundingClientRect().top + dialog.scrollTop;
  geo = { W, H, cx: W / 2, cy, r, k: Math.max(0.55, Math.min(1, r / 430)) };
}

/** Draws the sky for this Sprout; `place` then moves the sun along it. */
function drawSky(sprout) {
  const b = breakFor(sprout);
  const night = isNight(sprout);
  const fg = night ? '#eef0f7' : '#1b2046';
  const [core, glow] = bodyColors(b, night);
  const { W, H, cx, cy, r, k } = geo;
  const o = night ? 0.14 : 0.8; // clouds barely show at night
  let extra = '';
  if (b.extra === 'clouds') extra = cloud(W * .14, H * .2, k * 1.4, o) + cloud(W * .86, H * .3, k * 1.1, o) + cloud(W * .7, H * .1, k * .8, o);
  if (b.extra === 'birds') {
    extra = [[.2, .22, 1], [.24, .19, .8], [.8, .26, .9]].map(([x, y, s]) => {
      const u = 19 * s * k;
      return `<path d="M${W * x - u} ${H * y}q${u / 2} ${-u * .58} ${u} 0q${u / 2} ${-u * .58} ${u} 0" fill="none" stroke="${fg}" stroke-opacity=".35" stroke-width="2.2" stroke-linecap="round"/>`;
    }).join('');
  }
  if (b.extra === 'stars') extra = [[.1, .14, 7], [.2, .32, 4], [.33, .12, 5], [.62, .08, 4], [.78, .2, 7], [.9, .1, 4], [.86, .38, 5], [.12, .48, 4]].map(([x, y, s]) => sparkle(W * x, H * y, s * k * 1.4, '#ffffff')).join('');
  if (b.extra === 'sparkles') extra = [[.16, .2, 9, '#f39a7c'], [.24, .36, 5, '#5fcb80'], [.82, .16, 7, '#f6c453'], [.88, .34, 10, '#f39a7c'], [.74, .4, 5, '#5fcb80']].map(([x, y, s, c]) => sparkle(W * x, H * y, s * k * 1.5, c)).join('');
  if (b.extra === 'hills') extra = `<path d="M0 ${cy} Q${W * .12} ${cy - 70 * k} ${W * .26} ${cy - 20 * k} T${W * .5} ${cy - 10 * k} T${W * .78} ${cy - 40 * k} T${W} ${cy - 20 * k} V${cy}Z" fill="#9fcf7a" opacity="${night ? .22 : .45}"/>`;
  let marker;
  if (b.body === 'moon') {
    marker = `<mask id="break-moon"><circle r="${26 * k}" fill="#fff"/><circle cx="${12 * k}" cy="${-7 * k}" r="${22 * k}" fill="#000"/></mask>
      <circle r="${48 * k}" fill="${glow}" opacity="${night ? .12 : .55}"/><circle r="${26 * k}" fill="${core}" mask="url(#break-moon)"/>`;
  } else if (b.body === 'star') marker = `<circle r="${50 * k}" fill="${glow}" opacity=".18"/><circle r="${28 * k}" fill="${glow}" opacity=".25"/>${sparkle(0, 0, 22 * k, core)}`;
  else marker = `<circle r="${50 * k}" fill="${glow}" opacity=".5"/><circle r="${26 * k}" fill="${core}"/>`;
  const arc = `M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const w = 3 * Math.max(k, .8);
  const svg = ctx.dialog.querySelector('.break-art');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.style.height = `${H}px`;
  svg.innerHTML = `${extra}
    <line x1="0" y1="${cy}" x2="${W}" y2="${cy}" stroke="${fg}" stroke-opacity=".12" stroke-width="1.5"/>
    <path d="${arc}" fill="none" stroke="${fg}" stroke-opacity=".22" stroke-width="${w}" stroke-dasharray="1 ${4 * w}" stroke-linecap="round"/>
    <path class="crossed" d="${arc}" fill="none" stroke="${core}" stroke-width="${w * 4 / 3}" stroke-linecap="round" stroke-dasharray="${Math.PI * r}"/>
    <g class="marker">${marker}</g>`;
}
/** Moves the sun to how far the break has gone (0 at the start, 1 at the end). */
function place(p) {
  const svg = ctx.dialog.querySelector('.break-art');
  if (!geo || !svg?.firstChild) return;
  const { cx, cy, r } = geo, a = Math.PI * (1 - p);
  svg.querySelector('.crossed').style.strokeDashoffset = Math.PI * r * (1 - p);
  svg.querySelector('.marker').setAttribute('transform', `translate(${cx + r * Math.cos(a)} ${cy - r * Math.sin(a)})`);
}

// ------------------------------------------------------------------ the break screen
const sproutFor = () => ctx.collection.pause?.sprout ?? ctx.sprout;

function draw() {
  const { dialog, collection } = ctx;
  const s = secondsLeft(collection);
  const sprout = sproutFor();
  const { title, task } = breakFor(sprout);
  const sky = (BY_ID[sprout] ?? BY_ID.daydream).sky[isDark() ? 'dark' : 'light'];
  dialog.style.setProperty('--sky-top', sky[0]);
  dialog.style.setProperty('--sky-bottom', sky[1]);
  dialog.classList.toggle('is-night', isNight(sprout));
  dialog.innerHTML = `<svg class="break-art" aria-hidden="true"></svg>
    <div class="break-body">
      <div class="break-stage">
        <div class="break-head">
          <p class="eyebrow">Before your next box</p>
          <h2 id="act-title">${title}</h2>
        </div>
        <span class="break-clock" role="timer" tabindex="-1"></span>
      </div>
      <div class="break-horizon"></div>
      <div class="break-foot">
        <p class="break-task">${task}</p>
        <p class="break-note">${s === null ? 'Take five minutes away from the screen.' : 'Your next box will be ready when the five minutes are up.'}</p>
        ${s === null ? '<button type="button" class="btn primary" data-act="start">Start my break</button>'
          : '<button type="button" class="break-close" data-act="close">Close for now</button>'}
      </div>
    </div>`;
  layout();
  drawSky(sprout);
  tick(s ?? BREAK_SECONDS);
  (s === null ? dialog.querySelector('[data-act=start]') : dialog.querySelector('.break-clock')).focus();
}
function tick(s) {
  const p = 1 - s / BREAK_SECONDS;
  const time = ctx.dialog.querySelector('.break-clock');
  if (time) {
    time.textContent = clockText(s);
    time.setAttribute('aria-label', clockLabel(s));
    place(p);
  }
  const r = 17, L = Math.PI * r, a = Math.PI * (1 - p);
  for (const pill of ctx.pills) {
    pill.querySelector('b').textContent = clockText(s);
    pill.setAttribute('aria-label', `${clockLabel(s)} until your next box. Show the break.`);
    pill.querySelector('.crossed').style.strokeDashoffset = L * (1 - p);
    pill.querySelector('.dot').setAttribute('cx', 20 + r * Math.cos(a));
    pill.querySelector('.dot').setAttribute('cy', 21 - r * Math.sin(a));
  }
}

let hiding = null;
function hide() {
  const { dialog } = ctx;
  if (!dialog.open) return Promise.resolve();
  dialog.classList.remove('is-shown');
  hiding ??= new Promise((resolve) => setTimeout(() => { dialog.close(); hiding = null; resolve(); }, 400));
  return hiding;
}

/** Fills in a small timer: a tiny sun path, the time left, and "until your next box". */
function pillMarkup(pill) {
  const L = Math.PI * 17;
  pill.innerHTML = `<svg viewBox="0 0 40 24" aria-hidden="true">
      <path d="M3 21 A17 17 0 0 1 37 21" fill="none" stroke="currentColor" stroke-opacity=".22" stroke-width="2" stroke-dasharray="1 4" stroke-linecap="round"/>
      <path class="crossed" d="M3 21 A17 17 0 0 1 37 21" fill="none" stroke="var(--sun)" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${L}" stroke-dashoffset="${L}"/>
      <circle class="dot" cx="3" cy="21" r="4.5" fill="var(--sun)"/></svg>
    <b>5:00</b><span>until your next box</span>`;
  pill.addEventListener('click', () => showBreak());
}
const tintPills = (sprout) => {
  for (const pill of ctx.pills) pill.style.setProperty('--sun', bodyColors(breakFor(sprout), false)[0]);
};

/**
 * Wires up the break screen and the small timers (`pills`). `onReady` runs once a break is over (also when one
 * ran out while the page was closed), after the collection has its new unlock.
 */
export function setupBreaks({ dialog, collection, save, onReady, pills = [] }) {
  ctx = { dialog, collection, save, onReady, sprout: null, pills };
  pills.forEach(pillMarkup);
  dialog.addEventListener('click', (e) => {
    const what = e.target.closest('[data-act]')?.dataset.act;
    if (what === 'close') hide();
    if (what !== 'start' || secondsLeft(collection) !== null) return;
    // this click is what lets the page play the chime later
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    audio.resume();
    collection.pause = { sprout: ctx.sprout, startedAt: Date.now(), endsAt: Date.now() + BREAK_SECONDS * 1000 };
    save();
    tintPills(ctx.sprout);
    arm();
    draw();
  });
  // Escape closes it too: there's no button before the break starts, but the keyboard is never stuck
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); hide(); });
  addEventListener('resize', () => {
    if (!dialog.open) return;
    layout();
    drawSky(sproutFor());
    tick(secondsLeft(collection) ?? BREAK_SECONDS);
  });
  if (collection.pause) tintPills(collection.pause.sprout);
  arm();
}

/** Shows the break that goes with this Sprout, or the one already running. */
export function showBreak(sprout) {
  if (!ctx || hiding) return;
  if (sprout) ctx.sprout = sprout;
  const { dialog } = ctx;
  if (!dialog.open) dialog.showModal();
  draw();
  requestAnimationFrame(() => dialog.classList.add('is-shown'));
}
