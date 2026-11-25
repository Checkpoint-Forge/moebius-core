# src/ — 墨线内核与演示台手册

工作约束见 [AGENTS.md](AGENTS.md)；设计决策见 [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)。

依赖方向只能 demo → engine。

## engine/ — 可复用内核

| 文件 | 职责 | 内部依赖 | 被谁依赖 |
| --- | --- | --- | --- |
| [moebius-pipeline.js](engine/moebius-pipeline.js) | 三遍渲染的装配与生命周期：缓冲、材质、`render()`、`resize()`、动态输入、调试通道 | 下面全部 | `demo/main` |
| [render-shader.js](engine/render-shader.js) | 合成分片、法线顶点/片元三段 GLSL。`LAB` define 才编译诊断分支 | 无 | `moebius-pipeline` |
| [render-params.js](engine/render-params.js) | `RENDER_PARAMS` 全部画风参数、`PARAM_META` 滑杆元数据、`applyRenderParams()` | 无 | `moebius-pipeline`、`demo/ui`、`demo/main` |
| [normal-pass-scheduler.js](engine/normal-pass-scheduler.js) | 比较矩阵决定法线缓冲重画还是复用；零分配、不 import three | 无 | `moebius-pipeline` |
| [ink.js](engine/ink.js) | 程序化纸纹贴图（256² canvas） | `rng` | `moebius-pipeline` |
| [rng.js](engine/rng.js) | 播种随机内核（mulberry32 + FNV-1a） | 无 | `ink` |
| [toon.js](engine/toon.js) | 色板、四级 toon ramp、`toonFactory`、雾与天空底色、`HATCH_CALIBRATION_SUN_ELEVATION` | 无 | `demo/main`、`demo/scene`、`demo/lights` |

`engine/` 只依赖 `three`：复制这个目录即可在别的项目里复用，不需要本仓库的 `demo/`。

改动影响路由：

- 改 shader → 跑 `tools/smoke.py`（能否编译、四张掩码是否仍分档清楚），并核对 `render-params.js` 的 uniform 映射是否遗漏。
- 改参数默认值 → 递增 `PARAMS_VERSION`，同步[架构说明](../docs/ARCHITECTURE.md)里的标定说明。
- 改 `toon.js` 的灯光或雾 → 排线分档全部失准，需重新核对 `hatchSun1/2/3`。

## demo/ — 演示台

| 文件 | 职责 | 内部依赖 |
| --- | --- | --- |
| [main.js](demo/main.js) | 渲染器、场景、管线装配、resize、context 丢失恢复、主循环、控制台入口 | 全部 |
| [lights.js](demo/lights.js) | 三盏灯与 `apply(state)`；方位/仰角 → 世界位置；阴影相机与偏置 | `engine/toon` |
| [scene.js](demo/scene.js) | 展示台内容与摆放规则（平底踩实 / 非平底浮空）、展示色板 | `engine/toon` |
| [controls.js](demo/controls.js) | 面板数据层：分组、滑杆区间与单位、图层开关、预设、绕光默认速度 | 无 |
| [ui.js](demo/ui.js) | 面板渲染：固定栅格的行、汇总区、预设应用、读数 | `engine/render-params`、`lights`、`controls` |
| [orbit.js](demo/orbit.js) | 球坐标轨道相机：拖动、滚轮、闲置自转。刻意不用 OrbitControls | 无 |

`demo/` 只服务 `index.html` 这一个页面；它坏了不影响内核可复用性。

## 外部输入

- `index.html` 用 import map 把裸标识符 `three` 指到 `../vendor/three/three.module.js`，因此没有打包步骤。
- `?shadows=1` 在软件渲染下强行开阴影，只用于取证截图。
