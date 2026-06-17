// Раскрой (nesting): MaxRects (best-short-side-fit) с поворотами деталей на 90°
// и переносом на следующий лист. Контуры берутся из тех же 2D-фигур, что
// выдавливаются в поддержки, поэтому геометрия реза точная.

import type { SupportKind } from "../generator/ribs";

export interface Vec2 {
  x: number;
  y: number;
}

/** Плоский контур одной детали: внешний путь + отверстия (окна, пазы). */
export interface Part {
  kind: SupportKind;
  label: string;
  contour: Vec2[];
  holes: Vec2[][];
}

/** Деталь, размещённая на листе. */
export interface PlacedPart {
  part: Part;
  ox: number; // смещение бокса детали по X на листе
  oy: number; // смещение по Y
  w: number; // исходная ширина бокса детали
  h: number; // исходная высота бокса детали
  minX: number;
  minY: number;
  rotated: boolean; // повёрнута на 90°
}

export interface Sheet {
  placed: PlacedPart[];
  w: number;
  h: number;
}

interface Item {
  part: Part;
  minX: number;
  minY: number;
  w: number;
  h: number;
  area: number;
}

interface FreeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Placement {
  it: Item;
  x: number;
  y: number;
  rotated: boolean;
}

const EPS = 1e-3;

function itemize(parts: Part[]): Item[] {
  return parts
    .map((p) => {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const v of p.contour) {
        if (v.x < minX) minX = v.x;
        if (v.x > maxX) maxX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.y > maxY) maxY = v.y;
      }
      const w = maxX - minX;
      const h = maxY - minY;
      return { part: p, minX, minY, w, h, area: w * h };
    })
    .filter((it) => isFinite(it.w) && isFinite(it.h) && it.w > 0 && it.h > 0);
}

function intersects(a: FreeRect, b: FreeRect): boolean {
  return a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS && a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS;
}
function contains(a: FreeRect, b: FreeRect): boolean {
  return b.x >= a.x - EPS && b.y >= a.y - EPS && b.x + b.w <= a.x + a.w + EPS && b.y + b.h <= a.y + a.h + EPS;
}

/** Разбивает свободный прямоугольник вокруг занятого (MaxRects, до 4 частей). */
function splitFree(fr: FreeRect, u: FreeRect): FreeRect[] {
  const res: FreeRect[] = [];
  if (u.x > fr.x + EPS) res.push({ x: fr.x, y: fr.y, w: u.x - fr.x, h: fr.h });
  if (u.x + u.w < fr.x + fr.w - EPS) res.push({ x: u.x + u.w, y: fr.y, w: fr.x + fr.w - (u.x + u.w), h: fr.h });
  if (u.y > fr.y + EPS) res.push({ x: fr.x, y: fr.y, w: fr.w, h: u.y - fr.y });
  if (u.y + u.h < fr.y + fr.h - EPS) res.push({ x: fr.x, y: u.y + u.h, w: fr.w, h: fr.y + fr.h - (u.y + u.h) });
  return res.filter((r) => r.w > EPS && r.h > EPS);
}

function packBin(items: Item[], binW: number, binH: number, margin: number, gap: number): { placed: Placement[]; leftover: Item[] } {
  let free: FreeRect[] = [{ x: margin, y: margin, w: Math.max(0, binW - 2 * margin), h: Math.max(0, binH - 2 * margin) }];
  const placed: Placement[] = [];
  const leftover: Item[] = [];

  for (const it of items) {
    const iw = it.w + gap;
    const ih = it.h + gap;
    let best: { x: number; y: number; pw: number; ph: number; rotated: boolean; score: number } | null = null;
    for (const fr of free) {
      // без поворота
      if (iw <= fr.w + EPS && ih <= fr.h + EPS) {
        const score = Math.min(fr.w - iw, fr.h - ih); // best short side fit
        if (!best || score < best.score) best = { x: fr.x, y: fr.y, pw: iw, ph: ih, rotated: false, score };
      }
      // поворот на 90°
      if (ih <= fr.w + EPS && iw <= fr.h + EPS) {
        const score = Math.min(fr.w - ih, fr.h - iw);
        if (!best || score < best.score) best = { x: fr.x, y: fr.y, pw: ih, ph: iw, rotated: true, score };
      }
    }
    if (!best) {
      leftover.push(it);
      continue;
    }
    placed.push({ it, x: best.x, y: best.y, rotated: best.rotated });
    const used: FreeRect = { x: best.x, y: best.y, w: best.pw, h: best.ph };
    const next: FreeRect[] = [];
    for (const fr of free) {
      if (!intersects(fr, used)) {
        next.push(fr);
        continue;
      }
      for (const r of splitFree(fr, used)) next.push(r);
    }
    // отбрасываем свободные прямоугольники, вложенные в другие
    free = next.filter((r, i) => !next.some((o, j) => i !== j && contains(o, r)));
  }
  return { placed, leftover };
}

/** Раскладывает детали по листам (размер каждого — sizeFor(index)). */
export function nestParts(
  parts: Part[],
  sizeFor: (index: number) => { w: number; h: number },
  margin = 12,
  gap = 6
): Sheet[] {
  const items = itemize(parts).sort((a, b) => b.area - a.area);
  const sheets: Sheet[] = [];
  let remaining = items;
  let idx = 0;

  while (remaining.length && idx < 500) {
    const { w, h } = sizeFor(idx);
    let { placed, leftover } = packBin(remaining, w, h, margin, gap);
    if (placed.length === 0) {
      // деталь крупнее листа — кладём как есть (overflow), чтобы не зациклиться
      const it = remaining[0];
      placed = [{ it, x: margin, y: margin, rotated: false }];
      leftover = remaining.slice(1);
    }
    sheets.push({
      w,
      h,
      placed: placed.map((pl) => ({
        part: pl.it.part,
        ox: pl.x,
        oy: pl.y,
        w: pl.it.w,
        h: pl.it.h,
        minX: pl.it.minX,
        minY: pl.it.minY,
        rotated: pl.rotated,
      })),
    });
    remaining = leftover;
    idx++;
  }
  return sheets;
}
