import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { buildCharacter } from './character/buildCharacter.js';
import { spellsFor } from './combat/spells.js';
import { makeVfx } from './combat/vfx.js';
import { idle, walk, rest, blink, castPose, neutral } from './character/animate.js';
import { makeBoard, bfs, findPath, manhattan } from './engine/board.js';
import { loadCharacter, loadoutOpts, DEFAULT_CHARACTER } from './character/loadout.js';

// ---- board geometry ---------------------------------------------------------
const N = 14;          // grid is N×N
const T = 1;           // tile size (world units)
const half = (N - 1) / 2;
const cellToWorld = (i, j) => new THREE.Vector3((i - half) * T, 0, (j - half) * T);

// ---- renderer / scene / iso camera -----------------------------------------
const canvas = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fb7d6);
scene.fog = new THREE.Fog(0x8fb7d6, 85, 170);

// Dofus-style ISO: a FAR camera with a NARROW FOV ≈ orthographic (clean diamond
// grid, no distortion) but with a whisper of perspective so the ground reads as a
// floor (not the flat "optical illusion"). 2:1 dimetric angle (~26°) → legs visible.
const camera = new THREE.PerspectiveCamera(18, innerWidth / innerHeight, 1, 250);
camera.position.set(0, 24, 33);   // straight-on (no diagonal), top-down-ish, closer to the scene
function resizeCamera() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
resizeCamera();
camera.lookAt(0, 0.4, 0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.4, 0);
controls.enableRotate = false;        // fixed iso angle (Dofus)
controls.enablePan = true;
controls.enableZoom = true;           // wheel dollies in/out
controls.minDistance = 20;
controls.maxDistance = 80;
controls.screenSpacePanning = false;
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
controls.update();

// ---- lights -----------------------------------------------------------------
scene.add(new THREE.AmbientLight(0x9fb0c8, 0.55)); // cool fill
const sun = new THREE.DirectionalLight(0xffeccb, 1.3); // warm key
sun.position.set(8, 14, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 50 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.035;
scene.add(sun);
// Cool RIM from behind-above → a bright edge that pops characters off the ground.
const rim = new THREE.DirectionalLight(0x9fc0ff, 0.95);
rim.position.set(-7, 9, -11);
scene.add(rim);

// ---- ground tiles (checkerboard, one InstancedMesh) -------------------------
const board = makeBoard(N);
const tileGeo = new THREE.BoxGeometry(T * 0.97, 0.06, T * 0.97);
const tiles = new THREE.InstancedMesh(tileGeo, new THREE.MeshStandardMaterial({ roughness: 1 }), N * N);
tiles.receiveShadow = true;
{
  const a = new THREE.Color(0x6f9a52), b = new THREE.Color(0x789f59), dummy = new THREE.Object3D();
  let k = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    dummy.position.copy(cellToWorld(i, j)); dummy.position.y = -0.03; dummy.updateMatrix();
    tiles.setMatrixAt(k, dummy.matrix);
    tiles.setColorAt(k, (i + j) % 2 ? a : b);
    k++;
  }
  tiles.instanceMatrix.needsUpdate = true;
  if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true;
}
scene.add(tiles);

// thin grid lines
{
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const x = (i - half - 0.5) * T;
    pts.push(new THREE.Vector3(x, 0.01, (-half - 0.5) * T), new THREE.Vector3(x, 0.01, (N - half - 0.5) * T));
    pts.push(new THREE.Vector3((-half - 0.5) * T, 0.01, x), new THREE.Vector3((N - half - 0.5) * T, 0.01, x));
  }
  const grid = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.12 }),
  );
  scene.add(grid);
}

