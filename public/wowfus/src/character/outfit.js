import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { toonMat } from '../core/palette.js';
import { addOutline } from '../core/outline.js';

// =============================================================================
//  IsoForge — per-race OUTFITS (Dofus-style: one distinct look per race).
//  addOutfit(bones, p, anchors, style, mats) attaches clothing to the rig.
//  styles: tunic | robe | vest | straps | fur.  mats = { cloth, trim, secondary }.
//
//  KEY: the torso is a shaped lathe (pinched waist, wide chest), so every front
//  piece is placed at the torso's ACTUAL surface depth at its height (frontZ),
//  and belts are sized to the torso radius there — nothing floats off the body.
// =============================================================================

function rbox(w, h, d, m, r = 0.04) {
  const radius = Math.min(r, w / 2, h / 2, d / 2) * 0.98;
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, radius), m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function addOutfit(bones, p, A, style, mats) {
  const cloth = mats.cloth;
  const trimM = toonMat(mats.trim);
  const secM = toonMat(mats.secondary);
  const gold = toonMat(0xd9c06a);

  const halfW = A.halfW ?? p.torsoW * 0.5;
  const halfD = A.halfD ?? p.torsoD * 0.5;
  const oval = halfD / Math.max(0.01, halfW);
  const waistY = A.waistY ?? 0;
  const chestY = A.chestY ?? halfW;
  const neckY = A.neckY ?? halfW * 2;
  const hipY = A.hipY ?? -halfW * 0.4;

  // Radius FRACTION of the torso at a height (mirrors makeTorso's silhouette):
  // hips 0.88 -> pinched waist 0.70 -> chest 1.0 -> neck 0.42.
  const pts = [[hipY, 0.88], [waistY, 0.70], [chestY, 1.0], [neckY, 0.42]];
  const rAt = (y) => {
    if (y <= pts[0][0]) return pts[0][1];
    if (y >= pts[3][0]) return pts[3][1];
    for (let i = 1; i < pts.length; i++) {
      if (y <= pts[i][0]) {
        const [y0, r0] = pts[i - 1];
        const [y1, r1] = pts[i];
        return r0 + (r1 - r0) * ((y - y0) / ((y1 - y0) || 1));
      }
    }
    return 0.8;
  };
  const frontZ = (y) => halfD * rAt(y) * 1.04; // just proud of the surface

  const belt = (y, tube = 0.08, m = trimM) => {
    const b = new THREE.Mesh(new THREE.TorusGeometry(halfW * rAt(y) * 1.04, halfW * tube, 8, 24), m);
    b.rotation.x = Math.PI / 2;
    b.scale.z = oval;
    b.position.y = y;
    b.castShadow = true;
    bones.spine.add(b);
    addOutline(b, 0.012);
  };
  const buckle = (y) => {
    const k = rbox(halfW * 0.2, halfW * 0.2, halfW * 0.08, gold, 0.02);
    k.position.set(0, y, frontZ(y));
    bones.spine.add(k);
    addOutline(k, 0.01);
  };
  const collar = () => {
    const yy = neckY - p.headSize * 0.05;
    const c = new THREE.Mesh(new THREE.TorusGeometry(halfW * rAt(yy) * 1.08, p.headSize * 0.05, 8, 20), trimM);
    c.rotation.x = Math.PI / 2;
    c.scale.z = oval;
    c.position.y = yy;
    bones.spine.add(c);
    addOutline(c, 0.011);
  };
  const pauldrons = (m, sx = 1.05, sy = 0.62) => {
    for (const side of ['L', 'R']) {
      const pad = new THREE.Mesh(new THREE.SphereGeometry(p.armThick * 0.95, 14, 10), m);
      pad.scale.set(sx, sy, sx);
      pad.position.y = p.armThick * 0.12;
      pad.castShadow = true;
      bones['shoulder' + side].add(pad);
      addOutline(pad, 0.013);
    }
  };

  if (style === 'robe') {
    const len = (p.thigh + p.shin) * 0.72;
    const prof = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      prof.push(new THREE.Vector2(THREE.MathUtils.lerp(halfW * 0.78, halfW * 1.18, t), -t * len));
    }
    const skirt = new THREE.Mesh(new THREE.LatheGeometry(prof, 22), cloth);
    skirt.scale.z = oval;
    skirt.position.y = waistY + halfW * 0.05;
    skirt.castShadow = true;
    bones.spine.add(skirt);
    addOutline(skirt, 0.013);
    const cy = (neckY + waistY) / 2;
    const sash = rbox(halfW * 0.26, (neckY - waistY) * 1.1, halfD * 0.1, trimM, halfW * 0.04);
    sash.position.set(halfW * 0.16, cy, frontZ(cy));
    sash.rotation.z = 0.55;
    bones.spine.add(sash);
    addOutline(sash, 0.011);
    belt(waistY, 0.05);
    collar();
    return;
  }

  if (style === 'vest') {
    for (const sx of [+1, -1]) {
      const cy = (chestY + waistY) / 2 + halfW * 0.05;
      const panel = rbox(halfW * 0.44, (chestY - waistY) + halfW * 0.5, halfD * 0.18, secM, halfD * 0.1);
      panel.position.set(sx * halfW * 0.32, cy, frontZ(cy) * 0.96);
      bones.spine.add(panel);
      addOutline(panel, 0.011);
    }
    for (let i = 0; i < 3; i++) {
      const by = waistY + halfW * 0.22 + i * (chestY - waistY) * 0.4;
      const b = new THREE.Mesh(new THREE.SphereGeometry(halfW * 0.06, 8, 8), gold);
      b.position.set(0, by, frontZ(by) * 1.02);
      bones.spine.add(b);
    }
    belt(waistY, 0.07);
    buckle(waistY);
    collar();
    return;
  }

  if (style === 'straps') {
    const cy = (chestY + hipY) / 2;
    const strap = rbox(halfW * 0.22, (neckY - hipY) * 1.05, halfD * 0.12, trimM, halfW * 0.04);
    strap.position.set(0, cy, frontZ(cy));
    strap.rotation.z = 0.62;
    bones.spine.add(strap);
    addOutline(strap, 0.011);
    const guard = new THREE.Mesh(new THREE.SphereGeometry(p.armThick * 1.15, 14, 10), trimM);
    guard.scale.set(1.15, 0.72, 1.15);
    guard.position.y = p.armThick * 0.16;
    bones.shoulderL.add(guard);
    addOutline(guard, 0.013);
    belt(hipY, 0.09);
    return;
  }

  if (style === 'fur') {
    const mantle = new THREE.Mesh(new THREE.TorusGeometry(halfW * 0.86, halfW * 0.3, 8, 20), trimM);
    mantle.rotation.x = Math.PI / 2;
    mantle.scale.set(1, oval, 0.72);
    mantle.position.y = chestY + halfW * 0.16;
    mantle.castShadow = true;
    bones.spine.add(mantle);
    addOutline(mantle, 0.014);
    pauldrons(trimM, 1.25, 0.82);
    belt(waistY, 0.1);
    buckle(waistY);
    return;
  }

  if (style === 'plate') {
    // Heavy pauldrons + a metal breastplate + a wide belt (warrior / paladin).
    pauldrons(trimM, 1.35, 0.9);
    const cy = (chestY + waistY) / 2 + halfW * 0.06;
    const bp = rbox(halfW * 1.04, (chestY - waistY) + halfW * 0.5, halfD * 0.22, trimM, halfW * 0.12);
    bp.position.set(0, cy, frontZ(cy) * 0.97);
    bones.spine.add(bp);
    addOutline(bp, 0.013);
    belt(waistY, 0.1);
    buckle(waistY);
    return;
  }

  if (style === 'mail') {
    // Mail tunic: medium pauldrons + belt + collar + a front placket (shaman).
    pauldrons(trimM, 1.05, 0.62);
    belt(waistY, 0.08);
    buckle(waistY);
    collar();
    const cy = (neckY + waistY) / 2;
    const placket = rbox(halfW * 0.18, (neckY - waistY) * 0.78, halfD * 0.1, secM, halfW * 0.04);
    placket.position.set(0, cy, frontZ(cy));
    bones.spine.add(placket);
    addOutline(placket, 0.01);
    return;
  }

  // default 'tunic'
  belt(waistY);
  buckle(waistY);
  collar();
  const cy = (neckY + waistY) / 2;
  const placket = rbox(halfW * 0.16, (neckY - waistY) * 0.8, halfD * 0.1, trimM, halfW * 0.04);
  placket.position.set(0, cy, frontZ(cy));
  bones.spine.add(placket);
  addOutline(placket, 0.01);
}
