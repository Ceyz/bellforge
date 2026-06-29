import * as THREE from 'three';

// Inverted-hull toon outline, done RIGHT: a back-face shell whose vertices are
// pushed along their NORMALS (in the vertex shader) by a constant thickness.
// This gives an EVEN ink line (the old radial-from-centre push was uneven), and
// it shares the original geometry (no per-part clone → cheaper).
const OUTLINE_COLOR = new THREE.Color(0x241a2a);

function outlineMaterial(thickness) {
  return new THREE.ShaderMaterial({
    uniforms: { uThickness: { value: thickness }, uColor: { value: OUTLINE_COLOR } },
    vertexShader: /* glsl */`
      uniform float uThickness;
      void main() {
        // Expand each vertex along its object-space normal -> even-thickness shell.
        vec3 p = position + normalize(normal) * uThickness;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      void main() { gl_FragColor = vec4(uColor, 1.0); }`,
    side: THREE.BackSide,
  });
}

export function addOutline(mesh, thickness = 0.014) {
  const outline = new THREE.Mesh(mesh.geometry, outlineMaterial(thickness));
  outline.position.copy(mesh.position);
  outline.quaternion.copy(mesh.quaternion);
  outline.scale.copy(mesh.scale);
  outline.castShadow = false;
  outline.receiveShadow = false;
  outline.renderOrder = (mesh.renderOrder || 0) - 1;
  if (mesh.parent) mesh.parent.add(outline);
  return outline;
}
