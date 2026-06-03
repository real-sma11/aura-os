import type { Agent } from "../../../shared/types";

export interface DrawProfileCardOptions {
  agent: Agent;
  /** CSS color string for the accent (read from `--color-accent`). */
  accent: string;
  /** Decoded avatar image, or null when unavailable / CORS-tainted. */
  avatar: HTMLImageElement | null;
}

/** Duotone ramp endpoints: cold navy shadows up to a bright cyan highlight. */
const DUOTONE_SHADOW: [number, number, number] = [5, 10, 18];
const DUOTONE_HIGHLIGHT: [number, number, number] = [207, 232, 255];

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const target = w / h;
  const source = img.width / img.height;
  let sw: number;
  let sh: number;
  let sx: number;
  let sy: number;
  if (source > target) {
    sh = img.height;
    sw = sh * target;
    sx = (img.width - sw) / 2;
    sy = 0;
  } else {
    sw = img.width;
    sh = sw / target;
    sx = 0;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function parseAccent(accent: string): [number, number, number] {
  const hex = accent.trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /rgba?\(([^)]+)\)/i.exec(hex);
  if (rgb) {
    const parts = rgb[1].split(",").map((p) => parseFloat(p));
    if (parts.length >= 3) return [parts[0], parts[1], parts[2]];
  }
  return [99, 102, 241];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Grade the whole canvas into a cold-blue duotone: map each pixel's luminance
 * across a shadow -> accent-mid -> highlight ramp with a gentle contrast curve.
 * The source must be CORS-clean (callers guarantee this for the avatar).
 */
function applyDuotone(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  accent: [number, number, number],
): void {
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  const [sr, sg, sb] = DUOTONE_SHADOW;
  const [hr, hg, hb] = DUOTONE_HIGHLIGHT;
  // Cool the accent slightly so midtones read as blue.
  const mr = accent[0] * 0.65 + 30;
  const mg = accent[1] * 0.75 + 60;
  const mb = accent[2] * 0.85 + 90;
  for (let i = 0; i < data.length; i += 4) {
    const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
    // Contrast curve (smoothstep) to deepen shadows + lift highlights.
    const t = lum * lum * (3 - 2 * lum);
    let r: number;
    let g: number;
    let b: number;
    if (t < 0.5) {
      const k = t / 0.5;
      r = lerp(sr, mr, k);
      g = lerp(sg, mg, k);
      b = lerp(sb, mb, k);
    } else {
      const k = (t - 0.5) / 0.5;
      r = lerp(mr, hr, k);
      g = lerp(mg, hg, k);
      b = lerp(mb, hb, k);
    }
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
  ctx.putImageData(image, 0, 0);
}

/** Cinematic top sheen + radial vignette over the graded photo. */
function applyGrade(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const sheen = ctx.createLinearGradient(0, 0, 0, h);
  sheen.addColorStop(0, "rgba(200, 226, 255, 0.16)");
  sheen.addColorStop(0.35, "rgba(255,255,255,0)");
  sheen.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, w, h);

  const vignette = ctx.createRadialGradient(
    w / 2,
    h * 0.46,
    Math.min(w, h) * 0.28,
    w / 2,
    h * 0.5,
    Math.max(w, h) * 0.72,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(2,5,10,0.62)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
}

/** No-avatar fallback: a stylized blue gradient with a faint accent glow. */
function drawFallback(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  accent: string,
): void {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#0c1626");
  bg.addColorStop(1, "#04070d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalAlpha = 0.45;
  const glow = ctx.createRadialGradient(
    w / 2,
    h * 0.42,
    0,
    w / 2,
    h * 0.42,
    Math.max(w, h) * 0.55,
  );
  glow.addColorStop(0, accent);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/**
 * Render the agent "LCD" into a 2D canvas: a full-bleed, cold-blue duotone of
 * the uploaded profile photo (no text). The canvas is uploaded as a Three.js
 * texture, so it must never become CORS-tainted: the avatar is only drawn when
 * the caller verified it is cross-origin clean (otherwise `avatar` is null and a
 * stylized gradient fallback is used).
 */
export function drawProfileCardTexture(
  canvas: HTMLCanvasElement,
  opts: DrawProfileCardOptions,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const { accent, avatar } = opts;

  ctx.clearRect(0, 0, w, h);

  if (avatar) {
    drawImageCover(ctx, avatar, 0, 0, w, h);
    applyDuotone(ctx, w, h, parseAccent(accent));
  } else {
    drawFallback(ctx, w, h, accent);
  }

  applyGrade(ctx, w, h);
}

/** Shorten an on-chain address for display, e.g. `0x1234…abcd`. */
function truncateWallet(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

export interface DrawInfoStripOptions {
  name: string;
  role: string;
  /** Human-readable status label, e.g. "Online". */
  statusLabel: string;
  /** Drives the status dot color (green vs red). */
  isOnline: boolean;
  orgName: string | null;
  ip: string | null;
  wallet: string | null;
}

const STRIP_SANS = '"Inter", "Helvetica Neue", Arial, sans-serif';
const STRIP_MONO = '"SFMono-Regular", "DejaVu Sans Mono", "Menlo", monospace';

/** Rounded rectangle path (manual, for broad canvas support). */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Engraved text: a faint light bevel under dark stamped glyphs on gray metal. */
function engrave(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
): void {
  ctx.fillStyle = "rgba(255,255,255,0.1)";
  ctx.fillText(text, x, y + 1.5);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** Blinking status indicator: glowing green when online, steady red otherwise. */
function drawStatusDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  isOnline: boolean,
  dotOn: boolean,
): void {
  ctx.save();
  if (isOnline && dotOn) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 2.6);
    glow.addColorStop(0, "rgba(63,221,90,0.55)");
    glow.addColorStop(1, "rgba(63,221,90,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = isOnline ? (dotOn ? "#3fdd5a" : "#2c7a3d") : "#d9534f";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.stroke();
  ctx.restore();
}

/**
 * Render the agent info readout onto the worn-metal backplate's exposed strip:
 * a stamped nameplate (name + role pill) over a spec list (status, org, IP,
 * wallet). Drawn on a transparent canvas so only the engraved text + status dot
 * overlay the 3D metal. `dotOn` toggles the blinking status indicator; the
 * caller redraws on each blink.
 */
export function drawInfoStrip(
  canvas: HTMLCanvasElement,
  opts: DrawInfoStripOptions,
  dotOn: boolean,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const padL = 46;
  const padR = 46;
  const valueX = w - padR;

  // Name (stamped) on the left of the header row.
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.font = `700 46px ${STRIP_SANS}`;
  engrave(ctx, opts.name || "Unnamed", padL, 60, "#15171b");

  // Role pill, right-aligned on the header row.
  const role = (opts.role || "").trim();
  if (role) {
    ctx.font = `600 20px ${STRIP_SANS}`;
    const label = role.toUpperCase();
    const tw = ctx.measureText(label).width;
    const pillPad = 16;
    const pillH = 34;
    const pillW = tw + pillPad * 2;
    const pillX = valueX - pillW;
    const pillY = 34;
    roundRectPath(ctx, pillX, pillY, pillW, pillH, 8);
    ctx.fillStyle = "rgba(16,18,22,0.55)";
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.stroke();
    ctx.fillStyle = "#cdd1d7";
    ctx.fillText(label, pillX + pillPad, pillY + pillH / 2 + 7);
  }

  // Divider with a light bevel below it.
  const divY = 86;
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.moveTo(padL, divY);
  ctx.lineTo(w - padR, divY);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.beginPath();
  ctx.moveTo(padL, divY + 1.5);
  ctx.lineTo(w - padR, divY + 1.5);
  ctx.stroke();

  // Spec rows.
  const rows: Array<{ label: string; value: string; mono?: boolean; status?: boolean }> = [
    { label: "Status", value: opts.statusLabel, status: true },
    { label: "Organization", value: opts.orgName ?? "—" },
    { label: "IP", value: opts.ip ?? "—", mono: true },
    { label: "Wallet", value: opts.wallet ? truncateWallet(opts.wallet) : "—", mono: true },
  ];

  const firstRowY = 124;
  const rowGap = (h - firstRowY - 12) / rows.length;
  rows.forEach((row, i) => {
    const y = firstRowY + rowGap * i + rowGap / 2;

    ctx.textAlign = "left";
    ctx.font = `600 19px ${STRIP_SANS}`;
    engrave(ctx, row.label.toUpperCase(), padL, y, "#8b9098");

    ctx.textAlign = "right";
    ctx.font = row.mono ? `500 26px ${STRIP_MONO}` : `600 26px ${STRIP_SANS}`;
    if (row.status) {
      const tw = ctx.measureText(row.value).width;
      engrave(ctx, row.value, valueX, y, "#1b1d22");
      drawStatusDot(ctx, valueX - tw - 18, y - 8, 7, opts.isOnline, dotOn);
    } else {
      engrave(ctx, row.value, valueX, y, "#1b1d22");
    }
  });

  ctx.textAlign = "left";
}

/**
 * Load an image and resolve it only when it is safe to upload as a WebGL
 * texture (i.e. cross-origin clean). Resolves null on failure or taint.
 */
export function loadCardAvatar(url: string | null | undefined): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!url) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const test = document.createElement("canvas");
        test.width = 1;
        test.height = 1;
        const tctx = test.getContext("2d");
        if (!tctx) {
          resolve(null);
          return;
        }
        tctx.drawImage(img, 0, 0, 1, 1);
        // Throws a SecurityError if the image tainted the canvas.
        tctx.getImageData(0, 0, 1, 1);
        resolve(img);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
