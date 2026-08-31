"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

import { Badge, Button, Card, CodeBlock, EmptyState, Icon, IconButton, Input, Select as ThemeSelect, SelectContent, SelectItem, SelectTrigger, SelectValue, Tabs } from "@zmzai/theme";
import { LoginGate, useLoggedIn, WorkbenchRail } from "@/framework/client/workbench-rail";

type Workspace = { id: string; name: string };
type ApiKeyScope = "tasks:write" | "tasks:read" | "artifacts:read" | "webhooks:write" | "chat:write";
type ApiKey = { id: string; prefix: string; name: string; workspaceIds: string[]; scopes: ApiKeyScope[]; status: "active" | "revoked"; lastUsedAt: string | null; revokedAt: string | null; createdAt: string };
type WebhookEvent = "task.succeeded" | "task.failed" | "task.cancelled";
type Subscription = { id: string; workspaceId: string; name: string; url: string; events: WebhookEvent[]; status: "active" | "paused"; secretPrefix: string; lastDeliveredAt: string | null; lastError: string | null; createdAt: string };
type Delivery = { deliveryId: string; eventType: WebhookEvent; taskId: string; runId: string; status: "pending" | "delivering" | "delivered" | "failed"; attempts: number; nextAttemptAt: string; responseStatus: number | null; lastError: string | null; deliveredAt: string | null; createdAt: string };
type WebhookStats = { delivered: number; pending: number; failed: number; total: number; consecutiveFailures: number };
type Tab = "quickstart" | "api" | "keys" | "webhooks";

const scopeOptions: Array<{ id: ApiKeyScope; label: string; detail: string }> = [
  { id: "tasks:write", label: "创建任务", detail: "通过 API 发起 Agent 任务" },
  { id: "tasks:read", label: "读取任务", detail: "查询状态和结构化结果" },
  { id: "artifacts:read", label: "读取成果", detail: "下载任务生成的文件" },
  { id: "webhooks:write", label: "管理 Webhook", detail: "保留给服务端集成管理" },
  { id: "chat:write", label: "Chat 补全", detail: "OpenAI 兼容的 /v1/chat/completions 接口" },
];
const eventOptions: Array<{ id: WebhookEvent; label: string }> = [
  { id: "task.succeeded", label: "任务完成" },
  { id: "task.failed", label: "任务失败" },
  { id: "task.cancelled", label: "任务取消" },
];
const tabItems: Array<{ value: Tab; label: string }> = [
  { value: "quickstart", label: "快速开始" },
  { value: "api", label: "API 参考" },
  { value: "keys", label: "API Key" },
  { value: "webhooks", label: "Webhook" },
];

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const body = await response.json().catch(() => null) as { error?: string } | T | null;
  if (!response.ok) throw new Error(body && typeof body === "object" && body !== null && "error" in body ? String(body.error) : "请求失败");
  return body as T;
}

function time(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" }) : "尚未使用";
}

/** 永不变化的订阅（useSyncExternalStore 用），用于读取不会变更的浏览器环境值。 */
const subscribeNever = () => () => {};

function scopeLabel(scope: ApiKeyScope) {
  return scopeOptions.find((option) => option.id === scope)?.label ?? scope;
}

function deliveryVariant(status: Delivery["status"]) {
  if (status === "delivered") return "success" as const;
  if (status === "failed") return "danger" as const;
  return "warning" as const;
}

// ---------- 文档小组件 ----------

function Step({ index, title, children }: { index: number; title: string; children: ReactNode }) {
  return (
    <Card padding="md" className="mb-4">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="flex size-5 flex-shrink-0 items-center justify-center rounded-sm bg-ink text-xs font-semibold text-bg">{index}</span>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
      </div>
      <div className="flex flex-col gap-1 text-sm text-ink-2">{children}</div>
    </Card>
  );
}

function CodeExample({ title, language, code }: { title: string; language: string; code: string }) {
  return (
    <div className="mt-3">
      <small className="mb-1.5 block text-xs font-semibold text-ink-3">{title}</small>
      {/* 文档代码示例较短，不设 maxHeight，避免长示例被纵向裁剪 */}
      <CodeBlock code={code} language={language} />
    </div>
  );
}

function InlineCode({ children }: { children: ReactNode }) {
  return <code className="rounded-sm bg-surface-2 px-1 py-0.5 font-mono text-xs text-ink">{children}</code>;
}

function EndpointCard({ method, path, scope, description, children }: { method: string; path: string; scope: string; description: string; children?: ReactNode }) {
  return (
    <Card padding="md" className="mb-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge variant={method === "GET" ? "outline" : "success"} size="sm">{method}</Badge>
        <code className="font-mono text-sm font-semibold text-ink">{path}</code>
        <Badge variant="accent" size="sm">{scope}</Badge>
      </div>
      <p className="mb-1 text-sm text-ink-3">{description}</p>
      {children}
    </Card>
  );
}

