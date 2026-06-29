// Idle pose — ROTATIONS ONLY, so it is proportion-independent: the same function
// animates every race correctly regardless of size. Arms are single meshes parented
// to the shoulder, so we swing the whole arm from the shoulder (no forearm rotation).
export function idle(bones, t, phase = 0) {
  const s = (freq, amp, off = 0) => Math.sin(t * freq + off + phase) * amp;

  bones.spine.rotation.x = s(1.3, 0.03);
  bones.chest.rotation.x = s(1.3, 0.02, 0.4);
  bones.head.rotation.y = s(0.5, 0.16);
  bones.head.rotation.x = s(1.3, 0.02, 0.8);

  bones.shoulderL.rotation.x = s(1.1, 0.06);
  bones.shoulderR.rotation.x = s(1.1, 0.06, Math.PI);
}

// Walk cycle — swing the whole legs from the hips, arms counter-swing, a slight
// body bob. Used while a character is moving between tiles.
export function walk(bones, t) {
  const sw = Math.sin(t * 9) * 0.55;          // leg swing
  bones.hipL.rotation.x = sw;
  bones.hipR.rotation.x = -sw;
  bones.shoulderL.rotation.x = -sw * 0.55;
  bones.shoulderR.rotation.x = sw * 0.55;
  bones.shoulderL.rotation.z = 0.12;          // keep the A-pose splay
  bones.shoulderR.rotation.z = -0.12;
  bones.spine.rotation.x = 0.05 + Math.sin(t * 18) * 0.015;
  bones.head.rotation.set(0, 0, 0);
}

// Reset the limbs to the neutral standing pose (after a walk).
export function rest(bones) {
  bones.hipL.rotation.x = 0;
  bones.hipR.rotation.x = 0;
  bones.shoulderL.rotation.x = 0;
  bones.shoulderR.rotation.x = 0;
}

// Full reset to the rest A-pose — clears every axis a cast pose may have touched
// (shoulder splay/twist, spine yaw, head) so idle() resumes cleanly afterwards.
export function neutral(bones) {
  bones.shoulderL.rotation.set(0, 0, 0.2);   // A-pose splay restored
  bones.shoulderR.rotation.set(0, 0, -0.2);
  bones.spine.rotation.set(0, 0, 0);
  bones.chest.rotation.set(0, 0, 0);
  bones.head.rotation.set(0, 0, 0);
  bones.hipL.rotation.set(0, 0, 0);
  bones.hipR.rotation.set(0, 0, 0);
}

// Spell-cast poses — `k` is progress 0→1. Rotations only, so proportion-independent.
// The arm is one mesh on the shoulder, so we pose from the shoulder; a NEGATIVE
// shoulder.rotation.x swings the arm FORWARD (toward +Z local = the facing/target).
// 'spin' only sets the arms — the body rotation is driven by the game loop (root.y).
export function castPose(bones, kind, k) {
  const ease = (x) => x * x * (3 - 2 * x);
  const wind = ease(Math.min(1, k / 0.4));        // 0 → 1 windup  (first 40%)
  const rel = ease(Math.max(0, (k - 0.4) / 0.6)); // 0 → 1 release (last 60%)

  bones.shoulderL.rotation.set(0, 0, 0.2);        // sensible defaults, overridden below
  bones.shoulderR.rotation.set(0, 0, -0.2);
  bones.spine.rotation.set(0, 0, 0);
  bones.head.rotation.set(0, 0, 0);

  if (kind === 'cast') {                          // wind the casting arm back, then thrust forward
    bones.shoulderR.rotation.x = wind * 0.7 - rel * 2.0;
    bones.shoulderR.rotation.z = -0.2 + rel * 0.3;
    bones.shoulderL.rotation.x = wind * 0.25;
    bones.spine.rotation.y = rel * 0.25;
    bones.spine.rotation.x = rel * 0.1;
    bones.head.rotation.x = rel * 0.12;
  } else if (kind === 'shoot') {                  // left arm holds the bow, right draws then looses
    bones.shoulderL.rotation.x = -1.1; bones.shoulderL.rotation.z = 0.18;
    bones.shoulderR.rotation.x = -0.45 - wind * 0.5 + rel * 0.6;
    bones.shoulderR.rotation.z = -0.5;
    bones.spine.rotation.y = -0.15;
  } else if (kind === 'raise') {                  // both arms lifted to the heavens (invoke)
    const up = ease(k);
    bones.shoulderL.rotation.x = -up * 2.4; bones.shoulderL.rotation.z = 0.55;
    bones.shoulderR.rotation.x = -up * 2.4; bones.shoulderR.rotation.z = -0.55;
    bones.spine.rotation.x = -up * 0.15; bones.head.rotation.x = -up * 0.3;
  } else if (kind === 'melee') {                  // overhead chop sweeping down in front
    bones.shoulderR.rotation.x = -2.0 + wind * -0.2 + rel * 1.7;
    bones.spine.rotation.y = -wind * 0.2 + rel * 0.35;
    bones.spine.rotation.x = rel * 0.12;
  } else if (kind === 'spin') {                   // arms flung outward, holding the blades
    bones.shoulderL.rotation.set(0.1, 0, 1.25);
    bones.shoulderR.rotation.set(0.1, 0, -1.25);
    bones.spine.rotation.x = 0.08;
  }
}

// Eye blink — quick squash of the eye groups every few seconds, desynced per actor.
// Drives scale.y on the eye groups returned by buildCharacter().
export function blink(eyes, t, phase = 0) {
  const cycle = 3.4;
  const local = (t + phase * 0.7) % cycle;
  const closed = local > cycle - 0.13; // ~130 ms blink
  const sy = closed ? 0.12 : 1;
  for (const e of eyes) e.scale.y = sy;
}
