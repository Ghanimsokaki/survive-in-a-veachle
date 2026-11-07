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

1. **Fly out** into the cloud sea — it is genuinely endless (see *The open world* below).
   Derelict starship wrecks, floating islands and ion storms are scattered across it, seeded so
   that the same place is always the same place.
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
7. **Photograph and sell.** Press `G` for the free camera, frame something the log has never
   seen, press `T`. The frame is written to your downloads *and* the photo contract pays
   credits. Credits buy hulls in the shipyard (`Y`) — the first one on the shelf is the
   **Aurora-class courier**.

## The open world

The cloud sea used to be a 520 m square with a hard wall. It is now generated per **cell** and
streamed, so there is no edge anywhere.

* `generateCell(seed, cx, cz)` is a pure function of the seed and the cell's grid coordinates:
  islands (1–4), wrecks (0–2) and storms (0–1) per 320 m cell, all with ids namespaced by the
  cell (`i:12:-9:0`) so they can never collide with anything else in the world.
* `WorldStream` keeps a 3×3 window of cells around the ship, rebuilds the flat view only when the
  ship crosses a border, and prunes cells that fall more than one ring behind. Memory and draw
  calls stay flat however far you fly.
* The renderer mirrors the window: each cell is one `THREE.Group`, built when the cell streams in
  and disposed (geometry **and** materials) when it streams out.
* The fortress's graveyard stays clear: no island or wreck is ever placed inside
  `WORLD.graveyard.r` of the origin.
* **Stripped sites stay stripped.** `stream.markLooted(id)` is a permanent set, so a wreck you
  looted at 26 km is still empty when you fly back — the save file stores the ids
  (`looted.ids`) plus the sector keys you have charted (`discovered`), and both round-trip.
* The HUD shows the current sector (`SECTOR x,z`) and how many sectors you have charted.
* The only clamp left is a sanity limit at ±40 km, far beyond any real flight.

## The ship model

`buildEnterprise()` is hand-built geometry — no imported assets — but it is modelled rather than
approximated:

| element | how it is made |
| --- | --- |
| primary hull | `LatheGeometry` over a 17-point profile, 96 segments: B-deck plateau, rim band, undercut bottom, deck seams |
| bridge | stepped module + hemisphere dome + sensor pod |
| engineering hull | capsule + dorsal spine + plating rings + deflector housing + lit shuttlebay |
| nacelles | tapered tubes, orange bussard collector with a three-ring cage, 2–6 warp coils, curved warp grille per flank, lit exhaust, strobe |
| connection | swept pylon blades (`setFromUnitVectors` between hull and nacelle) and a tapered neck |
| lights | two lit window bands per hull section, 10 individual cabins, red/green/white navigation lights |
| weapons | rim phaser strips, torpedo launcher, dorsal spires (tier 3), pulse cannons (tier 4) |

Because the scene has **no environment map**, hull materials use low metalness (≈0.3) — a
metalness-0.7 PBR hull with nothing to reflect renders black, which is what made the old ship
look like a silhouette. `userData.parts` is still the renderer's animation surface and now also
carries `grilles`, `exhaust`, `impulse` and `runningLights`.

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

## Credits, the shipyard and photo contracts

Two economies, deliberately separate:

- **Fortress stores** (`Ti` / `Di` / matrix) pay for refits and fortress pieces. You haul them
  home in the cargo hold.
- **Credits** (`¢`) are the shipyard currency and are *never* granted — only earned in flight.

Three ways credits arrive:

| Source | Payout |
| --- | --- |
| Skiff / raider / siege / dread bounty | 40 / 75 / 120 / 300 ¢ |
| Photo contract on a new subject | 60–400 ¢ (see below) |
| Second shot of the same subject | nothing — the desk already has it |

**Photo contracts.** Every island, derelict, storm, hostile, the fortress itself and your own
bought ship is a subject with a payout. `js/sim.js` knows what exists in the world
(`photoSubjects()`); the renderer decides what is *actually in frame* by projecting each one
through the camera (`framedSubjects()` in `js/main.js`); the sim pays out through
`claimPhoto(ids)` and remembers the shot in the save file. That split keeps the whole economy
testable headlessly.

**The shipyard (`Y`)** lists the hulls you own and the ones you can afford. The
**Aurora-class courier** costs 4,500 ¢: 28% faster, 22% nimbler, 15% faster guns, 18% thinner
hull. Refits stack on top of it — the hull class multiplies the airframe, the refit tree is
unchanged.

### The Aurora model

