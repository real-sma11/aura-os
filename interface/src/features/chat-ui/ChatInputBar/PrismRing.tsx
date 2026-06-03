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

    // Where the + glyph sits within the canvas (0..1). The canvas is
    // oversized and may not be perfectly centered on the glyph in every
    // layout, so measure it and recenter the ring on the glyph rather
    // than assuming the canvas center.
    let centerX = 0.5;
    let centerY = 0.5;
    const measureCenter = () => {
      const glyph = canvas.parentElement?.querySelector("svg");
      const cr = canvas.getBoundingClientRect();
      if (!glyph || cr.width <= 0 || cr.height <= 0) {
        centerX = 0.5;
        centerY = 0.5;
        return;
      }
      const gr = glyph.getBoundingClientRect();
      centerX = (gr.left + gr.width / 2 - cr.left) / cr.width;
      centerY = (gr.top + gr.height / 2 - cr.top) / cr.height;
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };
    resize();

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(resize)
        : null;
    ro?.observe(canvas);

    let raf = 0;
    const start = performance.now();
    const render = (now: number) => {
      resize();
      measureCenter();
      gl.uniform1f(uTime, (now - start) / 1000);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform2f(uCenter, centerX, centerY);
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
