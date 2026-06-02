import type { Agent } from "../../../shared/types";
import {
  formatAdapterLabel,
  formatAuthSourceLabel,
  formatRunsOnLabel,
} from "./agent-info-utils";

export interface DrawProfileCardOptions {
  agent: Agent;
  /** CSS color string for the accent (read from `--color-accent`). */
  accent: string;
  /** Decoded avatar image, or null when unavailable / CORS-tainted. */
  avatar: HTMLImageElement | null;
  /** Landscape layout when the sidekick is widened / split-screen. */
  horizontal: boolean;
}

const INK = "#e8f1f6";
const INK_DIM = "rgba(220, 234, 242, 0.55)";
const INK_FAINT = "rgba(220, 234, 242, 0.35)";
const SCREEN_BG_TOP = "#0c1116";
const SCREEN_BG_BOTTOM = "#05080b";

interface MetaItem {
  label: string;
  value: string;
}

function metaItems(agent: Agent): MetaItem[] {
  return [
    { label: "Runs On", value: formatRunsOnLabel(agent.environment, agent.machine_type) },
    { label: "Type", value: formatAdapterLabel(agent.adapter_type) },
    { label: "Credentials", value: formatAuthSourceLabel(agent.auth_source, agent.adapter_type) },
    {
      label: "Birthed",
      value: new Date(agent.created_at).toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
      }),
    },
  ];
}

function shortId(agent: Agent): string {
  const id = agent.agent_id ?? "";
  if (id.length <= 10) return id.toUpperCase();
  return `${id.slice(0, 4)}…${id.slice(-4)}`.toUpperCase();
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

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

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) break;
    } else {
      current = candidate;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.slice(0, maxLines);
}

function drawAvatar(
  ctx: CanvasRenderingContext2D,
  opts: DrawProfileCardOptions,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const { agent, avatar, accent } = opts;
  ctx.save();
  roundRect(ctx, x, y, w, h, Math.min(w, h) * 0.08);
  ctx.clip();

  if (avatar) {
    drawImageCover(ctx, avatar, x, y, w, h);
  } else {
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, accent);
    grad.addColorStop(1, "#0a0f14");
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.round(h * 0.34)}px Inter, system-ui, sans-serif`;
    ctx.fillText(initials(agent.name), x + w / 2, y + h / 2);
  }

  // Subtle top-light gradient over the photo for the LCD sheen.
  const sheen = ctx.createLinearGradient(x, y, x, y + h);
  sheen.addColorStop(0, "rgba(255,255,255,0.12)");
  sheen.addColorStop(0.4, "rgba(255,255,255,0)");
  sheen.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = sheen;
  ctx.fillRect(x, y, w, h);
  ctx.restore();

  // Accent frame around the avatar.
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = Math.max(2, w * 0.006);
  roundRect(ctx, x, y, w, h, Math.min(w, h) * 0.08);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawMeta(
  ctx: CanvasRenderingContext2D,
  items: MetaItem[],
  x: number,
  y: number,
  w: number,
  rowH: number,
  cols: number,
  accent: string,
): void {
  const colW = w / cols;
  items.forEach((item, i) => {
    const cx = x + (i % cols) * colW;
    const cy = y + Math.floor(i / cols) * rowH;
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(cx, cy + rowH * 0.18, Math.max(3, w * 0.006), rowH * 0.42);
    ctx.globalAlpha = 1;
    const tx = cx + w * 0.022;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = INK_FAINT;
    ctx.font = `600 ${Math.round(rowH * 0.24)}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.fillText(item.label.toUpperCase(), tx, cy + rowH * 0.36);
    ctx.fillStyle = INK;
    ctx.font = `500 ${Math.round(rowH * 0.3)}px Inter, system-ui, sans-serif`;
    const value = item.value.length > 20 ? `${item.value.slice(0, 19)}…` : item.value;
    ctx.fillText(value, tx, cy + rowH * 0.66);
  });
}

