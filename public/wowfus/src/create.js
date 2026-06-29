import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildCharacter } from './character/buildCharacter.js';
import { idle, blink } from './character/animate.js';
import { CLASS_OUTFIT, saveCharacter } from './character/loadout.js';

// =============================================================================
//  IsoForge — WoW-style character creation screen.
//  Faction -> Race -> Class, plus live customization (hair style/colour, skin,
//  eyes). The 3D preview rebuilds on every change via buildCharacter(race, opts).
// =============================================================================

// ---- DATA -------------------------------------------------------------------
const FACTIONS = {
  alliance: { label: 'Alliance', races: ['human', 'dwarf', 'gnome', 'elf'] },
  horde: { label: 'Horde', races: ['orc', 'troll', 'tauren', 'undead'] },
};
const RACE_LABEL = {
  human: 'Humain', dwarf: 'Nain', gnome: 'Gnome', elf: 'Elfe',
  orc: 'Orc', troll: 'Troll', tauren: 'Tauren', undead: 'Mort-vivant',
};
// Per-race available classes (WoW-classic flavoured).
const RACE_CLASSES = {
  human: ['Guerrier', 'Paladin', 'Voleur', 'Prêtre', 'Mage', 'Démoniste'],
  dwarf: ['Guerrier', 'Paladin', 'Chasseur', 'Voleur', 'Prêtre'],
  gnome: ['Guerrier', 'Voleur', 'Mage', 'Démoniste'],
  elf: ['Guerrier', 'Chasseur', 'Voleur', 'Prêtre', 'Druide'],
  orc: ['Guerrier', 'Chasseur', 'Voleur', 'Chaman', 'Démoniste'],
  troll: ['Guerrier', 'Chasseur', 'Voleur', 'Prêtre', 'Chaman', 'Mage'],
  tauren: ['Guerrier', 'Chasseur', 'Druide', 'Chaman'],
  undead: ['Guerrier', 'Voleur', 'Prêtre', 'Mage', 'Démoniste'],
};
const ALL_CLASSES = ['Guerrier', 'Paladin', 'Chasseur', 'Voleur', 'Prêtre', 'Chaman', 'Mage', 'Démoniste', 'Druide'];

// Per-race fixed outfit (Dofus-style: one look per race).
const RACE_OUTFIT = {
  dwarf: { accent: 0x9c3b2e, trim: 0xc9a23a, secondary: 0x6e2a1e, style: 'tunic' },
  gnome: { accent: 0x3f7a4a, trim: 0xe6dccb, secondary: 0x2a5236, style: 'vest' },
  human: { accent: 0x3f63c9, trim: 0xe0c060, secondary: 0x2a4a9a, style: 'tunic' },
  elf: { accent: 0x2f6b4a, trim: 0xcfc8a0, secondary: 0x224d36, style: 'robe' },
  orc: { accent: 0x6e4a2a, trim: 0x4a3320, secondary: 0x4a3320, style: 'straps' },
  troll: { accent: 0x3a6a8a, trim: 0xd1b23a, secondary: 0x2a4a60, style: 'straps' },
  tauren: { accent: 0x7a5236, trim: 0x3a281a, secondary: 0x5a3c24, style: 'fur' },
  undead: { accent: 0x4a5a52, trim: 0x6a7a6a, secondary: 0x32423a, style: 'robe' },
};

// CLASS_OUTFIT now lives in ./character/loadout.js (shared with the game scene).

const HAIR_STYLES = ['short', 'long', 'mohawk', 'topknot', 'bald'];
const HAIR_LABEL = { short: 'Court', long: 'Long', mohawk: 'Crête', topknot: 'Chignon', bald: 'Chauve' };
const HAIR_COLORS = [0x2c2c30, 0x5a3d28, 0x8a5a30, 0xc9a24a, 0xd8d3c8, 0xb23a2a, 0xb24a86, 0x3a6a8a, 0x3f7a4a];
const EYE_COLORS = [0x5b3b24, 0x3a6a8a, 0x3f9a6a, 0x46cdb2, 0xc25a2a, 0x8a3a8a, 0xb83030];
const SKIN_TONES = {
  human: [0xe2a17c, 0xd99070, 0xc88a64, 0xf0c0a0, 0xa86a4a],
  dwarf: [0xd49a72, 0xc98f63, 0xe0b088, 0xb87a52],
  gnome: [0xeab896, 0xe0a080, 0xf0c8a8, 0xd8a0b0],
  elf: [0xdfe0cf, 0xe8d8c8, 0xd0d8e0, 0xc8e0d0, 0xefd4b8],
  orc: [0x7aa258, 0x6e9a4e, 0x8aae68, 0x5e8a40],
  troll: [0x5a8a7a, 0x4a7a8a, 0x6a8a5a, 0x7a6a9a],
  tauren: [0x8a6a4a, 0x6e4e34, 0xa88860, 0x4a3322],
  undead: [0x9fb0a2, 0x8aa090, 0xb0c0b0, 0x88a0a8],
};

