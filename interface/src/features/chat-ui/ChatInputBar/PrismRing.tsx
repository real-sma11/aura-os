import { useEffect, useRef, useState } from "react";

/**
 * Animated WebGL prism ring rendered behind the chat "+" attach button.
 *
 * A single full-screen quad runs a fragment shader that self-masks to a
 * donut and paints a fully iridescent ring whose bright highlight pulses
 * and sweeps around the circle — a "prism reflecting a mirror" feel. The
 * canvas is tiny (~45px) so the per-frame cost is trivial; the loop
 * pauses while the tab is hidden.
 *
 * Degrades gracefully: when WebGL is unavailable the component leaves the
 * static CSS conic-gradient ring (`button.attachRing::after`) visible as a
 * fallback. The canvas reports `data-prism="on"` only once it is actually
 * rendering, so the fallback is hidden exactly when the live ring takes
 * over (see the `:has()` rule in ChatInputBar.module.css).
 */

const VERT_SRC = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAG_SRC = `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform vec2 uRes;
uniform vec2 uCenter;

vec3 palette(float t) {
  return 0.5 + 0.5 * cos(6.2831853 * (t + vec3(0.0, 0.33, 0.67)));
}

void main() {
  // Center the ring on the + glyph (uCenter, in 0..1 canvas space) and
  // aspect-correct so it stays a circle even if the buffer isn't square.
  vec2 p = (vUv - uCenter) * 2.0;
  p.x *= uRes.x / max(uRes.y, 1.0);

  float r = length(p);
  float a = atan(p.y, p.x);

  // Clean thin band; alpha is 0 everywhere off the band, so the disc
  // and the + glyph in the center stay fully visible.
  float ringR = 0.7;
  float ringW = 0.16;
  float band = smoothstep(ringW, ringW * 0.35, abs(r - ringR));

  // Iridescent color sweeps slowly around the ring.
  float hue = a / 6.2831853 + uTime * 0.05;
  vec3 col = palette(hue);

  // Bright highlight arc rotating around the ring + overall pulse.
  float hi = pow(0.5 + 0.5 * cos(a - uTime * 1.5), 3.0);
  float pulse = 0.75 + 0.25 * sin(uTime * 2.2);
  vec3 outc = col * (0.45 + 1.15 * hi) * pulse;

  gl_FragColor = vec4(outc, band);
}
`;

function compile(
  gl: WebGLRenderingContext,
  type: number,
  src: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function PrismRing({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = (canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: false,
      antialias: true,
    }) ||
      canvas.getContext(
        "experimental-webgl",
      )) as WebGLRenderingContext | null;
    if (!gl) return;

    const vert = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
    const frag = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vert || !frag) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return;
    }

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );

    const aPos = gl.getAttribLocation(program, "aPos");
    const uTime = gl.getUniformLocation(program, "uTime");
    const uRes = gl.getUniformLocation(program, "uRes");
    const uCenter = gl.getUniformLocation(program, "uCenter");

    gl.useProgram(program);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    setActive(true);

    // Margin (css px) added around the host button so the ring + a little
    // glow always has room inside the canvas.
    const MARGIN = 8;
    let bufW = 1;
    let bufH = 1;
    let lastLeft = NaN;
    let lastTop = NaN;
    let lastSize = NaN;

    // Lay the canvas out as a square centered on the + glyph. Sizing and
    // positioning happen in JS (relative to the canvas's real
    // offsetParent) because a <canvas> is a replaced element whose CSS
    // `calc()` width / inset can resolve unexpectedly, leaving the ring
    // off-center and clipped by the canvas edge.
    const layout = () => {
      const btn = canvas.parentElement;
      const op = canvas.offsetParent as HTMLElement | null;
      const glyph = btn?.querySelector("svg");
      if (!btn || !op) return;
      const btnRect = btn.getBoundingClientRect();
      if (btnRect.width <= 0 || btnRect.height <= 0) return;
      const target = glyph ?? btn;
      const tRect = target.getBoundingClientRect();
      const opRect = op.getBoundingClientRect();

      const size = Math.round(Math.max(btnRect.width, btnRect.height)) + MARGIN * 2;
      // Glyph center expressed in the offsetParent's padding-box coords.
      const gx = tRect.left + tRect.width / 2 - opRect.left - op.clientLeft;
      const gy = tRect.top + tRect.height / 2 - opRect.top - op.clientTop;
      const left = Math.round(gx - size / 2);
      const top = Math.round(gy - size / 2);

      if (left !== lastLeft || top !== lastTop || size !== lastSize) {
        lastLeft = left;
        lastTop = top;
        lastSize = size;
        canvas.style.left = left + "px";
        canvas.style.top = top + "px";
        canvas.style.width = size + "px";
        canvas.style.height = size + "px";
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const buf = Math.max(1, Math.round(size * dpr));
        canvas.width = buf;
        canvas.height = buf;
        bufW = buf;
        bufH = buf;
        gl.viewport(0, 0, buf, buf);
      }
    };
    layout();

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(layout)
        : null;
    // Observe the host button (not the canvas, whose size we drive) so a
    // resize of the input bar re-lays-out the ring.
    if (canvas.parentElement) ro?.observe(canvas.parentElement);
    window.addEventListener("resize", layout);

    let raf = 0;
    const start = performance.now();
    const render = (now: number) => {
      layout();
      gl.uniform1f(uTime, (now - start) / 1000);
      gl.uniform2f(uRes, bufW, bufH);
      // Canvas is centered on the glyph, so the ring centers at (0.5,0.5).
      gl.uniform2f(uCenter, 0.5, 0.5);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(render);
    };
    const play = () => {
      if (!raf) raf = requestAnimationFrame(render);
    };
    const pause = () => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
    const onVisibility = () => {
      if (document.hidden) pause();
      else play();
    };
    document.addEventListener("visibilitychange", onVisibility);
    play();

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", layout);
      pause();
      ro?.disconnect();
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vert);
      gl.deleteShader(frag);
      setActive(false);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      data-prism={active ? "on" : "off"}
      aria-hidden="true"
    />
  );
}
