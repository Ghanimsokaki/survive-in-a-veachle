// SKYUSS — Three.js presentation layer. The simulation lives in sim.js; this
// file owns the renderer, the cloud sea, the camera rig and every input.

import * as THREE from '../vendor/three.module.js';
import { SkyGame } from './sim.js';
import { buildEnterprise } from './enterprise.js';
import { buildFort, buildFortGrid } from './fort.js';
import { buildIsland, buildDerelict, buildStorm, buildHomeBeacon } from './world.js';
import { UI } from './ui.js';
import { SkyAudio } from './audio.js';
import { FORT, PIECE_ORDER } from './config.js';

const SAVE_KEY = 'skyuss_v1';

// ------------------------------------------------------------------ renderer
const canvas = document.getElementById('sky');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  UI.fatal('WebGL could not start: ' + (err && err.message ? err.message : 'unknown error'));
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x9dc4e6, 0.0016);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 4000);
camera.position.set(0, 90, 260);

// ------------------------------------------------------------------- lights
const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x24323f, 1.05);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0cf, 2.4);
sun.position.set(140, 240, 110);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 20;
sun.shadow.camera.far = 700;
sun.shadow.camera.left = -180;
sun.shadow.camera.right = 180;
sun.shadow.camera.top = 180;
sun.shadow.camera.bottom = -180;
sun.shadow.bias = -0.0006;
scene.add(sun);
scene.add(sun.target);
const rim = new THREE.DirectionalLight(0x6f9fe0, 0.7);
rim.position.set(-160, 60, -140);
scene.add(rim);

// ------------------------------------------------------------------ sky dome
const skyMat = new THREE.ShaderMaterial({
  uniforms: {
    topColor: { value: new THREE.Color('#123c74') },
    midColor: { value: new THREE.Color('#7fb7e8') },
    bottomColor: { value: new THREE.Color('#e8f4ff') },
    offset: { value: 180 },
  },
  vertexShader: `
    varying vec3 vWorld;
    void main() {
      vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform vec3 topColor; uniform vec3 midColor; uniform vec3 bottomColor; uniform float offset;
    varying vec3 vWorld;
    void main() {
      float h = normalize(vWorld + vec3(0.0, offset, 0.0)).y;
      vec3 col = mix(bottomColor, midColor, smoothstep(-0.1, 0.28, h));
      col = mix(col, topColor, smoothstep(0.22, 0.85, h));
      gl_FragColor = vec4(col, 1.0);
    }`,
  side: THREE.BackSide,
  depthWrite: false,
  fog: false,
});
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(2200, 32, 20), skyMat);
scene.add(skyDome);

// ------------------------------------------------------------- cloud textures
function radialTexture(size, stops) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [p, col] of stops) g.addColorStop(p, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function cloudNoiseTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = 4 + Math.random() * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.03 + Math.random() * 0.06;
    g.addColorStop(0, `rgba(196,214,236,${a})`);
    g.addColorStop(1, 'rgba(196,214,236,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 14);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const puffTex = radialTexture(128, [
  [0, 'rgba(255,255,255,0.95)'],
  [0.45, 'rgba(236,246,255,0.55)'],
  [1, 'rgba(226,240,255,0)'],
]);
const sparkTex = radialTexture(64, [
  [0, 'rgba(255,255,255,1)'],
  [0.4, 'rgba(150,230,255,0.7)'],
  [1, 'rgba(120,200,255,0)'],
]);

// --------------------------------------------------------------- cloud sea
// Three layers: a soft deck below, two drifting puff fields above it.
const cloudGroup = new THREE.Group();
scene.add(cloudGroup);

const deckTex = cloudNoiseTexture();
const deck = new THREE.Mesh(
  new THREE.PlaneGeometry(4200, 4200, 1, 1),
  new THREE.MeshBasicMaterial({ map: deckTex, transparent: true, opacity: 0.95, depthWrite: false, fog: true }),
);
deck.rotation.x = -Math.PI / 2;
deck.position.y = -52;
cloudGroup.add(deck);

const deck2 = new THREE.Mesh(
  new THREE.PlaneGeometry(4200, 4200, 1, 1),
  new THREE.MeshBasicMaterial({ map: deckTex, transparent: true, opacity: 0.5, depthWrite: false, fog: true, color: 0xbcd7f2 }),
);
deck2.rotation.x = -Math.PI / 2;
deck2.position.y = -30;
cloudGroup.add(deck2);

