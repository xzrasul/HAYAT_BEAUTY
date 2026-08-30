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

/* ---- ambient background piece: aiprintgen showcase, desktop only ---- */
const bgGroup = new THREE.Group();
scene.add(bgGroup);

const isDesktop = window.innerWidth > 900;
if (isDesktop) {
    loader.load(
        "aiprintgen_screenshot-20260829-205052-instagram.glb",
        (gltf) => {
            const source = gltf.scene;
            source.traverse((child) => {
                if (child.isMesh) {
                    child.material.metalness = 0;
                    child.material.roughness = 0.7;
                }
            });
            /* The file is a single fused "print tree" mesh (a bear + several
               small charms sharing one body), not separate objects. The bear
               is the widest lobe, sitting at the bottom of the tree in local
               space (measured from the geometry: y from -0.5 to -0.10, ears
               included, holds the largest x/z footprint). We crop to just
               that lobe and blow it up to cover the screen; the rest of the
               tree scales along with it and lands far outside the camera
               frustum. Fit by height (not width) so the whole head/face
               stays on screen — the bear's footprint is close to square,
               much narrower than the viewport, so fitting by width would
               crop the ears/chin. */
            const bearLocalBox = new THREE.Box3(
                new THREE.Vector3(-0.192, -0.5, -0.332),
                new THREE.Vector3(0.236, -0.10, 0.332)
            );
            const bearSize = new THREE.Vector3();
            const bearCenter = new THREE.Vector3();
            bearLocalBox.getSize(bearSize);
            bearLocalBox.getCenter(bearCenter);

            /* At rotation (0,0,0) the bear is seen edge-on (its side profile
               reads as a plain heart-shaped blob). Rotating -90° around Y
               turns it to face the camera, eyes and muzzle visible. That
               swaps which local axis is "depth" on screen: local Z becomes
               screen-horizontal, local X becomes screen-depth. The bear is
               rounded and fairly thick front-to-back — scaled up this large,
               its own depth would put its front surface a couple of units
               from the camera and warp it into an unrecognisable close-up.
               Flatten it on (now-depth) local X into a relief so only the
               face silhouette blows up, not the thickness. */
            const bgZ = -9;
            const distance = camera.position.z - bgZ;
            const visibleHeight = 2 * Math.tan((camera.fov * Math.PI / 180) / 2) * distance;
            const coverScale = (visibleHeight * 1.05) / bearSize.y;
            const reliefDepth = 2.2;
            const depthScale = reliefDepth / bearSize.x;
            source.scale.set(depthScale, coverScale, coverScale);
            source.rotation.set(0, -Math.PI / 2, 0);
            source.position.set(0, 0, 0);
            source.updateMatrixWorld(true);
            const bearWorldCenter = bearCenter.clone().applyMatrix4(source.matrixWorld);
            const desiredCenter = new THREE.Vector3(0, 0, bgZ);
            source.position.copy(desiredCenter.sub(bearWorldCenter));
            source.userData.baseY = source.position.y;
            bgGroup.add(source);
        },
        undefined,
        (err) => {
            console.warn("Не удалось загрузить фоновую модель:", err);
        }
    );
}

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

    bgGroup.rotation.y = Math.sin(elapsed * 0.12) * 0.08;
    bgGroup.children.forEach((child, i) => {
        const phase = i * Math.PI;
        child.position.y = child.userData.baseY + Math.sin(elapsed * 0.5 + phase) * 0.08;
        child.rotation.z = Math.sin(elapsed * 0.3 + phase) * 0.02;
    });

    renderer.render(scene, camera);
}
rafId = requestAnimationFrame(frame);