// ---- highlight overlays (reachable, hover, path) ----------------------------
function overlay(color, opacity, count) {
  const geo = new THREE.PlaneGeometry(T * 0.9, T * 0.9);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  const mesh = new THREE.InstancedMesh(geo, m, count);
  mesh.renderOrder = 1;
  // Hide every instance until painted — uninitialised matrices otherwise render
  // a stack of quads at the world origin (the stray centre marker).
  const z = new THREE.Object3D(); z.scale.setScalar(0); z.updateMatrix();
  for (let k = 0; k < count; k++) mesh.setMatrixAt(k, z.matrix);
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  return mesh;
}
const reachMesh = overlay(0x3fa9ff, 0.32, N * N);
const pathMesh = overlay(0xf4d35a, 0.5, N + 2);
const hover = new THREE.Mesh(
  new THREE.PlaneGeometry(T * 0.94, T * 0.94).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }),
);
hover.renderOrder = 2; hover.visible = false; scene.add(hover);
const spellMesh = overlay(0xe8822e, 0.30, N * N); // valid spell-target cells
const aoeMesh = overlay(0xff5a3a, 0.42, 80);       // AoE footprint preview
aoeMesh.renderOrder = 3;

const _d = new THREE.Object3D();
function paintCells(mesh, cells, y = 0.05) {
  let k = 0;
  for (const [i, j] of cells) {
    if (k >= mesh.count) break;
    _d.position.copy(cellToWorld(i, j)); _d.position.y = y; _d.scale.setScalar(1); _d.updateMatrix();
    mesh.setMatrixAt(k++, _d.matrix);
  }
  for (; k < mesh.count; k++) { _d.scale.setScalar(0); _d.updateMatrix(); mesh.setMatrixAt(k, _d.matrix); }
  mesh.instanceMatrix.needsUpdate = true;
}

// ---- obstacles + a couple of enemies ---------------------------------------
function makeRock(i, j) {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0x6b6f76, roughness: 1, flatShading: true });
  for (let n = 0; n < 3; n++) {
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22 + Math.abs(((i * 7 + j * 3 + n) % 5) - 2) * 0.05), m);
    r.position.set((n - 1) * 0.22, 0.12 + (n === 1 ? 0.12 : 0), (n % 2) * 0.12 - 0.06);
    r.castShadow = true; r.receiveShadow = true; g.add(r);
  }
  g.position.copy(cellToWorld(i, j));
  scene.add(g);
}
for (const [i, j] of [[4, 4], [5, 4], [9, 8], [8, 9], [6, 10], [10, 5], [3, 9]]) {
  board.setObstacle(i, j); makeRock(i, j);
}

// ---- combat helpers: VFX, billboard health bars, floating combat text -------
const vfx = makeVfx(scene);

function makeHealthBar() {
  const grp = new THREE.Group();
  const W = 0.84, H = 0.12;
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.07, H + 0.07),
    new THREE.MeshBasicMaterial({ color: 0x100e0d, transparent: true, opacity: 0.82, depthTest: false, depthWrite: false }));
  const fillGeo = new THREE.PlaneGeometry(W, H); fillGeo.translate(W / 2, 0, 0); // left-anchored
  const fillMat = new THREE.MeshBasicMaterial({ color: 0x5ec84a, depthTest: false, depthWrite: false });
  const fill = new THREE.Mesh(fillGeo, fillMat); fill.position.x = -W / 2;
  bg.renderOrder = 20; fill.renderOrder = 21;
  grp.add(bg); grp.add(fill); grp.visible = false;
  grp.userData = { fill, fillMat };
  scene.add(grp);
  return grp;
}
function setHealthBar(bar, frac) {
  frac = Math.max(0, Math.min(1, frac));
  bar.userData.fill.scale.x = Math.max(0.001, frac);
  bar.userData.fillMat.color.setHSL(0.34 * frac, 0.68, 0.46); // red → green
}
function actorTopY(root) {
  return new THREE.Box3().setFromObject(root).max.y - root.position.y; // height above root origin
}
function updateBar(bar, root, topY, frac) {
  bar.visible = true;
  bar.position.set(root.position.x, root.position.y + topY + 0.3, root.position.z);
  bar.quaternion.copy(camera.quaternion); // billboard toward the (fixed) camera
  setHealthBar(bar, frac);
}