const hx = (n) => '#' + n.toString(16).padStart(6, '0');

// ---- STATE ------------------------------------------------------------------
const state = {
  faction: 'alliance',
  race: 'human',
  cls: 'Guerrier',
  hairStyle: null,  // null => race default
  hairColor: null,
  skinColor: null,
  eyeColor: null,
};

// ---- THREE scene ------------------------------------------------------------
const canvas = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 1.05, 3.7);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.82, 0);
controls.enablePan = false;
controls.minDistance = 2.4;
controls.maxDistance = 5.5;
controls.minPolarAngle = Math.PI * 0.25;
controls.maxPolarAngle = Math.PI * 0.6;
controls.update();

scene.add(new THREE.AmbientLight(0xffffff, 0.62));
const sun = new THREE.DirectionalLight(0xfff2dd, 1.15);
sun.position.set(3, 7, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 3, bottom: -2, near: 1, far: 20 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.035;
scene.add(sun);
const rim = new THREE.DirectionalLight(0x9fc0ff, 0.6);
rim.position.set(-4, 3, -4);
scene.add(rim);

// Stage disc (receives the shadow, grounds the character).
const stage = new THREE.Mesh(
  new THREE.CylinderGeometry(1.15, 1.25, 0.1, 40),
  new THREE.MeshStandardMaterial({ color: 0x1a2030, roughness: 1 }),
);
stage.position.y = -0.05;
stage.receiveShadow = true;
scene.add(stage);
const ring = new THREE.Mesh(
  new THREE.TorusGeometry(1.16, 0.02, 8, 48),
  new THREE.MeshBasicMaterial({ color: 0xd9b25a }),
);
ring.rotation.x = Math.PI / 2;
ring.position.y = 0.01;
scene.add(ring);

let actor = null; // { root, bones, eyes }

function disposeActor() {
  if (!actor) return;
  scene.remove(actor.root);
  actor.root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
  });
  actor = null;
}

function rebuildActor() {
  disposeActor();
  const o = CLASS_OUTFIT[state.cls] || RACE_OUTFIT[state.race] || {};
  const c = buildCharacter(state.race, {
    accent: o.accent, trim: o.trim, secondary: o.secondary, style: o.style, hat: o.hat,
    hairStyle: state.hairStyle ?? undefined,
    hairColor: state.hairColor ?? undefined,
    skinColor: state.skinColor ?? undefined,
    eyeColor: state.eyeColor ?? undefined,
  });
  c.root.rotation.y = 0; // faces +Z toward the camera
  scene.add(c.root);
  actor = c;
}

// ---- UI ---------------------------------------------------------------------
const el = (id) => document.getElementById(id);
const racesBox = el('races');
const classesBox = el('classes');

function raceDotColor(key) {
  return hx(SKIN_TONES[key] ? SKIN_TONES[key][0] : 0x888888);
}

function renderRaces() {
  racesBox.innerHTML = '';
  for (const key of FACTIONS[state.faction].races) {
    const t = document.createElement('button');
    t.className = 'tile' + (key === state.race ? ' active' : '');
    t.innerHTML = `<span class="dot" style="background:${raceDotColor(key)}"></span>${RACE_LABEL[key]}`;
    t.onclick = () => selectRace(key);
    racesBox.appendChild(t);
  }
}

function renderClasses() {
  classesBox.innerHTML = '';
  const avail = RACE_CLASSES[state.race] || [];
  for (const cls of ALL_CLASSES) {
    const ok = avail.includes(cls);
    const t = document.createElement('button');
    t.className = 'tile' + (cls === state.cls ? ' active' : '') + (ok ? '' : ' disabled');
    t.textContent = cls;
    if (ok) t.onclick = () => { state.cls = cls; renderClasses(); rebuildActor(); };
    classesBox.appendChild(t);
  }
}