`js/aurora.js` builds the courier procedurally (lathed fuselage, forward-swept prongs, canopy,
twin nacelles with exhaust discs, dorsal fin, lit windows, mine-red / starboard-green running
lights, shield bubble) and exposes the same `userData.parts` contract as the Enterprise, so the
renderer animates both with one code path.

![the Aurora-class courier](shots/aurora-preview.png)

It is modelled after the free TurboSquid *"Avrora" Sci-Fi Spaceship*
([product 1577480](https://www.turbosquid.com/3d-models/space-spaceship-sci-fi-3d-1577480),
TurboSquid Royalty Free licence). That licence lets a bought model ship **inside** a game but
not the model file itself, so the real mesh is a drop-in that never enters this repo:

1. download the Avrora and keep the **OBJ**;
2. save it as `skyuss/assets/premium/avrora.obj` (the folder is git-ignored on purpose);
3. buy the courier in the shipyard.

`js/premium.js` parses the OBJ (fan-triangulated quads, negative indices, no dependencies),
centres and scales it to ~30 m and calls `setPremium()` — the placeholder hull hides, the
engine glows, running lights and shield bubble stay. With no file present the procedural hull
flies instead, so the game is never broken and no licence is involved.

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

### Two fortress art styles

`buildFort(THREE, fort, style)` picks one of two builders over the **same** rulebook — grid,
costs, turret ranges and connections are identical, only the geometry changes:

| Style | Look | Build |
| --- | --- | --- |
| `scifi` (default) | hex decks, glowing pylons, floating crystals | `buildFortScifi` |
| `voxel` | chunky Minecraft-ish blocks, stepped crenellations, cube turret heads | `buildFortVoxel` |

`V`, the **Style** hotbar button or the `#styleChip` HUD chip toggles it (`game.toggleStyle()`),
and the existing fortress is rebuilt in place. Every piece is still its own group with an
aimable turret, so swapping style never breaks the sim's bookkeeping.

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

## UPGRADE ALL

The refit panel's **⇪ UPGRADE ALL** button (and `ship.upgradeAll(bank)`) buys every refit it
can afford, component by component, until the bank or the tier cap runs out:

```js
{ installed: [{component, tier}, …], spent: {titanium, dilithium, matrix}, ok: true }
```

It never assumes money it doesn't have — a sweep on a poor bank installs what it can and
leaves every resource at zero or above, a second sweep on a maxed ship installs nothing, and
the mesh is rebuilt exactly once afterwards. `game.upgradeAll()` wraps that in the sim, spends
the real bank, fires the refit VFX and logs *"Refit sweep: n systems upgraded"*.

## Flight model

Arcade six-axis: `W/S` throttle, `A/D` yaw, `↑/↓` pitch, `Space/C` climb/dive, `Shift`
impulse boost. `F` is a **warp jump home**: wherever you are in the world, it puts the ship
250 m in front of the fortress, nose pointed at it and already moving, and restreams the
world around the arrival point. Pressing it while you are already on station boots you
forward with a 3.4× dash instead (same 25 energy, cooldown from the nacelle tier).

The camera is a smoothed third-person orbit — **right-drag** to orbit, wheel to zoom — plus a
**free camera** on `G`: the sim pauses, you fly the camera with `WASD`/`QE` (hold `Shift` to
move fast, wheel to change camera speed) and drag to look, and `T` writes a PNG of the frame.
`G` again snaps back to the ship.

Firing is **mouse-driven with a lock assist that actually connects**. Left mouse (hold) fires
phasers along the reticle; the bolt is spawned at the saucer rim, aimed at where a locked
hostile *will be* when it arrives (two-pass lead solve) and homes with `k = 2.6`, so a
crossing skiff dies in about ten shots. The lock holds for 2.4 s after a target slips out of
the cone, so a fly-past does not throw your burst into empty sky. Right mouse *click* fires a
photon torpedo; right mouse *drag* only moves the camera. Phasers cost 2 energy with 14/s
regeneration, so you can hold the trigger down through a whole fight. Fort turrets are fully
automatic.

`L`, the **Aim** hotbar button or `#aimChip` switches to **fully manual aim**
(`game.settings.aimAssist = false`): no lock cone, no homing at all, bolts fly exactly along
the reticle and torpedoes straight ahead — the badge under the crosshair reads `MANUAL` instead
of `AUTO`. Learn the lead yourself. Settings are saved with the run and restored on load. Shields regenerate 4 s after the last hit; the **abyss**
below the cloud line ignores shields entirely and eats the hull.

## Touch controls

`js/touch.js` adds a `TouchControls` layer — a left thumb-stick (throttle / yaw), a right
look-pad (pitch / camera orbit) and a column of action buttons (fire, torpedo, boost, warp,
interact, build). It is **auto-detected** (`TouchControls.isSupported()`: `?touch=1`, a coarse
pointer, or `ontouchstart`) and can be cycled `auto → on → off` with `P` or the `#touchChip`
chip. While it is on, `body.touch-on` hides the keyboard hotbar and enlarges the HUD buttons.

```js
touch.state()   // → { forward, back, yaw, pitch, up, down, boost, fire } | null
```

That fragment is merged into the normal input object in `main.js`, so the flight model never
knows whether a stick or a keyboard is driving it. The layer is a safe no-op headless — the
boot suite mounts it, presses WARP and holds FIRE through real DOM events, then unmounts it.

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
  js/main.js          renderer, cloud sea, camera rig, input, scene sync, VFX
  js/audio.js         synthesised WebAudio (no assets)
  js/touch.js         thumb-stick / look-pad / action buttons for phones
tools/skyuss-smoke.mjs   headless test: 265 assertions, no GPU required
```

The split is deliberate: **`sim.js` never imports Three.js and `main.js` never owns game
state**, so the entire gameplay loop can be run and asserted in Node.

## Previewing the models without WebGL

`skyuss/tools/preview-lib.mjs` is a small painter's-algorithm rasteriser on `@napi-rs/canvas`
that draws the *actual* Three.js object graph. Two thin wrappers use it:

```bash
node skyuss/tools/ship-preview.mjs  --tiers 2,2,2,2 --out shots/skyuss-ship.png
node skyuss/tools/world-preview.mjs --out shots/skyuss-world.png
# handier flags: --only pylon | --colour   (isolate or colour-code parts)
```

Useful because jsdom has no WebGL: this is how the hull proportions get reviewed.

## Tests

```bash
npm run smoke:skyuss        # 265 assertions: sim + streaming + meshes, no GPU
npm run smoke:skyuss:boot   # 82 assertions: boots the real renderer headlessly
npm run check               # syntax-check both games
npm run test:all            # every suite in this repo
```

The headless suite flies the ship, kills a pirate, banks cargo, strips a derelict, drops
into the abyss, triggers a siege, saves and loads, builds every fortress piece, and walks
every Enterprise tier — then verifies the browser layer: every module import resolves, every
`THREE.*` symbol used by the renderer exists in the vendored build, and every DOM id the UI
binds exists in `index.html`.

World streaming has its own section: cells are deterministic and id-namespaced, the 3×3 window
is exactly the union of its cells and is not rebuilt while the ship stays put, flying 26 km out
still generates a populated world, old cells are pruned, loot survives a cell being evicted,
and the save round-trips looted ids and charted sectors. Hull detail gets its own too: the
saucer is a lathe, the structural members are named, the nacelles sit above and clear of the
hull, and the materials stay in a metalness band that actually lights without an env map.

`tools/skyuss-boot.mjs` goes further: it runs the **real `main.js`** inside jsdom against a
stub WebGL2 context, so the whole renderer pipeline executes — shader compilation, scene
graph, the animation loop, the HUD, the refit panel, the fortress tray, live mesh rebuilds
after an upgrade or a build, BUILD ALL, UPGRADE ALL, both fortress styles, the aim-mode
switch, mounting and driving the touch layer, and combat frames with projectiles.
That is 300k+ stub draw calls of coverage without a GPU.

## Controls

| Key | Action |
| --- | --- |
| `W` `S` | throttle / retro thrust |
| `A` `D` | yaw · `↑` `↓` pitch |
| `Space` `C` | climb / dive |
| `Shift` | impulse boost |
| `F` | warp jump home to the fortress (dash if already there) |
| right-drag / wheel | orbit / zoom the camera |
| `G` | free camera (sim paused) · `T` photo → pays a contract + PNG download |
| `Y` | shipyard & photo desk — buy hulls with credits |
| `LMB` hold | phasers · `RMB` click photon torpedo |
| `E` | strip derelict · survey island · deposit at the fortress |
| `B` | fortress build mode |
| `U` | Enterprise refit · **⇪ UPGRADE ALL** in that panel |
| `V` | fortress art style: sci-fi platforms ⇄ voxel blocks |
| `L` | aim mode: auto-lock ⇄ fully manual |
| `P` | touch controls: auto ⇄ on ⇄ off |
| `1`–`8` | pick a fortress piece |
| `H` | flight manual · `Esc` close |