const fctEl = document.getElementById('fct');
const _proj = new THREE.Vector3();
function floatText(worldPos, text, color) {
  _proj.copy(worldPos); _proj.y += 1.45; _proj.project(camera);
  const r = canvas.getBoundingClientRect();
  const d = document.createElement('div');
  d.className = 'fct'; d.textContent = text; d.style.color = color;
  d.style.left = (r.left + (_proj.x * 0.5 + 0.5) * r.width) + 'px';
  d.style.top = (r.top + (-_proj.y * 0.5 + 0.5) * r.height) + 'px';
  fctEl.appendChild(d);
  setTimeout(() => d.remove(), 1000);
}

const enemies = [];
function spawnEnemy(race, i, j, accent, hp = 10) {
  const e = buildCharacter(race, { accent, trim: 0x33271a, secondary: accent, style: 'straps' });
  const footY = e.root.position.y;            // skeleton lift → feet rest ON the tile
  const w = cellToWorld(i, j);
  e.root.position.set(w.x, footY, w.z);
  e.root.rotation.y = Math.PI; // face roughly toward the player side
  scene.add(e.root);
  board.setOccupant(i, j, 'enemy');
  enemies.push({ ...e, i, j, hp, maxHp: hp, footY, bar: makeHealthBar(), topY: actorTopY(e.root) });
}
spawnEnemy('orc', 10, 10, 0x6e4a2a, 12);
spawnEnemy('troll', 11, 6, 0x3a6a8a, 16);

// ---- player (from the creator, or a default) --------------------------------
const config = loadCharacter() || DEFAULT_CHARACTER;
const player = buildCharacter(config.race, loadoutOpts(config));
const FOOT_Y = player.root.position.y;        // skeleton lift → feet rest ON the tile (y=0)
const start = { i: 3, j: 3 };
{ const w = cellToWorld(start.i, start.j); player.root.position.set(w.x, FOOT_Y, w.z); }
scene.add(player.root);
board.setOccupant(start.i, start.j, 'player');
const playerBar = makeHealthBar();
const playerTopY = actorTopY(player.root);

const S = {
  i: start.i, j: start.j,
  hp: 30, maxHp: 30,
  maxPM: 4, PM: 4, maxPA: 6, PA: 6,
  moving: false, queue: [], moveT: 0, from: null, to: null,
};

// ---- HUD --------------------------------------------------------------------
const el = (id) => document.getElementById(id);
function syncHud() {
  el('hp').textContent = S.hp;
  el('pm').textContent = S.PM;
  el('pa').textContent = S.PA;
  el('who').textContent = `${config.name || 'Héros'} — ${config.cls || 'Guerrier'}`;
}
function refreshReach() {
  if (S.moving) { paintCells(reachMesh, []); return; }
  const { reachable } = bfs(board, S.i, S.j, S.PM);
  paintCells(reachMesh, reachable.map((c) => [c[0], c[1]]));
}
el('endturn').onclick = () => endTurn();
syncHud(); refreshReach();

// ---- picking ----------------------------------------------------------------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hit = new THREE.Vector3();
function cellFromEvent(e) {
  const r = canvas.getBoundingClientRect();
  ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  ray.setFromCamera(ndc, camera);
  if (!ray.ray.intersectPlane(plane, hit)) return null;
  const i = Math.round(hit.x / T + half);
  const j = Math.round(hit.z / T + half);
  return board.inBounds(i, j) ? [i, j] : null;
}

let hoverCell = null;
canvas.addEventListener('pointermove', (e) => {
  const c = cellFromEvent(e);
  hoverCell = c;
  if (!c || S.moving || enemyActing) { hover.visible = false; paintCells(pathMesh, []); paintCells(aoeMesh, []); return; }
  const [i, j] = c;
  hover.visible = true;
  hover.position.copy(cellToWorld(i, j)); hover.position.y = 0.07;
  if (selSpell) {
    paintCells(pathMesh, []);
    paintCells(aoeMesh, spellTargetValid(selSpell, i, j) ? aoeCells(selSpell, i, j) : []);
  } else {
    paintCells(aoeMesh, []);
    const path = findPath(board, S.i, S.j, i, j, S.PM);
    paintCells(pathMesh, path || [], 0.06);
  }
});
canvas.addEventListener('pointerleave', () => { hover.visible = false; paintCells(pathMesh, []); });

