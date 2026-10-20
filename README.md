# Sprout: Little Moments, Series 01

A little digital blind box. Spin the ring, tear a box open and meet the Sprout inside. Find all six and they
gather in the garden for a photo.

It's a static three.js page (`index.html` + `src/`) with one Vercel function, `api/pick.js`, which decides what's
in each box on the server so the odds never reach the browser. three loads from a CDN, so there's no build step.

## Run it locally

```sh
npm run dev
```

Opens on http://localhost:5179 (`PORT` changes it). It serves the site and runs `api/pick.js` the way Vercel does.
Opening `index.html` straight from disk won't work, because the page loads modules and calls `/api/pick`.

Handy URL switches for testing:

| | |
|---|---|
| `?demo` | a fresh collection with no breaks, kept in memory only |
| `?sprout=<id>` | the next box holds that Sprout (`daydream`, `read`, `rest`, `explore`, `cheer`, `light`) |
| `?tell=1` | with `?sprout`, the box shows the rare tell |
| `?break=10` | breaks last 10 seconds instead of five minutes |
| `?sky=dawn` / `?sky=dusk` | forces the time of day |
| `?debug` | exposes `window.__sprout` for poking at the scene |

## Where things live

| | |
|---|---|
| `src/` | the experience: `app.js` runs it; `box.js`, `carousel.js`, `garden.js`, `envs.js`, `fx.js` build the scene; `unlock.js` is the five-minute break; `share.js` draws the share cards; `sound.js` synthesises every sound |
| `api/pick.js` | the box draw and its odds |
| `models/web/` | what the page loads: each Sprout as a base64 GLB module plus its textures, and the box stills |
| `tools/` | the asset pipeline, the local dev server, and design mockups |

Each player's collection is kept in their own browser (`localStorage`); nothing is stored on a server.

## The model pipeline

The scanned Sprouts are edited in Blender, and `models/web` is exported from those files. The sources are
large, so they're kept out of git and need to be on this machine to rebuild a model:

- `models/src/`: the raw scans and their web-sized imports
- `models/blend/<id>/`: the editable `.blend` and its texture PNGs
- `models/archive/`: old backups

```sh
node tools/import-model.mjs <scan.glb> <name> # scan -> models/src/<name>.glb, simplified
npm run blend:make -- <id>                    # models/src -> models/blend/<id>/<id>.blend, rigged
npm run blend:export -- <id>                  # models/blend/<id>/<id>.blend -> models/web
```

Blender is expected at `/Applications/Blender.app`; set `BLENDER` to point elsewhere. `blend:make` needs about
12 GB of memory free.

## Deploying

Vercel serves the repo as static files and `api/` as functions. Everything else that's committed is public at
its own URL, which is why the odds live in `api/pick.js` and nowhere else.
