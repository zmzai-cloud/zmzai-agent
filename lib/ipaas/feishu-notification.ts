/**
 * 飞书任务完成通知推送
 *
 * 当自动化任务执行完毕（成功/失败）时，通过飞书连接器发送富文本卡片通知。
 * 复用 iPaaS 飞书适配器的 Bot API 发送能力。
 */

import { decryptConnectorHeaders } from "@/lib/connector-secrets";
import { sendFeishuMessage, type FeishuCredentials } from "@/lib/ipaas/feishu-adapter";
import { IpaasConnectorModel } from "@/models/ipaas-connector";

/** 通知上下文 */
export interface TaskNotificationContext {
  workspaceId: string;
  automationName: string;
  status: "succeeded" | "failed";
  taskTitle?: string;
  summary?: string | null;
  error?: string | null;
  durationMs?: number;
  taskId?: string;
  runId?: string;
}

/**
 * 构建飞书交互卡片（任务完成通知）
 */
export function buildTaskCompletionCard(ctx: TaskNotificationContext): Record<string, unknown> {
  const isSuccess = ctx.status === "succeeded";
  const headerColor = isSuccess ? "green" : "red";
  const statusText = isSuccess ? "任务完成" : "任务失败";
  const statusIcon = isSuccess ? "\u2705" : "\u274c";

  const elements: Array<Record<string, unknown>> = [];

  // 任务名称
  if (ctx.taskTitle) {
    elements.push({
      tag: "div",
      text: { tag: "lark_md", content: `**任务:** ${ctx.taskTitle}` },
    });
  }

  // 自动化名称
  elements.push({
    tag: "div",
    text: { tag: "lark_md", content: `**自动化:** ${ctx.automationName}` },
  });

  // 耗时
  if (ctx.durationMs != null && ctx.durationMs > 0) {
    const seconds = Math.round(ctx.durationMs / 1000);
    const display = seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${seconds} 秒`;
    elements.push({
      tag: "div",
      text: { tag: "lark_md", content: `**耗时:** ${display}` },
    });
  }

  // 结果摘要或错误信息
  if (isSuccess && ctx.summary) {
    const truncated = ctx.summary.length > 800 ? `${ctx.summary.slice(0, 800)}...` : ctx.summary;
    elements.push({
      tag: "div",
      text: { tag: "lark_md", content: `**结果摘要:**\n${truncated}` },
    });
  } else if (!isSuccess && ctx.error) {
    elements.push({
      tag: "div",
      text: { tag: "lark_md", content: `**错误信息:**\n${ctx.error.slice(0, 500)}` },
    });
  }

  // 分割线
  elements.push({ tag: "hr" });

  // 底部备注
  elements.push({
    tag: "note",
    elements: [{ tag: "plain_text", content: "来自 zmzai Agent 自动化通知" }],
  });

  return {
    header: {
      title: { tag: "plain_text", content: `${statusIcon} ${statusText}` },
      template: headerColor,
    },
    elements,
  };
}

/**
 * 向 workspace 的所有活跃飞书连接器发送通知
 *
 * 查找 workspace 下 outboundEnabled=true 的飞书连接器，
 * 解密凭证后逐一发送卡片通知。
 */
export async function sendFeishuNotification(
  workspaceId: string,
  card: Record<string, unknown>,
  options?: { receiveId?: string },
): Promise<{ sent: number; errors: string[] }> {
  const connectors = await IpaasConnectorModel.find({
    workspaceId,
    platform: "feishu",
    status: "active",
    outboundEnabled: true,
  }).select("+encryptedCredentials").lean();

  if (connectors.length === 0) return { sent: 0, errors: [] };

  let sent = 0;
  const errors: string[] = [];

  for (const connector of connectors) {
    let credentials: Record<string, string>;
    try {
      credentials = decryptConnectorHeaders(connector.encryptedCredentials);
    } catch {
      errors.push(`${connector.connectorId}: 凭证解密失败`);
      continue;
    }

    // 如果有指定的 receiveId 就用它，否则尝试从连接器配置推断
    const receiveId = options?.receiveId;
    if (!receiveId) {
      // 没有指定接收者时，跳过（飞书 Bot 必须指定接收者）
      errors.push(`${connector.connectorId}: 未指定通知接收者`);
      continue;
    }

    const result = await sendFeishuMessage(
      credentials as unknown as FeishuCredentials,
      receiveId,
      receiveId.startsWith("ou_") ? "open_id" : "chat_id",
      { richContent: card },
    );

    if (result.success) {
      sent++;
    } else {
      errors.push(`${connector.connectorId}: ${result.error ?? "发送失败"}`);
    }
  }

  return { sent, errors };
}

/**
 * 高层封装：自动化任务完成时发送飞书通知
 *
 * 在 projectAutomationExecution 中调用。
 */
export async function notifyTaskCompletion(ctx: TaskNotificationContext & { receiveId?: string }): Promise<void> {
  const card = buildTaskCompletionCard(ctx);
  try {
    await sendFeishuNotification(ctx.workspaceId, card, { receiveId: ctx.receiveId });
  } catch (error) {
    // 通知失败不应影响主流程
    console.error("飞书通知发送异常", error);
  }
}
