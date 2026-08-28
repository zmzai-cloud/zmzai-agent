# hindsight 长期记忆部署指南（HK 服务器）

对应 spec：`docs/superpowers/specs/2026-08-28-hindsight-memory-design.md`。

hindsight（vectorize-io，MIT）提供 Retain/Recall 记忆服务：zmzai-agent 在每次
run 终态把新增对话沉淀（retain）进 bank，下次 run 开始时按当前 prompt 语义
召回（recall）注入。bank 按 workspace 隔离（bank_id = workspaceId 原值）。

## 0. 暴露面（必读）

hindsight 的 API（:8888）、UI（:9999）、每 bank MCP endpoint 均**无内建鉴权**。
任何能访问到端口的人可以跨 bank 读写/删除记忆。因此：

- docker 端口**仅绑 loopback**（见下文 docker run 命令）
- 防火墙/安全组**显式拒绝** 8888/9999 的外网入站（双保险）
- 管理入口：**记忆中心** https://k.zmzai.cloud（独立应用 zmzai-memory，zmzai 账号登录 + workspace 隔离权限，见下方说明与 spec `2026-08-28-zmzai-memory-design.md`）
- 原版 UI（:9999）：SSH 隧道兜底（`ssh -L 9999:127.0.0.1:9999 root@149.88.84.189`），不再对外反代
- UI 直链（裸 9999）永不暴露给终端用户

### 0.1 记忆中心（zmzai-memory，k.zmzai.cloud）

hindsight 的 zmzai 原生管理台，替代原 Basic Auth + CSS 主题注入方案：

- **架构**：独立 Next.js 应用（github.com/Ulanxx/zmzai-memory），服务器 :3015，pm2 进程名 `memory`，Caddy 反代 k.zmzai.cloud → 127.0.0.1:3015（无 Basic Auth，认证在应用内）
- **认证**：`muzhi_session` cookie（@zmzai/db 同库同 secret），未登录 307 跳 auth.zmzai.cloud；退出走 `/api/auth/logout`（清共享会话，全子域退出）
- **权限**：bankId = workspaceId；可见 = 自己拥有的 workspace ∪ 作为成员的 workspace（只读 `zmzaiagentworkspaces`/`zmzaiagentprojectmembers`）；`HINDSIGHT_ADMIN_USER_IDS`（与 agent 同值，取自 `/opt/zmzai/envs/memory/.env.production`）白名单用户全量可见可删；删除仅 owner/admin
- **主题**：@zmzai/theme（纯白 + 荧光绿 + MiSans）
- **部署**：与 relay 同 CI 模式（push main → GitHub Actions build → `store/deploy memory <sha>`），env 权威副本 `/opt/zmzai/envs/memory/.env.production`（envget memory 下发给 CI 构建）
- hindsight API 仅服务端可达（`HINDSIGHT_API_URL=http://127.0.0.1:8888`），公网永远摸不到

（历史方案存档：Basic Auth + 容器内 CSS 覆盖注入的做法见 §6.5，已弃用）

## 1. HK 服务器：启动 hindsight

```bash
docker run -d \
  --name hindsight \
  --restart unless-stopped \
  -p 127.0.0.1:8888:8888 \
  -p 127.0.0.1:9999:9999 \
  -e HINDSIGHT_API_LLM_PROVIDER=openai \
  -e HINDSIGHT_API_LLM_BASE_URL=https://m.zmzai.cloud/v1 \
  -e HINDSIGHT_API_LLM_MODEL=deepseek-v4-flash \
  -e HINDSIGHT_API_LLM_API_KEY=<relay 独立 service key> \
  -v hindsight_data:/home/hindsight/.pg0 \
  ghcr.io/vectorize-io/hindsight:latest
```

要点：

- `-v hindsight_data:/home/hindsight/.pg0`：内置 pg0（PostgreSQL）数据卷持久化，
  升级/重启容器记忆不丢。
- **LLM 抽取凭证走 relay 独立 service key**（deepseek 低价渠道）：抽取 token
  计入平台侧服务成本，与用户计费额度严格分离。在 relay 控制台单独签发。
- embeddings/reranker 用容器内置 local provider（默认），无需额外配置。
- 资源：约 500–600MB 内存；首次启动会初始化 pg0，稍慢属正常。

验证：

```bash
curl http://127.0.0.1:8888/health
# 期望 {"status":"healthy","database":"connected"}
```

## 2. Memory Defense（PII/secret 脱敏）

hindsight 内建 per-bank Memory Defense（PII/secret 模式识别脱敏）。MVP 为每个
bank 开启（SDK 无 per-bank 参数时，在 UI/Control Plane 或 API 里对 bank 设置）。

部署后验证：向任一 bank retain 一段含假 API key 的文本，到 UI 里确认该 key
已被脱敏为占位符而不是原样入库。

## 3. 防火墙

以云厂商安全组 + 主机防火墙双保险：

```bash
# 主机层（ufw 示例）：拒绝外网入站 8888/9999（loopback 流量不受影响）
sudo ufw deny 8888/tcp
sudo ufw deny 9999/tcp
```

