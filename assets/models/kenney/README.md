# Kenney models (CC0)

`train-locomotive.obj` and `colormap.png` come from the **Kenney Holiday Kit 2.0**
(<https://www.kenney.nl>), released under **Creative Commons Zero 1.0** —
<https://creativecommons.org/publicdomain/zero/1.0/>. CC0 puts the work in the
public domain: personal, educational and commercial use, no attribution
required. Credit is given here anyway because Kenney's kits are excellent.

The kit ships one material whose texture is a colour atlas; every face carries
UVs into it. `tools/import-obj.mjs` samples that atlas per face, triangulates,
merges coplanar triangles back into quads, drops sub-pixel facets, then centres
and scales the model into car units. Output lives in `js/models/locomotive.js`
and is drawn by `drawMesh()` in `js/render.js` as the engine nose of the wagon.

Only the locomotive is used at the moment. The same kit also contains:

* `train-wagon.obj` — a closed passenger carriage
* `train-wagon-flat.obj` — an open flatbed with stake posts
* `train-tender.obj`, `trainset-rail-*.obj` — tender and track pieces

Drop any of them into this folder and add a job to `JOBS` in
`tools/import-obj.mjs` to bake them the same way.
