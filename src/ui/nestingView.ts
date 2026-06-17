// Вкладка «Nesting»: overview (сетка всех листов) ↔ detail (один лист на всё вью).
// Глобального размера нет — у каждого листа свой размер (строка над листом).
// Кнопка Download ▾ скачивает текущий лист в выбранном формате (SVG / DXF).

import { SUPPORT_TYPES } from "../generator/ribs";
import { nestParts, type Part, type PlacedPart, type Sheet } from "../export/nesting";

const COLOR: Record<string, string> = {};
for (const t of SUPPORT_TYPES) COLOR[t.kind] = "#" + t.color.toString(16).padStart(6, "0");

const DEFAULT_W = 1000;
const DEFAULT_H = 600;

export interface NestingView {
  el: HTMLElement;
  setParts(parts: Part[]): void;
  setVisible(v: boolean): void;
}

/** Контуры детали в координатах листа (y вниз, начало — левый-верхний угол). */
function placedRings(pp: PlacedPart): { x: number; y: number }[][] {
  const rings = [pp.part.contour, ...pp.part.holes];
  return rings.map((ring) =>
    ring.map((v) => ({ x: pp.ox + (v.x - pp.minX), y: pp.oy + (pp.h - (v.y - pp.minY)) }))
  );
}

function ringsPath(pp: PlacedPart): string {
  return placedRings(pp)
    .map((r) => "M" + r.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join("L") + "Z")
    .join(" ");
}

function sheetBodies(sheet: Sheet): string {
  return sheet.placed
    .map((pp) => {
      const col = COLOR[pp.part.kind] || "#ffffff";
      return `<path d="${ringsPath(pp)}" fill="${col}" fill-opacity="0.16" stroke="${col}" stroke-width="1" vector-effect="non-scaling-stroke" fill-rule="evenodd"/>`;
    })
    .join("");
}

const SHEET_RECT = `fill="rgba(250,250,250,0.05)" stroke="rgba(250,250,250,0.4)" stroke-width="1" vector-effect="non-scaling-stroke"`;

/** Лист на всё вью (detail): вписывается по ширине, с запасом по краю. */
function sheetMarkup(sheet: Sheet): string {
  const pad = 10;
  return `<svg viewBox="${-pad} ${-pad} ${sheet.w + 2 * pad} ${sheet.h + 2 * pad}" preserveAspectRatio="xMidYMid meet">
    <rect x="0" y="0" width="${sheet.w}" height="${sheet.h}" ${SHEET_RECT}/>
    ${sheetBodies(sheet)}
  </svg>`;
}

/**
 * Превью листа в overview в ЕДИНОМ масштабе для всех карточек: ширина SVG —
 * доля от самого широкого листа (maxW), так что больший лист выглядит больше.
 */
function cardMarkup(sheet: Sheet, maxW: number): string {
  const wPct = (sheet.w / maxW) * 100;
  return `<svg style="width:${wPct.toFixed(2)}%" viewBox="0 0 ${sheet.w} ${sheet.h}" preserveAspectRatio="xMidYMid meet">
    <rect x="0" y="0" width="${sheet.w}" height="${sheet.h}" ${SHEET_RECT}/>
    ${sheetBodies(sheet)}
  </svg>`;
}

