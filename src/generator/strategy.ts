import * as THREE from "three";
import { sectionMesh, lowerEnvelope, type MeshSamples, type RibAxis, type Profile } from "./section";

/**
 * Угол главной оси проекции детали на плоскость XY (градусы).
 * Используется, чтобы ориентировать сетку рёбер по детали, а не по миру.
 */
export function principalAngleDeg(mesh: THREE.Mesh): number {
  const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
  mesh.updateMatrixWorld(true);
  const m = mesh.matrixWorld;
  const v = new THREE.Vector3();

  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m);
    sx += v.x;
    sy += v.y;
    n++;
  }
  if (n === 0) return 0;
  const mx = sx / n;
  const my = sy / n;

  let cxx = 0;
  let cxy = 0;
  let cyy = 0;
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m);
    const dx = v.x - mx;
    const dy = v.y - my;
    cxx += dx * dx;
    cxy += dx * dy;
    cyy += dy * dy;
  }
  const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  return (theta * 180) / Math.PI;
}

export type Curvature = "single" | "double";

function sampleProfile(p: Profile, k: number, total: number): number {
  const u = p.uMin + ((p.uMax - p.uMin) * k) / (total - 1);
  const t = (u - p.uMin) / p.step;
  let i = Math.floor(t);
  if (i < 0) i = 0;
  if (i >= p.samples.length - 1) i = p.samples.length - 2;
  const f = t - i;
  return p.samples[i] * (1 - f) + p.samples[i + 1] * f;
}

/**
 * Определяет кривизну детали по тому, насколько меняются поперечные сечения
 * вдоль главной оси. Постоянные сечения → одинарная кривизна (цилиндр/призма).
 */
export function detectCurvature(samples: MeshSamples, alongAxis: RibAxis): Curvature {
  const b = samples.bounds;
  const alongMin = alongAxis === "X" ? b.minXp : b.minYp;
  const alongMax = alongAxis === "X" ? b.maxXp : b.maxYp;
  const acrossSpan = alongAxis === "X" ? b.maxYp - b.minYp : b.maxXp - b.minXp;
  const res = Math.max(1, acrossSpan / 200);

  const K = 7;
  const N = 24;
  const profiles: number[][] = [];
  const widths: number[] = [];
  for (let i = 1; i <= K; i++) {
    const t = 0.15 + (0.7 * (i - 1)) / (K - 1); // средние 70% длины
    const off = alongMin + (alongMax - alongMin) * t;
    const prof = lowerEnvelope(sectionMesh(samples, alongAxis, off), res);
    if (!prof) continue;
    const row: number[] = [];
    for (let k = 0; k < N; k++) row.push(sampleProfile(prof, k, N));
    profiles.push(row);
    widths.push(prof.uMax - prof.uMin);
  }
  if (profiles.length < 3) return "double";

  // Амплитуда профиля (для нормировки разброса).
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const row of profiles) for (const z of row) {
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
  }
  const amp = Math.max(1e-3, zMax - zMin);

  // Средний по сечениям разброс высоты на каждой нормированной позиции.
  let stdSum = 0;
  for (let k = 0; k < N; k++) {
    let mean = 0;
    for (const row of profiles) mean += row[k];
    mean /= profiles.length;
    let varr = 0;
    for (const row of profiles) varr += (row[k] - mean) ** 2;
    stdSum += Math.sqrt(varr / profiles.length);
  }
  const relStd = stdSum / N / amp;

  // Разброс ширины сечений.
  const wMean = widths.reduce((a, c) => a + c, 0) / widths.length;
  let wVar = 0;
  for (const w of widths) wVar += (w - wMean) ** 2;
  const widthVar = Math.sqrt(wVar / widths.length) / Math.max(1e-3, wMean);

  return relStd < 0.12 && widthVar < 0.12 ? "single" : "double";
}
