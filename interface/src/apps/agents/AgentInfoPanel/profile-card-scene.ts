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

const PORTRAIT_CANVAS = { w: 700, h: 748 };
const LANDSCAPE_CANVAS = { w: 980, h: 600 };

const PORTRAIT_SHELL = { w: 2.0, h: 2.5 };
const LANDSCAPE_SHELL = { w: 2.74, h: 1.7 };

const SHELL_DEPTH = 0.12;
const SHELL_BEVEL = 0.03;

/**
 * Silhouette chamfers, in world units, so every diagonal is a true 45-degree cut
 * (equal horizontal + vertical delta). `SHELL_CHAMFER` is the consistent corner
 * size; the bottom-left uses the larger `SHELL_CHAMFER_BL` to match the art.
 */
const SHELL_CHAMFER = 0.16;
const SHELL_CHAMFER_BL = 0.46;
/** Right-edge step (45 deg) and inset left LED-slot notch, both in world units. */
const SHELL_RIGHT_STEP = 0.06;
const LED_SLOT_DEPTH = 0.05;

/** Inner LCD window box as fractions of the portrait shell (left,right,bottom,top). */
const WINDOW = { left: 0.105, right: 0.9, bottom: 0.16, top: 0.84 };

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

/**
 * Outer silhouette of the AURA card (portrait), traced from the reference art and
 * built in world units so every angled segment is a true 45-degree cut (equal dx
 * and dy). Consistent corner chamfers on three corners, a larger 45-degree
 * chamfer at the bottom-left, a 45-degree step on the right edge, and an inset
 * LED-slot notch on the left. Wound clockwise from the top-left.
 */
function auraOuterShape(w: number, h: number): THREE.Shape {
  const hw = w / 2;
  const hh = h / 2;
  const c = SHELL_CHAMFER;
  const cb = SHELL_CHAMFER_BL;
  const st = SHELL_RIGHT_STEP;
  const d = LED_SLOT_DEPTH;
  // Right-edge step and left LED-slot extents (world units, +y up).
  const yStepTop = -h * 0.05;
  const ySlotBot = -h * 0.016;
  const ySlotTop = h * 0.076;
  const s = new THREE.Shape();
  s.moveTo(-hw + c, hh); // top edge start (after top-left chamfer)
  s.lineTo(hw - c, hh); // top edge
  s.lineTo(hw, hh - c); // top-right 45 chamfer
  s.lineTo(hw, yStepTop); // right edge (full width)
  s.lineTo(hw - st, yStepTop - st); // 45 step-in
  s.lineTo(hw - st, -hh + c); // narrow right edge
  s.lineTo(hw - st - c, -hh); // bottom-right 45 chamfer
  s.lineTo(-hw + cb, -hh); // bottom edge
  s.lineTo(-hw, -hh + cb); // bottom-left large 45 chamfer
  s.lineTo(-hw, ySlotBot); // left edge up to slot
  s.lineTo(-hw + d, ySlotBot + d); // 45 LED-slot lead-in
  s.lineTo(-hw + d, ySlotTop - d); // slot inner edge
  s.lineTo(-hw, ySlotTop); // 45 LED-slot lead-out
  s.lineTo(-hw, hh - c); // left edge up
  s.lineTo(-hw + c, hh); // top-left 45 chamfer (close)
  return s;
}

/**
 * Inner screen window cut-out, mirroring the shell with true 45-degree corners:
 * consistent small chamfers on three corners and a larger one at the bottom-left.
 */
function auraWindowPath(w: number, h: number): THREE.Path {
  const hw = w / 2;
  const hh = h / 2;
  const wl = -hw + WINDOW.left * w;
  const wr = -hw + WINDOW.right * w;
  const wb = -hh + WINDOW.bottom * h;
  const wt = -hh + WINDOW.top * h;
  const wc = 0.1; // consistent 45 corner chamfer
  const wcb = 0.34; // larger bottom-left 45 chamfer
  const p = new THREE.Path();
  p.moveTo(wl + wc, wt); // top edge start (after top-left chamfer)
  p.lineTo(wr - wc, wt); // top edge
  p.lineTo(wr, wt - wc); // top-right 45 chamfer
  p.lineTo(wr, wb + wc); // right edge
  p.lineTo(wr - wc, wb); // bottom-right 45 chamfer
  p.lineTo(wl + wcb, wb); // bottom edge
  p.lineTo(wl, wb + wcb); // bottom-left large 45 chamfer
  p.lineTo(wl, wt - wc); // left edge
  p.lineTo(wl + wc, wt); // top-left 45 chamfer (close)
  return p;
}

