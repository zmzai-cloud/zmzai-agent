# HANDOFF — 给 Codex 的交接文档

> 日期：2026-08-12。作者：ZCode（上一轮实现者）。
> 产品：`a.zmzai.cloud`（zmzai-agent 仓库）。任务：用 PI（@earendil-works/pi-agent-core）实现 OpenCode 式 Agent 框架。
> 目标：让 Codex 从当前状态无缝继续。**先读本文件 + spec，再动代码。**

## 0. 一句话现状

框架 M0–M5 已全部实现并上生产：a.zmzai.cloud 跑的是新框架（plan/build 已下线）；M5 把框架抽成了独立包 `packages/agent-framework`（@zmzai/agent-framework，已发布 npm + git tag v0.1.0 + GitHub Release）。**当前全部待办（P0–P3）已闭环，无需接手动作。**

## 1. 仓库布局

```
zmzai-agent/（git 仓库，main 分支，remote: Ulanxx/zmzai-agent，push 触发 GitHub Actions 自动部署到香港服务器 a.zmzai.cloud）
├── app/                    # Next.js App Router（/quill 工作台、/audit 审计、/api/quill/*、/api/audit/*）
├── framework/              # 产品侧兼容层：Mongo 实现 + 包 re-export（薄壳）
│   ├── core/session/       #   mongo-models.ts, mongo-store.ts（产品实现）
│   ├── core/events/        #   mongo-models.ts, mongo-event-log.ts（EventLog 实现）, bus.ts（旧函数名兼容层）
│   ├── core/tools/         #   mongo-workspace.ts（产品 WorkspaceFiles 实现）
│   ├── core/runtime/       #   runner.ts（re-export 包 + defaultStore）
│   └── server/context.ts   #   【产品组装点】SessionRunner 注入 Mongo+relay+OpenSandbox
├── packages/agent-framework/   # 【M5 产物】@zmzai/agent-framework 独立包
│   ├── src/core/           #   框架核心（session/events/permission/agent/tools/runtime）全适配器化
│   ├── src/adapters/       #   5 个注入接口 + 参考实现（jsonl/fs/subprocess-sandbox/openai-provider）
│   ├── src/server/create-server.ts  # createServer(deps) 组装入口
│   ├── src/cli.ts          #   bin: zmzai-agent serve/run
│   ├── openapi.yaml        #   HTTP + SSE 契约
│   ├── examples/standalone.mjs      #   第三方演示
│   └── dist/               #   构建产物（已 .gitignore）
├── lib/                    # 共享产品库（sandbox-execution/sandbox-snapshot/workspace-edit/relay-agent-stream 等）
├── models/                 # 共享 mongoose 模型（workspace/workspace-file/workspace-revision/sandbox-artifact）
├── instrumentation.ts      #   Framework lease-recovery 启动（用包 startLeaseRecovery）
├── docs/superpowers/specs/2026-08-11-pi-agent-framework-v0-design.md     # 【主 spec：M1-M5 全记录】
├── docs/superpowers/specs/2026-08-11-pi-agent-framework-m5-packaging-design.md  # M5 设计
└── docs/superpowers/plans/2026-08-11-fw-protocol-acceptance.md           # 生产验收清单
```

## 2. 已完成（M1–M5）

