import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { mountGlitterWrap } from "./glitter-wrap.js";

/* ---------- Glitter Wrap background ---------- */
mountGlitterWrap(document.querySelector(".glitter-bg"), {
  color1: "#fc89d3", // --pink
  color2: "#ba87f8", // --purple
  color3: "#d7faa0", // --green
  speed: 3,
  density: 47,
  starSize: 14,
  focalDepth: 5,
  turbulence: 4,
  glitterIntensity: 1,
  trailAmount: 30,
});

/* ---------- three.js scene ---------- */
const stage = document.querySelector(".stage-inner");
const canvas = document.getElementById("logo-canvas");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;

const scene = new THREE.Scene();

const FOV_DEG = 32;
const CAM_DISTANCE = 9;
const camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.1, 100);
camera.position.set(0, 0, CAM_DISTANCE);
camera.lookAt(0, 0, 0);

/* bright studio environment so the metal picks up crisp, luminous reflections */
const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.02).texture;
pmremGenerator.dispose();

/* directional lights add sharp, bright specular highlights on top of the env sheen */
scene.add(new THREE.AmbientLight(0xffffff, 0.6));

const keyLight = new THREE.DirectionalLight(0xffffff, 3.6);
keyLight.position.set(3, 6, 5);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xdfe3ea, 1.6);
fillLight.position.set(-4, 1, 3);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xffffff, 2.4);
rimLight.position.set(0, 3, -6);
scene.add(rimLight);

const topLight = new THREE.DirectionalLight(0xffffff, 2);
topLight.position.set(0, 8, 2);
scene.add(topLight);

/* single group: holds the model, driven by hover-tilt + drag + idle bob */
const group = new THREE.Group();
scene.add(group);

const loader = new GLTFLoader();
let modelRoot = null;

loader.load(
  "assets/hb-logo.glb",
  (gltf) => {
    const model = gltf.scene;

    model.traverse((child) => {
      if (child.isMesh) {
        child.material = new THREE.MeshStandardMaterial({
          color: 0xf6f6f4,
          metalness: 1,
          roughness: 0.16,
          envMapIntensity: 2.4,
        });
      }
    });

    // Normalize: center the model at the origin, then scale using its bounding
    // SPHERE (not just the resting AABB) so the fit is safe at every rotation —
    // a sphere's radius doesn't change as the model spins or tilts toward the cursor.
    const box = new THREE.Box3().setFromObject(model);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);

    // Visible frame height at the model's depth, from the camera's vertical FOV.
    const frameHeight = 2 * CAM_DISTANCE * Math.tan(THREE.MathUtils.degToRad(FOV_DEG) / 2);
    const FILL_RATIO = 0.94; // how much of the frame the logo occupies — big, but never clipped
    const scale = (frameHeight * FILL_RATIO) / (sphere.radius * 2);
    model.scale.setScalar(scale);

    model.position.x -= center.x * scale;
    model.position.y -= center.y * scale;
    model.position.z -= center.z * scale;

    modelRoot = model;
    group.add(model);
  },
  undefined,
  (err) => console.error("Failed to load HB logo model:", err)
);

/* ---------- interaction: hover-to-look (whole page) + drag to rotate + idle float ---------- */
let baseYaw = 0, basePitch = 0;
let dragYaw = 0, dragPitch = 0;
let dragging = false, lastX = 0, lastY = 0;
let targetYaw = 0, targetPitch = 0;
let touchActive = false;

const DRAG_GAIN = 0.01;
const TILT_RANGE = 0.4;

// Hover-to-look reacts to the cursor anywhere on the page, not just over the canvas.
window.addEventListener("mousemove", (e) => {
  targetYaw = ((e.clientX / window.innerWidth) * 2 - 1) * TILT_RANGE;
  targetPitch = (-(e.clientY / window.innerHeight) * 2 + 1) * TILT_RANGE;
});

window.addEventListener(
  "touchmove",
  (e) => {
    if (!e.touches.length || touchActive) return; // a drag on the logo takes priority
    const t = e.touches[0];
    targetYaw = ((t.clientX / window.innerWidth) * 2 - 1) * TILT_RANGE;
    targetPitch = (-(t.clientY / window.innerHeight) * 2 + 1) * TILT_RANGE;
  },
  { passive: true }
);

/* dragging: click-and-drag directly on the logo to spin it by hand */
canvas.addEventListener("pointerdown", (e) => {
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  dragYaw += (e.clientX - lastX) * DRAG_GAIN;
  dragPitch += (e.clientY - lastY) * DRAG_GAIN;
  dragPitch = Math.max(-1.2, Math.min(1.2, dragPitch));
  lastX = e.clientX;
  lastY = e.clientY;
});

canvas.addEventListener("pointerup", () => { dragging = false; });
canvas.addEventListener("pointercancel", () => { dragging = false; });

/* touch fallback for reliable mobile drag */
stage.addEventListener("touchstart", (e) => {
  const t = e.touches[0];
  if (!t) return;
  touchActive = true;
  dragging = true;
  lastX = t.clientX;
  lastY = t.clientY;
});
stage.addEventListener("touchmove", (e) => {
  if (!touchActive || !e.touches[0]) return;
  const t = e.touches[0];
  dragYaw += (t.clientX - lastX) * DRAG_GAIN;
  dragPitch += (t.clientY - lastY) * DRAG_GAIN;
  dragPitch = Math.max(-1.2, Math.min(1.2, dragPitch));
  lastX = t.clientX;
  lastY = t.clientY;
});
const endTouch = () => {
  touchActive = false;
  dragging = false;
};
stage.addEventListener("touchend", endTouch);
stage.addEventListener("touchcancel", endTouch);

/* ---------- resize ---------- */
function resize() {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

/* ---------- animation loop ---------- */
let prevTime = performance.now();
let elapsed = 0;
let idleYaw = 0;
let idleTiltY = 0;

function animate(now) {
  requestAnimationFrame(animate);

  const dt = Math.min((now - prevTime) / 1000, 0.05);
  prevTime = now;
  elapsed += dt;

  // Framerate-independent easing: converges at the same rate regardless of dt.
  const k = 1 - Math.pow(0.02, dt / 0.32);
  idleYaw += (targetYaw - idleYaw) * k;
  idleTiltY += (targetPitch - idleTiltY) * k;

  if (!dragging) {
    const s = 1 - Math.pow(0.02, dt / 0.5);
    dragYaw *= (1 - s);
    dragPitch *= (1 - s);
  }

  group.rotation.y = baseYaw + dragYaw + idleYaw;
  group.rotation.x = basePitch + dragPitch - idleTiltY;
  group.position.y = Math.sin(elapsed * 1.6) * 0.06 + idleTiltY * 0.1;

  renderer.render(scene, camera);
}
requestAnimationFrame(animate);
