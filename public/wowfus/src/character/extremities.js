// =============================================================================
//  IsoForge — EXTREMITIES generator (shoe / hand / hair)
// -----------------------------------------------------------------------------
//  Pure, deterministic, self-scaling part builders. Each takes the resolved
//  `prop` (metres) plus toon material(s) and returns a THREE.Object3D ready to
//  drop onto a bone. No globals, no race lookups, no side effects.
//
//  ART DIRECTION: every form must read as SHAPED / organic, never blocky. We
//  build each part by MERGING a few primitives (scaled spheres, tapered
//  capsules, a half-dome) with BufferGeometryUtils.mergeGeometries +
//  computeVertexNormals(), so a shoe looks like footwear, a hand keeps real
//  fingers, and a hair cap fully wraps the cranium with NO gap.
//
//  ORIGINS (frozen interface contract):
//    SHOE — origin = ankle (foot bone) at y=0. Boot extends DOWN to y≈-footH
//           (sole on the ground) and FORWARD +Z for the toe.
//    HAND — origin = wrist at y=0. Fingers point DOWN (-Y).
//    HAIR — origin = neck-attach (SAME as the head). Head occupies
//           y∈[0 .. headSize] above origin; head half-width ≈ headSize/2,
//           half-depth ≈ headDepth/2; front face at +Z. Hair WRAPS that
//           envelope with no gap.
//
//  OUTLINES: each generator applies its OWN inverted-hull outline via
//  addOutline(mesh, t). castShadow=true on every solid mesh. Toon mats only.
// =============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addOutline } from '../core/outline.js';

// --- small helpers -----------------------------------------------------------

