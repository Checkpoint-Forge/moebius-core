// 墨线画法的全部可调数值 —— 唯一来源（single source of truth）。
//
// 这里只有两样东西：默认值（RENDER_PARAMS）、滑杆元数据（PARAM_META），
// 以及把它们写进材质的 applyRenderParams()。任何"某个场景下好看的数字"
// 都不该散落在装配代码里。
//
// 三种用法：
//   1. 直接改本文件默认值（永久生效，记得递增 PARAMS_VERSION）；
//   2. 运行时改：RENDER_PARAMS.outlineThickness = 1.6; applyRenderParams(mat, normal, renderer);
//   3. 用 PARAM_META 自动生成滑杆 UI（demo 就是这么做的）。
//
// 注意：pattern 尺度一律为 CSS 像素 —— 排线/描边密度不随设备像素比变化。

// 默认值版本号：每次修改下方默认值时递增。外部存档（如 localStorage）据此
// 判定过期并丢弃，保证默认值变更后不会拿旧值覆盖新基准。
export const PARAMS_VERSION = 10;

export const RENDER_PARAMS = {
  // 描边
  outlineThickness: 0.4,   // Sobel 核半径（CSS px）；细墨线，避免小 facet 糊成墨团
  depthWeight: 40.0,       // 深度梯度权重（外轮廓；文章默认 25）
  normalWeight: 0.7,       // 法线亮度梯度权重；faceted 岩石/机体内部线只留结构不涂满
  outlineFadeNear: 70.0,   // 描边随视距衰减起点（雾遮蔽前归零）
  outlineFadeFar: 180.0,   // 描边随视距衰减终点
  // 手绘抖动
  wiggleFrequency: 0.15,   // 正弦频率（高频手绘微抖）
  wiggleAmplitude: 0.1,    // 位移幅度（CSS px）；小振幅避免轮廓毛糙
  // 阴影图案（crosshatch / tonal / raster 共用阈值与间距）
  shadowType: 3,           // 1 tonal 色阶 / 2 raster 圆点网 / 3 crosshatch 交叉排线
  hatchSpacing: 9.0,       // 条纹周期（CSS px）
  hatchThickness: 0.8,     // 排线线宽（CSS px）；独立厚排线 + 细外轮廓，缺 uniform 时回退墨线宽度
  // 排线分档依据是"受光程度"（0 = 背光或落在投影里，1 = 正对太阳），
  // 不是屏幕亮度：亮度会被雾、曝光和 LDR 回退污染，导致整幅画面挤进同一档。
  // 默认值按主光 36.5° 标定——水平沙面的 N·L = sin(36.5°) ≈ 0.595，
  // 把 hatchSun3 压在 0.50 以下，受光的平沙才留得住平涂。
  hatchSun1: 0.12,         // 受光低于此值：背光面与投影开始叠竖线
  hatchSun2: 0.30,         // 半背光坡面加横线
  hatchSun3: 0.50,         // 低于此值才画第一组斜线；高于它 = 留平涂
  hatchFadeNear: 60.0,     // 排线随视距衰减起点
  hatchFadeFar: 160.0,     // 排线随视距衰减终点
  // 旧式全局手绘高光（法线缓冲内 Blinn-Phong）。默认关闭；逐漆膜接入口完成前
  // 不得降到 1 以下，否则沙/岩/旧金属会一起出现纯白点，破坏纸墨平涂。
  specularShininess: 900.0, // 越高光点越小；保留给后续受限漆膜高光
  specularThreshold: 1.1,   // >1 = 关闭全局白点；<1 仅为旧调用兼容，不是推荐画风
  // 分级速度边缘（动态输入见 createSpeedEdgeUniforms；中央 58% 完全留白）
  speedEdgeMaxSpeed: 76.0,      // 实际速度归一化上限，与 boost II 的目标速度一致
  speedEdgeClearRadius: 0.58,   // 以屏幕半宽/半高为 1；0.58 = 中央 58% 无速度线
  speedEdgeDensity: 88.0,       // 圆周最大线槽数；实际密度仍由速度/档位决定
  speedEdgeOpacity: 0.34,       // 墨线混合上限的基准，不是全屏 wash
  speedEdgeThickness: 0.72,     // 线宽（CSS px），与 hatch 一样不随 DPR 变密
  speedEdgeFlowSpeed: 1.05,     // 径向流动速度；reducedMotion 时严格归零
  speedEdgeAcceleration: 45.0,  // 启动脉冲/松油余韵的加速度参考（单位/s²）
  speedEdgeStage2Gain: 0.34,    // II 档独立增量，不与加速脉冲共用
  speedEdgePulseGain: 0.52,     // 正加速度启动脉冲
  speedEdgeCoastGain: 0.38,     // 松油后的负加速度余韵，随实际速度衰减
  speedEdgeBrakeSuppression: 0.94, // 制动仅保留极弱残线，禁止制动触发强速度线
  // 输出
  paperStrength: 0.035,    // 纸纹颗粒幅度
  exposure: 0.7,           // ACES 曝光；压到 0.7 换更硬的墨线对比，沙面明暗层次仍在（测试守住下限）
};

