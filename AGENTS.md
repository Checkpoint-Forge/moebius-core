# Moebius Core — 维护索引

墨线渲染内核 + 演示台。设计契约见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 规则

- 依赖方向单向：`demo/` 可以依赖 `engine/`，反向禁止。
- `src/engine/` 只依赖 `three`，不读 DOM、不读应用状态；复制该目录即可移植。
- 画风参数唯一来源是 `render-params.js` 的 `RENDER_PARAMS`，改默认值同时递增 `PARAMS_VERSION`。
- 排线与描边只读法线缓冲的几何信号，不读屏幕亮度。
- 文件职责与改后必测 → [src/README.md](src/README.md)；决策 → [.agents/notes/](.agents/notes/)。

## 命令

```shell
npm start                  # 静态服务 → http://127.0.0.1:5180/
npm run check              # 全量语法检查
python tools/smoke.py      # 浏览器冒烟：13 项断言 + 截图
python tools/loss-trace.py # WebGL context 丢失取证
```

改 `src/engine/` → `npm run check` + `tools/smoke.py`；改 `src/demo/` → 同上并看截图；改文档 → 链接与换行校验。

## 验证快照

- `npm run check` 14/14 通过；`tools/smoke.py` 13/13 通过。
- 真机 GPU：1440×900，165 fps（截图见 `docs/images/hero.png`）。
- 无头 SwiftShader：约 10 fps，阴影与 MSAA 自动降级，`?shadows=1` 可强制开启。
- 文档链接 45 条、锚点 0 错误；36 个文件换行一致。

## 活跃坑

- **npm registry 不可达**：系统代理拒绝连接，`npm install` 必失败。three.js 已 vendor 到 `vendor/three/`（0.180.0，MIT），不要再引入需要安装的依赖。
- **`backdrop-filter: blur()` 会打死画布**：面板盖在 WebGL 画布上时，软件渲染下会让 context 丢失、画布变白。
- **HalfFloat 渲染目标读回必须用 `Uint16Array`**：传 `Uint8Array` 不报错，只静默得到全零。
- **软件渲染下 context 会在首帧后丢一次**（~0.3s 丢、~1.3s 恢复）。取证脚本必须等"context 未丢且帧数 > 30"，否则截到白屏窗口，详见[复盘](docs/postmortem/2026-11-25-white-canvas-context-loss.md)。
- **测试选择器按 id 取**：按"最后一个滑杆"定位会抓错控件，产生假通过。
