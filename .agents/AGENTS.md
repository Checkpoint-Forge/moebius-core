# .agents/ — 规则层

Agent 协作相关目录的规则。继承根规则，见 [../AGENTS.md](../AGENTS.md)。

- `notes/`：决策与依据记录。写什么、怎么分类、状态行格式见 [notes/README.md](notes/README.md)。
- 记录只增不改语义：事实变化就地更新，决策反转才写新记录并交叉引用。
- 不在本目录放迁移计划、验收清单或 spec 式描述（迁移 → `docs/PLAN.md`；验收 → 测试脚本）。
