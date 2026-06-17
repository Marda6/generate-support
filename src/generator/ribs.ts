import * as THREE from "three";
import type { SupportParams } from "../params";
import {
  prepareMesh,
  sectionMesh,
  lowerEnvelope,
  type MeshSamples,
  type Profile,
  type RibAxis,
} from "./section";
import { principalAngleDeg, detectCurvature } from "./strategy";

const MIN_HEIGHT = 0.5; // минимальная высота ребра, чтобы полигон оставался корректным

interface Cut {
  uc: number; // центр по u
  halfW: number; // полуширина
  targetZ: number; // куда уходят вертикальные стенки
}

// Точка контура в координатах (u, z).
type Pt = [number, number];

function profileZ(p: Profile, u: number): number {
  const t = (u - p.uMin) / p.step;
  let i = Math.floor(t);
  if (i < 0) i = 0;
  if (i >= p.samples.length - 1) i = p.samples.length - 2;
  const f = t - i;
  return p.samples[i] * (1 - f) + p.samples[i + 1] * f;
}

/**
 * Строит кромку как ломаную слева-направо вдоль baseline(u),
 * врезая прямоугольные вырезы/выступы (cuts) с вертикальными стенками.
 */
function buildEdge(
  uMin: number,
  uMax: number,
  baseline: (u: number) => number,
  cuts: Cut[],
  res: number
): Pt[] {
  const sorted = [...cuts].filter((c) => c.uc - c.halfW > uMin && c.uc + c.halfW < uMax).sort((a, b) => a.uc - b.uc);
  const pts: Pt[] = [];
  let u = uMin;
  pts.push([u, baseline(u)]);

  const sampleTo = (uEnd: number) => {
    while (u < uEnd - 1e-6) {
      u = Math.min(u + res, uEnd);
      pts.push([u, baseline(u)]);
    }
  };

  for (const c of sorted) {
    const cl = c.uc - c.halfW;
    const cr = c.uc + c.halfW;
    if (cl <= u) continue; // перекрытие — пропускаем
    sampleTo(cl);
    pts.push([cl, baseline(cl)]);
    pts.push([cl, c.targetZ]);
    pts.push([cr, c.targetZ]);
    pts.push([cr, baseline(cr)]);
    u = cr;
  }
  sampleTo(uMax);
  return pts;
}

function buildRibShape(
  profile: Profile,
  params: SupportParams,
  crossings: number[],
  topSlotted: boolean
): THREE.Shape {
  const { uMin, uMax } = profile;
  const span = uMax - uMin;
  const res = Math.max(2, span / 60);

  // --- Верхняя кромка (контакт с деталью) ---
  const headH = params.notchHeadHeight;
  const topBaseline = (u: number) => {
    const z = profileZ(profile, u);
    return headH > 0 ? z - headH : z; // зазор-релиф; «головки» добавляются как вырезы вверх
  };

  const topCuts: Cut[] = [];
  // Врезные пазы сверху (для рёбер, режущихся сверху)
  if (topSlotted) {
    for (const c of crossings) {
      const top = profileZ(profile, c);
      const targetZ = Math.max(MIN_HEIGHT, top - params.slotHeight);
      topCuts.push({ uc: c, halfW: params.slotWidth / 2, targetZ });
    }
  }
  // Опорные «головки» насечки вдоль верхней кромки
  if (headH > 0 && params.notchHeadWidth > 0) {
    const period = Math.max(params.notchHeadWidth * 3, span / 8);
    for (let u = uMin + period * 0.5; u < uMax; u += period) {
      // не ставим головку поверх паза
      if (topSlotted && crossings.some((c) => Math.abs(c - u) < params.slotWidth / 2 + params.notchHeadWidth)) continue;
      topCuts.push({ uc: u, halfW: params.notchHeadWidth / 2, targetZ: profileZ(profile, u) });
    }
  }

  // --- Нижняя кромка (база Z=0) ---
  const bottomBaseline = () => 0;
  const bottomCuts: Cut[] = [];
  // Врезные пазы снизу (для рёбер, режущихся снизу)
  if (!topSlotted) {
    for (const c of crossings) {
      bottomCuts.push({ uc: c, halfW: params.slotWidth / 2, targetZ: params.slotHeight });
    }
  }
  // Базовые язычки (выступы вниз) — несколько штук между пересечениями
  if (params.tabsWidth > 0 && params.tabsDepth > 0) {
    const nTabs = 3;
    for (let i = 1; i <= nTabs; i++) {
      const u = uMin + (span * i) / (nTabs + 1);
      if (!topSlotted && crossings.some((c) => Math.abs(c - u) < params.slotWidth / 2 + params.tabsWidth)) continue;
      bottomCuts.push({ uc: u, halfW: params.tabsWidth / 2, targetZ: -params.tabsDepth });
    }
  }

  const top = buildEdge(uMin, uMax, topBaseline, topCuts, res);
  const bottom = buildEdge(uMin, uMax, bottomBaseline, bottomCuts, res);

  // Контур: низ слева→направо, затем верх справа→налево.
  const shape = new THREE.Shape();
  shape.moveTo(bottom[0][0], bottom[0][1]);
  for (let i = 1; i < bottom.length; i++) shape.lineTo(bottom[i][0], bottom[i][1]);
  for (let i = top.length - 1; i >= 0; i--) shape.lineTo(top[i][0], top[i][1]);
  shape.closePath();

  // --- Облегчающие окна ---
  if (params.generateWindows) {
    const off = params.windowsOffset;
    const bounds = [uMin, ...crossings.filter((c) => c > uMin && c < uMax).sort((a, b) => a - b), uMax];
    for (let i = 0; i < bounds.length - 1; i++) {
      const l = bounds[i] + off + params.slotWidth / 2;
      const r = bounds[i + 1] - off - params.slotWidth / 2;
      if (r - l < off * 2) continue;
      const midTop = Math.min(profileZ(profile, (l + r) / 2), profileZ(profile, l), profileZ(profile, r));
      const z0 = off + params.tabsDepth;
      const z1 = midTop - off - params.notchHeadHeight - params.slotHeight;
      if (z1 - z0 < off * 2) continue;
      const hole = new THREE.Path();
      hole.moveTo(l, z0);
      hole.lineTo(r, z0);
      hole.lineTo(r, z1);
      hole.lineTo(l, z1);
      hole.closePath();
      shape.holes.push(hole);
    }
  }

  return shape;
}

