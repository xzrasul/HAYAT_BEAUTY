import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const host = document.getElementById("host");
const canvasEl = document.getElementById("glcanvas");

const scene = new THREE.Scene();
scene.background = null;

const camera = new THREE.PerspectiveCamera(45, host.clientWidth / host.clientHeight, 0.1, 100);
camera.position.z = 4;

const renderer = new THREE.WebGLRenderer({
    canvas: canvasEl,
    antialias: true,
    alpha: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(host.clientWidth, host.clientHeight);

/* environment light for nice glass/metal reflections */
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const dirLight = new THREE.DirectionalLight(0xffffff, 2);
dirLight.position.set(1, 2, 3);
scene.add(dirLight);
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
scene.add(hemiLight);

let model = null;

const group = new THREE.Group();
scene.add(group);

const loader = new GLTFLoader();
loader.load(
    "HB logo.glb",
    (gltf) => {
        model = gltf.scene;
        model.traverse((child) => {
            if (child.isMesh) {
                child.material.metalness = 0.6;
                child.material.roughness = 0.25;
                child.material.color.set(0xe8e8ec);
            }
        });
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        const maxDim = Math.max(size.x, size.y, size.z);
        const mobile = window.innerWidth <= 720;
        const targetDim = mobile ? 1.3 : 2.0;
        const fitScale = (maxDim > 0 ? targetDim / maxDim : 1);
        model.scale.multiplyScalar(fitScale);
        model.position.sub(center.multiplyScalar(fitScale));
        group.add(model);
    },
    undefined,
    (err) => {
        console.warn("Не удалось загрузить модель:", err);
    }
);

/* ---- interaction: drag to rotate + idle float ---- */
let baseYaw = 0, basePitch = 0;
let dragYaw = 0, dragPitch = 0;
let dragging = false, lastX = 0, lastY = 0;
let targetYaw = 0, targetPitch = 0;

const DRAG_GAIN = 0.01;
const TILT_RANGE = 0.4;

canvasEl.addEventListener("pointerdown", (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvasEl.setPointerCapture(e.pointerId);
});
canvasEl.addEventListener("pointermove", (e) => {
    if (dragging) {
        dragYaw += (e.clientX - lastX) * DRAG_GAIN;
        dragPitch += (e.clientY - lastY) * DRAG_GAIN;
        dragPitch = Math.max(-1.2, Math.min(1.2, dragPitch));
        lastX = e.clientX;
        lastY = e.clientY;
        return;
    }
    const r = canvasEl.getBoundingClientRect();
    targetYaw = (((e.clientX - r.left) / Math.max(r.width, 1)) * 2 - 1) * TILT_RANGE;
    targetPitch = (-((e.clientY - r.top) / Math.max(r.height, 1)) * 2 + 1) * TILT_RANGE;
});
canvasEl.addEventListener("pointerup", () => { dragging = false; });
canvasEl.addEventListener("pointercancel", () => { dragging = false; });
canvasEl.addEventListener("pointerleave", () => {
    if (!dragging) { targetYaw = 0; targetPitch = 0; }
});

/* touch fallback for reliable mobile drag */
let touchActive = false;
host.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    if (!t) return;
    touchActive = true;
    dragging = true;
    lastX = t.clientX;
    lastY = t.clientY;
});
host.addEventListener("touchmove", (e) => {
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
host.addEventListener("touchend", endTouch);
host.addEventListener("touchcancel", endTouch);

window.addEventListener("resize", () => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
});

let rafId = 0;
let prev = performance.now();
let elapsed = 0;
let idleYaw = 0;
let idleTiltY = 0;

function frame(now) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min((now - prev) / 1000, 0.05);
    prev = now;
    elapsed += dt;

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
rafId = requestAnimationFrame(frame);