canvas.addEventListener('click', (e) => {
  if (S.moving || enemyActing) return;
  const c = cellFromEvent(e);
  if (!c) return;
  const [i, j] = c;
  if (selSpell) { // spell targeting mode
    if (spellTargetValid(selSpell, i, j)) castSpell(selSpell, i, j);
    return;
  }
  // otherwise move
  const path = findPath(board, S.i, S.j, i, j, S.PM);
  if (!path || !path.length) return;
  beginMove(path);
});

// ---- movement ---------------------------------------------------------------
function beginMove(path) {
  S.moving = true;
  S.queue = path.slice();
  selSpell = null; castState = null;
  paintCells(reachMesh, []); paintCells(pathMesh, []); paintCells(spellMesh, []); paintCells(aoeMesh, []);
  hover.visible = false; syncSpellbar();
  nextStep();
}
function nextStep() {
  if (!S.queue.length) { // arrived
    S.moving = false; rest(player.bones);
    refreshReach(); syncSpellbar(); return;
  }
  const [ni, nj] = S.queue.shift();
  S.from = cellToWorld(S.i, S.j);
  S.to = cellToWorld(ni, nj);
  S.moveT = 0;
  // face the step direction
  player.root.rotation.y = Math.atan2(S.to.x - S.from.x, S.to.z - S.from.z);
  // hand the tile over
  board.setOccupant(S.i, S.j, null);
  S.i = ni; S.j = nj;
  board.setOccupant(ni, nj, 'player');
  S.PM = Math.max(0, S.PM - 1);
  syncHud();
}

function tryAttack(foe) {
  if (S.PA < 3) return;
  if (manhattan(S.i, S.j, foe.i, foe.j) !== 1) return; // melee: adjacent only
  S.PA -= 3; syncHud();
  // face + lunge
  const fw = cellToWorld(foe.i, foe.j), pw = cellToWorld(S.i, S.j);
  player.root.rotation.y = Math.atan2(fw.x - pw.x, fw.z - pw.z);
  foe.hp -= 1;
  foe._flinch = performanceNow();
  if (foe.hp <= 0) { scene.remove(foe.root); board.setOccupant(foe.i, foe.j, null); }
  S._lunge = performanceNow();
  refreshReach();
}

// time helper (Date.now is fine in the page, just not in workflow scripts)
function performanceNow() { return performance.now() / 1000; }

// ---- spells -----------------------------------------------------------------
const spellList = spellsFor(config.cls); // [{ id, name, pa, range, aoe, kind, power, color, los, self, fx, cast }]
let selSpell = null;                     // currently armed spell, or null (move mode)
let castState = null;                    // cosmetic cast animation: { kind, t, dur, baseRot }
let enemyActing = false, actQueue = [], act = null; // animated enemy-turn state

// Start the caster's cast-animation pose. Purely cosmetic — damage is dealt
// immediately by the caller, never gated on the animation finishing.
function startCast(sp) {
  const kind = sp.cast || 'cast';
  const dur = kind === 'spin' ? 0.62 : kind === 'raise' ? 0.7 : kind === 'melee' ? 0.34 : 0.42;
  castState = { kind, t: 0, dur, baseRot: player.root.rotation.y };
  if (kind === 'melee') S._lunge = performanceNow();
}
const dirTo = (to, from) => new THREE.Vector3(to.x - from.x, 0, to.z - from.z).normalize();

