"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Badge, Card, EmptyState, Icon } from "@zmzai/theme";
import { LoginGate, useLoggedIn, WorkbenchRail } from "@/framework/client/workbench-rail";

type RunInfo = {
  runId: string;
  taskId: string;
  taskTitle: string;
  projectId: string | null;
  workspaceId: string;
  workspaceName: string;
  sessionId: string;
  status: string;
  attempt: number;
  parentRunId: string | null;
  terminalReason: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  duration: number | null;
};

type UsageInfo = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  eventCount: number;
};

type ToolNode = {
  callId: string;
  tool: string;
  status: string;
  title: string | null;
  output: string | null;
  startedAt: string | null;
  endedAt: string | null;
};

type SubagentInfo = {
  subagentRunId: string;
  agent: string;
  description: string;
  status: string;
  error: string | null;
};

type RunDetail = {
  run: RunInfo;
  usage: UsageInfo;
  toolTimeline: ToolNode[];
  messageTokens: { messageId: string; input: number; output: number; cacheRead: number }[];
  events: { seq: number; type: string; at: string; data: unknown }[];
  subagents: SubagentInfo[];
};

function statusVariant(status: string): "success" | "danger" | "warning" | "outline" {
  if (status === "succeeded") return "success";
  if (status === "failed" || status === "cancelled") return "danger";
  if (status === "running" || status === "waiting_input" || status === "waiting_approval") return "warning";
  return "outline";
}

