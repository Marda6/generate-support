// Раскрой (nesting): укладка плоских контуров поддержек на листы заданного размера.
// Контуры берутся из тех же 2D-фигур (THREE.Shape), что выдавливаются в поддержки,
// поэтому геометрия реза точная.

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
  w: number;
  h: number;
  minX: number; // исходный минимум бокса детали (для нормализации)
  minY: number;
}

export interface Sheet {
  placed: PlacedPart[];
  w: number;
  h: number;
}

/**
 * Полочная укладка (shelf packing) по строкам слева-направо, с переносом на
 * следующий лист при заполнении. Размер каждого листа задаётся `sizeFor(index)`
 * (позволяет иметь индивидуальные размеры листов). Детали сортируются по высоте.
 */
export function nestParts(
  parts: Part[],
  sizeFor: (index: number) => { w: number; h: number },
  margin = 12,
  gap = 6
): Sheet[] {
  const items = parts
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
      return { part: p, minX, minY, w: maxX - minX, h: maxY - minY };
    })
    .filter((it) => isFinite(it.w) && isFinite(it.h) && it.w > 0 && it.h > 0)
    .sort((a, b) => b.h - a.h);

  const sheets: Sheet[] = [];
  let idx = 0;
  let size = sizeFor(0);
  let cur: Sheet = { placed: [], w: size.w, h: size.h };
  sheets.push(cur);
  let x = margin;
  let y = margin;
  let rowH = 0;

  for (const it of items) {
    // Перенос строки (по ширине текущего листа).
    if (x + it.w + margin > cur.w && x > margin) {
      x = margin;
      y += rowH + gap;
      rowH = 0;
    }
    // Перенос на следующий лист (по высоте текущего листа).
    if (y + it.h + margin > cur.h && y > margin) {
      idx++;
      size = sizeFor(idx);
      cur = { placed: [], w: size.w, h: size.h };
      sheets.push(cur);
      x = margin;
      y = margin;
      rowH = 0;
    }
    cur.placed.push({ part: it.part, ox: x, oy: y, w: it.w, h: it.h, minX: it.minX, minY: it.minY });
    x += it.w + gap;
    rowH = Math.max(rowH, it.h);
  }

  return sheets;
}
