import * as THREE from 'three';

// Build the SHARED humanoid bone hierarchy. Every race gets the SAME bone names and
// the SAME parent/child topology; only the local offsets (lengths) differ.
// => same rig, different sizes. Animations (rotations on these named bones) are reusable.
export function buildSkeleton(p) {
  const bones = {};
  const make = (name) => { const g = new THREE.Group(); g.name = name; return g; };
  const add = (parent, name, x, y, z) => {
    const b = make(name); b.position.set(x, y, z); parent.add(b); bones[name] = b; return b;
  };

  // Root (pelvis) is raised so the feet rest exactly on y = 0.
  const root = make('root');
  root.position.y = p.footH + p.shin + p.thigh;
  bones.root = root;

  // Spine chain
  const spine = add(root,  'spine', 0, p.pelvisH, 0);
  const chest = add(spine, 'chest', 0, p.spineLen, 0);
  const neck  = add(chest, 'neck',  0, p.chestLen, 0);
  add(neck, 'head', 0, p.neckLen, 0);

  // Arms (L/R) — shoulder is also the upper-arm root.
  for (const s of [+1, -1]) {
    const side = s > 0 ? 'L' : 'R';
    const shoulder = add(chest, 'shoulder' + side, s * p.shoulderX, p.chestLen - 0.075, 0);
    const forearm  = add(shoulder, 'forearm' + side, 0, -p.upperArm, 0);
    add(forearm, 'hand' + side, 0, -p.foreArm, 0);
  }

  // Legs (L/R) — hip is also the thigh root.
  for (const s of [+1, -1]) {
    const side = s > 0 ? 'L' : 'R';
    const hip  = add(root, 'hip' + side, s * p.hipX, 0, 0);
    const shin = add(hip, 'shin' + side, 0, -p.thigh, 0);
    add(shin, 'foot' + side, 0, -p.shin, 0);
  }

  return { root, bones };
}