function DocTable({ headers, rows }: { headers: string[]; rows: Array<Array<string>> }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-sm border border-line">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-line bg-surface text-ink-2">
            {headers.map((header) => <th key={header} className="whitespace-nowrap px-3 py-2 font-semibold">{header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-line last:border-0">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className={`whitespace-nowrap px-3 py-2 ${cellIndex === 0 ? "font-mono text-ink" : "text-ink-3"}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- 快速开始 ----------

function QuickStart({ baseUrl, onGoToKeys }: { baseUrl: string; onGoToKeys: () => void }) {
  const createTaskCurl = `curl -X POST ${baseUrl}/v1/tasks \\
  -H "Authorization: Bearer zma_你的密钥" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: req_20260825_001" \\
  -d '{
    "workspace_id": "ws_xxx",
    "prompt": "分析本周销售数据并输出一份摘要报告",
    "title": "周报分析",
    "output_schema": {
      "type": "object",
      "properties": { "summary": { "type": "string" } },
      "required": ["summary"]
    }
  }'`;
  return (
    <div className="max-w-3xl">
      <Step index={1} title="创建 API Key">
        <p>进入 <button type="button" className="font-medium text-ink underline decoration-line underline-offset-2 hover:text-ink-2" onClick={onGoToKeys}>API Key</button> 页签，为 Key 选择工作区与权限范围。密钥以 <InlineCode>zma_</InlineCode> 开头，创建后只显示一次，请立即保存。</p>
      </Step>
      <Step index={2} title="携带密钥调用 API">
        <p>所有 <InlineCode>/v1</InlineCode> 端点都通过 <InlineCode>Authorization</InlineCode> 请求头认证，无需其他签名步骤。</p>
        <CodeExample title="请求头" language="bash" code="Authorization: Bearer zma_你的密钥" />
      </Step>
      <Step index={3} title="创建任务">
        <p>向 <InlineCode>{baseUrl}/v1/tasks</InlineCode> 发送 POST，<InlineCode>workspace_id</InlineCode> 与 <InlineCode>prompt</InlineCode> 必填。建议携带 <InlineCode>Idempotency-Key</InlineCode>（16–128 个可打印字符），重复提交相同请求不会创建重复任务。</p>
        <CodeExample title="curl" language="bash" code={createTaskCurl} />
        <CodeExample title="响应（HTTP 202，任务已入队）" language="json" code={`{
  "task_id": "task_xxx",
  "run_id": "run_xxx",
  "session_id": "ses_xxx",
  "status": "queued",
  "replayed": false
}`} />
      </Step>
      <Step index={4} title="轮询任务结果">
        <p>任务异步执行，轮询 <InlineCode>{"GET /v1/tasks/{task_id}"}</InlineCode> 直到 <InlineCode>status</InlineCode> 变为终态（<InlineCode>succeeded</InlineCode> / <InlineCode>failed</InlineCode> / <InlineCode>cancelled</InlineCode>）。响应中的 <InlineCode>structured_output</InlineCode> 会按创建时传入的 <InlineCode>output_schema</InlineCode> 返回结构化结果，<InlineCode>artifacts</InlineCode> 列出任务生成的文件。</p>
        <CodeExample title="curl" language="bash" code={`curl ${baseUrl}/v1/tasks/task_xxx \\
  -H "Authorization: Bearer zma_你的密钥"`} />
        <CodeExample title="响应" language="json" code={`{
  "id": "task_xxx",
  "workspace_id": "ws_xxx",
  "project_id": null,
  "title": "周报分析",
  "status": "succeeded",
  "output": "本周销售额环比增长 12%……",
  "structured_output": { "summary": "本周销售额环比增长 12%" },
  "run": { "id": "run_xxx", "status": "succeeded", "attempt": 1 },
  "artifacts": [
    { "id": "art_xxx", "title": "report.md", "url": "/api/v1/artifacts/art_xxx" }
  ]
}`} />
      </Step>
      <Step index={5} title="错误处理">
        <p>错误统一返回 <InlineCode>{"{ code, error }"}</InlineCode> JSON，HTTP 状态码符合语义：</p>
        <DocTable
          headers={["code", "HTTP", "说明"]}
          rows={[
            ["UNAUTHENTICATED", "401", "未登录"],
            ["API_KEY_UNAUTHORIZED", "401", "API Key 无效或缺少所需权限"],
            ["INVALID_BODY", "400", "请求体格式不正确"],
            ["IDEMPOTENCY_KEY_REQUIRED", "400", "缺少 Idempotency-Key 请求头"],
            ["WORKSPACE_NOT_FOUND", "404", "工作区不存在或无权访问"],
            ["TASK_NOT_FOUND", "404", "任务不存在或无权访问"],
            ["PROJECT_BUDGET_EXCEEDED", "429", "项目并发运行数达到上限"],
            ["WEBHOOK_UNAUTHORIZED", "401", "Webhook 签名验证失败"],
          ]}
        />
      </Step>
    </div>
  );
}

// ---------- API 参考 ----------

function ApiReference({ baseUrl }: { baseUrl: string }) {
  return (
    <div className="max-w-3xl">
      <DocTable
        headers={["方法", "路径", "权限", "说明"]}
        rows={[
          ["POST", "/v1/tasks", "tasks:write", "创建任务（返回 202 入队）"],
          ["GET", "/v1/tasks/{task_id}", "tasks:read", "查询任务状态、输出与成果"],
          ["POST", "/v1/tasks/{task_id}/cancel", "tasks:write", "取消运行中的任务"],
          ["GET", "/v1/artifacts/{artifact_id}", "artifacts:read", "下载任务生成的文件"],
          ["POST", "/v1/chat/completions", "chat:write", "OpenAI 兼容的流式补全"],
          ["GET", "/v1/models", "chat:write", "列出可用模型"],
          ["POST", "/v1/research", "tasks:write", "创建 Wide Research 研究任务"],
          ["GET", "/v1/research", "tasks:read", "查询研究任务与子任务结果"],
        ]}
      />
      <h3 className="mb-3 mt-6 text-base font-semibold text-ink">创建任务</h3>
      <EndpointCard method="POST" path="/v1/tasks" scope="tasks:write" description="发起一个 Agent 任务。任务异步执行，创建成功后通过 GET 轮询或 Webhook 接收结果。">
        <DocTable
          headers={["字段", "类型", "说明"]}
          rows={[
            ["workspace_id", "string · 必填", "任务所属工作区"],
            ["prompt", "string · 必填", "任务目标，最多 32 KiB"],
            ["project_id", "string", "关联项目（可选）"],
            ["title", "string", "任务标题，默认取 prompt 前 80 字符"],
            ["output_schema", "object", "JSON Schema，任务完成后返回结构化结果"],
          ]}
        />
        <p className="mt-3 text-sm text-ink-3">请求头 <InlineCode>Idempotency-Key</InlineCode> 可选但推荐：同一 Key 重复提交会返回首次结果（<InlineCode>replayed: true</InlineCode>）。</p>
        <CodeExample title="curl" language="bash" code={`curl -X POST ${baseUrl}/v1/tasks \\
  -H "Authorization: Bearer zma_你的密钥" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: req_20260825_001" \\
  -d '{
    "workspace_id": "ws_xxx",
    "prompt": "把本周用户反馈整理成 5 条要点"
  }'`} />
      </EndpointCard>
      <h3 className="mb-3 mt-6 text-base font-semibold text-ink">查询与取消任务</h3>
      <EndpointCard method="GET" path="/v1/tasks/{task_id}" scope="tasks:read" description="返回任务状态、最终回复、结构化输出与成果文件列表。">
        <CodeExample title="响应" language="json" code={`{
  "id": "task_xxx",
  "workspace_id": "ws_xxx",
  "project_id": null,
  "source": "api",
  "title": "周报分析",
  "prompt": "分析本周销售数据",
  "status": "succeeded",
  "created_at": "2026-08-25T09:00:00.000Z",
  "updated_at": "2026-08-25T09:05:00.000Z",
  "run": {
    "id": "run_xxx",
    "status": "succeeded",
    "attempt": 1,
    "terminal_reason": null,
    "started_at": "2026-08-25T09:00:01.000Z",
    "finished_at": "2026-08-25T09:05:00.000Z"
  },
  "output": "最终回复文本……",
  "structured_output": null,
  "output_contract_error": null,
  "artifacts": []
}`} />
      </EndpointCard>
      <EndpointCard method="POST" path="/v1/tasks/{task_id}/cancel" scope="tasks:write" description="取消运行中的任务。响应 202，cancelled 字段表示是否确实取消了活动运行。">
        <CodeExample title="响应" language="json" code={`{ "task_id": "task_xxx", "cancelled": true, "run_id": "run_xxx", "replayed": false }`} />
      </EndpointCard>
      <EndpointCard method="GET" path="/v1/artifacts/{artifact_id}" scope="artifacts:read" description="下载任务生成的文件，响应为文件二进制流（attachment）。文件 id 来自任务查询结果中的 artifacts 数组。">
        <CodeExample title="curl" language="bash" code={`curl -OJ ${baseUrl}/v1/artifacts/art_xxx \\
  -H "Authorization: Bearer zma_你的密钥"`} />
        <p className="mt-3 text-sm text-ink-3">响应头：<InlineCode>content-type</InlineCode> 为文件 MIME 类型，<InlineCode>content-disposition: attachment</InlineCode> 携带 UTF-8 文件名（<InlineCode>curl -OJ</InlineCode> 可直接保存），<InlineCode>etag</InlineCode> 为文件 SHA-256 摘要，可用于完整性校验。</p>
      </EndpointCard>
      <h3 className="mb-3 mt-6 text-base font-semibold text-ink">研究任务（Wide Research）</h3>
      <EndpointCard method="POST" path="/v1/research" scope="tasks:write" description="发起一个多角色并行研究任务：多个子 Agent 分别承担不同研究角色、独立产出结论，适合资料调研、竞品分析、事实核验等场景。">
        <DocTable
          headers={["字段", "类型", "说明"]}
          rows={[
            ["workspace_id", "string · 必填", "任务所属工作区"],
            ["question", "string · 必填", "研究问题，最多 32 KiB"],
            ["roles", "string[]", "研究角色（2–8 个），默认 资料检索 / 事实核验 / 反方审查"],
            ["max_concurrency", "integer", "并行子任务数（1–4），默认 3"],
            ["project_id", "string", "关联项目（可选）"],
          ]}
        />
        <p className="mt-3 text-sm text-ink-3">可用角色：资料检索、事实核验、反方审查、行业视角、数据整理、趋势分析、案例比较、风险评估。同样支持 <InlineCode>Idempotency-Key</InlineCode> 幂等。</p>
        <CodeExample title="curl" language="bash" code={`curl -X POST ${baseUrl}/v1/research \\
  -H "Authorization: Bearer zma_你的密钥" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: res_20260825_001" \\
  -d '{
    "workspace_id": "ws_xxx",
    "question": "2026 年 AI Agent 开发平台的关键竞争维度有哪些？",
    "roles": ["资料检索", "事实核验", "行业视角"],
    "max_concurrency": 3
  }'`} />
        <CodeExample title="响应（HTTP 202，子任务已入队）" language="json" code={`{
  "research_job_id": "resjob_xxx",
  "task_id": "task_xxx",
  "run_id": "run_xxx",
  "status": "queued",
  "child_count": 3,
  "replayed": false
}`} />
      </EndpointCard>
      <EndpointCard method="GET" path="/v1/research?research_job_id={id}" scope="tasks:read" description="查询研究任务状态与各子任务结论，children 中每个子任务对应一个研究角色。">
        <CodeExample title="响应" language="json" code={`{
  "research_job_id": "resjob_xxx",
  "task_id": "task_xxx",
  "status": "succeeded",
  "question": "2026 年 AI Agent 开发平台的关键竞争维度有哪些？",
  "children": [
    { "task_id": "task_c1", "role": "资料检索", "status": "succeeded", "summary": "……", "error": null },
    { "task_id": "task_c2", "role": "事实核验", "status": "succeeded", "summary": "……", "error": null },
    { "task_id": "task_c3", "role": "行业视角", "status": "succeeded", "summary": "……", "error": null }
  ],
  "failed_children": 0,
  "error": null
}`} />
      </EndpointCard>
      <h3 className="mb-3 mt-6 text-base font-semibold text-ink">Chat 补全与模型</h3>
      <EndpointCard method="POST" path="/v1/chat/completions" scope="chat:write" description="OpenAI 兼容的聊天补全接口，支持流式（stream: true），可直接对接 OpenAI SDK。">
        <CodeExample title="curl" language="bash" code={`curl -X POST ${baseUrl}/v1/chat/completions \\
  -H "Authorization: Bearer zma_你的密钥" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "deepseek-v3",
    "messages": [{ "role": "user", "content": "用一句话总结今天的天气" }],
    "stream": false
  }'`} />
        <DocTable
          headers={["参数", "类型", "说明"]}
          rows={[
            ["model", "string · 必填", "模型 ID（见 GET /v1/models）"],
            ["messages", "array · 必填", "system / user / assistant / tool 消息"],
            ["stream", "boolean", "是否 SSE 流式返回，默认 false"],
            ["temperature", "number", "0–2，默认由模型决定"],
            ["max_tokens", "integer", "最大生成 token 数"],
            ["top_p / stop / n", "number / string / int", "OpenAI 标准采样参数（n 仅支持 1）"],
          ]}
        />
      </EndpointCard>
      <EndpointCard method="GET" path="/v1/models" scope="chat:write" description="列出当前可用的模型 ID，响应结构与 OpenAI /v1/models 一致，可直接用作 chat/completions 的 model 参数。">
        <CodeExample title="curl" language="bash" code={`curl ${baseUrl}/v1/models \\
  -H "Authorization: Bearer zma_你的密钥"`} />
        <CodeExample title="响应" language="json" code={`{
  "object": "list",
  "data": [
    { "id": "gpt-5.6-luna", "object": "model", "created": 1787640000, "owned_by": "relay" },
    { "id": "deepseek-v3", "object": "model", "created": 1787640000, "owned_by": "relay" }
  ]
}`} />
      </EndpointCard>
      <h3 className="mb-3 mt-6 text-base font-semibold text-ink">Webhook 签名验证</h3>
      <Card padding="md" className="mb-4">
        <p className="text-sm text-ink-3">订阅 Webhook 后，事件以 HTTP POST 投递到你的端点，携带三个签名请求头：</p>
        <DocTable
          headers={["请求头", "说明"]}
          rows={[
            ["x-zmzai-webhook-id", "投递唯一 ID，可用于去重"],
            ["x-zmzai-webhook-timestamp", "投递时间（ISO 8601），偏差超过 5 分钟应拒绝"],
            ["x-zmzai-webhook-signature", "签名，格式 v1=<hex>"],
          ]}
        />
        <p className="mt-3 text-sm text-ink-3">签名算法：<InlineCode>{"v1 = HMAC_SHA256(secret, `${timestamp}.${webhook_id}.${raw_body}`)"}</InlineCode>，其中 secret 是创建 Webhook 时显示的签名密钥，<InlineCode>raw_body</InlineCode> 是未解析的原始请求体。验签必须使用常量时间比较。</p>
        <CodeExample title="Node.js（Hono / Express / Next.js）" language="typescript" code={`import { createHmac, timingSafeEqual } from "node:crypto";

const secret = "whsec_你的签名密钥";

async function verifyWebhook(req: Request): Promise<boolean> {
  const rawBody = await req.text();
  const timestamp = req.headers.get("x-zmzai-webhook-timestamp");
  const webhookId = req.headers.get("x-zmzai-webhook-id");
  const signature = req.headers.get("x-zmzai-webhook-signature");
  if (!timestamp || !webhookId || !signature) return false;

  // 时间戳偏差不能超过 5 分钟
  if (Math.abs(Date.now() - new Date(timestamp).getTime()) > 5 * 60_000) return false;

  const expected = \`v1=\${createHmac("sha256", secret)
    .update(\`\${timestamp}.\${webhookId}.\${rawBody}\`, "utf8")
    .digest("hex")}\`;
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}`} />
        <CodeExample title="Python（FastAPI / Flask）" language="python" code={`from datetime import datetime, timezone
import hashlib, hmac

def verify_signature(secret, timestamp, webhook_id, body, signature) -> bool:
    ts = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    if abs((datetime.now(timezone.utc) - ts).total_seconds()) > 300:
        return False
    expected = "v1=" + hmac.new(
        secret.encode(),
        f"{timestamp}.{webhook_id}.{body}".encode(),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(signature, expected)`} />
        <CodeExample title="事件负载示例" language="json" code={`{
  "id": "evt_xxx",
  "type": "task.succeeded",
  "occurred_at": "2026-08-25T10:00:00.000Z",
  "data": {
    "task_id": "task_xxx",
    "run_id": "run_xxx",
    "workspace_id": "ws_xxx",
    "project_id": null,
    "title": "周报分析",
    "source": "api",
    "status": "succeeded",
    "terminal_reason": null,
    "started_at": "2026-08-25T09:58:00.000Z",
    "finished_at": "2026-08-25T10:00:00.000Z"
  }
}`} />
      </Card>
      <h3 className="mb-3 mt-6 text-base font-semibold text-ink">自动化通知入口</h3>
      <p className="mb-3 text-sm text-ink-3">为自动化配置邮件、Slack 或 Webhook 入口后，外部系统可向以下端点推送事件、触发自动化任务。这三个端点使用创建自动化时生成的 <InlineCode>webhookSecret</InlineCode> 做签名认证，<strong className="text-ink">不经过 API Key 认证</strong>；配置自动化时展示的回调 URL 即对应端点。</p>
      <DocTable
        headers={["方法", "路径", "认证", "说明"]}
        rows={[
          ["POST", "/v1/automations/{automation_id}/email", "webhookSecret", "邮件消息入口（≤ 256 KiB）"],
          ["POST", "/v1/automations/{automation_id}/slack", "webhookSecret", "Slack 事件入口，支持 URL 验证握手"],
          ["POST", "/v1/automations/{automation_id}/webhook", "webhookSecret", "通用 Webhook 事件入口（≤ 64 KiB）"],
        ]}
      />
      <EndpointCard method="POST" path="/v1/automations/{automation_id}/webhook" scope="webhookSecret" description="通用 Webhook 入口：携带自定义事件 ID，验签通过后触发自动化任务。">
        <DocTable
          headers={["请求头", "说明"]}
          rows={[
            ["x-zmzai-event-id", "事件唯一 ID（必填，用于去重）"],
            ["x-zmzai-timestamp", "ISO 8601 时间戳，偏差超过 5 分钟拒绝"],
            ["x-zmzai-signature", "签名，格式 v1=<hex>"],
          ]}
        />
        <p className="mt-3 text-sm text-ink-3">签名算法与 Webhook 投递验签一致：<InlineCode>{"v1 = HMAC_SHA256(secret, `${timestamp}.${event_id}.${raw_body}`)"}</InlineCode>。</p>
        <CodeExample title="curl" language="bash" code={`curl -X POST ${baseUrl}/v1/automations/auto_xxx/webhook \\
  -H "x-zmzai-event-id: evt_001" \\
  -H "x-zmzai-timestamp: 2026-08-25T10:00:00.000Z" \\
  -H "x-zmzai-signature: v1=计算出的签名" \\
  -H "Content-Type: application/json" \\
  -d '{
    "kind": "ci_finished",
    "repo": "zmzai/zmzai-agent"
  }'`} />
        <CodeExample title="响应（HTTP 202）" language="json" code={`{
  "accepted": true,
  "replayed": false,
  "execution_id": "aexec_xxx",
  "task_id": "task_xxx",
  "run_id": "run_xxx"
}`} />
      </EndpointCard>
      <EndpointCard method="POST" path="/v1/automations/{automation_id}/email" scope="webhookSecret" description="邮件入口：兼容邮件网关转发，验签通过后触发自动化任务。">
        <DocTable
          headers={["请求头", "说明"]}
          rows={[
            ["x-zmzai-email-id", "邮件 message id（必填，用于去重与回复链关联）"],
            ["x-zmzai-email-timestamp", "ISO 8601 时间戳，偏差超过 5 分钟拒绝"],
            ["x-zmzai-email-signature", "签名，格式 v1=<hex>"],
          ]}
        />
        <p className="mt-3 text-sm text-ink-3">签名算法：<InlineCode>{"v1 = HMAC_SHA256(secret, `${timestamp}.${message_id}.${raw_body}`)"}</InlineCode>。请求体为邮件 JSON：<InlineCode>message_id</InlineCode> / <InlineCode>from</InlineCode> / <InlineCode>to</InlineCode> / <InlineCode>subject</InlineCode> / <InlineCode>text</InlineCode>（≤ 256 KiB）；携带 <InlineCode>in_reply_to</InlineCode> 可关联回复链，让自动化基于上下文继续执行。</p>
      </EndpointCard>
      <EndpointCard method="POST" path="/v1/automations/{automation_id}/slack" scope="webhookSecret" description="Slack 事件入口：兼容 Slack Events API 的 URL 验证握手与签名协议。">
        <DocTable
          headers={["请求头", "说明"]}
          rows={[
            ["x-slack-request-timestamp", "Slack 事件时间戳（Unix 秒）"],
            ["x-slack-signature", "Slack 标准 v0 签名"],
          ]}
        />
        <p className="mt-3 text-sm text-ink-3">URL 验证请求返回 <InlineCode>{"{ \"challenge\": \"…\" }"}</InlineCode>；消息事件验签通过后触发自动化任务。Slack 应用的事件订阅 URL 填 <InlineCode>{baseUrl}/v1/automations/auto_xxx/slack</InlineCode>，签名密钥取自自动化配置页的 webhookSecret。</p>
      </EndpointCard>
    </div>
  );
}

// ---------- 主页面 ----------

export default function DevelopersPage() {
  const [tab, setTab] = useState<Tab>("quickstart");
  // base URL 在客户端取当前 origin，SSR 时回退到生产域名（useSyncExternalStore 避免 hydration 差异）。
  const baseUrl = useSyncExternalStore(subscribeNever, () => window.location.origin, () => "https://a.zmzai.cloud");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [keyName, setKeyName] = useState("");
  const [keyWorkspaces, setKeyWorkspaces] = useState<string[]>([]);
  const [keyScopes, setKeyScopes] = useState<ApiKeyScope[]>(["tasks:write", "tasks:read", "artifacts:read"]);
  const [webhookName, setWebhookName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookEvents, setWebhookEvents] = useState<WebhookEvent[]>(["task.succeeded", "task.failed"]);
  const [revealedSecret, setRevealedSecret] = useState<{ kind: "API Key" | "Webhook 签名密钥"; value: string } | null>(null);
  const [deliveries, setDeliveries] = useState<Record<string, Delivery[]>>({});
  const [openDeliveries, setOpenDeliveries] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, WebhookStats>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const workspaceNames = useMemo(() => new Map(workspaces.map((workspace) => [workspace.id, workspace.name])), [workspaces]);
  const fetchPage = async (selectedWorkspaceId?: string) => {
    const ws = await json<{ workspaces: Workspace[] }>("/api/workspaces");
    const selected = selectedWorkspaceId ?? (workspaceId || ws.workspaces[0]?.id || "");
    const [keyResult, webhookResult] = await Promise.all([
      json<{ keys: ApiKey[] }>("/api/api-keys"),
      selected ? json<{ subscriptions: Subscription[] }>(`/api/webhooks?workspaceId=${encodeURIComponent(selected)}`) : Promise.resolve({ subscriptions: [] }),
    ]);
    return { workspaces: ws.workspaces, selected, keys: keyResult.keys, subscriptions: webhookResult.subscriptions };
  };
  const applyPage = (page: Awaited<ReturnType<typeof fetchPage>>) => {
    setWorkspaces(page.workspaces);
    setWorkspaceId(page.selected);
    setKeyWorkspaces((current) => current.length ? current : (page.selected ? [page.selected] : []));
    setKeys(page.keys);
    setSubscriptions(page.subscriptions);
  };
  const load = async (selectedWorkspaceId?: string) => {
    const page = await fetchPage(selectedWorkspaceId);
    applyPage(page);
  };

  useEffect(() => {
    let cancelled = false;
    void fetchPage().then((page) => { if (!cancelled) applyPage(page); }).catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "无法加载开发者设置"); });
    return () => { cancelled = true; };
    // Initial state is intentionally loaded once; later workspace changes call load explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = <T extends string,>(items: T[], item: T) => items.includes(item) ? items.filter((value) => value !== item) : [...items, item];
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); }
    catch { setError("浏览器未允许复制，请手动复制该值"); }
  };
  const selectWorkspace = (nextWorkspaceId: string) => {
    setWorkspaceId(nextWorkspaceId);
    setOpenDeliveries(null);
    void load(nextWorkspaceId).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "无法加载 Webhook"));
  };
  const createKey = async () => {
    if (!keyName.trim() || !keyWorkspaces.length || !keyScopes.length) return;
    setBusy("create-key"); setError(null);
    try {
      const created = await json<{ key: string; record: ApiKey }>("/api/api-keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: keyName, workspaceIds: keyWorkspaces, scopes: keyScopes }) });
      setKeys((current) => [created.record, ...current]); setKeyName(""); setRevealedSecret({ kind: "API Key", value: created.key });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "创建 API Key 失败"); }
    finally { setBusy(null); }
  };
  const revokeKey = async (key: ApiKey) => {
    if (!window.confirm(`撤销 API Key “${key.name}”？该操作无法恢复。`)) return;
    setBusy(key.id); setError(null);
    try {
      await json(`/api/api-keys/${encodeURIComponent(key.id)}`, { method: "DELETE" });
      setKeys((current) => current.map((item) => item.id === key.id ? { ...item, status: "revoked", revokedAt: new Date().toISOString() } : item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "撤销 API Key 失败"); }
    finally { setBusy(null); }
  };
  const createWebhook = async () => {
    if (!workspaceId || !webhookName.trim() || !webhookUrl.trim() || !webhookEvents.length) return;
    setBusy("create-webhook"); setError(null);
    try {
      const created = await json<{ subscription: Subscription; secret: string }>("/api/webhooks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, name: webhookName, url: webhookUrl, events: webhookEvents }) });
      setSubscriptions((current) => [created.subscription, ...current]); setWebhookName(""); setWebhookUrl(""); setRevealedSecret({ kind: "Webhook 签名密钥", value: created.secret });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "创建 Webhook 失败"); }
    finally { setBusy(null); }
  };
  const updateWebhook = async (subscription: Subscription) => {
    setBusy(subscription.id); setError(null);
    try {
      const result = await json<{ subscription: Subscription }>(`/api/webhooks/${encodeURIComponent(subscription.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: subscription.status === "active" ? "paused" : "active" }) });
      setSubscriptions((current) => current.map((item) => item.id === subscription.id ? result.subscription : item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "更新 Webhook 失败"); }
    finally { setBusy(null); }
  };
  const deleteWebhook = async (subscription: Subscription) => {
    if (!window.confirm(`删除 Webhook “${subscription.name}”？未投递的事件将停止发送。`)) return;
    setBusy(subscription.id); setError(null);
    try {
      await json(`/api/webhooks/${encodeURIComponent(subscription.id)}`, { method: "DELETE" });
      setSubscriptions((current) => current.filter((item) => item.id !== subscription.id));
      setOpenDeliveries((current) => current === subscription.id ? null : current);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "删除 Webhook 失败"); }
    finally { setBusy(null); }
  };
  const toggleDeliveries = async (subscription: Subscription) => {
    if (openDeliveries === subscription.id) { setOpenDeliveries(null); return; }
    setOpenDeliveries(subscription.id);
    const [deliveryResult, statsResult] = await Promise.all([
      deliveries[subscription.id] ? Promise.resolve({ deliveries: deliveries[subscription.id] }) : json<{ deliveries: Delivery[] }>(`/api/webhooks/${encodeURIComponent(subscription.id)}/deliveries`).catch((cause) => { setError(cause instanceof Error ? cause.message : "无法加载投递记录"); return { deliveries: [] }; }),
      json<WebhookStats>(`/api/webhooks/${encodeURIComponent(subscription.id)}/stats`).catch(() => ({ delivered: 0, pending: 0, failed: 0, total: 0, consecutiveFailures: 0 })),
    ]);
    setDeliveries((current) => ({ ...current, [subscription.id]: deliveryResult.deliveries }));
    setStats((current) => ({ ...current, [subscription.id]: statsResult }));
  };
  const retryDelivery = async (subscriptionId: string, deliveryId: string) => {
    setBusy(deliveryId); setError(null);
    try {
      await json(`/api/webhooks/${encodeURIComponent(subscriptionId)}/deliveries/${encodeURIComponent(deliveryId)}/retry`, { method: "POST" });
      setDeliveries((current) => ({ ...current, [subscriptionId]: (current[subscriptionId] ?? []).map((d) => d.deliveryId === deliveryId ? { ...d, status: "pending" as const, attempts: 0, lastError: null } : d) }));
      const statsResult = await json<WebhookStats>(`/api/webhooks/${encodeURIComponent(subscriptionId)}/stats`).catch(() => ({ delivered: 0, pending: 0, failed: 0, total: 0, consecutiveFailures: 0 }));
      setStats((current) => ({ ...current, [subscriptionId]: statsResult }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "重试失败"); }
    finally { setBusy(null); }
  };

  const { loggedIn, loading } = useLoggedIn();
  if (!loading && !loggedIn) return <LoginGate title="登录后管理开发者集成" />;

  return <main className="flex min-h-dvh flex-col bg-bg md:flex-row">
    <WorkbenchRail tasks={[]} activeTaskId={null} onNew={() => { window.location.href = "/quill"; }} onOpen={() => undefined} />
    <div className="flex min-w-0 flex-1 flex-col">
    <div className="mx-auto flex w-[min(100%-2rem,74rem)] flex-1 flex-col py-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <small className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-3">集成与 API</small>
          <h1 className="font-serif text-2xl font-semibold tracking-tight text-ink">开发者</h1>
          <p className="mt-1 text-sm text-ink-3">让内部服务或外部系统安全地创建任务、接收结果。</p>
        </div>
        <Link href="/quill"><Button variant="secondary" size="sm">新对话 <Icon name="arrow-up-right" size={14} /></Button></Link>
      </header>
      <Tabs items={tabItems} value={tab} onValueChange={(value) => setTab(value as Tab)} className="mb-6" />
      {error && <div className="mb-4 rounded-sm border-l-2 border-danger bg-danger/10 px-3 py-2 text-sm text-ink" role="status">{error}</div>}

      {revealedSecret && (
        <Card padding="sm" className="mb-6 border-warning/60">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2"><Badge variant="warning" size="sm">仅显示一次</Badge><strong className="text-sm font-semibold text-ink">{revealedSecret.kind}</strong></div>
              <p className="mt-1 text-xs text-ink-3">请立即保存。离开此页面后无法再次查看完整值。</p>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-sm border border-line bg-surface px-2 py-1 font-mono text-xs text-ink">{revealedSecret.value}</code>
              <IconButton size="sm" label={`复制${revealedSecret.kind}`} onClick={() => void copy(revealedSecret.value)}><Icon name="copy" size={13} /></IconButton>
              <IconButton size="sm" label="关闭密钥提示" onClick={() => setRevealedSecret(null)}><Icon name="cross" size={13} /></IconButton>
            </div>
          </div>
        </Card>
      )}

      {tab === "quickstart" && <QuickStart baseUrl={baseUrl} onGoToKeys={() => setTab("keys")} />}
      {tab === "api" && <ApiReference baseUrl={baseUrl} />}

      {tab === "keys" && (
        <section>
          <div className="mb-3">
            <h2 className="text-lg font-semibold tracking-tight text-ink">API Key</h2>
            <p className="text-sm text-ink-3">每个 Key 都限定工作区与权限范围，可随时撤销。</p>
          </div>
          <Card padding="md" className="mb-3">
            <div className="flex flex-col gap-3">
              <Input value={keyName} onChange={(event) => setKeyName(event.target.value)} placeholder="例如：数据同步服务" aria-label="API Key 名称" />
              <div role="group" aria-label="允许访问的工作区">
                <small className="mb-1.5 block text-xs font-semibold text-ink-3">工作区范围</small>
                <div className="flex flex-wrap gap-2">
                  {workspaces.map((workspace) => {
                    const active = keyWorkspaces.includes(workspace.id);
                    return <Button key={workspace.id} type="button" size="sm" variant={active ? "primary" : "secondary"} onClick={() => setKeyWorkspaces((current) => toggle(current, workspace.id))}><Icon name={active ? "check" : "plus"} size={12} />{workspace.name}</Button>;
                  })}
                </div>
              </div>
              <div role="group" aria-label="API Key 权限范围">
                <small className="mb-1.5 block text-xs font-semibold text-ink-3">权限范围</small>
                <div className="flex flex-wrap gap-2">
                  {scopeOptions.map((scope) => {
                    const active = keyScopes.includes(scope.id);
                    return <Button key={scope.id} type="button" size="sm" variant={active ? "primary" : "secondary"} title={scope.detail} onClick={() => setKeyScopes((current) => toggle(current, scope.id))}><Icon name={active ? "check" : "plus"} size={12} />{scope.label}</Button>;
                  })}
                </div>
              </div>
              <div><Button type="button" disabled={busy === "create-key" || !keyName.trim() || !keyWorkspaces.length || !keyScopes.length} onClick={() => void createKey()}><Icon name="key" size={14} />{busy === "create-key" ? "创建中" : "创建 API Key"}</Button></div>
            </div>
          </Card>
          <div className="flex flex-col gap-3">
            {keys.length ? keys.map((key) => (
              <Card key={key.id} padding="md">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><Icon name="key" size={14} className="text-ink-3" /><h3 className="text-base font-semibold text-ink">{key.name}</h3><Badge variant={key.status === "active" ? "success" : "outline"} size="sm">{key.status === "active" ? "有效" : "已撤销"}</Badge></div>
                    <code className="mt-1 block font-mono text-xs text-ink-3">{key.prefix}...</code>
                    <p className="mt-1 text-sm text-ink-2">{key.workspaceIds.map((id) => workspaceNames.get(id) ?? id).join(" · ")} · {key.scopes.map(scopeLabel).join(" · ")}</p>
                    <small className="text-xs text-ink-3">创建于 {time(key.createdAt)} · 最近使用 {time(key.lastUsedAt)}</small>
                  </div>
                  {key.status === "active" && <IconButton size="md" label={`撤销 ${key.name}`} disabled={busy === key.id} onClick={() => void revokeKey(key)}><Icon name="trash" size={13} /></IconButton>}
                </div>
              </Card>
            )) : <EmptyState icon={<Icon name="key" size={24} />} title="还没有 API Key" description="创建一个限定范围的 Key 开始集成。" />}
          </div>
        </section>
      )}

      {tab === "webhooks" && (
        <section>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-ink">Webhook</h2>
              <p className="text-sm text-ink-3">任务完成、失败或取消时，向你的服务发送已签名事件。签名验证方式见「API 参考」页签。</p>
            </div>
            <ThemeSelect value={workspaceId} onValueChange={(value: string) => selectWorkspace(value)}>
              <SelectTrigger className="w-auto" aria-label="选择 Webhook 工作区"><SelectValue placeholder="选择工作区" /></SelectTrigger>
              <SelectContent>{workspaces.map((workspace) => <SelectItem value={workspace.id} key={workspace.id}>{workspace.name}</SelectItem>)}</SelectContent>
            </ThemeSelect>
          </div>
          <Card padding="md" className="mb-3">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <Input value={webhookName} onChange={(event) => setWebhookName(event.target.value)} placeholder="Webhook 名称" aria-label="Webhook 名称" className="min-w-0 flex-1" />
                <Input value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://example.com/hooks/zmzai" aria-label="Webhook 地址" className="min-w-0 flex-1" />
              </div>
              <div role="group" aria-label="Webhook 事件">
                <small className="mb-1.5 block text-xs font-semibold text-ink-3">订阅事件</small>
                <div className="flex flex-wrap gap-2">
                  {eventOptions.map((event) => {
                    const active = webhookEvents.includes(event.id);
                    return <Button key={event.id} type="button" size="sm" variant={active ? "primary" : "secondary"} onClick={() => setWebhookEvents((current) => toggle(current, event.id))}><Icon name={active ? "check" : "plus"} size={12} />{event.label}</Button>;
                  })}
                </div>
              </div>
              <div><Button type="button" disabled={busy === "create-webhook" || !workspaceId || !webhookName.trim() || !webhookUrl.trim() || !webhookEvents.length} onClick={() => void createWebhook()}><Icon name="link" size={14} />{busy === "create-webhook" ? "创建中" : "添加 Webhook"}</Button></div>
            </div>
          </Card>
          <div className="flex flex-col gap-3">
            {subscriptions.length ? subscriptions.map((subscription) => (
              <Card key={subscription.id} padding="md">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-semibold text-ink">{subscription.name}</h3><Badge variant={subscription.status === "active" ? "success" : "outline"} size="sm">{subscription.status === "active" ? "启用中" : "已暂停"}</Badge></div>
                    <code className="mt-1 block truncate font-mono text-xs text-ink-3">{subscription.url}</code>
                    <p className="mt-1 text-sm text-ink-2">{subscription.events.map((event) => eventOptions.find((option) => option.id === event)?.label ?? event).join(" · ")} · 签名 {subscription.secretPrefix}...</p>
                    <small className="text-xs text-ink-3">最近投递 {time(subscription.lastDeliveredAt)}</small>
                    {subscription.lastError && <p className="mt-1 text-sm text-danger">{subscription.lastError}</p>}
                    {openDeliveries === subscription.id && stats[subscription.id] && (
                      <div className="mt-2 flex flex-wrap gap-3 rounded-sm border border-line bg-surface px-3 py-2 text-xs">
                        <span className="text-ink-2">共 <strong className="text-ink">{stats[subscription.id].total}</strong> 次投递</span>
                        <span className="text-success">已投递 {stats[subscription.id].delivered}</span>
                        {stats[subscription.id].pending > 0 && <span className="text-warning">投递中 {stats[subscription.id].pending}</span>}
                        {stats[subscription.id].failed > 0 && <span className="text-danger">失败 {stats[subscription.id].failed}</span>}
                        {stats[subscription.id].consecutiveFailures >= 3 && <Badge variant="danger" size="sm">连续 {stats[subscription.id].consecutiveFailures} 次失败</Badge>}
                      </div>
                    )}
                    {openDeliveries === subscription.id && (
                      <div className="mt-2 flex flex-col gap-1.5 rounded-sm border border-line bg-surface p-3">
                        {deliveries[subscription.id] ? deliveries[subscription.id].length ? deliveries[subscription.id].map((delivery) => (
                          <div className="flex items-center gap-2 text-xs text-ink-2" key={delivery.deliveryId}>
                            <Badge variant={deliveryVariant(delivery.status)} size="sm">{delivery.status === "delivered" ? "已投递" : delivery.status === "failed" ? "失败" : "投递中"}</Badge>
                            <div className="min-w-0"><strong className="block text-ink">{eventOptions.find((option) => option.id === delivery.eventType)?.label ?? delivery.eventType}</strong><small>{delivery.status === "delivered" ? `HTTP ${delivery.responseStatus ?? "-"}` : `第 ${delivery.attempts} 次尝试`}{delivery.lastError ? ` · ${delivery.lastError}` : ""}</small></div>
                            {delivery.status === "failed" && <button type="button" className="flex-shrink-0 rounded-sm border border-line px-2 py-0.5 text-xs text-ink-2 hover:bg-surface-hover disabled:opacity-50" disabled={busy === delivery.deliveryId} onClick={() => void retryDelivery(subscription.id, delivery.deliveryId)}>{busy === delivery.deliveryId ? "重试中" : "重试"}</button>}
                            <time className="ml-auto flex-shrink-0 text-ink-3">{time(delivery.createdAt)}</time>
                          </div>
                        )) : <p className="text-xs text-ink-3">还没有投递记录。</p> : <p className="text-xs text-ink-3">正在加载投递记录…</p>}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <Button type="button" variant="secondary" size="sm" disabled={busy === subscription.id} onClick={() => void toggleDeliveries(subscription)}><Icon name="activity" size={13} />投递记录</Button>
                    <IconButton size="md" label={subscription.status === "active" ? "暂停 Webhook" : "恢复 Webhook"} disabled={busy === subscription.id} onClick={() => void updateWebhook(subscription)}><Icon name={subscription.status === "active" ? "pause" : "play"} size={13} /></IconButton>
                    <IconButton size="md" label={`删除 ${subscription.name}`} disabled={busy === subscription.id} onClick={() => void deleteWebhook(subscription)}><Icon name="trash" size={13} /></IconButton>
                  </div>
                </div>
              </Card>
            )) : <EmptyState icon={<Icon name="link" size={24} />} title="当前工作区还没有 Webhook" description="添加一个接收端点，任务事件会签名后推送。" />}
          </div>
        </section>
      )}
    </div>
    </div>
  </main>;
}
