# SKYUSS — an ocean of clouds

The second game in this repository. **Home on Wheels** is the car-house road trip;
**SKYUSS** is its opposite: no ground at all.

A full 3D exploration / combat / base-building survival game on **Three.js (WebGL2)**.
The sky is an endless procedural sea of clouds. You fly a modular **USS Enterprise** that
physically rebuilds itself as you refit it, and you build **sky fortresses** out of sleek
modular platforms to hold territory and bank your salvage.

```bash
npm start                     # then open http://localhost:8000/skyuss/
# or from this folder
python3 -m http.server 8000 --bind 0.0.0.0
```

Everything is static: no bundler, no build step, and **Three.js r170 is vendored** in
`vendor/three.module.js` (MIT, licence alongside) so the game runs offline.

---

## The loop

1. **Fly out** into the cloud sea. Derelict starship wrecks, floating islands and ion storms
   are scattered across a 520 m radius of sky, all seeded and regenerated identically.
2. **Scavenge.** Press `E` inside tractor range to strip a derelict (`Ti`, `Di`, matrix
   components) and fill your cargo hold. Destroyed pirates drop salvage that your tractor
   beam reels in — with shields and a hull you can only carry so much.
3. **Bank it.** Fly home and press `E` at the fortress to deposit. Refits and fortress pieces
   are bought from those stores, so the round trip *is* the game.
4. **Refit.** Press `U`. Four components × five tiers. The 3D model changes as you spend.
5. **Build.** Press `B` for the holographic fortress grid and place platforms, phaser turrets,
   shield pylons, SAM batteries, refineries and matrix condensers.
6. **Defend.** Ambient pirates harass you; a **siege fleet** hits the fortress every ~3 minutes.
   Lose it and half your stores burn.

## The Enterprise — a modular 3D ship constructor

`upgradeShip(component, tier)` is the whole API. Tiers are not stat stickers: the mesh is
rebuilt from the tier array, so every refit looks different.

| Component | What changes in 3D | Stats |
| --- | --- | --- |
| **Saucer** | extra command rings, wider hull, one new glowing phaser strip per bank | crew, 360° bank coverage, shield cap |
| **Warp nacelles** | longer nacelles, swept pylons, more warp coils, new glow colour (blue → violet → red → ion-white) | top speed, turn rate, warp-dash cooldown |
| **Deflector dish** | dish grows and gains concentric emitter rings | shield capacity, regeneration, tractor strength |
| **Weapons** | photon launcher appears at tier 2, four quantum spire emitters at tier 3+ | damage, rate of fire, lock-on cone |

