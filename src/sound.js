// Every sound is synthesised here: oscillators and filtered noise, no audio files. Handling sounds (landing,
// rattling, the tear, the lid) are low, dry and papery; the reveal sounds are bright and musical. Browsers only
// allow audio after a tap or key press, so nothing plays before the first one. Muting is remembered.
// The same cues carry phone haptics, where the browser allows them.

const KEY = 'sprout-sound';
let ac = null, master = null, noiseBuf = null;
let muted = (() => { try { return localStorage.getItem(KEY) === 'off'; } catch { return false; } })();
const listeners = new Set();

/** Starts audio on the first gesture (call from a pointer or key handler). */
export function unlock() {
  try {
    if (!ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createGain();
      master.gain.value = muted ? 0 : 0.7;
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      master.connect(comp).connect(ac.destination);
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ac.state === 'suspended') ac.resume();
  } catch { ac = null; /* no Web Audio: everything stays silent */ }
}

export const isMuted = () => muted;
/** 'running' once a gesture has started audio (for ?debug). */
export const audioState = () => ac?.state ?? 'not started';
export function setMuted(on) {
  muted = on;
  try { localStorage.setItem(KEY, on ? 'off' : 'on'); } catch { /* private mode */ }
  if (master) master.gain.setTargetAtTime(on ? 0 : 0.7, ac.currentTime, 0.05);
  listeners.forEach((fn) => fn(on));
}
export const onMute = (fn) => listeners.add(fn);

// ------------------------------------------------------------------ voices
const env = (g, t, a, peak, dcy) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dcy); };
function noise(t, dur, { type = 'bandpass', f = 1000, q = 1, peak = 0.3, a = 0.005, f2 = null } = {}) {
  const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
  if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const g = ac.createGain(); env(g, t, a, peak, dur);
  s.connect(fl).connect(g).connect(master); s.start(t, Math.random()); s.stop(t + a + dur + 0.05);
}
function tone(t, hz, dur, { type = 'sine', peak = 0.2, a = 0.005, hz2 = null, detune = 0 } = {}) {
  const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(hz, t); o.detune.value = detune;
  if (hz2) o.frequency.exponentialRampToValueAtTime(hz2, t + dur);
  const g = ac.createGain(); env(g, t, a, peak, dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + a + dur + 0.05);
}
/** Kalimba-ish: a sine with a short, bright partial. */
function pluck(t, hz, dur = 0.9, peak = 0.16) {
  tone(t, hz, dur, { peak }); tone(t, hz * 2.01, dur * 0.35, { peak: peak * 0.35 }); tone(t, hz * 5.4, 0.06, { peak: peak * 0.25, type: 'triangle' });
}
const N = { C4: 261.63, E4: 329.63, G4: 392, A4: 440, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5, G6: 1567.98 };

