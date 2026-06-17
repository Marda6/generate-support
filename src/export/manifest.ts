// CAM-манифест: группировка деталей в уникальные ТИПЫ (по геометрии) с
// количеством, наружными и внутренними контурами. Формат, удобный для подачи
// на вход внешнему нестеру (он сам размножит детали по count).

import type { Part, Vec2 } from "./nesting";
import type { SupportKind } from "../generator/ribs";

export interface CamType {
  /** Идентификатор типа: A, B, C, … */
  id: string;
  /** Вид поддержки представителя (для цвета в UI): x / y / base. */
  kind: SupportKind;
  /** Человекочитаемая подпись представителя (Saddle / Spine / Base). */
  label: string;
  /** Сколько таких деталей в задании. */
  count: number;
  /** Ссылка на наружный контур в наборе curves. */
  outer: string;
  /** Ссылки на внутренние контуры (отверстия). Пусто — отверстий нет. */
  inner: string[];
}

export interface Manifest {
  units: "mm";
  types: CamType[];
  /** Геометрия кривых по именам-ссылкам: замкнутые полилинии (точки [x,y]). */
  curves: Record<string, { closed: true; points: [number, number][] }>;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Подпись геометрии детали (нормирована по габаритам, округлена) для группировки. */
function partSignature(p: Part): string {
  let minX = Infinity;
  let minY = Infinity;
  for (const v of p.contour) {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
  }
  const ring = (pts: Vec2[]) =>
    pts.map((v) => `${Math.round((v.x - minX) * 50)},${Math.round((v.y - minY) * 50)}`).join(" ");
  return ring(p.contour) + "|" + p.holes.map(ring).join(";");
}

function typeId(i: number): string {
  return i < 26 ? String.fromCharCode(65 + i) : `T${i + 1}`;
}

export interface PartGroup {
  id: string;
  kind: SupportKind;
  label: string;
  parts: Part[];
}

/** Группирует детали по геометрии в типы (A, B, C…) в порядке первого появления. */
export function groupParts(parts: Part[]): PartGroup[] {
  const map = new Map<string, Part[]>();
  for (const p of parts) {
    const sig = partSignature(p);
    const g = map.get(sig);
    if (g) g.push(p);
    else map.set(sig, [p]);
  }
  let i = 0;
  return [...map.values()].map((ps) => ({ id: typeId(i++), kind: ps[0].kind, label: ps[0].label, parts: ps }));
}

/** Собирает CAM-манифест: типы (с количеством) + геометрия кривых. */
export function buildManifest(parts: Part[]): Manifest {
  const types: CamType[] = [];
  const curves: Manifest["curves"] = {};
  for (const g of groupParts(parts)) {
    const id = g.id;
    const rep = g.parts[0];
    // Кривые типа — в собственной системе координат от (0,0).
    let minX = Infinity;
    let minY = Infinity;
    for (const v of rep.contour) {
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
    }
    const pts = (ring: Vec2[]): [number, number][] => ring.map((v) => [r3(v.x - minX), r3(v.y - minY)]);

    const outer = `Curves/CurveType${id}_Outer`;
    curves[outer] = { closed: true, points: pts(rep.contour) };

    const inner: string[] = [];
    rep.holes.forEach((h, hi) => {
      const name = `Curves/CurveType${id}_Inner${rep.holes.length > 1 ? `_${hi + 1}` : ""}`;
      curves[name] = { closed: true, points: pts(h) };
      inner.push(name);
    });

    types.push({ id, kind: g.kind, label: g.label, count: g.parts.length, outer, inner });
  }
  return { units: "mm", types, curves };
}