function makePuffField(count, spread, yMin, yMax, sizeMin, sizeMax, opacity) {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * spread;
    positions[i * 3 + 1] = yMin + Math.random() * (yMax - yMin);
    positions[i * 3 + 2] = (Math.random() - 0.5) * spread;
    sizes[i] = sizeMin + Math.random() * (sizeMax - sizeMin);
    phases[i] = Math.random() * Math.PI * 2;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: puffTex },
      uOpacity: { value: opacity },
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
    },
    vertexShader: `
      attribute float aSize; attribute float aPhase;
      varying float vAlpha; uniform float uTime; uniform float uPixelRatio;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.12 + aPhase) * 8.0;
        p.z += cos(uTime * 0.09 + aPhase * 1.3) * 8.0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = min(340.0, aSize * uPixelRatio * (120.0 / max(-mv.z, 1.0)));
        vAlpha = smoothstep(1400.0, 120.0, -mv.z);
      }`,
    fragmentShader: `
      uniform sampler2D uTex; uniform float uOpacity; varying float vAlpha;
      void main() {
        vec4 t = texture2D(uTex, gl_PointCoord);
        gl_FragColor = vec4(t.rgb, t.a * uOpacity * vAlpha);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

const puffLow = makePuffField(1400, 1500, -60, 10, 45, 130, 0.55);
const puffHigh = makePuffField(700, 1700, 60, 210, 70, 190, 0.32);
cloudGroup.add(puffLow, puffHigh);

// ------------------------------------------------------------- particle bursts
const PARTICLE_MAX = 900;
const partPos = new Float32Array(PARTICLE_MAX * 3);
const partCol = new Float32Array(PARTICLE_MAX * 3);
const partSize = new Float32Array(PARTICLE_MAX);
const partAlpha = new Float32Array(PARTICLE_MAX);
const partVel = new Float32Array(PARTICLE_MAX * 3);
const partLife = new Float32Array(PARTICLE_MAX);
const partMax = new Float32Array(PARTICLE_MAX);
let partCursor = 0;

const partGeo = new THREE.BufferGeometry();
partGeo.setAttribute('position', new THREE.BufferAttribute(partPos, 3));
partGeo.setAttribute('aColor', new THREE.BufferAttribute(partCol, 3));
partGeo.setAttribute('aSize', new THREE.BufferAttribute(partSize, 1));
partGeo.setAttribute('aAlpha', new THREE.BufferAttribute(partAlpha, 1));
const partMat = new THREE.ShaderMaterial({
  uniforms: { uTex: { value: puffTex } },
  vertexShader: `
    attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
    varying vec3 vColor; varying float vAlpha;
    void main() {
      vColor = aColor; vAlpha = aAlpha;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = min(260.0, aSize * (340.0 / max(-mv.z, 1.0)));
    }`,
  fragmentShader: `
    uniform sampler2D uTex; varying vec3 vColor; varying float vAlpha;
    void main() {
      float a = texture2D(uTex, gl_PointCoord).a * vAlpha;
      if (a < 0.01) discard;
      gl_FragColor = vec4(vColor, a);
    }`,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const particleField = new THREE.Points(partGeo, partMat);
particleField.frustumCulled = false;
scene.add(particleField);

const _pc = new THREE.Color();
function spawnParticles(x, y, z, count, color, speed, size, life) {
  _pc.set(color);
  for (let i = 0; i < count; i++) {
    const idx = partCursor = (partCursor + 1) % PARTICLE_MAX;
    const i3 = idx * 3;
    partPos[i3] = x; partPos[i3 + 1] = y; partPos[i3 + 2] = z;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const s = speed * (0.35 + Math.random() * 0.65);
    partVel[i3] = Math.sin(phi) * Math.cos(theta) * s;
    partVel[i3 + 1] = Math.cos(phi) * s;
    partVel[i3 + 2] = Math.sin(phi) * Math.sin(theta) * s;
    partCol[i3] = _pc.r; partCol[i3 + 1] = _pc.g; partCol[i3 + 2] = _pc.b;
    partSize[idx] = size * (0.6 + Math.random() * 0.8);
    partLife[idx] = life * (0.7 + Math.random() * 0.5);
    partMax[idx] = partLife[idx];
    partAlpha[idx] = 1;
  }
  partGeo.attributes.position.needsUpdate = true;
  partGeo.attributes.aColor.needsUpdate = true;
  partGeo.attributes.aSize.needsUpdate = true;
  partGeo.attributes.aAlpha.needsUpdate = true;
}

function updateParticles(dt) {
  let any = false;
  for (let i = 0; i < PARTICLE_MAX; i++) {
    if (partLife[i] <= 0) { if (partAlpha[i] !== 0) { partAlpha[i] = 0; any = true; } continue; }
    const i3 = i * 3;
    partLife[i] -= dt;
    partPos[i3] += partVel[i3] * dt;
    partPos[i3 + 1] += partVel[i3 + 1] * dt;
    partPos[i3 + 2] += partVel[i3 + 2] * dt;
    partVel[i3] *= 0.955; partVel[i3 + 1] *= 0.955; partVel[i3 + 2] *= 0.955;
    partAlpha[i] = Math.max(0, partLife[i] / Math.max(0.001, partMax[i]));
    any = true;
  }
  if (any) {
    partGeo.attributes.position.needsUpdate = true;
    partGeo.attributes.aAlpha.needsUpdate = true;
  }
}

// ----------------------------------------------------------------- world meshes
const worldGroup = new THREE.Group();
scene.add(worldGroup);
const homeBeacon = buildHomeBeacon(THREE);
scene.add(homeBeacon);

const beamGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const beamMat = new THREE.LineBasicMaterial({ color: '#7ef0ff', transparent: true, opacity: 0.7 });
const tractorBeam = new THREE.Line(beamGeo, beamMat);
tractorBeam.visible = false;
tractorBeam.frustumCulled = false;
scene.add(tractorBeam);

// ------------------------------------------------------------------- gameplay
let game = null;
let shipMesh = null;
let fortMesh = null;
let gridMesh = null;
let shipSig = '';
let fortSig = '';
let started = false;
let paused = false;

const state = {
  keys: {},
  mouseDown: false,
  aim: new THREE.Vector3(0, 0, -1),
  orbit: { yaw: 0, pitch: 0, dist: 56 },
  dragging: false,
  lastPointer: { x: 0, y: 0 },
  ndc: new THREE.Vector2(0, 0),
  buildMode: false,
  hoverCell: null,
  shake: 0,
};

const audio = new SkyAudio();

const boltMeshes = new Map();     // bolt object → mesh
const enemyMeshes = new Map();    // enemy id → group
const pickupMeshes = new Map();   // pickup object → mesh
const boltGeo = new THREE.SphereGeometry(0.9, 8, 6);
const missileGeo = new THREE.CapsuleGeometry(0.7, 2.6, 6, 8);
const boltMats = new Map();

function boltMaterial(color) {
  if (!boltMats.has(color)) {
    boltMats.set(color, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }));
  }
  return boltMats.get(color);
}

function disposeGroup(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material.dispose();
    }
  });
  if (obj.parent) obj.parent.remove(obj);
}

// ------------------------------------------------------------------ the ship
function rebuildShipMesh() {
  if (shipMesh) disposeGroup(shipMesh);
  shipMesh = buildEnterprise(THREE, game.ship);
  scene.add(shipMesh);
  shipSig = JSON.stringify(game.ship.tiers);
}

function rebuildFort() {
  if (fortMesh) disposeGroup(fortMesh);
  fortMesh = buildFort(THREE, game.fort);
  scene.add(fortMesh);
  fortSig = game.fort.count + ':' + [...game.fort.cells.values()].map((c) => c.kind).join('');
  if (!gridMesh) {
    gridMesh = buildFortGrid(THREE, game.fort);
    gridMesh.visible = false;
    scene.add(gridMesh);
  }
}

function buildWorldMeshes() {
  worldGroup.clear();
  for (const island of game.world.islands) worldGroup.add(buildIsland(THREE, island));
  for (const d of game.world.derelicts) {
    const m = buildDerelict(THREE, d);
    m.userData.derelict = d;
    worldGroup.add(m);
  }
  for (const s of game.world.storms) {
    const m = buildStorm(THREE, s);
    m.userData.storm = s;
    worldGroup.add(m);
  }
}

// ------------------------------------------------------------------ game boot
function startGame(resume) {
  const saved = loadSave();
  game = resume && saved ? saved : new SkyGame();
  started = true;
  paused = false;
  state.buildMode = false;

  buildWorldMeshes();
  rebuildShipMesh();
  rebuildFort();
  homeBeacon.position.set(game.fort.x, game.fort.y - 2, game.fort.z);

  audio.init();
  audio.resume();
  audio.setEnabled(audio.enabled);
  UI.showMenu(false);
  UI.showHUD(true);
  UI.close();
  UI.banner('EXPEDITION LAUNCH', 'Fly out, strip the derelicts, bank it at the fortress.', 4200);
  UI.toast('Press <b>H</b> for the flight manual · <b>B</b> builds the fort · <b>U</b> refits the Enterprise.', '', 6500);
  syncCamera(0, true);
  persist();
}

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return SkyGame.fromJSON(JSON.parse(raw));
  } catch (e) {
    return null;
  }
}

let saveTimer = 0;
function persist() {
  if (!game) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(game.toJSON())); } catch (e) { /* private mode */ }
}

UI.init({
  start: (resume) => startGame(resume),
  action: (act) => {
    if (!game) return;
    if (act === 'build') toggleBuild();
    else if (act === 'tiers') UI.toggle('tiers', game);
    else if (act === 'help') UI.toggle('help', game);
    else if (act === 'warp') { if (game.warp()) state.shake = 0.6; }
    else if (act === 'interact') doInteract();
    else if (act === 'fire') { game.fire(); }
    else if (act === 'torpedo') game.fireTorpedo();
    else if (act === 'buildall') bulkBuild();
    else if (act === 'sound') {
      const on = audio.toggle();
      UI.toast(on ? '🔊 Audio on' : '🔇 Audio muted', '');
      UI.setSoundIcon(on);
    }
  },
  buildAll: () => bulkBuild(),
  upgrade: (component) => {
    const res = game.upgrade(component);
    if (res.ok) {
      rebuildShipMesh();
      UI.banner('REFIT COMPLETE', res.name + ' installed.', 2600);
      state.shake = 0.8;
      persist();
    }
    UI.refreshTiers(game);
  },
  onPiece: () => {},
  onOpen: (name) => {
    if (name === 'build') enterBuild();
  },
  onClose: () => { exitBuild(); },
});

UI.showMenu(true, !!loadSave());

function toggleBuild() {
  if (UI.panel === 'build') { UI.close(); return; }
  if (UI.panel) UI.close();
  UI.openBuild(game);
}

function enterBuild() {
  state.buildMode = true;
  if (gridMesh) gridMesh.visible = true;
  if (game) game.buildMode = true;
}

function exitBuild() {
  state.buildMode = false;
  if (gridMesh) gridMesh.visible = false;
  if (game) game.buildMode = false;
  state.hoverCell = null;
}

function bulkBuild() {
  if (!game) return;
  const res = game.placeAll(UI.piece);
  if (game.fort.count) {
    rebuildFort();
    UI.refreshBuild(game);
    persist();
  }
  if (res.ok) UI.toast(`⚡ Built <b>${res.placed}</b> × ${UI.piece}.`, 'good');
  return res;
}

function doInteract() {
  const res = game.interact();
  if (res && res.ok) {
    rebuildFort();
    persist();
  }
}

// -------------------------------------------------------------------- input
function keyName(e) { return e.code || e.key; }

window.addEventListener('keydown', (e) => {
  if (!game) return;
  const k = keyName(e);
  state.keys[k] = true;
  if (k === 'KeyB') { toggleBuild(); e.preventDefault(); }
  else if (k === 'KeyU') { UI.toggle('tiers', game); e.preventDefault(); }
  else if (k === 'KeyH') { UI.toggle('help', game); e.preventDefault(); }
  else if (k === 'KeyF') { if (game.warp()) state.shake = 0.5; }
  else if (k === 'KeyE') doInteract();
  else if (k === 'KeyO') {
    const on = audio.toggle();
    UI.toast(on ? '🔊 Audio on' : '🔇 Audio muted', '');
    UI.setSoundIcon(on);
  }
  else if (k === 'Escape') { if (UI.panelOpen()) UI.close(); }
  else if (state.buildMode && /^Digit[1-8]$/.test(k)) {
    const idx = parseInt(k.slice(5), 10) - 1;
    if (PIECE_ORDER[idx]) UI.pickPiece(PIECE_ORDER[idx]);
  }
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
});
window.addEventListener('keyup', (e) => { state.keys[keyName(e)] = false; });
window.addEventListener('blur', () => { state.keys = {}; state.mouseDown = false; });

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  if (!game) return;
  if (UI.modalOpen()) return;
  if (e.button === 0) {
    if (state.buildMode) {
      placeHovered();
    } else {
      state.mouseDown = true;
      state.dragging = true;
      state.lastPointer = { x: e.clientX, y: e.clientY };
    }
  } else if (e.button === 2) {
    if (state.buildMode) removeHovered();
    else game.fireTorpedo();
  }
  canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointerup', (e) => {
  if (e.button === 0) { state.mouseDown = false; state.dragging = false; }
});

canvas.addEventListener('pointermove', (e) => {
  state.ndc.x = (e.clientX / window.innerWidth) * 2 - 1;
  state.ndc.y = -(e.clientY / window.innerHeight) * 2 + 1;
  if (state.dragging && !state.buildMode) {
    const dx = e.clientX - state.lastPointer.x;
    const dy = e.clientY - state.lastPointer.y;
    state.orbit.yaw -= dx * 0.004;
    state.orbit.pitch = THREE.MathUtils.clamp(state.orbit.pitch + dy * 0.003, -0.5, 0.9);
    state.lastPointer = { x: e.clientX, y: e.clientY };
  }
});

canvas.addEventListener('wheel', (e) => {
  state.orbit.dist = THREE.MathUtils.clamp(state.orbit.dist + e.deltaY * 0.03, 16, 70);
  e.preventDefault();
}, { passive: false });

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  if (puffLow) {
    puffLow.material.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, 2);
    puffHigh.material.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, 2);
  }
});

// ------------------------------------------------------------- build placement
const raycaster = new THREE.Raycaster();
const buildPlane = new THREE.Plane();

function cellAtPointer() {
  if (!game) return null;
  raycaster.setFromCamera(state.ndc, camera);
  buildPlane.set(new THREE.Vector3(0, 1, 0), -game.fort.y);
  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(buildPlane, hit)) return null;
  const half = (FORT.size - 1) / 2;
  const ix = Math.round((hit.x - game.fort.x) / FORT.cell + half);
  const iz = Math.round((hit.z - game.fort.z) / FORT.cell + half);
  if (ix < 0 || iz < 0 || ix >= FORT.size || iz >= FORT.size) return null;
  return { ix, iz };
}

function placeHovered() {
  const cell = cellAtPointer();
  if (!cell) return;
  const res = game.placePiece(cell.ix, cell.iz, UI.piece);
  if (res.ok) {
    rebuildFort();
    UI.refreshBuild(game);
    persist();
  }
  // keep the build panel open so the player can chain pieces
}

function removeHovered() {
  const cell = cellAtPointer();
  if (!cell) return;
  const res = game.removePiece(cell.ix, cell.iz);
  if (res.ok) {
    rebuildFort();
    UI.refreshBuild(game);
    persist();
  }
}

// --------------------------------------------------------------- frame logic
function buildInput(dt) {
  const k = state.keys;
  const input = {
    forward: !!k.KeyW,
    back: !!(k.KeyS),
    yaw: (k.KeyA ? 1 : 0) - (k.KeyD ? 1 : 0),
    pitch: (k.ArrowUp ? 1 : 0) - (k.ArrowDown ? 1 : 0),
    up: !!(k.Space),
    down: !!(k.KeyC || k.ControlLeft || k.ControlRight),
    boost: !!(k.ShiftLeft || k.ShiftRight),
    fire: state.mouseDown || !!k.KeyJ,
    torpedo: !!k.KeyK,
  };
  return input;
}

function updateAim() {
  if (!game) return;
  // aim from the camera through the pointer, then from the ship toward that ray
  raycaster.setFromCamera(state.ndc, camera);
  const origin = raycaster.ray.origin;
  const dir = raycaster.ray.direction;
  const target = origin.clone().addScaledVector(dir, 400);
  const from = new THREE.Vector3(game.pos.x, game.pos.y, game.pos.z);
  const aim = target.sub(from).normalize();
  game.aim = { x: aim.x, y: aim.y, z: aim.z };
  state.aim.copy(aim);
}

function syncCamera(dt, snap = false) {
  if (!game) return;
  const shipPos = new THREE.Vector3(game.pos.x, game.pos.y, game.pos.z);
  const elev = 0.2 + state.orbit.pitch;
  const yaw = game.yaw + Math.PI + state.orbit.yaw;
  const d = state.orbit.dist * (1 + (game.warpActive > 0 ? 0.35 : 0));
  const desired = new THREE.Vector3(
    shipPos.x + Math.sin(yaw) * d * Math.cos(elev),
    shipPos.y + Math.sin(elev) * d + 6,
    shipPos.z + Math.cos(yaw) * d * Math.cos(elev),
  );
  if (snap) camera.position.copy(desired);
  else camera.position.lerp(desired, Math.min(1, dt * 4.2));

  const look = shipPos.clone();
  look.y += 2;
  look.addScaledVector(new THREE.Vector3(Math.sin(game.yaw), 0, Math.cos(game.yaw)), 16);
  camera.lookAt(look);

  // shake + warp FOV punch
  if (state.shake > 0) {
    camera.position.x += (Math.random() - 0.5) * state.shake * 3;
    camera.position.y += (Math.random() - 0.5) * state.shake * 3;
    state.shake = Math.max(0, state.shake - dt * 2.6);
  }
  const wantFov = 60 + (game.warpActive > 0 ? 16 : 0) + Math.min(6, Math.abs(game.speed) * 0.06);
  camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 4);
  camera.updateProjectionMatrix();
}

const EFFECT_LOOK = {
  boom: { color: '#ffb457', count: 26, speed: 34, size: 3.4, life: 1.0, particles: true },
  hit: { color: '#ff8a96', count: 10, speed: 20, size: 2.2, life: 0.55, particles: true },
  muzzle: { color: '#9ff3ff', count: 7, speed: 16, size: 1.8, life: 0.28, particles: true },
  warp: { color: '#b9a4ff', count: 34, speed: 46, size: 3.0, life: 0.9, particles: true },
  build: { color: '#ffd98a', count: 12, speed: 14, size: 2.0, life: 0.6, particles: true },
  loot: { color: '#8ef0c0', count: 14, speed: 18, size: 2.0, life: 0.7, particles: true },
};

function consumeEffects() {
  if (!game || !game.effects) return;
  for (const e of game.effects) {
    if (e._seen) continue;
    e._seen = true;
    const look = EFFECT_LOOK[e.kind] || EFFECT_LOOK.hit;
    if (look.particles) {
      spawnParticles(e.x, e.y, e.z, look.count, look.color, look.speed * (e.size || 1), look.size, look.life);
    }
    if (e.kind === 'boom') audio.explosion(Math.min(2, e.size || 1));
    else if (e.kind === 'muzzle') audio.phaser();
    else if (e.kind === 'warp') audio.warp();
    else if (e.kind === 'build') audio.build();
    else if (e.kind === 'loot') audio.pickup();
    else if (e.kind === 'hit') { audio.hit(); UI.flash(); }
  }
}

function syncBeam() {
  if (!game) return;
  // tractor beam: ship → nearest loot, derelict or the fortress while docking
  let target = null;
  let best = 120;
  for (const p of game.pickups) {
    const d = Math.hypot(p.pos.x - game.pos.x, p.pos.y - game.pos.y, p.pos.z - game.pos.z);
    if (d < best) { best = d; target = p.pos; }
  }
  if (!target) {
    const d = game.nearDerelict;
    if (d) target = { x: d.x, y: d.y, z: d.z };
  }
  if (!target && game.nearFort && game.cargoTotal > 0) {
    target = { x: game.fort.x, y: game.fort.y + 6, z: game.fort.z };
  }
  if (target) {
    const arr = beamGeo.attributes.position.array;
    arr[0] = game.pos.x; arr[1] = game.pos.y; arr[2] = game.pos.z;
    arr[3] = target.x; arr[4] = target.y; arr[5] = target.z;
    beamGeo.attributes.position.needsUpdate = true;
    beamMat.opacity = 0.35 + Math.sin(game.t * 14) * 0.25;
    tractorBeam.visible = true;
  } else {
    tractorBeam.visible = false;
  }
}

function syncShip(dt) {
  if (!shipMesh) return;
  shipMesh.position.set(game.pos.x, game.pos.y, game.pos.z);
  shipMesh.rotation.order = 'YXZ';
  shipMesh.rotation.y = game.yaw;
  shipMesh.rotation.x = -game.pitch;
  shipMesh.rotation.z = -game.roll;
  const parts = shipMesh.userData.parts;
  const pulse = 1 + Math.sin(game.t * 6) * 0.07 + (game.boost || 0) * 0.25;
  for (const nac of parts.nacelles) {
    nac.bussard.scale.setScalar(pulse);
    for (const m of nac.coils) m.material.opacity = 0.75 + Math.sin(game.t * 5 + m.position.z) * 0.2;
  }
  for (const b of parts.banks) b.visible = game.fireCd < 1 / game.ship.stats.fireRate * 0.55;
  if (parts.shieldBubble) {
    parts.shieldBubble.visible = game.shields > 0.5;
    parts.shieldBubble.rotation.y = game.t * 0.3;
    parts.shieldBubble.material.opacity = 0.05 + (game.shields / game.ship.stats.maxShields) * 0.09;
  }
  if (parts.dish) parts.dish.rotation.z = Math.sin(game.t * 0.8) * 0.06;
  state.shake = Math.max(state.shake, game.hitFlash || 0);
}

function syncBolts() {
  const alive = new Set();
  for (const b of game.bolts) {
    alive.add(b);
    let mesh = boltMeshes.get(b);
    if (!mesh) {
      mesh = new THREE.Mesh(b.kind === 'torpedo' || b.kind === 'missile' ? missileGeo : boltGeo, boltMaterial(b.color || '#8ef2ff'));
      mesh.userData.missile = b.kind === 'torpedo' || b.kind === 'missile';
      scene.add(mesh);
      boltMeshes.set(b, mesh);
    }
    mesh.position.set(b.pos.x, b.pos.y, b.pos.z);
    if (mesh.userData.missile) {
      const v = new THREE.Vector3(b.vel.x, b.vel.y, b.vel.z).normalize();
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
      mesh.scale.setScalar(1);
    } else {
      const v = new THREE.Vector3(b.vel.x, b.vel.y, b.vel.z).normalize();
      mesh.scale.set(1, 1, 2.6);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), v);
    }
  }
  for (const [b, mesh] of boltMeshes) {
    if (!alive.has(b)) {
      scene.remove(mesh);
      boltMeshes.delete(b);
    }
  }
}

function syncEnemies() {
  const seen = new Set();
  for (const e of game.enemies) {
    if (e.hp <= 0) continue;
    seen.add(e.id);
    let g = enemyMeshes.get(e.id);
    if (!g) {
      g = makePirate(e);
      scene.add(g);
      enemyMeshes.set(e.id, g);
    }
    g.position.set(e.pos.x, e.pos.y, e.pos.z);
    g.rotation.y = e.yaw;
    g.rotation.z = Math.sin(game.t * 2 + e.pos.x * 0.01) * 0.08;
    const glowMat = g.userData.glow;
    if (glowMat) glowMat.opacity = 0.5 + Math.sin(game.t * 7 + e.pos.x) * 0.3;
  }
  for (const [id, g] of enemyMeshes) {
    if (!seen.has(id)) {
      disposeGroup(g);
      enemyMeshes.delete(id);
    }
  }
}

function makePirate(e) {
  const g = new THREE.Group();
  const s = e.def.size;
  const hull = new THREE.MeshStandardMaterial({ color: '#3b2a2a', metalness: 0.7, roughness: 0.55, flatShading: true });
  const trim = new THREE.MeshStandardMaterial({ color: '#8a3b3b', metalness: 0.6, roughness: 0.5, flatShading: true });
  const body = new THREE.Mesh(new THREE.BoxGeometry(4 * s, 1.6 * s, 7 * s), hull);
  g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.9 * s, 3.4 * s, 6), trim);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = 4.6 * s;
  g.add(nose);
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(3.6 * s, 0.5 * s, 2.4 * s), trim);
    wing.position.set(side * 3 * s, 0, -0.6 * s);
    wing.rotation.z = side * 0.22;
    g.add(wing);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.4 * s, 2.2 * s, 1.6 * s), hull);
    fin.position.set(side * 1.6 * s, 1.1 * s, -2.4 * s);
    g.add(fin);
  }
  const glowMat = new THREE.MeshBasicMaterial({ color: '#ff4d5e', transparent: true, opacity: 0.7 });
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.9 * s, 10, 8), glowMat);
  glow.position.z = -3.4 * s;
  g.add(glow);
  g.userData.glow = glowMat;
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

function syncPickups() {
  const alive = new Set();
  for (const p of game.pickups) {
    alive.add(p);
    let m = pickupMeshes.get(p);
    if (!m) {
      const color = p.kind === 'matrix' ? '#c4a8ff' : p.kind === 'dilithium' ? '#67e0ff' : '#8fd1a0';
      m = new THREE.Mesh(
        new THREE.OctahedronGeometry(2.2, 0),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6, roughness: 0.2 }),
      );
      scene.add(m);
      pickupMeshes.set(p, m);
    }
    m.position.set(p.pos.x, p.pos.y + Math.sin(game.t * 2 + p.phase) * 1.5, p.pos.z);
    m.rotation.y += 0.02;
    m.rotation.x += 0.01;
  }
  for (const [p, m] of pickupMeshes) {
    if (!alive.has(p)) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); pickupMeshes.delete(p); }
  }
}

function syncFort(dt) {
  const sig = game.fort.count + ':' + [...game.fort.cells.values()].map((c) => c.kind).join('');
  if (sig !== fortSig) rebuildFort();
  if (!fortMesh) return;
  fortMesh.position.set(0, 0, 0);
  // aim turret meshes
  const parts = fortMesh.userData.parts;
  for (const t of parts.turrets) {
    const key = t.cell.ix + ',' + t.cell.iz;
    const aim = game.fort.turretAngle.get(key);
    if (aim !== undefined) t.group.rotation.y = aim;
  }
  const pulse = 1 + Math.sin(game.t * 2.4) * 0.06;
  for (const c of parts.crystals) c.rotation.y += dt * 0.8;
  for (const p of parts.pylons) p.scale.setScalar(pulse);
  if (gridMesh) {
    gridMesh.position.set(game.fort.x, game.fort.y, game.fort.z);
    const cell = state.buildMode ? cellAtPointer() : null;
    const hl = gridMesh.userData.highlight;
    const ghost = gridMesh.userData.ghost;
    if (cell) {
      const p = game.fort.worldPos(cell.ix, cell.iz);
      hl.position.set(p.x - game.fort.x, 0.7, p.z - game.fort.z);
      ghost.position.set(p.x - game.fort.x, 0.3, p.z - game.fort.z);
      const check = game.fort.canPlace(cell.ix, cell.iz, UI.piece, game.bank);
      hl.material.color.set(check.ok ? '#7ef0ff' : '#ff6b7a');
      hl.visible = ghost.visible = true;
    } else {
      hl.visible = ghost.visible = false;
    }
  }
}

function syncWorld(dt) {
  homeBeacon.rotation.y += dt * 0.2;
  for (const obj of worldGroup.children) {
    const d = obj.userData.derelict;
    if (d) {
      obj.rotation.y += dt * 0.02;
      if (d.looted) obj.visible = Math.sin(game.t * 6) > -0.6;
    }
    const s = obj.userData.storm;
    if (s) {
      obj.rotation.y += dt * 0.35;
      obj.userData.ringA.rotation.z += dt * 0.6;
      obj.userData.ringB.rotation.x += dt * 0.4;
      obj.userData.points.material.opacity = 0.45 + Math.sin(game.t * 1.6 + s.phase) * 0.2;
    }
    const beacon = obj.userData.beacon;
    if (beacon) beacon.material.color.setHex(Math.sin(game.t * 4) > 0 ? 0x7ef0ff : 0x2d6f8a);
  }
}

// ------------------------------------------------------------------- the loop
const clock = new THREE.Clock();
let uiTick = 0;

function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);

  if (game && started && !UI.modalOpen()) {
    updateAim();
    const input = buildInput(dt);
    game.update(dt, input);
    // drain gameplay events into the UI
    while (game.events.length) {
      const ev = game.events.shift();
      if (ev.type === 'bad' && /SIEGE|abyss|Hull breach|FALLEN/.test(ev.text)) UI.banner('ALERT', ev.text, 5200);
      else UI.toast(ev.text, ev.type === 'good' ? 'good' : ev.type === 'bad' ? 'bad' : ev.type === 'warn' ? 'warn' : '');
    }
    // keep the ship/frotress meshes in sync with the tiers
    if (JSON.stringify(game.ship.tiers) !== shipSig) rebuildShipMesh();
    saveTimer += dt;
    if (saveTimer > 15) { saveTimer = 0; persist(); }
    consumeEffects();
    const st = game.ship.stats;
    audio.engine(Math.min(1, Math.abs(game.speed) / Math.max(1, st.maxSpeed)), game.boost || 0, game.warpActive > 0);
  }

  if (game) {
    if (!started) audio.silenceEngine();
    syncShip(dt);
    syncWorld(dt);
    syncBeam();
    updateParticles(dt);
    syncBolts();
    syncEnemies();
    syncPickups();
    syncFort(dt);
    syncCamera(dt);
    cloudGroup.position.set(
      Math.round(game.pos.x / 900) * 900,
      0,
      Math.round(game.pos.z / 900) * 900,
    );
    puffLow.material.uniforms.uTime.value = game.t;
    puffHigh.material.uniforms.uTime.value = game.t;
    skyDome.position.copy(camera.position);
    sun.position.set(game.pos.x + 140, game.pos.y + 240, game.pos.z + 110);
    sun.target.position.set(game.pos.x, game.pos.y, game.pos.z);
    sun.target.updateMatrixWorld();
    const storm = game.inStorm;
    scene.fog.density = storm ? 0.006 : 0.0016;
    scene.fog.color.setHex(storm ? 0x6b5a9a : 0x9dc4e6);
    uiTick += dt;
    if (uiTick > 0.06) { uiTick = 0; UI.update(game); }
  }

  renderer.render(scene, camera);
}

// dev hook — the headless boot test (tools/skyuss-boot.mjs) and the browser
// console can both reach the live game through this.
window.__skyuss = {
  get game() { return game; },
  get renderer() { return renderer; },
  get scene() { return scene; },
  start: (resume) => startGame(resume),
  rebuildShip: () => rebuildShipMesh(),
  rebuildFort: () => rebuildFort(),
};

// surface anything unexpected instead of failing silently
window.addEventListener('error', (e) => {
  try { UI.toast('⚠ ' + (e.message || 'script error'), 'bad', 9000); } catch (err) { /* ui not ready */ }
});
window.addEventListener('unhandledrejection', (e) => {
  try { UI.toast('⚠ ' + ((e.reason && e.reason.message) || 'async error'), 'bad', 9000); } catch (err) { /* ignore */ }
});

renderer.setAnimationLoop(loop);
