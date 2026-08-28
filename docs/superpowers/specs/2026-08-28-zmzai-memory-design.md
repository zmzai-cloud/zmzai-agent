# zmzai 记忆中心（zmzai-memory）设计

日期：2026-08-28
状态：已批准（用户确认：独立新应用 / 浏览+管理 / 所有用户按 workspace 隔离 / 命名「记忆中心」/ 原版 UI 保留容器+隧道兜底）

## 1. 背景与动机

原 spec（2026-08-28-hindsight-memory-design.md）决策「不做记忆管理 UI，复用 hindsight 自带 :9999 UI」。
上线后用户试用认为需要产品化：

- hindsight 原版 UI 无鉴权，只能通过 SSH 隧道或 Caddy Basic Auth 访问，体验割裂
- 用 zmzai 主题对原版 UI 做 CSS 覆盖（:root:root 注入）是 hack，脆弱且不完整
- 用户决策：**重写一个 zmzai 原生记忆管理台**，用 zmzai 账号登录、zmzai 主题、zmzai 权限语义

本 spec 推翻原 spec 的「复用 :9999 UI」决策，新增记忆管理 UI 为独立应用。

## 2. 产品定位

- 名称：记忆中心（代码仓 zmzai-memory，域名 k.zmzai.cloud）
- 一句话：zmzai 生态内 hindsight 长期记忆的管理台——用户用 zmzai 账号登录，查看/搜索/管理自己
  workspace 的记忆
- 非目标（YAGNI）：不做 retain 手动写入（记忆沉淀由 agent 自动完成）、不做 MCP endpoint
  管理、不做知识库/心智模型等 hindsight 高级能力、不做工作流

## 3. 技术架构

```
浏览器 → https://k.zmzai.cloud (Caddy :80/:443)
        → zmzai-memory (Next.js App Router, :3015, 仅 loopback 可反代)
            ├─ 页面：/ (bank 列表)、/banks/[id] (记忆浏览 + 语义搜索)
            ├─ API 路由（服务端）→ http://127.0.0.1:8888 (hindsight, 容器 loopback)
            └─ Mongo (muzhi_production)：session 校验 + workspace 成员关系
```

- 框架：Next.js（App Router），与生态一致
- 主题：@zmzai/theme v0.6（Navbar 品牌组件 + 纯白荧光绿 token），禁止 emoji、禁止自造组件
- 认证：复用 relay 的 session 模式——`muzhi_session` cookie（.zmzai.cloud 父域共享）→
  `hashToken(AUTH_SECRET, token)` → `SessionModel`/`UserModel` 校验（@zmzai/db，同库同 secret）
- hindsight 访问：仅服务端 fetch（127.0.0.1:8888 loopback），浏览器永远不直连 hindsight

## 4. 鉴权与授权模型

| 层级 | 机制 |
|---|---|
| 认证 | muzhi_session cookie 校验，未登录跳 auth.zmzai.cloud/login?next=... |
| 授权 | workspace 白名单：`WorkspaceModel.find({userId})`（owner）∪ `ProjectMemberModel.find({userId}).distinct("workspaceId")`（成员） |
| bank 可见性 | 仅返回白名单内的 bank（bank_id = workspaceId 原值）；admin 白名单（HINDSIGHT_ADMIN_USER_IDS）可见全部 |
| 删除权限 | 仅 workspace owner 或 admin 白名单；非 owner 成员只读 |
| 服务端强校验 | 所有 API 路由服务端二次校验（不能只靠前端隐藏按钮） |

env 变量：`SESSION_COOKIE_NAME=muzhi_session`、`SESSION_COOKIE_DOMAIN=.zmzai.cloud`、
`AUTH_SECRET`（与生产一致）、`MONGODB_URI`（muzhi_production）、`HINDSIGHT_API_URL=http://127.0.0.1:8888`、
`HINDSIGHT_ADMIN_USER_IDS`（逗号分隔，与 agent 生产 env 同值：ulanxx/牧之）。