function drawScreenChrome(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  accent: string,
  agent: Agent,
  horizontal: boolean,
): void {
  const pad = w * 0.04;

  // Header chip: //agent + short id.
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = accent;
  ctx.font = `700 ${Math.round(h * 0.022)}px "JetBrains Mono", ui-monospace, monospace`;
  ctx.fillText("// AGENT", pad, pad + h * 0.02);
  ctx.textAlign = "right";
  ctx.fillStyle = INK_DIM;
  ctx.font = `500 ${Math.round(h * 0.02)}px "JetBrains Mono", ui-monospace, monospace`;
  ctx.fillText(shortId(agent), w - pad, pad + h * 0.02);

  // Corner brackets + inner frame only in landscape; in portrait the metal
  // silhouette already supplies the border, so we keep the LCD clean.
  if (!horizontal) return;

  const b = Math.min(w, h) * 0.05;
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = Math.max(2, w * 0.005);
  const corners: Array<[number, number, number, number]> = [
    [pad, pad + h * 0.04, 1, 1],
    [w - pad, pad + h * 0.04, -1, 1],
    [pad, h - pad, 1, -1],
    [w - pad, h - pad, -1, -1],
  ];
  for (const [cx, cy, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx, cy + b * sy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + b * sx, cy);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Inner accent frame.
  ctx.globalAlpha = 0.25;
  roundRect(ctx, pad * 0.6, pad * 0.6, w - pad * 1.2, h - pad * 1.2, w * 0.02);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawScanlines(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(0,0,0,0.16)";
  for (let y = 0; y < h; y += 3) {
    ctx.fillRect(0, y, w, 1);
  }
  // Vignette.
  const vignette = ctx.createRadialGradient(
    w / 2,
    h / 2,
    Math.min(w, h) * 0.25,
    w / 2,
    h / 2,
    Math.max(w, h) * 0.7,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/**
 * Render the agent "LCD" into a 2D canvas. The canvas is uploaded as a Three.js
 * texture, so it must never become CORS-tainted: the avatar is only drawn when
 * the caller verified it is cross-origin clean (otherwise `avatar` is null and a
 * generated fallback is used).
 */
export function drawProfileCardTexture(
  canvas: HTMLCanvasElement,
  opts: DrawProfileCardOptions,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const { agent, accent, horizontal } = opts;

  ctx.clearRect(0, 0, w, h);

  // Background.
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, SCREEN_BG_TOP);
  bg.addColorStop(1, SCREEN_BG_BOTTOM);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Faint accent wash from the top.
  ctx.save();
  ctx.globalAlpha = 0.14;
  const wash = ctx.createRadialGradient(w * 0.5, 0, 0, w * 0.5, 0, h * 0.9);
  wash.addColorStop(0, accent);
  wash.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  const pad = w * 0.06;
  const items = metaItems(agent);

  if (horizontal) {
    const avatarSize = h - pad * 2 - h * 0.06;
    const ax = pad;
    const ay = pad + h * 0.06;
    drawAvatar(ctx, opts, ax, ay, avatarSize, avatarSize);

    const rx = ax + avatarSize + pad;
    const rw = w - rx - pad;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = INK;
    ctx.font = `800 ${Math.round(h * 0.12)}px Inter, system-ui, sans-serif`;
    const nameLines = wrapText(ctx, agent.name, rw, 2);
    let ny = ay + h * 0.12;
    for (const line of nameLines) {
      ctx.fillText(line, rx, ny);
      ny += h * 0.13;
    }
    if (agent.role) {
      ctx.fillStyle = accent;
      ctx.font = `600 ${Math.round(h * 0.045)}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.fillText(agent.role.toUpperCase(), rx, ny);
      ny += h * 0.06;
    }
    drawMeta(ctx, items, rx, ny + h * 0.02, rw, h * 0.16, 2, accent);
  } else {
    const avatarH = h * 0.4;
    drawAvatar(ctx, opts, pad, pad + h * 0.05, w - pad * 2, avatarH);

    let ny = pad + h * 0.05 + avatarH + h * 0.08;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = INK;
    ctx.font = `800 ${Math.round(w * 0.11)}px Inter, system-ui, sans-serif`;
    const nameLines = wrapText(ctx, agent.name, w - pad * 2, 2);
    for (const line of nameLines) {
      ctx.fillText(line, pad, ny);
      ny += w * 0.115;
    }
    if (agent.role) {
      ctx.fillStyle = accent;
      ctx.font = `600 ${Math.round(w * 0.04)}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.fillText(agent.role.toUpperCase(), pad, ny);
      ny += w * 0.05;
    }
    drawMeta(ctx, items, pad, ny + h * 0.02, w - pad * 2, h * 0.1, 2, accent);
  }

  drawScreenChrome(ctx, w, h, accent, agent, horizontal);
  drawScanlines(ctx, w, h);
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
