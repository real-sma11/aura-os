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
  /**
   * Offscreen canvas for the LCD on the BACK of the card (revealed when the
   * card is flipped). The caller draws the agent's persona text into it.
   */
  readonly backScreenCanvas: HTMLCanvasElement;
  /** Offscreen canvas the agent info strip is drawn into by the renderer. */
  readonly infoCanvas: HTMLCanvasElement;
  setAccent(accent: string): void;
  /** Update the LCD scan-line color (independent of the accent). */
  setLineColor(color: string): void;
  /** Mark the LCD texture dirty after redrawing into `screenCanvas`. */
  refreshTexture(): void;
  /** Mark the back LCD texture dirty after redrawing into `backScreenCanvas`. */
  refreshBackTexture(): void;
  /**
   * Register the function that redraws the info strip into `infoCanvas`. It is
   * called immediately and again on every blink toggle (with `dotOn` flipped)
   * so the status dot can pulse without the caller driving the animation.
   */
  setInfoRenderer(render: (dotOn: boolean) => void): void;
  /** Offscreen canvas the navigation links are drawn into by the renderer. */
  readonly linksCanvas: HTMLCanvasElement;
  /**
   * Configure the clickable navigation links. `count` is the number of rows
   * (used to hit-test clicks), `onActivate` fires with the clicked row index,
   * and `render` redraws the links with the given hovered row index (-1 = none).
   */
  setLinks(
    count: number,
    onActivate: (index: number) => void,
    render: (hovered: number) => void,
  ): void;
  /** Offscreen canvas the messaging-channel logos are drawn into. */
  readonly channelsCanvas: HTMLCanvasElement;
  /**
   * Register the function that draws the brand logos into `channelsCanvas`.
   * Called immediately; the icon set is static so no animation is driven.
   */
  setChannelsRenderer(render: () => void): void;
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
  bottom: -3.95, // long strip: readout up top, navigation links below
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
  w: 1.7,
  top: -1.3,
  bottom: -2.54,
  canvasW: 1200,
};

/**
 * Messaging-channel pill region between the info readout (which ends with the
 * Wallet row) and the navigation links (which start with Soul). A shallow
 * recessed pocket is cut into the backplate here and brand logos are engraved
 * into it. Narrower than the readout so the rounded pill reads as an inset
 * stamp centered in the strip.
 */
const INFO_CHANNELS = {
  w: 1.2,
  top: -2.6,
  bottom: -2.94,
  canvasW: 1024,
};

/**
 * Pill pocket dimensions derived from `INFO_CHANNELS`, shared by the plate
 * opening, the recessed pocket geometry, and the logo decal canvas so they all
 * stay aligned. The outer pill is slightly shorter than the region; the inner
 * (floor/decal) is inset to leave room for the pocket walls.
 */
const PILL_W = INFO_CHANNELS.w;
const PILL_H = (INFO_CHANNELS.top - INFO_CHANNELS.bottom) * 0.82;
const PILL_INNER_W = PILL_W - 0.05;
const PILL_INNER_H = PILL_H - 0.05;
const PILL_POCKET_DEPTH = 0.03;

/**
 * Navigation links region on the lower part of the backplate (below the
 * channel pill). Rows are drawn by an external renderer; clicks are hit-tested
 * via raycasting against this plane and mapped to a row index.
 */
