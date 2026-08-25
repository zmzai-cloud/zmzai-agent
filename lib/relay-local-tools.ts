import type { ToolDef } from "@zmzai/agent-framework";
import { z } from "zod";

import { getServerEnvironment } from "@/config/env";
import { relayAgentContractVersion } from "@/lib/internal-contracts";

/**
 * 本机工具（用户桌面机器能力）。
 *
 * 链路：Agent 工具循环 → Relay `/api/internal/agent/local-tool` → zmzai-bridge
 *  → 用户桌面客户端（zmzai-client，本地审批 + 审计后执行）→ 结果回传。
 *
 * 执行边界：zmzai-sandbox 的代码/命令在云端容器内执行，与本机工具互不相干；
 * 这里只服务「用户自己的电脑」上的文件 / 命令 / 通知，且 fs.write / shell.exec
 * 在客户端必弹用户审批，云端无法绕过。
 *
 * 工具 id 必须符合 OpenAI function name（仅字母数字下划线连字符），
 * 故用 local_fs_read 而非 local.fs.read；下发时再映射回桥的 fs.read 等名称。
 */

export type LocalToolName = "fs.read" | "fs.write" | "shell.exec" | "notify";

export type LocalDispatchResult = {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
};

/** 经 Relay 向用户本机下发一次工具请求。409/504 映射为可读的中文错误。 */
export async function dispatchLocalTool(input: {
  userId: string;
  tool: LocalToolName;
  params: unknown;
  requestId?: string;
}): Promise<LocalDispatchResult> {
  const environment = getServerEnvironment();
  const secret = environment.RELAY_AGENT_SERVICE_SECRET_CURRENT;
  if (!secret) throw new Error("RELAY_AGENT_SERVICE_SECRET_CURRENT 未配置，无法下发本机工具");

  const response = await fetch(
    `${environment.RELAY_AGENT_URL.replace(/\/$/, "")}/api/internal/agent/local-tool`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
        "x-zmzai-agent-user-id": input.userId,
        "x-zmzai-contract-version": relayAgentContractVersion,
      },
      body: JSON.stringify({
        tool: input.tool,
        params: input.params,
        ...(input.requestId ? { requestId: input.requestId } : {}),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    },
  );
  const json = (await response.json().catch(() => null)) as
    | { id?: string; ok?: boolean; data?: unknown; error?: string; code?: string; message?: string }
    | null;

  if (!response.ok) {
    const code = json?.code ?? `LOCAL_TOOL_HTTP_${response.status}`;
    if (response.status === 409) throw new Error("用户的桌面客户端当前不在线，无法执行本机操作");
    if (response.status === 504) throw new Error("本机操作超时（客户端可能仍在等待用户审批）");
    throw new Error(`${json?.error ?? `Relay 返回 HTTP ${response.status}`}（${code}）`);
  }
  return { id: json?.id ?? "", ok: json?.ok ?? false, data: json?.data, error: json?.error };
}

/** 探测用户是否绑定了在线的桌面客户端（Agent 据此决定是否暴露本机工具 / 提示用户）。
 *  网络异常按未绑定处理——探测不应中断 Agent 循环。 */
