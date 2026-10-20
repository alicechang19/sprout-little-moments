// Series 01 lineup. Six Sprouts to collect. Written for anyone who opens a box.
export const SERIES = [
  {
    id: 'daydream', no: '01', name: 'Daydream',
    tint: '#cdd8f3',
    sky: { light: ['#d9e3f7', '#f5f1f7'], dark: ['#1b2142', '#2b2d52'] },
  },
  {
    id: 'read', no: '02', name: 'Read',
    tint: '#f1dcc0',
    sky: { light: ['#f4e3cd', '#fbf5ec'], dark: ['#2a2130', '#3a2e38'] },
  },
  {
    id: 'rest', no: '03', name: 'Rest',
    tint: '#d9d4ee',
    sky: { light: ['#d3d0ec', '#ede9f4'], dark: ['#181a36', '#262646'] },
  },
  {
    id: 'explore', no: '04', name: 'Explore',
    tint: '#e3ebc9',
    sky: { light: ['#e5edd0', '#f7f6ea'], dark: ['#1d2a1f', '#2b3829'] },
  },
  {
    id: 'cheer', no: '05', name: 'Cheer',
    tint: '#f6d8cf',
    sky: { light: ['#f7ddd5', '#fcf2ec'], dark: ['#2c1e26', '#3c2a31'] },
  },
  {
    id: 'light', no: '06', name: 'Little Light',
    tint: '#3a4070',
    sky: { light: ['#20264a', '#3b4170'], dark: ['#0e1126', '#1f2446'] },
  },
];

export const BY_ID = Object.fromEntries(SERIES.map((s) => [s.id, s]));

export const SKY = {
  box: { light: ['#e9e6de', '#f7f5f0'], dark: ['#171a30', '#23273f'] },
  // the garden follows the real time of day, not the device's dark mode (src/sky.js)
  dawn: { light: ['#a9d6f5', '#fde6d3'], dark: ['#a9d6f5', '#fde6d3'], day: true },
  dusk: { light: ['#2b2d52', '#d4877a'], dark: ['#2b2d52', '#d4877a'], night: true },
  // while a box shows the rare tell, the sky slides toward night
  tell: { light: ['#232853', '#5c6398'], dark: ['#232853', '#5c6398'], night: true },
};

// three.js light rigs per scene, blended on change
export const LIGHTS = {
  box: { hemi: [0xffffff, 0xe4d9c8, 1.0], key: [0xfff1de, 2.2], fill: [0xe2ebff, 0.55], env: 0.3 },
  // the garden's two times of day; `fixed` keeps them from dimming in dark mode
  dawn: { hemi: [0xf6f8ff, 0xb9dcae, 1.0], key: [0xfff0d6, 2.3], fill: [0xd6e4ff, 0.55], env: 0.3, fixed: true },
  dusk: { hemi: [0x9a92d8, 0x2c4a3a, 0.8], key: [0xffb48c, 1.35], fill: [0x8f9ae0, 0.6], env: 0.2, fixed: true },
  tell: { hemi: [0x7f88c8, 0x26354a, 0.65], key: [0xc8d2ff, 1.1], fill: [0x8f9ae0, 0.5], env: 0.16, fixed: true },
  daydream: { hemi: [0xf0f3ff, 0xe0d9ee, 1.0], key: [0xfff6ea, 2.1], fill: [0xd4defc, 0.65], env: 0.3 },
  read: { hemi: [0xfff3e4, 0xe6d3bb, 0.9], key: [0xffe2bd, 2.0], fill: [0xffdcc0, 0.45], env: 0.28 },
  rest: { hemi: [0xd6d4f5, 0xc4bcd9, 0.8], key: [0xe4e0ff, 1.35], fill: [0xb9c3ff, 0.55], env: 0.24 },
  explore: { hemi: [0xfbfff0, 0xded9c0, 1.0], key: [0xfff2d4, 2.3], fill: [0xe3eeff, 0.5], env: 0.3 },
  cheer: { hemi: [0xfff5f1, 0xefd6cc, 1.0], key: [0xfff0e2, 2.2], fill: [0xffe1ea, 0.55], env: 0.3 },
  light: { hemi: [0x6a72a8, 0x262a46, 0.5], key: [0xa9b3ff, 0.55], fill: [0x8a94d6, 0.35], env: 0.12 },
};
