import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeIsoCamera, resizeIsoCamera } from './engine/isoCamera.js';
import { makeGrid } from './engine/grid.js';
import { buildCharacter } from './character/buildCharacter.js';
import { idle, blink } from './character/animate.js';
import { CLASS_COLORS } from './core/palette.js';

const canvas = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9ec5e3);
scene.fog = new THREE.Fog(0x9ec5e3, 16, 32);

const camera = makeIsoCamera(innerWidth / innerHeight, 6.2);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.75, 0);
controls.enablePan = false;
controls.minZoom = 0.6;
controls.maxZoom = 3;
controls.update();

// Lights — ambient fill + key sun (drives the toon banding) + dim rim from behind.
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const sun = new THREE.DirectionalLight(0xfff4e0, 1.15);
sun.position.set(5, 10, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 36 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.035; // kill self-shadow acne on the curved toon faces
scene.add(sun);
const rim = new THREE.DirectionalLight(0xbfd8ff, 0.5);
rim.position.set(-6, 4, -5);
scene.add(rim);

scene.add(makeGrid(12, 1));

// The full roster, side by side, facing the camera so faces/ears/beard read.
const FACE = Math.PI / 4;
// One outfit colour per RACE (Dofus-style: the look is fixed per race, not per class).
const ROSTER = [
  { key: 'dwarf',  accent: 0x9c3b2e, trim: 0xc9a23a, secondary: 0x6e2a1e, style: 'tunic'  },
  { key: 'gnome',  accent: 0x3f7a4a, trim: 0xe6dccb, secondary: 0x2a5236, style: 'vest'   },
  { key: 'human',  accent: 0x3f63c9, trim: 0xe0c060, secondary: 0x2a4a9a, style: 'tunic'  },
  { key: 'elf',    accent: 0x2f6b4a, trim: 0xcfc8a0, secondary: 0x224d36, style: 'robe'   },
  { key: 'orc',    accent: 0x6e4a2a, trim: 0x4a3320, secondary: 0x4a3320, style: 'straps' },
  { key: 'troll',  accent: 0x3a6a8a, trim: 0xd1b23a, secondary: 0x2a4a60, style: 'straps' },
  { key: 'tauren', accent: 0x7a5236, trim: 0x3a281a, secondary: 0x5a3c24, style: 'fur'    },
  { key: 'undead', accent: 0x4a5a52, trim: 0x6a7a6a, secondary: 0x32423a, style: 'robe'   },
];
const SPACING = 1.5;
const labelRoot = document.getElementById('labels');
const actors = [];
ROSTER.forEach((sp, i) => {
  const x = (i - (ROSTER.length - 1) / 2) * SPACING;
  const phase = i * 0.8;
  const c = buildCharacter(sp.key, sp);
  c.root.position.x = x;
  c.root.rotation.y = FACE;
  scene.add(c.root);

  const p = c.race.prop;
  const topY = c.root.position.y + p.pelvisH + p.spineLen + p.chestLen + p.neckLen + p.headSize;
  const heads = (topY / p.headSize).toFixed(1);

  const div = document.createElement('div');
  div.className = 'nametag';
  div.innerHTML = `${c.race.label} <small>&middot; ${heads} t&ecirc;tes</small>`;
  labelRoot.appendChild(div);

  actors.push({ bones: c.bones, eyes: c.eyes, x, phase, labelY: topY + 0.32, div });
});

const proj = new THREE.Vector3();
function updateLabels() {
  for (const a of actors) {
    proj.set(a.x, a.labelY, 0).project(camera);
    const sx = (proj.x * 0.5 + 0.5) * innerWidth;
    const sy = (-proj.y * 0.5 + 0.5) * innerHeight;
    a.div.style.left = sx + 'px';
    a.div.style.top = sy + 'px';
    a.div.style.display = (proj.z > 1) ? 'none' : '';
  }
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  resizeIsoCamera(camera, innerWidth / innerHeight);
});

const clock = new THREE.Clock();
function loop() {
  const t = clock.getElapsedTime();
  for (const a of actors) { idle(a.bones, t, a.phase); blink(a.eyes, t, a.phase); }
  controls.update();
  renderer.render(scene, camera);
  updateLabels();
  requestAnimationFrame(loop);
}
loop();
