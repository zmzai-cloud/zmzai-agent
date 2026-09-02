# Quill 任务入口层级实现计划

> 设计规格：[`2026-09-02-quill-starter-grid-hierarchy-design.md`](../specs/2026-09-02-quill-starter-grid-hierarchy-design.md)

1. 将任务入口数据保留在现有映射中，第一项作为主任务，其余三项作为次级任务。
2. 在新任务空态中实现桌面双列：深青绿主卡与右侧纵向次级卡；用 CSS 网格响应式回退至单列。
3. 通过纯 CSS 装饰图形和现有 Icon 建立层级，不增加运行时依赖或资源。
4. 保持每个 button 的 `setPrompt` / `setResearchMode` 行为不变；运行类型和 lint 检查。