const VOICES = {
  // handling: organic
  thunk(t) { tone(t, 120, 0.22, { peak: 0.4, hz2: 55 }); noise(t, 0.12, { type: 'lowpass', f: 900, peak: 0.28 }); },
  rattle(t, quiet = 1) { for (let i = 0; i < 6; i++) { const at = t + i * (0.05 + Math.random() * 0.05); noise(at, 0.03, { f: 1800 + Math.random() * 1600, q: 6, peak: 0.16 * quiet }); tone(at, 300 + Math.random() * 200, 0.03, { peak: 0.04 * quiet, type: 'triangle' }); } },
  rustle(t) { for (let i = 0; i < 6; i++) noise(t + i * 0.07 + Math.random() * 0.05, 0.12, { f: 3200 + Math.random() * 2400, q: 1.5, peak: 0.05, a: 0.03 }); },
  burrow(t) { for (let i = 0; i < 5; i++) noise(t + i * 0.05, 0.06, { type: 'lowpass', f: 420 + i * 40, peak: 0.2 }); tone(t, 90, 0.3, { peak: 0.12, hz2: 50 }); },
  whoosh(t) { noise(t, 0.45, { f: 400, f2: 2400, q: 1.2, peak: 0.16, a: 0.12 }); },
  tabpop(t) { noise(t, 0.02, { type: 'highpass', f: 3000, peak: 0.24 }); tone(t, 900, 0.08, { peak: 0.09, hz2: 1400, type: 'triangle' }); },
  tick(t) { noise(t, 0.015, { f: 2800, q: 4, peak: 0.12 }); },
  zip(t, dur = 0.45) {
    let at = t, gap = 0.06;
    while (at < t + dur - 0.05) { noise(at, 0.018, { f: 2600 + (at - t) * 2400, q: 4, peak: 0.24 }); at += gap; gap = Math.max(0.012, gap * 0.82); }
    noise(at, 0.3, { type: 'highpass', f: 1200, f2: 5000, peak: 0.3, a: 0.01 });
  },
  hush(t) { tone(t, 73.4, 1.2, { peak: 0.1, a: 0.3 }); tone(t, 110, 1.2, { peak: 0.035, a: 0.35 }); },
  creak(t) { noise(t, 0.28, { f: 220, f2: 160, q: 9, peak: 0.26, a: 0.04 }); tone(t, 68, 0.25, { peak: 0.15, type: 'triangle' }); },
  // the rare tell (and its fake-outs): a rising, glassy shimmer
  shimmer(t, long = 2.4) {
    [N.C6, N.E6, N.G6, N.C6 * 2, N.E6 * 2].forEach((hz, i) => tone(t + i * (long / 7), hz, 0.9, { peak: 0.05, a: 0.08, detune: i % 2 ? 6 : -6 }));
    noise(t, long, { type: 'highpass', f: 6000, peak: 0.06, a: long * 0.6 });
    tone(t, N.C5, long, { peak: 0.025, a: long * 0.7, type: 'triangle' });
  },
  lidpop(t) { tone(t, 140, 0.25, { peak: 0.4, hz2: 60 }); tone(t + 0.01, 700, 0.09, { peak: 0.2, hz2: 180 }); noise(t, 0.08, { type: 'lowpass', f: 1500, peak: 0.26 }); noise(t + 0.02, 0.35, { f: 800, f2: 3000, peak: 0.1, a: 0.05 }); },
  // reveal: bright
  rise(t, dur = 1.0) {
    const fl = ac.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.setValueAtTime(300, t); fl.frequency.exponentialRampToValueAtTime(4200, t + dur); fl.Q.value = 3;
    const g = ac.createGain(); env(g, t, dur * 0.8, 0.09, 0.3); fl.connect(g).connect(master);
    [N.C4, N.G4, N.E5].forEach((hz) => { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz; o.detune.value = Math.random() * 10 - 5; o.connect(fl); o.start(t); o.stop(t + dur + 0.4); });
  },
  chime(t) { [N.C5, N.E5, N.G5, N.C6].forEach((hz, i) => pluck(t + i * 0.07, hz, 1.1)); noise(t, 0.4, { type: 'highpass', f: 7000, peak: 0.04 }); },
  fanfare(t) {
    [N.C5, N.E5, N.G5, N.C6, N.E6, N.G6].forEach((hz, i) => { pluck(t + i * 0.06, hz, 1.3, 0.14); tone(t + i * 0.06, hz, 0.5, { peak: 0.03, type: 'square' }); });
    [N.C6 * 2, N.G6 * 2, N.E6 * 2].forEach((hz, i) => tone(t + 0.45 + i * 0.09, hz, 0.4, { peak: 0.04 }));
    tone(t, N.C4, 1.4, { peak: 0.07, type: 'triangle', a: 0.05 }); noise(t, 1.2, { type: 'highpass', f: 7000, peak: 0.07, a: 0.1 });
  },
  stamp(t) { tone(t, 180, 0.12, { peak: 0.22, hz2: 90 }); noise(t, 0.05, { type: 'lowpass', f: 1200, peak: 0.18 }); },
  newsting(t) { pluck(t, N.G5, 0.4, 0.16); pluck(t + 0.11, N.C6, 0.7, 0.18); },
  again(t) { pluck(t, N.E5, 0.6, 0.14); },
  slot(t) { tone(t, 1800, 0.04, { peak: 0.14, type: 'triangle', hz2: 1200 }); noise(t, 0.025, { f: 2500, q: 5, peak: 0.16 }); },
  // completing the series
  invite(t) { [N.G5, N.C6, N.E6, N.G6].forEach((hz, i) => pluck(t + i * 0.09, hz, 0.9, 0.11)); noise(t + 0.2, 0.6, { type: 'highpass', f: 7000, peak: 0.04, a: 0.1 }); },
  popup(t, k = 0) { noise(t, 0.06, { type: 'lowpass', f: 700, peak: 0.2 }); tone(t + 0.02, [N.C5, N.D5, N.E5, N.G5, N.A5, N.C6][k % 6], 0.14, { peak: 0.09, hz2: [N.C5, N.D5, N.E5, N.G5, N.A5, N.C6][k % 6] * 1.5, type: 'triangle' }); },
  squish(t) { [0, 0.12, 0.2, 0.33].forEach((d, i) => tone(t + d, 260 + i * 70, 0.12, { peak: 0.1, hz2: 180 + i * 50, type: 'triangle' })); noise(t, 0.5, { f: 500, q: 0.8, peak: 0.07, a: 0.05 }); },
  count(t) { pluck(t, N.E5, 0.25, 0.15); },
  shutter(t) { noise(t, 0.03, { type: 'highpass', f: 2500, peak: 0.4 }); noise(t + 0.07, 0.04, { f: 1800, q: 2, peak: 0.3 }); tone(t, 4200, 0.5, { peak: 0.02, hz2: 6000, a: 0.02 }); },
  develop(t) { noise(t, 0.6, { f: 1400, f2: 900, q: 1, peak: 0.08, a: 0.1 }); pluck(t + 0.5, N.C6, 1.0, 0.12); pluck(t + 0.62, N.G6, 1.2, 0.1); },
};

/** Plays a cue now (or `delay` seconds from now). Silent until the first gesture, or when muted. */
export function play(name, delay = 0, ...args) {
  if (!ac || muted || ac.state !== 'running') return;
  try { VOICES[name](ac.currentTime + 0.01 + delay, ...args); } catch { /* a voice failing never breaks the show */ }
}

/** A haptic pattern, on phones that allow it (only after the visitor has interacted). */
export function buzz(pattern) {
  if (!navigator.vibrate || navigator.userActivation?.hasBeenActive === false) return;
  try { navigator.vibrate(pattern); } catch { /* not allowed here */ }
}
