# Quill 任务入口 Theme 对齐设计

**状态：设计已确认，待实现**  
**日期：2026-09-02**

## 问题与目标

撤销任务入口中绕开 `@zmzai/theme` 的深绿色主卡、渐变装饰与内联 hex 色。该区应恢复为 Agent 工作台的编辑器式索引：纯白底、墨黑结构、冷中性 surface 层级，视觉焦点来自排版与硬线，而非营销式色块。

## 结构

- “从一个常见任务开始”以 `--color-rule` 顶部硬线建立章节边界。
- 四个任务保留 01—04 的索引顺序，在桌面端四列、窄屏两列或单列；它们保持一致的信息密度，第一项仅以粗顶部边和较强标题字重为首选项，不使用色块。
- 每项包含序号、主题 `Icon`、标题与一行交付结果。取消箭头、假趋势图、深色背景、胶囊能力标签和非主题阴影。
- “从问题到交付”退为一行低权重文字说明，使用已有 `text-ink-3`，不与任务入口竞争。

## Theme 合规

- 所有颜色、边框、背景、阴影和字体仅使用 `bg-bg`、`bg-surface`、`bg-surface-2`、`text-ink*`、`border-line*`、`border-rule`、`shadow-*` 和 `font-*` token。
- 使用 `Card variant="interactive"` 承载任务入口，沿用组件的现有 hover、focus 及圆角语义；不新建视觉基础组件。
- 不使用语义绿、spot 色或任何 inline hex/oklch/rgb 值。

## 行为与验证

四项任务的名称、prompt、`research` 值和点击预填行为完全不变。保留原生 button 可访问性，且不自动发送。

验证 `pnpm typecheck`、`pnpm lint`，检查 1440px 与 390px 下无溢出，并确认 task-workbench 中本轮入口区不残留硬编码颜色。