// Bresenham line-of-sight: obstacles block, endpoints excluded.
function hasLoS(i0, j0, i1, j1) {
  let x = i0, y = j0;
  const dx = Math.abs(i1 - i0), dy = Math.abs(j1 - j0);
  const sx = i0 < i1 ? 1 : -1, sy = j0 < j1 ? 1 : -1;
  let err = dx - dy, guard = 0;
  while (guard++ < 400) {
    if (x === i1 && y === j1) return true;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
    if (x === i1 && y === j1) return true;
    const c = board.cell(x, y);
    if (c && !c.walkable) return false;
  }
  return true;
}
function spellTargetValid(sp, i, j) {
  const [mn, mx] = sp.range;
  const d = manhattan(S.i, S.j, i, j);
  if (d < mn || d > mx) return false;
  const cell = board.cell(i, j);
  if (cell && !cell.walkable) return false;        // can't aim at a rock
  if (sp.los && !hasLoS(S.i, S.j, i, j)) return false;
  return true;
}
function spellCells(sp) {
  const out = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (spellTargetValid(sp, i, j)) out.push([i, j]);
  return out;
}
function aoeCells(sp, ti, tj) {
  if (!sp.aoe) return [[ti, tj]];
  const out = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (manhattan(ti, tj, i, j) <= sp.aoe) out.push([i, j]);
  return out;
}
function selectSpell(idx) {
  const sp = spellList[idx];
  if (!sp || S.moving || enemyActing || S.PA < sp.pa) return;
  if (sp.self) { castSelf(sp); return; }            // heals fire immediately
  if (sp.selfCenter) { castSelfAoe(sp); return; }   // PBAoE (fan of knives) fires on the caster
  selSpell = (selSpell && selSpell.id === sp.id) ? null : sp; // toggle off if re-clicked
  if (selSpell) { paintCells(reachMesh, []); paintCells(spellMesh, spellCells(selSpell)); }
  else { paintCells(spellMesh, []); paintCells(aoeMesh, []); refreshReach(); }
  syncSpellbar();
}
function castSelf(sp) {
  S.PA -= sp.pa;
  S.hp = Math.min(S.maxHp, S.hp + sp.power);
  startCast(sp);
  vfx.heal(player.root.position, sp.color, sp.fx === 'healNature' ? 'nature' : 'holy');
  floatText(player.root.position, '+' + sp.power, '#8ef0a0');
  syncHud(); syncSpellbar();
}

// Point-blank AoE centred on the caster (Fan of Knives): spin + blades, hit every
// living foe within `aoe` Manhattan tiles. No target picking — fires immediately.
function castSelfAoe(sp) {
  S.PA -= sp.pa;
  startCast(sp);
  const r = sp.aoe || 2;
  for (const f of enemies) {
    const d = manhattan(S.i, S.j, f.i, f.j);
    if (f.hp > 0 && d >= 1 && d <= r) damageFoe(f, sp.power);
  }
  vfx.blades(player.root.position, { color: sp.color, radius: r + 0.4 });
  selSpell = null; paintCells(spellMesh, []); paintCells(aoeMesh, []);
  syncHud(); syncSpellbar(); refreshReach();
}
function castSpell(sp, ti, tj) {
  if (S.PA < sp.pa) return;
  S.PA -= sp.pa;
  const from = player.root.position;
  const tw = cellToWorld(ti, tj);
  player.root.rotation.y = Math.atan2(tw.x - from.x, tw.z - from.z); // face the target
  startCast(sp);
  if (sp.aoe > 0) vfx.telegraph(tw, sp.aoe, sp.color); // WoW-style ground danger disc for AoE

  // Damage resolves IMMEDIATELY — never tied to the VFX arriving (robust if rAF throttles).
  if (sp.fx === 'chain') {
    castChain(sp, ti, tj, tw);
  } else {
    spellVfx(sp, from, tw);
    for (const [ci, cj] of aoeCells(sp, ti, tj)) {
      const foe = enemies.find((f) => f.hp > 0 && f.i === ci && f.j === cj);
      if (foe) damageFoe(foe, sp.power);
    }
  }
  selSpell = null; paintCells(spellMesh, []); paintCells(aoeMesh, []);
  syncHud(); syncSpellbar(); refreshReach();
}

