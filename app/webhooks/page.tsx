"use client";

import { useEffect, useState } from "react";

import { Badge, Button, Card, EmptyState, Icon, IconButton, Input, PageHeader, Select as ThemeSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@zmzai/theme";
import { LoginGate, useLoggedIn, WorkbenchRail } from "@/framework/client/workbench-rail";

type Workspace = { id: string; name: string };
type WebhookSubscription = { id: string; workspaceId: string; name: string; url: string; events: string[]; status: "active" | "paused"; secretPrefix: string; lastDeliveredAt: string | null; lastError: string | null; createdAt: string };
type WebhookDelivery = { deliveryId: string; eventType: string; taskId: string; runId: string; status: string; attempts: number; nextAttemptAt: string | null; responseStatus: number | null; lastError: string | null; deliveredAt: string | null; createdAt: string };
type WebhookStats = { delivered: number; pending: number; failed: number; total: number; consecutiveFailures: number };

const ALL_EVENTS = ["task.succeeded", "task.failed", "task.cancelled"] as const;
const EVENT_LABELS: Record<string, string> = { "task.succeeded": "任务完成", "task.failed": "任务失败", "task.cancelled": "任务取消" };

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const body = await response.json().catch(() => null) as { error?: string } | T | null;
  if (!response.ok) throw new Error(body && typeof body === "object" && body !== null && "error" in body ? String(body.error) : "请求失败");
  return body as T;
}

function deliveryVariant(status: string) {
  if (status === "delivered") return "success" as const;
  if (status === "failed") return "danger" as const;
  if (status === "pending" || status === "delivering") return "warning" as const;
  return "outline" as const;
}

