# zmzai-agent · Hindsight 长期记忆实施计划

依据 spec：`docs/superpowers/specs/2026-08-28-hindsight-memory-design.md`
仓库根：`/Users/ulanxx/ulanxx_workspace/zmzai/zmzai-agent`（pnpm monorepo，Next.js 15 + Mongoose，vitest，corepack pnpm）

## 0. 现状核实结论（行号已打开确认）

| 触点 | 核实结果 |
| --- | --- |
| `packages/agent-framework/src/core/runtime/runner.ts` | RunnerDeps L34-70（hooks 在 L68-69）；`prompt()` L189-200（排队入队 L194）；runLoop L312-588；`initialState.messages` 构建 L376（Agent 构造 L367-382）；终态 finally L573-579，`fireRunEnd` L577；排队出队续跑 L581-587（出队直接递归 runLoop）；F6 重试合成占位文本内联 L544 |
| `packages/agent-framework/src/core/session/types.ts` | QueuedPrompt L8 `{ text, agent?, enqueuedAt }` |
| `framework/server/context.ts` | getOrCreateRunner L33-143，当前无 `hooks` 字段 |
| `lib/project-agent-context.ts` | 16k 预算 L42；24k/80k L68-69；combine L82-91 |
| `framework/core/events/product-event-log.ts` | idle 分支 L41-55 带 `!qualityGateFailed`；确认 retain 不挂这里 |
| `lib/workspaces.ts` | createWorkspace L69-80；ensureDefaultWorkspace L97-111（workspaceId = `ws_${randomUUID()}`）；deleteWorkspace L150-276 |
| `framework/client/workspace-config.tsx` | 知识库 section L278-307；「自动记忆」折叠区插在其后 |
| `config/env.ts` | environmentSchema L14-32 |
| runId 查询样板 | `product-event-log.ts` L42 `RunModel.findOne({sessionId}).sort({createdAt:-1})`（不带 active 过滤）——retain 钩子在 run 置终态后触发，须用此模式 |
| 测试基建 | `packages/agent-framework/src/core/runtime/runner.test.ts`（makeHarness L105-131 + faux core）|
| SDK | `@vectorize-io/hindsight-client` 未安装；批次一引入后先读 d.ts 再写调用代码 |

已确认关键事实：prompt 全部入口（route、排队出队、automation-execution L68/L116、wide-research L59/L106）收敛到 runLoop → 单点注入即全覆盖。

## 批次一：MemoryProvider 抽象（lib/memory + env）+ 单测

目标：framework 完全不感知 hindsight；本批不碰 runner、不碰 UI，独立验收。

前置动作：`corepack pnpm add @vectorize-io/hindsight-client`，先读 `node_modules/@vectorize-io/hindsight-client/dist/*.d.ts` 确认构造参数、retain/recall 签名（max_facts/max_tokens 参数名）、bank 创建/删除/统计方法、Memory Defense 开启参数。**d.ts 确认前不写 hindsight.ts 调用代码。**

| 文件 | 改动要点 |
| --- | --- |
| `config/env.ts` | schema 增 `HINDSIGHT_API_URL` / `HINDSIGHT_ENABLED` / `HINDSIGHT_ADMIN_USER_IDS`（optionalString，语义判定放 lib/memory） |
| `lib/memory/provider.ts`（新） | `MemoryProvider` 接口：`ensureBank` / `retain({bankId,content,context})` / `recall({bankId,query,maxFacts?}) => string[] \| null` / `deleteBank` / `status(bankId) => {available, factCount}` / `reflect` 预留（抛 NOT_IMPLEMENTED）。内部最小适配接口 `HindsightLike`；`createHindsightMemoryProvider({apiUrl, clientFactory?})` 支持测试注入；`getMemoryProvider()` 进程级单例（env 判定 → noop 或 hindsight）。deleteBank/status 是对 spec 接口清单的必要补全（bank 生命周期与 UI 统计需要），注释标注 |
| `lib/memory/noop.ts`（新） | 全 no-op：recall 恒 null、其余静默 resolve、status available=false |
| `lib/memory/hindsight.ts`（新） | HindsightClient → HindsightLike 包装；bank_id 传原值不加工；recall 800ms 超时、maxFacts 默认 12；retain 5s 超时；异常 `console.warn("[memory] ...")` 永不抛出；ensureBank 幂等 + Memory Defense 开启（以 d.ts 为准）；client 惰性创建 |
| `lib/memory/format.ts`（新） | `formatMemoryContext(facts)`：首行 `[Long-term memory — recall from past work on this workspace; treat as background, verify before acting]` + 逐条 `- <fact>`，硬上限 4000 字符整体截断；`formatRetainTranscript(messages)` 上限 8000 字符 |
| `package.json` | 增 `@vectorize-io/hindsight-client`（锁实际版本） |

