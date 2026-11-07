# HOME ON WHEELS

**Jakarta → Washington D.C. — build a house on your car, loot the ruins of the world, and survive the army.**

A complete **3D** survival / driving / base-building game that runs in the browser with no build step and no external assets. Everything — the 1,002 recipes, the ruined towns, the survivors, the whole route — is generated locally.

The world is rendered with a hand-written perspective renderer (painter-sorted flat-shaded low-poly geometry on a plain 2D canvas — no WebGL, no libraries), the player is a fully articulated character rig, and the car is a house you can build **on the roof and inside the cabin**.

![menu](assets/menu-bg.jpg)

---

## Play

Any static file server works (ES modules need HTTP, not `file://`):

```bash
python3 -m http.server 8000      # then open http://localhost:8000
# or
npm start                         # same thing
```

## Controls

| Key | Action |
| --- | --- |
| `W` `A` `S` `D` / arrows | drive, brake, steer — or walk, on foot |
| mouse | aim (the mouse ray is cast into the 3D world) |
| left click (hold) | shoot |
| `E` | loot crate · talk to survivor · open dock · depart |
| `G` | get out of the car / climb back in |
| `T` | depart to the next zone (at the DEPART gate) |
| `B` | build mode — pick a module, click a roof cell, right-click to remove |
| `Tab` | in build mode: switch between the **roof** and the **cabin interior** |
| `C` | crafting book (1,002 recipes) |
| `N` | crew |
| `I` | satchel (weapons, consumables, drones) |
| `M` | route map |
| `H` | help |
| `Esc` | close panels / leave build mode |

## What you actually do

1. **Build a home on the car.** The roof is a 6×4 grid. Floors, walls, storage, beds, solar panels, med bays, drone bays, gardens, turrets and more slot into it. Every module raises your **🏠 home score**, and structural modules actually change the car's stats: armour, material cap, crew berths, power, repair rate, drone slots.
   **And the inside counts too:** press `Tab` in build mode for the x-ray interior view, where **six mount points in the cabin** take furniture (cot, stove, pantry, water tank, fridge, lamp, radio, bench, med cabinet, safe, plant, heater). Furnishing is a real upgrade — see *Inside the cabin* below.
2. **Loot the ruins.** Every zone is dotted with broken houses (or floating wrecks at sea) with glowing containers. Purpler crates are richer. Occasionally a **survivor** is hiding inside.
3. **Craft.** The book contains **1,002 recipes** split across weapons, turrets, drones, building modules, consumables and vehicle upgrades, in five tiers, gated by stations you build on the car: *Field Kit → Workbench → Advanced Workshop → Nano Lab*. Search it, filter by category/tier, or show only what you can build right now.
4. **Fight.** Raiders, brutes, gunner cars, pirates, and eventually the US Army. Turrets and drones fire automatically; you aim with the mouse. Shots eat ammo — without ammo you fire weak improvised rounds.
5. **Recruit survivors.** Each one has a role and a price:
   - 🎒 Scavenger +35% loot
   - 🔧 Engineer auto-repair + 15% cheaper crafts
   - 🎯 Gunner +35% turret damage/rate
   - 💉 Medic constant hull repair
   - 🏎️ Driver +18% speed
   - 💰 Trader +25% cash, better prices
   - 🔭 Sniper shoots on their own
   - ⚙️ Mechanic +40 armour

   They need a **berth** — build Crew Beds.
6. **Get to America.** Buy the **🛶 Raft Kit (950)** and **⛴️ Ship Engine (1500)** at the **Sunda Docks** (or craft improvised versions for a lot of materials). Sea legs also need **40 fuel** each and a hull above 30%.
7. **Final stand.** Miami is crawling with soldiers. In Washington D.C. the army throws **five waves** at your car house; the fifth is the **General's tank**. Destroy it to win.

### The route

| # | Zone | Notes |
| - | ---- | ----- |
| 01 | Kampung Ruins, Java | start, tutorial |
| 02 | Jakarta Outskirts | raider gangs |
| 03 | **Sunda Docks** | buy raft + engine here |
| 04 | Malacca Strait | open water, pirates |
| 05 | Bay of Bengal | storms |
| 06 | **Mumbai Ruins** | dock, resupply |
| 07 | Arabian Sea | long crossing |
| 08 | Atlantic Crossing | hardest water |
| 09 | **Miami Coast** | US Army patrols |
| 10 | **Washington D.C.** | 5-wave finale |

## 3D, and the character rig

Everything is drawn in real perspective:

