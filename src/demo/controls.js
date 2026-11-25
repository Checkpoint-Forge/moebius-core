// 面板的"数据层"：分组、滑杆区间、单位、预设。
//
// 区间刻意比 src/engine/render-params.js 的 PARAM_META 宽得多 —— 那套是收敛后的
// 实用区间，这是演示台，0 和夸张上限才能看清每一项到底控制什么。
// 默认值不在这里：永远来自 RENDER_PARAMS / LIGHT_DEFAULTS，避免两份默认值打架。
//
// 下限刻意避开会算出 NaN 的取值：hatchSpacing = 0 会让 GLSL 的 mod() 除以零。
// unit 只标"真有量纲"的项（px / ° / 条）；无单位的留空，但列宽照样保留，数值才会对齐。

export const LIGHT_FIELDS = [
  { key: 'sunElevation', label: '主光仰角', min: 1, max: 89, step: 0.5, unit: '°' },
  // 方位角用 0.1° 步长：自动绕光时读数会连续变化，而不是整数跳格。
  { key: 'sunAzimuth', label: '主光方位', min: 0, max: 360, step: 0.1, unit: '°', driven: 'autoSun' },
  { key: 'sunIntensity', label: '主光强度', min: 0, max: 6, step: 0.05 },
  { key: 'hemisphereIntensity', label: '半球光', min: 0, max: 3, step: 0.02 },
  { key: 'fillIntensity', label: '补光强度', min: 0, max: 3, step: 0.02 },
  { key: 'fillAzimuth', label: '补光方位', min: 0, max: 360, step: 1, unit: '°' },
];

/**
 * 自动绕光的角速度。软件渲染只有 ~6–10fps，速度每高 1°/s，单帧角度就多跳一点，
 * 看上去越像"一格一格"。真机 60fps 下同样速度就很连续。
 */
export const AUTO_SUN_DEFAULT = 6;
export const AUTO_SUN_ROW = {
  key: 'autoSunSpeed',
  label: '绕光速度',
  min: 0.5,
  max: 60,
  step: 0.5,
  unit: '°/s',
};

export const PARAM_GROUPS = [
  {
    id: 'outline',
    title: '描边',
    note: '深度看外轮廓 · 法线看内部结构',
    fields: [
      { key: 'outlineThickness', label: '墨线粗细', min: 0, max: 6, step: 0.05, unit: 'px' },
      { key: 'depthWeight', label: '深度权重', min: 0, max: 200, step: 1 },
      { key: 'normalWeight', label: '法线权重', min: 0, max: 6, step: 0.05 },
    ],
  },
  {
    id: 'hatch',
    title: '排线',
    note: '阈值按主光 36.5° 标定',
    fields: [
      { key: 'hatchSpacing', label: '排线间距', min: 2, max: 48, step: 0.5, unit: 'px' },
      { key: 'hatchThickness', label: '排线线宽', min: 0, max: 6, step: 0.05, unit: 'px' },
      { key: 'hatchSun1', label: '受光 ≤ 叠竖线', min: 0, max: 1, step: 0.01 },
      { key: 'hatchSun2', label: '受光 ≤ 叠横线', min: 0, max: 1, step: 0.01 },
      { key: 'hatchSun3', label: '受光 ≤ 画斜线', min: 0, max: 1, step: 0.01 },
    ],
    select: 'shadowType',
  },
  {
    id: 'hand',
    title: '手绘与纸纹',
    fields: [
      { key: 'wiggleFrequency', label: '抖动频率', min: 0, max: 0.8, step: 0.005 },
      { key: 'wiggleAmplitude', label: '抖动幅度', min: 0, max: 8, step: 0.05, unit: 'px' },
      { key: 'paperStrength', label: '纸纹颗粒', min: 0, max: 0.35, step: 0.005 },
      { key: 'exposure', label: '曝光', min: 0.15, max: 3, step: 0.01 },
    ],
  },
  {
    id: 'specular',
    title: '手绘高光',
    fields: [
      { key: 'specularThreshold', label: '白点阈值', min: 0.02, max: 1.2, step: 0.01 },
      { key: 'specularShininess', label: '高光锐度', min: 20, max: 3000, step: 10 },
    ],
  },
  {
    id: 'speed',
    title: '速度线',
    note: '合成输入，不是实时速度',
    fields: [
      { key: 'speedEdgeOpacity', label: '墨量', min: 0, max: 1, step: 0.02 },
      { key: 'speedEdgeThickness', label: '线宽', min: 0.1, max: 6, step: 0.05, unit: 'px' },
      { key: 'speedEdgeDensity', label: '线槽密度', min: 6, max: 240, step: 1, unit: '条' },
    ],
  },
];

/** 图层开关：集中在一处，不散落到各分组里，便于一眼看全。 */
export const LAYER_TOGGLES = [
  ['outline', '描边'],
  ['hatch', '排线'],
  ['grain', '纸纹与抖动'],
  ['shadows', '阴影贴图'],
];

export const DEBUG_VIEWS = [
  [0, '合成（最终画面）'],
  [1, '描边掩码'],
  [2, '排线掩码'],
  [3, '法线缓冲'],
  [4, '深度'],
];

/**
 * 预设：一键切到"看得清这层在干什么"的极端组合。
 * 只写与默认不同的项 —— 未列出的键回到默认值，避免预设之间互相残留。
 */
export const PRESETS = [
  { id: 'default', label: '默认', params: {}, lights: {}, layers: {} },
  {
    id: 'lineart',
    label: '线稿 · 只留描边',
    params: {
      outlineThickness: 2.2,
      depthWeight: 120,
      normalWeight: 1.8,
      wiggleAmplitude: 0.6,
      paperStrength: 0.008,
    },
    lights: {},
    layers: { hatch: false },
  },
  {
    id: 'hatch-only',
    label: '纯排线 · 关掉墨线',
    params: { hatchSpacing: 6, hatchThickness: 1.6, hatchSun1: 0.2, hatchSun2: 0.45, hatchSun3: 0.7 },
    lights: {},
    layers: { outline: false },
  },
  {
    id: 'heavy-ink',
    label: '浓墨 · 全部拉到重',
    params: {
      outlineThickness: 4.5,
      depthWeight: 190,
      normalWeight: 4,
      hatchSpacing: 4,
      hatchThickness: 3.4,
      paperStrength: 0.16,
      wiggleAmplitude: 2.4,
    },
    lights: { sunElevation: 18 },
    layers: {},
  },
  {
    id: 'low-sun',
    label: '斜阳 · 沙面也叠排线',
    params: {},
    lights: { sunElevation: 9, sunIntensity: 3.4 },
    layers: {},
  },
  {
    id: 'overhead',
    label: '顶光 · 排线退干净',
    params: {},
    lights: { sunElevation: 84, sunIntensity: 2.8 },
    layers: {},
  },
];