新增测试：`lib/memory/format.test.ts`（格式化/4k 截断无残行/8k 截断）、`lib/memory/provider.test.ts`（noop 行为、recall/retain 超时 fake timers、client 抛错降级、ensureBank 幂等、status 透传、env 工厂判定）。

验证：`corepack pnpm typecheck && corepack pnpm vitest run lib/memory && corepack pnpm test`

## 批次二：framework 侧注入（RunnerDeps.memoryContextFor + onRunEnd 携带 newMessages）+ 单测

目标：framework 只加「返回文本的回调」与「终态携带本次新增消息」两个抽象点，不出现 hindsight 字样；未注入时行为零变化。

| 文件 | 改动要点 |
| --- | --- |
| `runner.ts` | ① RunnerDeps 加 `memoryContextFor?: (session, text) => Promise<string \| undefined>`。② runLoop L376 前先取 history；有 memoryContextFor 则 try 调用，返回文本构造 user 消息（text 块）**前插 history 头部**（只进内存 initialState，不落 store）；catch 吞掉降级。③ 前插后记 `baseline = history.length`。④ finally（L573-579）用 `extractRunTranscript(agent.state.messages, baseline)` 结果传给 L577 `fireRunEnd`。⑤ L544 占位文本提为导出常量 `RETRY_PLACEHOLDER_TEXT` |
| `core/runtime/run-transcript.ts`（新） | `extractRunTranscript(messages, baselineCount)`：slice(baseline)；仅 user/assistant；文本取 content text 块（兼容 string/块数组）；排除空文本、纯 toolCall/error、等于 RETRY_PLACEHOLDER_TEXT 的合成消息。导出 `RunTranscriptMessage = { role: "user" \| "assistant"; text: string }` |
| `core/runtime/lifecycle.ts` | `onRunEnd` input 追加 `newMessages?: RunTranscriptMessage[]`、`workspaceId?: string`；`fireRunEnd` 签名同步（纯类型扩展） |
| `src/index.ts` | 导出 `RunTranscriptMessage` |

不改动：`server/create-server.ts`、`prompt()`、排队逻辑（出队递归 runLoop 自动获得 recall）。

新增测试：`run-transcript.test.ts`（baseline 边界、toolCall/error 排除、占位排除、string/块数组两形态）；`runner-memory.test.ts`（复刻 runner.test.ts 的 memoryStore + faux harness 模式）：
- 注入返回文本 → initialState 首条为该文本且 `store.getMessages` 不含（不持久化断言）
- 返回 undefined / 抛错 → run 正常完成
- 排队覆盖：run 进行中 prompt 入队 → 出队续跑时 memoryContextFor 以新 text 再被调用
- onRunEnd 边界：预置历史后跑一轮 → newMessages 只含本轮
- abort 终态：hook 仍触发且带部分 newMessages；错误终态：ok=false
- waiting_input：以分支断言折中（注释记录）；error/abort 两条硬覆盖
- 现有 runner.test.ts / lifecycle.test.ts 零改动保持绿（回归门槛）

验证：`corepack pnpm typecheck && corepack pnpm vitest run packages/agent-framework/src/core/runtime && corepack pnpm test`

## 批次三：产品层接线（context 注入 + workspace 生命周期 + UI）+ 单测

| 文件 | 改动要点 |
| --- | --- |
| `framework/server/context.ts` | RunnerDeps 加 `memoryContextFor: (s, t) => recallMemoryContext(s, t)`、`hooks: [createMemoryRetainHook()]`；FW_MODE=local 无需特判（env 未配即 noop） |
| `lib/memory/recall-context.ts`（新） | `recallMemoryContext(session, text)`：provider.recall(bankId=workspaceId) → formatMemoryContext，只编排 |
| `lib/memory/retain-hook.ts`（新） | `createMemoryRetainHook(): LifecycleHook`：onRunEnd 无 workspaceId/空 newMessages 直接 return；`runId = RunModel.findOne({sessionId}).sort({createdAt:-1}).select({runId:1}).lean()`（不带 active 过滤，失败回退 sessionId）；runId 级 in-flight Set（retain 前 add、settle 后 delete）；content = formatRetainTranscript；`void provider.retain(...)` fire-and-forget + 仅 warn |
| `lib/workspaces.ts` | createWorkspace（L80 前）/ ensureDefaultWorkspace（L110 后）→ `void ensureBank(id)`；deleteWorkspace（return true 前）→ `void deleteBank(id)`；均 `.catch(() => undefined)` |
| `app/api/workspaces/[workspaceId]/memory/route.ts`（新） | GET，鉴权照抄 knowledge route：返回 `{ memory: { enabled, available, facts, isAdmin } }`；isAdmin = HINDSIGHT_ADMIN_USER_IDS 含 user.id；**不返回任何 hindsight 直链** |
| `framework/client/workspace-config.tsx` | 知识库 section 后加「自动记忆」折叠区：状态行 + 记忆条数（null 显示 —）；isAdmin 且可用时显示 SSH 隧道指引（`ssh -L 9999:127.0.0.1:9999 <host>` → `http://127.0.0.1:9999`，bank 为 workspaceId）。@zmzai/theme token/组件与相邻 section 一致，禁 emoji，不引新依赖 |

