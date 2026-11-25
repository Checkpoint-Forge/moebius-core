import * as THREE from 'three';
import { createPaperMap } from './ink.js';
import { NormalPassScheduler } from './normal-pass-scheduler.js';
import { RENDER_PARAMS, applyRenderParams, createSpeedEdgeUniforms } from './render-params.js';
import {
  moebiusFragmentShader,
  moebiusNormalFragmentShader,
  moebiusNormalVertexShader,
} from './render-shader.js';

// 全屏合成顶点着色器：2×2 平面的 position.xy 本身就在 NDC，因此这个 quad
// 不依赖任何相机或矩阵 —— 换相机不会让合成失真。
const QUAD_VERTEX_SHADER = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * 墨线管线的默认图层开关。1 = 打开。
 * 只有以 lab: true 创建时才存在这些 uniform；否则整段诊断分支不进编译。
 */
export const DEFAULT_LAYERS = Object.freeze({
  outline: 1,
  hatch: 1,
  grain: 1,
  hatchFade: 1,
});

/**
 * 把「颜色 → 法线 → 墨线合成」三遍渲染包成一个可复用的对象。
 *
 * 它不拥有场景、相机、灯光与任何应用状态。调用方每帧把
 * 动态输入（速度、加速度、座舱调色权重……）递进来，管线不反向读调用方字段。
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {object} [options]
 * @param {THREE.Scene} [options.scene] 世界场景（可后补 setScene）
 * @param {THREE.PerspectiveCamera} [options.camera]
 * @param {THREE.Object3D} [options.tracked] 会动的子树；它一动就重画法线缓冲
 * @param {number} [options.inkColor] 墨色，即描边与排线使用的深色
 * @param {boolean} [options.lab] 是否编译诊断分支（可逐层开关 + 掩码视图）
 * @param {number} [options.msaa] 颜色缓冲 MSAA 采样数，0 = 关闭
 * @param {boolean} [options.halfResolutionNormal] 法线缓冲是否半分辨率
 * @param {number} [options.samples] 同 msaa 的别名，保留冗余度
 */