// 滑杆元数据：label / min / max / step / group / unit，供 UI 自动生成控件。
// 枚举型参数改用 options（渲染为下拉框），不提供 min/max/step。
export const PARAM_META = [
  { key: 'outlineThickness', label: '墨线粗细', min: 0.4, max: 3, step: 0.1, group: '描边' },
  { key: 'depthWeight', label: '深度权重', min: 5, max: 60, step: 1, group: '描边' },
  { key: 'normalWeight', label: '法线权重', min: 0, max: 3, step: 0.1, group: '描边' },
  { key: 'outlineFadeNear', label: '描边衰减近', min: 20, max: 150, step: 5, group: '描边' },
  { key: 'outlineFadeFar', label: '描边衰减远', min: 80, max: 300, step: 5, group: '描边' },
  { key: 'wiggleFrequency', label: '抖动频率', min: 0, max: 0.15, step: 0.005, group: '手绘抖动' },
  { key: 'wiggleAmplitude', label: '抖动幅度', min: 0, max: 5, step: 0.1, group: '手绘抖动' },
  {
    key: 'shadowType',
    label: '阴影图案',
    group: '阴影图案',
    options: [
      { value: 3, label: 'crosshatch 交叉排线（文章默认）' },
      { value: 1, label: 'tonal 色阶' },
      { value: 2, label: 'raster 圆点网' },
    ],
  },
  { key: 'hatchSpacing', label: '排线间距', min: 4, max: 24, step: 0.5, group: '阴影图案' },
  { key: 'hatchThickness', label: '排线粗细', min: 0.2, max: 2, step: 0.1, group: '阴影图案' },
  { key: 'hatchSun1', label: '受光 ≤ 叠竖线', min: 0, max: 0.6, step: 0.01, group: '阴影图案' },
  { key: 'hatchSun2', label: '受光 ≤ 叠横线', min: 0.02, max: 0.8, step: 0.01, group: '阴影图案' },
  { key: 'hatchSun3', label: '受光 ≤ 画斜线', min: 0.05, max: 1.0, step: 0.01, group: '阴影图案' },
  { key: 'hatchFadeNear', label: '排线衰减近', min: 20, max: 150, step: 5, group: '阴影图案' },
  { key: 'hatchFadeFar', label: '排线衰减远', min: 60, max: 300, step: 5, group: '阴影图案' },
  { key: 'specularShininess', label: '高光锐度', min: 100, max: 2000, step: 50, group: '手绘高光' },
  { key: 'specularThreshold', label: '全局白点阈值（大于 1 关闭）', min: 0.05, max: 1.1, step: 0.05, group: '手绘高光' },
  { key: 'speedEdgeMaxSpeed', label: '速度归一化上限', min: 28, max: 120, step: 1, group: '速度边缘' },
  { key: 'speedEdgeClearRadius', label: '中央清晰范围', min: 0.55, max: 0.60, step: 0.01, group: '速度边缘' },
  { key: 'speedEdgeDensity', label: '边缘线槽密度', min: 32, max: 160, step: 1, group: '速度边缘' },
  { key: 'speedEdgeOpacity', label: '速度线墨量', min: 0, max: 0.7, step: 0.02, group: '速度边缘' },
  { key: 'speedEdgeThickness', label: '速度线宽', min: 0.2, max: 2, step: 0.05, group: '速度边缘' },
  { key: 'speedEdgeFlowSpeed', label: '径向流动速度', min: 0, max: 3, step: 0.05, group: '速度边缘' },
  { key: 'speedEdgeAcceleration', label: '加速度参考', min: 10, max: 100, step: 1, group: '速度边缘' },
  { key: 'speedEdgeStage2Gain', label: 'II 档独立增量', min: 0, max: 0.8, step: 0.02, group: '速度边缘' },
  { key: 'speedEdgePulseGain', label: '启动脉冲强度', min: 0, max: 1, step: 0.02, group: '速度边缘' },
  { key: 'speedEdgeCoastGain', label: '松油余韵强度', min: 0, max: 0.8, step: 0.02, group: '速度边缘' },
  { key: 'speedEdgeBrakeSuppression', label: '制动抑制', min: 0.5, max: 1, step: 0.01, group: '速度边缘' },
  { key: 'paperStrength', label: '纸纹幅度', min: 0, max: 0.1, step: 0.005, group: '输出' },
  { key: 'exposure', label: '曝光', min: 0.4, max: 2, step: 0.02, group: '输出' },
];