function placeRib(
  shape: THREE.Shape,
  axis: RibAxis,
  offset: number,
  thickness: number,
  angleDeg: number,
  material: THREE.Material,
  edgeColor: number
): THREE.Mesh {
  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
  });

  // Светящийся контур граней поверх объёма (ловится bloom-ом).
  const edges = new THREE.EdgesGeometry(geom, 25);
  const edgeMat = new THREE.LineBasicMaterial({
    color: edgeColor,
    transparent: true,
    opacity: 0.55,
  });
  const edgeLines = new THREE.LineSegments(edges, edgeMat);

  const t = (angleDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const ex = new THREE.Vector3(c, s, 0); // направление xp в мире
  const ey = new THREE.Vector3(-s, c, 0); // направление yp в мире
  const up = new THREE.Vector3(0, 0, 1);

  // localX = u, localY = z, localZ = толщина
  let localX: THREE.Vector3, localZ: THREE.Vector3, origin: THREE.Vector3;
  if (axis === "X") {
    localX = ey; // u вдоль yp
    localZ = ex; // толщина вдоль xp
    origin = ex.clone().multiplyScalar(offset - thickness / 2);
  } else {
    localX = ex; // u вдоль xp
    localZ = ey; // толщина вдоль yp
    origin = ey.clone().multiplyScalar(offset - thickness / 2);
  }

  const m = new THREE.Matrix4().makeBasis(localX, up, localZ);
  m.setPosition(origin);

  const mesh = new THREE.Mesh(geom, material);
  mesh.add(edgeLines); // контур наследует трансформацию ребра
  mesh.applyMatrix4(m);
  return mesh;
}

export interface BuildResult {
  group: THREE.Group;
  ribCountX: number;
  ribCountY: number;
  /** Выбранная стратегия для отображения пользователю. */
  strategy: "egg-crate" | "saddle";
}

const COLOR_ORANGE = 0xff8a3c;
const COLOR_BLUE = 0x3b7bff;

