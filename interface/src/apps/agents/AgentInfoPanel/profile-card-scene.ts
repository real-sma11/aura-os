import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

export interface ProfileCardSceneOptions {
  horizontal: boolean;
  accent: string;
  reducedMotion: boolean;
}

export interface ProfileCardScene {
  /** Offscreen canvas the LCD texture is drawn into by the caller. */
  readonly screenCanvas: HTMLCanvasElement;
  /** True when the current layout is landscape. */
  readonly horizontal: boolean;
  /** Resize the LCD canvas + rebuild card geometry for the orientation. */
  setOrientation(horizontal: boolean): void;
  setAccent(accent: string): void;
  /** Mark the LCD texture dirty after redrawing into `screenCanvas`. */
  refreshTexture(): void;
  dispose(): void;
}

export function isWebGLAvailable(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl2") || canvas.getContext("webgl"))
    );
  } catch {
    return false;
  }
}

const PORTRAIT_CANVAS = { w: 620, h: 868 };
const LANDSCAPE_CANVAS = { w: 980, h: 600 };

const PORTRAIT_SHELL = { w: 1.78, h: 2.46 };
const LANDSCAPE_SHELL = { w: 2.74, h: 1.7 };

const SHELL_DEPTH = 0.12;
const SHELL_BEVEL = 0.03;

function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const shape = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  const radius = Math.min(r, w / 2, h / 2);
  shape.moveTo(x + radius, y);
  shape.lineTo(x + w - radius, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + radius);
  shape.lineTo(x + w, y + h - radius);
  shape.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  shape.lineTo(x + radius, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return shape;
}

