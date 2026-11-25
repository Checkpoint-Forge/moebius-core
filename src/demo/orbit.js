import * as THREE from 'three';

const MIN_PHI = 0.18;
const MAX_PHI = 1.5;
const MIN_RADIUS = 6;
const MAX_RADIUS = 48;
const IDLE_BEFORE_DRIFT = 4;
const DRIFT_SPEED = 0.045;

/**
 * 极简轨道相机：拖动旋转、滚轮缩放、闲置自转。
 *
 * 刻意不用 three/addons 的 OrbitControls：这里只需要球坐标 + 三个指针事件，
 * 少一个 addon 依赖，也少一套自己的交互语义要跟它对齐。
 *
 * @param {THREE.PerspectiveCamera} camera
 * @param {HTMLElement} element 接收指针事件的画布
 * @param {{theta:number, phi:number, radius:number, target:THREE.Vector3}} home
 */
export function createOrbitCamera(camera, element, home) {
  const state = {
    theta: home.theta,
    phi: home.phi,
    radius: home.radius,
    target: home.target.clone(),
    dragging: false,
    idle: 0,
    lastX: 0,
    lastY: 0,
  };

  const clamp = THREE.MathUtils.clamp;

  function apply() {
    const sinPhi = Math.sin(state.phi);
    camera.position.set(
      state.target.x + state.radius * sinPhi * Math.sin(state.theta),
      state.target.y + state.radius * Math.cos(state.phi),
      state.target.z + state.radius * sinPhi * Math.cos(state.theta),
    );
    camera.lookAt(state.target);
  }

  element.addEventListener('pointerdown', (event) => {
    state.dragging = true;
    state.lastX = event.clientX;
    state.lastY = event.clientY;
    element.setPointerCapture(event.pointerId);
  });

  element.addEventListener('pointermove', (event) => {
    if (!state.dragging) return;
    state.theta -= (event.clientX - state.lastX) * 0.005;
    state.phi = clamp(state.phi - (event.clientY - state.lastY) * 0.005, MIN_PHI, MAX_PHI);
    state.lastX = event.clientX;
    state.lastY = event.clientY;
    state.idle = 0;
  });

  function endDrag(event) {
    state.dragging = false;
    if (element.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture(event.pointerId);
  }
  element.addEventListener('pointerup', endDrag);
  element.addEventListener('pointercancel', endDrag);

  element.addEventListener('wheel', (event) => {
    event.preventDefault();
    state.radius = clamp(state.radius + event.deltaY * 0.012, MIN_RADIUS, MAX_RADIUS);
    state.idle = 0;
  }, { passive: false });

  /** 每帧调用：闲置一段时间后缓慢自转，拖动时立刻让位给手。 */
  function update(dt, { reducedMotion = false } = {}) {
    state.idle += dt;
    if (state.idle > IDLE_BEFORE_DRIFT && !state.dragging && !reducedMotion) {
      state.theta += dt * DRIFT_SPEED;
    }
    apply();
  }

  apply();
  return { state, apply, update };
}
