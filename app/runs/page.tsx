"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge, Card, EmptyState, Icon } from "@zmzai/theme";
import { LoginGate, useLoggedIn, WorkbenchRail } from "@/framework/client/workbench-rail";

type RunRow = {
  runId: string;
  taskId: string;
  taskTitle: string;
  workspaceId: string;
  workspaceName: string;
  status: string;
  attempt: number;
  terminalReason: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  duration: number | null;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; totalTokens: number };
};

type Workspace = { id: string; name: string };

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

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const PAGE_SIZE = 30;

export default function RunsPage() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [wsFilter, setWsFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load workspaces
  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/workspaces", { cache: "no-store" });
        const body = (await response.json()) as { workspaces?: Workspace[] };
        setWorkspaces(body.workspaces ?? []);
      } catch { /* ignore */ }
    })();
  }, []);

  // Load runs
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (wsFilter) params.set("workspaceId", wsFilter);
    if (statusFilter) params.set("status", statusFilter);
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(offset));

    void (async () => {
      try {
        const response = await fetch(`/api/runs?${params}`, { cache: "no-store" });
        const body = (await response.json()) as { runs?: RunRow[]; total?: number; error?: string };
        if (!response.ok) throw new Error(body.error ?? "无法加载运行列表");
        setRuns(body.runs ?? []);
        setTotal(body.total ?? 0);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "无法加载运行列表");
      } finally {
        setLoading(false);
      }
    })();
  }, [wsFilter, statusFilter, offset]);

  const { loggedIn, loading: meLoading } = useLoggedIn();
  if (!meLoading && !loggedIn) return <LoginGate title="登录后查看运行历史" />;

  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-bg">
      <WorkbenchRail tasks={[]} activeTaskId={null} onNew={() => { window.location.href = "/fw"; }} onOpen={() => undefined} />

      <div className="flex flex-1 flex-col overflow-y-auto">
        <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-line bg-bg/85 px-5 py-3 backdrop-blur-md">
          <h1 className="text-sm font-semibold text-ink">运行历史</h1>
          <Badge variant="outline" size="sm">{total} 条记录</Badge>
          <span className="flex-1" />
          {workspaces.length > 0 && (
            <select value={wsFilter} onChange={(e) => { setWsFilter(e.target.value); setOffset(0); }} className="rounded-sm border border-line bg-surface px-2 py-1 text-xs text-ink">
              <option value="">全部 Workspace</option>
              {workspaces.map((ws) => <option key={ws.id} value={ws.id}>{ws.name}</option>)}
            </select>
          )}
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setOffset(0); }} className="rounded-sm border border-line bg-surface px-2 py-1 text-xs text-ink">
            <option value="">全部状态</option>
            <option value="created">准备中</option>
            <option value="running">执行中</option>
            <option value="succeeded">已完成</option>
            <option value="failed">已失败</option>
            <option value="cancelled">已取消</option>
            <option value="waiting_input">等待补充</option>
            <option value="waiting_approval">等待审批</option>
          </select>
        </header>

        {error && <div className="mx-5 mt-3 workbench-alert">{error}</div>}

        <div className="mx-auto w-full max-w-5xl p-5">
          {loading ? (
            <p className="py-12 text-center text-sm text-muted">正在加载…</p>
          ) : runs.length === 0 ? (
            <EmptyState title="暂无运行记录" description="发起任务后，运行记录会出现在这里。" />
          ) : (
            <div className="space-y-1">
              {runs.map((run) => (
                <Link href={`/runs/${run.runId}`} key={run.runId} className="group flex items-center gap-3 rounded-sm border border-transparent px-3 py-2.5 transition-colors hover:border-line hover:bg-surface">
                  <Badge variant={statusVariant(run.status)} size="sm" className="flex-shrink-0">{statusText(run.status)}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <strong className="truncate text-sm text-ink">{run.taskTitle}</strong>
                      <span className="flex-shrink-0 font-mono text-[0.625rem] text-muted">#{run.attempt}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.625rem] text-muted">
                      <span>{run.workspaceName}</span>
                      <span>{formatDate(run.createdAt)}</span>
                      <span className="font-mono">{formatDuration(run.duration)}</span>
                      {run.usage.totalTokens > 0 && <span className="font-mono">{formatTokens(run.usage.totalTokens)} tokens</span>}
                      {run.terminalReason && <span className="text-danger">{run.terminalReason.slice(0, 60)}</span>}
                    </div>
                  </div>
                  <Icon name="chevron-right" size={12} className="flex-shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
              ))}
            </div>
          )}

          {/* Pagination */}
          {(hasPrev || hasNext) && (
            <div className="mt-4 flex items-center justify-center gap-3 text-xs">
              <button type="button" disabled={!hasPrev} onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))} className="rounded-sm border border-line px-3 py-1 text-muted transition-colors hover:bg-surface disabled:opacity-30">上一页</button>
              <span className="font-mono text-muted">{Math.floor(offset / PAGE_SIZE) + 1} / {Math.ceil(total / PAGE_SIZE)}</span>
              <button type="button" disabled={!hasNext} onClick={() => setOffset((o) => o + PAGE_SIZE)} className="rounded-sm border border-line px-3 py-1 text-muted transition-colors hover:bg-surface disabled:opacity-30">下一页</button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