新增测试：`retain-hook.test.ts`（正常终态 context 含 sessionId+runId、同 runId 并发去重仅一次且 settle 后可再触发、RunModel 失败回退、空输入跳过、retain 抛错仅 warn）；`recall-context.test.ts`（facts→文本、null→undefined、抛错→undefined）。workspaces.ts 三行接线：若 Mongo mock 成本过高，降级为 Provider 级单测 + 批次四人工验收（计划内取舍，不得为可测性改动既有行为）。

验证：`corepack pnpm typecheck && corepack pnpm vitest run lib/memory && corepack pnpm test && corepack pnpm lint`

## 批次四：部署准备（文档 + 环境样例）

| 文件 | 改动要点 |
| --- | --- |
| `.env.example` | 三个 HINDSIGHT_* 变量与注释 |
| `docs/ops/hindsight-deployment.md`（新） | docker run 全命令（端口仅绑 127.0.0.1）、LLM 抽取 env（openai-compatible → m.zmzai.cloud/v1 + 独立 service key）、防火墙 deny 8888/9999、Memory Defense 验证、SSH 隧道步骤、pm2/Actions 仅补 env、冒烟验收（curl retain/recall + 真实会话端到端）、回滚（HINDSIGHT_ENABLED=false 即 noop） |

验证：typecheck + test 全绿。

## 关键约束对照（spec → 落点）

| spec 约束 | 落点 |
| --- | --- |
| framework 不依赖 hindsight-client | Provider 只在 lib/memory/；framework 仅见回调与 onRunEnd 信号 |
| recall 覆盖 route/排队/automation/wide-research | 单点注入 runLoop |
| retain 覆盖所有终态 | 挂 runner finally 而非 product-event-log idle 分支 |
| 只取本次 run 新增、排除 tool 噪音与合成占位 | extractRunTranscript + RETRY_PLACEHOLDER_TEXT 常量共享 |
| 去重键 runId 非 sessionId | retain-hook in-flight Set + RunModel 查询样板 |
| 800ms recall / 5s retain / 永不阻塞 | Promise.race + 全吞异常 + void promise |
| 4k/8k 上限 | format 纯函数 + 单测 |
| bank_id = workspaceId 原值 | 全链路不加工 |
| noop 降级 | env 工厂 + noop.ts |
| UI 无 emoji、无公网直链 | 折叠区 + route 只返回 isAdmin 布尔 |

## 风险与实现提示

1. runner.ts 是核心热路径：新逻辑全挂可选 dep 与 finally 只读提取；回归门槛 = 现有 runner/lifecycle 测试零改动保持绿；`prompt()`/排队/权限/F6 重试逻辑不动（仅 L544 字面量提常量）。
2. hindsight-client 签名未验证：安装后先读 d.ts；若 SDK 与 Next.js 服务端打包冲突，回退薄 fetch 客户端（接口面已被 HindsightLike 收敛在单文件）。
3. onRunEnd 时序：钩子在 idle 投影后触发，runId 查询不带 active:true。
4. newMessages 边界依赖 PI Agent 状态语义（重试替换末条、abort 半截 assistant）：提取器纯函数全量单测，实现时对照 pi-agent-core d.ts。
5. waiting_input 测试构造成本高：允许 error/abort 硬覆盖 + 分支断言折中（测试注释记录）。
6. recall 每 run 至多阻塞 800ms（含子代理 run）：spec 已接受；二阶段可改后台预热。
7. workspace 删除与在途 retain 竞争：残留 bank 无害，不做补偿。
8. 执行顺序：批次二先于批次三合入（唯一接口耦合：hook input 形状与 recallMemoryContext 签名）；批次四可随时插入。全部合入后按部署文档做真实会话端到端人工验收。
