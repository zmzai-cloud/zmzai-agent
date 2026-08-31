"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { EmptyState, Icon, Markdown, MessageItem, Reasoning } from "@zmzai/theme";

type SharedMessage = {
  info: { id: string; role: "user" | "assistant"; time: { created: string; completed?: string }; tokens?: { input: number; output: number; cacheRead?: number } };
  parts: Array<{ id: string; type: string; text?: string; tool?: string; state?: { status: string }; url?: string; mediaType?: string; alt?: string }>;
};
type SharedTask = { taskId: string; title: string; status: string; createdAt: string };

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

function statusLabel(status: string): string {
  const map: Record<string, string> = { draft: "草稿", active: "运行中", succeeded: "已完成", failed: "失败", cancelled: "已取消" };
  return map[status] ?? status;
}

export default function SharedTaskPage() {
  const params = useParams<{ token: string }>();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  const [task, setTask] = useState<SharedTask | null>(null);
  const [messages, setMessages] = useState<SharedMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    void fetch(`/api/shared/tasks/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { task?: SharedTask; messages?: SharedMessage[]; error?: string } | null;
        if (!response.ok || !body?.task) throw new Error(body?.error ?? "分享不存在或已过期");
        setTask(body.task);
        setMessages(body.messages ?? []);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "无法打开分享"));
  }, [token]);

  if (error) return <main className="grid min-h-dvh place-items-center bg-bg px-4"><EmptyState icon={<Icon name="warning" size={28} />} title="此分享不可用" description={error} /></main>;
  if (!task || !token) return <main className="grid min-h-dvh place-items-center bg-bg px-4"><p className="text-sm text-ink-3">正在打开分享…</p></main>;

  // 分组连续 assistant 消息（与 parts.tsx 的 groupAssistantMessages 同逻辑）
  const grouped: Array<SharedMessage | SharedMessage[]> = [];
  let assistantGroup: SharedMessage[] = [];
  const flush = () => {
    if (assistantGroup.length === 1) grouped.push(assistantGroup[0]);
    else if (assistantGroup.length > 1) grouped.push(assistantGroup);
    assistantGroup = [];
  };
  for (const msg of messages) {
    if (msg.info.role === "assistant") assistantGroup.push(msg);
    else { flush(); grouped.push(msg); }
  }
  flush();

  return (
    <main className="flex min-h-dvh flex-col bg-bg">
      <header className="border-b border-line px-6 py-4">
        <div className="flex items-center gap-2">
          <small className="text-xs font-semibold uppercase tracking-wide text-ink-3">ZMZAI 会话分享</small>
          <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-ink-3">{statusLabel(task.status)}</span>
        </div>
        <h1 className="font-serif mt-1 text-lg font-semibold tracking-tight text-ink">{task.title || "未命名任务"}</h1>
        <p className="mt-0.5 font-mono text-xs text-ink-3">{new Date(task.createdAt).toLocaleString("zh-CN")}</p>
      </header>

      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div className="flex flex-col gap-3">
          {grouped.map((entry) => {
            const items = Array.isArray(entry) ? entry : [entry];
            const first = items[0];
            if (!first) return null;

            if (first.info.role === "user") {
              const text = items.flatMap((m) => m.parts.filter((p) => p.type === "text").map((p) => p.text ?? "")).join("\n");
              const images = items.flatMap((m) => m.parts.filter((p) => p.type === "image"));
              if (!text.trim() && !images.length) return null;
              const time = new Date(first.info.time.created);
              return (
                <MessageItem key={first.info.id} role="user" avatar="你" name="你" time={time.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}>
                  {text.trim() ? <div className="zmz-message-content">{text}</div> : null}
                  {images.length ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {images.map((p) => <img key={p.id} src={p.url} alt={p.alt || "图片"} className="max-h-48 max-w-full rounded-md border border-line object-contain" />)}
                    </div>
                  ) : null}
                </MessageItem>
              );
            }

            // Assistant message
            const active = items.some((m) => !m.info.time.completed);
            const allParts = items.flatMap((m) => m.parts);
            const time = new Date(first.info.time.created);
            const tokenTotal = items.reduce((sum, m) => sum + (m.info.tokens ? (m.info.tokens.input ?? 0) + (m.info.tokens.output ?? 0) : 0), 0);

            return (
              <MessageItem key={first.info.id} role="assistant" avatar="使" name="ZMZAI Agent" status={{ active }} time={time.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} noMotion>
                <div className="fw-execution-tree">
                  {allParts.map((part) => {
                    if (part.type === "text" && part.text) return <div key={part.id} className="zmz-message-content"><Markdown text={part.text} /></div>;
                    if (part.type === "reasoning" && part.text) return <Reasoning key={part.id} text={part.text} active={active} />;
                    if (part.type === "tool") return <div key={part.id} className="run-note">{part.tool} — {part.state?.status ?? "unknown"}</div>;
                    return null;
                  })}
                </div>
                {tokenTotal > 0 && <div className="run-note run-token-note">{formatTokens(tokenTotal)} tokens</div>}
              </MessageItem>
            );
          })}
          {!messages.length && <EmptyState title="暂无对话内容" description="此分享的任务还没有对话记录。" />}
        </div>
      </div>

      <footer className="border-t border-line px-6 py-3 text-center">
        <small className="font-mono text-[10px] text-ink-3">由 ZMZAI Agent 生成 · 只读分享</small>
      </footer>
    </main>
  );
}