function swatchRow(box, colors, current, onPick) {
  box.innerHTML = '';
  for (const col of colors) {
    const s = document.createElement('div');
    s.className = 'sw' + (col === current ? ' active' : '');
    s.style.background = hx(col);
    s.onclick = () => onPick(col);
    box.appendChild(s);
  }
}

function curHair() { return state.hairStyle ?? defaultHair(state.race); }
function defaultHair(race) {
  // mirror buildCharacter's default (the race's part selector)
  const def = { dwarf: 'short', gnome: 'short', human: 'short', elf: 'long', orc: 'topknot', troll: 'mohawk', tauren: 'short', undead: 'short' };
  return def[race] || 'short';
}
function curHairColor() { return state.hairColor ?? raceHairColor(state.race); }
function raceHairColor(race) {
  const def = { dwarf: 0x553521, gnome: 0xb24a86, human: 0x5a3d28, elf: 0x2c2c38, orc: 0x2b2b22, troll: 0xb23a3a, tauren: 0x4a3322, undead: 0x2c2c30 };
  return def[race] ?? 0x5a3d28;
}
function curSkin() { return state.skinColor ?? (SKIN_TONES[state.race] || [0xe2a17c])[0]; }
function curEye() { return state.eyeColor ?? raceEye(state.race); }
function raceEye(race) {
  const def = { dwarf: 0x5e3d22, gnome: 0x4a86c8, human: 0x8a5a30, elf: 0x46cdb2, orc: 0xc25a2a, troll: 0xd1b23a, tauren: 0x2a1c12, undead: 0xbfe8d4 };
  return def[race] ?? 0x5b3b24;
}

function renderCustomization() {
  el('hair-val').textContent = HAIR_LABEL[curHair()];
  swatchRow(el('sw-hair'), HAIR_COLORS, curHairColor(), (c) => { state.hairColor = c; rebuildActor(); renderCustomization(); });
  swatchRow(el('sw-skin'), SKIN_TONES[state.race] || [], curSkin(), (c) => { state.skinColor = c; rebuildActor(); renderCustomization(); });
  swatchRow(el('sw-eyes'), EYE_COLORS, curEye(), (c) => { state.eyeColor = c; rebuildActor(); renderCustomization(); });
}

function cycleHair(dir) {
  const i = HAIR_STYLES.indexOf(curHair());
  state.hairStyle = HAIR_STYLES[(i + dir + HAIR_STYLES.length) % HAIR_STYLES.length];
  rebuildActor();
  renderCustomization();
}

function selectRace(key) {
  state.race = key;
  // reset customization to the new race's defaults
  state.hairStyle = null;
  state.hairColor = null;
  state.skinColor = null;
  state.eyeColor = null;
  // clamp class to one available for this race
  if (!(RACE_CLASSES[key] || []).includes(state.cls)) state.cls = (RACE_CLASSES[key] || ['Guerrier'])[0];
  renderRaces();
  renderClasses();
  renderCustomization();
  rebuildActor();
}

function selectFaction(f) {
  if (state.faction === f) return;
  state.faction = f;
  document.querySelectorAll('.faction').forEach((b) => b.classList.toggle('active', b.dataset.faction === f));
  selectRace(FACTIONS[f].races[0]);
}

// wire static controls
document.querySelectorAll('.faction').forEach((b) => { b.onclick = () => selectFaction(b.dataset.faction); });
el('hair-prev').onclick = () => cycleHair(-1);
el('hair-next').onclick = () => cycleHair(+1);
el('back').onclick = () => { location.href = './'; };
el('create').onclick = () => {
  const name = el('name').value.trim();
  if (!name) { toast('Choisis un nom de personnage'); el('name').focus(); return; }
  saveCharacter({ ...state, name });
  el('create').textContent = 'Chargement…';
  setTimeout(() => { location.href = './game.html'; }, 250);
};

let toastTimer = 0;
function toast(msg) {
  const t = el('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---- init + loop ------------------------------------------------------------
renderRaces();
renderClasses();
renderCustomization();
rebuildActor();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
function loop() {
  const t = clock.getElapsedTime();
  if (actor) {
    idle(actor.bones, t, 0);
    blink(actor.eyes, t, 0);
    actor.bones.head.rotation.set(0, 0, 0); // keep the face stable & front-on in the creator
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();
