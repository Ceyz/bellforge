import * as THREE from 'three';

// --- Cel-shading gradient (shared by every toon material) ---------------------
// Punchy 4-band ramp: deep shadow -> shadow -> mid -> lit. More contrast than a
// linear ramp = a cleaner, more "cartoon" read.
let GRAD;
function toonGradient() {
  const data = new Uint8Array([66, 122, 198, 252]);
  const tex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

// Cel-shaded material — the banded, "clean cartoon" look, with a subtle Fresnel
// RIM injected into the toon shader: bright cool light wraps the silhouette edges,
// so characters pop off the background (a hallmark of polished stylized rendering).
export function toonMat(color, { emissive = 0x000000 } = {}) {
  if (!GRAD) GRAD = toonGradient();
  const m = new THREE.MeshToonMaterial({
    color: new THREE.Color(color),
    emissive: new THREE.Color(emissive),
    gradientMap: GRAD,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: new THREE.Color(0x9fc4ff) };
    shader.uniforms.uRimPower = { value: 3.4 };   // tighter edge
    shader.uniforms.uRimStrength = { value: 0.3 }; // calmer glow
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        '#include <common>\nuniform vec3 uRimColor; uniform float uRimPower; uniform float uRimStrength;')
      .replace('#include <opaque_fragment>',
        'float rim = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);\n' +
        'rim = pow(rim, uRimPower);\n' +
        'outgoingLight += uRimColor * rim * uRimStrength;\n' +
        '#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 'toonRim';
  return m;
}

// Plain PBR material (used by the ground tiles).
export function mat(color, { rough = 0.9, metal = 0.0 } = {}) {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: rough, metalness: metal });
}

// Equipment tier palette — same mesh, swap the colour (bronze -> legendary).
export const TIERS = {
  bronze:    0x9c6b3f,
  iron:      0xb9c0c8,
  steel:     0x8f9aa6,
  gold:      0xe2b53c,
  legendary: 0x9b6cff,
};

// Class colours (cloth accent / tabard).
export const CLASS_COLORS = {
  warrior: 0xb23b2e,
  mage:    0x3f63c9,
  rogue:   0x3b6b4a,
  priest:  0xe8e2d0,
};
