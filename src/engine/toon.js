// 色板、四级 toon ramp、雾与天空底色。这些是"面"的一半：
// 墨线/排线负责"线"，ramp 负责"面"。只有线没有面，MeshToonMaterial 会退化成
// 平滑漫反射，画面变成"贴了网点纸的写实渲染"。
//
// 数值是画风的一部分，不要凭手感调：改 ramp 字节等于改所有固有色明度分层。
import * as THREE from 'three';

export const PALETTE = Object.freeze({
  // 底色：大面积地面、台面与雾天。这三色决定整幅画的"纸"，先定它们再谈物件。
  ground: 0xf0c2a0,
  surface: 0xf7e9cd,
  fog: 0xe7bfa8,
  // 灯光：暖顶、冷地、暖主光、冷补光。四色是一组，单独改一个会破坏冷暖平衡。
  skyWarm: 0xffe1b5,
  skyCold: 0x42566c,
  keyLight: 0xffd3a0,
  fillLight: 0x78a9bd,
});

// 四个字节 = 四档平涂。1 通道（RedFormat）与 4 通道（RGBA 灰）不能混用：
// MeshToonMaterial 用 gradientMap 采样，通道数错了会整片发白或发黑。
export const RAMP_FLAT = Object.freeze({ id: 'flat', channels: 4, bytes: [62, 62, 62, 255, 126, 126, 126, 255, 196, 196, 196, 255, 255, 255, 255, 255] });
export const RAMP_SCENE = Object.freeze({ id: 'scene', channels: 1, bytes: [70, 145, 210, 255] });
export const RAMP_VIVID = Object.freeze({ id: 'vivid', channels: 1, bytes: [72, 136, 202, 255] });
export const RAMP_GROUND = Object.freeze({ id: 'ground', channels: 1, bytes: [60, 116, 192, 255] });

const rampTextures = new Map();

export function rampTexture(ramp) {
  const cached = rampTextures.get(ramp);
  if (cached) return cached;
  const format = ramp.channels === 4 ? THREE.RGBAFormat : THREE.RedFormat;
  const texture = new THREE.DataTexture(
    new Uint8Array(ramp.bytes),
    ramp.bytes.length / ramp.channels,
    1,
    format,
  );
  texture.name = `toon_ramp_${ramp.id}`;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  rampTextures.set(ramp, texture);
  return texture;
}

/** 绑定一条 ramp 的 MeshToonMaterial 工厂。 */
export function toonFactory(ramp) {
  const gradientMap = rampTexture(ramp);
  return function toon(color, options = {}) {
    if (color !== null && typeof color === 'object') {
      return new THREE.MeshToonMaterial({ gradientMap, ...color });
    }
    return new THREE.MeshToonMaterial({ color, gradientMap, ...options });
  };
}

export const toonFlat = toonFactory(RAMP_FLAT);
export const toonScene = toonFactory(RAMP_SCENE);
export const toonVivid = toonFactory(RAMP_VIVID);
export const toonGround = toonFactory(RAMP_GROUND);

/**
 * 排线阈值的标定基准：主光仰角 36.5° 时，水平面 `N·L = sin(36.5°) ≈ 0.595`，
 * 高于默认 `hatchSun3 = 0.50`，所以平沙留平涂、排线只出现在立起来的形与背光坡面。
 * 这是画法的一部分（不是场景灯光偏好），改动它等于改分档语义。
 */
export const HATCH_CALIBRATION_SUN_ELEVATION = 36.5;

/**
 * 雾 + 天空底色。
 *
 * 天空不能用页面 CSS 渐变：地平线的屏幕高度随相机俯仰变化，写死的百分比渐变
 * 一定会在某个角度露出台阶。让场景自己铺一层"雾色天空"，地平线在任何角度都无缝，
 * 也正是沙海雾霭该有的样子。雾的两端还要连排线/描边的衰减一起考虑：
 * 墨线在雾完全遮蔽之前就必须归零。
 */
export function addFog(scene) {
  scene.fog = new THREE.Fog(PALETTE.fog, 22, 95);
  scene.background = new THREE.Color(PALETTE.fog);
  return scene.fog;
}
