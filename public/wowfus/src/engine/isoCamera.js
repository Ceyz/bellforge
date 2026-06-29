import * as THREE from 'three';

// Orthographic, isometric-angled camera (reads like Dofus "cases" on a tile grid).
export function makeIsoCamera(aspect, viewSize = 3.4) {
  const cam = new THREE.OrthographicCamera(
    -viewSize * aspect, viewSize * aspect, viewSize, -viewSize, 0.1, 100,
  );
  cam.position.set(8, 8, 8);
  cam.lookAt(0, 0.8, 0);
  cam.userData.viewSize = viewSize;
  return cam;
}

export function resizeIsoCamera(cam, aspect) {
  const v = cam.userData.viewSize;
  cam.left = -v * aspect; cam.right = v * aspect;
  cam.top = v; cam.bottom = -v;
  cam.updateProjectionMatrix();
}
