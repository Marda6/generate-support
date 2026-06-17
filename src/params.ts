// Параметры генератора поддержек (решётчатый каркас / egg-crate).
// Значения и порядок соответствуют окну "Support Generator".

export interface SupportParams {
  /** Поворот сетки рёбер вокруг оси Z, градусы */
  rotateZ: number;
  /** Шаг между рёбрами вдоль X (мм) */
  distanceX: number;
  /** Шаг между рёбрами вдоль Y (мм) */
  distanceY: number;
  /** Толщина материала рёбер (мм) */
  thickness: number;

  /** Высота "головки" опорной насечки на верхней кромке (мм) */
  notchHeadHeight: number;
  /** Ширина "головки" опорной насечки (мм) */
  notchHeadWidth: number;
  /** Радиус скругления насечки R1 (мм) */
  notchR1: number;
  /** Радиус скругления насечки R2 (мм) */
  notchR2: number;

  /** Ширина базового язычка (мм) */
  tabsWidth: number;
  /** Глубина базового язычка (мм) */
  tabsDepth: number;

  /** Глубина паза врезного соединения (мм) */
  slotHeight: number;
  /** Ширина паза (мм), обычно ≈ толщине материала */
  slotWidth: number;
  /** Радиус скругления паза R1 (мм) */
  slotR1: number;
  /** Радиус скругления паза R2 (мм) */
  slotR2: number;

  /** Отступ облегчающих окон от кромок (мм) */
  windowsOffset: number;
  /** Генерировать облегчающие окна */
  generateWindows: boolean;
}

export const DEFAULT_PARAMS: SupportParams = {
  rotateZ: 10,
  distanceX: 107.881,
  distanceY: 216.348,
  thickness: 1,
  notchHeadHeight: 3,
  notchHeadWidth: 5,
  notchR1: 0.75,
  notchR2: 1.75,
  tabsWidth: 2,
  tabsDepth: 1,
  slotHeight: 4,
  slotWidth: 3,
  slotR1: 0.5,
  slotR2: 0.5,
  windowsOffset: 3,
  generateWindows: false,
};

export interface NumberField {
  kind: "number";
  key: keyof SupportParams;
  label: string;
  group: string;
  step?: number;
  min?: number;
}

export interface ToggleField {
  kind: "toggle";
  key: keyof SupportParams;
  label: string;
  group: string;
}

export type Field = NumberField | ToggleField;

// Порядок и подписи как в исходном окне; group — смысловые блоки для разделителей.
export const FIELDS: Field[] = [
  { kind: "number", key: "rotateZ", label: "Rotate Z", step: 1, group: "general" },
  { kind: "number", key: "distanceX", label: "Distance X", step: 1, min: 1, group: "general" },
  { kind: "number", key: "distanceY", label: "Distance Y", step: 1, min: 1, group: "general" },
  { kind: "number", key: "thickness", label: "Thickness", step: 0.1, min: 0.1, group: "general" },
  { kind: "number", key: "notchHeadHeight", label: "Notch Head Height", step: 0.5, min: 0, group: "notch" },
  { kind: "number", key: "notchHeadWidth", label: "Notch Head Width", step: 0.5, min: 0, group: "notch" },
  { kind: "number", key: "notchR1", label: "Notch R1", step: 0.05, min: 0, group: "notch" },
  { kind: "number", key: "notchR2", label: "Notch R2", step: 0.05, min: 0, group: "notch" },
  { kind: "number", key: "tabsWidth", label: "Tabs Width", step: 0.5, min: 0, group: "tabs" },
  { kind: "number", key: "tabsDepth", label: "Tabs Depth", step: 0.5, min: 0, group: "tabs" },
  { kind: "number", key: "slotHeight", label: "Slot Height", step: 0.5, min: 0, group: "slot" },
  { kind: "number", key: "slotWidth", label: "Slot Width", step: 0.5, min: 0, group: "slot" },
  { kind: "number", key: "slotR1", label: "Slot R1", step: 0.05, min: 0, group: "slot" },
  { kind: "number", key: "slotR2", label: "Slot R2", step: 0.05, min: 0, group: "slot" },
  { kind: "number", key: "windowsOffset", label: "Windows Offset", step: 0.5, min: 0, group: "windows" },
  { kind: "toggle", key: "generateWindows", label: "Generate Windows", group: "windows" },
];