const INFO_LINKS = {
  w: 1.7,
  top: -3.0,
  bottom: -3.82,
  canvasW: 1200,
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

/** Mirror a list of points horizontally (negate x). */
function mirrorX(points: THREE.Vector2[]): THREE.Vector2[] {
  return points.map((p) => new THREE.Vector2(-p.x, p.y));
}

/** Scale a list of points about the origin. */
function scalePoints(points: THREE.Vector2[], s: number): THREE.Vector2[] {
  return points.map((p) => new THREE.Vector2(p.x * s, p.y * s));
}

/**
 * Build a ShapeGeometry from an explicit outline (window-centered points), with
 * UVs remapped to 0..1 over the `w`x`h` bounding box so the emissive texture
 * maps exactly as a PlaneGeometry would (independent of the outline winding, so
 * a horizontally-mirrored silhouette still shows non-mirrored text).
 */
function shapeFromOutline(points: THREE.Vector2[], w: number, h: number): THREE.ShapeGeometry {
  const hw = w / 2;
  const hh = h / 2;
  const geo = new THREE.ShapeGeometry(new THREE.Shape(points));
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
 * Horizontal extent [minX, maxX] of a closed polygon at height `y`, or null if
 * the line doesn't cross it. Used to clip each scan-line row to the true window
 * silhouette (so the field follows every chamfer/step on the correct side, for
 * both the front and the horizontally-mirrored back face).
 */
function xSpanAtY(points: THREE.Vector2[], y: number): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const crosses = (a.y <= y && b.y >= y) || (b.y <= y && a.y >= y);
    if (!crosses) continue;
    if (a.y === b.y) {
      lo = Math.min(lo, a.x, b.x);
      hi = Math.max(hi, a.x, b.x);
    } else {
      const t = (y - a.y) / (b.y - a.y);
      const x = a.x + (b.x - a.x) * t;
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
  }
  return lo <= hi ? [lo, hi] : null;
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
 * Stadium / pill outline (rounded rectangle), centered on the origin. `r` is the
 * corner radius; pass `h / 2` for a true pill with fully-rounded ends. Used for
 * the recessed messaging-channel pocket and its decal plane.
 */
function pillShape(w: number, h: number, r: number): THREE.Shape {
  const hw = w / 2;
  const hh = h / 2;
  const rad = Math.min(r, hh, hw);
  const s = new THREE.Shape();
  s.moveTo(-hw + rad, hh);
  s.lineTo(hw - rad, hh);
  s.absarc(hw - rad, hh - rad, rad, Math.PI / 2, 0, true);
  s.lineTo(hw, -hh + rad);
  s.absarc(hw - rad, -hh + rad, rad, 0, -Math.PI / 2, true);
  s.lineTo(-hw + rad, -hh);
  s.absarc(-hw + rad, -hh + rad, rad, -Math.PI / 2, -Math.PI, true);
  s.lineTo(-hw, hh - rad);
  s.absarc(-hw + rad, hh - rad, rad, Math.PI, Math.PI / 2, true);
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

  // The card itself lives in a nested group so it can flip (rotate 180deg about
  // Y) on click without taking the worn-metal info/links strip below it along
  // for the ride (that stays in `group`, facing front).
  const cardGroup = new THREE.Group();
  group.add(cardGroup);

  // The worn-metal info/links backplate lives in its own group so it can slide
  // down out of the way before the card flips (and back up after it returns),
  // avoiding the card rotating through it mid-flip.
  const plateGroup = new THREE.Group();
  group.add(plateGroup);

  // LCD offscreen canvas + texture.
  const screenCanvas = document.createElement("canvas");
  const screenTexture = new THREE.CanvasTexture(screenCanvas);
  screenTexture.colorSpace = THREE.SRGBColorSpace;
  screenTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // Back-of-card LCD: a second offscreen canvas + texture, drawn with the
  // agent's persona text by the caller and revealed when the card flips.
  const backScreenCanvas = document.createElement("canvas");
  const backScreenTexture = new THREE.CanvasTexture(backScreenCanvas);
  backScreenTexture.colorSpace = THREE.SRGBColorSpace;
  backScreenTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

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
  infoTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  // Keep the readout crisp: skip mipmaps (which soften the high-res text when
  // minified) and sample linearly.
  infoTexture.generateMipmaps = false;
  infoTexture.minFilter = THREE.LinearFilter;
  const infoMaterial = new THREE.MeshBasicMaterial({
    map: infoTexture,
    transparent: true,
    depthWrite: false,
  });
  let infoRenderer: ((dotOn: boolean) => void) | null = null;
  let infoDotOn = true;

  // Navigation links: a transparent canvas mapped onto a plane below the info
  // readout, with raycast-based hover/click hit-testing.
  const linksCanvas = document.createElement("canvas");
  linksCanvas.width = INFO_LINKS.canvasW;
  linksCanvas.height = Math.round(
    (INFO_LINKS.canvasW * (INFO_LINKS.top - INFO_LINKS.bottom)) / INFO_LINKS.w,
  );
  const linksTexture = new THREE.CanvasTexture(linksCanvas);
  linksTexture.colorSpace = THREE.SRGBColorSpace;
  linksTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  linksTexture.generateMipmaps = false;
  linksTexture.minFilter = THREE.LinearFilter;
  const linksMaterial = new THREE.MeshBasicMaterial({
    map: linksTexture,
    transparent: true,
    depthWrite: false,
  });
  // Messaging-channel logos: a transparent canvas mapped onto a plane inside
  // the recessed pill pocket. Static icon set, so no per-frame redraw.
  const channelsCanvas = document.createElement("canvas");
  channelsCanvas.width = INFO_CHANNELS.canvasW;
  // Match the decal plane's aspect (inner pill) so the round logos stay round.
  channelsCanvas.height = Math.round(
    (INFO_CHANNELS.canvasW * PILL_INNER_H) / PILL_INNER_W,
  );
  const channelsTexture = new THREE.CanvasTexture(channelsCanvas);
  channelsTexture.colorSpace = THREE.SRGBColorSpace;
  channelsTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  channelsTexture.generateMipmaps = false;
  channelsTexture.minFilter = THREE.LinearFilter;
  const channelsMaterial = new THREE.MeshBasicMaterial({
    map: channelsTexture,
    transparent: true,
    depthWrite: false,
    // Bias the decal toward the camera so it never z-fights the pocket floor
    // (the two sit close together inside the recess) as the card tilts.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  let linkCount = 0;
  let onLinkActivate: ((index: number) => void) | null = null;
  let linksRenderer: ((hovered: number) => void) | null = null;
  let hoveredLink = -1;
  let pointerDownX = 0;
  let pointerDownY = 0;
  let pointerDownLink = -1;

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
  // Identical LCD material for the back face, driven by its own (text) texture.
  const backScreenMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x000000,
    emissive: 0xffffff,
    emissiveMap: backScreenTexture,
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
  let wordmarkWidth = 0;
  let wordmarkAspect = WORDMARK_ASPECT;
  const wordmarkTexture = new THREE.TextureLoader().load(WORDMARK_SRC, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    const img = tex.image as { width?: number; height?: number } | undefined;
    if (img?.width && img?.height) {
      wordmarkAspect = img.width / img.height;
      if (wordmarkWidth > 0) {
        for (const mesh of wordmarkMeshes) {
          mesh.geometry.dispose();
          mesh.geometry = new THREE.PlaneGeometry(
            wordmarkWidth,
            wordmarkWidth / wordmarkAspect,
          );
        }
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

  // Meshes living directly in `group` (the worn-metal strip; do not flip).
  let infoPlateMesh: THREE.Mesh | null = null;
  let infoMesh: THREE.Mesh | null = null;
  let linksMesh: THREE.Mesh | null = null;
  let channelsMesh: THREE.Mesh | null = null;
  let channelsWallMesh: THREE.Mesh | null = null;
  let channelsFloorMesh: THREE.Mesh | null = null;
  // Card meshes (children of `cardGroup`), kept for raycast hit-testing the flip.
  let shellMesh: THREE.Mesh | null = null;
  let frontScreenMesh: THREE.Mesh | null = null;
  let backScreenMesh: THREE.Mesh | null = null;
  // Wordmark planes (front + back) resized when the logo aspect resolves.
  const wordmarkMeshes: THREE.Mesh[] = [];

  /**
   * Build the scan-line readout: each row spans the full screen width but is
   * subdivided so a per-vertex grayscale ramp can drive its intensity from
   * bright at the outer edges down to ~0 in the center (additive blending turns
   * the dim center transparent over the portrait). A deterministic per-row
   * brightness jitter (stable across rebuilds, not Math.random) keeps it from
   * looking uniform. A dimmer offset copy feeds bloom for the CRT/LCD glow.
   */
  function addScreenLines(
    parent: THREE.Object3D,
    screenW: number,
    screenH: number,
    cx: number,
    cy: number,
    z: number,
    clip: THREE.Vector2[],
  ): void {
    const spacing = screenH / 56;
    const half = screenW / 2;
    const segments = 36;
    // Deterministic 0..1 hash for a row index (stable across rebuilds).
    const hash = (n: number): number => {
      const s = Math.sin(n * 12.9898) * 43758.5453;
      return s - Math.floor(s);
    };
    // Edge-to-center intensity ramp: 1 at (and beyond) the outer edge, ~0 across
    // the center, so lines fade to transparent over the portrait. `fade` is the
    // transparent center half-width (fraction of `half`); the lines only start
    // ramping up beyond it. Symmetric about x=0, so it is mirror-agnostic.
    const fade = 0.6;
    const rampAt = (x: number): number => {
      const d = Math.min(1, Math.abs(x) / half);
      const u = Math.max(0, (d - fade) / (1 - fade));
      return Math.pow(u, 3.2);
    };
    // Vertical extent from the clip polygon's bounds.
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const p of clip) {
      yMin = Math.min(yMin, p.y);
      yMax = Math.max(yMax, p.y);
    }
    const pos: number[] = [];
    const col: number[] = [];
    let row = 0;
    for (let y = yMin; y <= yMax + 1e-4; y += spacing) {
      // Clip each row to the (slightly expanded) window silhouette so the field
      // follows every chamfer/step on the correct side and tucks under the
      // metal frame without spilling past the card. Works for both the front
      // outline and the horizontally-mirrored back outline.
      const span = xSpanAtY(clip, y);
      if (!span) {
        row += 1;
        continue;
      }
      const [x0, x1] = span;
      if (x1 <= x0) {
        row += 1;
        continue;
      }
      const rowGain = 0.4 + hash(row) * 1.05;
      const total = x1 - x0;
      let prevX = x0;
      for (let i = 1; i <= segments; i += 1) {
        const x = x0 + (total * i) / segments;
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
    const lines = new THREE.LineSegments(geo, lineMaterial);
    lines.position.set(cx, cy, z);
    parent.add(lines);

    // Halo copy, nudged slightly forward, that the bloom pass spreads into glow.
    // Shares geometry with `lines` (disposed once via the cardGroup subtree).
    const halo = new THREE.LineSegments(geo, lineHaloMaterial);
    halo.position.set(cx, cy, z + 0.004);
    parent.add(halo);
  }

  function disposeBuilt(): void {
    if (infoPlateMesh) {
      plateGroup.remove(infoPlateMesh);
      infoPlateMesh.geometry.dispose();
      infoPlateMesh = null;
    }
    if (infoMesh) {
      plateGroup.remove(infoMesh);
      infoMesh.geometry.dispose();
      infoMesh = null;
    }
    if (linksMesh) {
      plateGroup.remove(linksMesh);
      linksMesh.geometry.dispose();
      linksMesh = null;
    }
    if (channelsMesh) {
      plateGroup.remove(channelsMesh);
      channelsMesh.geometry.dispose();
      channelsMesh = null;
    }
    if (channelsWallMesh) {
      plateGroup.remove(channelsWallMesh);
      channelsWallMesh.geometry.dispose();
      channelsWallMesh = null;
    }
    if (channelsFloorMesh) {
      plateGroup.remove(channelsFloorMesh);
      channelsFloorMesh.geometry.dispose();
      channelsFloorMesh = null;
    }
    // Card meshes (frame, matte core, and the front/back face nodes) live under
    // `cardGroup`. Remove every child and dispose its geometries, de-duplicated
    // via a set since the scan-line halo shares geometry with its core line.
    const geos = new Set<THREE.BufferGeometry>();
    for (const child of [...cardGroup.children]) {
      child.traverse((obj) => {
        const mesh = obj as Partial<THREE.Mesh>;
        if (mesh.geometry) geos.add(mesh.geometry);
      });
      cardGroup.remove(child);
    }
    geos.forEach((g) => g.dispose());
    shellMesh = null;
    frontScreenMesh = null;
    backScreenMesh = null;
    wordmarkMeshes.length = 0;
  }

  function buildCard(): void {
    disposeBuilt();
    buildPortrait();
  }

  /**
   * Build one screen face (bezel pocket, emissive LCD, scan-lines, and the metal
   * decals) into `parent` using card-local coordinates with `+z` toward the
   * front. The front face is added with no rotation; the back face's `parent` is
   * rotated PI about Y, which mirrors these same offsets onto the rear and keeps
   * every texture reading the right way round when viewed from behind. Returns
   * the LCD mesh so callers can keep it for raycast hit-testing the flip.
   */
  function buildFace(
    parent: THREE.Object3D,
    screenMat: THREE.Material,
    shell: { w: number; h: number },
    frontZ: number,
    screenW: number,
    screenH: number,
    winCx: number,
    winCy: number,
    mirror: boolean,
  ): THREE.Mesh {
    // The back face sits in a node rotated PI about Y; after the card's own flip
    // (another PI) its net rotation is zero, so to line its window silhouette up
    // with the (mirrored) metal frame it must use a horizontally-mirrored
    // outline. The front uses the outline as-is. UVs are remapped over the
    // bounding box either way, so the back text still reads correctly.
    const baseOutline = auraWindowOutline(screenW, screenH).getPoints();
    const outline = mirror ? mirrorX(baseOutline) : baseOutline;

    // Dark bezel: a ring matching the window silhouette, extruded backward to
    // form the recessed pocket walls the LCD sits inside.
    const bezelDepth = 0.04;
    const bezelShape = new THREE.Shape(scalePoints(outline, 1.02));
    bezelShape.holes.push(new THREE.Path(scalePoints(outline, 0.986)));
    const bezelGeo = new THREE.ExtrudeGeometry(bezelShape, {
      depth: bezelDepth,
      bevelEnabled: false,
      curveSegments: 4,
      steps: 1,
    });
    const bezel = new THREE.Mesh(bezelGeo, bezelMaterial);
    bezel.position.set(winCx, winCy, frontZ - bezelDepth - 0.001);
    parent.add(bezel);

    // Emissive LCD plane, recessed deep into the bezel pocket.
    const screen = new THREE.Mesh(shapeFromOutline(outline, screenW, screenH), screenMat);
    screen.position.set(winCx, winCy, frontZ - 0.045);
    parent.add(screen);

    // Scan-line layer floating just in front of the recessed LCD, clipped to a
    // slightly-expanded copy of the window silhouette so the field tucks under
    // the frame on the correct side.
    addScreenLines(
      parent,
      screenW,
      screenH,
      winCx,
      winCy,
      frontZ - 0.035,
      scalePoints(outline, 1.06),
    );

    // Decals sit over specific frame regions (LED slot on the left, vents on the
    // right). The back's frame is mirrored by the flip, so mirror the decal x
    // positions there too (`mx`) to keep each decal over its matching feature.
    const mx = mirror ? -1 : 1;

    // Header row shared by the wordmark + vent slashes (same vertical center).
    const headerY = shell.h / 2 - 0.16;
    const windowLeft = -shell.w / 2 + WINDOW.left * shell.w;

    // AURA wordmark, left edge aligned to the window's left edge.
    const markW = shell.w * 0.272;
    const markH = markW / wordmarkAspect;
    wordmarkWidth = markW;
    const wordmark = new THREE.Mesh(new THREE.PlaneGeometry(markW, markH), wordmarkMaterial);
    wordmark.position.set((windowLeft + markW / 2) * mx, headerY, frontZ + 0.006);
    parent.add(wordmark);
    wordmarkMeshes.push(wordmark);

    // Vent slashes, top-right (dark angled inlays), aligned to the wordmark row.
    const slashGeo = new THREE.BoxGeometry(0.02, 0.12, 0.03);
    for (let i = 0; i < 3; i += 1) {
      const slash = new THREE.Mesh(slashGeo.clone(), matteMaterial);
      slash.position.set((shell.w / 2 - 0.14 - i * 0.07) * mx, headerY, frontZ + 0.004);
      slash.rotation.z = 0.5 * mx;
      parent.add(slash);
    }
    slashGeo.dispose();

    // LED cluster: three on the left slot, centered in the metal strip between
    // the recessed slot floor and the screen window's left edge.
    const ledGeo = new THREE.SphereGeometry(0.0133, 16, 16);
    const ledX = -shell.w / 2 + (LED_SLOT_DEPTH + WINDOW.left * shell.w) / 2;
    const ledCy = shell.h * 0.03;
    for (let i = 0; i < 3; i += 1) {
      const led = new THREE.Mesh(ledGeo.clone(), accentMaterial);
      led.position.set(ledX * mx, ledCy + (1 - i) * 0.09, frontZ + 0.008);
      parent.add(led);
    }
    ledGeo.dispose();

    // Fake barcode decal centered in the bottom-right metal area.
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
    const barcode = new THREE.Mesh(
      new THREE.PlaneGeometry(barcodeW, barcodeH),
      barcodeMaterial,
    );
    barcode.position.set(areaCx * mx, areaCy, frontZ + 0.003);
    parent.add(barcode);

    return screen;
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
    // Pill pocket placement (used both to cut the plate opening and to build the
    // recessed pocket below). The pill sits in the gap between the Wallet row
    // and the Soul link; its center in the plate's local frame is the world
    // pill center minus the plate center.
    const pillCy = (INFO_CHANNELS.top + INFO_CHANNELS.bottom) / 2;
    const plateCy = (INFO_PLATE.top + INFO_PLATE.bottom) / 2;
    const pillLocalY = pillCy - plateCy;
    const pillR = PILL_H / 2;

    const plateH = INFO_PLATE.top - INFO_PLATE.bottom;
    const plate = plateShape(INFO_PLATE.w, plateH, INFO_PLATE.chamfer);
    // Cut the pill opening so the recessed floor + engraved logos are visible
    // through the plate instead of being occluded by its solid front face.
    const pillHolePts = pillShape(PILL_W, PILL_H, pillR)
      .getPoints(32)
      .map((p) => new THREE.Vector2(p.x, p.y + pillLocalY));
    plate.holes.push(new THREE.Path(pillHolePts));
    const plateGeo = new THREE.ExtrudeGeometry(plate, {
      depth: INFO_PLATE.depth,
      bevelEnabled: true,
      bevelThickness: INFO_PLATE.bevel,
      bevelSize: INFO_PLATE.bevel,
      bevelSegments: 2,
      curveSegments: 12,
      steps: 1,
    });
    plateGeo.center();
    applyEdgeWear(plateGeo);
    infoPlateMesh = new THREE.Mesh(plateGeo, plateMaterial);
    infoPlateMesh.position.set(0, (INFO_PLATE.top + INFO_PLATE.bottom) / 2, INFO_PLATE.z);
    plateGroup.add(infoPlateMesh);

    // Agent info readout plane, just in front of the plate's front face (the
    // plate front sits at ~ INFO_PLATE.z + depth/2 + bevel).
    const infoH = INFO_TEXT.top - INFO_TEXT.bottom;
    const infoFrontZ = INFO_PLATE.z + INFO_PLATE.depth / 2 + INFO_PLATE.bevel + 0.015;
    infoMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(INFO_TEXT.w, infoH),
      infoMaterial,
    );
    infoMesh.position.set(0, (INFO_TEXT.top + INFO_TEXT.bottom) / 2, infoFrontZ);
    plateGroup.add(infoMesh);

    // Navigation links plane (clickable), below the info readout.
    const linksH = INFO_LINKS.top - INFO_LINKS.bottom;
    linksMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(INFO_LINKS.w, linksH),
      linksMaterial,
    );
    linksMesh.position.set(0, (INFO_LINKS.top + INFO_LINKS.bottom) / 2, infoFrontZ);
    plateGroup.add(linksMesh);

    // Messaging-channel pill: a shallow pocket cut into the plate between the
    // Wallet readout row and the Soul link. Mirrors the LCD bezel recipe — a
    // dark wall ring extruded backward from the plate surface forms the pocket
    // walls, a recessed pill floor reads as cut-in, and a decal plane just in
    // front of the floor carries the engraved brand logos.
    const plateFrontZ = INFO_PLATE.z + INFO_PLATE.depth / 2 + INFO_PLATE.bevel;
    // Wall ring: outer pill with a slightly inset pill hole, extruded back from
    // the plate front so its inner walls give the recess real depth. It fills
    // the gap between the plate opening edge and the recessed floor.
    const wallShape = pillShape(PILL_W, PILL_H, pillR);
    wallShape.holes.push(
      new THREE.Path(pillShape(PILL_INNER_W, PILL_INNER_H, PILL_INNER_H / 2).getPoints(32)),
    );
    const wallGeo = new THREE.ExtrudeGeometry(wallShape, {
      depth: PILL_POCKET_DEPTH,
      bevelEnabled: false,
      curveSegments: 24,
      steps: 1,
    });
    channelsWallMesh = new THREE.Mesh(wallGeo, bezelMaterial);
    channelsWallMesh.position.set(0, pillCy, plateFrontZ - PILL_POCKET_DEPTH);
    plateGroup.add(channelsWallMesh);

    // Recessed pocket floor (dark metal), set behind the plate surface.
    const floorGeo = new THREE.ShapeGeometry(
      pillShape(PILL_INNER_W, PILL_INNER_H, PILL_INNER_H / 2),
      24,
    );
    channelsFloorMesh = new THREE.Mesh(floorGeo, matteMaterial);
    channelsFloorMesh.position.set(0, pillCy, plateFrontZ - PILL_POCKET_DEPTH + 0.001);
    plateGroup.add(channelsFloorMesh);

    // Engraved logo decal, clearly in front of the recessed floor (a wide gap
    // plus polygon offset on the material avoid z-fighting during card tilt).
    const channelsGeo = new THREE.PlaneGeometry(PILL_INNER_W, PILL_INNER_H);
    channelsMesh = new THREE.Mesh(channelsGeo, channelsMaterial);
    channelsMesh.position.set(0, pillCy, plateFrontZ - PILL_POCKET_DEPTH + 0.014);
    plateGroup.add(channelsMesh);

    // Metal frame: silhouette extruded with the screen window as a hole. Shared
    // by both faces (its front + back faces are both visible), so it lives
    // directly on `cardGroup` rather than in a per-face node.
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
    cardGroup.add(shellMesh);

    // Matte core: full silhouette (no hole), centered at z=0 and scaled slightly
    // so it peeks through the LED slot + chamfers and forms the opaque dark
    // backing shared by BOTH the front and back LCDs. It must stay THIN: the
    // LCDs are recessed to z = +/-0.045, and ExtrudeGeometry adds the bevel on
    // both ends, so the total z-thickness is depth + 2*bevel. Keep its faces
    // comfortably inside +/-0.045 (here ~ +/-0.02) so it never pokes in front of
    // a screen and occludes it.
    const coreGeo = new THREE.ExtrudeGeometry(auraOuterShape(shell.w, shell.h), {
      depth: 0.02,
      bevelEnabled: true,
      bevelThickness: 0.01,
      bevelSize: 0.01,
      bevelSegments: 2,
      curveSegments: 16,
      steps: 1,
    });
    coreGeo.center();
    const coreMesh = new THREE.Mesh(coreGeo, matteMaterial);
    coreMesh.scale.set(1.03, 1.025, 1);
    cardGroup.add(coreMesh);

    // Shared LCD geometry metrics. The window box is not symmetric about origin.
    const screenW = (WINDOW.right - WINDOW.left) * shell.w;
    const screenH = (WINDOW.top - WINDOW.bottom) * shell.h;
    const winCx = shell.w * ((WINDOW.left + WINDOW.right) / 2 - 0.5);
    const winCy = shell.h * ((WINDOW.bottom + WINDOW.top) / 2 - 0.5);

    // Front face: the photo LCD. Built at face-local +z offsets.
    screenCanvas.width = canvasSize.w;
    screenCanvas.height = canvasSize.h;
    const frontFace = new THREE.Group();
    cardGroup.add(frontFace);
    frontScreenMesh = buildFace(
      frontFace,
      screenMaterial,
      shell,
      frontZ,
      screenW,
      screenH,
      winCx,
      winCy,
      false,
    );

    // Back face: identical build, but the parent node is rotated PI about Y so
    // the same local offsets land on the rear and textures read correctly from
    // behind. Its LCD shows the agent's persona text instead of the photo.
    backScreenCanvas.width = canvasSize.w;
    backScreenCanvas.height = canvasSize.h;
    const backFace = new THREE.Group();
    backFace.rotation.y = Math.PI;
    cardGroup.add(backFace);
    backScreenMesh = buildFace(
      backFace,
      backScreenMaterial,
      shell,
      frontZ,
      screenW,
      screenH,
      winCx,
      winCy,
      true,
    );

    fitCamera(shell.w, shell.h);
  }

  function fitCamera(shellW: number, shellH: number): void {
    // Tighter framing than before (was 1.16) makes the whole card ~12% larger.
    const margin = 1.036;
    // Small gap above the card so it starts high in the view; the rest of the
    // taller canvas falls below, revealing the worn-metal info strip.
    const topGap = 0.1;
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    // Frame to the card width so the card size tracks the (fixed-width) host;
    // position the vertical window so the card top sits just below the top edge.
    const distW = (shellW * margin) / 2 / Math.tan(vFov / 2) / camera.aspect;
    const visibleHeight = (shellW * margin) / camera.aspect;
    const centerY = shellH / 2 + topGap - visibleHeight / 2;
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
  // Flip state: clicking the card toggles between front (0) and back (PI),
  // animated by lerping `cardGroup.rotation.y` toward `flipTarget`. The flip is
  // sequenced with the backplate slide (see the animation loop) so the card
  // never rotates through the worn-metal strip.
  let flipped = false;
  let flipTarget = 0;
  // Drop distance for the info backplate so its top (-0.9) clears the card's
  // bottom edge (-1.25) plus margin for the card's z-sweep during the flip.
  const PLATE_DROP = 0.9;

  /** Set the pointer NDC for the current event, for raycasting. */
  const setPointerNdc = (event: PointerEvent): void => {
    const rect = host.getBoundingClientRect();
    pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
  };

  /** Whether the pointer is over the metal card (frame or either LCD). */
  const cardAt = (event: PointerEvent): boolean => {
    const targets = [shellMesh, frontScreenMesh, backScreenMesh].filter(
      (m): m is THREE.Mesh => m != null,
    );
    if (targets.length === 0) return false;
    setPointerNdc(event);
    return raycaster.intersectObjects(targets, false).length > 0;
  };

  /** Raycast the pointer against the links plane; returns a row index or -1. */
  const linkAt = (event: PointerEvent): number => {
    if (!linksMesh || linkCount <= 0) return -1;
    const rect = host.getBoundingClientRect();
    pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    const hit = raycaster.intersectObject(linksMesh, false)[0];
    if (!hit || !hit.uv) return -1;
    const idx = Math.floor((1 - hit.uv.y) * linkCount);
    return Math.min(linkCount - 1, Math.max(0, idx));
  };

  const updateHoveredLink = (next: number): void => {
    if (next === hoveredLink) return;
    hoveredLink = next;
    host.style.cursor = next >= 0 ? "pointer" : "";
    if (linksRenderer) {
      linksRenderer(hoveredLink);
      linksTexture.needsUpdate = true;
      if (reducedMotion) renderFrame();
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    const rect = host.getBoundingClientRect();
    const nx = (event.clientX - rect.left) / rect.width - 0.5;
    const ny = (event.clientY - rect.top) / rect.height - 0.5;
    hovering = true;
    targetRotY = nx * 0.6 * tiltScale;
    targetRotX = -ny * 0.4 * tiltScale;
    const over = linkAt(event);
    updateHoveredLink(over);
    // A link row owns the cursor when hovered; otherwise the card body itself is
    // clickable (to flip), so show a pointer there too.
    if (over < 0) host.style.cursor = cardAt(event) ? "pointer" : "";
    // Never let interaction be dead if the loop was paused.
    if (!running) start();
  };
  const onPointerLeave = (): void => {
    hovering = false;
    updateHoveredLink(-1);
  };
  const onPointerDown = (event: PointerEvent): void => {
    pointerDownX = event.clientX;
    pointerDownY = event.clientY;
    pointerDownLink = linkAt(event);
  };
  const onPointerUp = (event: PointerEvent): void => {
    const moved = Math.hypot(event.clientX - pointerDownX, event.clientY - pointerDownY);
    // Treat as a drag (tilt), not a click, if the pointer moved appreciably.
    if (moved > 6) return;
    const idx = linkAt(event);
    if (idx >= 0 && idx === pointerDownLink && onLinkActivate) {
      onLinkActivate(idx);
      return;
    }
    // Clicking the metal card (and not a link row) flips it to show the back.
    // `flipTarget` is derived in the animation loop so the flip stays in step
    // with the backplate slide.
    if (idx < 0 && cardAt(event)) {
      flipped = !flipped;
      if (!running) start();
    }
  };
  host.addEventListener("pointermove", onPointerMove);
  host.addEventListener("pointerleave", onPointerLeave);
  host.addEventListener("pointerdown", onPointerDown);
  host.addEventListener("pointerup", onPointerUp);

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

    // Sequence the backplate slide with the card flip. Going to the back: slide
    // the plate down first, then flip once it has cleared the card. Returning to
    // the front: flip back first, then slide the plate up once the card is flat
    // again. This keeps the card from ever rotating through the metal strip.
    let plateTarget = 0;
    if (flipped) {
      plateTarget = -PLATE_DROP;
      const cleared = plateGroup.position.y - plateTarget < 0.12;
      flipTarget = cleared ? Math.PI : 0;
    } else {
      flipTarget = 0;
      const flat = cardGroup.rotation.y < 0.08;
      plateTarget = flat ? 0 : -PLATE_DROP;
    }
    plateGroup.position.y += (plateTarget - plateGroup.position.y) * 0.45;
    cardGroup.rotation.y += (flipTarget - cardGroup.rotation.y) * 0.12;

    bloom.strength += ((hovering ? 0.32 : 0.26) - bloom.strength) * 0.06;
    const desiredEmissive = hovering ? 1.3 : 1.15;
    screenMaterial.emissiveIntensity +=
      (desiredEmissive - screenMaterial.emissiveIntensity) * 0.06;
    backScreenMaterial.emissiveIntensity +=
      (desiredEmissive - backScreenMaterial.emissiveIntensity) * 0.06;
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
    backScreenCanvas,
    refreshBackTexture(): void {
      backScreenTexture.needsUpdate = true;
      if (reducedMotion) renderFrame();
    },
    infoCanvas,
    setInfoRenderer(render: (dotOn: boolean) => void): void {
      infoRenderer = render;
      render(infoDotOn);
      infoTexture.needsUpdate = true;
      if (reducedMotion) renderFrame();
    },
    linksCanvas,
    setLinks(
      count: number,
      onActivate: (index: number) => void,
      render: (hovered: number) => void,
    ): void {
      linkCount = count;
      onLinkActivate = onActivate;
      linksRenderer = render;
      render(hoveredLink);
      linksTexture.needsUpdate = true;
      if (reducedMotion) renderFrame();
    },
    channelsCanvas,
    setChannelsRenderer(render: () => void): void {
      render();
      channelsTexture.needsUpdate = true;
      if (reducedMotion) renderFrame();
    },
    dispose(): void {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      resizeObserver.disconnect();
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerleave", onPointerLeave);
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointerup", onPointerUp);
      disposeBuilt();
      shellMaterial.dispose();
      screenMaterial.dispose();
      backScreenMaterial.dispose();
      accentMaterial.dispose();
      bezelMaterial.dispose();
      barcodeMaterial.dispose();
      blueMetalMaterial.dispose();
      matteMaterial.dispose();
      plateMaterial.dispose();
      infoMaterial.dispose();
      linksMaterial.dispose();
      channelsMaterial.dispose();
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
      backScreenTexture.dispose();
      infoTexture.dispose();
      linksTexture.dispose();
      channelsTexture.dispose();
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
