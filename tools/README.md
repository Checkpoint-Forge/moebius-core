# 检查工具（零依赖）

| 脚本 | 做什么 | 何时跑 |
| --- | --- | --- |
| `smoke.py` | 真实浏览器冒烟：12 项断言 + 四张通道截图 → `artifacts/` | 改 `src/` 任何文件后 |
| `loss-trace.py` | 记录 `webglcontextlost/restored` 与 `WEBGL_lose_context` 调用栈 | 画布变白、context 相关异常时 |

约定：

- 两个脚本都连同一台服务器（`npm start`），URL 可用 `MOEBIUS_URL` 覆盖。
- 只写 `artifacts/`，不往源码目录落产物。
- `smoke.py` 必须在"context 已恢复且帧数 > 30"之后取证，否则会截到首帧编译期的白屏窗口。