export function createMoebiusPipeline(renderer, options = {}) {
  const {
    scene: initialScene = null,
    camera: initialCamera = null,
    tracked: initialTracked = null,
    inkColor = 0x142a3b,
    lab = true,
    msaa = 4,
    halfResolutionNormal = true,
  } = options;

  let scene = initialScene;
  let camera = initialCamera;
  let tracked = initialTracked;
  let needsRender = true;
  let disposed = false;
  let exemptObjects = null;
  const hiddenObjects = [];

  // ---------------------------------------------------------------- 缓冲
  const paperTexture = createPaperMap(Math.min(4, renderer.capabilities.getMaxAnisotropy()));
  const hdr = renderer.extensions.has('EXT_color_buffer_float');
  const depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  const colorTarget = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
    depthTexture,
  });
  // HDR 不可用时，颜色缓冲自己就是最终色域：必须标 sRGB，否则墨色会发灰。
  if (!hdr) colorTarget.texture.colorSpace = THREE.SRGBColorSpace;
  colorTarget.samples = Math.max(0, msaa);

  const normalTarget = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    depthBuffer: true,
  });

  // ---------------------------------------------------------------- 法线材质
  // 场景级 overrideMaterial：一次渲染同时产出「视空间法线 rgb」与
  // 「受光程度 alpha」。alpha 里存 max(0,N·L)×投影遮罩，满量程、不缩放，
  // 这样雾、曝光、ACES 都改不动排线的分档。
  const normalMaterial = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.lights,
      THREE.UniformsLib.shadowmap,
      {
        lightPosition: { value: new THREE.Vector3(0.35, 0.8, 0.45).normalize() },
        uShininess: { value: RENDER_PARAMS.specularShininess },
        uSpecThreshold: { value: RENDER_PARAMS.specularThreshold },
      },
    ]),
    vertexShader: moebiusNormalVertexShader,
    fragmentShader: moebiusNormalFragmentShader,
    side: THREE.DoubleSide,
    lights: true,
  });

  // ---------------------------------------------------------------- 合成材质
  const postUniforms = {
    ...createSpeedEdgeUniforms(),
    tColor: { value: colorTarget.texture },
    tDepth: { value: depthTexture },
    tNormal: { value: normalTarget.texture },
    tPaper: { value: paperTexture },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uNormalTexel: { value: new THREE.Vector2(1, 1) },
    uPixelRatio: { value: 1 },
    uCameraNear: { value: 0.1 },
    uCameraFar: { value: 1000 },
    uInkColor: { value: new THREE.Color(inkColor) },
    uCockpit: { value: 0 },
    uNormalToWorld: { value: new THREE.Matrix3() },
    uShadowType: { value: RENDER_PARAMS.shadowType },
    uOutlineThickness: { value: RENDER_PARAMS.outlineThickness },
    uDepthWeight: { value: RENDER_PARAMS.depthWeight },
    uNormalWeight: { value: RENDER_PARAMS.normalWeight },
    uOutlineFadeNear: { value: RENDER_PARAMS.outlineFadeNear },
    uOutlineFadeFar: { value: RENDER_PARAMS.outlineFadeFar },
    uWiggleFrequency: { value: RENDER_PARAMS.wiggleFrequency },
    uWiggleAmplitude: { value: RENDER_PARAMS.wiggleAmplitude },
    uHatchSpacing: { value: RENDER_PARAMS.hatchSpacing },
    uHatchThickness: { value: RENDER_PARAMS.hatchThickness },
    uHatchSun1: { value: RENDER_PARAMS.hatchSun1 },
    uHatchSun2: { value: RENDER_PARAMS.hatchSun2 },
    uHatchSun3: { value: RENDER_PARAMS.hatchSun3 },
    uHatchFadeNear: { value: RENDER_PARAMS.hatchFadeNear },
    uHatchFadeFar: { value: RENDER_PARAMS.hatchFadeFar },
    uPaperStrength: { value: RENDER_PARAMS.paperStrength },
  };
  if (lab) {
    postUniforms.uGrain = { value: DEFAULT_LAYERS.grain };
    postUniforms.uOutlineAmt = { value: DEFAULT_LAYERS.outline };
    postUniforms.uHatchAmt = { value: DEFAULT_LAYERS.hatch };
    postUniforms.uHatchFade = { value: DEFAULT_LAYERS.hatchFade };
    postUniforms.uDebug = { value: 0 };
  }

  const postMaterial = new THREE.ShaderMaterial({
    uniforms: postUniforms,
    vertexShader: QUAD_VERTEX_SHADER,
    fragmentShader: moebiusFragmentShader,
    defines: lab ? { LAB: 1 } : {},
    depthTest: false,
    depthWrite: false,
  });

  const quadGeometry = new THREE.PlaneGeometry(2, 2);
  const quadMesh = new THREE.Mesh(quadGeometry, postMaterial);
  quadMesh.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quadMesh);
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const scheduler = new NormalPassScheduler();

  function applyParams() {
    applyRenderParams(postMaterial, normalMaterial, renderer);
    needsRender = true;
  }
  applyParams();

  // ---------------------------------------------------------------- 场景契约
  /**
   * 按契约给整棵场景打标：Line/Points/Sprite 与透明件不进法线缓冲。
   * 漏掉这一条，法线缓冲会把这些东西的背面法线混进来，全屏出现墨纱。
   * @param {THREE.Object3D} root
   */
  function prepareScene(root = scene) {
    if (!root) return;
    root.traverse((object) => {
      const materials = Array.isArray(object.material)
        ? object.material
        : (object.material ? [object.material] : []);
      const isHelper = object.isLine || object.isPoints || object.isSprite;
      if (isHelper) object.userData.noNormal = true;
      for (const material of materials) {
        if (isHelper || material.transparent) material.depthWrite = false;
        if (material.transparent) object.userData.noNormal = true;
      }
      if (object.isMesh && !object.userData.noNormal) object.receiveShadow = true;
    });
    exemptObjects = null;
    needsRender = true;
  }

  function rebuildExemptList() {
    exemptObjects = [];
    if (!scene) return;
    scene.traverse((object) => {
      if (object.userData.noNormal || object.isLine || object.isPoints || object.isSprite) {
        exemptObjects.push(object);
      }
    });
  }

  // ---------------------------------------------------------------- 尺寸
  function resize(width, height, pixelRatio = 1) {
    const ratio = Math.max(0.5, pixelRatio);
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    const renderWidth = Math.max(1, Math.floor(width * ratio));
    const renderHeight = Math.max(1, Math.floor(height * ratio));
    colorTarget.setSize(renderWidth, renderHeight);
    const normalWidth = Math.max(1, Math.floor(renderWidth / (halfResolutionNormal ? 2 : 1)));
    const normalHeight = Math.max(1, Math.floor(renderHeight / (halfResolutionNormal ? 2 : 1)));
    normalTarget.setSize(normalWidth, normalHeight);
    postMaterial.uniforms.uResolution.value.set(renderWidth, renderHeight);
    postMaterial.uniforms.uNormalTexel.value.set(1 / normalWidth, 1 / normalHeight);
    postMaterial.uniforms.uPixelRatio.value = ratio;
    needsRender = true;
    scheduler.reset();
    return { renderWidth, renderHeight, normalWidth, normalHeight };
  }

  // ---------------------------------------------------------------- 动态输入
  /**
   * 每帧由调用方写入的"活"状态。都是可选的，缺省即 0（效果关闭）。
   * 刻意不放进 render-params.js 的 RENDER_PARAMS：applyParams() 不该覆盖它们。
   */
  function setDynamic(inputs = {}) {
    const u = postMaterial.uniforms;
    if (inputs.speed !== undefined) u.uSpeed.value = inputs.speed;
    if (inputs.acceleration !== undefined) u.uAcceleration.value = inputs.acceleration;
    if (inputs.boostStage !== undefined) u.uBoostStage.value = inputs.boostStage;
    if (inputs.braking !== undefined) u.uBraking.value = inputs.braking ? 1 : 0;
    if (inputs.reducedMotion !== undefined) u.uReducedMotion.value = inputs.reducedMotion ? 1 : 0;
    if (inputs.time !== undefined) u.uTime.value = inputs.time;
    if (inputs.cockpit !== undefined) u.uCockpit.value = inputs.cockpit;
  }

  /** lab 模式：逐层开关。1 = 显示，0 = 关掉。 */
  function setLayers(layers = {}) {
    if (!lab) return;
    const u = postMaterial.uniforms;
    if (layers.outline !== undefined) u.uOutlineAmt.value = layers.outline ? 1 : 0;
    if (layers.hatch !== undefined) u.uHatchAmt.value = layers.hatch ? 1 : 0;
    if (layers.grain !== undefined) u.uGrain.value = layers.grain ? 1 : 0;
    if (layers.hatchFade !== undefined) u.uHatchFade.value = layers.hatchFade ? 1 : 0;
    needsRender = true;
  }

  /** lab 模式：0 合成 / 1 描边掩码 / 2 排线掩码 / 3 法线 / 4 深度。 */
  function setDebug(level = 0) {
    if (!lab) return;
    postMaterial.uniforms.uDebug.value = level;
    needsRender = true;
  }

  // ---------------------------------------------------------------- 渲染
  function render() {
    if (disposed || !scene || !camera) return false;
    const cam = camera;
    // 近远裁面与相机对齐：换镜头（例如改 near）不会让深度重建出错。
    postMaterial.uniforms.uCameraNear.value = cam.near;
    postMaterial.uniforms.uCameraFar.value = cam.far;
    postMaterial.uniforms.uNormalToWorld.value.setFromMatrix4(cam.matrixWorld);

    renderer.setRenderTarget(colorTarget);
    renderer.clear();
    renderer.render(scene, cam);

    const trackedObject = tracked ?? scene;
    if (scheduler.shouldRender(cam, trackedObject, needsRender)) {
      if (!exemptObjects) rebuildExemptList();
      hiddenObjects.length = 0;
      for (const object of exemptObjects) {
        if (!object.visible) continue;
        hiddenObjects.push(object);
        object.visible = false;
      }
      const previousOverride = scene.overrideMaterial;
      const previousShadowUpdate = renderer.shadowMap.autoUpdate;
      scene.overrideMaterial = normalMaterial;
      renderer.shadowMap.autoUpdate = false;
      try {
        renderer.setRenderTarget(normalTarget);
        renderer.clear();
        renderer.render(scene, cam);
      } finally {
        // 任何一遍出错都不能把 override 泄漏到下一帧。
        scene.overrideMaterial = previousOverride;
        renderer.shadowMap.autoUpdate = previousShadowUpdate;
        for (const object of hiddenObjects) object.visible = true;
      }
    }

    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.render(quadScene, quadCamera);
    needsRender = false;
    return true;
  }

  function dispose() {
    disposed = true;
    colorTarget.dispose();
    normalTarget.dispose();
    depthTexture.dispose();
    paperTexture.dispose();
    normalMaterial.dispose();
    postMaterial.dispose();
    quadGeometry.dispose();
  }

  return {
    // 材质与缓冲保持公开：调参与诊断不需要改这个文件。
    postMaterial,
    normalMaterial,
    colorTarget,
    normalTarget,
    scheduler,
    hdr,
    lab,
    get scene() { return scene; },
    get camera() { return camera; },
    setScene(next) { scene = next; exemptObjects = null; needsRender = true; },
    setCamera(next) { camera = next; needsRender = true; },
    setTracked(next) { tracked = next; needsRender = true; },
    invalidate() { needsRender = true; scheduler.reset(); },
    prepareScene,
    resize,
    setDynamic,
    setLayers,
    setDebug,
    applyParams,
    render,
    dispose,
  };
}