// Pick the right VFX archetype for a targeted spell.
function spellVfx(sp, from, tw) {
  const c = sp.color;
  switch (sp.fx) {
    case 'fire':        vfx.projectile(from, tw, { color: c, style: 'fire',   spin: 6,  trail: 0xff9a3a, explode: true, patch: sp.linger === 'fire' ? 'fire' : null }); break;
    case 'frost':       vfx.projectile(from, tw, { color: c, style: 'frost',  spin: 10, arc: 0.3, geo: 'shard', trail: 0xbfeaff }); break;
    case 'shadow':      vfx.projectile(from, tw, { color: c, style: 'shadow', arc: 0.5, trail: 0x6a2aa0 }); break;
    case 'holy':        vfx.projectile(from, tw, { color: c, style: 'holy',   arc: 0.22, trail: 0xfff2c0 }); break;
    case 'nature':      vfx.projectile(from, tw, { color: c, style: 'nature', spin: 8,  geo: 'shard', trail: 0xbfe87a }); break;
    case 'lightning':   vfx.lightning(from, tw, c); break;
    case 'holyHammer':  vfx.holyHammer(tw, c); break;
    case 'arrow':       vfx.arrow(from, tw, { color: c }); break;
    case 'arrowVolley': vfx.arrowVolley(from, tw, c, 5); break;
    case 'slash':       vfx.slash(from, dirTo(tw, from), c, { wide: !!sp.aoe }); break;
    case 'stab':        vfx.slash(from, dirTo(tw, from), c, { wide: false }); break;
    default:            vfx.projectile(from, tw, { color: c, style: 'arcane' });
  }
}

// Chain Lightning: zap the primary target, then leap to the nearest fresh foe
// within `radius`, up to `jumps` extra times, each hop dealing less (falloff).
function castChain(sp, ti, tj, tw) {
  const cfg = sp.chain || { jumps: 2, radius: 3, falloff: 0.65 };
  const used = new Set();
  const hits = [];
  const points = [new THREE.Vector3(player.root.position.x, 0, player.root.position.z)];
  let anchorI = ti, anchorJ = tj, dmg = sp.power;
  let foe = enemies.find((f) => f.hp > 0 && f.i === ti && f.j === tj);
  for (let jump = 0; jump <= cfg.jumps; jump++) {
    if (jump > 0) foe = nearestFoe(anchorI, anchorJ, cfg.radius, used);
    if (!foe) break;
    used.add(foe);
    hits.push({ foe, dmg: Math.max(1, Math.round(dmg)) });
    points.push(foe.root.position.clone());
    anchorI = foe.i; anchorJ = foe.j; dmg *= cfg.falloff;
  }
  if (points.length === 1) { vfx.lightning(player.root.position, tw, sp.color); return; } // whiffed
  vfx.chain(points, sp.color);
  for (const h of hits) damageFoe(h.foe, h.dmg);
}
function nearestFoe(i, j, radius, used) {
  let best = null, bd = Infinity;
  for (const f of enemies) {
    if (f.hp <= 0 || used.has(f)) continue;
    const d = manhattan(i, j, f.i, f.j);
    if (d <= radius && d < bd) { bd = d; best = f; }
  }
  return best;
}
function damageFoe(foe, dmg) {
  foe.hp -= dmg; foe._flinch = performanceNow();
  floatText(foe.root.position, '-' + dmg, '#ff8a6a');
  if (foe.hp <= 0) {
    vfx.impact(foe.root.position, 0xffffff);
    scene.remove(foe.root); if (foe.bar) scene.remove(foe.bar);
    board.setOccupant(foe.i, foe.j, null);
  }
}

function endTurn() {
  if (S.moving || enemyActing) return;
  selSpell = null; paintCells(spellMesh, []); paintCells(aoeMesh, []);
  paintCells(reachMesh, []); hover.visible = false;
  enemyTurn();                       // animated; afterEnemyTurn() resets PM/PA when it finishes
}
function afterEnemyTurn() {
  enemyActing = false; act = null;
  S.PM = S.maxPM; S.PA = S.maxPA;
  if (S.hp <= 0) el('who').textContent = `${config.name || 'Héros'} — vaincu`;
  syncHud(); syncSpellbar(); refreshReach();
}

