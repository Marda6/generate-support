import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { OutlinePass } from "three/examples/jsm/postprocessing/OutlinePass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

export class Viewer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly renderer: THREE.WebGLRenderer;
  private readonly frustumHalf = 1; // базовая полувысота ортокадра (масштаб задаёт zoom)
  readonly controls: OrbitControls;
  readonly grid: THREE.LineSegments;
  readonly composer: EffectComposer;
  /** Контурная подсветка наведённой/выбранной поддержки. */
  readonly outline: OutlinePass;
  private readonly container: HTMLElement;
  private fitTargets: THREE.Object3D[] = [];
  private fitUntil = 0; // до этого момента повторяем fit при ресайзах (раскладка устаканивается)

  constructor(container: HTMLElement) {
    this.container = container;
    // Фон вью — в тоне окна Support Generator (#202228).
    this.scene.background = new THREE.Color(0x262931);

    // Ортографическая камера → изометрическая проекция без перспективных искажений.
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(300, -300, 300);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0, 60);

    // Свет
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(200, -150, 400);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.35);
    fill.position.set(-200, 150, 100);
    this.scene.add(fill);

    // Опорная сетка «пола» (Z=0) с радиальным затуханием: центр 100% → края 5%.
    this.grid = createRadialGrid(900, 30, 0x4a5260);
    this.scene.add(this.grid);

    // Постобработка: только контурная подсветка наведённой поддержки (без общего bloom).
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.outline = new OutlinePass(new THREE.Vector2(1, 1), this.scene, this.camera);
    this.outline.edgeStrength = 1.5;
    this.outline.edgeGlow = 0.35; // лёгкий блюр
    this.outline.edgeThickness = 1.5; // пара пикселей
    this.outline.pulsePeriod = 0;
    this.outline.visibleEdgeColor.set("#ffffff");
    this.outline.hiddenEdgeColor.set("#20242b");
    this.composer.addPass(this.outline);
    this.composer.addPass(new OutputPass());

    const ro = new ResizeObserver(() => this.resize(container));
    ro.observe(container);
    this.resize(container);

    const animate = () => {
      requestAnimationFrame(animate);
      this.controls.update();
      this.composer.render();
    };
    animate();
  }

  resize(container: HTMLElement) {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    const aspect = w / h;
    const fh = this.frustumHalf;
    this.camera.left = -fh * aspect;
    this.camera.right = fh * aspect;
    this.camera.top = fh;
    this.camera.bottom = -fh;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.outline.setSize(w, h);
    // Пока раскладка устаканивается (шрифты, размеры панели) — держим вид вписанным.
    if (this.fitTargets.length && performance.now() < this.fitUntil) this.doFit();
  }

  /**
   * Изометрический вид + zoom-fit. Запоминает цель и в течение ~1.5 c повторяет
   * подгонку при ресайзах — это устраняет гонку с раскладкой/загрузкой шрифтов.
   */
  fitIsometric(objects: THREE.Object3D[]) {
    this.fitTargets = objects.filter(Boolean);
    this.fitUntil = performance.now() + 1500;
    this.doFit();
  }

  private doFit() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!this.fitTargets.length || w < 2 || h < 2) return; // нет валидного размера — ждём ресайза

    const box = new THREE.Box3();
    for (const o of this.fitTargets) box.expandByObject(o);
    if (box.isEmpty()) return;

    const aspect = w / h;
    const fh = this.frustumHalf;
    this.camera.left = -fh * aspect;
    this.camera.right = fh * aspect;
    this.camera.top = fh;
    this.camera.bottom = -fh;

    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getBoundingSphere(new THREE.Sphere()).radius || 1;
    const dir = new THREE.Vector3(1, -1, 1).normalize(); // классическое изо-направление (Z вверх)
    const dist = radius * 4 + 10;

    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.camera.near = 0.1;
    this.camera.far = dist + radius * 4 + 100;
    this.controls.target.copy(center);
    this.camera.lookAt(center);
    this.camera.updateMatrixWorld(true);

    // Габариты содержимого в осях экрана (right/up) для подбора zoom.
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    const min = box.min;
    const max = box.max;
    let halfW = 0;
    let halfH = 0;
    const v = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z).sub(center);
      halfW = Math.max(halfW, Math.abs(v.dot(right)));
      halfH = Math.max(halfH, Math.abs(v.dot(up)));
    }
    const zoomX = this.camera.right / Math.max(halfW, 1e-3);
    const zoomY = this.camera.top / Math.max(halfH, 1e-3);
    this.camera.zoom = Math.min(zoomX, zoomY) * 0.92; // небольшой отступ по краям
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }
}

/**
 * Сетка пола в плоскости XY (Z=0) с радиальным затуханием прозрачности:
 * центр — 100%, край — 5%.
 */
function createRadialGrid(size: number, divisions: number, color: number): THREE.LineSegments {
  const half = size / 2;
  const step = size / divisions;
  const verts: number[] = [];
  for (let i = 0; i <= divisions; i++) {
    const p = -half + i * step;
    verts.push(-half, p, 0, half, p, 0); // линия вдоль X
    verts.push(p, -half, 0, p, half, 0); // линия вдоль Y
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uMaxRadius: { value: half },
    },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vXY;
      void main() {
        vXY = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uMaxRadius;
      varying vec2 vXY;
      void main() {
        float d = clamp(length(vXY) / uMaxRadius, 0.0, 1.0);
        float a = mix(1.0, 0.05, d); // центр 100% → край 5%
        gl_FragColor = vec4(uColor, a);
      }
    `,
  });

  const grid = new THREE.LineSegments(geo, mat);
  grid.name = "grid";
  return grid;
}