export async function probeLocalClient(userId: string): Promise<{ bound: boolean }> {
  const environment = getServerEnvironment();
  const secret = environment.RELAY_AGENT_SERVICE_SECRET_CURRENT;
  if (!secret) return { bound: false };
  try {
    const response = await fetch(
      `${environment.RELAY_AGENT_URL.replace(/\/$/, "")}/api/internal/agent/local-tool`,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${secret}`,
          "x-zmzai-agent-user-id": userId,
          "x-zmzai-contract-version": relayAgentContractVersion,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) return { bound: false };
    const json = (await response.json().catch(() => null)) as { bound?: boolean } | null;
    return { bound: json?.bound === true };
  } catch {
    return { bound: false };
  }
}

export const localFsReadTool: ToolDef = {
  id: "local_fs_read",
  label: "本机 · 读取文件",
  description:
    "读取用户本机（桌面客户端所在电脑）上的一个文件。path 为绝对路径或以 ~ 开头（~ 表示用户主目录）。" +
    "输出按 maxBytes 截断；base64 编码可读二进制文件。仅当用户桌面客户端在线且客户端允许读取时成功。",
  parameters: z.object({
    path: z.string().min(1).max(1024),
    encoding: z.enum(["utf8", "base64"]).default("utf8"),
    maxBytes: z.number().int().positive().max(5_000_000).default(200_000),
  }),
  permission: (args) => ({ permission: "local", patterns: [args.path], metadata: { tool: "fs.read" } }),
  executionMode: "sequential",
  async execute(args, ctx) {
    const result = await dispatchLocalTool({ userId: ctx.userId, tool: "fs.read", params: args, requestId: ctx.toolCallId });
    if (!result.ok) throw new Error(result.error || "本机读取失败");
    const data = (result.data ?? {}) as { content?: string; bytes?: number };
    return { title: `读取本机文件 ${args.path}`, output: data.content ?? "", metadata: { path: args.path, bytes: data.bytes ?? 0 } };
  },
};

export const localFsWriteTool: ToolDef = {
  id: "local_fs_write",
  label: "本机 · 写入文件",
  description:
    "在用户本机（桌面客户端所在电脑）创建或覆盖一个文件。path 为绝对路径或以 ~ 开头。" +
    "客户端会限制在用户批准的目录根内，且每次写入都必须用户审批。",
  parameters: z.object({
    path: z.string().min(1).max(1024),
    content: z.string().max(5_000_000),
    encoding: z.enum(["utf8", "base64"]).default("utf8"),
  }),
  permission: (args) => ({ permission: "local", patterns: [args.path], metadata: { tool: "fs.write" } }),
  executionMode: "sequential",
  async execute(args, ctx) {
    const result = await dispatchLocalTool({ userId: ctx.userId, tool: "fs.write", params: args, requestId: ctx.toolCallId });
    if (!result.ok) throw new Error(result.error || "本机写入失败");
    const data = (result.data ?? {}) as { written?: number };
    return { title: `写入本机文件 ${args.path}`, output: `已写入 ${args.path}（${data.written ?? args.content.length} 字符）。`, metadata: { path: args.path, written: data.written ?? args.content.length } };
  },
};

export const localShellExecTool: ToolDef = {
  id: "local_shell_exec",
  label: "本机 · 执行命令",
  description:
    "在用户本机（桌面客户端所在电脑）执行一条 shell 命令。cwd 可选（默认用户主目录）。" +
    "此工具默认在客户端禁用，且每次执行都必须用户审批；预期用户会谨慎使用。",
  parameters: z.object({
    command: z.string().min(1).max(2000),
    cwd: z.string().max(1024).optional(),
    timeoutMs: z.number().int().positive().max(300_000).optional(),
  }),
  permission: (args) => ({ permission: "local", patterns: [args.command], metadata: { tool: "shell.exec" } }),
  executionMode: "sequential",
  async execute(args, ctx) {
    const result = await dispatchLocalTool({ userId: ctx.userId, tool: "shell.exec", params: args, requestId: ctx.toolCallId });
    if (!result.ok) throw new Error(result.error || "本机命令执行失败");
    const data = (result.data ?? {}) as { stdout?: string; stderr?: string; exitCode?: number };
    const parts: string[] = [];
    if (data.stdout) parts.push(data.stdout);
    if (data.stderr) parts.push(`[stderr]\n${data.stderr}`);
    return {
      title: `本机执行: ${args.command}`,
      output: parts.join("\n") || "（命令无输出）",
      metadata: { command: args.command, exitCode: data.exitCode ?? 0 },
    };
  },
};

export const localNotifyTool: ToolDef = {
  id: "local_notify",
  label: "本机 · 发送通知",
  description: "在用户本机（桌面客户端所在电脑）弹出系统通知。用于任务完成提醒、需要用户介入等场景。",
  parameters: z.object({
    title: z.string().min(1).max(120),
    body: z.string().max(500).optional(),
    urgency: z.enum(["low", "normal", "critical"]).default("normal"),
  }),
  permission: () => ({ permission: "local", patterns: ["notify"], metadata: { tool: "notify" } }),
  executionMode: "sequential",
  async execute(args, ctx) {
    const result = await dispatchLocalTool({ userId: ctx.userId, tool: "notify", params: args, requestId: ctx.toolCallId });
    if (!result.ok) throw new Error(result.error || "本机通知失败");
    return { title: `通知: ${args.title}`, output: `已向用户本机发送通知「${args.title}」。`, metadata: { title: args.title } };
  },
};

/** 全部本机工具（静态集合；是否可用由 permission 与客户端在线状态共同决定）。 */
export function resolveLocalTools(): ToolDef[] {
  return [localFsReadTool, localFsWriteTool, localShellExecTool, localNotifyTool];
}
