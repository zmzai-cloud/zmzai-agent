# Quill 任务入口 Theme 对齐计划

> 设计规格：[`2026-09-02-quill-starter-theme-alignment-design.md`](../specs/2026-09-02-quill-starter-theme-alignment-design.md)

1. 移除不对称主卡及所有非 theme 的色彩、渐变、手写阴影和装饰元素。
2. 以 `Card variant="interactive"` 和 theme token 重建 01—04 四项编辑器式入口。
3. 保持同一份任务数据及 `setPrompt` / `setResearchMode` 点击行为。
4. 运行 typecheck、lint，并检索入口区不含硬编码颜色。