// Clamp to a finite, strictly-positive number (robust against 0 / NaN / missing
// prop fields — a degenerate primitive would crash mergeGeometries).
function pos(v, fallback) {
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

// Build a geometry, transform it in place by an (optional) Matrix4, and return
// it. We bake transforms into the geometry so a single mergeGeometries() yields
// one welded mesh (no nested Object3D transforms to flatten later).
function baked(geo, m) {
  if (m) geo.applyMatrix4(m);
  return geo;
}

// Compose a TRS matrix (Euler XYZ) + non-uniform scale. Tiny convenience so the
// part code below stays declarative.
function trs(px, py, pz, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ'));
  m.compose(
    new THREE.Vector3(px, py, pz),
    q,
    new THREE.Vector3(sx, sy, sz),
  );
  return m;
}

// Merge a list of baked geometries into ONE mesh with smooth normals + outline.
// Returns the mesh (already added to nothing — caller parents it via the group).
function weld(geos, material, outline) {
  const merged = mergeGeometries(geos, false);
  merged.computeVertexNormals();          // smooth shading across the seams
  const mesh = new THREE.Mesh(merged, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (outline) addOutline(mesh, outline);
  return mesh;
}

// =============================================================================
//  SHOE — makeShoe(prop, mats) -> Object3D    mats = { boot, sole }
// -----------------------------------------------------------------------------
//  Reads as a real shoe at a glance: a SOLE SLAB on the ground, a rounded HEEL
//  cup, a swept UPPER with an instep rise toward the ankle, and a ROUNDED TOE
//  (a scaled sphere, never a cube). Two welded meshes share the group so the
//  sole can take its own darker material.
//
//  Frame: y=0 at the ankle, sole at y≈-footH, toe at +Z, heel at -Z.
// =============================================================================
export function makeShoe(prop, mats = {}) {
  const g = new THREE.Group();

  const footH = pos(prop && prop.footH, 0.10);
  const footLen = pos(prop && prop.footLen, 0.27);
  const tk = pos(prop && prop.legThick, 0.13);        // ankle / upper width

  const boot = mats.boot || mats.sole || new THREE.MeshToonMaterial();
  const sole = mats.sole || boot;

  const w = tk * 1.04;                 // shoe half-anchored on the leg width
  const groundY = -footH;              // sole underside sits on the floor
  const soleTop = groundY + footH * 0.26;

  // ---- SOLE (own material): a flat, slightly oversized rounded slab -------
  // Built from a flattened sphere so its edges are rounded (a slab that reads
  // as a sole, with a subtle toe-spring lift at the very front).
  const soleGeos = [];
  // main sole pad
  soleGeos.push(baked(
    new THREE.SphereGeometry(0.5, 20, 12),
    trs(0, groundY + footH * 0.13, footLen * 0.14,
        w * 1.16, footH * 0.30, footLen * 0.78),
  ));
  // heel block — a touch thicker at the back so the sole reads as a heel
  soleGeos.push(baked(
    new THREE.SphereGeometry(0.5, 16, 12),
    trs(0, groundY + footH * 0.16, -footLen * 0.16,
        w * 1.1, footH * 0.4, footLen * 0.34),
  ));
  const soleMesh = weld(soleGeos, sole, 0.010);
  g.add(soleMesh);

  // ---- UPPER (boot material): heel cup + swept body + instep + toe -------
  const upGeos = [];

  // rounded HEEL cup — a scaled sphere closing the back of the foot
  upGeos.push(baked(
    new THREE.SphereGeometry(0.5, 18, 14),
    trs(0, soleTop + footH * 0.30, -footLen * 0.18,
        w * 1.0, footH * 0.92, footLen * 0.42),
  ));

  // main UPPER body — a tapered rounded box (rounded via a soft sphere) that
  // rises toward the ankle (the instep). Slightly narrower than heel/toe so the
  // silhouette pinches at the waist of the foot like a real shoe.
  upGeos.push(baked(
    new THREE.SphereGeometry(0.5, 18, 14),
    trs(0, soleTop + footH * 0.34, -footLen * 0.02,
        w * 0.96, footH * 0.96, footLen * 0.76),
  ));

  // INSTEP rise — a smaller dome lifting up to meet the ankle/leg, so the boot
  // visibly climbs the ankle instead of stopping flat.
  upGeos.push(baked(
    new THREE.SphereGeometry(0.5, 16, 14),
    trs(0, soleTop + footH * 0.74, -footLen * 0.04,
        w * 0.92, footH * 0.95, footLen * 0.44),
  ));

  // ankle COLLAR — a short ring where the boot opening meets the leg (closes
  // the top so there is no hollow rim at the ankle).
  upGeos.push(baked(
    new THREE.CylinderGeometry(tk * 0.54, tk * 0.6, footH * 0.34, 18, 1),
    trs(0, -footH * 0.02, 0, 1, 1, 1),
  ));

  // ROUNDED TOE — a forward scaled sphere (the toe box). Wider & lower than the
  // body, sitting just above the sole; this is the single most "shoe" read.
  upGeos.push(baked(
    new THREE.SphereGeometry(0.5, 20, 16),
    trs(0, soleTop + footH * 0.34, footLen * 0.34,
        w * 0.98, footH * 0.74, footLen * 0.42),
  ));

  const upperMesh = weld(upGeos, boot, 0.012);
  g.add(upperMesh);

  return g;
}

// =============================================================================
//  HAND — makeHand(prop, mat, sgn) -> Object3D
// -----------------------------------------------------------------------------
//  A rounded palm with THREE short tapered fingers + a thumb, all welded into
//  ONE smooth mesh (no cluster of boxes). Fingers point DOWN (-Y) and fan out
//  slightly; the middle finger is longest. The thumb sits on the side chosen by
//  sgn (+1 left / -1 right) and angles outward.
//
//  Frame: y=0 at the wrist, palm just below, fingertips lowest.
// =============================================================================
export function makeHand(prop, mat, sgn = 1) {
  const size = pos(prop && prop.handSize, 0.11);
  const s = sgn >= 0 ? 1 : -1;
  const material = mat || new THREE.MeshToonMaterial();

  const geos = [];

  // ---- PALM: a rounded, slightly flattened block (scaled sphere) ----------
  // Sits just under the wrist. Flattened front-to-back so it reads as a palm,
  // not a ball; wider than deep.
  const palmY = -size * 0.34;
  geos.push(baked(
    new THREE.SphereGeometry(0.5, 18, 16),
    trs(0, palmY, 0, size * 0.86, size * 0.74, size * 0.46),
  ));
  // knuckle ridge — a low capsule across the base of the fingers so the
  // fingers grow out of a rounded crest instead of popping from a flat face.
  geos.push(baked(
    new THREE.CapsuleGeometry(size * 0.17, size * 0.42, 5, 12),
    trs(0, palmY - size * 0.30, 0, 1, 1, 0.7, 0, 0, Math.PI / 2),
  ));

  // ---- FINGERS: three tapered capsules, fanned, middle one longest --------
  const baseY = palmY - size * 0.34;
  // x offsets across the knuckle line; lengths give a natural finger profile.
  const fingers = [
    { x: -0.26, len: 0.40, r: 0.085, tilt: 0.16 }, // index
    { x: 0.00, len: 0.48, r: 0.090, tilt: 0.00 }, // middle (longest)
    { x: 0.26, len: 0.40, r: 0.085, tilt: -0.16 }, // ring
  ];
  for (const f of fingers) {
    const len = size * f.len;
    const r = size * f.r;
    const fingerLen = Math.max(len - 2 * r, size * 0.02);
    // capsule is centred on its own axis -> shift so its TOP meets the knuckle,
    // then tilt outward from the palm centre for a soft fan.
    const cx = f.x * size;
    geos.push(baked(
      new THREE.CapsuleGeometry(r, fingerLen, 5, 12),
      trs(cx, baseY - len * 0.5 + r, size * 0.02,
          1, 1, 0.92, 0, 0, f.tilt),
    ));
  }

  // ---- THUMB: a shorter, thicker capsule on the sgn side, angled out ------
  const thumbLen = size * 0.40;
  const thumbR = size * 0.10;
  const thumbCore = Math.max(thumbLen - 2 * thumbR, size * 0.02);
  geos.push(baked(
    new THREE.CapsuleGeometry(thumbR, thumbCore, 5, 12),
    // place at the side of the palm, rotate so it points down-and-outward
    trs(s * size * 0.40, palmY - size * 0.06, size * 0.06,
        1, 1, 1, 0, 0, s * 0.95),
  ));

  return weld(geos, material, 0.009);
}

// =============================================================================
//  HAIR — makeHair(prop, mat, opts) -> Object3D    opts = { style }
// -----------------------------------------------------------------------------
//  A scalp CAP that FULLY covers the cranium top/back/sides with NO gap. The
//  bug to kill: a floating cap that left a ring of bare scalp. Fix: the cap is a
//  half-dome scaled to be slightly LARGER than the head envelope and pulled DOWN
//  past the head's mid-line at the back/sides, so it always overlaps the skull.
//
//  style 'short' -> neat cap + a soft hairline visor above the brow + small
//                   sideburns. style 'long' -> the cap PLUS a back sheet hugging
//                   the nape and tapered locks flowing down back/sides that end
//                   in POINTS (cones), never a flat rectangle.
//
//  Frame: origin = neck-attach. Head spans y∈[0..headSize]; centre of skull at
//  y≈headSize*0.62; front face at +headDepth/2.
// =============================================================================
export function makeHair(prop, mat, opts = {}) {
  const g = new THREE.Group();

  const hs = pos(prop && prop.headSize, 0.42);
  const hd = pos(prop && prop.headDepth, 0.40);
  const style = (opts && opts.style) || 'short';
  const material = mat || new THREE.MeshToonMaterial();

  // Head envelope (from the contract): half extents + skull centre.
  const halfW = hs * 0.5;
  const halfD = hd * 0.5;
  const crownY = hs;            // top of the head
  const midY = hs * 0.62;     // skull centre height

  // The cap is intentionally OVERSIZED vs the head so it can never leave a gap.
  const padXY = 1.08;          // hugs the skull more (less "helmet")
  const padZ = 1.1;           // deeper front-to-back

  // MOHAWK: shaved sides + a central crest that FOLLOWS the scalp curve so it
  // never floats (the bug was a fixed crown height while the skull curves down).
  if (style === 'mohawk') {
    const crest = [];
    const cY = hs * 0.5;        // head centre height (head.js mesh sits at headSize*0.5)
    const hhEst = hs * 0.52;    // ~head half-height (matches head.js)
    const scalpY = (z) => cY + hhEst * Math.sqrt(Math.max(0.04, 1 - Math.pow(z / hd, 2)));
    const n = 6;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const z = (t - 0.5) * hd * 0.6 + hd * 0.05; // narrow + slightly forward: stay on the FULL crown, off the flattened occiput
      const yTop = scalpY(z);
      const spikeH = hs * (0.24 + 0.13 * (1 - Math.abs(t - 0.45) * 1.5));
      crest.push(baked(
        new THREE.ConeGeometry(hs * 0.11, Math.max(hs * 0.18, spikeH), 8),
        trs(0, yTop - hs * 0.05 + spikeH * 0.5, z, 1, 1, 0.72), // base sunk into the scalp
      ));
    }
    g.add(weld(crest, material, 0.012));
    return g;
  }

  const capGeos = [];

  // ---- CROWN DOME: upper half of a scaled sphere covering top + upper sides.
  // A full sphere is used (cheap) but pushed up so only the dome reads; the
  // lower hemisphere is buried inside the head, guaranteeing overlap (no gap).
  capGeos.push(baked(
    new THREE.SphereGeometry(0.5, 22, 18),
    trs(0, midY + hs * 0.12, -hd * 0.02,
        hs * padXY, hs * padXY, hd * padZ),
  ));

  // ---- BACK/SIDE SKIRT: a second dome pulled DOWN and back so the hair wraps
  // below the skull centre at the back and over the ears region. This is the
  // piece that closes the old gap along the hairline ring.
  capGeos.push(baked(
    new THREE.SphereGeometry(0.5, 22, 16),
    trs(0, midY - hs * 0.10, -hd * 0.10,
        hs * (padXY + 0.06), hs * 1.04, hd * (padZ + 0.04)),
  ));

  // (No front fringe/visor — repeatedly rejected as ugly and it covered the
  //  eyes. The forehead stays bare; the crown + sideburns frame the face.)

  // ---- SIDEBURNS: short tapered locks in front of where the ears sit, so the
  // sides are framed and the cap-to-cheek transition is closed.
  for (const sd of [+1, -1]) {
    capGeos.push(baked(
      new THREE.CapsuleGeometry(hs * 0.085, hs * 0.22, 4, 10),
      trs(sd * halfW * 1.04, midY - hs * 0.06, halfD * 0.34,
          1, 1, 0.7),
    ));
  }

  const capMesh = weld(capGeos, material, 0.013);
  g.add(capMesh);

  // ---------------------------------------------------------------------------
  //  LONG style — add a nape sheet + tapered flowing locks (points, no slab).
  // ---------------------------------------------------------------------------
  if (style === 'long') {
    const longGeos = [];

    // BACK SHEET: a rounded panel hugging the nape, from the crown down past the
    // neck. Tapered narrower at the bottom (scaled sphere, lower part) so it
    // doesn't read as a rectangle, and overlapping the cap so there's no seam.
    longGeos.push(baked(
      new THREE.SphereGeometry(0.5, 20, 16),
      trs(0, midY - hs * 0.55, -halfD * 0.92,
          hs * 0.86, hs * 1.15, hd * 0.42),
    ));

    // FLOWING LOCKS: tapered capsules (fat at the scalp, pointed at the tip)
    // cascading down the back and sides. Slight outward tilt + varied length =
    // organic strands, each ending in a point.
    const locks = [
      { x: -0.40, len: 1.15, r: 0.13, z: -0.34, tilt: 0.10 },
      { x: -0.16, len: 1.35, r: 0.14, z: -0.46, tilt: 0.04 },
      { x: 0.16, len: 1.35, r: 0.14, z: -0.46, tilt: -0.04 },
      { x: 0.40, len: 1.15, r: 0.13, z: -0.34, tilt: -0.10 },
    ];
    for (const k of locks) {
      const len = hs * k.len;
      const rTop = hs * k.r;
      // A cone gives a clean taper to a POINT; cap the top with a small sphere
      // so the strand root is rounded where it leaves the scalp.
      const topY = midY - hs * 0.08;
      // cone: base (wide) at top, apex (point) at bottom
      longGeos.push(baked(
        new THREE.ConeGeometry(rTop, len, 12, 1),
        trs(k.x * hs, topY - len * 0.5, k.z * hd,
            1, 1, 0.7, k.tilt, 0, k.x > 0 ? -0.05 : 0.05),
      ));
      // rounded root cap
      longGeos.push(baked(
        new THREE.SphereGeometry(rTop, 12, 10),
        trs(k.x * hs, topY, k.z * hd, 1, 1, 0.7),
      ));
    }

    const longMesh = weld(longGeos, material, 0.012);
    g.add(longMesh);
  }

  // TOPKNOT: a bun gathered on top of the cap with a small band.
  if (style === 'topknot') {
    const bun = [];
    bun.push(baked(
      new THREE.SphereGeometry(hs * 0.2, 14, 12),
      trs(0, crownY + hs * 0.16, -hd * 0.04, 1, 1.05, 1),
    ));
    bun.push(baked(
      new THREE.CylinderGeometry(hs * 0.09, hs * 0.1, hs * 0.08, 12),
      trs(0, crownY + hs * 0.01, -hd * 0.04, 1, 1, 1),
    ));
    g.add(weld(bun, material, 0.012));
  }

  return g;
}
