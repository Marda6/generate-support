import "./style.css";
import * as THREE from "three";
import { DEFAULT_PARAMS, type SupportParams } from "./params";
import { Viewer } from "./viewer/scene";
import { createDemoModel } from "./model/demo";
import { buildSupports } from "./generator/ribs";
import { buildPanel } from "./ui/panel";
import { exportSTL, downloadBlob } from "./export/stl";
import { SelectionManager } from "./viewer/selection";

const app = document.getElementById("app")!;
app.innerHTML = `
  <div class="dialog">
    <div class="dialog-header">
      <span class="ttl">Support Generator</span>
      <button class="x" id="closeBtn" title="Закрыть (Esc)">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1L13 13M13 1L1 13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
      </button>
    </div>
    <div class="dialog-body">
      <div class="panel" id="panel"></div>
      <div class="viewport" id="viewport"></div>
    </div>
  </div>
`;

const viewport = document.getElementById("viewport")!;
const panelHost = document.getElementById("panel")!;

const viewer = new Viewer(viewport);
const model = createDemoModel();
viewer.scene.add(model);

const params: SupportParams = { ...DEFAULT_PARAMS };
let supports: THREE.Group | null = null;
const selection = new SelectionManager(viewer, viewport);

const panel = buildPanel(panelHost, params, {
  onChange: (p) => regenerate(p),
  onOk: () => panel.setStatus("Done. Supports generated."),
  onCancel: () => {
    selection.deselect();
    if (supports) {
      viewer.scene.remove(supports);
      disposeGroup(supports);
      supports = null;
    }
    panel.setStatus("Cancelled.");
  },
  onExport: () => {
    if (!supports) {
      panel.setStatus("Generate supports first.");
      return;
    }
    const blob = exportSTL(supports);
    downloadBlob(blob, "supports.stl");
    panel.setStatus("STL exported.");
  },
});

function disposeGroup(g: THREE.Group) {
  g.traverse((o) => {
    const m = o as THREE.Mesh | THREE.LineSegments;
    if ((m as { geometry?: THREE.BufferGeometry }).geometry) m.geometry.dispose();
  });
}

function regenerate(p: SupportParams) {
  const t0 = performance.now();
  if (supports) {
    viewer.scene.remove(supports);
    disposeGroup(supports);
  }
  try {
    const res = buildSupports(model, p);
    supports = res.group;
    viewer.scene.add(supports);
    selection.setSupports(supports);
    const ms = Math.round(performance.now() - t0);
    if (res.strategy === "saddle") {
      panel.setStatus(`Auto: cylinder/prism → saddles=${res.ribCountX}, spines=${res.ribCountY} · ${ms} ms`);
    } else {
      panel.setStatus(`Auto: egg-crate → X=${res.ribCountX}, Y=${res.ribCountY} · ${ms} ms`);
    }
  } catch (e) {
    console.error(e);
    panel.setStatus("Generation error: " + (e as Error).message);
  }
}

regenerate(params);
// Изометрический вид + zoom-fit под деталь и все поддержки.
// Откладываем на следующий кадр, чтобы вьюпорт уже получил реальный размер.
requestAnimationFrame(() => {
  const objs: THREE.Object3D[] = [model];
  if (supports) objs.push(supports);
  viewer.fitIsometric(objs);
});

// для отладки/проверки
(window as unknown as { __viewer: Viewer }).__viewer = viewer;
(window as unknown as { __sel: SelectionManager }).__sel = selection;
(window as unknown as { __THREE: typeof THREE }).__THREE = THREE;

(document.getElementById("closeBtn") as HTMLElement).addEventListener("click", () => {
  panel.setStatus("Window closed (demo).");
});