## 5. 功能清单

### 页面
1. `/` 银行列表：每个 bank 一行——workspace 名称（经 WorkspaceModel 反查，无则显示 id）、
   记忆条数（listMemories count）、最近活动时间、空态引导
2. `/banks/[id]` 记忆详情：
   - 记忆条目时间线（按时间倒序，显示类型/内容/时间）
   - 语义搜索框：输入 query → recall → 结果按分数排序展示（含 reranker/semantic 分数）
   - 删除 bank 按钮（仅 owner/admin 显示），带确认对话框
3. 登录拦截：未登录整站跳 auth.zmzai.cloud；无任何 workspace 的用户显示空态页

### 服务端 API
| 路由 | 行为 |
|---|---|
| GET /api/banks | 列有权 bank（hindsight listBanks + 白名单过滤） |
| GET /api/banks/[id]/memories | 分页列记忆（hindsight listMemories） |
| POST /api/banks/[id]/recall | 语义搜索（hindsight recall，透传 query/maxTokens） |
| DELETE /api/banks/[id] | 删 bank（仅 owner/admin，hindsight deleteBank） |
| GET /api/workspace/[id] | bank → workspace 元信息（名称） |

### hindsight API 依赖（@vectorize-io/hindsight-client，服务器端已有）
- listBanks / getBankProfile / listMemories / recall / deleteBank / getVersion
- 端点注意：recall 为 `POST /v1/default/banks/{bank_id}/memories/recall`（部署实测确认）

## 6. 部署方案

1. 新建 GitHub 仓 `zmzai-cloud/zmzai-memory`（独立 git），复制 agent 的参数化
   deploy.yml（APP_NAME: memory，pnpm 10.34.5 / node 22 / quality+deploy 两 job）
2. 服务器：
   - `/opt/zmzai/scripts/deploy-targets.sh` 注册 memory（app 目录、release 目录、pm2 名、端口 3015）
   - `/opt/zmzai/envs/memory/.env.production`：见 §4 env 清单（真源，symlink 到 release）
   - pm2：`next start -p 3015`（runner 用户）
3. Caddy：`k.zmzai.cloud { reverse_proxy 127.0.0.1:3015 }`——**移除 basic_auth**（登录交给应用），
   原 :9999 反代块删除
4. 原版 hindsight UI：容器保留（数据/API 依赖），SSH 隧道兜底；k.zmzai.cloud 不再暴露它
5. 本地开发：SSH 隧道（27017 Mongo + 8888 hindsight）+ .env.local 对齐生产（与 relay 开发模式一致）

## 7. 安全考虑

- hindsight API 依旧只绑 loopback + 防火墙拒绝外网（不变）
- 新应用是唯一公网入口，所有 hindsight 操作经服务端 + 授权校验
- 删除操作幂等且二次确认；API 层校验 owner/admin
- 不记录/不缓存 hindsight 数据于应用侧（每次实时代理）

## 8. 验收标准

1. 未登录访问 k.zmzai.cloud → 跳 auth.zmzai.cloud，登录后回跳
2. 登录后看到自己 workspace 的 bank 列表（无他人 workspace）
3. 进入 bank 详情，记忆时间线正确；语义搜索返回带分数的结果
4. 非 owner 成员看不到删除按钮，直接调 DELETE API 返回 403
5. admin 白名单用户可见全部 bank 且可删任何
6. 主题：Navbar 品牌 + 纯白荧光绿，无 emoji，与 a.zmzai.cloud 观感一致
7. 删除 bank 后列表即时刷新；hindsight 容器重启后页面不崩（错误态友好）

## 9. 回滚

- Caddy 切回 k.zmzai.cloud → :9999 + basic_auth（原配置有备份）
- 应用下线不影响 agent 记忆功能（agent 直接调 8888）