function makeMat(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    transparent: true,
    opacity: 0.4,
    roughness: 0.45,
    metalness: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

function gridOffsets(min: number, max: number, spacing: number): number[] {
  const span = max - min;
  if (spacing <= 0 || span <= 0) return [];
  const n = Math.max(1, Math.floor(span / spacing));
  const used = n * spacing;
  const start = min + (span - used) / 2;
  const offsets: number[] = [];
  for (let i = 0; i <= n; i++) offsets.push(start + i * spacing);
  return offsets;
}

/** Сечёт деталь, строит профиль и добавляет одно ребро в группу. */
function addRib(
  group: THREE.Group,
  samples: MeshSamples,
  axis: RibAxis,
  offset: number,
  crossings: number[],
  topSlotted: boolean,
  frameAngle: number,
  color: number,
  params: SupportParams,
  acrossSpan: number,
  name: string
): boolean {
  const profile = lowerEnvelope(sectionMesh(samples, axis, offset), Math.max(1, acrossSpan / 200));
  if (!profile) return false;
  const shape = buildRibShape(profile, params, crossings, topSlotted);
  const mesh = placeRib(shape, axis, offset, params.thickness, frameAngle, makeMat(color), color);
  mesh.name = name;
  group.add(mesh);
  return true;
}

export function buildSupports(model: THREE.Mesh, params: SupportParams): BuildResult {
  const group = new THREE.Group();
  group.name = "supports";

  // Авто-режим: ориентируем сетку строго по главной оси детали (PCA),
  // чтобы рёбра шли вдоль/поперёк оси. Rotate Z в авто-режиме не применяется.
  const frameAngle = principalAngleDeg(model);

  const samples: MeshSamples = prepareMesh(model, frameAngle);
  const b = samples.bounds;
  const xpSpan = b.maxXp - b.minXp;
  const ypSpan = b.maxYp - b.minYp;

  // Главная (длинная) ось — вдоль большего размаха.
  const alongAxis: RibAxis = xpSpan >= ypSpan ? "X" : "Y";
  const curvature = detectCurvature(samples, alongAxis);

  if (curvature === "double") {
    // Двоякоизогнутая деталь → полная решётка egg-crate.
    const xOffsets = gridOffsets(b.minXp, b.maxXp, params.distanceX);
    const yOffsets = gridOffsets(b.minYp, b.maxYp, params.distanceY);
    xOffsets.forEach((off, i) => {
      addRib(group, samples, "X", off, yOffsets, true, frameAngle, COLOR_ORANGE, params, ypSpan, `Rib X${i + 1}`);
    });
    yOffsets.forEach((off, i) => {
      addRib(group, samples, "Y", off, xOffsets, false, frameAngle, COLOR_BLUE, params, xpSpan, `Rib Y${i + 1}`);
    });
    return { group, ribCountX: xOffsets.length, ribCountY: yOffsets.length, strategy: "egg-crate" };
  }

  // Одинарная кривизна (цилиндр/призма) → поперечные сёдла + продольные хребты.
  const acrossAxis: RibAxis = alongAxis === "X" ? "Y" : "X";
  const alongMin = alongAxis === "X" ? b.minXp : b.minYp;
  const alongMax = alongAxis === "X" ? b.maxXp : b.maxYp;
  const acrossMin = acrossAxis === "X" ? b.minXp : b.minYp;
  const acrossMax = acrossAxis === "X" ? b.maxXp : b.maxYp;
  const alongSpan = alongMax - alongMin;
  const acrossSpan = acrossMax - acrossMin;
  const alongDist = alongAxis === "X" ? params.distanceX : params.distanceY;
  const acrossDist = acrossAxis === "X" ? params.distanceX : params.distanceY;

  // Сёдла — поперёк оси (плоскость постоянной along-координаты), режутся сверху.
  const saddleOffsets = gridOffsets(alongMin, alongMax, alongDist);
  // Хребты — вдоль оси: 1–2 штуки для связки сёдел и устойчивости от опрокидывания.
  // (полная решётка вдоль оси для призмы избыточна)
  const spineOffsets =
    acrossSpan < 1
      ? []
      : acrossSpan < 80
        ? [acrossMin + acrossSpan * 0.5]
        : [acrossMin + acrossSpan * 0.28, acrossMin + acrossSpan * 0.72];
  void acrossDist;

  let saddleCount = 0;
  saddleOffsets.forEach((off, i) => {
    if (addRib(group, samples, alongAxis, off, spineOffsets, true, frameAngle, COLOR_ORANGE, params, acrossSpan, `Saddle ${i + 1}`))
      saddleCount++;
  });
  let spineCount = 0;
  spineOffsets.forEach((off, i) => {
    if (addRib(group, samples, acrossAxis, off, saddleOffsets, false, frameAngle, COLOR_BLUE, params, alongSpan, `Spine ${i + 1}`))
      spineCount++;
  });

  return { group, ribCountX: saddleCount, ribCountY: spineCount, strategy: "saddle" };
}
