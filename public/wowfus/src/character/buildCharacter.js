import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { resolveRace } from './races.js';
import { buildSkeleton } from './skeleton.js';
import { toonMat } from '../core/palette.js';
import { addOutline } from '../core/outline.js';
import { makeWizardHat } from '../items/hat.js';
import { makeHead } from './head.js';
import { makeTorso, makeLimb } from './body.js';
import { makeShoe, makeHand, makeHair } from './extremities.js';
import { addOutfit } from './outfit.js';

// Small rounded box — only used now for tiny face decorations (brows, nose, beard, tattoos).
function rbox(w, h, d, m, r = 0.04) {
  const radius = Math.min(r, w / 2, h / 2, d / 2) * 0.98;
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, radius), m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
function deco(bone, mesh, outline = 0.011) {
  bone.add(mesh);
  if (outline) addOutline(mesh, outline);
  return mesh;
}

export function buildCharacter(raceKey, opts = {}) {
  const accent = opts.accent ?? 0x3f63c9;
  const trimColor = opts.trim ?? 0xd8d3c8;
  const secondaryColor = opts.secondary ?? accent;
  const outfitStyle = opts.style ?? 'tunic';
  const race = resolveRace(raceKey);
  const p = race.prop;
  const f = race.features; // legacy flat flags (hair, beard, ears, tusks, brows, eye, ...)
  const { root, bones } = buildSkeleton(p);

  const skin = toonMat(opts.skinColor ?? race.skin);
  const cloth = toonMat(accent);
  const trim = toonMat(trimColor);
  const pants = toonMat(0x3c3a58);
  const shoeM = toonMat(0x4a3f50);
  const soleM = toonMat(0x1b1622);
  const hairM = toonMat(opts.hairColor ?? race.hair);
  const eyeW = toonMat(0xf6f5f0);
  const eyeD = new THREE.MeshBasicMaterial({ color: 0x1b1420 });
  const eyeGroups = [];
  const hs = p.headSize;

  // --- Trunk (shaped) ---
  const torsoObj = makeTorso(p, cloth);
  bones.spine.add(torsoObj);
  const TA = torsoObj.userData.anchors || {};
  const oHalfW = TA.halfW ?? p.torsoW * 0.5;
  const oHalfD = TA.halfD ?? p.torsoD * 0.5;
  const oOval = oHalfD / Math.max(0.01, oHalfW);

  // Hips — SAME colour as the shirt so it reads as the tunic covering the hips.
  const hip = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), cloth);
  hip.scale.set(p.torsoW * 0.9, p.pelvisH * 2.4, p.torsoD * 0.94);
  hip.position.y = -p.pelvisH * 0.1;
  hip.castShadow = true;
  bones.root.add(hip);
  addOutline(hip, 0.013);

  // --- Outfit: a DISTINCT styled look per race (tunic/robe/vest/straps/fur) ---
  addOutfit(bones, p, TA, outfitStyle, { cloth, trim: trimColor, secondary: secondaryColor });

  // --- Neck (short tapered skin column bridging chest -> head) ---
  const neck = new THREE.Mesh(new THREE.CapsuleGeometry(hs * 0.23, p.neckLen * 0.9, 5, 14), skin);
  neck.position.y = p.neckLen * 0.5;
  neck.castShadow = true;
  bones.neck.add(neck);
  addOutline(neck, 0.012);

  // --- Head (shaped) + anchors for mounting facial features ---
  const headGroup = makeHead(p, { skin });
  bones.head.add(headGroup);
  const A = headGroup.userData.anchors;

  // Eyes (sclera + iris + pupil + highlight), mounted at the head's eye anchor.
  const eyeDef = f.eye || { iris: 0x4a3526 };
  const irisColor = opts.eyeColor ?? eyeDef.iris;
  const irisM = toonMat(irisColor, eyeDef.glow ? { emissive: irisColor } : {});
  const lashM = new THREE.MeshBasicMaterial({ color: 0x2a1f28 });
  for (const s of [+1, -1]) {
    const grp = new THREE.Group();
    grp.position.set(s * A.eye.x, A.eye.y, A.faceZ + hs * 0.015); // clearly proud of the flat face
    grp.rotation.z = s * (eyeDef.almond ? -0.16 : -0.1);
    // Big white almond — clearly visible.
    const sc = new THREE.Mesh(new THREE.SphereGeometry(hs * 0.15, 18, 14), eyeW);
    sc.scale.set(1.25, eyeDef.almond ? 0.66 : 0.8, 0.45);
    grp.add(sc);
    // Big coloured iris + dark pupil, protruding so they catch the light.
    const ir = new THREE.Mesh(new THREE.SphereGeometry(hs * 0.092, 16, 14), irisM);
    ir.scale.set(1, 1, 0.55);
    ir.position.z = hs * 0.045;
    grp.add(ir);
    const pu = new THREE.Mesh(new THREE.SphereGeometry(hs * 0.05, 14, 12), eyeD);
    pu.scale.set(1, 1, 0.55);
    pu.position.z = hs * 0.075;
    grp.add(pu);
    const hl = new THREE.Mesh(new THREE.SphereGeometry(hs * 0.028, 8, 8), eyeW);
    hl.position.set(s * hs * 0.038, hs * 0.045, hs * 0.105);
    grp.add(hl);
    // Thin upper lash line — defines the top edge without covering the eye.
    const lash = new THREE.Mesh(new THREE.SphereGeometry(hs * 0.15, 16, 8), lashM);
    lash.scale.set(1.26, 0.13, 0.42);
    lash.position.set(0, hs * 0.11, hs * 0.06);
    grp.add(lash);
    bones.head.add(grp);
    eyeGroups.push(grp);
  }
  // Brows
  if (f.brows) {
    for (const s of [+1, -1]) {
      const b = rbox(hs * 0.15, hs * 0.03, hs * 0.05, hairM, 0.01);
      b.position.set(s * A.eye.x, A.brow.y, A.faceZ * 0.97);
      b.rotation.z = s * 0.16;
      deco(bones.head, b, 0.009);
    }
  }
  // Nose
  if (f.bigNose) {
    const nose = rbox(hs * 0.16, hs * 0.17, hs * 0.15, skin, 0.05);
    nose.position.set(0, A.nose.y, A.nose.z);
    deco(bones.head, nose, 0.011);
  }
  // Hair — style comes from the race's part selector (short/long/mohawk/topknot…).
  const hairStyle = opts.hairStyle ?? ((race.parts && race.parts.hairStyle) || (f.hair ? 'short' : 'none'));
  if (hairStyle && hairStyle !== 'none' && hairStyle !== 'bald') {
    bones.head.add(makeHair(p, hairM, { style: hairStyle }));
  }
  // Beard (hangs from the jaw/chin, smaller than the head, tapered)
  if (f.beard) {
    const bm = toonMat(f.beard);
    const beard = rbox(hs * 0.46, hs * 0.34, p.headDepth * 0.4, bm, hs * 0.18);
    beard.position.set(0, A.chinY - hs * 0.05, A.faceZ * 0.74);
    deco(bones.head, beard, 0.013);
    const tip = rbox(hs * 0.24, hs * 0.24, p.headDepth * 0.26, bm, hs * 0.12);
    tip.position.set(0, A.chinY - hs * 0.28, A.faceZ * 0.64);
    deco(bones.head, tip, 0.011);
    const mous = rbox(hs * 0.44, hs * 0.12, hs * 0.13, bm, 0.04);
    mous.position.set(0, A.nose.y - hs * 0.12, A.faceZ * 0.95);
    deco(bones.head, mous, 0.009);
  }
  // Ears
  if (f.ears) {
    for (const s of [+1, -1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(hs * 0.12, hs * 0.62, 8), skin);
      ear.castShadow = true;
      ear.position.set(s * A.earX, A.earY, -p.headDepth * 0.04);
      ear.rotation.z = s * -0.95;
      ear.rotation.x = -0.25;
      bones.head.add(ear);
      addOutline(ear, 0.011);
    }
  }
  // Circlet
  if (f.circlet) {
    const c = new THREE.Mesh(new THREE.TorusGeometry(hs * 0.49, hs * 0.032, 8, 28), toonMat(0xd9c06a));
    c.rotation.x = Math.PI / 2;
    c.position.y = A.brow.y + hs * 0.06;
    c.position.z = -p.headDepth * 0.02;
    bones.head.add(c);
    addOutline(c, 0.01);
  }
  // Tusks
  if (f.tusks) {
    for (const s of [+1, -1]) {
      const t = new THREE.Mesh(new THREE.ConeGeometry(hs * 0.1, hs * 0.44, 7), toonMat(0xe9e0c6));
      t.position.set(s * hs * 0.17, A.nose.y - hs * 0.24, A.faceZ * 0.92);
      t.rotation.x = Math.PI;  // apex DOWN: fangs jutting from the mouth
      t.rotation.z = s * 0.22;  // splay outward
      bones.head.add(t);
      addOutline(t, 0.01);
    }
  }
  // Horns (tauren) — curved cones sweeping up and out from the temples.
  if (f.horns) {
    const hornM = toonMat(0xe3dcc4);
    for (const s of [+1, -1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(hs * 0.16, hs * 0.95, 8), hornM);
      horn.position.set(s * hs * 0.36, A.headTopY - hs * 0.02, -p.headDepth * 0.05);
      horn.rotation.z = s * -0.5; // big horns sweeping UP and OUT
      horn.rotation.x = -0.1;
      bones.head.add(horn);
      addOutline(horn, 0.013);
    }
  }
  // Face tattoos — on the cheekbones, well below & outside the eyes.
  if (f.tattoos) {
    const ink = toonMat(f.tattoos, { emissive: 0x103b37 });
    const mark = (w, h, x, y, rot) => {
      const m = rbox(hs * w, hs * h, hs * 0.045, ink, 0.006);
      m.position.set(x, y, A.faceZ * 0.82);
      m.rotation.z = rot;
      bones.head.add(m);
    };
    for (const s of [+1, -1]) {
      mark(0.055, 0.15, s * hs * 0.19, A.eye.y - hs * 0.32, s * 0.5);
      mark(0.045, 0.1, s * hs * 0.13, A.eye.y - hs * 0.42, s * 0.5);
    }
    mark(0.06, 0.06, 0, A.brow.y - hs * 0.02, 0);
  }

  // --- Limbs (shaped, tapered) + sleeves + hands + shoes ---
  for (const side of ['L', 'R']) {
    const sgn = side === 'L' ? 1 : -1;
    // arm (skin), shoulder -> wrist
    bones['shoulder' + side].add(makeLimb(p, p.upperArm + p.foreArm, p.armThick * 0.55, p.armThick * 0.4, skin));
    // short sleeve over the upper arm
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(p.armThick * 0.62, p.upperArm * 0.5, 6, 14), cloth);
    sleeve.position.y = -p.upperArm * 0.32;
    sleeve.castShadow = true;
    bones['shoulder' + side].add(sleeve);
    addOutline(sleeve, 0.012);
    if (f.armBand) {
      const band = new THREE.Mesh(
        new THREE.TorusGeometry(p.armThick * 0.5, p.armThick * 0.12, 6, 18),
        toonMat(f.tattoos || 0x36d8c6, { emissive: 0x103b37 }));
      band.rotation.x = Math.PI / 2;
      band.position.y = -(p.upperArm + p.foreArm) * 0.62;
      bones['shoulder' + side].add(band);
    }
    const hand = makeHand(p, skin, sgn);
    bones['hand' + side].add(hand);

    // leg (trousers), hip -> ankle
    bones['hip' + side].add(makeLimb(p, p.thigh + p.shin, p.legThick * 0.55, p.legThick * 0.42, pants));
    bones['foot' + side].add(makeShoe(p, { boot: shoeM, sole: soleM }));

    bones['shoulder' + side].rotation.z = sgn * 0.2;
  }

  // --- Hat ---
  const hatStyle = opts.hat ?? f.hat ?? 'none';
  if (hatStyle === 'wizard') {
    const hat = makeWizardHat(0x5b4b9e, 0xe0b03a);
    hat.scale.setScalar(Math.min(hs, 0.42) * 1.7); // cap: a big head must not get a giant hat
    hat.position.y = A.hairTopY + hs * 0.04;
    hat.rotation.x = -0.1;
    bones.head.add(hat);
  }

  root.userData.race = race;
  return { root, bones, race, eyes: eyeGroups };
}
