import * as THREE from 'three';

// =============================================================================
//  IsoForge — procedural spell VFX. Each cast pushes one or more self-updating
//  effects onto `active`; the game loop calls update(dt) once per frame and each
//  effect disposes itself when finished. Cores/trails use AdditiveBlending so they
//  read as "magic light" against the cel-shaded scene; ground rings stay opaque.
//
//  Public archetypes (one per spell `fx`): projectile (fire/frost/shadow/holy/
//  nature/arcane), lightning, chain, arrow, arrowVolley, blades (fan of knives),
//  slash (melee), holyHammer (judgment), heal. impact() is the shared landing burst.
// =============================================================================

export function makeVfx(scene) {
  const active = [];
  const add = (eff) => active.push(eff);

  function update(dt) {
    for (let k = active.length - 1; k >= 0; k--) {
      if (active[k].step(dt)) { active[k].dispose(); active.splice(k, 1); }
    }
  }

  // ---- shared, scene-lifetime geometries (NEVER disposed) --------------------
  const G = {
    sph: new THREE.IcosahedronGeometry(1, 1),          // unit puff / flash / mote
    shard: new THREE.OctahedronGeometry(1, 0),         // ice crystal / debris
    ring: new THREE.RingGeometry(0.5, 1, 36).rotateX(-Math.PI / 2), // ground shockwave
  };
  const SHARED = new Set(Object.values(G));
  const UP = new THREE.Vector3(0, 1, 0);
  const FWD = new THREE.Vector3(0, 0, 1);

  // ---- material helpers (one per effect → opacity animates independently) ----
  const glow = (color, opacity = 1) => new THREE.MeshBasicMaterial(
    { color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
  const solid = (color) => new THREE.MeshBasicMaterial({ color });

  // Every per-instance geometry + material under `obj`, for disposal (skips SHARED).
  function trashOf(obj) {
    const set = new Set();
    obj.traverse((o) => {
      if (o.geometry && !SHARED.has(o.geometry)) set.add(o.geometry);
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => set.add(m));
    });
    return [...set];
  }

  // Standard lifecycle: add `obj`, run onStep(k, dt, t) over `dur` seconds, then dispose.
  function run(obj, dur, onStep) {
    scene.add(obj);
    let t = 0;
    add({
      step(dt) { t += dt; const k = Math.min(1, t / dur); onStep(k, dt, t); return t >= dur; },
      dispose() { scene.remove(obj); for (const x of trashOf(obj)) x.dispose(); },
    });
  }

  // Fire `fn` once after `t` seconds (no visual) — staggers sub-effects (volleys, chains).
  function delay(t, fn) {
    let e = 0;
    add({ step(dt) { e += dt; if (e >= t) { fn(); return true; } return false; }, dispose() {} });
  }

  // A single fading additive puff — projectile trails, sparkles.
  function puff(pos, color, size, life = 0.3) {
    const m = new THREE.Mesh(G.sph, glow(color, 0.85));
    m.position.copy(pos); m.scale.setScalar(size);
    run(m, life, (k) => { m.scale.setScalar(size * (1 - k * 0.6)); m.material.opacity = 0.85 * (1 - k); });
  }

  // ---- impact: shared landing burst, flavoured by element --------------------
  const FLAVOR = {
    arcane:    { n: 8,  speed: 2.4, up: 2.2, g: 7, size: 0.09, shard: false },
    fire:      { n: 13, speed: 2.9, up: 3.0, g: 5, size: 0.11, shard: false, spark: 0xffb04a, ring: 0xff7a2a },
    frost:     { n: 11, speed: 2.6, up: 1.8, g: 9, size: 0.12, shard: true,  spark: 0xcdeaff, ring: 0x8fd6ff },
    shadow:    { n: 10, speed: 2.2, up: 1.3, g: 4, size: 0.12, shard: false, spark: 0x7a32b0, ring: 0x9a4ed0 },
    holy:      { n: 12, speed: 2.6, up: 2.6, g: 6, size: 0.10, shard: false, spark: 0xfff2c0, ring: 0xffe08a },
    nature:    { n: 10, speed: 2.2, up: 2.0, g: 6, size: 0.10, shard: true,  spark: 0xc0ec84 },
    lightning: { n: 10, speed: 3.4, up: 2.4, g: 6, size: 0.08, shard: false, spark: 0xe6f7ff },
    physical:  { n: 9,  speed: 2.6, up: 1.7, g: 9, size: 0.08, shard: true,  spark: 0xffffff },
  };

  function impact(pos, color, style = 'arcane') {
    const fl = FLAVOR[style] || FLAVOR.arcane;
    const grp = new THREE.Group(); grp.position.copy(pos);

    const ringMat = new THREE.MeshBasicMaterial(
      { color: fl.ring ?? color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(G.ring, ringMat); ring.position.y = 0.07; grp.add(ring);

    const flashMat = glow(color, 0.95);
    const flash = new THREE.Mesh(G.sph, flashMat); flash.position.y = 0.5; grp.add(flash);

    const light = new THREE.PointLight(color, 7, 5); light.position.y = 0.5; grp.add(light);

    const bmat = glow(fl.spark ?? color, 1);
    const bits = [];
    for (let i = 0; i < fl.n; i++) {
      const m = new THREE.Mesh(fl.shard ? G.shard : G.sph, bmat);
      const a = Math.random() * Math.PI * 2, sp = fl.speed * (0.5 + Math.random());
      m.userData.v = new THREE.Vector3(Math.cos(a) * sp, fl.up * (0.4 + Math.random()), Math.sin(a) * sp);
      m.position.y = 0.45;
      m.scale.setScalar(fl.size * (0.7 + Math.random() * 0.6));
      if (fl.shard) m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      grp.add(m); bits.push(m);
    }

    run(grp, 0.55, (k, dt) => {
      ring.scale.setScalar(0.4 + k * 5.2); ringMat.opacity = 0.9 * (1 - k);
      flash.scale.setScalar(0.3 + k * 0.9); flashMat.opacity = 0.95 * (1 - k * k);
      light.intensity = 7 * (1 - k);
      bmat.opacity = 1 - k * k;
      for (const m of bits) {
        m.userData.v.y -= fl.g * dt;
        m.position.addScaledVector(m.userData.v, dt);
        if (m.position.y < 0.05) { m.position.y = 0.05; m.userData.v.y *= -0.35; m.userData.v.x *= 0.6; m.userData.v.z *= 0.6; }
        if (fl.shard) { m.rotation.x += dt * 6; m.rotation.y += dt * 4; }
      }
    });
  }

  // ---- projectile: glowing core + halo + trail, arcs to target then impacts ---
  function projectile(from, to, opts = {}) {
    const { color = 0xffffff, style = 'arcane', onHit, arc = 0.45, spin = 0, geo, trail } = opts;
    const size = opts.size ?? 0.17;
    const a = from.clone(); a.y = 0.62;
    const b = to.clone(); b.y = 0.5;
    const dur = Math.max(0.16, a.distanceTo(b) * (opts.step ?? 0.05));

    const grp = new THREE.Group(); grp.position.copy(a);
    const core = new THREE.Mesh(geo === 'shard' ? G.shard : G.sph, glow(color, 1)); core.scale.setScalar(size); grp.add(core);
    const halo = new THREE.Mesh(G.sph, glow(color, 0.3)); halo.scale.setScalar(size * 2); grp.add(halo);
    grp.add(new THREE.PointLight(color, 3, 3));

    let acc = 0;
    run(grp, dur, (k, dt) => {
      grp.position.lerpVectors(a, b, k);
      grp.position.y = a.y + (b.y - a.y) * k + Math.sin(k * Math.PI) * arc;
      if (spin) { core.rotation.y += dt * spin; core.rotation.x += dt * spin * 0.6; }
      core.scale.setScalar(size * (1 + Math.sin(k * 40) * 0.08));
      acc += dt; if (acc > 0.022) { acc = 0; puff(grp.position, trail ?? color, size * 1.05, 0.3); }
      if (k >= 1 && !grp.userData.hit) {
        grp.userData.hit = true;
        if (opts.explode) explosion(b, color); else impact(b, color, style);
        if (opts.patch === 'fire') firePatch(b, color);
        onHit && onHit();
      }
    });
  }

  // ---- arrow: an oriented shaft flying nearly flat, with a faint streak --------
  function makeArrow(color) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.5, 6), solid(0x6b4a2a)));
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 6), glow(color, 1)); head.position.y = 0.32; g.add(head);
    for (const s of [1, -1]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.1, 0.07), solid(0xe6e0d2));
      f.position.y = -0.2; f.rotation.y = s * 0.7; g.add(f);
    }
    return g; // built along +Y (tip up); orient UP → travel direction
  }
  function arrow(from, to, opts = {}) {
    const { color = 0xcfe0a0, onHit } = opts;
    const a = from.clone(); a.y = 0.9;
    const b = to.clone(); b.y = 0.6;
    const grp = makeArrow(color); grp.position.copy(a);
    grp.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
    const dur = Math.max(0.12, a.distanceTo(b) * 0.035);
    let acc = 0;
    run(grp, dur, (k, dt) => {
      grp.position.lerpVectors(a, b, k);
      grp.position.y = a.y + (b.y - a.y) * k + Math.sin(k * Math.PI) * 0.1;
      acc += dt; if (acc > 0.03) { acc = 0; puff(grp.position, color, 0.045, 0.16); }
      if (k >= 1 && !grp.userData.hit) { grp.userData.hit = true; impact(b, color, 'physical'); onHit && onHit(); }
    });
  }
  function arrowVolley(from, to, color, n = 5, onHit) {
    for (let i = 0; i < n; i++) {
      const jit = to.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0, (Math.random() - 0.5) * 0.8));
      delay(i * 0.045, () => arrow(from, jit, { color, onHit: i === 0 ? onHit : null }));
    }
  }

  // ---- lightning: a jagged bolt of segment-boxes (hot white core + colour body)
  function jagged(a, b, segs, amp) {
    const dir = b.clone().sub(a);
    const perp = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const p = a.clone().lerp(b, t);
      if (i > 0 && i < segs) {
        const j = amp * (1 - Math.abs(t - 0.5) * 1.3);   // taper the jag toward both ends
        p.addScaledVector(perp, (Math.random() - 0.5) * 2 * j);
        p.y += (Math.random() - 0.5) * 2 * j;
      }
      pts.push(p);
    }
    return pts;
  }
  function segBox(p0, p1, thick, mat) {
    const d = p1.clone().sub(p0), len = d.length();
    const m = new THREE.Mesh(new THREE.BoxGeometry(thick, thick, len), mat);
    m.position.copy(p0).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(FWD, d.normalize());
    return m;
  }
  function lightning(from, to, color, opts = {}) {
    const a = from.clone(); a.y = opts.y0 ?? 0.72;
    const b = to.clone(); b.y = opts.y1 ?? 0.55;
    const segs = opts.segs ?? Math.max(6, Math.round(a.distanceTo(b) * 2));
    const pts = jagged(a, b, segs, opts.amp ?? 0.22);
    const grp = new THREE.Group();
    const bodyMat = glow(color, 1), coreMat = glow(0xffffff, 1);
    const thick = opts.thick ?? 0.055;
    for (let i = 0; i < pts.length - 1; i++) {
      grp.add(segBox(pts[i], pts[i + 1], thick, bodyMat));
      grp.add(segBox(pts[i], pts[i + 1], thick * 0.4, coreMat));
    }
    const light = new THREE.PointLight(color, 5, 4); light.position.copy(b); grp.add(light);
    run(grp, opts.dur ?? 0.26, (k) => {
      const o = (Math.sin(k * 55) * 0.5 + 0.5) * (1 - k) + (1 - k) * 0.35; // strobe + decay
      bodyMat.opacity = Math.min(1, o + 0.15); coreMat.opacity = Math.min(1, o + 0.3);
      light.intensity = 5 * (1 - k);
    });
    if (opts.impact !== false) impact(b, color, opts.style ?? 'lightning');
  }
  // chain: bolts hop along a list of world points, each with a spark at its node.
  function chain(points, color) {
    for (let i = 0; i < points.length - 1; i++) {
      delay(i * 0.09, () => {
        lightning(points[i], points[i + 1], color, { impact: false, amp: 0.2, dur: 0.32 });
        impact(points[i + 1], color, 'lightning');
      });
    }
  }

  // ---- blades: Fan of Knives — daggers spiral OUTWARD around the caster --------
  function makeKnife() {
    const g = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.32, 4), glow(0xeaf2ff, 1));
    blade.rotation.z = -Math.PI / 2; blade.position.x = 0.16; g.add(blade);  // tip toward +X
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.03), solid(0x9aa0aa)); g.add(guard);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 6), solid(0x3a2c22));
    handle.rotation.z = Math.PI / 2; handle.position.x = -0.08; g.add(handle);
    g.userData.mats = [blade.material, guard.material, handle.material];
    return g;
  }
  function blades(center, opts = {}) {
    const { color = 0xcfd6e0, radius = 2.3, n = 12 } = opts;
    const grp = new THREE.Group(); grp.position.copy(center); grp.position.y = 0.55;
    const knives = [];
    for (let i = 0; i < n; i++) { const kn = makeKnife(); kn.userData.ang = (i / n) * Math.PI * 2; grp.add(kn); knives.push(kn); }
    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(G.ring, ringMat); ring.position.y = -0.5; grp.add(ring);
    const light = new THREE.PointLight(color, 5, radius + 2); grp.add(light);
    run(grp, 0.6, (k, dt) => {
      const r = 0.2 + k * radius, spin = k * Math.PI * 4;   // expand outward + whirl twice
      for (const kn of knives) {
        const a = kn.userData.ang + spin;
        kn.position.set(Math.cos(a) * r, Math.sin(k * Math.PI) * 0.25, Math.sin(a) * r);
        kn.rotation.y = -a;             // blade points radially outward
        kn.rotation.x += dt * 14;       // tumble
        kn.scale.setScalar(1 - k * 0.25);
        const o = Math.min(1, 1.5 - k * 1.5);
        for (const m of kn.userData.mats) { m.transparent = true; m.opacity = o; }
      }
      ring.scale.setScalar(0.4 + k * (radius + 0.4)); ringMat.opacity = 0.8 * (1 - k);
      light.intensity = 5 * (1 - k);
    });
  }

  // ---- slash: a glowing crescent swipe in front of a melee attacker -----------
  function slash(pos, dir, color, opts = {}) {
    const wide = !!opts.wide;
    const grp = new THREE.Group(); grp.position.copy(pos); grp.position.y = 0.75;
    grp.rotation.y = Math.atan2(dir.x, dir.z);              // face the target
    const span = wide ? Math.PI * 1.05 : Math.PI * 0.66;
    const arcMat = glow(color, 0.9);
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.045, 6, 24, span), arcMat);
    arc.rotation.x = Math.PI / 2; arc.position.z = 0.45; grp.add(arc);       // sweep in front
    const light = new THREE.PointLight(color, 4, 3); light.position.z = 0.5; grp.add(light);
    run(grp, 0.24, (k) => {
      grp.scale.setScalar(0.7 + k * 0.7);
      arc.rotation.z = -span / 2 - 0.4 + k * 0.8;
      arcMat.opacity = 0.9 * (1 - k); light.intensity = 4 * (1 - k);
    });
    impact(pos.clone().addScaledVector(dir, wide ? 0.5 : 0.85), color, 'physical');
  }

  // ---- holyHammer: Judgment — a hammer of light slams down from the sky --------
  function holyHammer(to, color) {
    const Y = 5;
    const grp = new THREE.Group(); grp.position.set(to.x, Y, to.z);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.34), glow(0xfff0b4, 1)); head.position.y = 0.55; grp.add(head);
    grp.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.85, 8), glow(0xffe392, 1)));
    grp.add(new THREE.PointLight(color, 6, 6));
    run(grp, 0.32, (k) => {
      grp.position.y = Y + (0.55 - Y) * (k * k);            // accelerate downward
      grp.rotation.y = k * 2;
      if (k >= 1 && !grp.userData.hit) { grp.userData.hit = true; impact(to, color, 'holy'); }
    });
    // descending light-beam telegraph
    const beamMat = glow(color, 0.35);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.32, 5, 14, 1, true), beamMat);
    beam.position.set(to.x, 2.5, to.z);
    run(beam, 0.3, (k) => { beamMat.opacity = 0.35 * (1 - k); beam.scale.set(1 - k * 0.4, 1, 1 - k * 0.4); });
  }

  // ---- heal: rising column of light + swirling motes (holy gold / nature green)
  function heal(pos, color, style = 'holy') {
    const grp = new THREE.Group(); grp.position.copy(pos);
    const colMat = glow(color, 0.5);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 1.9, 18, 1, true), colMat);
    col.position.y = 0.95; grp.add(col);
    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(G.ring, ringMat); ring.position.y = 0.06; grp.add(ring);
    const light = new THREE.PointLight(color, 5, 4); light.position.y = 1; grp.add(light);
    const mMat = glow(color, 1);
    const motes = [];
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(style === 'nature' ? G.shard : G.sph, mMat);
      m.userData = { ang: Math.random() * Math.PI * 2, rr: 0.12 + Math.random() * 0.48,
                     y0: Math.random() * 1.8, sp: 1.2 + Math.random() * 1.5, sz: 0.05 + Math.random() * 0.055 };
      grp.add(m); motes.push(m);
    }
    run(grp, 0.85, (k, dt, t) => {
      col.scale.set(1 + k * 0.2, 1, 1 + k * 0.2); col.rotation.y += dt * 3; colMat.opacity = 0.5 * (1 - k);
      ring.scale.setScalar(0.4 + k * 2.2); ringMat.opacity = 0.85 * (1 - k);
      light.intensity = 5 * (1 - 0.6 * k);
      for (const m of motes) {
        const u = m.userData, yy = (u.y0 + t * u.sp) % 1.8;
        m.position.set(Math.cos(u.ang + t * 2) * u.rr, yy, Math.sin(u.ang + t * 2) * u.rr);
        m.scale.setScalar(u.sz * (1 - yy / 1.9));
        if (style === 'nature') m.rotation.set(t * 3, t * 2 + u.ang, 0);
      }
      mMat.opacity = 1 - k * k;
    });
  }

  // ---- telegraph: a WoW-style ground "danger" disc marking an incoming AoE -----
  function telegraph(center, radiusTiles, color, dur = 0.55) {
    const R = (radiusTiles + 0.5);                 // tiles → world units (T = 1)
    const grp = new THREE.Group(); grp.position.copy(center); grp.position.y = 0.04;
    const fillMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
    const fill = new THREE.Mesh(new THREE.CircleGeometry(R, 40).rotateX(-Math.PI / 2), fillMat); grp.add(fill);
    const edgeMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
    const edge = new THREE.Mesh(G.ring, edgeMat); edge.scale.setScalar(R); edge.position.y = 0.01; grp.add(edge);
    const pulseMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
    const pulse = new THREE.Mesh(G.ring, pulseMat); pulse.position.y = 0.02; grp.add(pulse);
    run(grp, dur, (k) => {
      const grow = Math.min(1, k / 0.22);          // snap to full radius, then hold
      fill.scale.setScalar(0.2 + grow * 0.8);
      fillMat.opacity = (0.12 + 0.12 * Math.sin(k * 22)) * (1 - k * k); // shimmer + fade
      edgeMat.opacity = 0.85 * (1 - k * 0.6);
      pulse.scale.setScalar(R * (0.2 + (k % 0.5) * 2)); pulseMat.opacity = 0.5 * (1 - (k % 0.5) * 2);
    });
  }

  // ---- explosion: a big fiery detonation — bloom dome, double shockwave, embers, smoke
  function explosion(pos, color, opts = {}) {
    const s = opts.scale ?? 1;
    const grp = new THREE.Group(); grp.position.copy(pos);

    const flashMat = glow(0xffe2a0, 1);
    const flash = new THREE.Mesh(G.sph, flashMat); flash.position.y = 0.5; grp.add(flash);
    const domeMat = glow(color, 0.9);
    const dome = new THREE.Mesh(G.sph, domeMat); dome.position.y = 0.45; grp.add(dome);
    const r1Mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
    const r1 = new THREE.Mesh(G.ring, r1Mat); r1.position.y = 0.08; grp.add(r1);
    const r2Mat = new THREE.MeshBasicMaterial({ color: 0xffb04a, transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide });
    const r2 = new THREE.Mesh(G.ring, r2Mat); r2.position.y = 0.06; grp.add(r2);
    const light = new THREE.PointLight(0xffa848, 14, 8); light.position.y = 0.6; grp.add(light);

    const embers = [], emat = glow(0xffb04a, 1);
    for (let i = 0; i < 18; i++) {
      const m = new THREE.Mesh(G.sph, emat);
      const a = Math.random() * Math.PI * 2, sp = (3.2 + Math.random() * 2.4) * s;
      m.userData.v = new THREE.Vector3(Math.cos(a) * sp, (2.5 + Math.random() * 2.5) * s, Math.sin(a) * sp);
      m.position.y = 0.5; m.scale.setScalar((0.07 + Math.random() * 0.08) * s);
      grp.add(m); embers.push(m);
    }
    const smoke = [], smat = new THREE.MeshBasicMaterial({ color: 0x2a2622, transparent: true, opacity: 0.5, depthWrite: false });
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(G.sph, smat);
      const a = Math.random() * Math.PI * 2, rr = Math.random() * 0.5 * s;
      m.userData = { x: Math.cos(a) * rr, z: Math.sin(a) * rr, ry: 0.6 + Math.random() * 0.8, sz: (0.3 + Math.random() * 0.25) * s };
      grp.add(m); smoke.push(m);
    }

    run(grp, 0.62, (k, dt) => {
      flash.scale.setScalar((0.4 + k * 1.8) * s); flashMat.opacity = (1 - k * 3) > 0 ? 1 - k * 3 : 0;
      dome.scale.setScalar((0.3 + k * 2.7) * s); domeMat.opacity = 0.9 * (1 - k);
      r1.scale.setScalar((0.4 + k * 6) * s); r1Mat.opacity = 0.9 * (1 - k);
      const k2 = Math.max(0, (k - 0.15) / 0.85);
      r2.scale.setScalar((0.4 + k2 * 5) * s); r2Mat.opacity = 0.7 * (1 - k2) * (k > 0.15 ? 1 : 0);
      light.intensity = 14 * (1 - k * 1.4 > 0 ? 1 - k * 1.4 : 0);
      emat.opacity = 1 - k * k;
      for (const m of embers) {
        m.userData.v.y -= 8 * dt; m.position.addScaledVector(m.userData.v, dt);
        if (m.position.y < 0.05) { m.position.y = 0.05; m.userData.v.set(m.userData.v.x * 0.5, -m.userData.v.y * 0.3, m.userData.v.z * 0.5); }
      }
      for (const m of smoke) {
        const u = m.userData; m.position.set(u.x, 0.5 + k * u.ry, u.z);
        m.scale.setScalar(u.sz * (0.4 + k * 1.4)); smat.opacity = 0.5 * (1 - k);
      }
    });
  }

  // ---- firePatch: lingering flames + scorch on the ground (immolate) ----------
  function firePatch(pos, color, opts = {}) {
    const radius = opts.radius ?? 0.6, dur = opts.dur ?? 1.5;
    const grp = new THREE.Group(); grp.position.copy(pos); grp.position.y = 0.02;
    const scorchMat = new THREE.MeshBasicMaterial({ color: 0x140a06, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
    const scorch = new THREE.Mesh(new THREE.CircleGeometry(radius + 0.2, 28).rotateX(-Math.PI / 2), scorchMat); grp.add(scorch);
    const tongues = [];
    for (let i = 0; i < 7; i++) {
      const mat = glow(i % 2 ? 0xffc23a : color, 1);
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.42, 5), mat);
      const a = Math.random() * Math.PI * 2, rr = Math.random() * radius;
      m.userData = { x: Math.cos(a) * rr, z: Math.sin(a) * rr, ph: Math.random() * 6.28, sp: 7 + Math.random() * 5, h: 0.7 + Math.random() * 0.6 };
      m.position.set(m.userData.x, 0.2, m.userData.z); grp.add(m); tongues.push(m);
    }
    const light = new THREE.PointLight(0xff7a2a, 3, 3); light.position.y = 0.4; grp.add(light);
    run(grp, dur, (k, dt, t) => {
      const fade = k < 0.8 ? 1 : (1 - k) / 0.2;            // hold, then fade in the last 20%
      for (const m of tongues) {
        const u = m.userData, fl = 0.6 + 0.4 * Math.sin(t * u.sp + u.ph);
        m.scale.set(1, u.h * fl, 1); m.position.y = 0.2 * u.h * fl;
        m.material.opacity = fade * (0.7 + 0.3 * fl);
      }
      scorchMat.opacity = 0.5 * fade;
      light.intensity = (2.5 + Math.sin(t * 18) * 0.8) * fade;
    });
  }

  return {
    update, impact, projectile, arrow, arrowVolley, lightning, chain, blades, slash, holyHammer, heal,
    telegraph, explosion, firePatch,
    bolt: (from, to, color, onHit) => projectile(from, to, { color, onHit }), // legacy alias
    pillar: (pos, color) => heal(pos, color, 'holy'),                          // legacy alias
  };
}
