import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addOutline } from '../core/outline.js';

// SHAPED STYLIZED HEAD -----------------------------------------------------------
// A real *head*, not a RoundedBoxGeometry cube. We start from a smooth sphere and
// SCULPT it by displacing vertices in object space:
//   - rounded cranium up top,
//   - gently narrower toward the jaw (taper),
//   - a soft chin that pulls forward & down,
//   - a slightly flattened face front (so eyes/nose/brows sit on a real plane),
//   - a slightly flattened back of the skull.
// A second small cheek/jaw volume is merged in and normals are recomputed so the
// toon shading reads as one organic surface. Cel-shading + inverted-hull outline
// stay crisp because the silhouette is still simple and convex-ish.

const EPS = 1e-4;

// smoothstep 0..1
function smooth(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / Math.max(EPS, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Build a sculpted skull geometry.
 * Local frame: head CENTRE at origin, +y up, +z front. Width≈hw, height≈hh, depth≈hd
 * are HALF-extents (radii). Returns a smooth-normalled BufferGeometry centred on (0,0,0).
 */
function sculptSkull(hw, hh, hd) {
  // IcosahedronGeometry → uniform, seam-free triangles (great for organic displacement
  // and a clean inverted-hull outline). detail 4 ≈ low-ish poly but smooth once normals
  // are averaged.
  const geo = new THREE.IcosahedronGeometry(1, 5); // higher detail → smoother, no lumps
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // Direction on the unit sphere.
    const nx = v.x, ny = v.y, nz = v.z;

    // Base ellipsoid: map the unit sphere to head half-extents.
    let x = nx * hw;
    let y = ny * hh;
    let z = nz * hd;

    // --- Jaw taper: full-width cranium, narrower lower face (smooth, no lumps). --
    const lower = smooth(0.25, -1.0, ny);
    const taper = 1 - 0.3 * lower;
    x *= taper;
    z *= taper;

    // --- Flat facial PLANE: pull the whole front in (a real face, not a bulb). ---
    const faceMask = smooth(0.28, 1.0, nz);
    z -= hd * 0.18 * faceMask;

    // --- Flatten the BACK of the skull hard (kill the bulbous-egg occiput). -----
    const backMask = smooth(-0.3, -1.0, nz);
    z += hd * 0.18 * backMask;

    // --- Soft chin: bottom-front dips down and slightly forward. -----------------
    const chin = smooth(-0.5, -1.0, ny) * smooth(0.1, 0.95, nz);
    z += hd * 0.06 * chin;
    y -= hh * 0.05 * chin;

    pos.setXYZ(i, x, y, z);
  }

  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Build a small jaw/cheek volume that we merge under the front-lower skull so the
 * lower face has organic mass (chin + jawline) instead of tapering to nothing.
 * Centred to overlap the skull's lower-front; returned in the same local frame.
 */
function sculptJaw(hw, hh, hd) {
  const geo = new THREE.IcosahedronGeometry(1, 3);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();

  // A squashed, forward-biased blob: wide-ish, short, pushed to the front.
  const jw = hw * 0.62; // jaw half-width
  const jh = hh * 0.34; // jaw half-height
  const jd = hd * 0.5;  // jaw half-depth

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let x = v.x * jw;
    let y = v.y * jh;
    let z = v.z * jd;
    // Taper the jaw toward the chin (bottom narrower → soft V).
    const lower = smooth(0.4, -1.0, v.y);
    x *= 1 - 0.45 * lower;
    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;

  // Seat it low and slightly forward, overlapping the skull's chin region.
  geo.translate(0, -hh * 0.42, hd * 0.16);
  geo.computeVertexNormals();
  return geo;
}

/**
 * makeHead(prop, materials)
 *   materials = { skin } : a MeshToonMaterial.
 * Returns a THREE.Group whose ORIGIN is the neck-attach point. The head sits ABOVE
 * the origin (≈ y in [0 .. headSize]); add it straight to the head bone, no offset.
 * Feature anchors (local coords) are on group.userData.anchors.
 */
export function makeHead(prop, materials) {
  const p = prop || {};
  const m = (materials && materials.skin) || new THREE.MeshToonMaterial({ color: 0xe2a17c });

  // Robust sizes (guard against zero / missing).
  const size = Math.max(EPS, p.headSize || 0.42);
  const depth = Math.max(EPS, p.headDepth || size);

  // Half-extents. Width & height from headSize; depth from headDepth.
  const hw = size * 0.5;        // half width
  const hh = size * 0.52;       // half height (barely taller)
  const hd = depth * 0.5;       // half depth

  const group = new THREE.Group();
  group.name = 'head';

  // One clean sculpted skull — no merged jaw blob (that was the source of lumps).
  const geo = sculptSkull(hw, hh, hd);
  geo.computeBoundingBox();

  const mesh = new THREE.Mesh(geo, m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Lift so the head CENTRE sits at y = headSize*0.5 → head occupies ~[0 .. headSize]
  // above the neck-attach origin.
  mesh.position.y = size * 0.5;
  group.add(mesh);
  addOutline(mesh, size * 0.04); // proportional toon outline (~0.017 at default size)

  // --- Anchors (group-local). Heights measured from the neck-attach origin. ------
  // mesh centre is at size*0.5, so "centre-relative" offsets become absolute by + size*0.5.
  const cY = size * 0.5;                  // head centre height
  const eyeY = cY + size * 0.02;          // eyes just above centre
  // Front facial-plane z at eye height: skull front (hd) minus the face flatten,
  // minus a touch so features inset slightly into the surface (not floating).
  const faceZ = hd - depth * 0.10 - depth * 0.02;

  const anchors = {
    // Front surface z at eye height (where eyes/brows/nose mount forward).
    faceZ,
    // Eye placement (matches the project's prior look: ±0.21·size, just above centre).
    eye: { x: size * 0.2, y: eyeY, z: faceZ * 0.98 },
    // Nose tip: below the eyes, on the facial plane (pushed fully to the front).
    nose: { y: cY - size * 0.06, z: faceZ * 1.02 },
    // Brow line: above the eyes.
    brow: { y: eyeY + size * 0.12 },
    // Ears: on the sides, at eye/upper-cheek height; slightly inside the half-width.
    earY: eyeY + size * 0.04,
    earX: hw * 0.96,
    // Hair sits just over the cranium crown.
    hairTopY: cY + hh + size * 0.04,
    // Absolute top of the skull (crown, incl. the egg lift).
    headTopY: cY + hh + hh * 0.06,
    // Chin: lowest point of the merged jaw, slightly forward.
    chinY: cY - hh - hh * 0.05,
  };
  group.userData.anchors = anchors;

  return group;
}
