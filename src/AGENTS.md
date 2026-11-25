# src/ — 规则层

继承根规则，见 [../AGENTS.md](../AGENTS.md)。

`src/` 分两层，方向只能是 demo → engine：

- `engine/`：可复用的墨线内核。不许 import `../demo/` 任何文件，不许读 DOM（`ink.js` 的 canvas 贴图除外），不许读应用状态。
- `demo/`：演示台。可以随便依赖 engine，自己的生命周期也只服务这个页面。

硬约束：

- `engine/` 只依赖 `three`：不 import `demo/`，不读 DOM（纸纹贴图用 canvas 除外），不读任何应用状态。改公开 API 需在 [.agents/notes/](../.agents/notes/) 留一条决策记录。
- 动态输入（速度、加速度、座舱权重、时间）一律走 `setDynamic()`，不许让内核反向读调用方状态。
- 新增场景物体后必须让 `world` 侧重新 `prepareScene()`；透明件 / Line / Points / Sprite 必须带 `userData.noNormal`。
- 文件职责、依赖方向与改后必测见 [README.md](README.md)。
