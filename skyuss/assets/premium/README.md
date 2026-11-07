# Bought hulls (drop folder)

The shipyard sells the **Aurora-class courier**, modelled after the free TurboSquid
*"Avrora" Sci-Fi Spaceship* (product 1577480, TurboSquid Royalty Free licence).

TurboSquid's licence allows a bought model **inside** a game but not redistribution of
the model file, so the file never lives in this repository. The folder is git-ignored.

## Using the real mesh

1. Download the "Avrora" hull from <https://www.turbosquid.com/3d-models/space-spaceship-sci-fi-3d-1577480>
   and export/keep the **OBJ**.
2. Save it here as `avrora.obj` (or `aurora.obj`).
3. Reload the game and buy the courier in the shipyard (`Y`).

`js/premium.js` parses the OBJ, centres and scales it to ~30 m, and hangs it on the
flight group — the engine glows, nacelle flashes, running lights and shield bubble
keep working because the procedural hull's `userData.parts` contract stays in place.

With no file present the game flies the procedural Aurora stand-in from
`js/aurora.js`, so nothing breaks and no licence is involved.
