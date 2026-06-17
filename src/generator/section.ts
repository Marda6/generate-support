import * as THREE from "three";

export type RibAxis = "X" | "Y";

export interface Segment {
  u0: number;
  z0: number;
  u1: number;
  z1: number;
}

/** Повёрнутая система координат сетки рёбер. */
export function rotatedCoords(x: number, y: number, angleDeg: number): { xp: number; yp: number } {
  const t = (angleDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return { xp: x * c + y * s, yp: -x * s + y * c };
}

export interface MeshSamples {
  /** Триплеты вершин треугольников в координатах (xp, yp, z). */
  tris: Float32Array;
  triCount: number;
  bounds: {
    minXp: number;
    maxXp: number;
    minYp: number;
    maxYp: number;
    minZ: number;
    maxZ: number;
  };
}

/** Переводит геометрию меша в повёрнутые координаты и кэширует треугольники. */
export function prepareMesh(mesh: THREE.Mesh, angleDeg: number): MeshSamples {
  const geom = mesh.geometry;
  const pos = geom.attributes.position as THREE.BufferAttribute;
  const index = geom.index;
  mesh.updateMatrixWorld(true);
  const m = mesh.matrixWorld;

  const count = index ? index.count : pos.count;
  const triCount = Math.floor(count / 3);
  const tris = new Float32Array(triCount * 9);

  let minXp = Infinity, maxXp = -Infinity;
  let minYp = Infinity, maxYp = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  const v = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const vi = index ? index.getX(t * 3 + k) : t * 3 + k;
      v.set(pos.getX(vi), pos.getY(vi), pos.getZ(vi)).applyMatrix4(m);
      const r = rotatedCoords(v.x, v.y, angleDeg);
      const o = t * 9 + k * 3;
      tris[o] = r.xp;
      tris[o + 1] = r.yp;
      tris[o + 2] = v.z;
      if (r.xp < minXp) minXp = r.xp;
      if (r.xp > maxXp) maxXp = r.xp;
      if (r.yp < minYp) minYp = r.yp;
      if (r.yp > maxYp) maxYp = r.yp;
      if (v.z < minZ) minZ = v.z;
      if (v.z > maxZ) maxZ = v.z;
    }
  }

  return {
    tris,
    triCount,
    bounds: { minXp, maxXp, minYp, maxYp, minZ, maxZ },
  };
}

/**
 * Сечёт подготовленный меш вертикальной плоскостью.
 * axis="X": плоскость xp = offset, координата u вдоль yp.
 * axis="Y": плоскость yp = offset, координата u вдоль xp.
 */
export function sectionMesh(samples: MeshSamples, axis: RibAxis, offset: number): Segment[] {
  const segs: Segment[] = [];
  const { tris, triCount } = samples;
  // индексы: для axis X — режущая координата = компонента 0 (xp), u = компонента 1 (yp).
  const cutComp = axis === "X" ? 0 : 1;
  const uComp = axis === "X" ? 1 : 0;

  const px = [0, 0, 0];
  const pu = [0, 0, 0];
  const pz = [0, 0, 0];

  for (let t = 0; t < triCount; t++) {
    const base = t * 9;
    for (let k = 0; k < 3; k++) {
      const o = base + k * 3;
      px[k] = tris[o + cutComp];
      pu[k] = tris[o + uComp];
      pz[k] = tris[o + 2];
    }
    // Точки пересечения рёбер треугольника с плоскостью cut = offset.
    const hitsU: number[] = [];
    const hitsZ: number[] = [];
    for (let e = 0; e < 3; e++) {
      const a = e;
      const b = (e + 1) % 3;
      const da = px[a] - offset;
      const db = px[b] - offset;
      if ((da < 0 && db < 0) || (da > 0 && db > 0)) continue; // не пересекает
      if (da === db) continue; // ребро в плоскости — пропускаем
      const tt = da / (da - db);
      if (tt < 0 || tt > 1) continue;
      hitsU.push(pu[a] + (pu[b] - pu[a]) * tt);
      hitsZ.push(pz[a] + (pz[b] - pz[a]) * tt);
    }
    if (hitsU.length >= 2) {
      segs.push({ u0: hitsU[0], z0: hitsZ[0], u1: hitsU[1], z1: hitsZ[1] });
    }
  }
  return segs;
}

export interface Profile {
  /** Левая граница профиля (u). */
  uMin: number;
  /** Правая граница профиля (u). */
  uMax: number;
  /** Высота нижней огибающей по равномерным выборкам. */
  samples: number[];
  step: number;
}

/**
 * Нижняя огибающая сечения: для каждой позиции u — минимальная z детали.
 * Это профиль, по которому верхняя кромка ребра поддерживает деталь.
 */
export function lowerEnvelope(segs: Segment[], resolution = 1.0): Profile | null {
  if (segs.length === 0) return null;
  let uMin = Infinity;
  let uMax = -Infinity;
  for (const s of segs) {
    uMin = Math.min(uMin, s.u0, s.u1);
    uMax = Math.max(uMax, s.u0, s.u1);
  }
  if (!isFinite(uMin) || uMax - uMin < 1e-6) return null;

  const n = Math.max(2, Math.ceil((uMax - uMin) / resolution));
  const step = (uMax - uMin) / n;
  const samples = new Array(n + 1).fill(Infinity);

  for (const s of segs) {
    const a = s.u0 < s.u1 ? s : { u0: s.u1, z0: s.z1, u1: s.u0, z1: s.z0 };
    const i0 = Math.max(0, Math.floor((a.u0 - uMin) / step));
    const i1 = Math.min(n, Math.ceil((a.u1 - uMin) / step));
    for (let i = i0; i <= i1; i++) {
      const u = uMin + i * step;
      if (u < a.u0 - 1e-9 || u > a.u1 + 1e-9) continue;
      const tt = (u - a.u0) / Math.max(1e-9, a.u1 - a.u0);
      const z = a.z0 + (a.z1 - a.z0) * tt;
      if (z < samples[i]) samples[i] = z;
    }
  }

  // Заполняем пропуски (Infinity) интерполяцией соседей.
  for (let i = 0; i <= n; i++) {
    if (samples[i] === Infinity) {
      let l = i - 1;
      while (l >= 0 && samples[l] === Infinity) l--;
      let r = i + 1;
      while (r <= n && samples[r] === Infinity) r++;
      if (l < 0 && r > n) samples[i] = 0;
      else if (l < 0) samples[i] = samples[r];
      else if (r > n) samples[i] = samples[l];
      else samples[i] = samples[l] + ((samples[r] - samples[l]) * (i - l)) / (r - l);
    }
  }

  return { uMin, uMax, samples, step };
}
