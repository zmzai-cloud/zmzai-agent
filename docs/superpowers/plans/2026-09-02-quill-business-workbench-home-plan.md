# Quill 业务工作台首页实现计划

> 设计规格：[`2026-09-02-quill-business-workbench-home-design.md`](../specs/2026-09-02-quill-business-workbench-home-design.md)

1. 在 `framework/client/task-workbench.tsx` 的新任务空态中建立局部的展示数据：业务起点、交付能力标签与对应 prompt / 研究模式。
2. 替换现有居中 `PageHeader` 与大表单布局，创建暖白、左对齐的业务工作台首屏；复用现有 theme token、`Textarea`、`FilePicker`、`FileAttachments`、`Icon` 与提交逻辑。
3. 将快捷卡片换成业务场景；点击只预填 prompt 和模式，保持不自动提交。
4. 保持 `handleKeyDown`、附件上限、工作区错误和提交禁用规则不变。
5. 运行 TypeScript 检查、lint，并在桌面/窄屏下做视觉确认。
