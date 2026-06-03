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
  /** Drives the status dot color (accent when online, red otherwise). */
  isOnline: boolean;
  orgName: string | null;
  ip: string | null;
  wallet: string | null;
  /** Theme accent (CSS color) used for the online status dot + glow. */
  accent: string;
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

/** Embossed light text: a dark drop shadow under bright glyphs for contrast on the dark metal. */
function engrave(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
): void {
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillText(text, x, y + 3);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
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

  const accent = parseAccent(opts.accent);
  const padL = 84;
  const padR = 84;
  const valueX = w - padR;

  // Name (stamped) on the left of the header row.
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.font = `700 154px ${STRIP_SANS}`;
  engrave(ctx, opts.name || "Unnamed", padL, 162, "#f4f6f9");

  // Role pill, right-aligned on the header row.
  const role = (opts.role || "").trim();
  if (role) {
    ctx.font = `600 60px ${STRIP_SANS}`;
    const label = role.toUpperCase();
    const tw = ctx.measureText(label).width;
    const pillPad = 48;
    const pillH = 103;
    const pillW = tw + pillPad * 2;
    const pillX = valueX - pillW;
    const pillY = 74;
    roundRectPath(ctx, pillX, pillY, pillW, pillH, 24);
    ctx.fillStyle = "rgba(8,10,13,0.7)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.stroke();
    ctx.fillStyle = "#eef1f5";
    ctx.fillText(label, pillX + pillPad, pillY + pillH / 2 + 22);
  }

  // Divider: a dark groove with a light bevel below it.
  const divY = 230;
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.beginPath();
  ctx.moveTo(padL, divY);
  ctx.lineTo(w - padR, divY);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.beginPath();
  ctx.moveTo(padL, divY + 3);
  ctx.lineTo(w - padR, divY + 3);
  ctx.stroke();

  // Spec rows.
  const rows: Array<{ label: string; value: string; mono?: boolean; status?: boolean }> = [
    { label: "Status", value: opts.statusLabel, status: true },
    { label: "Organization", value: opts.orgName ?? "—" },
    { label: "IP", value: opts.ip ?? "—", mono: true },
    { label: "Wallet", value: opts.wallet ? truncateWallet(opts.wallet) : "—", mono: true },
  ];

  const firstRowY = 300;
  const rowGap = (h - firstRowY - 30) / rows.length;
  rows.forEach((row, i) => {
    const y = firstRowY + rowGap * i + rowGap / 2;

    ctx.textAlign = "left";
    ctx.font = `600 58px ${STRIP_SANS}`;
    engrave(ctx, row.label.toUpperCase(), padL, y, "#aab1ba");

    ctx.textAlign = "right";
    ctx.font = row.mono ? `500 56px ${STRIP_MONO}` : `600 66px ${STRIP_SANS}`;
    if (row.status && opts.isOnline) {
      // Online: match the accent LED "dots" above - a saturated accent core with
      // a gently pulsing colored glow. The accent is kept a touch below full so
      // the card's ACES tone mapping doesn't wash it toward white.
      const [ar, ag, ab] = accent;
      const k = 0.72;
      ctx.save();
      ctx.shadowColor = `rgba(${ar},${ag},${ab},${dotOn ? 0.65 : 0.45})`;
      ctx.shadowBlur = dotOn ? 13 : 9;
      ctx.fillStyle = `rgb(${Math.round(ar * k)},${Math.round(ag * k)},${Math.round(ab * k)})`;
      ctx.fillText(row.value, valueX, y);
      ctx.restore();
    } else if (row.status) {
      engrave(ctx, row.value, valueX, y, "#e06a66");
    } else {
      engrave(ctx, row.value, valueX, y, "#f4f6f9");
    }
  });

  ctx.textAlign = "left";
}

/**
 * Single-path brand logos (24x24 viewBox, simple-icons) drawn into the recessed
 * channel pill. Kept monochrome and engraved (not full brand color) so they read
 * as stamped into the worn metal under the card's ACES tone mapping.
 */