export default function WebhooksPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [items, setItems] = useState<WebhookSubscription[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>(["task.succeeded", "task.failed"]);
  const [deliveries, setDeliveries] = useState<Record<string, WebhookDelivery[]>>({});
  const [stats, setStats] = useState<Record<string, WebhookStats>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  const load = async () => {
    const [ws, data] = await Promise.all([json<{ workspaces: Workspace[] }>("/api/workspaces"), json<{ subscriptions: WebhookSubscription[] }>("/api/webhooks")]);
    setWorkspaces(ws.workspaces);
    setWorkspaceId((current) => current || ws.workspaces[0]?.id || "");
    setItems(data.subscriptions);
  };

  useEffect(() => {
    let cancelled = false;
    void Promise.all([json<{ workspaces: Workspace[] }>("/api/workspaces"), json<{ subscriptions: WebhookSubscription[] }>("/api/webhooks")])
      .then(([ws, data]) => { if (!cancelled) { setWorkspaces(ws.workspaces); setWorkspaceId(ws.workspaces[0]?.id || ""); setItems(data.subscriptions); } })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "无法加载 Webhook"); });
    return () => { cancelled = true; };
  }, []);

  const create = async () => {
    if (!name.trim() || !url.trim() || !workspaceId || !selectedEvents.length) return;
    setBusy("create");
    setError(null);
    try {
      const result = await json<{ subscription: WebhookSubscription; secret: string }>("/api/webhooks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, name: name.trim(), url: url.trim(), events: selectedEvents }) });
      setName(""); setUrl(""); setSelectedEvents(["task.succeeded", "task.failed"]);
      setNewSecret(result.secret);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "创建失败"); }
    finally { setBusy(null); }
  };

  const toggleStatus = async (item: WebhookSubscription) => {
    setBusy(item.id);
    try {
      await json(`/api/webhooks/${item.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: item.status === "active" ? "paused" : "active" }) });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "更新失败"); }
    finally { setBusy(null); }
  };

  const remove = async (item: WebhookSubscription) => {
    if (!window.confirm(`删除 Webhook"${item.name}"？`)) return;
    setBusy(item.id);
    try {
      await json(`/api/webhooks/${item.id}`, { method: "DELETE" });
      setItems((current) => current.filter((s) => s.id !== item.id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "删除失败"); }
    finally { setBusy(null); }
  };

  const loadDeliveries = async (id: string) => {
    if (deliveries[id]) return;
    try {
      const [delResult, statsResult] = await Promise.all([
        json<{ deliveries: WebhookDelivery[] }>(`/api/webhooks/${id}/deliveries`),
        json<WebhookStats>(`/api/webhooks/${id}/stats`),
      ]);
      setDeliveries((current) => ({ ...current, [id]: delResult.deliveries }));
      setStats((current) => ({ ...current, [id]: statsResult }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法加载投递记录"); }
  };

  const retryDelivery = async (subscriptionId: string, deliveryId: string) => {
    setBusy(`retry:${deliveryId}`);
    try {
      await json(`/api/webhooks/${subscriptionId}/deliveries/${deliveryId}/retry`, { method: "POST" });
      setDeliveries((current) => { delete current[subscriptionId]; return { ...current }; });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "重试失败"); }
    finally { setBusy(null); }
  };

  const copySecret = () => { if (newSecret) void navigator.clipboard.writeText(newSecret); };

  const toggleEvent = (event: string) => {
    setSelectedEvents((current) => current.includes(event) ? current.filter((e) => e !== event) : [...current, event]);
  };

  const { loggedIn, loading } = useLoggedIn();
  if (!loading && !loggedIn) return <LoginGate title="登录后管理 Webhook" />;

  return (
    <main className="flex min-h-dvh flex-col bg-bg md:flex-row">
      <WorkbenchRail tasks={[]} activeTaskId={null} onNew={() => { window.location.href = "/quill"; }} onOpen={() => undefined} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mx-auto flex w-[min(100%-2rem,74rem)] flex-1 flex-col py-8">
          <PageHeader
            icon="bolt"
            eyebrow="事件推送"
            title="Webhook"
            description="任务完成、失败或取消时，自动向你指定的地址推送通知。"
            className="mb-6"
          />
          {error && <div className="mb-4 rounded-sm border-l-2 border-danger bg-danger/10 px-3 py-2 text-sm text-ink" role="status">{error}<button type="button" className="ml-2 underline" onClick={() => setError(null)}>关闭</button></div>}

          {/* Create form */}
          <Card padding="md" className="mb-6">
            <div className="mb-3"><strong className="text-sm font-semibold text-ink">新建订阅</strong><span className="ml-2 text-xs text-ink-3">任务状态变更时推送 HTTPS POST 到你的地址。</span></div>
            <div className="flex flex-wrap items-center gap-2">
              <ThemeSelect value={workspaceId} onValueChange={(value: string) => setWorkspaceId(value)}>
                <SelectTrigger className="w-auto" aria-label="选择 Workspace"><SelectValue placeholder="选择 Workspace" /></SelectTrigger>
                <SelectContent>{workspaces.map((ws) => <SelectItem key={ws.id} value={ws.id}>{ws.name}</SelectItem>)}</SelectContent>
              </ThemeSelect>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="订阅名称" className="min-w-0 flex-1" />
              <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://your-server.com/webhook" className="min-w-0 flex-1" />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <span className="text-xs text-ink-3">订阅事件：</span>
              {ALL_EVENTS.map((event) => (
                <label key={event} className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-2">
                  <input type="checkbox" checked={selectedEvents.includes(event)} onChange={() => toggleEvent(event)} />
                  {EVENT_LABELS[event] ?? event}
                </label>
              ))}
              <Button type="button" onClick={() => void create()} disabled={busy === "create" || !name.trim() || !url.trim() || !selectedEvents.length}><Icon name="plus" size={14} />创建</Button>
            </div>
            {newSecret && (
              <div className="mt-3 rounded-sm border border-accent/30 bg-accent/5 p-3">
                <strong className="text-sm font-semibold text-ink">签名密钥（仅显示一次）</strong>
                <small className="mt-1 block text-xs text-ink-3">请妥善保存，用于验证推送请求的签名。</small>
                <div className="mt-2 flex items-center gap-2">
                  <Input readOnly value={newSecret} className="font-mono text-xs" />
                  <IconButton size="sm" label="复制密钥" onClick={copySecret}><Icon name="copy" size={13} /></IconButton>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setNewSecret(null)}>已保存</Button>
                </div>
              </div>
            )}
          </Card>

          {/* Subscription list */}
          <section className="flex flex-col gap-3">
            {items.length ? items.map((item) => (
              <Card key={item.id} padding="md">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-ink">{item.name}</h2>
                      <Badge variant={item.status === "active" ? "success" : "outline"} size="sm">{item.status === "active" ? "活跃" : "已暂停"}</Badge>
                      {item.lastError && <Badge variant="danger" size="sm">上次投递失败</Badge>}
                    </div>
                    <p className="mt-1 font-mono text-xs text-ink-2">{item.url}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {item.events.map((event) => <Badge key={event} variant="outline" size="sm">{EVENT_LABELS[event] ?? event}</Badge>)}
                    </div>
                    <small className="mt-1 block text-xs text-ink-3">密钥前缀 {item.secretPrefix} · 创建于 {new Date(item.createdAt).toLocaleDateString("zh-CN")}{item.lastDeliveredAt ? ` · 最近投递 ${new Date(item.lastDeliveredAt).toLocaleString("zh-CN")}` : ""}</small>
                    {stats[item.id] && (
                      <div className="mt-2 flex gap-3 font-mono text-xs text-ink-3">
                        <span>已投递 <strong className="text-success">{stats[item.id]!.delivered}</strong></span>
                        <span>待投递 <strong className="text-ink-2">{stats[item.id]!.pending}</strong></span>
                        <span>失败 <strong className={stats[item.id]!.failed > 0 ? "text-danger" : "text-ink-2"}>{stats[item.id]!.failed}</strong></span>
                        {stats[item.id]!.consecutiveFailures > 0 && <span className="text-danger">连续失败 {stats[item.id]!.consecutiveFailures}</span>}
                      </div>
                    )}
                    <details className="mt-2" onToggle={(event) => { if ((event.target as HTMLDetailsElement).open) void loadDeliveries(item.id); }}>
                      <summary className="cursor-pointer text-xs text-ink-3 hover:text-ink-2">投递记录</summary>
                      <div className="mt-2 flex flex-col gap-1">
                        {deliveries[item.id]?.map((delivery) => (
                          <div key={delivery.deliveryId} className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-ink-2">
                            <Badge variant={deliveryVariant(delivery.status)} size="sm">{delivery.status}</Badge>
                            <span>{EVENT_LABELS[delivery.eventType] ?? delivery.eventType}</span>
                            <span className="text-ink-3">{new Date(delivery.createdAt).toLocaleString("zh-CN")}</span>
                            {delivery.responseStatus && <span className="font-mono text-ink-3">HTTP {delivery.responseStatus}</span>}
                            {delivery.attempts > 1 && <span className="text-ink-3">{delivery.attempts} 次尝试</span>}
                            {delivery.lastError && <span className="max-w-40 truncate text-danger" title={delivery.lastError}>{delivery.lastError}</span>}
                            {delivery.status === "failed" && <IconButton size="sm" label="重试" disabled={busy === `retry:${delivery.deliveryId}`} onClick={() => void retryDelivery(item.id, delivery.deliveryId)}><Icon name="refresh" size={11} /></IconButton>}
                          </div>
                        ))}
                        {!deliveries[item.id] && <p className="text-xs text-ink-3">加载中…</p>}
                        {deliveries[item.id]?.length === 0 && <p className="text-xs text-ink-3">暂无投递记录。</p>}
                      </div>
                    </details>
                  </div>
                  <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
                    <IconButton size="md" label={item.status === "active" ? "暂停" : "恢复"} onClick={() => void toggleStatus(item)} disabled={busy === item.id}><Icon name={item.status === "active" ? "pause" : "play"} size={13} /></IconButton>
                    <IconButton size="md" label="删除" disabled={busy === item.id} onClick={() => void remove(item)}><Icon name="trash" size={13} /></IconButton>
                  </div>
                </div>
              </Card>
            )) : <EmptyState icon={<Icon name="webhook" size={24} />} title="还没有 Webhook" description="创建一个订阅，在任务状态变更时接收推送通知。" />}
          </section>
        </div>
      </div>
    </main>
  );
}
