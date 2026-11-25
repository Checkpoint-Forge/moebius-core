import * as THREE from 'three';
import { RENDER_PARAMS } from '../engine/render-params.js';
import { createMoebiusPipeline } from '../engine/moebius-pipeline.js';
import { addFog } from '../engine/toon.js';
import { AUTO_SUN_DEFAULT } from './controls.js';
import { createLightRig, LIGHT_DEFAULTS } from './lights.js';
import { buildScene } from './scene.js';
import { createOrbitCamera } from './orbit.js';
import { installUI } from './ui.js';

const DEFAULTS = { ...RENDER_PARAMS };

const canvas = document.getElementById('scene');

// antialias: false 是有意的：MSAA 开在离屏颜色缓冲上（colorTarget.samples）；
// 开在默认帧缓冲上会和后期那一遍合成打架。
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  alpha: true,
  powerPreference: 'high-performance',
});
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.04;

// 软件光栅化（无头浏览器、虚拟机）撑不起阴影贴图 + 4× MSAA。
// 只在检测到时降级，真实 GPU 保持完整管线。?shadows=1 用于在这种环境下取证截图。
const gl = renderer.getContext();
const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
const glName = String(debugInfo
  ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
  : gl.getParameter(gl.RENDERER));
const softwareGL = /swiftshader|llvmpipe|software/i.test(glName);
const forceShadows = new URLSearchParams(window.location.search).get('shadows') === '1';
const shadowsAvailable = !softwareGL || forceShadows;

renderer.shadowMap.enabled = shadowsAvailable;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// ---------------------------------------------------------------- 场景
const scene = new THREE.Scene();
addFog(scene);

const rig = createLightRig(scene, {
  shadows: shadowsAvailable,
  shadowMapSize: softwareGL ? 1024 : 2048,
});

// 近远裁面按"雾"来定，不按"世界"来定：雾在 95 处已经封死，远平面给到 150 就够。
// 这一条直接决定画质 —— 深度 Sobel 放大了深度缓冲的精度误差，
// near 太近 / far 太远会让远处地面渗出条纹状墨线（放大 depthWeight 时最明显）。
const camera = new THREE.PerspectiveCamera(46, 1, 1, 150);
// phi 接近 π/2 = 平视；太小就俯视成一块橙色地砖。1.28 把地平线压到画面上三分之一。
// target.x 略偏右：控制面板占住右侧，主体才会落在可见区中间。
const orbit = createOrbitCamera(camera, canvas, {
  theta: 0.62,
  phi: 1.15,
  radius: 25,
  target: new THREE.Vector3(1.0, 2.6, 0),
});

// ---------------------------------------------------------------- 管线
const pipeline = createMoebiusPipeline(renderer, {
  scene,
  camera,
  lab: true,
  msaa: softwareGL ? 0 : 4,
});

const demo = buildScene(scene);
pipeline.prepareScene(scene);
pipeline.setTracked(demo.stage);

// ---------------------------------------------------------------- 状态
const state = {
  lights: { ...LIGHT_DEFAULTS },
  speed: 0,
  autoSun: false,
  autoSunSpeed: AUTO_SUN_DEFAULT,
};

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = motionQuery.matches;
let time = 0;

/** 主光角度变化会改写法线缓冲里的 N·L，必须让法线 pass 重画。 */
function applyLights() {
  rig.apply(state.lights);
  pipeline.invalidate();
}
applyLights();

/** 阴影开关改的是编译期的灯组 uniform，材质必须重编一遍。 */
function setShadows(on) {
  renderer.shadowMap.enabled = on && shadowsAvailable;
  rig.sun.castShadow = on && shadowsAvailable;
  scene.traverse((object) => {
    if (!object.material) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) if (material) material.needsUpdate = true;
  });
  pipeline.invalidate();
}

// ---------------------------------------------------------------- UI
const ui = installUI({
  pipeline,
  renderer,
  defaults: DEFAULTS,
  state,
  actions: {
    setLights() { applyLights(); },
    setShadows,
    setAutoSun(on) { state.autoSun = on; },
    setLayer(key, enabled) {
      if (key === 'shadows') { setShadows(enabled); return; }
      pipeline.setLayers({ [key]: enabled });
    },
  },
});

document.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  const level = Number(event.key);
  if (Number.isInteger(level) && level >= 0 && level <= 4) pipeline.setDebug(level);
});

// ---------------------------------------------------------------- 尺寸
function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  // 软件渲染下 DPR 封顶 1：像素量翻 4 倍换不来清晰度，只会把帧率压死。
  const pixelRatio = THREE.MathUtils.clamp(window.devicePixelRatio || 1, 0.75, softwareGL ? 1 : 1.5);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  pipeline.resize(width, height, pixelRatio);
}

window.addEventListener('resize', () => {
  resize();
  orbit.apply();
});

// context 丢失不是"页面写错了"，而是任何 WebGL 应用都会遇到的运行时事件
// （驱动重置、GPU 进程崩溃、显示器切换）。three 会自己恢复，但渲染目标的内容
// 不会跟着回来，所以这里显式作废一遍尺寸与法线缓存。
canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  ui.setStatus('WebGL context 丢失，正在恢复…');
});
canvas.addEventListener('webglcontextrestored', () => {
  pipeline.invalidate();
  resize();
  orbit.apply();
  ui.setStatus('WebGL context 已恢复');
});

// ---------------------------------------------------------------- 循环
const clock = new THREE.Clock();
resize();

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1);
  if (!reducedMotion) time += dt;

  if (state.autoSun && !reducedMotion) {
    // 只转方位角：仰角决定排线分档，自动转仰角等于让画面自己抖。
    // 累加量保持浮点，所以任意帧率下角度都是连续的，不会取整成整数度。
    state.lights.sunAzimuth = (state.lights.sunAzimuth + dt * state.autoSunSpeed) % 360;
    applyLights();
    ui.setAzimuth(state.lights.sunAzimuth);
  }

  orbit.update(dt, { reducedMotion });

  pipeline.setDynamic({
    speed: state.speed,
    acceleration: state.speed * 0.4,
    boostStage: state.speed > 60 ? 2 : state.speed > 30 ? 1 : 0,
    braking: false,
    reducedMotion,
    time,
  });
  pipeline.render();
  ui.updateReadout(dt);
  window.__MOEBIUS_FRAMES__ = (window.__MOEBIUS_FRAMES__ ?? 0) + 1;
}

// 控制台入口：__MOEBIUS__.params.outlineThickness = 1.2; __MOEBIUS__.apply()
window.__MOEBIUS__ = {
  engine: { name: 'three.js', revision: THREE.REVISION },
  pipeline,
  scene,
  camera,
  renderer,
  rig,
  params: RENDER_PARAMS,
  defaults: DEFAULTS,
  lights: state.lights,
  lightDefaults: LIGHT_DEFAULTS,
  softwareGL,
  apply: () => pipeline.applyParams(),
  setDebug: (level) => pipeline.setDebug(level),
  setLayers: (layers) => pipeline.setLayers(layers),
  setLights: (lights) => { Object.assign(state.lights, lights); applyLights(); },
};
window.__MOEBIUS_FRAMES__ = 0;
window.__MOEBIUS_READY__ = true;
if (softwareGL) ui.setStatus('软件渲染（SwiftShader）· 阴影与 MSAA 已降级');

frame();