const BRAND_ICONS: Array<{ name: string; path: string }> = [
  {
    name: "Telegram",
    path: "M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z",
  },
  {
    name: "WhatsApp",
    path: "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z",
  },
  {
    name: "Signal",
    path: "M12 0q-.934 0-1.83.139l.17 1.111a11 11 0 0 1 3.32 0l.172-1.111A12 12 0 0 0 12 0M9.152.34A12 12 0 0 0 5.77 1.742l.584.961a10.8 10.8 0 0 1 3.066-1.27zm5.696 0-.268 1.094a10.8 10.8 0 0 1 3.066 1.27l.584-.962A12 12 0 0 0 14.848.34M12 2.25a9.75 9.75 0 0 0-8.539 14.459c.074.134.1.292.064.441l-1.013 4.338 4.338-1.013a.62.62 0 0 1 .441.064A9.7 9.7 0 0 0 12 21.75c5.385 0 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25m-7.092.068a12 12 0 0 0-2.59 2.59l.909.664a11 11 0 0 1 2.345-2.345zm14.184 0-.664.909a11 11 0 0 1 2.345 2.345l.909-.664a12 12 0 0 0-2.59-2.59M1.742 5.77A12 12 0 0 0 .34 9.152l1.094.268a10.8 10.8 0 0 1 1.269-3.066zm20.516 0-.961.584a10.8 10.8 0 0 1 1.27 3.066l1.093-.268a12 12 0 0 0-1.402-3.383M.138 10.168A12 12 0 0 0 0 12q0 .934.139 1.83l1.111-.17A11 11 0 0 1 1.125 12q0-.848.125-1.66zm23.723.002-1.111.17q.125.812.125 1.66c0 .848-.042 1.12-.125 1.66l1.111.172a12.1 12.1 0 0 0 0-3.662M1.434 14.58l-1.094.268a12 12 0 0 0 .96 2.591l-.265 1.14 1.096.255.36-1.539-.188-.365a10.8 10.8 0 0 1-.87-2.35m21.133 0a10.8 10.8 0 0 1-1.27 3.067l.962.584a12 12 0 0 0 1.402-3.383zm-1.793 3.848a11 11 0 0 1-2.345 2.345l.664.909a12 12 0 0 0 2.59-2.59zm-19.959 1.1L.357 21.48a1.8 1.8 0 0 0 2.162 2.161l1.954-.455-.256-1.095-1.953.455a.675.675 0 0 1-.81-.81l.454-1.954zm16.832 1.769a10.8 10.8 0 0 1-3.066 1.27l.268 1.093a12 12 0 0 0 3.382-1.402zm-10.94.213-1.54.36.256 1.095 1.139-.266c.814.415 1.683.74 2.591.961l.268-1.094a10.8 10.8 0 0 1-2.35-.869zm3.634 1.24-.172 1.111a12.1 12.1 0 0 0 3.662 0l-.17-1.111q-.812.125-1.66.125a11 11 0 0 1-1.66-.125",
  },
  {
    name: "Discord",
    path: "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z",
  },
  {
    name: "Slack",
    path: "M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z",
  },
];

/**
 * Draw the messaging-channel brand logos into the (transparent) pill canvas:
 * the icons are spaced evenly across the width and each is rendered engraved —
 * a dark, offset silhouette beneath a light one — so they read as stamped into
 * the recessed metal pocket. A faint inner-shadow vignette deepens the recess.
 */
export function drawChannelStrip(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Inner-shadow vignette: darken the rounded edges so the pocket reads recessed.
  const inset = h * 0.12;
  const vignette = ctx.createRadialGradient(
    w / 2,
    h / 2,
    Math.min(w, h) * 0.2,
    w / 2,
    h / 2,
    Math.max(w / 2, h / 2),
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);

  const count = BRAND_ICONS.length;
  // Square slots laid out across the available width, capped by the height.
  const slotW = (w - inset * 2) / count;
  const glyph = Math.min(slotW * 0.62, h * 0.6);
  const scale = glyph / 24;
  const cy = h / 2;

  BRAND_ICONS.forEach((icon, i) => {
    const cx = inset + slotW * (i + 0.5);
    const path = new Path2D(icon.path);
    ctx.save();
    ctx.translate(cx - glyph / 2, cy - glyph / 2);
    ctx.scale(scale, scale);
    // Dark drop silhouette (engraved shadow), nudged down a touch.
    ctx.translate(0, 2);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fill(path);
    // Light glyph on top.
    ctx.translate(0, -2);
    ctx.fillStyle = "#cdd3da";
    ctx.fill(path);
    ctx.restore();
  });
}

export interface InfoLink {
  label: string;
  count: number;
}

/**
 * Render the navigation links onto the lower part of the backplate: one row per
 * link with the label on the left and its count on the right, a subtle groove
 * between rows, and an accent-tinted highlight on the hovered row.
 */
export function drawInfoLinks(
  canvas: HTMLCanvasElement,
  links: InfoLink[],
  hovered: number,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (links.length === 0) return;

  const padL = 84;
  const padR = 84;
  const valueX = w - padR;
  const rowH = h / links.length;

  ctx.textBaseline = "middle";
  links.forEach((link, i) => {
    const top = i * rowH;
    const cy = top + rowH / 2;
    const isHover = i === hovered;

    if (i < links.length - 1) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.beginPath();
      ctx.moveTo(padL, top + rowH);
      ctx.lineTo(w - padR, top + rowH);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.beginPath();
      ctx.moveTo(padL, top + rowH + 2);
      ctx.lineTo(w - padR, top + rowH + 2);
      ctx.stroke();
    }

    ctx.save();
    // On hover, glow the text brighter instead of tinting the row.
    if (isHover) {
      ctx.shadowColor = "rgba(214,232,255,0.55)";
      ctx.shadowBlur = 16;
    }
    ctx.textAlign = "left";
    ctx.font = `600 64px ${STRIP_SANS}`;
    if (isHover) {
      ctx.fillStyle = "#ffffff";
      ctx.fillText(link.label, padL, cy);
    } else {
      engrave(ctx, link.label, padL, cy, "#dfe3e8");
    }

    ctx.textAlign = "right";
    ctx.font = `600 58px ${STRIP_SANS}`;
    if (isHover) {
      ctx.fillStyle = "#eef1f5";
      ctx.fillText(String(link.count), valueX, cy);
    } else {
      engrave(ctx, String(link.count), valueX, cy, "#9aa0a8");
    }
    ctx.restore();
  });

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
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
