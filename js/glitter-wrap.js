/*
 * Glitter Wrap — a starfield of glinting particles drifting past the camera.
 * Ported from the Originkit "Glitter Wrap" React component to plain JS/canvas
 * (this project has no React/build step, so the effect is driven directly by
 * a mount function against a DOM container, same as vortex-dust.js).
 */

const DEFAULTS = {
  particleCount: 500,
  color1: "#ffffff",
  color2: "#FF0000",
  color3: "#FFE500",
  speed: 5,
  density: 100,
  starSize: 20,
  focalDepth: 13,
  turbulence: 0,
  brightness: 100,
  glitterIntensity: 3,
  trailAmount: 100,
  reverse: false,
};

function parseColor(input) {
  if (!input) return [255, 255, 255, 1];
  const s = input.trim();
  if (s.startsWith("#")) {
    let hex = s.slice(1);
    if (hex.length === 3) {
      hex = hex
        .split("")
        .map((c) => c + c)
        .join("");
    }
    const num = parseInt(hex, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255, 1];
  }
  const m = s.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const parts = m[1].split(",").map((p) => parseFloat(p.trim()));
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0, parts[3] == null ? 1 : parts[3]];
  }
  return [255, 255, 255, 1];
}

function makeStar() {
  return {
    x: 0,
    y: 0,
    z: 0,
    px: NaN,
    py: NaN,
    seed: 0,
    vmul: 1,
    colorIdx: 0,
    flashUntil: 0,
    nextFlash: 0,
  };
}

class GlitterWrapScene {
  constructor(container, cfg) {
    this.container = container;
    this.cfg = cfg;
    this.stars = [];
    this.elapsed = 0;
    this.lastT = performance.now();
    this.size = { w: 0, h: 0, dpr: 1 };
    this.frameId = 0;
    this.disposed = false;

    this.colorCache = {
      color1: "",
      color2: "",
      color3: "",
      parsed1: [255, 255, 255, 1],
      parsed2: [177, 158, 239, 1],
      parsed3: [205, 217, 255, 1],
    };

    this.canvas = document.createElement("canvas");
    this.canvas.style.position = "absolute";
    this.canvas.style.inset = "0";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.display = "block";
    container.appendChild(this.canvas);

    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    this.ctx = ctx;

    this.ro = new ResizeObserver((entries) => this.resize(entries[0]));
    this.ro.observe(container);

    this.syncCount();
    this.resize();
  }

  getCachedColors() {
    const p = this.cfg;
    const c = this.colorCache;
    if (p.color1 !== c.color1) {
      c.color1 = p.color1;
      c.parsed1 = parseColor(p.color1);
    }
    if (p.color2 !== c.color2) {
      c.color2 = p.color2;
      c.parsed2 = parseColor(p.color2);
    }
    if (p.color3 !== c.color3) {
      c.color3 = p.color3;
      c.parsed3 = parseColor(p.color3);
    }
    return c;
  }

  settings() {
    const p = this.cfg;
    return {
      reverse: p.reverse,
      density: p.density,
      stepZ: p.speed * 0.0008,
      focalDepth: p.focalDepth / 100,
      starScale: p.starSize * 0.15,
      turbulence: p.turbulence * 0.2,
      glitter: p.glitterIntensity * 0.1,
      brightness: Math.min(1, p.brightness / 100),
      trail: p.trailAmount / 100,
    };
  }

  resetStar(s, initial = false) {
    const { density, reverse, focalDepth, glitter } = this.settings();

    const angle = Math.random() * Math.PI * 2;
    const radius = (0.2 + Math.random() * 0.8) * (density / 15);
    s.x = Math.cos(angle) * radius;
    s.y = Math.sin(angle) * radius;

    if (reverse) {
      s.z = initial ? focalDepth + Math.random() * (1 - focalDepth) : focalDepth;
    } else {
      s.z = initial ? Math.random() : 1.0;
    }
    s.px = NaN;
    s.py = NaN;
    s.seed = Math.random() * 1000;
    s.vmul = 0.6 + Math.random() * 0.8;
    s.colorIdx = Math.floor(Math.random() * 3);
    s.flashUntil = 0;
    s.nextFlash = this.elapsed + 1 + Math.random() * 4 * (1 / Math.max(0.0001, glitter));
  }

  syncCount() {
    const count = Math.max(1, Math.floor(this.cfg.particleCount));
    const stars = this.stars;
    if (stars.length === count) return;
    if (stars.length > count) {
      stars.length = count;
    } else {
      while (stars.length < count) {
        const s = makeStar();
        this.resetStar(s, true);
        stars.push(s);
      }
    }
  }

  resize(entry) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cr = entry && entry.contentRect;
    const rectW = (cr && cr.width) || this.container.clientWidth || this.container.getBoundingClientRect().width;
    const rectH = (cr && cr.height) || this.container.clientHeight || this.container.getBoundingClientRect().height;
    const w = Math.max(1, Math.floor(rectW) || 600);
    const h = Math.max(1, Math.floor(rectH) || 400);

    const prev = this.size;
    if (prev.w === w && prev.h === h && prev.dpr === dpr) return;

