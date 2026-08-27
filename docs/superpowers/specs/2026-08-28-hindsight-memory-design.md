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
│  触点 1 · recall:  RunnerDeps 注入 memoryContextFor 回调，       │
│            runLoop 启动前统一执行（覆盖 route/队列/automation）  │
│  触点 2 · retain:  runLoop 终态时用本次新增消息异步 retain，     │
│            覆盖所有终态（含 abort/质量门失败，不阻塞、只告警）   │
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

- workspace 创建/首次使用 → **幂等 lazy ensureBank**（每次 retain/recall 前检查，创建钩子仅作预热）——workspace 有 `createWorkspace` 与 `ensureDefaultWorkspace` 两条创建路径，lazy ensure 天然全覆盖
- workspace 删除 → 调 hindsight 删 bank（fire-and-forget）
- bank_id 直接使用 `workspaceId` 原值（其本身已带 `ws_` 前缀，不再叠加前缀）

## 3. 数据流

### Recall（读路径）

- 触发：**runLoop 启动前统一执行**，通过 `RunnerDeps` 注入产品回调 `memoryContextFor?: (session, text) => Promise<string | undefined>`（与现有 `streamFnFor`/`modelFor`/`workspaceFor` 注入模式一致）。这一个点位同时覆盖 prompt route、排队 prompt 出队续跑、automation 定时运行、wide-research 四条路径——若挂在 prompt route 或 `runner.prompt()` input 上，排队路径（QueuedPrompt 只保留 `{text, agent}`）与非 route 调用方（automation-execution.ts、wide-research.ts）会静默丢失记忆
- 流程：
  1. `bank_id = session.workspaceId`
  2. `recall(bank_id, query=prompt 文本, max_facts≈12)`
  3. 格式化为独立 context 消息注入（不拼 systemPrompt——那是 workspace 级静态的）：

  ```
  [Long-term memory — recall from past work on this workspace; treat as background, verify before acting]
  - <fact 1>
  ...
  ```

- 注入机制：runLoop 在构建 `initialState.messages` 前调用 `memoryContextFor`，返回值追加到消息头部。framework 只认识「返回一段文本的回调」，不感知 hindsight
- 预算：recall 结果硬上限 4k 字符，超出截断。与静态预算（16k 知识 + 24k skill 单条 + 80k skills 总量）互不挤占
- 超时：800ms 放弃本次召回

### Retain（写路径）

- 触发：**runLoop 所有终态**（正常 idle、abort、质量门失败均触发——失败经验往往最有价值；挂 runner 侧而非 product-event-log 的 idle 成功分支，避免遗漏）
- 流程：
  1. **边界取本次 run 新增消息**：runLoop 结束时直接使用内存中本次 run 新增的 user/assistant 消息（不整段取 store.getMessages——那会返回全会话历史，导致重复 retain；排除 tool 噪音，上限 8k 字符）
  2. `retain(bank_id, content, context="session <id> run")` —— fire-and-forget（`void promise`）
  3. 事实抽取、实体/时间线归一、consolidation 全部由 hindsight 后台完成
- 防重复：runId 级 in-flight set（进程内去重；pm2 单实例下成立）
- 失败策略：超时 5s、异常仅 `console.warn`，永不影响 run 状态与 automation 投影

### 错误降级

- hindsight 不可用 = 静默无记忆，agent 功能完全不受损
- 未配置 `HINDSIGHT_API_URL` 或 `HINDSIGHT_ENABLED=false` → noop provider，代码路径与生产一致

### 数据可见性与 PII

- **可见性边界声明**：bank 记忆沿 workspace 共享语义——项目成员对共享 workspace 发起运行时，recall 可见其他成员沉淀的经验（与成员本就能读 workspace 内容的现状一致，但属新增数据可见面，显式声明）
- **Memory Defense**：MVP 即为每个 bank 开启 hindsight 内建的 per-bank Memory Defense（PII/secret 45 模式识别脱敏，opt-in、成本极低），防止用户贴入对话的 API key 等原样进入记忆库

