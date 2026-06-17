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
import type { Part } from "../export/nesting";

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
  topSlotted: boolean,
  bottomZ: number
): { shape: THREE.Shape; tabU: number[] } {
  const { uMin, uMax } = profile;
  const span = uMax - uMin;
  const res = Math.max(2, span / 60);

  // --- Верхняя кромка (контакт с деталью) ---
  const headH = params.notchHeadHeight;
  const topBaseline = (u: number) => {
    const z = profileZ(profile, u);
    const top = headH > 0 ? z - headH : z; // зазор-релиф; «головки» добавляются как вырезы вверх
    return Math.max(bottomZ + MIN_HEIGHT, top); // ребро не уходит ниже базы
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

  // --- Нижняя кромка (база на уровне Z = bottomZ, верх опорной плиты) ---
  const bottomBaseline = () => bottomZ;
  const bottomCuts: Cut[] = [];
  // Врезные пазы снизу (для рёбер, режущихся снизу)
  if (!topSlotted) {
    for (const c of crossings) {
      bottomCuts.push({ uc: c, halfW: params.slotWidth / 2, targetZ: bottomZ + params.slotHeight });
    }
  }
  // Базовые язычки (выступы вниз в опорную плиту) — несколько штук между пересечениями.
  // tabU — позиции язычков по u, чтобы прорезать под них пазы в плите.
  const tabU: number[] = [];
  if (params.tabsWidth > 0 && params.tabsDepth > 0) {
    const nTabs = 3;
    for (let i = 1; i <= nTabs; i++) {
      const u = uMin + (span * i) / (nTabs + 1);
      if (!topSlotted && crossings.some((c) => Math.abs(c - u) < params.slotWidth / 2 + params.tabsWidth)) continue;
      bottomCuts.push({ uc: u, halfW: params.tabsWidth / 2, targetZ: bottomZ - params.tabsDepth });
      tabU.push(u);
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
      const z0 = bottomZ + off + params.tabsDepth;
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

  return { shape, tabU };
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
  /** Высота опорной плиты на полу (0 — деталь слишком близко к полу). */
  baseHeight: number;
  /** Плоские контуры всех деталей для раскроя (nesting / SVG). */
  parts: Part[];
}

const COLOR_ORANGE = 0xff8a3c;
const COLOR_BLUE = 0x3b7bff;
const COLOR_VIOLET = 0x9d6bff; // опорная плита на полу

export type SupportKind = "x" | "y" | "base";

/** Плоский контур фигуры (внешний путь + отверстия) для раскроя. */
function shapeToPart(shape: THREE.Shape, kind: SupportKind, label: string): Part {
  const ep = shape.extractPoints(12);
  const map = (v: THREE.Vector2) => ({ x: v.x, y: v.y });
  return { kind, label, contour: ep.shape.map(map), holes: ep.holes.map((h) => h.map(map)) };
}

/** Типы поддержек для легенды/управления видимостью. */
export const SUPPORT_TYPES: { kind: SupportKind; label: string; color: number }[] = [
  { kind: "x", label: "Ribs X", color: COLOR_ORANGE },
  { kind: "y", label: "Ribs Y", color: COLOR_BLUE },
  { kind: "base", label: "Base plate", color: COLOR_VIOLET },
];

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

/** Прямоугольник в плоскости плиты (xp, yp). */
interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
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
  bottomZ: number,
  tabSink: Rect[],
  parts: Part[],
  name: string
): boolean {
  const profile = lowerEnvelope(sectionMesh(samples, axis, offset), Math.max(1, acrossSpan / 200));
  if (!profile) return false;
  const { shape, tabU } = buildRibShape(profile, params, crossings, topSlotted, bottomZ);
  const kind: SupportKind = color === COLOR_ORANGE ? "x" : "y";
  const mesh = placeRib(shape, axis, offset, params.thickness, frameAngle, makeMat(color), color);
  mesh.name = name;
  mesh.userData.kind = kind;
  group.add(mesh);
  parts.push(shapeToPart(shape, kind, name));

  // Пазы под язычки в плите: ширина паза = ширина язычка по u, глубина = толщина ребра поперёк.
  const half = params.thickness / 2;
  const hw = params.tabsWidth / 2;
  for (const u of tabU) {
    if (axis === "X") {
      tabSink.push({ x0: offset - half, x1: offset + half, y0: u - hw, y1: u + hw });
    } else {
      tabSink.push({ x0: u - hw, x1: u + hw, y0: offset - half, y1: offset + half });
    }
  }
  return true;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return !(a.x1 <= b.x0 || a.x0 >= b.x1 || a.y1 <= b.y0 || a.y0 >= b.y1);
}

/**
 * Раскладка хребтов вдоль across-оси с шагом spacing, центрированная,
 * с отступом от краёв детали. Число хребтов задаётся параметром Distance Y.
 */
function spineLayout(min: number, max: number, spacing: number): number[] {
  const span = max - min;
  if (span < 1 || spacing <= 0) return [];
  const inset = span * 0.12;
  const lo = min + inset;
  const hi = max - inset;
  const usable = hi - lo;
  const center = (min + max) / 2;
  if (usable <= 0) return [center];
  let n = Math.floor(usable / spacing) + 1; // число хребтов
  n = Math.max(1, Math.min(n, 8));
  if (n === 1) return [center];
  const start = center - (spacing * (n - 1)) / 2;
  const offs: number[] = [];
  for (let i = 0; i < n; i++) {
    offs.push(Math.max(lo, Math.min(hi, start + i * spacing)));
  }
  return offs;
}

interface Footprint {
  minXp: number;
  maxXp: number;
  minYp: number;
  maxYp: number;
}

/**
 * Облегчающие окна плиты: прямоугольное окно в каждой ячейке сетки, образованной
 * линиями рёбер (xpLines — линии X-рёбер, ypLines — линии Y-рёбер). Под каждой
 * линией ребра остаётся сплошная полоса (± thickness/2 + зазор), куда врезаются
 * пазы под язычки — поэтому окна и пазы никогда не пересекаются.
 */
function addPlateWindows(
  shape: THREE.Shape,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  xpLines: number[],
  ypLines: number[],
  params: SupportParams
): void {
  const gap = Math.max(params.windowsOffset, 0.5);
  const strip = params.thickness / 2 + gap; // от линии ребра до края окна
  const edge = Math.max(params.windowsOffset, 4); // от внешнего края плиты до окна
  const xs = [x0, ...[...xpLines].sort((a, b) => a - b), x1];
  const ys = [y0, ...[...ypLines].sort((a, b) => a - b), y1];

  for (let i = 0; i < xs.length - 1; i++) {
    const wx0 = xs[i] + (i === 0 ? edge : strip);
    const wx1 = xs[i + 1] - (i === xs.length - 2 ? edge : strip);
    if (wx1 - wx0 < gap * 2) continue;
    for (let j = 0; j < ys.length - 1; j++) {
      const wy0 = ys[j] + (j === 0 ? edge : strip);
      const wy1 = ys[j + 1] - (j === ys.length - 2 ? edge : strip);
      if (wy1 - wy0 < gap * 2) continue;
      const hole = new THREE.Path();
      hole.moveTo(wx0, wy0);
      hole.lineTo(wx1, wy0);
      hole.lineTo(wx1, wy1);
      hole.lineTo(wx0, wy1);
      hole.closePath();
      shape.holes.push(hole);
    }
  }
}

/**
 * Опорная плита — тонкий лист на полу (Z от 0 до thickness, та же толщина, что
 * и у остальных поддержек), на который устанавливаются сёдла/хребты/решётка.
 * Тот же стиль (полупрозрачность + светящийся контур), фиолетовый цвет.
 * Окна-ферма — только при включённом Generate Windows; пазы под язычки рёбер
 * прорезаются всегда.
 */
function buildBasePlate(
  fp: Footprint,
  thickness: number,
  frameAngle: number,
  color: number,
  params: SupportParams,
  tabHoles: Rect[],
  xpLines: number[],
  ypLines: number[],
  parts: Part[]
): THREE.Mesh {
  const margin = Math.max(5, (fp.maxXp - fp.minXp) * 0.03);
  const x0 = fp.minXp - margin;
  const x1 = fp.maxXp + margin;
  const y0 = fp.minYp - margin;
  const y1 = fp.maxYp + margin;

  const shape = new THREE.Shape();
  shape.moveTo(x0, y0);
  shape.lineTo(x1, y0);
  shape.lineTo(x1, y1);
  shape.lineTo(x0, y1);
  shape.closePath();

  // Облегчающие окна по ячейкам сетки — тем же параметром Generate Windows, что и у рёбер.
  if (params.generateWindows) addPlateWindows(shape, x0, x1, y0, y1, xpLines, ypLines, params);

  // Пазы под язычки оранжевых/синих поддержек (всегда). Окна на линии рёбер не заходят,
  // так что пересечься могут только пазы соседних рёбер на крестовинах — их и отсеиваем.
  const placed: Rect[] = [];
  for (const t of tabHoles) {
    if (placed.some((p) => rectsOverlap(p, t))) continue;
    const hole = new THREE.Path();
    hole.moveTo(t.x0, t.y0);
    hole.lineTo(t.x1, t.y0);
    hole.lineTo(t.x1, t.y1);
    hole.lineTo(t.x0, t.y1);
    hole.closePath();
    shape.holes.push(hole);
    placed.push(t);
  }

  const geom = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  const edges = new THREE.EdgesGeometry(geom, 25);
  const edgeLines = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 })
  );

  const t = (frameAngle * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const ex = new THREE.Vector3(c, s, 0);
  const ey = new THREE.Vector3(-s, c, 0);
  const up = new THREE.Vector3(0, 0, 1);
  // shape(xp, yp, depth) → world: xp вдоль ex, yp вдоль ey, depth вверх от пола.
  const m = new THREE.Matrix4().makeBasis(ex, ey, up);

  const mesh = new THREE.Mesh(geom, makeMat(color));
  mesh.add(edgeLines);
  mesh.applyMatrix4(m);
  mesh.name = "Base";
  mesh.userData.kind = "base";
  parts.push(shapeToPart(shape, "base", "Base"));
  return mesh;
}