// Animated enemy turn: each living enemy WALKS toward the player (up to 3 tiles),
// then strikes if adjacent — one at a time, driven by the render loop.
function enemyTurn() {
  actQueue = enemies.filter((e) => e.hp > 0);
  if (!actQueue.length) { afterEnemyTurn(); return; }
  enemyActing = true;
  syncSpellbar();
  startNextActor();
}
function startNextActor() {
  let f = null;
  while (actQueue.length) { const c = actQueue.shift(); if (c.hp > 0) { f = c; break; } }
  if (!f) { afterEnemyTurn(); return; }
  // plan up to 3 greedy steps toward the player, stopping when adjacent
  const steps = [];
  board.setOccupant(f.i, f.j, null);   // free own cell while planning the route
  let ci = f.i, cj = f.j, budget = 3;
  while (budget-- > 0 && manhattan(ci, cj, S.i, S.j) > 1) {
    const nx = stepToward(ci, cj, S.i, S.j);
    if (!nx) break;
    steps.push(nx); ci = nx[0]; cj = nx[1];
  }
  board.setOccupant(f.i, f.j, 'enemy'); // restore until it actually steps
  act = { f, steps, from: null, to: null, moveT: 0, mode: 'walk', atkT: 0, hit: false, wait: 0.15 };
  if (!steps.length) { act.mode = 'arrive'; rest(f.bones); }
  else enemyNextStep();
}
function enemyNextStep() {
  if (!act.steps.length) { act.mode = 'arrive'; rest(act.f.bones); return; }
  const f = act.f;
  const [ni, nj] = act.steps.shift();
  act.from = cellToWorld(f.i, f.j);
  act.to = cellToWorld(ni, nj);
  act.moveT = 0;
  f.root.rotation.y = Math.atan2(act.to.x - act.from.x, act.to.z - act.from.z);
  board.setOccupant(f.i, f.j, null);
  f.i = ni; f.j = nj;
  board.setOccupant(ni, nj, 'enemy');
}
function stepToward(i, j, ti, tj) {
  const opts = [];
  if (ti > i) opts.push([i + 1, j]);
  if (ti < i) opts.push([i - 1, j]);
  if (tj > j) opts.push([i, j + 1]);
  if (tj < j) opts.push([i, j - 1]);
  for (const [ni, nj] of opts) if (board.free(ni, nj)) return [ni, nj];
  return null;
}

// ---- spell bar UI -----------------------------------------------------------
const spellbarEl = document.getElementById('spellbar');
function buildSpellbar() {
  spellbarEl.innerHTML = '';
  spellList.forEach((sp, idx) => {
    const b = document.createElement('div');
    b.className = 'spell';
    const kind = sp.self ? 'soin' : sp.selfCenter ? `pourtour ${sp.aoe}` : (sp.aoe ? `zone ${sp.aoe}` : 'cible');
    const rng = (sp.self || sp.selfCenter) ? '—' : `${sp.range[0]}-${sp.range[1]}`;
    b.innerHTML = `<div class="nm"><span class="key">${idx + 1}</span> ${sp.name}</div>`
      + `<div class="meta">${sp.pa} PA · ⌖${rng} · ${kind}</div>`;
    b.onclick = () => selectSpell(idx);
    spellbarEl.appendChild(b);
  });
  syncSpellbar();
}
function syncSpellbar() {
  const kids = spellbarEl.children;
  for (let idx = 0; idx < kids.length; idx++) {
    const sp = spellList[idx];
    kids[idx].classList.toggle('sel', !!selSpell && selSpell.id === sp.id);
    kids[idx].classList.toggle('disabled', S.PA < sp.pa || S.moving || enemyActing);
  }
}
buildSpellbar();

addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    selSpell = null; paintCells(spellMesh, []); paintCells(aoeMesh, []); syncSpellbar(); refreshReach(); return;
  }
  if (e.key === ' ' || e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); endTurn(); return; }
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= spellList.length) selectSpell(n - 1);
});

