# Postmortem: 演示画布全白（2026-11-25）

- **摘要**：页面能起、UI 正常、无 JS 报错，但画布全白；离屏颜色缓冲读回全零。耗时约 30 分钟定位。
- **时间线**：首轮 smoke 只有"画面非空"两项失败 → 换 `Uint16Array` 重读仍是零 → 截图确认是白色而非透明 → 逐级 bisect（直出 / 颜色缓冲 / 法线 pass / 完整合成）四级全部健康 → 钩住 `WEBGL_lose_context` 与 `webglcontextlost`，发现首帧后 ~278ms 丢 context、~1290ms 由 three 恢复，取证脚本正好落在白屏窗口里 → 移除 `backdrop-filter: blur()` 后丢 context 不再出现。
- **根因**：面板的 `backdrop-filter: blur()` 让合成器把下层 WebGL 画布读进合成流程，软件渲染下触发 GPU 进程丢 context；同时取证脚本没有等待恢复，两个问题叠加成"画面空白"。
- **防再犯**：`index.html` 就地注明不许加回 `backdrop-filter`；`tools/smoke.py` 明确等待"context 未丢且帧数 > 30"后再取证；`AGENTS.md` 活跃坑记下 HalfFloat 读回必须用 `Uint16Array`。
- **关联**：[架构说明](../ARCHITECTURE.md) · [抽取决策](../../.agents/notes/2026-11-25-moebius-core-extraction.md)