`js/enterprise.js` has no WebGL dependency — geometry and materials are built as plain
objects, which is why the headless test can assert on the actual mesh ("refit widens the
hull", "two nacelles are modelled", "more warp coils on higher nacelles").

## The sky fortress

A 12×12 holographic grid around a command core. Pieces must touch an existing deck, and each
one is a real object with rules:

| Piece | Effect |
| --- | --- |
| Deck Platform | the spine — everything connects through decks |
| Phaser Turret | auto-tracks hostiles inside 220 m, 14 dmg / 0.9 s |
| Shield Pylon | +240 fortress shield, absorbed before hull |
| SAM Battery | 46 dmg / 2.4 s out to 380 m |
| Refinery Node | +0.9 Ti/s and +0.35 Di/s while you are away |
| Matrix Condenser | +0.06 matrix/s — the rare upgrade currency |
| Crew Habitat | +40 hull and faster fortress repair |
| Turbolift Hub | +12% turret range per hub |

Turrets aim and fire through the sim; the renderer just rotates their 3D heads to the
stored angle. Sieges damage the shields first, then the hull.

## Sound and feedback

There are **no audio files**: `js/audio.js` synthesises everything with WebAudio — a sawtooth
engine drone whose pitch and filter follow throttle and warp, plus phaser zaps, torpedo
launches, layered noise explosions, shield hits with a red screen vignette, warp whoosh,
construction clinks and an upgrade chord. `O` or the **Sound** hotbar button mutes it.
Every call is a no-op without an `AudioContext`, which is why the headless suites can run it.

Visual feedback runs through a tiny effect bus: the sim pushes `{kind, x, y, z, size, life}`
records (`muzzle`, `boom`, `hit`, `warp`, `build`, `loot`) and the renderer turns each one into
an additive particle burst plus the matching sound — one mechanism for both.

## BUILD ALL

Inside the fortress tray, **⚡ BUILD ALL** repeatedly sweeps the 12×12 grid placing the selected
piece in every free cell that touches the existing deck, stopping when the grid fills or the
bank runs dry (`game.placeAll(kind)`). It is the fast way to grow a fortress perimeter after a
siege, and it is covered by the headless tests.

## Flight model

Arcade six-axis: `W/S` throttle, `A/D` yaw, `↑/↓` pitch, `Space/C` climb/dive, `Shift`
impulse boost, `F` warp dash (3.4× velocity, cooldown from the nacelle tier). The camera is a
smoothed third-person orbit — drag to orbit, wheel to zoom.

Firing is **mouse-driven with a soft auto-lock assist**: phasers fire along the reticle ray,
and if a hostile sits inside the lock cone the bolt homes gently onto it (torpedoes home hard).
Fort turrets are fully automatic. Shields regenerate 4 s after the last hit; the **abyss**
below the cloud line ignores shields entirely and eats the hull.

## Architecture

```
skyuss/
  index.html          HUD, refit/fortress panels, title screen
  css/sky.css         UI skin
  vendor/three.module.js   Three.js r170 (MIT)
  js/config.js        every tunable: tiers, costs, fort pieces, pirates, siege pacing
  js/enterprise.js    tier array → stats → Three.js mesh (render-free, unit tested)
  js/fort.js          grid rules, turret fire, mining + fortress meshes
  js/world.js         seeded islands / derelicts / storms + their geometry
  js/sim.js           the whole simulation: flight, combat, cargo, sieges, the abyss
  js/ui.js            DOM HUD, panels, radar
  js/main.js          renderer, cloud sea, camera rig, input, scene sync
tools/skyuss-smoke.mjs   headless test: 114 assertions, no GPU required
```

The split is deliberate: **`sim.js` never imports Three.js and `main.js` never owns game
state**, so the entire gameplay loop can be run and asserted in Node.

## Tests

```bash
npm run smoke:skyuss        # 114 assertions: sim + meshes, no GPU
npm run smoke:skyuss:boot   # 15 assertions: boots the real renderer headlessly
npm run check               # syntax-check both games
npm run test:all            # every suite in this repo
```

The headless suite flies the ship, kills a pirate, banks cargo, strips a derelict, drops
into the abyss, triggers a siege, saves and loads, builds every fortress piece, and walks
every Enterprise tier — then verifies the browser layer: every module import resolves, every
`THREE.*` symbol used by the renderer exists in the vendored build, and every DOM id the UI
binds exists in `index.html`.

`tools/skyuss-boot.mjs` goes further: it runs the **real `main.js`** inside jsdom against a
stub WebGL2 context, so the whole renderer pipeline executes — shader compilation, scene
graph, the animation loop, the HUD, the refit panel, the fortress tray, live mesh rebuilds
after an upgrade or a build, and combat frames with projectiles. That is 85k+ stub draw calls
of coverage without a GPU.

## Controls

| Key | Action |
| --- | --- |
| `W` `S` | throttle / retro thrust |
| `A` `D` | yaw · `↑` `↓` pitch |
| `Space` `C` | climb / dive |
| `Shift` | impulse boost |
| `F` | warp dash |
| mouse drag / wheel | orbit / zoom the camera |
| `LMB` | phasers · `RMB` photon torpedo |
| `E` | strip derelict · survey island · deposit at the fortress |
| `B` | fortress build mode |
| `U` | Enterprise refit |
| `1`–`8` | pick a fortress piece |
| `H` | flight manual · `Esc` close |
