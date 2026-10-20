// Picks the Sprout inside a box, on the server, so the odds never reach the page: the browser only ever
// learns which Sprout it got, and whether its box shows the rare tell. Runs as a Vercel function
// (POST /api/pick) and under tools/dev-server.mjs locally.
// Keep the odds in this file: on Vercel the rest of the repo is served as public static files, function source isn't.
import { randomInt } from 'node:crypto';

// Series 01 rarity: each Sprout's chance in percent, by tier. They add up to 100.
const TIER = { common: 22, uncommon: 14, rare: 6 };
const ODDS = {
  daydream: TIER.common,
  read: TIER.common,
  rest: TIER.common,
  explore: TIER.uncommon,
  cheer: TIER.uncommon,
  light: TIER.rare,
};
const TOTAL = Object.values(ODDS).reduce((a, b) => a + b, 0);
// The rare box shows a tell while it trembles (cold light through its seams). So the tell can't be trusted
// outright, one in ten of the other boxes fakes it, identically, right up until the lid pops.
const RARE = new Set(['light']);
const FAKE_OUT = 10;
if (TOTAL !== 100) throw new Error(`Sprout odds add up to ${TOTAL}%, not 100%`);

function pick() {
  let r = randomInt(TOTAL);
  for (const [id, weight] of Object.entries(ODDS)) {
    if (r < weight) return id;
    r -= weight;
  }
}

export default function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    return res.end();
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const id = pick();
  const tell = RARE.has(id) || randomInt(FAKE_OUT) === 0;
  res.end(JSON.stringify({ id, tell }));
}