// ---- loop -------------------------------------------------------------------
// --- Post-processing: ambient occlusion (GTAO) + grade + vignette ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
gtao.blendIntensity = 0.6;
composer.addPass(gtao);
composer.addPass(new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c = (c - 0.5) * 1.08 + 0.5;                  // contrast
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, 1.12);                    // saturation
      float d = distance(vUv, vec2(0.5));
      c *= 1.0 - smoothstep(0.55, 0.98, d) * 0.18;  // gentle vignette
      gl_FragColor = vec4(c, 1.0);
    }`,
}));
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  resizeCamera();
  composer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
function loop() {
  const realDt = clock.getDelta();             // true frame delta (advances elapsedTime)
  const dt = Math.min(0.05, realDt);           // clamped for cosmetic anims (no big jumps)
  const t = clock.elapsedTime;                 // wall-clock time

  vfx.update(dt);                              // advance active spell effects

  // player movement tween between tiles
  if (S.moving && S.to) {
    S.moveT += realDt * 4.2; // ~0.24s per tile (uses REAL delta → robust if rAF is throttled)
    const k = Math.min(1, S.moveT);
    player.root.position.lerpVectors(S.from, S.to, k);
    player.root.position.y = FOOT_Y + Math.sin(k * Math.PI) * 0.06; // hop ABOVE the foot lift
    walk(player.bones, t);
    if (k >= 1) { player.root.position.set(S.to.x, FOOT_Y, S.to.z); nextStep(); }
  } else if (castState) {
    castState.t += dt;
    const k = Math.min(1, castState.t / castState.dur);
    if (castState.kind === 'spin') player.root.rotation.y = castState.baseRot + k * Math.PI * 4; // two whirls
    castPose(player.bones, castState.kind, k);
    if (k >= 1) {
      if (castState.kind === 'spin') player.root.rotation.y = castState.baseRot; // settle back to facing
      castState = null; neutral(player.bones);
    }
  } else {
    idle(player.bones, t, 0);
  }

  // attack lunge
  if (S._lunge) {
    const e = performanceNow() - S._lunge;
    player.root.position.y = FOOT_Y + (e < 0.18 ? Math.sin((e / 0.18) * Math.PI) * 0.12 : 0);
    if (e > 0.25) S._lunge = 0;
  }

  blink(player.eyes, t, 0);
  updateBar(playerBar, player.root, playerTopY, S.hp / S.maxHp);

  for (const f of enemies) {
    if (f.hp <= 0) { if (f.bar) f.bar.visible = false; continue; }
    blink(f.eyes, t, f.i);
    if (!(enemyActing && act && act.f === f)) {     // the acting enemy is animated below
      idle(f.bones, t, f.i * 0.7);
      f.root.position.y = f.footY + (f._flinch && (performanceNow() - f._flinch) < 0.2 ? -0.05 : 0);
    }
    updateBar(f.bar, f.root, f.topY, f.hp / f.maxHp);
  }

  // animated enemy turn — one actor at a time: walk toward the player, then strike
  if (enemyActing && act) {
    const f = act.f;
    if (act.mode === 'walk' && act.to) {
      act.moveT += realDt * 4.2;
      const k = Math.min(1, act.moveT);
      f.root.position.lerpVectors(act.from, act.to, k);
      f.root.position.y = f.footY + Math.sin(k * Math.PI) * 0.06;
      walk(f.bones, t);
      if (k >= 1) { f.root.position.set(act.to.x, f.footY, act.to.z); enemyNextStep(); }
    } else if (act.mode === 'arrive') {
      f.root.position.y = f.footY;
      act.wait -= realDt;
      if (act.wait <= 0) {
        if (manhattan(f.i, f.j, S.i, S.j) === 1) {
          act.mode = 'attack'; act.atkT = 0; act.hit = false;
          const pw = cellToWorld(S.i, S.j);
          f.root.rotation.y = Math.atan2(pw.x - f.root.position.x, pw.z - f.root.position.z);
        } else { act.mode = 'done'; }
      }
    } else if (act.mode === 'attack') {
      act.atkT += realDt;
      f.root.position.y = f.footY + (act.atkT < 0.18 ? Math.sin((act.atkT / 0.18) * Math.PI) * 0.14 : 0);
      if (!act.hit && act.atkT > 0.12) {
        act.hit = true;
        const dmg = 3 + (f.i % 2);
        S.hp = Math.max(0, S.hp - dmg);
        floatText(player.root.position, '-' + dmg, '#ff8a6a');
        vfx.impact(player.root.position, 0xff5a3a);
        syncHud();
      }
      if (act.atkT > 0.42) { f.root.position.y = f.footY; act.mode = 'done'; }
    } else if (act.mode === 'done') {
      startNextActor();
    }
  }

  controls.update();
  composer.render();
  requestAnimationFrame(loop);
}
loop();