| 阶段 | 内容 | 状态 |
|---|---|---|
| **M1 骨架** | Session/Message/Part wire 类型、Mongo store、EventLog、权限引擎（ruleset last-match-wins + once/always/reject + always 持久化） | ✅ 上生产 |
| **M2 Runner** | SessionRunner（PI 适配层）、7 内置工具（read/glob/grep/write/edit/bash/todo）、agent presets（default/readonly/explore/general）、HTTP 路由 | ✅ 上生产 |
| **M3 产品切换** | /quill 工作台（parts 渲染、内联审批、todo、产物预览）、旧 plan/build 全下线（30+ 文件删除）、审计页重写为 FW 事件源、lease-recovery | ✅ 上生产（commit ea5f65d） |
| **M4 框架化** | task 子代理、.zmzai/agents/*.md 自定义 agent、compaction、JSONL store | ✅ 上生产（commit 3b73bcf + 2 个 parentId 修复） |
| **M5 抽包** | packages/agent-framework 独立包、5 注入接口、createServer、CLI、OpenAPI、examples | ✅ 上生产（commit 7309f49，lockfile 修复 0907a75） |

## 3. 当前未提交改动（39 文件）— ✅ 已提交部署（2026-08-25）

原 M5 未提交的 39 个文件已在 P0 一并提交（7309f49 + 0907a75），push main 触发 GitHub Actions 自动部署到 a.zmzai.cloud，quality + deploy 全绿，生产冒烟通过（/quill 200、/ → 307、旧路由 404）。

## 4. 待办清单（按优先级）

### P0 — 提交 M5 并部署（✅ 已完成）
1. commit M5（7309f49，lockfile 修复 0907a75）
2. push main，GitHub Actions quality + deploy 全绿
3. 生产冒烟通过（/quill 200、/ → 307、旧路由 404）

### P1 — 发布 npm（✅ 已完成，2026-08-25）
- `@zmzai/agent-framework@0.1.0` 已发布到公共 npm（126 文件，tag latest，public access）
- 依赖 `@earendil-works/pi-agent-core@0.84.1` / `@earendil-works/pi-ai@0.84.1` 均为**公开包**，无需改 peerDependencies（发布前 npm view 可解析）
- 前置条件（dist/openapi.yaml/bin）此前已全部就绪；发布时 ~/.npmrc token 失效（401），由用户提供新 token 后一次成功
- 可选后续：git tag + GitHub Release（2026-08-25 已执行：v0.1.0 tag + Release）

### P2 — 框架遗留（✅ 全部完成，2026-08-25）
- **title 异步生成**：`lib/quill-session-title.ts`（maybeGenerateSessionTitle）接线 sessions POST + prompt POST；defaultRelayModel=deepseek-v4-flash；默认值守卫防覆盖用户改过的标题；失败静默降级
- **webfetch 工具**：`packages/agent-framework/src/core/tools/webfetch.ts` 实现（SSRF 私网段拦截 + 256KB 上限 + 15s 超时 + htmlToText，experimental 标记），注册进 builtinTools，11 个单测
- **JSONL 后端的 workspace facade**：`framework/server/context.ts` FW_MODE=local 全本地链路（store=JSONL、workspace=FS、sandbox=subprocess、eventLog=memory、agents=FS 读取）；修复 local 模式 runner/API store 分裂隐藏 bug（mongoSessionStore → defaultStore）
- **子代理嵌套端到端单测**：runner.test.ts 新增 task tool end-to-end 测试（faux 三响应驱动父子嵌套，验证 child session/subtask part/父总结）；task 工具参数名是 `subagent_type`，builtinDefaults `"*": "allow"` 下默认免审批
- **完整 TUI**：spec 非目标（只有 CLI serve/run）

### P3 — 生产数据清理（✅ 已完成，2026-08-25，用户确认后执行）
- 8 个旧 protocol collection 全部 drop：zmzaiagenttaskruns(35)/taskevents(13007)/changeproposals(3)/executionproposals(0)/executiongrants(0)/toolcalls(19)/artifactreferences(4)/agentsessions(11)
- fw sessions 级联删除 15 个（含 events 1214 / messages 182 / parts 493 / checkpoints 166 / runs 14 / sandbox 索引 13）——实际测试残留远多于最初记录的 3 个
- sandbox 产物桶（GridFS `sandboxArtifacts.files/chunks` 14/14）drop；默认 fs 桶本就为空
- ⚠️ 保留：zmzaiagenttasks（sessionId=null，任务定义）、zmzaiframeworkseqs（计数器）、workspaces/workspacefiles/revisions、zmzaiagentruns 相关 run 系统表（若再建 session 会重新生成）
- 操作通道：HK 服务器完整 SSH（~/.ssh/id_rsa，hk-deploy-key 是受限 deploy wrapper）+ mongosh 2.9.2
- 清理脚本留存于 zmzai-relay/scripts/：reclassify-failed-attempts.mongosh.js + cleanup-u4-production.mongosh.js

## 5. 关键架构决策（避免 Codex 踩坑）

1. **适配器注入**：框架包零产品依赖。5 接口 = ModelProvider / SandboxExecutor / LeaseStore / EventLog / WorkspaceFiles。产品在 `framework/server/context.ts` 注入 Mongo+relay+OpenSandbox 实现；包自带 JSONL/FS/subprocess/OpenAI 参考实现。
2. **包 ESM 构建**：用 `module: NodeNext` + 相对 import 带 `.js` 扩展名（否则 dist 无法被 node import）。产品 tsconfig paths + vitest alias + next.config webpack `extensionAlias` 都指向**包源码**（不是 dist），三者必须同步改。
3. **EventLog**：包定义接口，`createMemoryEventLog` 是内存实现；产品 `mongo-event-log.ts` 是 Mongo 实现（seq 计数 + fw_events collection）。`notifyEventLogListeners` 做进程内 SSE fan-out。
4. **runner 必填 deps**：`eventLog` + `workspaceFor` 必填；`sandbox`/`leaseStore` 可选（默认 noop）。
5. **生产组装**：`getFrameworkRunner()` 是单例（globalThis 防 HMR），注入 streamFnFor（按 userId 绑 relay 计费）+ compaction（relay 模型摘要，contextWindow 128k）。
6. **权限唯一插入点**：PI `beforeToolCall`。审批 once/always/reject 经 `PermissionEngine`，always 固化到 session.permission。
7. **mongoose immutable 坑**（M4 踩过）：`parentId` 标了 immutable，只能创建时写入，不能 updateSession 补——子代理创建子会话时用 createFrameworkSession 的 parentId 参数一次写入。

## 6. 测试地图

```
产品（npm test，114）：
  framework/core/session/mongo-store.test.ts    # Mongo SessionStore（含 parentId 持久化回归）
  framework/core/events/bus.test.ts             # 兼容层 publishFrameworkEvent（mongo mock）
  其余 15 个文件：lib/ models/ 共享库测试
包（cd packages/agent-framework && npx vitest run，77）：
  core/permission/{ruleset,engine}.test.ts      # 权限引擎
  core/agent/{loader,registry}.test.ts          # 自定义 agent + presets
  core/session/jsonl-store.test.ts              # JSONL store
  core/events/bus.test.ts（包内）                # EventLog 接口 + 内存实现
  core/tools/{adapter,builtins}.test.ts         # 工具
  core/runtime/{runner,compaction}.test.ts      # runner 集成（faux provider）+ compaction
```

## 7. 用户上下文（重要）

- 用户是 zmzai 创始人（mu.zhi@yingdao.com），中文沟通，关注"框架能独立分发"。
- 已确认决策：session 强绑 workspace、子代理继承父 workspaceId、title 便宜模型异步生成、运行中输入 FIFO 排队（全部在 spec §13）。
- **用户已要求发布 npm 并完成**（@zmzai/agent-framework@0.1.0，见 P1）。
- 生产部署 = push main 自动触发；验收方法 = HK 服务器 SSH（root@149.88.84.189）+ mongosh 铸造 30 分钟测试 session（见 memory hk-server-ssh + 验收清单）。
- 上一轮对话结束时我问过"commit + push M5？"，用户转交给 Codex——**M5 提交部署已在 P0 完成（7309f49），当前无待办。**

## 8. 下一步建议（Codex 接手顺序）

1. 读本文件 + `docs/superpowers/specs/2026-08-11-pi-agent-framework-v0-design.md`（§11.1 实现状态）
2. P0/P1/P2/P3 已全部完成（2026-08-25）；v0.1.0 tag + GitHub Release 已打
3. 生产数据清理后若需回看，脚本在 zmzai-relay/scripts/（cleanup-u4-production.mongosh.js）
4. 有疑问找 ZCode 的 memory：`/Users/ulanxx/.zcode/cli/memories/projects/zmzai-7a5fdbd75a13cbb4/memory/`（pi-opencode-framework.md 最全）
