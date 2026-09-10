/*
 * Infinite Hole — a spinning perspective tunnel of instanced box frames,
 * rendered with raw WebGL2. Ported from the Originkit "Infinite Hole" React
 * component to plain JS (this project has no React/build step); the effect
 * itself never touched React beyond prop plumbing and pointer handlers, so
 * the WebGL setup and render loop are carried over as-is.
 */

const SHIFT0 = 3;
const LOOK_AT = [0, 0, 1];
const NEAR = 1;
const FAR = 1000;
const SPEED_REFERENCE = 50;
const MAX_DT = 0.05;
const MAX_DPR = 2;
const MAX_COLORS = 8;

const DEFAULTS = {
  backgroundInner: "#f5f5f5",
  backgroundOuter: "#e5e5e5",
  color: "#FFFFFF",
  colors: ["#8B00FF", "#FF00C9"],
  colorSpread: 8,
  columns: 93,
  rows: 36,
  thickness: 3,
  speed: 38,
  spin: 15,
  distance: 34,
  camera: { cameraHeight: 6, perspective: 60 },
  hole: { layers: 2, depth: 100, falloff: 2 },
  waveGroup: { wave: 100, ripple: 100 },
  interaction: { hoverSpeed: 160, clickPulse: 160, transition: { duration: 0.6 } },
};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function parseColor(input, fallback) {
  if (!input) return fallback;
  const s = input.trim();

  if (s[0] === "#") {
    const hex = s.slice(1);
    const short = hex.length === 3 || hex.length === 4;
    const long = hex.length === 6 || hex.length === 8;
    if (!short && !long) return fallback;
    const grab = (i) => (short ? parseInt(hex[i] + hex[i], 16) : parseInt(hex.slice(i * 2, i * 2 + 2), 16));
    const r = grab(0);
    const g = grab(1);
    const b = grab(2);
    if ([r, g, b].some(Number.isNaN)) return fallback;
    return [r / 255, g / 255, b / 255];
  }

  const rgb = s.match(/rgba?\(([^)]+)\)/i);
  if (rgb) {
    const p = rgb[1].split(/[,/\s]+/).map((v) => parseFloat(v));
    if (p.length >= 3 && p.slice(0, 3).every((v) => !Number.isNaN(v))) {
      return [p[0] / 255, p[1] / 255, p[2] / 255];
    }
  }

  const hsl = s.match(/hsla?\(([^)]+)\)/i);
  if (hsl) {
    const p = hsl[1].split(/[,/\s]+/).map((v) => parseFloat(v));
    if (p.length >= 3 && p.slice(0, 3).every((v) => !Number.isNaN(v))) {
      const h = (((p[0] % 360) + 360) % 360) / 360;
      const sat = clamp(p[1] / 100, 0, 1);
      const li = clamp(p[2] / 100, 0, 1);
      const c = (1 - Math.abs(2 * li - 1)) * sat;
      const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
      const m = li - c / 2;
      const seg = Math.floor(h * 6) % 6;
      const t =
        seg === 0
          ? [c, x, 0]
          : seg === 1
            ? [x, c, 0]
            : seg === 2
              ? [0, c, x]
              : seg === 3
                ? [0, x, c]
                : seg === 4
                  ? [x, 0, c]
                  : [c, 0, x];
      return [t[0] + m, t[1] + m, t[2] + m];
    }
  }

  return fallback;
}

function perspective(fovDeg, aspect) {
  const f = 1 / Math.tan((fovDeg * Math.PI) / 360);
  const nf = 1 / (NEAR - FAR);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (FAR + NEAR) * nf;
  m[11] = -1;
  m[14] = 2 * FAR * NEAR * nf;
  return m;
}

function lookAt(eye, center, up) {
  let zx = eye[0] - center[0];
  let zy = eye[1] - center[1];
  let zz = eye[2] - center[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len;
  zy /= len;
  zz /= len;

  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz) || 1;
  xx /= len;
  xy /= len;
  xz /= len;

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  const m = new Float32Array(16);
  m[0] = xx;
  m[1] = yx;
  m[2] = zx;
  m[4] = xy;
  m[5] = yy;
  m[6] = zy;
  m[8] = xz;
  m[9] = yz;
  m[10] = zz;
  m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  m[15] = 1;
  return m;
}