### 网络与鉴权

hindsight API/UI/MCP endpoint 均无内建认证，必须收敛暴露面：

- docker 仅绑 loopback：`-p 127.0.0.1:8888:8888 -p 127.0.0.1:9999:9999`，防火墙显式拒绝 8888/9999 外网入站——否则任何能推断 bank_id 的人可跨 workspace 读写/删除记忆
- hindsight UI（:9999，可见全部 bank）不对公网开放：管理入口改为「env userId 白名单 + 提示经 SSH 隧道访问」；workspace-config 仅向白名单用户展示隧道访问指引而非直链
- 阶段四开放 MCP/用户产品前，启用 hindsight 的 tenant/auth extension points（官方提供该扩展点）再暴露

## 4. UI

- `framework/client/workspace-config.tsx` 知识库面板：保留现有手工条目管理，新增「自动记忆」折叠区 —— bank 状态（可用/不可用）、记忆条数统计；env userId 白名单用户额外显示 hindsight UI 的 SSH 隧道访问指引（hindsight UI 无鉴权，不提供公网直链）
- 对话页透明：recall 注入对用户不可见；「引用 N 条记忆」徽章留待后续
- 遵循 @zmzai/theme 设计语言，禁止 emoji 图标

## 5. 配置与部署

### 环境变量（zmzai-agent，同步加入 config/env.ts 的 zod schema）

```
HINDSIGHT_API_URL=http://127.0.0.1:8888   # HK 同机内网直连
HINDSIGHT_ENABLED=true                     # 关闭即全链路 noop
HINDSIGHT_ADMIN_USER_IDS=                  # 可见 UI 隧道指引的白名单
```

### 部署

- HK 服务器：`docker run ghcr.io/vectorize-io/hindsight:latest`，端口仅绑 loopback（见「网络与鉴权」）
- hindsight LLM 抽取凭证：在 relay 申请**独立 service key**（deepseek 低价渠道），与用户计费归属严格分离——抽取 token 计入平台侧服务成本，不混入任何用户额度
- zmzai-agent：现有 GitHub Actions → pm2 管线，无新部署单元
- hindsight 数据卷 docker volume 持久化

## 6. 测试

单元（vitest，沿用现有测试体系）：

- MemoryProvider 接口 + noop 实现行为
- recall 结果 → context section 格式化与 4k 截断
- retain 输入 transcript 组装与 8k 截断，且**只包含本次 run 新增消息**
- 排队 prompt 出队续跑与 automation 入口同样触发 memoryContextFor（mock provider）
- abort / 质量门失败终态同样触发 retain

不测 hindsight 本身；部署后用一次真实会话人工验收端到端效果。

## 7. 风险与边界

| 风险 | 缓解 |
| --- | --- |
| hindsight LLM 抽取依赖 relay 可用性 | retain 失败静默 + 降级 noop |
| hindsight 无内建鉴权 | 端口仅绑 loopback + 防火墙拒绝外网入站 + UI 走 SSH 隧道（见「网络与鉴权」）|
| 共享 workspace 跨成员召回 | 显式沿 workspace 共享语义 + Memory Defense 脱敏 |
| 本地开发连不上 HK hindsight | 默认 noop，不影响 dev |
| 引入 PG + Python 服务的新运维面 | docker 内置 pg0 零外部依赖；单容器单 volume |
| workspace 删除后 bank 残留 | 删除时 fire-and-forget 清理；残留无害（隔离且无引用）|

## 8. 演进路线（非 MVP）

1. 阶段二：reflect 集成 + mental models / knowledge pages 投影为 workspace 文档
2. 阶段三：zmzai-cloud 开放用户知识库产品（认证 + 前端 + bank 计量计费，底座不变）
3. 阶段四：harness / 其他客户端经每 bank MCP endpoint 直连（前置条件：启用 hindsight 的 tenant/auth extension points）
