# Dispatcher — the bought hull

| | |
| --- | --- |
| **Model** | *Dispatcher*, from the **Ultimate Spaceships Pack** by [Quaternius](https://quaternius.com/packs/ultimatespaceships.html) |
| **Licence** | **CC0 1.0 Universal** (public domain) — see `LICENSE.txt` |
| **Source used** | <https://github.com/yolanother/QuaterniusUltimateSpaceships> (pack mirror, `Dispatcher/OBJ/Dispatcher.obj`) |
| **Formats in the pack** | OBJ, FBX, Blend, glTF |
| **Files here** | `dispatcher.obj` (untouched 51 KB OBJ, 733 UVs / 350 faces), `dispatcher_blue.jpg` |
| **Changes** | the 2048×2048 palette atlas `Dispatcher_Blue.png` was re-encoded as a 512×512 JPEG (2.5 MB → 59 KB) so a browser can load it; geometry is original |

This is the mesh behind the **Aurora-class courier** in the shipyard: it is loaded at
runtime by `skyuss/js/premium.js`, centred and scaled to ~30 m, and hung on the same
flight group the procedural hulls use, so the engine glows, running lights and shield
bubble keep working.

CC0 means this file may be committed to the repo (unlike a TurboSquid purchase).
If the player also drops a bought `avrora.obj` into `skyuss/assets/premium/`, that
mesh takes priority over this one.

Credit: **Quaternius — Ultimate Spaceships Pack (CC0 1.0)**.
