// 法线 pass 的调度：只在画面静止时隔帧复用缓冲。
//
// 契约：每个颜色帧调用一次，且必须在颜色 pass 的 render() 之后 ——
// 那时 three 已经更新好相机与场景的 matrixWorld。
// 首次、矩阵变化或外部强制失效时立即重画；连续静止时按"跳一帧、画一帧"复用。
//
// 本模块不 import three，也不拥有任何场景对象。四份矩阵快照在构造时预分配，
// shouldRender()/reset() 不产生任何分配。

const MATRIX_ELEMENTS = 16;

function matrixChanged(elements, snapshot) {
  // NaN !== NaN：坏矩阵会持续请求重画，不能把损坏姿态当成稳定画面缓存。
  for (let i = 0; i < MATRIX_ELEMENTS; i += 1) {
    if (elements[i] !== snapshot[i]) return true;
  }
  return false;
}

function copyMatrix(elements, snapshot) {
  for (let i = 0; i < MATRIX_ELEMENTS; i += 1) snapshot[i] = elements[i];
}

export class NormalPassScheduler {
  constructor() {
    // Float64Array 精确保留 three 的 Matrix4.elements（本身是 JS number），
    // 避免快照自己再引入一次 Float32 舍入而制造假运动。
    this._cameraWorld = new Float64Array(MATRIX_ELEMENTS);
    this._cameraProjection = new Float64Array(MATRIX_ELEMENTS);
    this._subject = new Float64Array(MATRIX_ELEMENTS);
    this._initialized = false;
    this._stationaryTick = 0;
  }

  /**
   * @param {{matrixWorld:{elements:ArrayLike<number>}, projectionMatrix:{elements:ArrayLike<number>}}} camera
   * @param {{matrixWorld:{elements:ArrayLike<number>}}} subject 会动的子树根（场景或某个分组）
   * @param {boolean} [needsRender=false] 外部强制失效信号（resize / 参数变更等）
   * @returns {boolean} true = 本帧重画法线；false = 复用上一张法线缓冲
   */
  shouldRender(camera, subject, needsRender = false) {
    const cameraWorld = camera.matrixWorld.elements;
    const cameraProjection = camera.projectionMatrix.elements;
    const subjectMatrix = subject.matrixWorld.elements;

    const changed = !this._initialized
      || matrixChanged(cameraWorld, this._cameraWorld)
      || matrixChanged(cameraProjection, this._cameraProjection)
      || matrixChanged(subjectMatrix, this._subject);

    if (changed) {
      copyMatrix(cameraWorld, this._cameraWorld);
      copyMatrix(cameraProjection, this._cameraProjection);
      copyMatrix(subjectMatrix, this._subject);
      this._initialized = true;
    }

    // 运动中的每一帧都重画；最后一次运动帧也会更新快照。强制更新同样把
    // 静止相位归零，因此随后第一帧复用、第二帧重画，不会多跳一张新画面。
    if (changed || needsRender) {
      this._stationaryTick = 0;
      return true;
    }

    this._stationaryTick = (this._stationaryTick + 1) & 1;
    return this._stationaryTick === 0;
  }

  /** 下一次调用按首次绘制处理；已分配的缓冲保留复用。 */
  reset() {
    this._initialized = false;
    this._stationaryTick = 0;
  }
}
