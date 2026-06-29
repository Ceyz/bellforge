import * as THREE from 'three';
import { mat } from '../core/palette.js';

// Flat tile grid in the XZ plane. Under the iso camera it reads as Dofus "cases".
export function makeGrid(n = 12, tile = 1) {
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(tile * 0.98, 0.12, tile * 0.98);
  const base = mat(0xffffff, { rough: 0.95 }); // white base so instance colours show true
  const mesh = new THREE.InstancedMesh(geo, base, n * n);
  mesh.receiveShadow = true;

  const a = new THREE.Color(0x6f9a52); // grass A
  const b = new THREE.Color(0x7faa5d); // grass B
  const dummy = new THREE.Object3D();
  const off = (n - 1) / 2;
  let i = 0;
  for (let x = 0; x < n; x++) {
    for (let z = 0; z < n; z++) {
      dummy.position.set((x - off) * tile, -0.06, (z - off) * tile);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, (x + z) % 2 ? a : b);
      i++;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  group.add(mesh);
  return group;
}