/**
 * Subtle brushed-metal texture: a few soft low-frequency vertical streaks on a
 * solid base. Kept low-contrast and blurred so it reads as a finish rather than
 * noise (which the env-map reflections would otherwise amplify into speckle).
 */
function createBrushedMetalTexture(base: string, streak: string): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    ctx.filter = "blur(1.5px)";
    ctx.strokeStyle = streak;
    ctx.lineCap = "round";
    for (let i = 0; i < 180; i += 1) {
      const x = Math.random() * size;
      ctx.globalAlpha = 0.015 + Math.random() * 0.025;
      ctx.lineWidth = 1 + Math.random() * 2.5;
      ctx.beginPath();
      ctx.moveTo(x, -10);
      ctx.bezierCurveTo(
        x + (Math.random() * 20 - 10),
        size * 0.33,
        x + (Math.random() * 20 - 10),
        size * 0.66,
        x + (Math.random() * 20 - 10),
        size + 10,
      );
      ctx.stroke();
    }
    ctx.filter = "none";
    ctx.globalAlpha = 1;
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** "AURA" wordmark drawn with wide letter spacing onto a transparent texture. */
function createWordmarkTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 160;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#eaf3ff";
    ctx.textBaseline = "middle";
    ctx.font = `300 ${Math.round(h * 0.62)}px "JetBrains Mono", ui-monospace, monospace`;
    const letters = "AURA".split("");
    const spacing = h * 0.62;
    const widths = letters.map((c) => ctx.measureText(c).width);
    const total =
      widths.reduce((a, b) => a + b, 0) + spacing * (letters.length - 1);
    let x = (w - total) / 2;
    for (let i = 0; i < letters.length; i += 1) {
      ctx.fillText(letters[i], x, h / 2);
      x += widths[i] + spacing;
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
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
  renderer.toneMappingExposure = 1.0;
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
  const accentLight = new THREE.PointLight(accent.getHex(), 4, 12, 2);
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
    emissiveIntensity: 0.7,
    roughness: 0.4,
    metalness: 0.2,
  });

  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  // Layer 1 — blue brushed metal frame (the structural part of the card).
  const blueMetalTexture = createBrushedMetalTexture("#16263f", "#5a86c4");
  blueMetalTexture.anisotropy = maxAniso;
  blueMetalTexture.repeat.set(2, 2);
  const blueMetalMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a4a78,
    map: blueMetalTexture,
    metalness: 0.85,
    roughness: 0.42,
    envMapIntensity: 1.0,
  });
  // Layer 2 — softer matte black metal underlayer behind the frame.
  const matteTexture = createBrushedMetalTexture("#0a0c11", "#222a3a");
  matteTexture.anisotropy = maxAniso;
  matteTexture.repeat.set(2, 2);
  const matteMaterial = new THREE.MeshStandardMaterial({
    color: 0x0b0e13,
    map: matteTexture,
    metalness: 0.5,
    roughness: 0.85,
    envMapIntensity: 0.4,
  });
  // AURA wordmark decal.
  const wordmarkTexture = createWordmarkTexture();
  const wordmarkMaterial = new THREE.MeshBasicMaterial({
    map: wordmarkTexture,
    transparent: true,
    depthWrite: false,
  });

  let shellMesh: THREE.Mesh | null = null;
  let underlayerMesh: THREE.Mesh | null = null;
  let screenMesh: THREE.Mesh | null = null;
  const detailMeshes: THREE.Mesh[] = [];

  function disposeBuilt(): void {
    if (shellMesh) {
      group.remove(shellMesh);
      shellMesh.geometry.dispose();
      shellMesh = null;
    }
    if (underlayerMesh) {
      group.remove(underlayerMesh);
      underlayerMesh.geometry.dispose();
      underlayerMesh = null;
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
    if (horizontal) {
      buildLandscape();
    } else {
      buildPortrait();
    }
  }

  /**
   * Portrait card built as three depth-separated layers: a blue brushed-metal
   * frame (with the screen window cut out), a softer matte-black underlayer that
   * peeks through the silhouette notches, and the emissive LCD plane.
   */
  function buildPortrait(): void {
    const shell = PORTRAIT_SHELL;
    const canvasSize = PORTRAIT_CANVAS;

    // Metal frame: silhouette extruded with the screen window as a hole.
    const outer = auraOuterShape(shell.w, shell.h);
    outer.holes.push(auraWindowPath(shell.w, shell.h));
    const frameGeo = new THREE.ExtrudeGeometry(outer, {
      depth: SHELL_DEPTH,
      bevelEnabled: true,
      bevelThickness: SHELL_BEVEL,
      bevelSize: SHELL_BEVEL,
      bevelSegments: 4,
      curveSegments: 32,
      steps: 1,
    });
    frameGeo.center();
    frameGeo.computeBoundingBox();
    const frontZ = frameGeo.boundingBox ? frameGeo.boundingBox.max.z : SHELL_DEPTH / 2;
    shellMesh = new THREE.Mesh(frameGeo, blueMetalMaterial);
    group.add(shellMesh);

    // Underlayer: full silhouette (no hole), pushed back and scaled slightly so
    // it shows through the LED slot, the chamfers and behind the LCD window.
    const underGeo = new THREE.ExtrudeGeometry(auraOuterShape(shell.w, shell.h), {
      depth: SHELL_DEPTH * 0.8,
      bevelEnabled: true,
      bevelThickness: SHELL_BEVEL,
      bevelSize: SHELL_BEVEL,
      bevelSegments: 2,
      curveSegments: 16,
      steps: 1,
    });
    underGeo.center();
    underlayerMesh = new THREE.Mesh(underGeo, matteMaterial);
    underlayerMesh.scale.set(1.03, 1.025, 1);
    underlayerMesh.position.z = -SHELL_DEPTH * 0.55;
    group.add(underlayerMesh);

    // LCD plane sits inside the window, recessed just behind the metal front so
    // the frame stands proud and the chamfered hole clips the screen corner.
    screenCanvas.width = canvasSize.w;
    screenCanvas.height = canvasSize.h;
    const screenW = (WINDOW.right - WINDOW.left) * shell.w;
    const screenH = (WINDOW.top - WINDOW.bottom) * shell.h;
    const screenGeo = new THREE.PlaneGeometry(screenW, screenH);
    screenMesh = new THREE.Mesh(screenGeo, screenMaterial);
    screenMesh.position.z = frontZ - 0.018;
    group.add(screenMesh);

    // AURA wordmark, top-left on the metal frame.
    const markW = shell.w * 0.32;
    const markH = markW * (160 / 512);
    const markMesh = new THREE.Mesh(new THREE.PlaneGeometry(markW, markH), wordmarkMaterial);
    markMesh.position.set(
      -shell.w / 2 + markW * 0.62,
      shell.h / 2 - markH * 1.1,
      frontZ + 0.006,
    );
    group.add(markMesh);
    detailMeshes.push(markMesh);

    // Vent slashes, top-right (dark angled inlays).
    const slashGeo = new THREE.BoxGeometry(0.02, 0.12, 0.03);
    for (let i = 0; i < 3; i += 1) {
      const slash = new THREE.Mesh(slashGeo.clone(), matteMaterial);
      slash.position.set(shell.w / 2 - 0.14 - i * 0.07, shell.h / 2 - 0.16, frontZ + 0.004);
      slash.rotation.z = 0.5;
      group.add(slash);
      detailMeshes.push(slash);
    }
    slashGeo.dispose();

    // LED clusters: three on the left slot, three on the bottom-right panel.
    const ledGeo = new THREE.SphereGeometry(0.019, 16, 16);
    const ledColumns: Array<{ x: number; cy: number }> = [
      { x: -shell.w / 2 + shell.w * 0.038, cy: shell.h * 0.03 },
      { x: shell.w / 2 - shell.w * 0.05, cy: -shell.h * 0.38 },
    ];
    for (const col of ledColumns) {
      for (let i = 0; i < 3; i += 1) {
        const led = new THREE.Mesh(ledGeo.clone(), accentMaterial);
        led.position.set(col.x, col.cy + (1 - i) * 0.09, frontZ + 0.008);
        group.add(led);
        detailMeshes.push(led);
      }
    }
    ledGeo.dispose();

    fitCamera(shell.w, shell.h);
  }

  function buildLandscape(): void {
    const shell = LANDSCAPE_SHELL;
    const canvasSize = LANDSCAPE_CANVAS;

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

  // Post-processing: bloom for the neon edges + LCD glow. The composer renders
  // into an explicit multisampled (MSAA) + HDR target so silhouette edges stay
  // crisp (the renderer's own antialias is bypassed once a composer is used).
  const bufferSize = renderer.getDrawingBufferSize(new THREE.Vector2());
  const renderTarget = new THREE.WebGLRenderTarget(bufferSize.x, bufferSize.y, {
    type: THREE.HalfFloatType,
    samples: 4,
  });
  const composer = new EffectComposer(renderer, renderTarget);
  composer.addPass(new RenderPass(scene, camera));
  // Gentler bloom (lower strength, tighter radius, higher threshold) so only the
  // brightest neon blooms — no haze, halos or doubled text.
  const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.26, 0.4, 0.85);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  composer.setSize(width, height);

  buildCard();

  // Interaction state. Reduced motion only removes autonomous animation; the
  // card stays interactive on hover (user-initiated), just gentler.
  const tiltScale = reducedMotion ? 0.45 : 1;
  const idleAmp = reducedMotion ? 0 : 1;
  let hovering = false;
  let targetRotX = 0;
  let targetRotY = 0;

  const onPointerMove = (event: PointerEvent): void => {
    const rect = host.getBoundingClientRect();
    const nx = (event.clientX - rect.left) / rect.width - 0.5;
    const ny = (event.clientY - rect.top) / rect.height - 0.5;
    hovering = true;
    targetRotY = nx * 0.6 * tiltScale;
    targetRotX = -ny * 0.4 * tiltScale;
    // Never let interaction be dead if the loop was paused.
    if (!running) start();
  };
  const onPointerLeave = (): void => {
    hovering = false;
  };
  host.addEventListener("pointermove", onPointerMove);
  host.addEventListener("pointerleave", onPointerLeave);

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
    const desiredY = idle ? Math.sin(t * 0.6) * 0.13 * idleAmp : targetRotY;
    const desiredX = idle ? Math.cos(t * 0.5) * 0.07 * idleAmp : targetRotX;
    group.rotation.y += (desiredY - group.rotation.y) * 0.08;
    group.rotation.x += (desiredX - group.rotation.x) * 0.08;
    const desiredFloat = idle ? Math.sin(t * 0.8) * 0.03 * idleAmp : 0;
    group.position.y += (desiredFloat - group.position.y) * 0.08;

    bloom.strength += ((hovering ? 0.32 : 0.26) - bloom.strength) * 0.06;
    screenMaterial.emissiveIntensity +=
      ((hovering ? 1.3 : 1.15) - screenMaterial.emissiveIntensity) * 0.06;
    accentLight.intensity += ((hovering ? 4.5 : 3.5) - accentLight.intensity) * 0.06;

    renderFrame();
  }

  function start(): void {
    if (running) return;
    running = true;
    clock.start();
    animate();
  }

  function stop(): void {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  // Pause only while the tab is backgrounded. (A previous IntersectionObserver
  // pause could permanently freeze a visible card on a spurious first report.)
  const onVisibilityChange = (): void => {
    if (document.hidden) stop();
    else start();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

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
      document.removeEventListener("visibilitychange", onVisibilityChange);
      resizeObserver.disconnect();
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerleave", onPointerLeave);
      disposeBuilt();
      shellMaterial.dispose();
      screenMaterial.dispose();
      accentMaterial.dispose();
      blueMetalMaterial.dispose();
      matteMaterial.dispose();
      wordmarkMaterial.dispose();
      blueMetalTexture.dispose();
      matteTexture.dispose();
      wordmarkTexture.dispose();
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