export function createProfileCardScene(
  host: HTMLElement,
  options: ProfileCardSceneOptions,
): ProfileCardScene {
  let horizontal = options.horizontal;
  let accent = new THREE.Color(options.accent || "#6366f1");
  const reducedMotion = options.reducedMotion;

  const width = host.clientWidth || 320;
  const height = host.clientHeight || 420;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  host.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, width / height, 0.1, 100);

  // Environment for metallic reflections.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new RoomEnvironment();
  const envRT = pmrem.fromScene(envScene, 0.04);
  scene.environment = envRT.texture;

  // Lights (env carries most of the reflection; these add directional shaping).
  const ambient = new THREE.AmbientLight(0x223040, 0.5);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(2.5, 4, 4);
  scene.add(key);
  const accentLight = new THREE.PointLight(accent.getHex(), 6, 12, 2);
  accentLight.position.set(-1.5, 1.5, 2.5);
  scene.add(accentLight);

  const group = new THREE.Group();
  scene.add(group);

  // LCD offscreen canvas + texture.
  const screenCanvas = document.createElement("canvas");
  const screenTexture = new THREE.CanvasTexture(screenCanvas);
  screenTexture.colorSpace = THREE.SRGBColorSpace;
  screenTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // Materials reused across rebuilds.
  const shellMaterial = new THREE.MeshStandardMaterial({
    color: 0x161a21,
    metalness: 0.95,
    roughness: 0.42,
    envMapIntensity: 1.15,
  });
  const screenMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x000000,
    emissive: 0xffffff,
    emissiveMap: screenTexture,
    emissiveIntensity: 1.25,
    roughness: 0.28,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.22,
  });
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: accent.clone(),
    emissive: accent.clone(),
    emissiveIntensity: 1.6,
    roughness: 0.4,
    metalness: 0.2,
  });

  let shellMesh: THREE.Mesh | null = null;
  let screenMesh: THREE.Mesh | null = null;
  const detailMeshes: THREE.Mesh[] = [];

  function disposeBuilt(): void {
    if (shellMesh) {
      group.remove(shellMesh);
      shellMesh.geometry.dispose();
      shellMesh = null;
    }
    if (screenMesh) {
      group.remove(screenMesh);
      screenMesh.geometry.dispose();
      screenMesh = null;
    }
    for (const d of detailMeshes) {
      group.remove(d);
      d.geometry.dispose();
    }
    detailMeshes.length = 0;
  }

  function buildCard(): void {
    disposeBuilt();
    const shell = horizontal ? LANDSCAPE_SHELL : PORTRAIT_SHELL;
    const canvasSize = horizontal ? LANDSCAPE_CANVAS : PORTRAIT_CANVAS;

    // Shell geometry: beveled extruded rounded rect = metal card with edges.
    const shape = roundedRectShape(shell.w, shell.h, Math.min(shell.w, shell.h) * 0.12);
    const shellGeo = new THREE.ExtrudeGeometry(shape, {
      depth: SHELL_DEPTH,
      bevelEnabled: true,
      bevelThickness: SHELL_BEVEL,
      bevelSize: SHELL_BEVEL,
      bevelSegments: 3,
      curveSegments: 16,
      steps: 1,
    });
    shellGeo.center();
    shellGeo.computeBoundingBox();
    const frontZ = shellGeo.boundingBox ? shellGeo.boundingBox.max.z : SHELL_DEPTH / 2;
    shellMesh = new THREE.Mesh(shellGeo, shellMaterial);
    group.add(shellMesh);

    // LCD canvas + screen plane (aspect matched to canvas to avoid stretch).
    screenCanvas.width = canvasSize.w;
    screenCanvas.height = canvasSize.h;
    const screenW = shell.w - Math.min(shell.w, shell.h) * 0.16;
    const screenH = screenW * (canvasSize.h / canvasSize.w);
    const screenGeo = new THREE.PlaneGeometry(screenW, screenH);
    screenMesh = new THREE.Mesh(screenGeo, screenMaterial);
    screenMesh.position.z = frontZ + 0.012;
    group.add(screenMesh);

    // Glowing accent tabs on the left/right edges.
    const tabGeo = new THREE.BoxGeometry(0.06, shell.h * 0.16, 0.05);
    for (const sx of [-1, 1]) {
      const tab = new THREE.Mesh(tabGeo.clone(), accentMaterial);
      tab.position.set((sx * shell.w) / 2, 0, frontZ - 0.02);
      group.add(tab);
      detailMeshes.push(tab);
    }
    tabGeo.dispose();

    // Vent ticks near a top corner for flavor.
    const tickGeo = new THREE.BoxGeometry(0.018, 0.12, 0.04);
    for (let i = 0; i < 3; i += 1) {
      const tick = new THREE.Mesh(tickGeo.clone(), accentMaterial);
      tick.position.set(shell.w / 2 - 0.18 - i * 0.05, shell.h / 2 - 0.22, frontZ + 0.005);
      group.add(tick);
      detailMeshes.push(tick);
    }
    tickGeo.dispose();

    fitCamera(shell.w, shell.h);
  }

  function fitCamera(shellW: number, shellH: number): void {
    const margin = 1.16;
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const distH = (shellH * margin) / 2 / Math.tan(vFov / 2);
    const distW = (shellW * margin) / 2 / Math.tan(vFov / 2) / camera.aspect;
    camera.position.set(0, 0, Math.max(distH, distW));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }

  // Post-processing: bloom for the neon edges + LCD glow.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.6, 0.6, 0.6);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  composer.setSize(width, height);

  buildCard();

  // Interaction state.
  let hovering = false;
  let targetRotX = reducedMotion ? 0.08 : 0;
  let targetRotY = reducedMotion ? -0.18 : 0;
  if (reducedMotion) {
    group.rotation.x = targetRotX;
    group.rotation.y = targetRotY;
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (reducedMotion) return;
    const rect = host.getBoundingClientRect();
    const nx = (event.clientX - rect.left) / rect.width - 0.5;
    const ny = (event.clientY - rect.top) / rect.height - 0.5;
    hovering = true;
    targetRotY = nx * 0.6;
    targetRotX = -ny * 0.4;
  };
  const onPointerLeave = (): void => {
    hovering = false;
  };
  if (!reducedMotion) {
    host.addEventListener("pointermove", onPointerMove);
    host.addEventListener("pointerleave", onPointerLeave);
  }

  const clock = new THREE.Clock();
  let raf = 0;
  let running = false;

  function renderFrame(): void {
    composer.render();
  }

  function animate(): void {
    raf = requestAnimationFrame(animate);
    const t = clock.getElapsedTime();
    const idle = !hovering;
    const desiredY = idle ? Math.sin(t * 0.6) * 0.13 : targetRotY;
    const desiredX = idle ? Math.cos(t * 0.5) * 0.07 : targetRotX;
    group.rotation.y += (desiredY - group.rotation.y) * 0.08;
    group.rotation.x += (desiredX - group.rotation.x) * 0.08;
    const desiredFloat = idle ? Math.sin(t * 0.8) * 0.03 : 0;
    group.position.y += (desiredFloat - group.position.y) * 0.08;

    bloom.strength += ((hovering ? 1.05 : 0.55) - bloom.strength) * 0.06;
    screenMaterial.emissiveIntensity +=
      ((hovering ? 1.7 : 1.25) - screenMaterial.emissiveIntensity) * 0.06;
    accentLight.intensity += ((hovering ? 9 : 6) - accentLight.intensity) * 0.06;

    renderFrame();
  }

  function start(): void {
    if (running) return;
    running = true;
    if (reducedMotion) {
      renderFrame();
      return;
    }
    clock.start();
    animate();
  }

  function stop(): void {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  // Pause rendering when off-screen.
  const intersection = new IntersectionObserver(
    (entries) => {
      const visible = entries.some((e) => e.isIntersecting);
      if (visible) start();
      else stop();
    },
    { threshold: 0.01 },
  );
  intersection.observe(host);

  const resizeObserver = new ResizeObserver(() => {
    const w = host.clientWidth || width;
    const h = host.clientHeight || height;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    bloom.resolution.set(w, h);
    camera.aspect = w / h;
    const shell = horizontal ? LANDSCAPE_SHELL : PORTRAIT_SHELL;
    fitCamera(shell.w, shell.h);
    if (reducedMotion) renderFrame();
  });
  resizeObserver.observe(host);

  start();

  return {
    screenCanvas,
    get horizontal() {
      return horizontal;
    },
    setOrientation(next: boolean): void {
      if (next === horizontal) return;
      horizontal = next;
      buildCard();
      if (reducedMotion) renderFrame();
    },
    setAccent(next: string): void {
      accent = new THREE.Color(next || "#6366f1");
      accentMaterial.color.copy(accent);
      accentMaterial.emissive.copy(accent);
      accentLight.color.copy(accent);
      if (reducedMotion) renderFrame();
    },
    refreshTexture(): void {
      screenTexture.needsUpdate = true;
      if (reducedMotion) renderFrame();
    },
    dispose(): void {
      stop();
      intersection.disconnect();
      resizeObserver.disconnect();
      if (!reducedMotion) {
        host.removeEventListener("pointermove", onPointerMove);
        host.removeEventListener("pointerleave", onPointerLeave);
      }
      disposeBuilt();
      shellMaterial.dispose();
      screenMaterial.dispose();
      accentMaterial.dispose();
      screenTexture.dispose();
      envRT.texture.dispose();
      pmrem.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (host.contains(renderer.domElement)) {
        host.removeChild(renderer.domElement);
      }
    },
  };
}