function multiply(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

function rotationY(rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const m = new Float32Array(16);
  m[0] = c;
  m[2] = -s;
  m[5] = 1;
  m[8] = s;
  m[10] = c;
  m[15] = 1;
  return m;
}

function unitBox() {
  const position = [];
  const uv = [];
  const index = [];

  const faces = [
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, -1] },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  ];

  for (const f of faces) {
    const base = position.length / 3;
    for (const [su, sv] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      position.push(
        (f.n[0] + su * f.u[0] + sv * f.v[0]) * 0.5,
        (f.n[1] + su * f.u[1] + sv * f.v[1]) * 0.5,
        (f.n[2] + su * f.u[2] + sv * f.v[2]) * 0.5
      );
      uv.push((su + 1) * 0.5, (sv + 1) * 0.5);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  return {
    position: new Float32Array(position),
    uv: new Float32Array(uv),
    index: new Uint16Array(index),
  };
}

function instanceData(rows, columns, layers) {
  const out = new Float32Array(rows * columns * layers * 3);
  let n = 0;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < layers; j++) {
      for (let k = 0; k < columns; k++) {
        out[n++] = i;
        out[n++] = k;
        out[n++] = j;
      }
    }
  }
  return out;
}

const VERT = `#version 300 es
precision highp float;

in vec3 aPosition;
in vec2 aUv;
in vec3 aRcl;

uniform mat4 uProjection;
uniform mat4 uModelView;
uniform float uArc;
uniform float uShift;
uniform float uPhase;
uniform float uSeam;
uniform float uDepth;
uniform float uFalloff;
uniform float uWave;
uniform float uRipple;
uniform vec3 uColors[8];
uniform int uColorCount;
uniform float uColorSpread;

out vec2 vUv;
out vec3 vColor;

void main() {
    float radius = uShift;
    float zShift = 0.0;
    int row = int(aRcl.x + 0.5);
    for (int i = 0; i < row; i++) {
        radius += radius * uArc;
        zShift += radius * uArc;
    }

    vec4 p = vec4(aPosition, 1.0);

    if (p.z > 0.0) radius += radius * uArc;

    p.xz *= radius * uArc;

    p.z += zShift + uShift - uSeam;

    float c = aRcl.y * uRipple;
    float wave = sin(c / 5.3) * 1.1 + sin(c / 1.3) * 1.5 + cos(c / 1.7) * 2.5;
    wave *= uWave;

    float t = uFalloff - aRcl.x + abs(wave) + uPhase;
    t += aRcl.z * abs(sin(aRcl.y));
    t = max(t, 0.0);
    p.y -= t * t * t * uDepth + aRcl.z;

    float a = aRcl.y * uArc;
    float sn = sin(a);
    float cs = cos(a);
    p.xz = p.xz * mat2(cs, -sn, sn, cs);

    float span = uColorSpread > 0.0
        ? mod(aRcl.x, uColorSpread) / uColorSpread * float(uColorCount)
        : 0.0;
    float idxF = floor(span);
    float fracT = span - idxF;
    int i0 = int(mod(idxF, float(uColorCount)));
    int i1 = int(mod(idxF + 1.0, float(uColorCount)));
    vec3 c0 = uColors[0];
    vec3 c1 = uColors[0];
    for (int k = 0; k < 8; k++) {
        if (k == i0) c0 = uColors[k];
        if (k == i1) c1 = uColors[k];
    }
    vColor = mix(c0, c1, fracT);

    vUv = aUv;
    gl_Position = uProjection * uModelView * p;
}
`;

