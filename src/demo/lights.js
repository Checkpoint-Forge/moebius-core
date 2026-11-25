import * as THREE from 'three';
import { PALETTE } from '../engine/toon.js';

const DISTANCE = 80;

/**
 * 灯光状态。方位角以 -Z 为 0°、顺时针为正；仰角是主光与地平线的夹角。
 * 仰角不是"好看不好看"的自由参数：它直接决定水平面的 `N·L`，
 * 也就是排线的分档位置（36.5° 时平沙留平涂，降到 20° 以下整片沙面开始叠线）。
 */
export const LIGHT_DEFAULTS = Object.freeze({
  sunAzimuth: 304,
  sunElevation: 36.5,
  sunIntensity: 2.4,
  hemisphereIntensity: 0.72,
  fillIntensity: 0.3,
  fillAzimuth: 142,
});

const FILL_ELEVATION = 24.5;

function directionFrom(azimuthDeg, elevationDeg, distance = DISTANCE) {
  const azimuth = THREE.MathUtils.degToRad(azimuthDeg);
  const elevation = THREE.MathUtils.degToRad(elevationDeg);
  const horizontal = Math.cos(elevation) * distance;
  return new THREE.Vector3(
    Math.sin(azimuth) * horizontal,
    Math.sin(elevation) * distance,
    Math.cos(azimuth) * horizontal,
  );
}

/**
 * 暖半球 + 低角度暖主光 + 克制的冷补光。
 *
 * 主光必须是"真的方向光"：法线 pass 的入射方向从它的世界位置反算。
 * 自己再捏一份向量，排线分档就和颜色 pass 不是同一个太阳。
 */
export function createLightRig(scene, { shadows = true, shadowMapSize = 2048 } = {}) {
  const hemisphere = new THREE.HemisphereLight(
    PALETTE.skyWarm,
    PALETTE.skyCold,
    LIGHT_DEFAULTS.hemisphereIntensity,
  );

  const sun = new THREE.DirectionalLight(PALETTE.keyLight, LIGHT_DEFAULTS.sunIntensity);
  sun.castShadow = shadows;
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  // 阴影视锥必须盖住所有"看得见的地面"（雾远端 95，取 ±105）。
  // 视锥外的像素拿不到有效阴影值，会被当成全在阴影里 —— 表现为地平线附近
  // 突然冒出一圈密排线。反过来视锥越大纹素越粗，所以靠 normalBias 压自遮挡条纹。
  const extent = 105;
  sun.shadow.camera.left = -extent;
  sun.shadow.camera.right = extent;
  sun.shadow.camera.top = extent;
  sun.shadow.camera.bottom = -extent;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 320;
  // 大平面 + 低角度主光：法线偏移是压 acne 的主力，深度偏移只把阴影整体推开。
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.35;

  const fill = new THREE.DirectionalLight(PALETTE.fillLight, LIGHT_DEFAULTS.fillIntensity);

  scene.add(hemisphere, sun, sun.target, fill);

  /** 把一份灯光状态写进三盏灯。调用方负责在角度变化后作废法线缓冲。 */
  function apply(state) {
    sun.position.copy(directionFrom(state.sunAzimuth, state.sunElevation));
    fill.position.copy(directionFrom(state.fillAzimuth, FILL_ELEVATION));
    sun.intensity = state.sunIntensity;
    hemisphere.intensity = state.hemisphereIntensity;
    fill.intensity = state.fillIntensity;
  }

  apply(LIGHT_DEFAULTS);

  return { hemisphere, sun, fill, apply };
}
