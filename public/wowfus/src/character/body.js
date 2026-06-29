import * as THREE from 'three';
import { addOutline } from '../core/outline.js';

// =============================================================================
//  IsoForge — SHAPED torso + tapered limbs (NOT boxes / NOT wooden tubes)
// -----------------------------------------------------------------------------
//  Both shapes are built from a LatheGeometry: we describe a 2-D silhouette
//  (x = radius, y = height) and revolve it around the Y axis. This gives an
//  ORGANIC body of revolution with smooth, seam-free normals — the opposite of
//  a RoundedBoxGeometry.
//
//  TORSO silhouette (revolved at full WIDTH, then squashed on Z for depth):
//      neck hole (small) → shoulder girdle (widest) → ribcage → pinched waist
//      → flared hips → rounded underside cap.
//    Width (torsoW) stays the dominant axis; depth (torsoD) is a Z-scale < 1, so
//    the chest is wider than it is deep (correct read), with a gentle front/back
//    bulge added on top for a believable chest+back curve. ONE continuous mesh —
//    no torso/pelvis seam.
//
//  LIMB silhouette: a capsule whose radius tapers r0 (top joint) → r1 (bottom),
//    with rounded hemispherical caps at both ends. The subtle taper kills the
//    "uniform tube" look; one piece per limb.
//
//  Each generator applies its OWN inverted-hull outline (addOutline) and sets
//  castShadow. Pure functions of (prop, …); deterministic; self-scaling; robust
//  against zero / missing prop values.
// =============================================================================

const EPS = 1e-4;

// Safe positive number with a fallback (guards undefined / NaN / <=0).
function pos(v, fallback) {
  const n = Number(v);
  return isFinite(n) && n > EPS ? n : fallback;
}

// Catmull–Rom through the control silhouette → a smooth, rounded profile with
// enough rings for clean lathe normals. Points are {y, r} (height, radius).
// Returns an array of THREE.Vector2(x=r, y) ready for LatheGeometry.
function smoothProfile(ctrl, segments) {
  const curve = new THREE.CatmullRomCurve3(
    ctrl.map((p) => new THREE.Vector3(p.r, p.y, 0)),
    false,
    'catmullrom',
    0.5,
  );
  const pts = curve.getPoints(Math.max(2, segments));
  return pts.map((v) => new THREE.Vector2(Math.max(0, v.x), v.y));
}