- **Camera** — a smoothed chase camera behind the car (`Camera3D`), a low third-person camera when you are on foot, and a top-down build camera over the roof or an x-ray camera over the open cabin. Screen-shake, focal-length FOV and projection all live in `js/camera3d.js`.
- **Renderer** — `js/render.js` builds the frame from flat-shaded polygons: ground tiles with per-tile fog, roads with dashes, procedural low-poly ruins, wrecks, palms and landmarks, depth-sorted (painter's algorithm) with back-face culling, near-plane clipping and per-face sun shading. The car is modelled from ~60 boxes: chassis, cabin, glass, wheels that spin, bumpers, lights, raft floats and the wooden roof deck with its railing.
- **The rig** — the player, survivors and every humanoid enemy are built from an articulated hierarchy (pelvis → torso → head, two-segment legs, arms with a weapon in the right hand). The rig walks with a swinging gait, aims and holds the gun in front of the chest, and fires with a muzzle flash. It genuinely leaves the car: press `G`, walk around with `WASD`, shoot with the mouse, climb back in near the car. Enemy bullets can hit you on foot — get knocked down and you are dragged back behind the wheel with a dented hull.
- **Mouse picking** — the cursor is unprojected into the world: a ground-plane ray for aiming, a roof-plane ray for build cells, and a cabin-plane ray for interior mount points.

## Inside the cabin

| Item | Cost | Effect |
| ---- | ---- | ------ |
| 🛏️ Folding Cot | 25 scrap · 14 cloth | +1 crew berth, +3 comfort |
| 🔥 Camp Stove | 30 scrap · 10 fuel | +2 comfort, a little solar |
| 📦 Pantry Shelf | 40 wood · 10 scrap | +250 material cap |
| 💧 Water Tank | 35 scrap · 15 rubber | +2 comfort, slow hull repair |
| 🧊 Fridge | 10 alloy · 6 electronics | +400 cap, +1 comfort |
| 💡 Cabin Lamp | 8 wire · 6 glass | +0.6 solar, +1 comfort |
| 📻 Shortwave Radio | 10 electronics · 10 wire | +150 radar range |
| 🧰 Fold-out Bench | 45 scrap · 20 wood | −5% craft cost |
| 🩹 Med Cabinet | 10 meds · 10 scrap | hull repair |
| 🔐 Floor Safe | 18 alloy · 30 scrap | +500 cap, +10 armour |
| 🪴 Potted Plant | 8 food · 15 wood | +4 comfort |
| ♨️ Cabin Heater | 30 scrap · 12 wire | +3 comfort, +20 power |

Comfort feeds straight into the **home score** (×3), so a furnished interior is part of "the best car house". Furniture is saved with the run and can be pulled out again for half the parts.

## Systems under the hood

```
index.html            layout, HUD skeleton, panels
css/style.css         all styling (dark/amber post-apocalypse theme)
js/util.js            math, RNG, rounding, tiny WebAudio SFX
js/data.js            resources, loot tables, enemy blueprints, crew roles, shop
js/recipes.js         procedural recipe book — 1,002 unique recipes
js/world.js           10 zones, procedural ruins/wrecks/decor/landmarks
js/geo3d.js           low-poly primitives (boxes, prisms, cones, discs, rings)
js/camera3d.js        perspective camera, projection, mouse→world ray picking
js/render.js          3D renderer: depth-sorted polys, models, rig, minimap
js/game.js            simulation: driving, building, loot, craft, combat, travel, save
js/ui.js              DOM interface, crafting book, build tray, panels
js/main.js            boot + requestAnimationFrame loop
```

- **No build step.** Plain ES modules, no framework, no bundler, no WebGL, no image assets in the game itself (the menu art is the only bitmap).
- **Software 3D.** Projection, clipping, culling and painter sorting are ~350 lines; models are pushed as coloured quads into one array per frame, sorted by depth and filled with `Canvas2D`.
- **Deterministic generation.** Recipes use a seeded PRNG, so item ids are stable and save games only store ids.
- **Save game.** `localStorage` (`how_save_v2`), autosaved every 20 s, on zone changes, crafts, purchases and page unload.
- **Real physics-ish driving.** Acceleration, drag, reverse, speed-scaled steering, drifting slower on water.
- **Combat.** Bullets are entities with spread, splash, chain lightning, armour mitigation, screen shake, and power-hungry turrets.

## Dev tools

```bash
npm install          # dev-only tooling (not needed to play)
npm test             # headless jsdom smoke test: drive, loot, craft, build, sail, win,
                     # plus 3D picking, the on-foot rig, interior furniture and save/load
npm run shots        # render real frames to shots/*.png with a native canvas
node tools/perf.mjs  # frame-time / face-count sanity check
```

The smoke test boots the actual game with a fake canvas and exercises the whole loop, including UI panels and the five-wave finale.

## Tips

- Build a **Workbench** early — it unlocks tiers 2–3 of the crafting book.
- Keep a few **Repair Kits** in the satchel; hull damage is permanent until repaired.
- Storage modules raise your material cap (base 900). Over-cap loot is wasted — the interior pantry, fridge and safe raise it further.
- Step out with `G` to loot a crate on the far side of a wall; the camera follows you.
- The **DEPART** gate is at the far end of every zone (yellow arrow on the minimap).
- Don't sail without the raft — the car floods fast.
- In D.C., use the 20-second calm before wave 1 to repair and re-deploy.
- Furnishing the cabin (cot, plant, heater, radio) is the cheapest way to push the home score past 120/350/700.