// ---- экспорт текущего листа ----
function sheetToSVGFile(sheet: Sheet): string {
  const bodies = sheet.placed
    .map((pp) => {
      const col = COLOR[pp.part.kind] || "#000000";
      return `<path d="${ringsPath(pp)}" fill="none" stroke="${col}" stroke-width="0.3" fill-rule="evenodd"/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sheet.w} ${sheet.h}" width="${sheet.w}mm" height="${sheet.h}mm"><rect x="0" y="0" width="${sheet.w}" height="${sheet.h}" fill="none" stroke="#888888" stroke-width="0.3"/>${bodies}</svg>`;
}

function sheetToDXF(sheet: Sheet): string {
  const layer: Record<string, string> = { x: "RIBS_X", y: "RIBS_Y", base: "BASE" };
  const out: string[] = ["0", "SECTION", "2", "ENTITIES"];
  for (const pp of sheet.placed) {
    const lay = layer[pp.part.kind] || "0";
    for (const ring of placedRings(pp)) {
      out.push("0", "POLYLINE", "8", lay, "66", "1", "70", "1");
      for (const p of ring) {
        // DXF — система координат Y вверх, поэтому отражаем по высоте листа.
        out.push("0", "VERTEX", "8", lay, "10", p.x.toFixed(3), "20", (sheet.h - p.y).toFixed(3));
      }
      out.push("0", "SEQEND");
    }
  }
  out.push("0", "ENDSEC", "0", "EOF");
  return out.join("\n");
}

// ---- экспорт всех листов одним файлом (уложены друг под другом) ----
const ALL_GAP = 24;

function allToSVGFile(sheets: Sheet[]): string {
  let maxW = 0;
  let totalH = 0;
  for (const s of sheets) {
    maxW = Math.max(maxW, s.w);
    totalH += s.h;
  }
  totalH += Math.max(0, sheets.length - 1) * ALL_GAP;
  let dy = 0;
  const groups = sheets
    .map((s) => {
      const rect = `<rect x="0" y="${dy.toFixed(1)}" width="${s.w}" height="${s.h}" fill="none" stroke="#888888" stroke-width="0.3"/>`;
      const bodies = s.placed
        .map((pp) => {
          const col = COLOR[pp.part.kind] || "#000000";
          const d = placedRings(pp)
            .map((r) => "M" + r.map((p) => `${p.x.toFixed(2)},${(p.y + dy).toFixed(2)}`).join("L") + "Z")
            .join(" ");
          return `<path d="${d}" fill="none" stroke="${col}" stroke-width="0.3" fill-rule="evenodd"/>`;
        })
        .join("");
      dy += s.h + ALL_GAP;
      return rect + bodies;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${maxW} ${totalH}" width="${maxW}mm" height="${totalH}mm">${groups}</svg>`;
}

function allToDXF(sheets: Sheet[]): string {
  const layer: Record<string, string> = { x: "RIBS_X", y: "RIBS_Y", base: "BASE" };
  const out: string[] = ["0", "SECTION", "2", "ENTITIES"];
  let oyAbs = 0; // смещение листа по Y (DXF — Y вверх)
  for (const s of sheets) {
    // рамка листа
    out.push("0", "POLYLINE", "8", "SHEET", "66", "1", "70", "1");
    for (const [x, y] of [[0, oyAbs], [s.w, oyAbs], [s.w, oyAbs + s.h], [0, oyAbs + s.h]] as const) {
      out.push("0", "VERTEX", "8", "SHEET", "10", x.toFixed(3), "20", y.toFixed(3));
    }
    out.push("0", "SEQEND");
    for (const pp of s.placed) {
      const lay = layer[pp.part.kind] || "0";
      for (const ring of placedRings(pp)) {
        out.push("0", "POLYLINE", "8", lay, "66", "1", "70", "1");
        for (const p of ring) {
          out.push("0", "VERTEX", "8", lay, "10", p.x.toFixed(3), "20", (oyAbs + (s.h - p.y)).toFixed(3));
        }
        out.push("0", "SEQEND");
      }
    }
    oyAbs += s.h + ALL_GAP;
  }
  out.push("0", "ENDSEC", "0", "EOF");
  return out.join("\n");
}

function download(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function createNestingView(): NestingView {
  let parts: Part[] = [];
  const sizes = new Map<number, { w: number; h: number }>(); // индивидуальные размеры листов
  let lastSheets: Sheet[] = [];
  let mode: "overview" | "detail" = "overview";
  let detailIndex = 0;

  const el = document.createElement("div");
  el.className = "nesting hidden";
  el.innerHTML = `
    <div class="nest-all-wrap hidden" id="allWrap">
      <button class="nest-dl" id="allDl">Download all <span class="nest-chev">▾</span></button>
      <div class="nest-dl-menu hidden" id="allMenu">
        <button data-fmt="svg">SVG</button>
        <button data-fmt="dxf">DXF</button>
      </div>
    </div>
    <div class="nest-overview" id="nestOverview"></div>
    <div class="nest-detail hidden" id="nestDetail">
      <div class="nest-detail-bar">
        <button class="nest-back" id="nestBack">‹ All sheets</button>
        <span class="nest-bar-sep"></span>
        <span class="nest-cap-title" id="dTitle"></span>
        <label class="nest-cap-field">W <input class="nest-cap-input" id="dW" type="number" min="50" step="10"></label>
        <label class="nest-cap-field">H <input class="nest-cap-input" id="dH" type="number" min="50" step="10"></label>
        <span class="nest-cap-meta" id="dMeta"></span>
        <div class="nest-dl-wrap" id="dDlWrap">
          <button class="nest-dl" id="dDl">Download <span class="nest-chev">▾</span></button>
          <div class="nest-dl-menu hidden" id="dMenu">
            <button data-fmt="svg">SVG</button>
            <button data-fmt="dxf">DXF</button>
          </div>
        </div>
      </div>
      <div class="nest-detail-canvas" id="dCanvas"></div>
    </div>
  `;

  const overviewEl = el.querySelector("#nestOverview") as HTMLElement;
  const detailEl = el.querySelector("#nestDetail") as HTMLElement;
  const dCanvas = el.querySelector("#dCanvas") as HTMLElement;
  const dTitle = el.querySelector("#dTitle") as HTMLElement;
  const dMeta = el.querySelector("#dMeta") as HTMLElement;
  const dW = el.querySelector("#dW") as HTMLInputElement;
  const dH = el.querySelector("#dH") as HTMLInputElement;
  const dMenu = el.querySelector("#dMenu") as HTMLElement;
  const dDl = el.querySelector("#dDl") as HTMLButtonElement;
  const dDlWrap = el.querySelector("#dDlWrap") as HTMLElement;
  const back = el.querySelector("#nestBack") as HTMLButtonElement;
  const allWrap = el.querySelector("#allWrap") as HTMLElement;
  const allDl = el.querySelector("#allDl") as HTMLButtonElement;
  const allMenu = el.querySelector("#allMenu") as HTMLElement;

  const sizeFor = (i: number) => sizes.get(i) || { w: DEFAULT_W, h: DEFAULT_H };
  const reflow = () => {
    lastSheets = parts.length ? nestParts(parts, sizeFor) : [];
  };

  const renderOverview = () => {
    if (!lastSheets.length) {
      overviewEl.innerHTML = `<div class="nest-empty">No visible supports to lay out.</div>`;
      return;
    }
    const maxW = Math.max(...lastSheets.map((s) => s.w), 1);
    overviewEl.innerHTML = lastSheets
      .map(
        (s, i) =>
          `<div class="nest-card" data-sheet="${i}">
            <div class="nest-card-cap"><span>Sheet ${i + 1}</span><span class="nest-card-meta">${s.w}×${s.h} · ${s.placed.length} parts</span></div>
            <div class="nest-card-svg">${cardMarkup(s, maxW)}</div>
          </div>`
      )
      .join("");
  };

  const renderDetail = () => {
    const s = lastSheets[detailIndex];
    if (!s) {
      showOverview();
      return;
    }
    dTitle.textContent = `Sheet ${detailIndex + 1}`;
    dW.value = String(s.w);
    dH.value = String(s.h);
    dMeta.textContent = `${s.placed.length} parts`;
    dCanvas.innerHTML = sheetMarkup(s);
  };

  function showOverview() {
    mode = "overview";
    detailEl.classList.add("hidden");
    overviewEl.classList.remove("hidden");
    dMenu.classList.add("hidden");
    renderOverview();
    allWrap.classList.toggle("hidden", lastSheets.length === 0);
  }

  function showDetail(i: number) {
    mode = "detail";
    detailIndex = i;
    overviewEl.classList.add("hidden");
    detailEl.classList.remove("hidden");
    allWrap.classList.add("hidden");
    allMenu.classList.add("hidden");
    renderDetail();
  }

  const render = () => {
    if (el.classList.contains("hidden")) return;
    reflow();
    if (mode === "detail" && detailIndex < lastSheets.length) renderDetail();
    else showOverview();
  };

  overviewEl.addEventListener("click", (e) => {
    const card = (e.target as HTMLElement).closest(".nest-card") as HTMLElement | null;
    if (!card) return;
    showDetail(parseInt(card.dataset.sheet || "0", 10));
  });

  back.addEventListener("click", showOverview);

  // Размер текущего листа (строка над листом).
  const onDetailSize = () => {
    const w = parseFloat(dW.value);
    const h = parseFloat(dH.value);
    const base = sizes.get(detailIndex) || { w: DEFAULT_W, h: DEFAULT_H };
    sizes.set(detailIndex, { w: w >= 50 ? w : base.w, h: h >= 50 ? h : base.h });
    reflow();
    renderDetail();
  };
  dW.addEventListener("change", onDetailSize);
  dH.addEventListener("change", onDetailSize);

  // Выпадающий список форматов.
  dDl.addEventListener("click", (e) => {
    e.stopPropagation();
    dMenu.classList.toggle("hidden");
  });
  allDl.addEventListener("click", (e) => {
    e.stopPropagation();
    allMenu.classList.toggle("hidden");
  });
  document.addEventListener("click", (e) => {
    const t = e.target as Node;
    if (!dDlWrap.contains(t)) dMenu.classList.add("hidden");
    if (!allWrap.contains(t)) allMenu.classList.add("hidden");
  });
  dMenu.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("button") as HTMLButtonElement | null;
    if (!btn) return;
    const s = lastSheets[detailIndex];
    dMenu.classList.add("hidden");
    if (!s) return;
    const n = detailIndex + 1;
    if (btn.dataset.fmt === "svg") download(`sheet-${n}.svg`, sheetToSVGFile(s), "image/svg+xml");
    else if (btn.dataset.fmt === "dxf") download(`sheet-${n}.dxf`, sheetToDXF(s), "application/dxf");
  });
  allMenu.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("button") as HTMLButtonElement | null;
    if (!btn) return;
    allMenu.classList.add("hidden");
    if (!lastSheets.length) return;
    if (btn.dataset.fmt === "svg") download("nesting-all.svg", allToSVGFile(lastSheets), "image/svg+xml");
    else if (btn.dataset.fmt === "dxf") download("nesting-all.dxf", allToDXF(lastSheets), "application/dxf");
  });

  return {
    el,
    setParts(p) {
      parts = p;
      render();
    },
    setVisible(v) {
      el.classList.toggle("hidden", !v);
      if (v) render();
    },
  };
}