const FRAG = `#version 300 es
precision highp float;

in vec2 vUv;
in vec3 vColor;

uniform vec3 uBgInner;
uniform vec3 uBgOuter;
uniform vec2 uResolution;
uniform float uThickness;

out vec4 fragColor;

void main() {
    float d = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float aa = max(fwidth(d), 1e-5);
    float frame = 1.0 - smoothstep(uThickness - aa, uThickness + aa, d);

    vec2 screenUv = gl_FragCoord.xy / uResolution;
    float dist = distance(screenUv, vec2(0.5));
    vec3 background = mix(uBgInner, uBgOuter, clamp(dist * 1.6, 0.0, 1.0));

    fragColor = vec4(mix(background, vColor, frame), 1.0);
}
`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error("InfiniteHole shader:", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

class InfiniteHoleScene {
  constructor(container, cfg) {
    this.container = container;
    this.live = cfg;
    this.disposed = false;

    this.hover = 0;
    this.hoverAmt = 0;
    this.pulse = 0;
    this.geom = { rows: -1, columns: -1, layers: -1 };

    this.canvas = document.createElement("canvas");
    this.canvas.style.position = "absolute";
    this.canvas.style.inset = "0";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.display = "block";
    container.appendChild(this.canvas);

    const gl = this.canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
    });
    if (!gl) throw new Error("no webgl2 context");
    this.gl = gl;

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) throw new Error("shader compile failed");

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("InfiniteHole link:", gl.getProgramInfoLog(program));
      throw new Error("program link failed");
    }
    gl.useProgram(program);
    this.program = program;

    this.U = {
      projection: gl.getUniformLocation(program, "uProjection"),
      modelView: gl.getUniformLocation(program, "uModelView"),
      arc: gl.getUniformLocation(program, "uArc"),
      shift: gl.getUniformLocation(program, "uShift"),
      phase: gl.getUniformLocation(program, "uPhase"),
      seam: gl.getUniformLocation(program, "uSeam"),
      depth: gl.getUniformLocation(program, "uDepth"),
      falloff: gl.getUniformLocation(program, "uFalloff"),
      wave: gl.getUniformLocation(program, "uWave"),
      ripple: gl.getUniformLocation(program, "uRipple"),
      colors: gl.getUniformLocation(program, "uColors[0]"),
      colorCount: gl.getUniformLocation(program, "uColorCount"),
      colorSpread: gl.getUniformLocation(program, "uColorSpread"),
      bgInner: gl.getUniformLocation(program, "uBgInner"),
      bgOuter: gl.getUniformLocation(program, "uBgOuter"),
      resolution: gl.getUniformLocation(program, "uResolution"),
      thickness: gl.getUniformLocation(program, "uThickness"),
    };

    const box = unitBox();
    this.box = box;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, box.position, gl.STATIC_DRAW);
    const aPosition = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, 0, 0);

    const uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, box.uv, gl.STATIC_DRAW);
    const aUv = gl.getAttribLocation(program, "aUv");
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);

    this.rclBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rclBuf);
    const aRcl = gl.getAttribLocation(program, "aRcl");
    gl.enableVertexAttribArray(aRcl);
    gl.vertexAttribPointer(aRcl, 3, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(aRcl, 1);

    const idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, box.index, gl.STATIC_DRAW);

    this.vao = vao;
    this.instances = 0;

    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);

    this.cssW = 0;
    this.cssH = 0;

    this.onPointerEnter = () => {
      this.hover = 1;
    };
    this.onPointerLeave = () => {
      this.hover = 0;
    };
    this.onPointerDown = () => {
      this.pulse = 1;
    };
    container.addEventListener("pointerenter", this.onPointerEnter);
    container.addEventListener("pointerleave", this.onPointerLeave);
    container.addEventListener("pointerdown", this.onPointerDown);

    this.resize = this.resize.bind(this);
    this.resize();
    this.ro = new ResizeObserver(this.resize);
    this.ro.observe(this.canvas);

    this.last = performance.now();
    this.cycles = 0;
    this.angle = 0;
    this.frameId = 0;
  }

  resize() {
    const canvas = this.canvas;
    const gl = this.gl;
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const bw = Math.max(1, Math.round(w * dpr));
    const bh = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    this.cssW = w;
    this.cssH = h;
    gl.viewport(0, 0, bw, bh);
  }

  rebuild(r, c, l) {
    const gl = this.gl;
    const data = instanceData(r, c, l);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rclBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.instances = r * c * l;
    this.geom = { rows: r, columns: c, layers: l };
  }

  updateConfig(cfg) {
    if (this.disposed) return;
    this.live = cfg;
  }

  tick(now) {
    const gl = this.gl;
    const dt = clamp((now - this.last) / 1000, 0, MAX_DT);
    this.last = now;

    const L = this.live;

    const transDur =
      typeof L.interaction.transition?.duration === "number" && L.interaction.transition.duration > 0
        ? L.interaction.transition.duration
        : 0.4;
    this.hoverAmt += (this.hover - this.hoverAmt) * (1 - Math.exp(-dt / (transDur * 0.5)));
    this.pulse *= Math.exp(-dt / (transDur * 0.6));
    if (this.pulse < 0.001) this.pulse = 0;
    const hoverAmt = this.hoverAmt;
    const pulseAmt = this.pulse;
    const hoverSpeedFactor = 1 + hoverAmt * (clamp(L.interaction.hoverSpeed, 0, 400) / 100 - 1);
    const clickPulseFactor = 1 + pulseAmt * (clamp(L.interaction.clickPulse, 0, 400) / 100 - 1);

    const cols = Math.max(3, Math.round(L.columns));
    const rws = Math.max(1, Math.round(L.rows));
    const lyrs = Math.max(1, Math.round(L.hole.layers));

    const g = this.geom;
    if (g.rows !== rws || g.columns !== cols || g.layers !== lyrs) {
      this.rebuild(rws, cols, lyrs);
    }

    this.cycles = (this.cycles + dt * ((L.speed * hoverSpeedFactor) / SPEED_REFERENCE)) % 1;
    this.angle = (this.angle + dt * ((L.spin * Math.PI) / 180)) % (Math.PI * 2);

    const arc = (2 * Math.PI) / cols;
    const step = (SHIFT0 * arc) / (1 + arc);
    const shift = SHIFT0 - this.cycles * step;

    const eye = [0, L.camera.cameraHeight, L.distance - hoverAmt * (L.distance * 0.15)];
    const view = lookAt(eye, LOOK_AT, [0, 1, 0]);
    const modelView = multiply(view, rotationY(this.angle));
    const proj = perspective(clamp(L.camera.perspective, 5, 175), Math.max(this.cssW, 1) / Math.max(this.cssH, 1));

    const stops = [L.color, ...(Array.isArray(L.colors) ? L.colors : [])].slice(0, MAX_COLORS);
    const colorCount = Math.max(1, stops.length);
    const colorsFlat = new Float32Array(MAX_COLORS * 3);
    for (let i = 0; i < MAX_COLORS; i++) {
      const c = parseColor(stops[i % colorCount], [1, 1, 1]);
      colorsFlat[i * 3] = c[0];
      colorsFlat[i * 3 + 1] = c[1];
      colorsFlat[i * 3 + 2] = c[2];
    }
    const bgInner = parseColor(L.backgroundInner, [1, 1, 1]);
    const bgOuter = parseColor(L.backgroundOuter, [0.9, 0.9, 0.9]);

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(this.U.projection, false, proj);
    gl.uniformMatrix4fv(this.U.modelView, false, modelView);
    gl.uniform1f(this.U.arc, arc);
    gl.uniform1f(this.U.shift, shift);
    gl.uniform1f(this.U.phase, this.cycles);
    gl.uniform1f(this.U.seam, (SHIFT0 - shift) * arc);
    gl.uniform1f(this.U.depth, (Math.max(0, L.hole.depth) / 100) * clickPulseFactor);
    gl.uniform1f(this.U.falloff, L.hole.falloff);
    gl.uniform1f(this.U.wave, (Math.max(0, L.waveGroup.wave) / 100) * clickPulseFactor);
    gl.uniform1f(this.U.ripple, Math.max(0, L.waveGroup.ripple) / 100);
    gl.uniform3fv(this.U.colors, colorsFlat);
    gl.uniform1i(this.U.colorCount, colorCount);
    gl.uniform1f(this.U.colorSpread, Math.max(0.0001, L.colorSpread));
    gl.uniform3f(this.U.bgInner, bgInner[0], bgInner[1], bgInner[2]);
    gl.uniform3f(this.U.bgOuter, bgOuter[0], bgOuter[1], bgOuter[2]);
    gl.uniform2f(this.U.resolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.U.thickness, clamp((clamp(L.thickness, 0, 49) / 100) * (1 + pulseAmt * 0.4), 0, 0.5));

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.drawElementsInstanced(gl.TRIANGLES, this.box.index.length, gl.UNSIGNED_SHORT, 0, this.instances);
  }

  start() {
    this.last = performance.now();
    const loop = (now) => {
      this.tick(now);
      this.frameId = requestAnimationFrame(loop);
    };
    this.frameId = requestAnimationFrame(loop);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    this.ro.disconnect();
    this.container.removeEventListener("pointerenter", this.onPointerEnter);
    this.container.removeEventListener("pointerleave", this.onPointerLeave);
    this.container.removeEventListener("pointerdown", this.onPointerDown);
    if (this.canvas.parentNode === this.container) {
      this.container.removeChild(this.canvas);
    }
  }
}

function mergeConfig(cfg) {
  return {
    ...DEFAULTS,
    ...cfg,
    camera: { ...DEFAULTS.camera, ...(cfg.camera || {}) },
    hole: { ...DEFAULTS.hole, ...(cfg.hole || {}) },
    waveGroup: { ...DEFAULTS.waveGroup, ...(cfg.waveGroup || {}) },
    interaction: {
      ...DEFAULTS.interaction,
      ...(cfg.interaction || {}),
      transition: { ...DEFAULTS.interaction.transition, ...((cfg.interaction && cfg.interaction.transition) || {}) },
    },
  };
}

/**
 * Mounts an Infinite Hole scene into `container`, filling it, applying the
 * `background` color to the container itself (matching the original
 * component's own inline style), and keeps the canvas sized to the
 * container. Returns a dispose function.
 */
export function mountInfiniteHole(container, cfg = {}) {
  const config = mergeConfig(cfg);
  container.style.cursor = "pointer";
  const scene = new InfiniteHoleScene(container, config);
  scene.start();
  return () => scene.dispose();
}
