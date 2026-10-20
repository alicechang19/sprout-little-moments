// The garden follows the real sky where the viewer is: dawn from sunrise to sunset, dusk the rest of the time
// (the small hours included). Sunset comes from the browser's time zone, mapped to a representative city, so
// there's no location prompt. ?sky=dawn or ?sky=dusk forces either look for testing.
import { testParams } from './util.js';

// time zone → a representative city (latitude, longitude east-positive)
const TZ = {
  'America/Los_Angeles': [38.58, -121.49], 'America/Vancouver': [49.28, -123.12], 'America/Denver': [39.74, -104.99], 'America/Phoenix': [33.45, -112.07],
  'America/Edmonton': [53.55, -113.49], 'America/Chicago': [41.88, -87.63], 'America/Winnipeg': [49.9, -97.14], 'America/Mexico_City': [19.43, -99.13],
  'America/New_York': [40.71, -74.0], 'America/Toronto': [43.65, -79.38], 'America/Detroit': [42.33, -83.05], 'America/Halifax': [44.65, -63.57],
  'America/Anchorage': [61.22, -149.9], 'Pacific/Honolulu': [21.31, -157.86], 'America/Sao_Paulo': [-23.55, -46.63], 'America/Bogota': [4.71, -74.07],
  'Europe/London': [51.51, -0.13], 'Europe/Dublin': [53.35, -6.26], 'Europe/Paris': [48.86, 2.35], 'Europe/Berlin': [52.52, 13.4], 'Europe/Madrid': [40.42, -3.7],
  'Europe/Rome': [41.9, 12.5], 'Europe/Amsterdam': [52.37, 4.9], 'Europe/Stockholm': [59.33, 18.07], 'Africa/Johannesburg': [-26.2, 28.05], 'Africa/Lagos': [6.52, 3.38],
  'Africa/Nairobi': [-1.29, 36.82], 'Asia/Dubai': [25.2, 55.27], 'Asia/Kolkata': [19.08, 72.88], 'Asia/Singapore': [1.35, 103.82], 'Asia/Manila': [14.6, 120.98],
  'Asia/Shanghai': [31.23, 121.47], 'Asia/Tokyo': [35.68, 139.69], 'Asia/Seoul': [37.57, 126.98], 'Australia/Sydney': [-33.87, 151.21],
  'Australia/Melbourne': [-37.81, 144.96], 'Australia/Brisbane': [-27.47, 153.03], 'Australia/Perth': [-31.95, 115.86], 'Pacific/Auckland': [-36.85, 174.76],
};

/** Where the viewer probably is. Zones not in the table get a longitude from their UTC offset. */
export function whereabouts(date = new Date()) {
  let zone = 'UTC';
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { /* very old browser */ }
  return { zone, at: TZ[zone] || [35, -date.getTimezoneOffset() / 4] };
}

/** Today's sunrise and sunset (the sunrise equation), or which way a polar day goes. */
export function sunTimes(date, lat, lon) {
  const rad = Math.PI / 180;
  const n = Math.round(date.getTime() / 86400000 + 2440587.5 - 2451545 + 0.0008);
  const Js = n - lon / 360;
  const M = (357.5291 + 0.98560028 * Js) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const L = (M + C + 180 + 102.9372) % 360;
  const transit = 2451545 + Js + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * L * rad);
  const dec = Math.asin(Math.sin(L * rad) * Math.sin(23.4397 * rad));
  const cosW = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(dec)) / (Math.cos(lat * rad) * Math.cos(dec));
  if (cosW >= 1) return { polar: 'night' };
  if (cosW <= -1) return { polar: 'day' };
  const w = Math.acos(cosW) / rad;
  const toDate = (J) => new Date((J - 2440587.5) * 86400000);
  return { rise: toDate(transit - w / 360), set: toDate(transit + w / 360) };
}

const forced = testParams.get('sky');

/** 'dawn' between sunrise and sunset, 'dusk' otherwise. */
export function skyLook(now = new Date()) {
  if (forced === 'dawn' || forced === 'dusk') return forced;
  const { at } = whereabouts(now);
  const sun = sunTimes(now, at[0], at[1]);
  if (sun.polar) return sun.polar === 'day' ? 'dawn' : 'dusk';
  return now >= sun.rise && now < sun.set ? 'dawn' : 'dusk';
}

/** Calls onChange(look) when the sky turns, checking once a minute. Returns the look right now. */
export function watchSky(onChange) {
  let last = skyLook();
  setInterval(() => {
    const look = skyLook();
    if (look !== last) { last = look; onChange(look); }
  }, 60000);
  return last;
}
