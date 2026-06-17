import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import type { Viewer } from "./scene";

// Базовая/выбранная/приглушённая прозрачность рёбер.
const FILL_BASE = 0.4;
const EDGE_BASE = 0.55;
const FILL_SEL = 0.92;
const EDGE_SEL = 1.0;
const FILL_DIM = 0.1;
const EDGE_DIM = 0.16;
const FILL_HOVER = 0.72;
const EDGE_HOVER = 0.85;

const MOVE_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1.5v13M1.5 8h13M8 1.5L5.6 4M8 1.5L10.4 4M8 14.5L5.6 12M8 14.5L10.4 12M1.5 8l2.5-2.4M1.5 8l2.5 2.4M14.5 8L12 5.6M14.5 8L12 10.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ROTATE_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13 5.5A6 6 0 1 0 14 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M13.6 2.3v3.4h-3.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export class SelectionManager {
  private transform: TransformControls;
  private group: THREE.Group | null = null;
  private selected: THREE.Mesh | null = null;
  private hovered: THREE.Mesh | null = null;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private downX = 0;
  private downY = 0;
  private dragging = false;
  private bar: HTMLElement;
  private label: HTMLElement;
  private viewportEl: HTMLElement;
  private lastClientX: number | null = null;
  private lastClientY: number | null = null;

  constructor(
    private viewer: Viewer,
    viewportEl: HTMLElement
  ) {
    this.viewportEl = viewportEl;
    const canvas = viewer.renderer.domElement;

    this.transform = new TransformControls(viewer.camera, canvas);
    this.transform.setSpace("local");
    this.transform.setSize(0.85);
    const tc = this.transform as unknown as { getHelper?: () => THREE.Object3D };
    const helper = tc.getHelper ? tc.getHelper() : (this.transform as unknown as THREE.Object3D);
    viewer.scene.add(helper);

    this.transform.addEventListener("dragging-changed", (e) => {
      this.dragging = (e as unknown as { value: boolean }).value;
      viewer.controls.enabled = !this.dragging;
    });

    canvas.addEventListener("pointerdown", (e) => {
      this.downX = e.clientX;
      this.downY = e.clientY;
    });
    canvas.addEventListener("pointerup", (e) => this.onPointerUp(e));
    canvas.addEventListener("pointermove", (e) => this.onPointerMove(e));

    // Плавающая панель управления (в стиле приложения).
    this.bar = document.createElement("div");
    this.bar.className = "gizmo-bar hidden";
    this.bar.innerHTML = `
      <button class="gz-btn active" data-mode="translate" title="Move">${MOVE_ICON}</button>
      <button class="gz-btn" data-mode="rotate" title="Rotate">${ROTATE_ICON}</button>
      <span class="gz-sep"></span>
      <span class="gz-label"></span>
      <button class="gz-close" title="Deselect">✕</button>
    `;
    viewportEl.appendChild(this.bar);
    this.label = this.bar.querySelector(".gz-label") as HTMLElement;

    this.bar.querySelectorAll<HTMLElement>(".gz-btn").forEach((b) => {
      b.addEventListener("click", () => {
        const mode = b.dataset.mode as "translate" | "rotate";
        this.transform.setMode(mode);
        this.bar.querySelectorAll(".gz-btn").forEach((x) => x.classList.toggle("active", x === b));
      });
    });
    (this.bar.querySelector(".gz-close") as HTMLElement).addEventListener("click", () => this.deselect());
  }

  /** Привязать новый набор поддержек (вызывается после регенерации). */
  setSupports(group: THREE.Group) {
    this.deselect();
    this.group = group;
  }

  /** Луч в указатель → первое попавшееся ребро (или null). */
  private pick(e: PointerEvent): THREE.Mesh | null {
    if (!this.group) return null;
    const rect = this.viewer.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.viewer.camera);
    const hits = this.raycaster.intersectObjects(this.group.children, false);
    return hits.length ? (hits[0].object as THREE.Mesh) : null;
  }

  private onPointerUp(e: PointerEvent) {
    if (this.dragging) return;
    // Отличаем клик от вращения камеры по смещению указателя.
    if (Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > 5) return;
    this.lastClientX = e.clientX;
    this.lastClientY = e.clientY;
    const hit = this.pick(e);
    if (hit) this.select(hit);
    else this.deselect();
  }

  /** Размещает панель рядом с курсором, не вылезая за вьюпорт. */
  private positionBar() {
    const rect = this.viewportEl.getBoundingClientRect();
    const bw = this.bar.offsetWidth;
    const bh = this.bar.offsetHeight;
    const off = 14;
    if (this.lastClientX == null || this.lastClientY == null) {
      // запасной вариант (программный выбор) — справа-сверху
      this.bar.style.left = `${rect.width - bw - 12}px`;
      this.bar.style.top = "12px";
      return;
    }
    let x = this.lastClientX - rect.left + off;
    let y = this.lastClientY - rect.top + off;
    if (x + bw > rect.width - 8) x = this.lastClientX - rect.left - bw - off;
    if (y + bh > rect.height - 8) y = this.lastClientY - rect.top - bh - off;
    x = Math.max(8, Math.min(x, rect.width - bw - 8));
    y = Math.max(8, Math.min(y, rect.height - bh - 8));
    this.bar.style.left = `${x}px`;
    this.bar.style.top = `${y}px`;
  }

  private onPointerMove(e: PointerEvent) {
    if (this.dragging || !this.group) return;
    const hit = this.pick(e);
    if (hit === this.hovered) return;
    this.hovered = hit;
    this.viewer.renderer.domElement.style.cursor = hit ? "pointer" : "";
    // Контурная подсветка наведённого ребра в цвет ребра.
    this.viewer.outline.selectedObjects = hit ? [hit] : [];
    if (hit) {
      this.viewer.outline.visibleEdgeColor.set((hit.material as THREE.MeshStandardMaterial).color.getHex());
    }
    this.refresh();
  }

  /** Пересчитывает прозрачность всех рёбер по состоянию выбора/ховера. */
  private refresh() {
    if (!this.group) return;
    for (const child of this.group.children) {
      const m = child as THREE.Mesh;
      let fill = FILL_BASE;
      let edge = EDGE_BASE;
      if (this.selected) {
        if (m === this.selected) {
          fill = FILL_SEL;
          edge = EDGE_SEL;
        } else {
          fill = FILL_DIM;
          edge = EDGE_DIM;
        }
      }
      if (m === this.hovered && m !== this.selected) {
        fill = FILL_HOVER;
        edge = EDGE_HOVER;
      }
      this.setAppearance(m, fill, edge);
    }
  }

  private setAppearance(mesh: THREE.Mesh, fill: number, edge: number) {
    (mesh.material as THREE.MeshStandardMaterial).opacity = fill;
    const line = mesh.children[0] as THREE.LineSegments | undefined;
    if (line && (line as THREE.LineSegments).isLineSegments) {
      (line.material as THREE.LineBasicMaterial).opacity = edge;
    }
  }

  select(mesh: THREE.Mesh) {
    if (!this.group) return;
    this.selected = mesh;
    this.refresh();
    this.transform.attach(mesh);
    this.label.textContent = mesh.name || "Support";
    this.bar.classList.remove("hidden");
    this.positionBar();
  }

  deselect() {
    this.selected = null;
    this.hovered = null;
    this.viewer.outline.selectedObjects = [];
    this.refresh();
    this.transform.detach();
    this.bar.classList.add("hidden");
  }
}
