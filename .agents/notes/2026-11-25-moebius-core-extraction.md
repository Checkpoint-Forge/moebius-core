# 决策：墨线画法独立成内核（2026-11-25）

状态：生效

## 问题

画法原本长在一个完整的 3D 应用里：三遍渲染、缓冲生命周期与状态注入都写在该应用的主类中。
要在别处复用它，只能复制整个应用，而复制会立刻产生两份会漂移的 shader。

## 决策

独立成项目，分 `src/engine/`（内核）与 `src/demo/`（演示台）。

- 内核只依赖 `three`：不 import 演示代码、不读 DOM、不读应用状态；动态量由调用方逐帧递入。
- API 是一个工厂：`createMoebiusPipeline(renderer, { scene, camera })` + `prepareScene` / `resize` / `setDynamic` / `render`。
- 已验证的部分（GLSL 结构、参数默认值、法线缓冲调度、纸纹生成）按原样搬入、不重写，注释按本项目语义重写。
- three.js vendor 到 `vendor/three/`（MIT），演示零安装。

## 替代方案

- 作为宿主应用的子类导出：任何复用都得背上无关依赖。
- 复制一套 shader：两份源码必然漂移。
- 发布 npm 包依赖 `three`：真要做包时把 three 换成 `peerDependencies` 即可，先不引入安装步骤。
- 重写 shader：会丢掉与默认值耦合的标定（`hatchSun1/2/3` 对应主光 36.5°）。

## 影响

- 内核与调用方的耦合点收敛到 6 个显式契约（见[架构说明](../../docs/ARCHITECTURE.md)）。
- 代价：自己维护 three.js 版本，升级时需核对用到的 chunk（`shadowmap_vertex`、`shadowmask_pars_fragment`、`packing`）。