// 静态 LookDev 参数与 uniform 的一一映射。动态输入不属于 RENDER_PARAMS：
// 它们由 game 每帧写入，applyRenderParams 不会覆盖。
const SPEED_EDGE_PARAM_UNIFORMS = Object.freeze([
  ['speedEdgeMaxSpeed', 'uSpeedEdgeMaxSpeed'],
  ['speedEdgeClearRadius', 'uSpeedEdgeClearRadius'],
  ['speedEdgeDensity', 'uSpeedEdgeDensity'],
  ['speedEdgeOpacity', 'uSpeedEdgeOpacity'],
  ['speedEdgeThickness', 'uSpeedEdgeThickness'],
  ['speedEdgeFlowSpeed', 'uSpeedEdgeFlowSpeed'],
  ['speedEdgeAcceleration', 'uSpeedEdgeAcceleration'],
  ['speedEdgeStage2Gain', 'uSpeedEdgeStage2Gain'],
  ['speedEdgePulseGain', 'uSpeedEdgePulseGain'],
  ['speedEdgeCoastGain', 'uSpeedEdgeCoastGain'],
  ['speedEdgeBrakeSuppression', 'uSpeedEdgeBrakeSuppression'],
]);

/**
 * Construction-time uniform factory. Spread into the existing post material;
 * Materials built without these keys still compile, with the effect off.
 * Dynamic defaults deliberately keep the effect off until game supplies state.
 */
export function createSpeedEdgeUniforms() {
  const uniforms = {
    uSpeed: { value: 0 },          // actual world-unit speed, not HUD speed
    uAcceleration: { value: 0 },   // signed world-unit acceleration / s²
    uBoostStage: { value: 0 },     // 0 coast/idle, 1 boost I, 2 boost II
    uBraking: { value: 0 },        // boolean as 0/1
    uReducedMotion: { value: 0 },  // 1 freezes radial flow, keeps static ink
    uTime: { value: 0 },           // game visualTime in seconds
  };
  for (const [param, name] of SPEED_EDGE_PARAM_UNIFORMS) {
    uniforms[name] = { value: RENDER_PARAMS[param] };
  }
  return uniforms;
}

// 把参数写进材质 uniform 与渲染器：画法参数的唯一写入口。
export function applyRenderParams(postMaterial, normalMaterial, renderer) {
  const p = RENDER_PARAMS;
  const u = postMaterial.uniforms;
  u.uOutlineThickness.value = p.outlineThickness;
  u.uDepthWeight.value = p.depthWeight;
  u.uNormalWeight.value = p.normalWeight;
  u.uOutlineFadeNear.value = p.outlineFadeNear;
  u.uOutlineFadeFar.value = p.outlineFadeFar;
  u.uWiggleFrequency.value = p.wiggleFrequency;
  u.uWiggleAmplitude.value = p.wiggleAmplitude;
  u.uShadowType.value = p.shadowType;
  u.uHatchSpacing.value = p.hatchSpacing;
  // 材质尚未添加新 uniform 时保持旧行为：不报错，也不丢排线。
  if (u.uHatchThickness) u.uHatchThickness.value = p.hatchThickness;
  u.uHatchSun1.value = p.hatchSun1;
  u.uHatchSun2.value = p.hatchSun2;
  u.uHatchSun3.value = p.hatchSun3;
  u.uHatchFadeNear.value = p.hatchFadeNear;
  u.uHatchFadeFar.value = p.hatchFadeFar;
  // Speed-edge uniforms are additive and optional; never overwrite dynamic state.
  for (const [param, name] of SPEED_EDGE_PARAM_UNIFORMS) {
    if (u[name]) u[name].value = p[param];
  }
  u.uPaperStrength.value = p.paperStrength;
  if (normalMaterial?.uniforms?.uShininess) {
    normalMaterial.uniforms.uShininess.value = p.specularShininess;
    normalMaterial.uniforms.uSpecThreshold.value = p.specularThreshold;
  }
  if (renderer) renderer.toneMappingExposure = p.exposure;
}