import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

export interface ProfileCardSceneOptions {
  accent: string;
  /** CSS color for the LCD scan lines (read from `--color-card-line`). */
  lineColor?: string;
  reducedMotion: boolean;
}

export interface ProfileCardScene {
  /** Offscreen canvas the LCD texture is drawn into by the caller. */
  readonly screenCanvas: HTMLCanvasElement;
  /** Offscreen canvas the agent info strip is drawn into by the renderer. */
  readonly infoCanvas: HTMLCanvasElement;
  setAccent(accent: string): void;
  /** Update the LCD scan-line color (independent of the accent). */
  setLineColor(color: string): void;
  /** Mark the LCD texture dirty after redrawing into `screenCanvas`. */
  refreshTexture(): void;
  /**
   * Register the function that redraws the info strip into `infoCanvas`. It is
   * called immediately and again on every blink toggle (with `dotOn` flipped)
   * so the status dot can pulse without the caller driving the animation.
   */
  setInfoRenderer(render: (dotOn: boolean) => void): void;
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

const PORTRAIT_SHELL = { w: 2.0, h: 2.5 };

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
const WINDOW = { left: 0.07, right: 0.935, bottom: 0.056, top: 0.875 };

/**
 * Worn-metal info backplate that sits behind the card and pokes out below it as
 * a strip where agent info is later printed. Width is 90% of the card so its
 * sides stay tucked behind the card; it overlaps the card's lower portion and
 * extends below the bottom edge (card bottom is at `y = -PORTRAIT_SHELL.h / 2`).
 * All values in world units.
 */
const INFO_PLATE = {
  w: PORTRAIT_SHELL.w * 0.9, // 1.8
  top: -0.9, // tucked ~0.35 behind the card's lower area
  bottom: -2.3, // exposed strip extends ~1.05 below the card's bottom edge
  depth: 0.1,
  bevel: 0.02,
  chamfer: 0.1, // 45-degree corner cuts, echoing the card silhouette
  z: -0.16, // front face sits just behind the card back (~ -0.09)
};

/**
 * Text region on the exposed (below-the-card) part of the backplate where the
 * agent info readout is drawn (a transparent canvas mapped onto a plane just in
 * front of the plate). Inset from the plate edges; `canvasW` sets the texture
 * resolution and the canvas height is derived from the region's aspect ratio.
 */
const INFO_TEXT = {
  w: 1.62,
  top: -1.3,
  bottom: -2.22,
  canvasW: 720,
};

/**
 * Outer silhouette of the AURA card (portrait), traced from the reference art and
 * built in world units so every angled segment is a true 45-degree cut (equal dx
 * and dy). Consistent corner chamfers on the top corners, a larger 45-degree
 * chamfer at the bottom-left, a square 90-degree bottom-right corner, a 45-degree
 * step on the right edge, and an inset LED-slot notch on the left. Wound clockwise
 * from the top-left.
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
  const ySlotBot = -h * 0.108;
  const ySlotTop = h * 0.168;
  const s = new THREE.Shape();
  s.moveTo(-hw + c, hh); // top edge start (after top-left chamfer)
  s.lineTo(hw - c, hh); // top edge
  s.lineTo(hw, hh - c); // top-right 45 chamfer
  s.lineTo(hw, yStepTop); // right edge (full width)
  s.lineTo(hw - st, yStepTop - st); // 45 step-in
  s.lineTo(hw - st, -hh); // narrow right edge down to square 90 corner
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
 * Inner screen window cut-out, mirroring the shell: 45-degree chamfers on the top
 * corners, a larger 45-degree chamfer at the bottom-left, a 45-degree cut at the
 * bottom-right, and a stepped bottom edge (deeper left, raised right, joined by a
 * 45-degree diagonal).
 */
function auraWindowPath(w: number, h: number): THREE.Path {
  const hw = w / 2;
  const hh = h / 2;
  const wl = -hw + WINDOW.left * w;
  const wr = -hw + WINDOW.right * w;
  const wb = -hh + WINDOW.bottom * h;
  const wt = -hh + WINDOW.top * h;
  const wc = 0.1; // consistent 45 corner chamfer
  const wcb = SHELL_CHAMFER_BL; // bottom-left 45 chamfer, matching the outer shell cut
  // Stepped bottom: a deeper left portion and a raised right portion joined by a
  // 45 diagonal. `wbR` is the raised right level, `xStep` where the step sits.
  const stepH = 0.08;
  const wcbr = stepH; // bottom-right 45 cut, same size + angle as the middle step
  const wbR = wb + stepH;
  const xStep = wl + (wr - wl) * 0.6;
  const p = new THREE.Path();
  p.moveTo(wl + wc, wt); // top edge start (after top-left chamfer)
  p.lineTo(wr - wc, wt); // top edge
  p.lineTo(wr, wt - wc); // top-right 45 chamfer
  p.lineTo(wr, wbR + wcbr); // right edge down to bottom-right chamfer
  p.lineTo(wr - wcbr, wbR); // bottom-right 45 cut
  p.lineTo(xStep, wbR); // raised bottom edge (right portion)
  p.lineTo(xStep - stepH, wb); // 45 step down to the deeper left level
  p.lineTo(wl + wcb, wb); // deeper bottom edge (left portion)
  p.lineTo(wl, wb + wcb); // bottom-left large 45 chamfer
  p.lineTo(wl, wt - wc); // left edge
  p.lineTo(wl + wc, wt); // top-left 45 chamfer (close)
  return p;
}

/**
 * Solid version of `auraWindowPath` (same outline, local window-centered coords)
 * used for the LCD plane itself so the photo is clipped to the chamfered/stepped
 * window silhouette and never spills past the frame (e.g. the bottom-left
 * chamfer). UVs are remapped to 0..1 over the bounding box to match the texture.
 */
function auraWindowOutline(w: number, h: number): THREE.Shape {
  const hw = w / 2;
  const hh = h / 2;
  const wl = -hw;
  const wr = hw;
  const wb = -hh;
  const wt = hh;
  const wc = 0.1;
  const wcb = SHELL_CHAMFER_BL;
  const stepH = 0.08;
  const wcbr = stepH; // bottom-right 45 cut, same size + angle as the middle step
  const wbR = wb + stepH;
  const xStep = wl + (wr - wl) * 0.6;
  const s = new THREE.Shape();
  s.moveTo(wl + wc, wt);
  s.lineTo(wr - wc, wt);
  s.lineTo(wr, wt - wc);
  s.lineTo(wr, wbR + wcbr);
  s.lineTo(wr - wcbr, wbR);
  s.lineTo(xStep, wbR);
  s.lineTo(xStep - stepH, wb);
  s.lineTo(wl + wcb, wb);
  s.lineTo(wl, wb + wcb);
  s.lineTo(wl, wt - wc);
  s.lineTo(wl + wc, wt);
  return s;
}

function auraWindowShape(w: number, h: number): THREE.ShapeGeometry {
  const hw = w / 2;
  const hh = h / 2;
  const s = auraWindowOutline(w, h);
  const geo = new THREE.ShapeGeometry(s);
  // ShapeGeometry UVs are raw vertex coords; remap to 0..1 over the box so the
  // emissive photo maps exactly as a PlaneGeometry would.
  const positions = geo.attributes.position;
  const uv = new Float32Array(positions.count * 2);
  for (let i = 0; i < positions.count; i += 1) {
    uv[i * 2] = (positions.getX(i) + hw) / w;
    uv[i * 2 + 1] = (positions.getY(i) + hh) / h;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geo;
}

/**
 * Worn-metal info backplate silhouette (centered on the origin): 45-degree
 * chamfers on the top corners (which tuck behind the card) and rounded corners
 * on the bottom two, where the plate pokes out below the card.
 */
function plateShape(w: number, h: number, c: number): THREE.Shape {
  const hw = w / 2;
  const hh = h / 2;
  const s = new THREE.Shape();
  s.moveTo(-hw + c, hh);
  s.lineTo(hw - c, hh);
  s.lineTo(hw, hh - c); // top-right 45 chamfer
  s.lineTo(hw, -hh + c); // right edge down
  s.quadraticCurveTo(hw, -hh, hw - c, -hh); // bottom-right rounded corner
  s.lineTo(-hw + c, -hh); // bottom edge
  s.quadraticCurveTo(-hw, -hh, -hw, -hh + c); // bottom-left rounded corner
  s.lineTo(-hw, hh - c); // left edge up
  s.lineTo(-hw + c, hh); // top-left 45 chamfer (close)
  return s;
}

/**
 * Bakes edge wear into a vertex `color` attribute: faces whose normal points
 * mostly sideways (the extruded bevel + side walls, i.e. `|normal.z|` below
 * `threshold`) are tinted toward bare worn steel so the raised 45-degree edges
 * read as rubbed/exposed, while flat front/back faces stay neutral (1,1,1 — a
 * no-op against the material albedo). Relies on `vertexColors: true`.
 */
const EDGE_WEAR_COLOR = new THREE.Color(0xb9c4d4);
function applyEdgeWear(geo: THREE.BufferGeometry, threshold = 0.6): void {
  const normals = geo.attributes.normal;
  if (!normals) {
    geo.computeVertexNormals();
  }
  const nrm = geo.attributes.normal;
  const count = nrm.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const nz = Math.abs(nrm.getZ(i));
    if (nz < threshold) {
      // Ramp the wear in as the face turns more side-on.
      const t = Math.min(1, (threshold - nz) / threshold);
      colors[i * 3] = 1 + (EDGE_WEAR_COLOR.r - 1) * t;
      colors[i * 3 + 1] = 1 + (EDGE_WEAR_COLOR.g - 1) * t;
      colors[i * 3 + 2] = 1 + (EDGE_WEAR_COLOR.b - 1) * t;
    } else {
      colors[i * 3] = 1;
      colors[i * 3 + 1] = 1;
      colors[i * 3 + 2] = 1;
    }
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
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

/** Worn-metal detail tuning. Bumped up here so the wear is easy to dial in. */
const WEAR_SCRATCHES = 320;
const WEAR_SCUFFS = 26;

/**
 * Procedural wear/grunge detail: fine scratches at varied angles plus soft scuff
 * blotches on a neutral mid-grey base. Returned as a linear (data) texture so it
 * can drive `bumpMap`/`roughnessMap` without sRGB decoding skewing the values.
 * Mid-grey (128) is the neutral point: brighter pixels read as raised/rougher,
 * darker as recessed/smoother. The pattern is deterministic so it stays stable
 * across rebuilds.
 */
function createWearTexture(): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    let seed = 7;
    const rand = (): number => {
      const s = Math.sin(seed++ * 12.9898) * 43758.5453;
      return s - Math.floor(s);
    };
    // Neutral base.
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, size, size);

    // Soft scuff blotches (low-frequency roughness variation), denser near edges.
    for (let i = 0; i < WEAR_SCUFFS; i += 1) {
      const edgeBias = rand() < 0.6;
      const cx = edgeBias
        ? rand() < 0.5
          ? rand() * size * 0.18
          : size - rand() * size * 0.18
        : rand() * size;
      const cy = edgeBias
        ? rand() < 0.5
          ? rand() * size * 0.18
          : size - rand() * size * 0.18
        : rand() * size;
      const r = size * (0.04 + rand() * 0.12);
      const light = rand() > 0.5;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      const tone = light ? "180,180,180" : "70,70,70";
      grad.addColorStop(0, `rgba(${tone},${0.1 + rand() * 0.12})`);
      grad.addColorStop(1, "rgba(128,128,128,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Fine scratches: short strokes at random angles, mixing light and dark.
    ctx.lineCap = "round";
    for (let i = 0; i < WEAR_SCRATCHES; i += 1) {
      const x = rand() * size;
      const y = rand() * size;
      const angle = rand() * Math.PI * 2;
      const len = 8 + rand() * 90;
      const light = rand() > 0.5;
      ctx.strokeStyle = light ? "#c8c8c8" : "#3c3c3c";
      ctx.globalAlpha = 0.05 + rand() * 0.18;
      ctx.lineWidth = 0.5 + rand() * 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/**
 * Fake barcode: vertical bars of varying widths on a transparent background,
 * drawn in white so the material `color` + `opacity` can tint it to a subtle,
 * slightly-lighter-than-metal tone (etched/printed look). The bar pattern is
 * deterministic so it stays stable across rebuilds.
 */
function createBarcodeTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 132;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#ffffff";
    let seed = 1;
    const rand = (): number => {
      const s = Math.sin(seed++ * 12.9898) * 43758.5453;
      return s - Math.floor(s);
    };
    const margin = 10;
    const top = 8;
    const barH = h - top * 2;
    let x = margin;
    while (x < w - margin) {
      const barW = 2 + Math.floor(rand() * 6);
      const gap = 2 + Math.floor(rand() * 5);
      ctx.globalAlpha = 0.75 + rand() * 0.25;
      ctx.fillRect(x, top, barW, barH);
      x += barW + gap;
    }
    ctx.globalAlpha = 1;
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Intrinsic aspect ratio (w/h) of the AURA wordmark PNG used as a fallback. */
const WORDMARK_SRC = "/AURA_logo_text_mark.png";
const WORDMARK_ASPECT = 3322 / 421;

/** Fallback LCD scan-line color (matches the `--color-card-line` token default). */
const CARD_LINE_COLOR = "#cfe8ff";

export function createProfileCardScene(
  host: HTMLElement,
  options: ProfileCardSceneOptions,
): ProfileCardScene {
  let accent = new THREE.Color(options.accent || "#6366f1");
  let lineColor = new THREE.Color(options.lineColor || CARD_LINE_COLOR);
  const reducedMotion = options.reducedMotion;

  const width = host.clientWidth || 320;
  const height = host.clientHeight || 420;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  // Keep the canvas transparent so the themed backdrop painted by CSS behind
  // the host (`--color-sidekick-bg`) shows through and the dark card floats on
  // the surrounding panel. The bloom blend is patched below to preserve this
  // transparency (it otherwise forces the whole canvas opaque).
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

  // Agent info strip: a transparent canvas mapped onto a plane over the exposed
  // part of the backplate. Drawn by an externally-supplied renderer; the status
  // dot blinks via `infoDotOn` toggling in the animation loop.
  const infoCanvas = document.createElement("canvas");
  infoCanvas.width = INFO_TEXT.canvasW;
  infoCanvas.height = Math.round(
    (INFO_TEXT.canvasW * (INFO_TEXT.top - INFO_TEXT.bottom)) / INFO_TEXT.w,
  );
  const infoTexture = new THREE.CanvasTexture(infoCanvas);
  infoTexture.colorSpace = THREE.SRGBColorSpace;
  infoTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const infoMaterial = new THREE.MeshBasicMaterial({
    map: infoTexture,
    transparent: true,
    depthWrite: false,
  });
  let infoRenderer: ((dotOn: boolean) => void) | null = null;
  let infoDotOn = true;

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
  // Dark recessed bezel forming the pocket walls + rim the LCD sits inside, so
  // the screen reads as inset into the metal. Matte + near-black so it stays in
  // shadow and doesn't catch env reflections or bloom.
  const bezelMaterial = new THREE.MeshStandardMaterial({
    color: 0x05070a,
    metalness: 0.1,
    roughness: 0.92,
    envMapIntensity: 0.15,
  });

  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  // Shared worn-metal detail map (scratches + scuffs) reused as bump + roughness
  // so the frame catches light along fine scratches and worn patches.
  const wearTexture = createWearTexture();
  wearTexture.anisotropy = maxAniso;
  wearTexture.repeat.set(3, 3);
  // Layer 1 — blue brushed metal frame (the structural part of the card).
  const blueMetalTexture = createBrushedMetalTexture("#16263f", "#5a86c4");
  blueMetalTexture.anisotropy = maxAniso;
  blueMetalTexture.repeat.set(2, 2);
  const blueMetalMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a4a78,
    map: blueMetalTexture,
    bumpMap: wearTexture,
    bumpScale: 0.018,
    roughnessMap: wearTexture,
    metalness: 0.85,
    roughness: 0.52,
    envMapIntensity: 0.9,
    vertexColors: true,
  });
  // Layer 2 — softer matte black metal underlayer behind the frame.
  const matteTexture = createBrushedMetalTexture("#0a0c11", "#222a3a");
  matteTexture.anisotropy = maxAniso;
  matteTexture.repeat.set(2, 2);
  const matteMaterial = new THREE.MeshStandardMaterial({
    color: 0x0b0e13,
    map: matteTexture,
    bumpMap: wearTexture,
    bumpScale: 0.012,
    metalness: 0.5,
    roughness: 0.85,
    envMapIntensity: 0.4,
  });
  // Info backplate — gray brushed metal with a heavier worn finish. Its own wear
  // texture (coarser repeat) + a stronger bump make it read as more rubbed/scuffed
  // than the card frame.
  const plateMetalTexture = createBrushedMetalTexture("#3c3f45", "#7c8088");
  plateMetalTexture.anisotropy = maxAniso;
  plateMetalTexture.repeat.set(2, 2);
  const plateWearTexture = createWearTexture();
  plateWearTexture.anisotropy = maxAniso;
  plateWearTexture.repeat.set(2.5, 2.5);
  const plateMaterial = new THREE.MeshStandardMaterial({
    color: 0x4a4d52,
    map: plateMetalTexture,
    bumpMap: plateWearTexture,
    bumpScale: 0.03,
    roughnessMap: plateWearTexture,
    metalness: 0.8,
    roughness: 0.7,
    envMapIntensity: 0.7,
    vertexColors: true,
  });
  // Fake barcode decal — white bars tinted to a medium grey and kept low-contrast
  // via opacity so it reads as etched/printed.
  const barcodeTexture = createBarcodeTexture();
  const barcodeMaterial = new THREE.MeshBasicMaterial({
    map: barcodeTexture,
    color: 0x9a9a9a,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  // AURA wordmark decal — the app's actual wordmark PNG, tinted cool white.
  let wordmarkMesh: THREE.Mesh | null = null;
  let wordmarkWidth = 0;
  let wordmarkAspect = WORDMARK_ASPECT;
  const wordmarkTexture = new THREE.TextureLoader().load(WORDMARK_SRC, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    const img = tex.image as { width?: number; height?: number } | undefined;
    if (img?.width && img?.height) {
      wordmarkAspect = img.width / img.height;
      if (wordmarkMesh && wordmarkWidth > 0) {
        wordmarkMesh.geometry.dispose();
        wordmarkMesh.geometry = new THREE.PlaneGeometry(
          wordmarkWidth,
          wordmarkWidth / wordmarkAspect,
        );
      }
    }
    if (reducedMotion) renderFrame();
  });
  wordmarkTexture.colorSpace = THREE.SRGBColorSpace;
  const wordmarkMaterial = new THREE.MeshBasicMaterial({
    map: wordmarkTexture,
    color: 0xeaf3ff,
    transparent: true,
    depthWrite: false,
  });
  // Horizontal scan-line overlay floating in front of the LCD (additive accent).
  // Each line spans the full width but its per-vertex intensity ramps from bright
  // at the outer edges down to ~0 in the center, so the lines fade to transparent
  // over the portrait. `color` carries the accent and is multiplied by the
  // grayscale vertex-color ramp. Two layers: a brighter core plus a dimmer,
  // offset "halo" that feeds the bloom pass for the CRT/LCD glow.
  const lineCoreOpacity = 0.24;
  const lineHaloOpacity = 0.08;
  const lineMaterial = new THREE.LineBasicMaterial({
    color: lineColor.clone(),
    vertexColors: true,
    transparent: true,
    opacity: lineCoreOpacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const lineHaloMaterial = new THREE.LineBasicMaterial({
    color: lineColor.clone(),
    vertexColors: true,
    transparent: true,
    opacity: lineHaloOpacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  let infoPlateMesh: THREE.Mesh | null = null;
  let infoMesh: THREE.Mesh | null = null;
  let shellMesh: THREE.Mesh | null = null;
  let underlayerMesh: THREE.Mesh | null = null;
  let bezelMesh: THREE.Mesh | null = null;
  let barcodeMesh: THREE.Mesh | null = null;
  let screenMesh: THREE.Mesh | null = null;
  let screenLinesMesh: THREE.LineSegments | null = null;
  let screenLinesHaloMesh: THREE.LineSegments | null = null;
  const detailMeshes: THREE.Mesh[] = [];

  /**
   * Build the scan-line readout: each row spans the full screen width but is
   * subdivided so a per-vertex grayscale ramp can drive its intensity from
   * bright at the outer edges down to ~0 in the center (additive blending turns
   * the dim center transparent over the portrait). A deterministic per-row
   * brightness jitter (stable across rebuilds, not Math.random) keeps it from
   * looking uniform. A dimmer offset copy feeds bloom for the CRT/LCD glow.
   */
  function addScreenLines(
    screenW: number,
    screenH: number,
    cx: number,
    cy: number,
    z: number,
    overscan = 1,
  ): void {
    const spacing = screenH / 56;
    const half = screenW / 2;
    const halfH = screenH / 2;
    // Overscan the line field so the ends tuck under the metal frame (which is
    // in front and occludes them) instead of stopping short and leaving a dark
    // bezel gap. The ramp still peaks at the true (visible) window edge. Only
    // portrait recesses the lines behind the frame, so callers opt in.
    const drawHalf = half * overscan;
    const drawHalfH = halfH * overscan;
    const segments = 36;
    // Deterministic 0..1 hash for a row index (stable across rebuilds).
    const hash = (n: number): number => {
      const s = Math.sin(n * 12.9898) * 43758.5453;
      return s - Math.floor(s);
    };
    // Edge-to-center intensity ramp: 1 at (and beyond) the outer edge, ~0 across
    // the center, so lines fade to transparent over the portrait. `fade` is the
    // transparent center half-width (fraction of `half`); the lines only start
    // ramping up beyond it, widening the faint middle band by ~50% vs the old
    // implicit knee (~0.4).
    const fade = 0.6;
    const rampAt = (x: number): number => {
      const d = Math.min(1, Math.abs(x) / half);
      const u = Math.max(0, (d - fade) / (1 - fade));
      return Math.pow(u, 3.2);
    };
    // Crop each row's left end along the window's large bottom-left 45-degree
    // chamfer (matches `auraWindowPath`'s `wcb`), so the overscanned field
    // doesn't spill past the frame silhouette into the background there.
    const wcb = 0.34;
    const bottom = -halfH;
    const left = -half;
    const pos: number[] = [];
    const col: number[] = [];
    let row = 0;
    for (let y = -drawHalfH; y <= drawHalfH + 1e-4; y += spacing) {
      const rowGain = 0.4 + hash(row) * 1.05;
      let x0 = -drawHalf;
      if (y < bottom + wcb) {
        // Diagonal from (left + wcb, bottom) up to (left, bottom + wcb).
        x0 = Math.max(x0, left + wcb - (y - bottom));
      }
      const x1 = drawHalf;
      if (x1 <= x0) {
        row += 1;
        continue;
      }
      const span = x1 - x0;
      let prevX = x0;
      for (let i = 1; i <= segments; i += 1) {
        const x = x0 + (span * i) / segments;
        const i0 = rampAt(prevX) * rowGain;
        const i1 = rampAt(x) * rowGain;
        pos.push(prevX, y, 0, x, y, 0);
        col.push(i0, i0, i0, i1, i1, i1);
        prevX = x;
      }
      row += 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    screenLinesMesh = new THREE.LineSegments(geo, lineMaterial);
    screenLinesMesh.position.set(cx, cy, z);
    group.add(screenLinesMesh);

    // Halo copy, nudged slightly forward, that the bloom pass spreads into glow.
    screenLinesHaloMesh = new THREE.LineSegments(geo, lineHaloMaterial);
    screenLinesHaloMesh.position.set(cx, cy, z + 0.004);
    group.add(screenLinesHaloMesh);
  }

  function disposeBuilt(): void {
    if (infoPlateMesh) {
      group.remove(infoPlateMesh);
      infoPlateMesh.geometry.dispose();
      infoPlateMesh = null;
    }
    if (infoMesh) {
      group.remove(infoMesh);
      infoMesh.geometry.dispose();
      infoMesh = null;
    }
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
    if (bezelMesh) {
      group.remove(bezelMesh);
      bezelMesh.geometry.dispose();
      bezelMesh = null;
    }
    if (barcodeMesh) {
      group.remove(barcodeMesh);
      barcodeMesh.geometry.dispose();
      barcodeMesh = null;
    }
    if (screenMesh) {
      group.remove(screenMesh);
      screenMesh.geometry.dispose();
      screenMesh = null;
    }
    if (screenLinesMesh) {
      group.remove(screenLinesMesh);
      screenLinesMesh.geometry.dispose();
      screenLinesMesh = null;
    }
    if (screenLinesHaloMesh) {
      // Geometry is shared with screenLinesMesh (disposed above).
      group.remove(screenLinesHaloMesh);
      screenLinesHaloMesh = null;
    }
    for (const d of detailMeshes) {
      group.remove(d);
      d.geometry.dispose();
    }
    detailMeshes.length = 0;
    wordmarkMesh = null;
  }

  function buildCard(): void {
    disposeBuilt();
    buildPortrait();
  }

  /**
   * Portrait card built as three depth-separated layers: a blue brushed-metal
   * frame (with the screen window cut out), a softer matte-black underlayer that
   * peeks through the silhouette notches, and the emissive LCD plane.
   */
  function buildPortrait(): void {
    const shell = PORTRAIT_SHELL;
    const canvasSize = PORTRAIT_CANVAS;

    // Info backplate: a worn gray metal plate behind the card, narrower than the
    // card so its sides stay hidden, extending below the card's bottom edge as a
    // visible strip for agent info. Built first so it sits at the back.
    const plateH = INFO_PLATE.top - INFO_PLATE.bottom;
    const plateGeo = new THREE.ExtrudeGeometry(
      plateShape(INFO_PLATE.w, plateH, INFO_PLATE.chamfer),
      {
        depth: INFO_PLATE.depth,
        bevelEnabled: true,
        bevelThickness: INFO_PLATE.bevel,
        bevelSize: INFO_PLATE.bevel,
        bevelSegments: 2,
        curveSegments: 12,
        steps: 1,
      },
    );
    plateGeo.center();
    applyEdgeWear(plateGeo);
    infoPlateMesh = new THREE.Mesh(plateGeo, plateMaterial);
    infoPlateMesh.position.set(0, (INFO_PLATE.top + INFO_PLATE.bottom) / 2, INFO_PLATE.z);
    group.add(infoPlateMesh);

    // Agent info readout plane, just in front of the plate's front face (the
    // plate front sits at ~ INFO_PLATE.z + depth/2 + bevel).
    const infoH = INFO_TEXT.top - INFO_TEXT.bottom;
    const infoFrontZ = INFO_PLATE.z + INFO_PLATE.depth / 2 + INFO_PLATE.bevel + 0.015;
    infoMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(INFO_TEXT.w, infoH),
      infoMaterial,
    );
    infoMesh.position.set(0, (INFO_TEXT.top + INFO_TEXT.bottom) / 2, infoFrontZ);
    group.add(infoMesh);

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
    applyEdgeWear(frameGeo);
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
    // Window center (the box is not symmetric about the origin).
    const winCx = shell.w * ((WINDOW.left + WINDOW.right) / 2 - 0.5);
    const winCy = shell.h * ((WINDOW.bottom + WINDOW.top) / 2 - 0.5);
    // Dark bezel: a ring matching the window silhouette (outer tucked under the
    // frame, inner hole slightly smaller than the screen) extruded backward from
    // the frame front. Its rim + inner walls form the recessed pocket the LCD
    // sits inside, so the screen reads as inset into the metal.
    const bezelDepth = 0.04;
    const bezelOutline = auraWindowOutline(screenW, screenH).getPoints();
    const scaleOutline = (s: number): THREE.Vector2[] =>
      bezelOutline.map((p) => new THREE.Vector2(p.x * s, p.y * s));
    // Thin rim: inner hole sits just inside the screen edge (~0.007 per side) so
    // the dark border is subtle; the recess depth still reads as inset.
    const bezelShape = new THREE.Shape(scaleOutline(1.02));
    bezelShape.holes.push(new THREE.Path(scaleOutline(0.986)));
    const bezelGeo = new THREE.ExtrudeGeometry(bezelShape, {
      depth: bezelDepth,
      bevelEnabled: false,
      curveSegments: 4,
      steps: 1,
    });
    bezelMesh = new THREE.Mesh(bezelGeo, bezelMaterial);
    bezelMesh.position.set(winCx, winCy, frontZ - bezelDepth - 0.001);
    group.add(bezelMesh);

    const screenGeo = auraWindowShape(screenW, screenH);
    screenMesh = new THREE.Mesh(screenGeo, screenMaterial);
    // Recessed deep into the bezel pocket so the dark walls give real depth.
    screenMesh.position.set(winCx, winCy, frontZ - 0.045);
    group.add(screenMesh);

    // Scan-line layer floating just in front of the recessed LCD. The field is
    // overscanned past the window so the bright line-ends reach the visible
    // edge and the overscan tucks inside the solid frame (depth-occluded), with
    // no inset bezel gap.
    addScreenLines(screenW, screenH, winCx, winCy, frontZ - 0.035, 1.1);

    // Header row shared by the wordmark + vent slashes (same vertical center).
    const headerY = shell.h / 2 - 0.16;
    const windowLeft = -shell.w / 2 + WINDOW.left * shell.w;

    // AURA wordmark, left edge aligned to the window's left edge (20% smaller).
    const markW = shell.w * 0.272;
    const markH = markW / wordmarkAspect;
    wordmarkWidth = markW;
    wordmarkMesh = new THREE.Mesh(new THREE.PlaneGeometry(markW, markH), wordmarkMaterial);
    wordmarkMesh.position.set(windowLeft + markW / 2, headerY, frontZ + 0.006);
    group.add(wordmarkMesh);
    detailMeshes.push(wordmarkMesh);

    // Vent slashes, top-right (dark angled inlays), aligned to the wordmark row.
    const slashGeo = new THREE.BoxGeometry(0.02, 0.12, 0.03);
    for (let i = 0; i < 3; i += 1) {
      const slash = new THREE.Mesh(slashGeo.clone(), matteMaterial);
      slash.position.set(shell.w / 2 - 0.14 - i * 0.07, headerY, frontZ + 0.004);
      slash.rotation.z = 0.5;
      group.add(slash);
      detailMeshes.push(slash);
    }
    slashGeo.dispose();

    // LED cluster: three on the left slot, centered in the metal strip between
    // the recessed slot floor and the screen window's left edge.
    const ledGeo = new THREE.SphereGeometry(0.0133, 16, 16);
    const ledX = -shell.w / 2 + (LED_SLOT_DEPTH + WINDOW.left * shell.w) / 2;
    const ledColumns: Array<{ x: number; cy: number }> = [
      { x: ledX, cy: shell.h * 0.03 },
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

    // Fake barcode decal centered in the bottom-right metal area: below the
    // window's raised right bottom edge and left of the bottom-right window
    // chamfer / stepped outer edge. Bounds derived from the same window +
    // silhouette constants so it tracks the geometry.
    const hwP = shell.w / 2;
    const hhP = shell.h / 2;
    const winRight = -hwP + WINDOW.right * shell.w;
    const winBottom = -hhP + WINDOW.bottom * shell.h;
    const winBottomRight = winBottom + 0.08; // raised right bottom (matches stepH)
    const winLeft = -hwP + WINDOW.left * shell.w;
    const bottomStepX = winLeft + (winRight - winLeft) * 0.6; // window bottom step
    const outerBottom = -hhP;
    const areaCx = (bottomStepX + winRight) / 2;
    const areaCy = (winBottomRight + outerBottom) / 2;
    const barcodeW = (winRight - bottomStepX) * 0.62;
    const barcodeH = (winBottomRight - outerBottom) * 0.5;
    barcodeMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(barcodeW, barcodeH),
      barcodeMaterial,
    );
    barcodeMesh.position.set(areaCx, areaCy, frontZ + 0.003);
    group.add(barcodeMesh);

    fitCamera(shell.w, shell.h);
  }

  function fitCamera(shellW: number, shellH: number): void {
    const margin = 1.16;
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    // Always frame to the card width so the card keeps the same on-screen size
    // regardless of canvas height; the (taller) canvas reveals the worn-metal
    // info strip below. The extra vertical space is centered between the card's
    // top edge and the backplate's bottom so both stay in view.
    const distW = (shellW * margin) / 2 / Math.tan(vFov / 2) / camera.aspect;
    const centerY = (shellH / 2 + INFO_PLATE.bottom) / 2;
    camera.position.set(0, centerY, distW);
    camera.lookAt(0, centerY, 0);
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
  // UnrealBloomPass blends its glow additively over the scene with a copy
  // material that outputs alpha = 1, which (added to the scene's alpha) forces
  // the entire canvas opaque and paints a flat box over the themed CSS
  // backdrop. Switch its blend to custom factors that keep the additive RGB
  // glow but take alpha from the destination (the scene), so empty areas stay
  // transparent and the themed sidekick background behind the host shows
  // through unchanged.
  const bloomBlend = bloom.blendMaterial;
  bloomBlend.blending = THREE.CustomBlending;
  bloomBlend.blendEquation = THREE.AddEquation;
  bloomBlend.blendSrc = THREE.SrcAlphaFactor;
  bloomBlend.blendDst = THREE.OneFactor;
  bloomBlend.blendEquationAlpha = THREE.AddEquation;
  bloomBlend.blendSrcAlpha = THREE.ZeroFactor;
  bloomBlend.blendDstAlpha = THREE.OneFactor;
  bloomBlend.needsUpdate = true;
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

    // Subtle CRT animation on the scan lines (skipped under reduced motion): a
    // slow breathing fade in/out plus a faster low-amplitude flicker.
    if (idleAmp) {
      const breathe = 0.78 + Math.sin(t * 0.9) * 0.22;
      const flicker = 1 + Math.sin(t * 9) * 0.11 + Math.sin(t * 23.3) * 0.06;
      const factor = breathe * flicker;
      lineMaterial.opacity = lineCoreOpacity * factor;
      lineHaloMaterial.opacity = lineHaloOpacity * factor;
    }

    // Blink the info-strip status dot: mostly on with a brief off beat (~1.85s
    // cycle). Redraw only when the on/off state flips. Reduced motion keeps it
    // steadily on.
    if (idleAmp && infoRenderer) {
      const on = Math.sin(t * 3.4) > -0.35;
      if (on !== infoDotOn) {
        infoDotOn = on;
        infoRenderer(infoDotOn);
        infoTexture.needsUpdate = true;
      }
    }

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
    fitCamera(PORTRAIT_SHELL.w, PORTRAIT_SHELL.h);
    if (reducedMotion) renderFrame();
  });
  resizeObserver.observe(host);

  start();

  return {
    screenCanvas,
    setAccent(next: string): void {
      accent = new THREE.Color(next || "#6366f1");
      accentMaterial.color.copy(accent);
      accentMaterial.emissive.copy(accent);
      accentLight.color.copy(accent);
      if (reducedMotion) renderFrame();
    },
    setLineColor(next: string): void {
      lineColor = new THREE.Color(next || CARD_LINE_COLOR);
      lineMaterial.color.copy(lineColor);
      lineHaloMaterial.color.copy(lineColor);
      if (reducedMotion) renderFrame();
    },
    refreshTexture(): void {
      screenTexture.needsUpdate = true;
      if (reducedMotion) renderFrame();
    },
    infoCanvas,
    setInfoRenderer(render: (dotOn: boolean) => void): void {
      infoRenderer = render;
      render(infoDotOn);
      infoTexture.needsUpdate = true;
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
      bezelMaterial.dispose();
      barcodeMaterial.dispose();
      blueMetalMaterial.dispose();
      matteMaterial.dispose();
      plateMaterial.dispose();
      infoMaterial.dispose();
      wordmarkMaterial.dispose();
      lineMaterial.dispose();
      lineHaloMaterial.dispose();
      blueMetalTexture.dispose();
      matteTexture.dispose();
      wearTexture.dispose();
      plateMetalTexture.dispose();
      plateWearTexture.dispose();
      barcodeTexture.dispose();
      wordmarkTexture.dispose();
      screenTexture.dispose();
      infoTexture.dispose();
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