## 4. 管理访问（SSH 隧道）

UI（:9999）可见全部 bank 且无鉴权，只经隧道访问：

```bash
ssh -L 9999:127.0.0.1:9999 <hk-host>
# 本机打开 http://127.0.0.1:9999
```

zmzai-agent 侧：把管理员 userId 加入 `HINDSIGHT_ADMIN_USER_IDS`（逗号分隔），
这些用户在智能体配置页的「自动记忆」折叠区会看到上述隧道指引；其他用户不可见。

## 5. zmzai-agent 侧接线

现有 GitHub Actions → pm2 管线，**无新部署单元**，仅在生产环境补 3 个 env：

```
HINDSIGHT_API_URL=http://127.0.0.1:8888   # HK 同机内网直连
HINDSIGHT_ENABLED=true
HINDSIGHT_ADMIN_USER_IDS=<userId 列表>
```

改完 `pm2 restart` 生效。未配置 `HINDSIGHT_API_URL` 或 `HINDSIGHT_ENABLED=false`
时全链路 noop，行为与没有记忆功能完全一致。

## 6. 冒烟验收

API 层（服务器上）：

```bash
# retain
curl -X POST http://127.0.0.1:8888/v1/default/banks/ws_smoke/memories \
  -H 'content-type: application/json' \
  -d '{"items":[{"content":"冒烟测试：用户偏好深色主题","context":"smoke"}]}'
# recall（注意是 /memories/recall，部署实测确认）
curl -X POST http://127.0.0.1:8888/v1/default/banks/ws_smoke/memories/recall \
  -H 'content-type: application/json' -d '{"query":"用户偏好什么主题","max_tokens":500}'
# 结果应命中上面那条；验证完删除
curl -X DELETE http://127.0.0.1:8888/v1/default/banks/ws_smoke
```

端到端（真实会话）：

1. 用测试 workspace 发起一个任务，说「以后所有回复用中文输出版本号」
2. 等待 run 结束（终态触发 retain）
3. 新开一个会话问「版本号格式是什么」，确认回复体现了第 1 步的偏好
4. UI（隧道）里检查对应 bank 出现了记忆条目，且 `HINDSIGHT_ADMIN_USER_IDS`
   用户能在配置页看到条数

## 6.5 （已弃用，存档）k.zmzai.cloud Basic Auth + zmzai 主题注入

hindsight UI 无鉴权，公网访问必须经 Caddy 反代 + Basic Auth 保护：

```caddyfile
# /etc/caddy/Caddyfile 追加（密码 hash 用 `caddy hash-password --plaintext <pass>` 生成）
k.zmzai.cloud {
    basic_auth {
        admin $2a$...
    }
    reverse_proxy 127.0.0.1:9999
}
```

`caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy` 后生效；
证书由 Caddy 自动 HTTPS 签发（需 DNS A 记录 k → 服务器 IP）。

zmzai 主题注入（容器内改静态 CSS，无需重建镜像）：

1. 备份：`docker cp hindsight:/app/control-plane/.next/static/chunks/1y59zki454-nm.css /tmp/hindsight-orig.css`
2. 把主题覆盖块（.research/zmzai-theme-overlay.css：MiSans @font-face +
   `:root:root`/`:root.dark` 变量覆盖）追加到该 CSS 文件末尾
3. 替换 favicon：`docker cp zmzai-favicon.png hindsight:/app/control-plane/public/favicon.png`
4. 生效即改即刷（浏览器需硬刷新，CSS 响应 immutable 一年）

坑：

- 覆盖块选择器必须用 `:root:root`（特异性 0,2,0）——next/font 的 `.inter_xxx`
  类（0,1,0）会赢过普通 `:root`（0,1,0 但位置更早）
- 该改动写在容器可写层：hindsight 镜像更新（docker rm 重建）后需重做，
  原版 CSS 备份在容器 `/tmp/hindsight-orig.css`
- 页面标题（"Hindsight Control Plane"）在 JS bundle 内，无法改

## 7. 回滚

- 应用侧：生产 env 设 `HINDSIGHT_ENABLED=false` → 全链路 noop（recall 不注入、
  retain 不写入），hindsight 容器可以继续留着。
- 彻底下线：`docker stop hindsight && docker rm hindsight`（数据卷保留可随时恢复；
  确认放弃才 `docker volume rm hindsight_data`）。应用侧无需改代码。

## 8. 已知边界

- recall 每 run 至多阻塞 800ms、retain 5s，超时静默降级，不阻塞任务
- hindsight 不可用 = 静默无记忆，agent 功能完全不受损
- workspace 删除时同步删 bank（fire-and-forget）；与在途 retain 竞争可能残留
  空 bank，无害，可在 UI 手动清理
- 共享 workspace 的记忆沿成员共享语义：成员 A 沉淀的经验对成员 B 的运行可见
  （与 workspace 内容共享一致，属已声明的新增可见面）
