# Deploying SKYUSS (and *Home on Wheels*) to Vercel

Both games are **plain static files**: no bundler, no build step, no server code, no
environment variables. `three` is vendored in `skyuss/vendor/three.module.js`, so the page never
touches a CDN. That is exactly the shape Vercel serves best — upload the folder and it runs.

## What is in the deploy

| Path | What it is |
| --- | --- |
| `/` | *Home on Wheels* — the car-house survival game |
| `/skyuss` | SKYUSS — the cloud-sea starship game (`cleanUrls` in `vercel.json` makes `/skyuss` work) |
| `skyuss/assets/models/quaternius/` | the CC0 Dispatcher mesh the courier flies (committed, credit included) |
| `skyuss/vendor/` | three.js r170 + its licence |
| ~~`models/`~~, ~~`skyuss/assets/premium/`~~, ~~`shots/`~~ | not deployed and not committed — downloads, bought hulls and preview renders |

Total: **~3.0 MB / 61 files**. Vercel brotli-compresses text, so the 1.28 MB three.js build
arrives at roughly a quarter of that.

## The two-minute version

1. Push this branch to GitHub (already done for `arena/11ddbd73-survive-in-a-veachle`).
2. Vercel dashboard → **Add New → Project → Import** the repository.
3. Settings that matter:
   - **Framework Preset:** `Other`
   - **Build Command:** *empty* (there is nothing to build)
   - **Output Directory:** *empty* (the repo root **is** the site)
   - **Install Command:** *empty* (the game ships no runtime dependencies)
4. **Deploy.** `vercel.json` in the repo already sets clean URLs, cache headers and basic
   security headers, and `.vercelignore` keeps `node_modules`, `shots`, `models` and
   `image-search` off the upload.

From a terminal it is the same thing:

```bash
npx vercel --prod          # first run asks for the project; afterwards it just deploys
```

## Check before you upload

```bash
npm run deploy:check
```

It walks both entry points, follows every ES-module import and every asset literal, and reports
anything a static host would 404 on:

```
entry points   index.html  ·  skyuss/index.html
module graph   36 files reachable from the entry points
deploy size    3.0 MB across 69 tracked-path files
optional       6 drop-slot files are absent — the game falls back on purpose

no blockers: every referenced file exists, is committed, and is relative
```

The three failure modes it is looking for: **missing** (referenced but never committed),
**absolute** (`/assets/…`, which breaks under a preview sub-path) and **external** (an asset
fetched from another host, which is one outage away from a blank screen). Exit code is non-zero
if anything is wrong, so it can gate a deploy. `--json` gives the same thing machine-readable.

`npm run test:all` (smoke 156 + SKYUSS 453 + boot 109 assertions and URL resolution checks) runs the same crawl as one of
its checks, so a broken path fails the test suite too.

## Things that behave differently once deployed

- **Saves are per origin.** `localStorage['skyuss_v1']` lives on the domain you deploy to, so a
  preview URL and the production URL have separate save files. That is normal, not a bug.
- **The bought hulls are not there.** `skyuss/assets/premium/*.obj` is git-ignored on purpose
  (the Vengeance mesh is not ours to redistribute), so the deployed site flies the procedural
  Kang-class hull. Drop the OBJ in locally and it replaces it — locally only.
- **No ads, no trackers, no cookies.** The page loads nothing from another origin, which is also
  why it works offline once cached. See `MONETISE.md` if you want to change that.
- **Custom domain:** Dashboard → Settings → Domains. Nothing in the code depends on the domain.

## After the first deploy

Open `/` and `/skyuss` on your phone. Both have touch controls (`js/touch.js`,
`skyuss/js/touch.js`), the SKYUSS HUD collapses on narrow screens, and audio starts only on the
first tap — iOS will not play anything before a gesture, so the mute button starts ready.

## Phones

Both games are playable on a phone with no extra build step. SKYUSS swaps in a
thumb-stick, a look pad and a FIRE/TORP/WARP/BOOST cluster; HOME ON WHEELS gains a stick,
an aim pad and an action cluster that synthesise the keyboard and mouse events the game
already listens for. Add `?touch=1` to either URL to preview the touch layout on a
desktop, and `?lowq=1` (SKYUSS) to drop shadows on a weak GPU.
