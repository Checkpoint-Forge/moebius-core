# docs/ — 规则层

Agent 在本目录工作时遵守的规则。继承根规则，见 [../AGENTS.md](../AGENTS.md)。

- [ARCHITECTURE.md](ARCHITECTURE.md)：设计圣经。只写不变的设计决策与契约，不写步骤式 how-to、不列文件清单（那归 [src/README.md](../src/README.md)）。
- `postmortem/`：事故复盘，每篇 ≤ 5 行（摘要 / 时间线 / 根因 / 防再犯 / 关联）。无事不建，小事记进根 `AGENTS.md` 活跃坑。
- `images/`：文档配图。只放能说明当前行为的截图，随画风变化同步更新。
- 不在此目录复制 `src/README.md` 的文件职责，也不写测试命令（→ 根 `AGENTS.md`）。
