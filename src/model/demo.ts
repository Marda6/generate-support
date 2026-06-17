import * as THREE from "three";

// Демо-модель: цилиндр, лежащий на боку над базовой плоскостью Z=0.
// Ось цилиндра горизонтальна (вдоль Y). Размеры в мм.
export function createDemoModel(): THREE.Mesh {
  const radius = 90;
  const length = 340; // вдоль оси (Y)
  const gap = 8; // зазор от базовой плоскости

  // CylinderGeometry: ось вдоль локального Y → в мире (Z вверх) лежит горизонтально.
  const geom = new THREE.CylinderGeometry(radius, radius, length, 64, 1, false);

  const mat = new THREE.MeshStandardMaterial({
    color: 0x9a9ea4,
    metalness: 0.1,
    roughness: 0.7,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.8,
  });

  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.z = radius + gap; // кладём цилиндр над плоскостью
  mesh.name = "model";
  return mesh;
}