// -----------------------------------------------------------------------------
//  makeTorso(prop, mat) -> THREE.Object3D
//    Origin = the SPINE bone attach point. The torso extends DOWN over the hips
//    (~ y = -pelvisH*1.3) and UP to the chest top (~ y = spineLen + chestLen).
//    `mat` is the cloth / shirt MeshToonMaterial. Includes its own outline.
//    Exposes group.userData.anchors = { neckY, chestY, waistY, hipY, shoulderY,
//    chestZ, halfW, halfD }.
// -----------------------------------------------------------------------------
export function makeTorso(prop, mat) {
  const p = prop || {};
  const m = mat || new THREE.MeshToonMaterial({ color: 0x3f63c9 });

  // Robust segment lengths.
  const pelvisH = pos(p.pelvisH, 0.08);
  const spineLen = pos(p.spineLen, 0.14);
  const chestLen = pos(p.chestLen, 0.16);
  const torsoW = pos(p.torsoW, 0.36);
  const torsoD = pos(p.torsoD, 0.24);

  // Vertical span (origin at spine attach): hips underside → neck base.
  const yBot = -pelvisH * 1.3;
  const yTop = spineLen + chestLen;
  const H = Math.max(EPS, yTop - yBot);

  // Revolve at FULL WIDTH; depth becomes a Z-scale so width dominates.
  const halfW = torsoW * 0.5;
  const halfD = torsoD * 0.5;
  const depthScale = Math.min(1, halfD / Math.max(EPS, halfW)); // < 1 => deeper-than-wide is impossible

  // Heights of the silhouette features (named anchors), measured from the origin.
  const hipY = yBot + H * 0.16; // widest hips
  const waistY = yBot + H * 0.36; // pinch
  const chestY = yBot + H * 0.72; // chest / shoulder girdle (widest)
  const shoulderY = yBot + H * 0.90; // where arms hang
  const neckY = yTop; // neck hole

  // Control silhouette as RADIUS FRACTIONS of halfW (rounded chibi, but shaped):
  //   wide shoulders/chest at top, narrower pinched waist, flared hips,
  //   rounded caps so the ends are domed (no flat lid, no pinch point).
  const ctrl = [
    { y: yBot - EPS, r: 0.001 },          // pole: bottom cap centre
    { y: yBot + H * 0.015, r: 0.34 },     // start of rounded hip underside
    { y: yBot + H * 0.06, r: 0.74 },      // hip flare rising
    { y: hipY, r: 0.88 },                 // widest hips
    { y: waistY, r: 0.70 },               // pinched waist
    { y: yBot + H * 0.52, r: 0.82 },      // lower ribcage swelling back out
    { y: chestY, r: 0.9 },                // chest + shoulder girdle
    { y: yBot + H * 0.84, r: 0.82 },      // upper chest
    { y: shoulderY, r: 0.66 },            // shoulder slope inward
    { y: yBot + H * 0.975, r: 0.40 },     // neck base
    { y: neckY + EPS, r: 0.001 },         // pole: top cap centre (neck hole closes)
  ];

  // To radii in metres, then a smooth high-ring profile.
  const profile = smoothProfile(
    ctrl.map((c) => ({ y: c.y, r: c.r * halfW })),
    72, // vertical rings — smooth silhouette, still low-ish total poly
  );

  // Revolve. 24 radial segments = round but cheap.
  let geo = new THREE.LatheGeometry(profile, 24);

  // --- Width dominant: squash depth. Then add a gentle chest/back curve so the
  //     front and back aren't a flat cylinder wall (reads as a real torso). -----
  const att = geo.attributes.position;
  const vN = new THREE.Vector3();
  for (let i = 0; i < att.count; i++) {
    vN.fromBufferAttribute(att, i);
    let z = vN.z * depthScale;

    // Slightly puff the chest forward (+z) and round the back (−z) across the
    // upper torso; fades out toward waist/neck. Keeps it organic, not tubular.
    const tt = (vN.y - yBot) / H; // 0 at hips → 1 at neck
    const chestBand = Math.max(0, Math.min(1, (tt - 0.45) / 0.35)) *
                      Math.max(0, Math.min(1, (0.95 - tt) / 0.25));
    const front = z >= 0 ? 1 : 0.7; // chest bulges a touch more than the back
    z += Math.sign(z || 1) * halfD * 0.14 * chestBand * front *
         (Math.abs(vN.x) / Math.max(EPS, halfW)); // strongest on the centre line

    att.setXYZ(i, vN.x, vN.y, z);
  }
  att.needsUpdate = true;
  geo.computeVertexNormals(); // unify normals → smooth, continuous toon surface
  geo.computeBoundingBox();

  const group = new THREE.Group();
  group.name = 'torso';

  const mesh = new THREE.Mesh(geo, m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  // Proportional toon outline (band ~0.007–0.017). Scale with torso size.
  const band = Math.min(0.017, Math.max(0.009, halfW * 0.05));
  addOutline(mesh, band);

  // Anchors for the integrator (limb mounts, neck, depth at the chest front).
  group.userData.anchors = {
    neckY,
    chestY,
    waistY,
    hipY,
    shoulderY,
    chestZ: halfD * (1 + 0.14), // front-most chest surface z (incl. the bulge)
    halfW,
    halfD,
  };

  return group;
}

// -----------------------------------------------------------------------------
//  makeLimb(prop, len, r0, r1, mat) -> THREE.Object3D
//    A smoothly TAPERED capsule of total length `len`: radius r0 at the TOP
//    joint (y = 0) → r1 at the BOTTOM (y = -len), rounded hemispherical caps,
//    smooth normals. Origin at the top joint, extending down −Y. Used for arms
//    (shoulder→wrist) and legs (hip→ankle). Includes its own outline.
//    `prop` is accepted for signature consistency (outline band scaling); the
//    shape is driven entirely by len / r0 / r1.
// -----------------------------------------------------------------------------
export function makeLimb(prop, len, r0, r1, mat) {
  const m = mat || new THREE.MeshToonMaterial({ color: 0xe2a17c });

  const L = pos(len, 0.3);
  let rTop = pos(r0, 0.05);
  let rBot = pos(r1, rTop * 0.8);

  // Caps are hemispheres of the local radius; the straight shaft sits between
  // them. Clamp so the two caps can't overrun the total length.
  const capMax = L * 0.49;
  rTop = Math.min(rTop, capMax);
  rBot = Math.min(rBot, capMax);

  // Build the profile in a TOP-DOWN local frame first: yy = 0 at top → yy = L at
  // bottom (we flip to −Y after). x = radius at that height.
  //   - top hemisphere cap: yy ∈ [0, rTop]
  //   - tapered shaft:      yy ∈ [rTop, L − rBot], radius lerps rTop → rBot
  //   - bottom hemisphere:  yy ∈ [L − rBot, L]
  const ctrl = [];
  const shaftTop = rTop;
  const shaftBot = L - rBot;
  const shaftLen = Math.max(EPS, shaftBot - shaftTop);

  // Radius at a given shaft height (linear taper).
  const shaftR = (yy) => {
    const t = Math.min(1, Math.max(0, (yy - shaftTop) / shaftLen));
    return rTop + (rBot - rTop) * t;
  };

  // Top hemisphere (dome closing upward): sample a quarter circle.
  const capSeg = 5;
  for (let i = 0; i <= capSeg; i++) {
    const a = (i / capSeg) * (Math.PI / 2); // 0 → 90°
    const yy = shaftTop - Math.cos(a) * rTop; // from 0 (pole) down to shaftTop
    const x = Math.sin(a) * rTop;
    ctrl.push({ y: yy, r: x });
  }
  // Shaft (a couple of interior rings keep the taper smooth under normals).
  const shaftRings = 4;
  for (let i = 1; i < shaftRings; i++) {
    const yy = shaftTop + (shaftLen * i) / shaftRings;
    ctrl.push({ y: yy, r: shaftR(yy) });
  }
  // Bottom hemisphere (dome closing downward).
  for (let i = 0; i <= capSeg; i++) {
    const a = (i / capSeg) * (Math.PI / 2); // 0 → 90°
    const yy = shaftBot + Math.sin(a) * rBot; // from shaftBot down to L (pole)
    const x = Math.cos(a) * rBot;
    ctrl.push({ y: yy, r: x });
  }

  // Smooth + revolve. Flip Y so the limb grows DOWN (top joint at y = 0).
  const profile = smoothProfile(ctrl, 40).map(
    (v) => new THREE.Vector2(v.x, -v.y),
  );
  const geo = new THREE.LatheGeometry(profile, 18);
  geo.computeVertexNormals();
  geo.computeBoundingBox();

  const group = new THREE.Group();
  group.name = 'limb';

  const mesh = new THREE.Mesh(geo, m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  // Outline band proportional to limb thickness, clamped to the toon range.
  const band = Math.min(0.014, Math.max(0.007, rTop * 0.13));
  addOutline(mesh, band);

  return group;
}
