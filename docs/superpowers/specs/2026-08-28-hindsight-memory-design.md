# Workspace 长期记忆系统设计 — 基于 Hindsight 的薄抽象架构

- 日期：2026-08-28
- 状态：已批准（设计阶段）
- 范围：zmzai-agent MVP；后续演进为用户侧知识库产品

## 1. 背景与目标

zmzai 生态需要一套知识/记忆底座：先升级 agent 的长期记忆能力，未来以同一底座开放用户侧知识库产品。选定开源项目 [hindsight](https://github.com/vectorize-io/hindsight)（vectorize-io，MIT）作为记忆引擎，zmzai 只做薄应用层。

### 现状基线

- 整个生态无任何向量检索能力，统一存储 MongoDB（HK 服务器），技术栈 Next.js 15 + Mongoose
- zmzai-agent 现有 workspace 知识库为纯文本注入：手工条目、16k 字符硬上限、全文塞 prompt（`lib/project-agent-context.ts` 的 `formatWorkspaceKnowledge`），无检索
- agent 无跨会话语义记忆（harness 的 JSONL 仅为会话转录持久化）

### 目标

1. agent 会话经验自动沉淀（retain），后续会话按任务相关性召回（recall）
2. 记忆服务故障时 agent 功能完全不受损（静默降级）
3. 架构留出演进路径：bank 隔离模型可直接开放为用户产品；每 bank 自带 MCP endpoint 可供 harness 等客户端直连

### 非目标（明确不做）

- 不做记忆管理 UI（复用 hindsight 自带 :9999 UI）
- 不集成 reflect（接口预留，二阶段再说）
- 不做用户级 bank、跨 workspace 记忆
- 不改现有 16k 手工知识库的任何行为（两者互补：手工条目 = 用户钦定必读事实；自动记忆 = 检索式背景）

## 2. 总体架构

```
┌─ zmzai-agent (a.zmzai.cloud, Next.js :3011) ──────────────────┐
│                                                                │
│  lib/memory/                                                   │
│   ├─ provider.ts      MemoryProvider 接口                      │
│   │                   { ensureBank, retain, recall, reflect }  │
│   ├─ hindsight.ts     HindsightMemoryProvider 实现             │
│   │                   (@vectorize-io/hindsight-client)         │
│   └─ noop.ts          降级实现（服务不可用时静默跳过）          │
│                                                                │
│  触点 1 · recall:  prompt 入口 recall(当前任务) →               │
│            结果作为独立 context 消息拼进本次运行的上下文        │
│  触点 2 · retain:  product-event-log.ts 在 run 结束(idle)时    │
│            异步 retain 本次会话经验（不阻塞、失败只告警）        │
└──────────────┬─────────────────────────────────────────────────┘
               │ HTTP (HK 服务器内网)
┌──────────────▼─────────────────────────────────────────────────┐
│  hindsight (docker, HK 服务器, :8888 API + :9999 UI)           │
│   - PostgreSQL/pg0 内置，零外部依赖                            │
│   - LLM 抽取走 relay: HINDSIGHT_API_LLM_PROVIDER=              │
│     openai-compatible → m.zmzai.cloud/v1 (deepseek 低价渠道)   │
│   - bank_id = ws-<workspaceId>（严格隔离）                      │
│   - 每 bank 自带 MCP endpoint                                   │
└────────────────────────────────────────────────────────────────┘
```

### 关键决策与理由

| 决策 | 理由 |
| --- | --- |
| 包装 hindsight 而非自研 | 检索质量直接获得 LongMemEval SOTA（四路检索 + cross-encoder 重排 + 后台 consolidation）；observations / mental models / knowledge pages 白拿；MIT 可商用 |
| MemoryProvider 只放 zmzai-agent `lib/memory/`，不进 agent-framework 包 | 框架保持存储无关（符合现有 RunnerDeps 注入模式），避免 framework 依赖 hindsight-client |
| bank_id = `ws-<workspaceId>` | 与现有 approvalMode/skills/knowledgeBase 的隔离单位一致，用户心智不变 |
| hindsight 部署 HK 服务器、LLM 走 relay | 与生态同机内网直连；抽取的 LLM 消耗纳入 relay 计费/计量体系 |

### bank 生命周期

- workspace 创建 → `ensureBank`（workspace 名作为 bank 背景上下文）
- workspace 删除 → 调 hindsight 删 bank（fire-and-forget）
- bank_id 稳定性依赖 workspaceId 不可变（现有 schema 满足）

## 3. 数据流

### Recall（读路径）

- 触发：每次用户 prompt 进入 runner（prompt route 之后、runLoop 启动前）
- 流程：
  1. `bank_id = ws-<session.workspaceId>`
  2. `recall(bank_id, query=prompt 文本, max_facts≈12)`
  3. 格式化为独立 context 消息注入（不拼 systemPrompt——那是 workspace 级静态的）：

  ```
  [Long-term memory — recall from past work on this workspace; treat as background, verify before acting]
  - <fact 1>
  ...
  ```

- 注入机制：`runner.prompt()` 的 input 扩展可选 `memoryContext?: string` 字段（与现有 `images` 同级），runLoop 追加到 `initialState.messages` 头部。framework 只加通用字段，不感知 hindsight
- 预算：recall 结果硬上限 4k 字符，超出截断。与静态预算（16k 知识 + 24k skill 单条 + 80k skills 总量）互不挤占
- 超时：800ms 放弃本次召回

### Retain（写路径）

- 触发：`framework/core/events/product-event-log.ts` 现有 `session.status === "idle"` 收尾分支（与 qualityGate / automation 投影并列）
- 流程：
  1. 读本次 run 消息（store.getMessages，排除 tool 噪音，取 user/assistant 正文，上限 8k 字符）
  2. `retain(bank_id, content, context="session <id> run")` —— fire-and-forget（`void promise`）
  3. 事实抽取、实体/时间线归一、consolidation 全部由 hindsight 后台完成
- 防重复：runId 级 in-flight set（进程内去重即可；restart 重复 retain 由 hindsight 的 dedup/consolidation 消化）
- 失败策略：超时 5s、异常仅 `console.warn`，永不影响 run 状态与 automation 投影

### 错误降级

- hindsight 不可用 = 静默无记忆，agent 功能完全不受损
- 未配置 `HINDSIGHT_API_URL` 或 `HINDSIGHT_ENABLED=false` → noop provider，代码路径与生产一致

## 4. UI

- `framework/client/workspace-config.tsx` 知识库面板：保留现有手工条目管理，新增「自动记忆」折叠区 —— bank 状态（可用/不可用）、记忆条数统计、hindsight UI 入口链接（仅管理员）
- 对话页透明：recall 注入对用户不可见；「引用 N 条记忆」徽章留待后续
- 遵循 @zmzai/theme 设计语言，禁止 emoji 图标

## 5. 配置与部署

### 环境变量（zmzai-agent）

```
HINDSIGHT_API_URL=http://127.0.0.1:8888   # HK 同机内网直连
HINDSIGHT_ENABLED=true                     # 关闭即全链路 noop
```

### 部署

- HK 服务器：`docker run ghcr.io/vectorize-io/hindsight:latest`，`HINDSIGHT_API_LLM_PROVIDER` 指向 relay openai-compatible endpoint（deepseek 低价渠道，抽取 token 消耗大）
- zmzai-agent：现有 GitHub Actions → pm2 管线，无新部署单元
- hindsight 数据卷 docker volume 持久化

## 6. 测试

单元（vitest，沿用现有 97 文件 525 测试体系）：

- MemoryProvider 接口 + noop 实现行为
- recall 结果 → context section 格式化与 4k 截断
- retain 输入 transcript 组装与 8k 截断
- prompt route 对 memoryContext 透传（mock provider）

集成：mock MemoryProvider 验证 `initialState.messages` 头部注入与 idle 收尾 retain 触发（fire-and-forget 不阻塞）。

不测 hindsight 本身；部署后用一次真实会话人工验收端到端效果。

## 7. 风险与边界

| 风险 | 缓解 |
| --- | --- |
| hindsight LLM 抽取依赖 relay 可用性 | retain 失败静默 + 降级 noop |
| 本地开发连不上 HK hindsight | 默认 noop，不影响 dev |
| 引入 PG + Python 服务的新运维面 | docker 内置 pg0 零外部依赖；单容器单 volume |
| workspace 删除后 bank 残留 | 删除时 fire-and-forget 清理；残留无害（隔离且无引用） |

## 8. 演进路线（非 MVP）

1. 阶段二：reflect 集成 + mental models / knowledge pages 投影为 workspace 文档
2. 阶段三：zmzai-cloud 开放用户知识库产品（认证 + 前端 + bank 计量计费，底座不变）
3. 阶段四：harness / 其他客户端经每 bank MCP endpoint 直连
