import { notifyEventLogListeners, streamOneText } from "@zmzai/agent-framework";

import { defaultStore } from "@/framework/core/runtime/runner";
import { productEventLog } from "@/framework/core/events/product-event-log";
import { createRelayModel, createRelayStreamFunction } from "@/lib/relay-agent-stream";
import { activeRunIdForSession } from "@/lib/task-run-control";
import { defaultRelayModel } from "@/lib/workspaces";

/** 会话标题生成（spec §13.2）：session 创建后由便宜模型异步生成标题，经
 *  session.updated 覆盖默认的 prompt 截断标题。生成失败静默降级——标题
 *  保持默认值，不影响主流程。 */
const TITLE_SYSTEM_PROMPT =
  "你是会话标题生成器。根据用户的第一条消息，生成一个不超过 24 个中文字符的简洁标题，概括任务主题。只输出标题本身，不要引号、不要标点装饰、不要任何解释。";

export async function maybeGenerateSessionTitle(input: { sessionId: string; prompt: string }): Promise<void> {
  try {
    const session = await defaultStore.getSession(input.sessionId);
    if (!session) return;
    // 只在标题仍是默认值（prompt 截断或"新会话"）时生成，避免覆盖用户改过的标题；
    // 并发触发（sessions POST + prompt POST 双接线点）结果相同，可接受竞态。
    const fallback = input.prompt.trim().slice(0, 40);
    if (session.title !== "新会话" && session.title !== fallback) return;

    const title = await streamOneText(
      async (model, ctx) => {
        const streamFn = createRelayStreamFunction({ userId: session.userId, taskRunId: () => activeRunIdForSession(input.sessionId) });
        const stream = await streamFn(model, ctx as never);
        return stream;
      },
      createRelayModel(defaultRelayModel),
      TITLE_SYSTEM_PROMPT,
      [{ role: "user", content: input.prompt, timestamp: Date.now() }],
    ).then((text) => text.trim().slice(0, 40));
    if (!title || title === session.title) return;

    await defaultStore.updateSession(input.sessionId, { title });
    const updated = { ...session, title, time: { ...session.time, updated: new Date().toISOString() } };
    const persisted = await productEventLog.append({ sessionId: input.sessionId, type: "session.updated", data: { session: updated } });
    notifyEventLogListeners(persisted);
  } catch {
    // 标题生成失败（relay 不可用 / run 已结束等）不阻断会话主流程
  }
}