    this.size = { w, h, dpr };
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, w, h);
  }

  updateConfig(cfg) {
    if (this.disposed) return;
    this.cfg = cfg;
  }

  drawFrame(deltaSec) {
    const ctx = this.ctx;
    const { reverse, stepZ, focalDepth, starScale, turbulence, glitter, brightness, trail } = this.settings();

    this.syncCount();
    const colors = this.getCachedColors();
    const palette = [colors.parsed1, colors.parsed2, colors.parsed3];
    const rgbStrs = [
      `rgb(${palette[0][0]}, ${palette[0][1]}, ${palette[0][2]})`,
      `rgb(${palette[1][0]}, ${palette[1][1]}, ${palette[1][2]})`,
      `rgb(${palette[2][0]}, ${palette[2][1]}, ${palette[2][2]})`,
    ];

    const { w, h } = this.size;
    const cx = w / 2;
    const cy = h / 2;
    const projScale = Math.min(w, h) * 0.9;
    const dt = Math.max(0.001, Math.min(0.1, deltaSec)) * 60;

    const keep = Math.pow(Math.min(0.98, Math.max(0, trail)), dt);
    const trailAlpha = Math.max(0.02, 1 - keep);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = `rgba(0, 0, 0, ${trailAlpha})`;
    ctx.fillRect(0, 0, w, h);

    ctx.globalCompositeOperation = "lighter";

    const stars = this.stars;
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];

      const vz = stepZ * s.vmul * dt;
      if (reverse) {
        s.z += vz;
        if (s.z >= 1.0) {
          this.resetStar(s);
          continue;
        }
      } else {
        s.z -= vz;
        if (s.z <= focalDepth) {
          this.resetStar(s);
          continue;
        }
      }

      let tx = s.x;
      let ty = s.y;
      if (turbulence > 0) {
        const t = this.elapsed * 1.2 + s.seed;
        const amp = turbulence * (1 - s.z) * 0.25;
        tx += Math.sin(t + s.seed) * amp;
        ty += Math.cos(t * 1.13 + s.seed * 0.7) * amp;
      }

      const persp = focalDepth / Math.max(s.z, 0.0001);
      const sx = cx + tx * persp * projScale;
      const sy = cy + ty * persp * projScale;

      if (!reverse && (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20)) {
        this.resetStar(s);
        continue;
      }

      let flashMult = 1;
      if (glitter > 0) {
        if (this.elapsed >= s.nextFlash && s.flashUntil < this.elapsed) {
          s.flashUntil = this.elapsed + 0.04 + Math.random() * 0.07;
          s.nextFlash = this.elapsed + 1 + Math.random() * 4 * (1 / Math.max(0.0001, glitter));
        }
        if (this.elapsed <= s.flashUntil) {
          flashMult = 1 + 2.5 * glitter;
        }
      }

      const sizePersp = Math.min(2.5, (focalDepth / Math.max(s.z, 0.0001)) * 0.6);
      const baseR = Math.max(0.25, starScale * (0.4 + sizePersp));
      const maxR = 1 + starScale * 2.5;
      const r = Math.min(baseR * flashMult, maxR);

      const lifeT = reverse ? s.z : 1 - s.z;
      const fadeIn = reverse ? Math.min(1, (s.z - focalDepth) / (1 - focalDepth) / 0.12) : 1;
      const a =
        Math.min(1, reverse ? 0.85 - lifeT * 0.6 : lifeT * 0.9 + 0.05) *
        fadeIn *
        brightness *
        (flashMult > 1 ? 1 : 0.85);

      const colStr = rgbStrs[s.colorIdx];

      if (!Number.isNaN(s.px) && !Number.isNaN(s.py)) {
        ctx.globalAlpha = a * 0.5;
        ctx.strokeStyle = colStr;
        ctx.lineWidth = Math.max(0.4, r * 0.4);
        ctx.beginPath();
        ctx.moveTo(s.px, s.py);
        ctx.lineTo(sx, sy);
        ctx.stroke();
      }

      ctx.globalAlpha = a;
      ctx.fillStyle = colStr;
      ctx.fillRect(sx - r, sy - r, r * 2, r * 2);

      if (flashMult > 1) {
        const rf = Math.min(r * 1.4, maxR * 1.4);
        ctx.globalAlpha = a * 0.5;
        ctx.fillRect(sx - rf, sy - rf, rf * 2, rf * 2);
      }

      s.px = sx;
      s.py = sy;
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    this.elapsed += Math.min(0.1, Math.max(0, deltaSec));
  }

  start() {
    this.lastT = performance.now();
    const loop = (t) => {
      const deltaSec = (t - this.lastT) / 1000;
      this.lastT = t;
      this.drawFrame(deltaSec);
      this.frameId = requestAnimationFrame(loop);
    };
    this.frameId = requestAnimationFrame(loop);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    this.ro.disconnect();
    if (this.canvas.parentNode === this.container) {
      this.container.removeChild(this.canvas);
    }
  }
}

/**
 * Mounts a Glitter Wrap scene into `container`, filling it, and keeps it
 * sized to the container. Returns a dispose function.
 */
export function mountGlitterWrap(container, cfg = {}) {
  const config = { ...DEFAULTS, ...cfg };
  const scene = new GlitterWrapScene(container, config);
  scene.start();
  return () => scene.dispose();
}
