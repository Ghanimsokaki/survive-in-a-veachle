# Bought hulls (drop folder)

> **The courier already flies a real model.** The Aurora-class ships with the CC0
> *Dispatcher* hull in `skyuss/assets/models/quaternius/`. This folder is only for a
> hull **you** bought, and it takes priority over that one. The Kang-class dreadnought
> has no committed mesh at all — it flies its procedural hull until a file lands here.

The shipyard sells the **Aurora-class courier**, modelled after the free TurboSquid
*"Avrora" Sci-Fi Spaceship* (product 1577480, TurboSquid Royalty Free licence).

TurboSquid's licence allows a bought model **inside** a game but not redistribution of
the model file, so the file never lives in this repository. The folder is git-ignored.

## Using the real mesh

The game only ships a dependency-free **OBJ** reader, so export from Blender first:
*File ▸ Export ▸ Wavefront (.obj)* (selection only, apply modifiers). `.blend`, `.fbx`
and `.glb` cannot be read here.

| Shipyard hull | Drop the OBJ here as | Loader length |
| --- | --- | --- |
| Aurora-class courier | `avrora.obj` (or `aurora.obj`) | 30 m |
| Kang-class dreadnought | `kang.obj` (or `kang_dreadnought.obj`) | 62 m |

**The Kang slot is where the USS Vengeance goes.** `model.fbx` in the owner's library is the
Dreadnought-class Vengeance, and it is the good one — export it to OBJ and it flies as the
player's 9,000 ¢ dreadnought. Nothing about that file is committed; this folder stays ignored.

1. Buy + download the hull you want (e.g. the *"Avrora"*
   <https://www.turbosquid.com/3d-models/space-spaceship-sci-fi-3d-1577480>) and export the **OBJ**.
2. Drop it here under the name above — or run the importer, which validates the mesh,
   copies it into place and tells you what the game will do:
   `node skyuss/tools/import-hull.mjs --in ~/Downloads/ship.obj --hull kang`
3. Reload the game, open the shipyard (`Y`), buy that hull.

The loader centres the mesh on the flight origin and fits its longest axis to the length
above. If the model's nose points −Z, it will fly backwards until you add `rotY: Math.PI`
where `adoptPremiumHull()` calls `setPremium()` in `skyuss/js/main.js`.

`js/premium.js` parses the OBJ, centres and scales it to ~30 m, and hangs it on the
flight group — the engine glows, nacelle flashes, running lights and shield bubble
keep working because the procedural hull's `userData.parts` contract stays in place.

With no file present the game flies the procedural Aurora stand-in from
`js/aurora.js`, so nothing breaks and no licence is involved.