function statusText(status: string): string {
  return ({ created: "准备中", running: "执行中", waiting_input: "等待补充", waiting_approval: "等待审批", paused: "已暂停", succeeded: "已完成", failed: "已失败", cancelled: "已取消" } as Record<string, string>)[status] ?? status;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s`;
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  if (min < 60) return `${min}m ${sec}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function toolDuration(node: ToolNode): string | null {
  if (!node.startedAt || !node.endedAt) return null;
  const ms = new Date(node.endedAt).getTime() - new Date(node.startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function RunDetailPage() {
  const params = useParams<{ runId: string }>();
  const runId = params.runId;
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openEvents, setOpenEvents] = useState<Set<number>>(new Set());

  const toggleEvent = (seq: number) => {
    setOpenEvents((current) => {
      const next = new Set(current);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });
  };

  useEffect(() => {
    if (!runId) return;
    void (async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
        const body = (await response.json()) as RunDetail & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "无法加载运行详情");
        setDetail(body);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "无法加载运行详情");
      } finally {
        setLoading(false);
      }
    })();
  }, [runId]);

  const { loggedIn, loading: meLoading } = useLoggedIn();
  if (!meLoading && !loggedIn) return <LoginGate title="登录后查看运行详情" />;
  if (loading) return <main className="workbench-loading">正在读取运行数据…</main>;
  if (error) return <main className="workbench-loading"><p className="workbench-alert">{error}</p></main>;
  if (!detail) return <main className="workbench-loading"><EmptyState title="运行记录不存在" description="该运行记录可能已被删除或无权访问。" /></main>;

  const { run, usage, toolTimeline, messageTokens, events, subagents } = detail;
  const successTools = toolTimeline.filter((n) => n.status === "completed").length;
  const failedTools = toolTimeline.filter((n) => n.status === "error").length;

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-bg">
      <WorkbenchRail tasks={[]} activeTaskId={null} onNew={() => { window.location.href = "/fw"; }} onOpen={() => undefined} />

      <div className="flex flex-1 flex-col overflow-y-auto">
        {/* Header */}
        <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-line bg-bg/85 px-5 py-3 backdrop-blur-md">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Link href="/fw" className="text-xs text-muted transition-colors hover:text-accent">任务</Link>
            <span className="text-muted">/</span>
            <Link href={`/fw/t/${run.taskId}`} className="min-w-0 truncate text-sm font-medium text-ink transition-colors hover:text-accent">{run.taskTitle}</Link>
            <span className="text-muted">/</span>
            <span className="font-mono text-xs text-muted">{run.runId}</span>
          </div>
          <Badge variant={statusVariant(run.status)} size="sm">{statusText(run.status)}</Badge>
        </header>

        <div className="mx-auto w-full max-w-5xl space-y-5 p-5">
          {/* Run metadata */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card padding="sm">
              <small className="block text-[0.625rem] text-muted">状态</small>
              <strong className="text-sm text-ink">{statusText(run.status)}</strong>
            </Card>
            <Card padding="sm">
              <small className="block text-[0.625rem] text-muted">耗时</small>
              <strong className="font-mono text-sm text-ink">{formatDuration(run.duration)}</strong>
            </Card>
            <Card padding="sm">
              <small className="block text-[0.625rem] text-muted">尝试次数</small>
              <strong className="font-mono text-sm text-ink">{run.attempt}</strong>
            </Card>
            <Card padding="sm">
              <small className="block text-[0.625rem] text-muted">Workspace</small>
              <strong className="truncate block text-sm text-ink">{run.workspaceName}</strong>
            </Card>
          </div>

          {/* Time range */}
          <Card padding="sm" className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted">
            <span>创建: <strong className="text-ink">{formatTime(run.createdAt)}</strong></span>
            <span>开始: <strong className="text-ink">{formatTime(run.startedAt)}</strong></span>
            <span>结束: <strong className="text-ink">{formatTime(run.finishedAt)}</strong></span>
            {run.parentRunId && <span>父运行: <Link href={`/runs/${run.parentRunId}`} className="text-accent hover:underline">{run.parentRunId}</Link></span>}
          </Card>

          {/* Terminal reason (error) */}
          {run.terminalReason && (
            <Card padding="sm" className="border-danger/30 bg-danger/5">
              <div className="flex items-start gap-2">
                <Icon name="alert-circle" size={14} className="mt-0.5 flex-shrink-0 text-danger" />
                <div className="min-w-0">
                  <strong className="block text-xs text-danger">终止原因</strong>
                  <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-ink">{run.terminalReason}</pre>
                </div>
              </div>
            </Card>
          )}

          {/* Token usage */}
          {usage.totalTokens > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Token 消耗</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Card padding="sm">
                  <small className="block text-[0.625rem] text-muted">总计</small>
                  <strong className="font-mono text-lg text-ink">{formatTokens(usage.totalTokens)}</strong>
                </Card>
                <Card padding="sm">
                  <small className="block text-[0.625rem] text-muted">输入</small>
                  <strong className="font-mono text-lg text-ink">{formatTokens(usage.inputTokens)}</strong>
                </Card>
                <Card padding="sm">
                  <small className="block text-[0.625rem] text-muted">输出</small>
                  <strong className="font-mono text-lg text-ink">{formatTokens(usage.outputTokens)}</strong>
                </Card>
                <Card padding="sm">
                  <small className="block text-[0.625rem] text-muted">缓存读</small>
                  <strong className="font-mono text-lg text-ink">{formatTokens(usage.cacheReadTokens)}</strong>
                </Card>
                <Card padding="sm">
                  <small className="block text-[0.625rem] text-muted">缓存写</small>
                  <strong className="font-mono text-lg text-ink">{formatTokens(usage.cacheWriteTokens)}</strong>
                </Card>
              </div>
            </section>
          )}

          {/* Tool timeline */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-medium uppercase tracking-wider text-muted">工具调用</h2>
              <span className="font-mono text-[0.625rem] text-muted">
                {toolTimeline.length} 次{toolTimeline.length > 0 ? ` · ${successTools} 成功` : ""}{failedTools > 0 ? ` · ${failedTools} 失败` : ""}
              </span>
            </div>
            {toolTimeline.length > 0 ? (
              <div className="space-y-1">
                {toolTimeline.map((node) => (
                  <article key={node.callId} className={`rounded-sm border px-3 py-2 text-xs ${node.status === "completed" ? "border-success/20 bg-success/5" : node.status === "error" ? "border-danger/20 bg-danger/5" : "border-line bg-surface"}`}>
                    <div className="flex items-center gap-2">
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${node.status === "completed" ? "bg-success" : node.status === "error" ? "bg-danger" : "bg-accent"}`} />
                      <span className="font-mono font-medium text-ink">{node.tool}</span>
                      {node.title && <span className="min-w-0 flex-1 truncate text-muted">{node.title}</span>}
                      <span className="flex-shrink-0 font-mono text-[0.625rem] text-muted">
                        {toolDuration(node)}
                      </span>
                      <Badge variant={node.status === "completed" ? "success" : node.status === "error" ? "danger" : "outline"} size="sm">
                        {node.status}
                      </Badge>
                    </div>
                    {node.output && (
                      <pre className="mt-1.5 max-h-32 overflow-auto rounded-sm bg-bg p-2 font-mono text-[0.625rem] text-muted">{node.output}</pre>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <Card padding="sm"><EmptyState title="无工具调用" description="此次运行没有产生工具调用记录。" /></Card>
            )}
          </section>

          {/* Subagents */}
          {subagents.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">子代理</h2>
              <div className="space-y-1">
                {subagents.map((sub) => (
                  <div key={sub.subagentRunId} className="flex items-center gap-2 rounded-sm border border-line bg-surface px-3 py-2 text-xs">
                    <Badge variant={sub.status === "completed" ? "success" : sub.status === "failed" ? "danger" : "outline"} size="sm">{sub.status}</Badge>
                    <span className="font-medium text-ink">{sub.agent}</span>
                    <span className="min-w-0 flex-1 truncate text-muted">{sub.description}</span>
                    {sub.error && <span className="text-danger">{sub.error}</span>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Events */}
          {events.length > 0 && (
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-xs font-medium uppercase tracking-wider text-muted">事件流</h2>
                <span className="font-mono text-[0.625rem] text-muted">{events.length} 条</span>
              </div>
              <div className="space-y-0.5">
                {events.map((event) => {
                  const open = openEvents.has(event.seq);
                  return (
                    <div key={event.seq} className={`rounded-sm border text-xs ${open ? "border-line bg-surface" : "border-transparent"}`}>
                      <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-surface" onClick={() => toggleEvent(event.seq)}>
                        <span className="font-mono text-muted">#{event.seq}</span>
                        <span className="font-mono font-medium text-ink">{event.type}</span>
                        <span className="flex-1" />
                        <span className="font-mono text-[0.625rem] text-muted">{formatTime(event.at)}</span>
                        <span className="font-mono text-[0.625rem] text-accent">{open ? "收起" : "JSON"}</span>
                      </button>
                      {open && (
                        <pre className="max-h-48 overflow-auto border-t border-line bg-bg p-2 font-mono text-[0.625rem] text-muted">{JSON.stringify(event.data, null, 2)}</pre>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Quick links */}
          <div className="flex flex-wrap gap-3 border-t border-line pt-4 text-xs">
            <Link href={`/fw/t/${run.taskId}`} className="flex items-center gap-1 text-accent transition-colors hover:text-accent/80">
              <Icon name="message-square" size={12} />打开任务对话
            </Link>
            <Link href="/audit" className="flex items-center gap-1 text-muted transition-colors hover:text-accent">
              <Icon name="shield" size={12} />运行审计
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
