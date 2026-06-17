import * as THREE from "three";

// Бинарный STL-экспорт всех мешей внутри объекта (в мировых координатах).
export function exportSTL(object: THREE.Object3D): Blob {
  const triangles: number[] = []; // n0,n1,n2, v..  собираем как Float
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const cb = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const normal = new THREE.Vector3();

  const meshes: THREE.Mesh[] = [];
  object.updateMatrixWorld(true);
  object.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });

  const facets: { n: THREE.Vector3; a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3 }[] = [];

  for (const mesh of meshes) {
    const geom = mesh.geometry;
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const index = geom.index;
    const m = mesh.matrixWorld;
    const count = index ? index.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      const ia = index ? index.getX(i) : i;
      const ib = index ? index.getX(i + 1) : i + 1;
      const ic = index ? index.getX(i + 2) : i + 2;
      vA.fromBufferAttribute(pos, ia).applyMatrix4(m);
      vB.fromBufferAttribute(pos, ib).applyMatrix4(m);
      vC.fromBufferAttribute(pos, ic).applyMatrix4(m);
      cb.subVectors(vC, vB);
      ab.subVectors(vA, vB);
      normal.crossVectors(cb, ab).normalize();
      facets.push({ n: normal.clone(), a: vA.clone(), b: vB.clone(), c: vC.clone() });
    }
  }
  void triangles;

  const buffer = new ArrayBuffer(84 + facets.length * 50);
  const view = new DataView(buffer);
  let offset = 80;
  view.setUint32(offset, facets.length, true);
  offset += 4;
  for (const f of facets) {
    view.setFloat32(offset, f.n.x, true);
    view.setFloat32(offset + 4, f.n.y, true);
    view.setFloat32(offset + 8, f.n.z, true);
    offset += 12;
    for (const v of [f.a, f.b, f.c]) {
      view.setFloat32(offset, v.x, true);
      view.setFloat32(offset + 4, v.y, true);
      view.setFloat32(offset + 8, v.z, true);
      offset += 12;
    }
    view.setUint16(offset, 0, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "application/octet-stream" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
