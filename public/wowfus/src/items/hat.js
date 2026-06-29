import * as THREE from 'three';
import { toonMat } from '../core/palette.js';
import { addOutline } from '../core/outline.js';

// A stylized wizard hat — curved crown, floppy bent tip, wide upturned brim,
// gold band + square buckle. Returned ~1 unit tall, base at y=0; scale on attach.
export function makeWizardHat(crownColor = 0x5b4b9e, bandColor = 0xe0b03a) {
  const hat = new THREE.Group();
  const felt = toonMat(crownColor);
  const gold = toonMat(bandColor);

  // Crown — convex profile (wide base, tapering up).
  const crownPts = [
    new THREE.Vector2(0.30, 0.00), new THREE.Vector2(0.275, 0.10), new THREE.Vector2(0.22, 0.26),
    new THREE.Vector2(0.175, 0.44), new THREE.Vector2(0.135, 0.62), new THREE.Vector2(0.10, 0.78),
    new THREE.Vector2(0.07, 0.90),
  ];
  const crown = new THREE.Mesh(new THREE.LatheGeometry(crownPts, 32), felt);
  crown.castShadow = true;
  hat.add(crown);
  addOutline(crown, 0.012);

  // Floppy bent tip (pivot at the crown apex, rotated over).
  const tipPivot = new THREE.Group();
  tipPivot.position.set(0, 0.88, 0);
  tipPivot.rotation.z = -0.7;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.072, 0.32, 16), felt);
  tip.position.y = 0.14;
  tip.castShadow = true;
  tipPivot.add(tip);
  hat.add(tipPivot);
  addOutline(tip, 0.01);

  // Upturned brim (kept moderate so it doesn't hide the face from above).
  const brimPts = [
    new THREE.Vector2(0.26, 0.06), new THREE.Vector2(0.40, 0.008),
    new THREE.Vector2(0.52, 0.02), new THREE.Vector2(0.58, 0.11),
  ];
  const brim = new THREE.Mesh(new THREE.LatheGeometry(brimPts, 32), felt);
  brim.castShadow = true;
  hat.add(brim);
  addOutline(brim, 0.012);

  // Band + square buckle.
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.285, 0.045, 10, 32), gold);
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.12;
  hat.add(band);
  addOutline(band, 0.01);
  const buckle = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.02, 6, 4), gold);
  buckle.position.set(0, 0.12, 0.275);
  hat.add(buckle);

  return hat;
}