export function buildSupports(model: THREE.Mesh, params: SupportParams): BuildResult {
  const group = new THREE.Group();
  group.name = "supports";

  // Тип детали определяем на чистой оси PCA (без ручного доворота).
  const pcaAngle = principalAngleDeg(model);
  const detSamples = prepareMesh(model, pcaAngle);
  const detB = detSamples.bounds;
  // В PCA-кадре длинная ось детали всегда вдоль xp → alongAxis = "X".
  const alongAxis: RibAxis = detB.maxXp - detB.minXp >= detB.maxYp - detB.minYp ? "X" : "Y";
  const curvature = detectCurvature(detSamples, alongAxis);

  // Строим в кадре PCA + ручной Rotate Z (поле реально доворачивает сетку).
  const frameAngle = pcaAngle + params.rotateZ;
  const samples: MeshSamples = prepareMesh(model, frameAngle);
  const b = samples.bounds;
  const xpSpan = b.maxXp - b.minXp;
  const ypSpan = b.maxYp - b.minYp;

  // Опорная плита — тонкий лист толщиной Thickness (как у остальных поддержек).
  // Рёбра встают на её верхнюю кромку → их низ поднят на baseHeight.
  // Если деталь слишком близко к полу (нет места под плиту) — плиты нет.
  const clearance = b.minZ;
  const baseHeight = clearance > params.thickness + 1 ? params.thickness : 0;
  const footprint: Footprint = { minXp: b.minXp, maxXp: b.maxXp, minYp: b.minYp, maxYp: b.maxYp };
  const tabHoles: Rect[] = []; // пазы под язычки рёбер, прорезаемые в плите
  const parts: Part[] = []; // плоские контуры деталей для раскроя

  if (curvature === "double") {
    // Двоякоизогнутая деталь → полная решётка egg-crate.
    const xOffsets = gridOffsets(b.minXp, b.maxXp, params.distanceX);
    const yOffsets = gridOffsets(b.minYp, b.maxYp, params.distanceY);
    xOffsets.forEach((off, i) => {
      addRib(group, samples, "X", off, yOffsets, true, frameAngle, COLOR_ORANGE, params, ypSpan, baseHeight, tabHoles, parts, `Rib X${i + 1}`);
    });
    yOffsets.forEach((off, i) => {
      addRib(group, samples, "Y", off, xOffsets, false, frameAngle, COLOR_BLUE, params, xpSpan, baseHeight, tabHoles, parts, `Rib Y${i + 1}`);
    });
    if (baseHeight > 0) group.add(buildBasePlate(footprint, params.thickness, frameAngle, COLOR_VIOLET, params, tabHoles, xOffsets, yOffsets, parts));
    return { group, ribCountX: xOffsets.length, ribCountY: yOffsets.length, strategy: "egg-crate", baseHeight, parts };
  }

  // Одинарная кривизна (цилиндр/призма) → поперечные сёдла + продольные хребты.
  const acrossAxis: RibAxis = alongAxis === "X" ? "Y" : "X";
  const alongMin = alongAxis === "X" ? b.minXp : b.minYp;
  const alongMax = alongAxis === "X" ? b.maxXp : b.maxYp;
  const acrossMin = acrossAxis === "X" ? b.minXp : b.minYp;
  const acrossMax = acrossAxis === "X" ? b.maxXp : b.maxYp;
  const alongSpan = alongMax - alongMin;
  const acrossSpan = acrossMax - acrossMin;
  // Distance X → шаг сёдел (вдоль оси), Distance Y → шаг хребтов (поперёк оси).
  const saddleDist = alongAxis === "X" ? params.distanceX : params.distanceY;
  const spineDist = acrossAxis === "X" ? params.distanceX : params.distanceY;

  const saddleOffsets = gridOffsets(alongMin, alongMax, saddleDist);
  const spineOffsets = spineLayout(acrossMin, acrossMax, spineDist);

  let saddleCount = 0;
  saddleOffsets.forEach((off, i) => {
    if (addRib(group, samples, alongAxis, off, spineOffsets, true, frameAngle, COLOR_ORANGE, params, acrossSpan, baseHeight, tabHoles, parts, `Saddle ${i + 1}`))
      saddleCount++;
  });
  let spineCount = 0;
  spineOffsets.forEach((off, i) => {
    if (addRib(group, samples, acrossAxis, off, saddleOffsets, false, frameAngle, COLOR_BLUE, params, alongSpan, baseHeight, tabHoles, parts, `Spine ${i + 1}`))
      spineCount++;
  });

  if (baseHeight > 0) {
    // Линии рёбер по осям: сёдла идут по alongAxis, хребты — по acrossAxis.
    const xpLines = alongAxis === "X" ? saddleOffsets : spineOffsets;
    const ypLines = alongAxis === "X" ? spineOffsets : saddleOffsets;
    group.add(buildBasePlate(footprint, params.thickness, frameAngle, COLOR_VIOLET, params, tabHoles, xpLines, ypLines, parts));
  }
  return { group, ribCountX: saddleCount, ribCountY: spineCount, strategy: "saddle", baseHeight, parts };
}
